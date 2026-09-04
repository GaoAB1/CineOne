/**
 * providerService 单元测试：目标平台匹配、平台条目 discover、样例海报缓存。
 * TMDB 网络请求以 globalThis.fetch mock 注入（res.json 形态），不发真实请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { setSetting } from '../src/services/settingsService';
import {
  clearProviderListCache,
  discoverProviderItems,
  listProviderRegions,
} from '../src/services/providerService';

type FetchHandler = (
  url: string,
) => { ok: boolean; json: () => Promise<unknown> };

const originalFetch = globalThis.fetch;
let fetchHandler: FetchHandler | null = null;

before(() => {
  runMigrate();
  setSetting('tmdb_api_key', 'test-key');
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (!fetchHandler) throw new Error('test fetch stub not configured');
    return fetchHandler(String(input)) as unknown as Response;
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  closeDb();
});

/** 按 URL 分流：watch/providers 返回列表，discover 返回样例/条目 */
function stubJson(handler: (url: string) => unknown): void {
  fetchHandler = (url) => ({
    ok: true,
    json: async () => handler(url),
  });
}

describe('providerService', () => {
  it('从 watch/providers 列表匹配出美区目标平台并附样例海报', async () => {
    clearProviderListCache();
    stubJson((url) => {
      if (url.includes('/watch/providers/movie')) {
        return {
          results: [
            { provider_id: 8, provider_name: 'Netflix', logo_path: '/net.png' },
            { provider_id: 350, provider_name: 'Apple TV+', logo_path: '/apl.png' },
            { provider_id: 9, provider_name: 'Prime Video', logo_path: '/pri.png' },
            { provider_id: 337, provider_name: 'Disney+', logo_path: '/dis.png' },
            { provider_id: 15, provider_name: 'Hulu', logo_path: '/hul.png' },
            { provider_id: 1899, provider_name: 'Max', logo_path: '/max.png' },
            { provider_id: 999, provider_name: 'Random TV', logo_path: null },
          ],
        };
      }
      // discover 样例：返回 1 张即可（验证 samples 非空）
      return {
        page: 1,
        total_pages: 1,
        results: [
          { id: 101, title: 'Sample 1', poster_path: '/s1.png' },
        ],
      };
    });
    const regions = await listProviderRegions();
    const us = regions.find((r) => r.key === 'us');
    assert.ok(us);
    assert.equal(us.providers.length, 6);
    const netflix = us.providers[0];
    assert.equal(netflix.id, 8);
    assert.equal(netflix.samples.length, 1);
    assert.equal(netflix.samples[0].tmdbId, 101);
    assert.equal(netflix.samples[0].posterPath, '/s1.png');
  });

  it('国区按中文名匹配爱奇艺/腾讯视频', async () => {
    clearProviderListCache();
    stubJson((url) => {
      if (url.includes('/watch/providers/movie')) {
        return {
          results: [
            { provider_id: 18, provider_name: '爱奇艺', logo_path: '/iq.png' },
            { provider_id: 22, provider_name: '腾讯视频', logo_path: '/tx.png' },
          ],
        };
      }
      return { page: 1, total_pages: 1, results: [{ id: 201, title: '国产样片', poster_path: '/d1.png' }] };
    });
    const regions = await listProviderRegions();
    const cn = regions.find((r) => r.key === 'cn');
    assert.ok(cn);
    assert.deepEqual(
      cn.providers.map((p) => p.key),
      ['iqiyi', 'tencent'],
    );
    assert.equal(cn.providers[0].samples[0].tmdbId, 201);
  });

  it('discover 条目映射为 MediaItem 分页载荷', async () => {
    stubJson(() => ({
      page: 2,
      total_pages: 5,
      results: [
        {
          id: 111,
          title: 'Dune: Part Two',
          overview: 'ok',
          poster_path: '/p.png',
          backdrop_path: '/b.png',
          release_date: '2024-02-28',
          vote_average: 8.2,
        },
        { id: 222, name: 'Some Series', first_air_date: '2023-05-01', vote_average: 7.5 },
      ],
    }));
    const payload = await discoverProviderItems({
      regionKey: 'us',
      providerId: 8,
      mediaType: 'movie',
      page: 2,
      pageSize: 40,
    });
    assert.equal(payload.page, 2);
    assert.equal(payload.totalPages, 5);
    assert.equal(payload.results.length, 2);
    assert.equal(payload.results[0].tmdbId, 111);
    assert.equal(payload.results[0].title, 'Dune: Part Two');
    assert.equal(payload.results[0].releaseDate, '2024-02-28');
  });

  it('未知地区抛 404 业务错误', async () => {
    await assert.rejects(
      () =>
        discoverProviderItems({ regionKey: 'jp', providerId: 8, mediaType: 'movie', page: 1, pageSize: 40 }),
      (err: { code?: number }) => err.code === 1004,
    );
  });
});