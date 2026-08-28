/**
 * Emby 登录式接入单元测试：AuthenticateByName 成功持久化 / 401 → 3011 /
 * 媒体库分页映射 / 剧集 playinfo 自动取第一集。mock globalThis.fetch，不发真实请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { mock } from 'node:test';

import { closeDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { ApiError } from '../src/middleware/errorHandler';
import {
  getLibraryItems,
  getPlayInfo,
  loginEmby,
} from '../src/services/embyService';
import { getSetting } from '../src/services/settingsService';

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('embyService · 登录式接入', () => {
  before(() => runMigrate());
  after(() => closeDb());
  afterEach(() => mock.restoreAll());

  it('登录成功：AccessToken/userId/username/serverUrl 全部落库', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/Users/AuthenticateByName')) {
        assert.equal(init?.method, 'POST');
        const parsed = JSON.parse(String(init?.body)) as { Username: string; Pw: string };
        assert.equal(parsed.Username, 'demo');
        assert.equal(parsed.Pw, 'secret');
        return jsonRes({
          AccessToken: 'tok-123',
          ServerId: 'srv-1',
          User: { Id: 'user-9', Name: 'demo' },
        });
      }
      if (url.endsWith('/System/Info')) {
        return jsonRes({ Id: 'srv-1', ServerName: 'HomeNAS' });
      }
      if (url.endsWith('/Users/user-9')) {
        return jsonRes({ Id: 'user-9', Name: 'demo' });
      }
      return jsonRes(null, false, 404);
    });

    const result = await loginEmby({
      serverUrl: 'http://192.168.1.10:8096/',
      username: 'demo',
      password: 'secret',
    });
    assert.equal(result.userId, 'user-9');
    assert.equal(result.serverName, 'HomeNAS');
    assert.equal(getSetting('emby_access_token'), 'tok-123');
    assert.equal(getSetting('emby_user_id'), 'user-9');
    assert.equal(getSetting('emby_username'), 'demo');
    assert.equal(getSetting('emby_server_url'), 'http://192.168.1.10:8096');
  });

  it('登录失败：401 → 3011；响应缺 AccessToken → 3012', async () => {
    mock.method(globalThis, 'fetch', async () => jsonRes(null, false, 401));
    await assert.rejects(
      () => loginEmby({ serverUrl: 'http://x', username: 'a', password: 'b' }),
      (err: unknown) => err instanceof ApiError && err.code === 3011,
    );

    mock.method(globalThis, 'fetch', async () => jsonRes({ AccessToken: null }));
    await assert.rejects(
      () => loginEmby({ serverUrl: 'http://x', username: 'a', password: 'b' }),
      (err: unknown) => err instanceof ApiError && err.code === 3012,
    );
  });

  it('媒体库分页：SearchTerm/类型透传，条目映射完整', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('IncludeItemTypes'), 'Movie');
      assert.equal(url.searchParams.get('SearchTerm'), '星际');
      assert.equal(url.searchParams.get('StartIndex'), '20');
      assert.equal(url.searchParams.get('Limit'), '10');
      return jsonRes({
        TotalRecordCount: 21,
        Items: [
          {
            Id: 'i1',
            Name: '星际穿越',
            Type: 'Movie',
            ProductionYear: 2014,
            Overview: 'nolan',
            ImageTags: { Primary: 'abc' },
            UserData: { Played: true },
          },
          { Id: 'bad', Name: '无类型' },
        ],
      });
    });
    const page = await getLibraryItems({ startIndex: 20, limit: 10, search: '星际', itemType: 'movie' });
    assert.equal(page.total, 21);
    assert.equal(page.items.length, 1);
    const item = page.items[0];
    assert.equal(item.itemId, 'i1');
    assert.equal(item.title, '星际穿越');
    assert.equal(item.mediaType, 'movie');
    assert.equal(item.played, true);
    assert.ok(item.posterUrl?.includes('/emby/Items/i1/Images/Primary'));
  });

  it('剧集 playinfo：自动取第一集并拼 master.m3u8', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/Users/user-9/Items/ser-1')) {
        return jsonRes({ Id: 'ser-1', Name: '老友记', Type: 'Series' });
      }
      if (url.includes('/Shows/ser-1/Episodes')) {
        return jsonRes({
          Items: [{ Id: 'ep-1', Name: '第一集', RunTimeTicks: 15000000000 }],
        });
      }
      return jsonRes(null, false, 404);
    });
    const info = await getPlayInfo('ser-1');
    assert.equal(info.title, '老友记 · 第一集');
    assert.ok(info.hlsUrl.includes('/emby/Videos/ep-1/master.m3u8'));
    assert.ok(info.hlsUrl.includes('api_key=tok-123'));
    assert.ok(info.hlsUrl.includes('MediaSourceId=ep-1'));
  });
});
