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
  getLibraryViews,
  getPlayInfo,
  getWatchHistory,
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

  it('媒体库分类 Views：虚拟库映射（名称/CollectionType/封面）', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.ok(url.includes('/Users/user-9/Views'));
      return jsonRes({
        Items: [
          { Id: 'v1', Name: '电影', CollectionType: 'movies', ImageTags: { Primary: 'm1' } },
          { Id: 'v2', Name: '剧集', CollectionType: 'tvshows', ImageTags: {} },
          { Id: 'v3', Name: '音乐', CollectionType: 'music' },
        ],
      });
    });
    const views = await getLibraryViews();
    assert.equal(views.length, 3);
    assert.equal(views[0].name, '电影');
    assert.equal(views[0].collectionType, 'movies');
    assert.ok(views[0].posterUrl?.includes('/emby/Items/v1/Images/Primary'));
    assert.equal(views[1].posterUrl, null);
    assert.equal(views[2].collectionType, 'music');
  });

  it('媒体库筛选参数：ParentId/观看状态/排序透传', async () => {
    let captured: URL | null = null;
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      captured = new URL(String(input));
      return jsonRes({ TotalRecordCount: 0, Items: [] });
    });
    await getLibraryItems({
      startIndex: 0,
      limit: 40,
      parentId: 'v1',
      played: 'unplayed',
      sortBy: 'DateCreated',
      sortOrder: 'Descending',
    });
    assert.ok(captured);
    assert.equal(captured.searchParams.get('ParentId'), 'v1');
    assert.equal(captured.searchParams.get('Filters'), 'IsUnPlayed');
    assert.equal(captured.searchParams.get('SortBy'), 'DateCreated');
    assert.equal(captured.searchParams.get('SortOrder'), 'Descending');
  });

  it('观看记录：IsPlayed+DatePlayed 倒序，剧集回退剧封面并拼 S/E 标题', async () => {
    let captured: URL | null = null;
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      captured = new URL(String(input));
      return jsonRes({
        Items: [
          {
            Id: 'ep-5',
            Name: '雨夜',
            Type: 'Episode',
            SeriesName: '漫长的季节',
            SeriesId: 'ser-3',
            ParentIndexNumber: 1,
            IndexNumber: 2,
            UserData: { LastPlayedDate: '2026-08-28T21:00:00Z' },
          },
          {
            Id: 'mv-2',
            Name: '盗梦空间',
            Type: 'Movie',
            ProductionYear: 2010,
            ImageTags: { Primary: 'p2' },
            UserData: { LastPlayedDate: '2026-08-27T10:00:00Z' },
          },
        ],
      });
    });
    const items = await getWatchHistory(30);
    assert.ok(captured);
    assert.equal(captured.searchParams.get('Filters'), 'IsPlayed');
    assert.equal(captured.searchParams.get('SortBy'), 'DatePlayed');
    assert.equal(captured.searchParams.get('SortOrder'), 'Descending');
    assert.equal(captured.searchParams.get('IncludeItemTypes'), 'Movie,Episode');

    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'S1·E2 雨夜');
    assert.equal(items[0].seriesName, '漫长的季节');
    assert.equal(items[0].mediaType, 'tv');
    assert.ok(items[0].posterUrl?.includes('/emby/Items/ser-3/Images/Primary'), '剧集应回退剧封面');
    assert.equal(items[0].watchedDate, '2026-08-28T21:00:00Z');
    assert.equal(items[1].title, '盗梦空间');
    assert.equal(items[1].mediaType, 'movie');
    assert.equal(items[1].year, 2010);
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
