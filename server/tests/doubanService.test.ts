/**
 * doubanService 单元测试：开关关闭、匹配排序、缓存命中/未命中、降级。
 * 豆瓣网络请求以 globalThis.fetch mock 注入，不发真实请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { setSetting } from '../src/services/settingsService';
import {
  normalizeTitle,
  pickBestSuggestion,
  resolveDoubanLink,
  seasonIndexOf,
  type DoubanSuggestion,
} from '../src/services/doubanService';

type FetchHandler = (url: string) => { ok: boolean; text: () => Promise<string> };

const originalFetch = globalThis.fetch;
let fetchHandler: FetchHandler | null = null;

before(() => {
  runMigrate();
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (!fetchHandler) throw new Error('test fetch stub not configured');
    return fetchHandler(String(input)) as unknown as Response;
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  closeDb();
});

function stubDouban(payload: string): void {
  fetchHandler = () => ({ ok: true, text: async () => payload });
}

function stubFailing(): void {
  fetchHandler = () => ({ ok: true, text: async () => '<!DOCTYPE html><title>验证码</title>' });
}

function suggest(partial: Partial<DoubanSuggestion> & { title: string }): DoubanSuggestion {
  return { id: '1000001', year: '2020', type: 'movie', url: 'x', ...partial };
}

const DB_KEYS = { tmdbId: 987654, mediaType: 'movie' } as const;

describe('doubanService 基础工具', () => {
  it('normalizeTitle 去空白/标点并小写', () => {
    assert.equal(normalizeTitle('阿凡达：水之道 (2009)'), '阿凡达水之道2009');
    assert.equal(normalizeTitle('  Avatar: The Way   '), 'avatartheway');
  });

  it('seasonIndexOf 识别中文季与 Season N', () => {
    assert.equal(seasonIndexOf('绝命毒师 第一季'), 1);
    assert.equal(seasonIndexOf('绝命毒师 第五季'), 5);
    assert.equal(seasonIndexOf('Stranger Things Season 3'), 3);
    assert.equal(seasonIndexOf('普通标题'), 0);
  });
});

describe('pickBestSuggestion 匹配排序', () => {
  const base = { tmdbId: 1, mediaType: 'movie' as const, title: '阿凡达', year: 2009 };

  it('同年代版本优先年份命中', () => {
    const items = [
      suggest({ title: '阿凡达：火与烬', year: '2025' }),
      suggest({ title: '阿凡达', year: '2009', id: '1292052' }),
    ];
    const best = pickBestSuggestion(items, base);
    assert.equal(best?.id, '1292052');
  });

  it('电视剧命中同年首季优先于后续季', () => {
    const items = [
      suggest({ title: '绝命毒师 第五季', year: '2012' }),
      suggest({ title: '绝命毒师 第一季', year: '2008', id: '2373195' }),
      suggest({ title: '绝命毒师 第二季', year: '2009' }),
    ];
    const best = pickBestSuggestion(items, { ...base, mediaType: 'tv', title: '绝命毒师', year: 2008 });
    assert.equal(best?.id, '2373195');
  });

  it('完全无关的结果返回 null（不硬猜）', () => {
    const items = [suggest({ title: '海贼王', year: '1999' })];
    assert.equal(pickBestSuggestion(items, base), null);
  });
});

describe('resolveDoubanLink', () => {
  it('douban_search_enabled=0 时 disabled 且不请求', async () => {
    setSetting('douban_search_enabled', '0');
    fetchHandler = () => {
      throw new Error('不应发起豆瓣请求');
    };
    const out = await resolveDoubanLink({ ...DB_KEYS, title: '阿凡达', year: 2009 });
    assert.equal(out.disabled, true);
    assert.equal(out.subjectUrl, null);
    assert.equal(out.degraded, false);
  });

  it('实查命中写缓存，二次查询走 cache 不再外呼', async () => {
    setSetting('douban_search_enabled', '1');
    let calls = 0;
    fetchHandler = () => {
      calls += 1;
      return {
        ok: true,
        text: async () =>
          JSON.stringify([
            { id: '1292052', title: '阿凡达', year: '2009', type: 'movie' },
            { id: '5348089', title: '阿凡达：火与烬', year: '2025', type: 'movie' },
          ]),
      };
    };
    const first = await resolveDoubanLink({ ...DB_KEYS, title: '阿凡达', year: 2009 });
    assert.equal(first.source, 'douban');
    assert.equal(first.subjectUrl, 'https://movie.douban.com/subject/1292052/');
    assert.equal(calls, 1);

    const second = await resolveDoubanLink({ ...DB_KEYS, title: '阿凡达', year: 2009 });
    assert.equal(second.source, 'cache');
    assert.equal(second.subjectUrl, 'https://movie.douban.com/subject/1292052/');
    assert.equal(calls, 1); // 未再外呼
  });

  it('豆瓣返回非 JSON（验证码页）→ degraded 且不写缓存', async () => {
    stubFailing();
    const tmdbId = 555555;
    const out = await resolveDoubanLink({ tmdbId, mediaType: 'movie', title: '某片' });
    assert.equal(out.degraded, true);
    assert.equal(out.subjectUrl, null);
    const row = getDb()
      .prepare('SELECT subject_url FROM douban_resolve_cache WHERE tmdb_id=? AND media_type=?')
      .get(tmdbId, 'movie') as { subject_url: string | null } | undefined;
    assert.equal(row, undefined); // 降级不落缓存
  });

  it('未命中同样缓存 7 天，避免反复外呼', async () => {
    stubDouban(JSON.stringify([{ id: '999', title: '海贼王', year: '1999', type: 'movie' }]));
    const tmdbId = 444444;
    const miss = await resolveDoubanLink({ tmdbId, mediaType: 'movie', title: '阿凡达', year: 2009 });
    assert.equal(miss.subjectUrl, null);
    assert.equal(miss.source, 'douban');
    fetchHandler = () => {
      throw new Error('未命中缓存应阻止二次外呼');
    };
    const again = await resolveDoubanLink({ tmdbId, mediaType: 'movie', title: '阿凡达', year: 2009 });
    assert.equal(again.source, 'cache');
    assert.equal(again.subjectUrl, null);
  });
});
