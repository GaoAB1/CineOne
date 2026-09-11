/**
 * qbService 单元测试：登录与 Cookie 复用、免认证模式、任务映射、
 * 表单参数（savepath/category/deleteFiles）、错误分支。
 * 网络请求以 globalThis.fetch mock 注入，不发真实请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { beforeEach, describe, it, after, before } from 'node:test';

import { closeDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { setSetting } from '../src/services/settingsService';
import {
  addTorrentFile,
  clearQbSession,
  controlTorrents,
  getQbStatus,
  listTorrents,
} from '../src/services/qbService';

interface Call {
  url: string;
  method: string;
  referer: string | null;
  cookie: string | null;
  body: unknown;
}

const originalFetch = globalThis.fetch;
let calls: Call[] = [];
let handler: ((url: string, init: RequestInit) => Response) | null = null;

before(() => {
  runMigrate();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      referer: headers.get('Referer'),
      cookie: headers.get('Cookie'),
      body: init?.body,
    });
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler(url, init ?? {});
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  closeDb();
});

function textRes(text: string, status = 200, setCookie?: string): Response {
  const headers = new Headers();
  if (setCookie) headers.set('set-cookie', setCookie);
  return {
    ok: status < 400,
    status,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response;
}

function jsonRes(payload: unknown, status = 200): Response {
  const headers = new Headers();
  return {
    ok: status < 400,
    status,
    headers,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
}

function configure(): void {
  setSetting('qb_server_url', 'http://qb.local:8080');
  setSetting('qb_username', 'admin');
  setSetting('qb_password', 'secret');
}

beforeEach(() => {
  clearQbSession();
  calls = [];
  handler = null;
  configure();
});

describe('qbService 登录与会话', () => {
  it('登录成功后复用 SID cookie，后续请求不再重复登录', async () => {
    handler = (url) => {
      if (url.includes('/api/v2/auth/login')) {
        return textRes('Ok.', 200, 'SID=abc123; path=/; HttpOnly');
      }
      if (url.includes('/api/v2/torrents/info')) {
        return jsonRes([
          {
            hash: 'HASH1',
            name: 'Dune.2021.2160p',
            size: 1000,
            progress: 0.5,
            dlspeed: 2048,
            upspeed: 128,
            state: 'downloading',
            eta: 120,
            save_path: '/downloads/movies',
            category: '电影',
            added_on: 1700000000,
            num_seeds: 12,
            num_leechs: 3,
            downloaded: 500,
            uploaded: 10,
          },
        ]);
      }
      throw new Error(`unexpected: ${url}`);
    };

    const torrents = await listTorrents();
    assert.equal(torrents.length, 1);
    assert.equal(torrents[0].hash, 'HASH1');
    assert.equal(torrents[0].savePath, '/downloads/movies');
    assert.equal(torrents[0].category, '电影');
    assert.equal(torrents[0].dlspeed, 2048);

    const loginCalls = calls.filter((c) => c.url.includes('/auth/login'));
    assert.equal(loginCalls.length, 1, '只应登录一次');
    assert.equal(loginCalls[0].method, 'POST');
    assert.equal(loginCalls[0].referer, 'http://qb.local:8080', '需带同源 Referer 通过 CSRF');

    const infoCall = calls.find((c) => c.url.includes('/torrents/info'));
    assert.equal(infoCall?.cookie, 'SID=abc123', '后续请求应带 SID cookie');
  });

  it('用户名留空视为免认证：跳过登录直接请求', async () => {
    setSetting('qb_username', '');
    handler = () => textRes('v5.0.0');

    const status = await getQbStatus();
    assert.equal(status.authMode, 'anonymous');
    assert.equal(status.version, 'v5.0.0');
    assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 0, '不应发起登录');
  });

  it('登录失败抛 2004 业务错误', async () => {
    handler = () => textRes('Fails.', 200);
    await assert.rejects(
      () => listTorrents(),
      (err: { code?: number; message?: string }) =>
        err.code === 2004 && String(err.message).includes('登录失败'),
    );
  });

  it('未配置地址时抛 2004，且 getQbStatus 返回 configured=false', async () => {
    setSetting('qb_server_url', '');
    const status = await getQbStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reachable, false);
    await assert.rejects(
      () => listTorrents(),
      (err: { code?: number }) => err.code === 2004,
    );
  });

  it('403 时自动重登一次并重试请求', async () => {
    let infoAttempts = 0;
    handler = (url) => {
      if (url.includes('/api/v2/auth/login')) return textRes('Ok.', 200, 'SID=fresh; path=/');
      if (url.includes('/api/v2/torrents/info')) {
        infoAttempts += 1;
        if (infoAttempts === 1) return textRes('Forbidden', 403);
        return jsonRes([]);
      }
      throw new Error(`unexpected: ${url}`);
    };
    const list = await listTorrents();
    assert.deepEqual(list, []);
    assert.equal(infoAttempts, 2, '首次 403 后应重登并重试');
    assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 2);
  });
});

describe('qbService 写入操作', () => {
  it('addTorrentFile 以 multipart 上传，带 savepath/category 与 paused', async () => {
    handler = (url) => {
      if (url.includes('/auth/login')) return textRes('Ok.', 200, 'SID=s1; path=/');
      if (url.includes('/torrents/add')) return textRes('Ok.');
      throw new Error(`unexpected: ${url}`);
    };

    await addTorrentFile({
      filename: 'demo.torrent',
      data: new Uint8Array([100, 56, 58, 97, 110, 110, 111, 117, 110, 99, 101]),
      savePath: '/downloads/tv',
      category: '剧集',
      paused: true,
    });

    const addCall = calls.find((c) => c.url.includes('/torrents/add'));
    assert.ok(addCall, '应调用 torrents/add');
    assert.equal(addCall.method, 'POST');
    const form = addCall.body as FormData;
    assert.ok(form instanceof FormData, '请求体应为 FormData');
    assert.equal(form.get('savepath'), '/downloads/tv');
    assert.equal(form.get('category'), '剧集');
    assert.equal(form.get('paused'), 'true');
    const file = form.get('torrents');
    assert.ok(file instanceof Blob, 'torrents 字段应为文件 Blob');
  });

  it('controlTorrents delete 携带 deleteFiles 标志', async () => {
    handler = (url) => {
      if (url.includes('/auth/login')) return textRes('Ok.', 200, 'SID=s2; path=/');
      if (url.includes('/torrents/delete')) return textRes('Ok.');
      throw new Error(`unexpected: ${url}`);
    };

    await controlTorrents('delete', 'abc123|def456', true);
    const call = calls.find((c) => c.url.includes('/torrents/delete'));
    assert.ok(call);
    const form = call.body as FormData;
    assert.equal(form.get('hashes'), 'abc123|def456');
    assert.equal(form.get('deleteFiles'), 'true');
  });

  it('add 失败时抛 2004 并含动作描述', async () => {
    handler = (url) => {
      if (url.includes('/auth/login')) return textRes('Ok.', 200, 'SID=s3; path=/');
      if (url.includes('/torrents/add')) return textRes('bad torrent', 415);
      throw new Error(`unexpected: ${url}`);
    };
    await assert.rejects(
      () => addTorrentFile({ filename: 'x.torrent', data: new Uint8Array([1, 2, 3]) }),
      (err: { code?: number; message?: string }) =>
        err.code === 2004 && String(err.message).includes('添加任务失败'),
    );
  });
});
