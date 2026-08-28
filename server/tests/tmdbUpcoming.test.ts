/**
 * tmdbUpcoming 单源降级测试：任一源失败仍可用另一源返回；两源皆败才抛 2002。
 * 通过 mock globalThis.fetch 模拟 TMDB 响应，不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { mock } from 'node:test';

import { closeDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { ApiError } from '../src/middleware/errorHandler';
import { setSetting } from '../src/services/settingsService';
import { fetchUpcoming } from '../src/services/tmdbUpcoming';

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('tmdbUpcoming · 即将上映单源降级', () => {
  before(() => {
    runMigrate();
    setSetting('tmdb_api_key', 'test-key');
  });
  after(() => closeDb());
  afterEach(() => mock.restoreAll());

  it('两源正常：按上映日期升序返回窗口内条目，窗口外（+100 天）被过滤', async () => {
    mock.method(globalThis, 'fetch', async (url: URL) => {
      const path = url.pathname;
      if (path.endsWith('/movie/upcoming')) {
        return jsonRes({
          results: [
            { id: 1, title: 'M1', release_date: iso(10) },
            { id: 2, title: 'M2', release_date: iso(100) }, // 窗口外
          ],
        });
      }
      if (path.endsWith('/tv/on_the_air')) {
        return jsonRes({
          results: [{ id: 3, name: 'T1', first_air_date: iso(5) }],
        });
      }
      return jsonRes({ results: [] });
    });
    const items = await fetchUpcoming(10);
    assert.deepEqual(
      items.map((i) => i.title),
      ['T1', 'M1'],
    );
  });

  it('电影源失败（HTTP 500）→ 降级仅用剧集源，不抛错', async () => {
    mock.method(globalThis, 'fetch', async (url: URL) => {
      if (url.pathname.endsWith('/movie/upcoming')) {
        return jsonRes(null, false, 500);
      }
      return jsonRes({ results: [{ id: 3, name: 'T1', first_air_date: iso(5) }] });
    });
    const items = await fetchUpcoming(10);
    assert.deepEqual(
      items.map((i) => i.title),
      ['T1'],
    );
  });

  it('剧集源失败 → 降级仅用电影源，不抛错', async () => {
    mock.method(globalThis, 'fetch', async (url: URL) => {
      if (url.pathname.endsWith('/tv/on_the_air')) {
        return jsonRes(null, false, 500);
      }
      return jsonRes({ results: [{ id: 1, title: 'M1', release_date: iso(10) }] });
    });
    const items = await fetchUpcoming(10);
    assert.deepEqual(
      items.map((i) => i.title),
      ['M1'],
    );
  });

  it('两源皆失败 → 抛 ApiError 2002', async () => {
    mock.method(globalThis, 'fetch', async () => jsonRes(null, false, 500));
    await assert.rejects(
      () => fetchUpcoming(10),
      (err: unknown) => err instanceof ApiError && err.code === 2002,
    );
  });
});
