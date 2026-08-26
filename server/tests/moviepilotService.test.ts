/**
 * moviepilotService 单元测试：未配置降级、推送成功/业务拒绝/401/网络错误的
 * 结构化错误码与 subscribe_log 落库（成败均记录）。global.fetch 以可编程 mock
 * 注入，不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import {
  getMoviePilotStatus,
  pushSubscribe,
  subscribeAndLog,
  toMpType,
} from '../src/services/moviepilotService';
import { setSetting } from '../src/services/settingsService';
import { ApiError } from '../src/middleware/errorHandler';

/** 可编程 fetch mock：按脚本应答，并记录最近一次调用的 URL/headers/body */
type FetchScript = (url: string, init?: RequestInit) => { status: number; body: unknown };
let originalFetch: typeof globalThis.fetch;
let script: FetchScript;
let lastCall: { url: string; init?: RequestInit } | null = null;

function mockJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function assertApiError(fn: () => Promise<unknown>, code: number, httpStatus: number): Promise<void> {
  return fn().then(
    () => assert.fail(`期望抛出 ApiError(code=${code})，但未抛出任何异常`),
    (err) => {
      assert.ok(err instanceof ApiError, `期望 ApiError，实际得到：${String(err)}`);
      assert.equal((err as ApiError).code, code);
      assert.equal((err as ApiError).httpStatus, httpStatus);
    },
  );
}

function logRows(): Array<{ user_id: number; tmdb_id: number; ok: number; message: string | null }> {
  return getDb()
    .prepare('SELECT user_id, tmdb_id, ok, message FROM subscribe_log ORDER BY id')
    .all() as Array<{ user_id: number; tmdb_id: number; ok: number; message: string | null }>;
}

const BASE_INPUT = {
  title: '沙丘：第二部',
  mediaType: 'movie' as const,
  tmdbId: 693134,
  year: 2024,
  season: null,
};

describe('moviepilotService · 未配置状态', () => {
  before(() => runMigrate());

  after(() => closeDb());

  it('getMoviePilotStatus 未配置时 configured=false 且不触网', async () => {
    setSetting('moviepilot_server_url', '');
    setSetting('moviepilot_token', '');
    let called = false;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (..._args: unknown[]) => {
      called = true;
      throw new Error('不应发起网络请求');
    }) as unknown as typeof fetch;
    const status = await getMoviePilotStatus();
    assert.deepEqual(status, { configured: false, reachable: false });
    assert.equal(called, false);
    globalThis.fetch = originalFetch;
  });
});

describe('moviepilotService · 推送与日志（fetch mock）', () => {
  before(() => {
    runMigrate();
    // subscribe_log.user_id 外键指向 users
    getDb()
      .prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'member')`)
      .run();
    setSetting('moviepilot_server_url', 'http://mp.local:3000');
    setSetting('moviepilot_token', 'mp-token-abcdef');
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: unknown) =>
      mockJsonResponse(script.status, script.body)) as unknown as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    closeDb();
  });

  it('推送成功：POST /api/v1/subscribe/ 携带 X-API-KEY 与中文 type，日志 ok=1', async () => {
    lastCall = null;
    script = { status: 200, body: { success: true, message: '订阅成功', data: { id: 9 } } };
    // 借 listSubscribed 的探测路径验证请求头与路径；push 走 POST
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      lastCall = { url: String(url), init };
      return mockJsonResponse(script.status, script.body);
    }) as unknown as typeof fetch;

    const result = await subscribeAndLog(1, BASE_INPUT);
    assert.equal(result.ok, true);
    assert.equal(result.subscribeId, 9);
    assert.ok(lastCall!.url.includes('/api/v1/subscribe'), `URL 应含 /api/v1/subscribe，实际 ${lastCall!.url}`);
    assert.equal((lastCall!.init?.headers as Record<string, string>)['X-API-KEY'], 'mp-token-abcdef');
    const sentBody = JSON.parse(String(lastCall!.init?.body)) as Record<string, unknown>;
    assert.equal(sentBody.type, '电影'); // movie → 中文「电影」
    assert.equal(sentBody.tmdbid, 693134);
    assert.equal(sentBody.year, 2024);

    const rows = logRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, 1);
    assert.match(rows[0].message ?? '', /订阅成功/);
  });

  it('业务拒绝（200 + success=false）→ code=4004，日志 ok=0 且记录原因', async () => {
    script = { status: 200, body: { success: false, message: '标识符不正确' } };
    await assertApiError(() => subscribeAndLog(1, BASE_INPUT), 4004, 502);
    const rows = logRows();
    assert.equal(rows[rows.length - 1].ok, 0);
    assert.match(rows[rows.length - 1].message ?? '', /标识符不正确/);
  });

  it('认证失败（401）→ code=4003；不可达（网络错误）→ code=4002；两者均写失败日志', async () => {
    script = { status: 401, body: { detail: 'Not authenticated' } };
    await assertApiError(() => pushSubscribe(BASE_INPUT), 4003, 502);

    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await assertApiError(() => pushSubscribe(BASE_INPUT), 4002, 502);

    const rows = logRows();
    assert.ok(rows.length >= 2);
  });

  it('toMpType 映射：movie→电影、tv→电视剧', () => {
    assert.equal(toMpType('movie'), '电影');
    assert.equal(toMpType('tv'), '电视剧');
  });
});
