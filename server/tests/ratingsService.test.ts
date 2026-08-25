/**
 * ratingsService 单元测试：缓存 TTL 命中/过期回源、manual_override 不被覆盖、
 * 回源失败降级、手动修正值钳制。外部评分供应商以 mock 注入，不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, fromSqlTime, getDb, sqlNow, toSqlTime } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { setSetting } from '../src/services/settingsService';
import {
  getAggregatedRatings,
  putManualRating,
} from '../src/services/ratingsService';
import { getRatingsProvider, setRatingsProvider } from '../src/services/ratingsProvider';
import type { ProviderRating, RatingsProvider } from '../src/services/ratingsProvider';
import type { MediaType, RatingSourceKey } from '../src/types/domain';
import { ApiError } from '../src/middleware/errorHandler';

const SOURCES: RatingSourceKey[] = ['douban', 'tomato', 'popcorn'];

/** 可编程 mock：按脚本应答回源请求，并统计调用次数 */
class ScriptedProvider implements RatingsProvider {
  public calls = 0;
  public lastArgs: Array<[number, MediaType]> = [];

  constructor(private script: (tmdbId: number, mediaType: MediaType) => ProviderRating[]) {}

  async fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]> {
    this.calls += 1;
    this.lastArgs.push([tmdbId, mediaType]);
    return this.script(tmdbId, mediaType);
  }
}

function allSources(score: number | null): ProviderRating[] {
  return SOURCES.map((source) => ({
    source,
    score,
    rawText: score == null ? null : String(score),
    sourceUrl: score == null ? null : `https://example.com/${source}`,
  }));
}

function insertCacheRow(
  tmdbId: number,
  mediaType: string,
  source: string,
  score: number | null,
  expiresAt: string,
  manual = 0,
): void {
  getDb()
    .prepare(
      `INSERT INTO ratings_cache (tmdb_id, media_type, source, score, raw_text, source_url, manual_override, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, datetime('now'), ?)
       ON CONFLICT(tmdb_id, media_type, source) DO UPDATE SET
         score=excluded.score, manual_override=excluded.manual_override, expires_at=excluded.expires_at`,
    )
    .run(tmdbId, mediaType, source, score, null, manual, expiresAt);
}

describe('ratingsService · 缓存 TTL 与回源', () => {
  let provider: ScriptedProvider;
  const originalProvider = getRatingsProvider();

  before(() => {
    runMigrate();
    provider = new ScriptedProvider((_id, type) => allSources(type === 'tv' ? 8.1 : 6.6));
    setRatingsProvider(provider);
  });

  after(() => {
    setRatingsProvider(originalProvider);
    closeDb();
  });

  it('缓存缺失 → 回源一次，结果 stale=false、degraded=false', async () => {
    const agg = await getAggregatedRatings(9001, 'movie', { score: 7.5, votes: 100 });
    assert.ok(provider.calls >= 1);
    assert.equal(agg.degraded, false);
    assert.deepEqual(agg.tmdb, { score: 7.5, votes: 100 });
    for (const key of SOURCES) {
      assert.equal(agg[key].stale, false, `${key} 不应为 stale`);
      assert.equal(agg[key].manual, false);
      assert.equal(agg[key].score, 6.6);
      assert.equal(agg[key].sourceUrl, `https://example.com/${key}`);
    }
  });

  it('回源成功后写入缓存行，expires_at ≈ now + TTL（默认 72h）', () => {
    const rows = getDb()
      .prepare('SELECT * FROM ratings_cache WHERE tmdb_id = 9001 AND media_type = ?')
      .all('movie') as Array<{ source: string; expires_at: string }>;
    assert.equal(rows.length, 3);
    const nowMs = Date.now();
    for (const row of rows) {
      const diffHours = (fromSqlTime(row.expires_at).getTime() - nowMs) / 3600_000;
      assert.ok(diffHours > 70 && diffHours < 74, `expires_at 应约 72h 后，实际 ${diffHours.toFixed(2)}h`);
    }
  });

  it('TTL 内命中 → 不再回源（provider 调用数不增长）', async () => {
    const callsBefore = provider.calls;
    const agg = await getAggregatedRatings(9001, 'movie', null);
    assert.equal(provider.calls, callsBefore);
    assert.equal(agg.douban.score, 6.6);
    assert.equal(agg.degraded, false);
  });

  it('TTL 过期 → 触发回源并刷新缓存', async () => {
    const past = toSqlTime(new Date(Date.now() - 3600_000));
    insertCacheRow(9002, 'tv', 'douban', 5.0, past);
    insertCacheRow(9002, 'tv', 'tomato', 5.0, past);
    insertCacheRow(9002, 'tv', 'popcorn', 5.0, past);

    const callsBefore = provider.calls;
    const agg = await getAggregatedRatings(9002, 'tv', null);
    assert.equal(provider.calls, callsBefore + 1, '过期缓存必须触发一次回源');
    assert.equal(agg.douban.score, 8.1); // mock 按 tv 返回 8.1
    assert.equal(agg.douban.stale, false);

    const row = getDb()
      .prepare("SELECT expires_at FROM ratings_cache WHERE tmdb_id = 9002 AND source = 'douban'")
      .get() as { expires_at: string };
    assert.ok(fromSqlTime(row.expires_at).getTime() > Date.now());
  });

  it('settings 配置 TTL=24h → 刷新后的 expires_at 按 24 小时计算', async () => {
    setSetting('ratings_ttl_hours', '24');
    try {
      await getAggregatedRatings(9003, 'movie', null);
      const row = getDb()
        .prepare("SELECT expires_at FROM ratings_cache WHERE tmdb_id = 9003 AND source = 'douban'")
        .get() as { expires_at: string };
      const diffHours = (fromSqlTime(row.expires_at).getTime() - Date.now()) / 3600_000;
      assert.ok(diffHours > 22 && diffHours < 26, `expires_at 应约 24h 后，实际 ${diffHours.toFixed(2)}h`);
    } finally {
      setSetting('ratings_ttl_hours', '72');
    }
  });

  it('TTL 非法值（0 / 负数 / 非数字）时回退默认 72h', async () => {
    setSetting('ratings_ttl_hours', '-5');
    try {
      await getAggregatedRatings(9004, 'movie', null);
      const row = getDb()
        .prepare("SELECT expires_at FROM ratings_cache WHERE tmdb_id = 9004 AND source = 'douban'")
        .get() as { expires_at: string };
      const diffHours = (fromSqlTime(row.expires_at).getTime() - Date.now()) / 3600_000;
      assert.ok(diffHours > 70 && diffHours < 74);
    } finally {
      setSetting('ratings_ttl_hours', '72');
    }
  });
});

describe('ratingsService · manual_override 保护与降级', () => {
  let provider: ScriptedProvider;

  before(() => {
    runMigrate();
    // 回源永远"有数据"，用于验证它也压不过手动值
    provider = new ScriptedProvider(() => allSources(1.2));
    setRatingsProvider(provider);
  });

  after(() => {
    closeDb();
  });

  it('putManualRating 写入 manual 行，永不过期（expires_at 远期）', () => {
    const view = putManualRating(8001, 'tv', { source: 'douban', score: 9.4, raw_text: '神作' });
    assert.equal(view.manual, true);
    assert.equal(view.stale, true);
    assert.equal(view.score, 9.4);
    assert.equal(view.rawText, '神作');

    const row = getDb()
      .prepare("SELECT * FROM ratings_cache WHERE tmdb_id = 8001 AND source = 'douban'")
      .get() as { manual_override: number; expires_at: string };
    assert.equal(row.manual_override, 1);
    assert.ok(row.expires_at.startsWith('9999'));
  });

  it('回源成功也不覆盖 manual 行；其余源正常刷新', async () => {
    const callsBefore = provider.calls;
    const agg = await getAggregatedRatings(8001, 'tv', null);
    assert.equal(provider.calls, callsBefore + 1, 'tomato/popcorn 缺失应触发回源');

    assert.equal(agg.douban.manual, true, 'manual 标志必须保留');
    assert.equal(agg.douban.score, 9.4, '手动分值不得被回源值(1.2)覆盖');
    assert.ok(agg.douban.stale === true || agg.douban.stale === false);

    assert.equal(agg.tomato.score, 1.2);
    assert.equal(agg.tomato.manual, false);
    assert.equal(agg.popcorn.score, 1.2);

    const row = getDb()
      .prepare("SELECT manual_override, score FROM ratings_cache WHERE tmdb_id = 8001 AND source = 'douban'")
      .get() as { manual_override: number; score: number };
    assert.equal(row.manual_override, 1);
    assert.equal(row.score, 9.4);
  });

  it('回源失败（全 null）→ degraded=true；manual 行作为兜底保留且 stale=true', async () => {
    // ScriptedProvider 的 script 为构造参数，这里注入新的失败实例
    const failing = new ScriptedProvider(() => allSources(null));
    setRatingsProvider(failing);

    const agg = await getAggregatedRatings(8002, 'movie', null);
    assert.equal(agg.degraded, true);
    assert.equal(agg.douban.score, null);
    assert.equal(agg.douban.stale, true);

    // 为 8002/movie/douban 先写一个手动值再验证兜底
    putManualRating(8002, 'movie', { source: 'tomato', score: 7.0 });
    const agg2 = await getAggregatedRatings(8002, 'movie', null);
    assert.equal(agg2.degraded, true);
    assert.equal(agg2.tomato.manual, true);
    assert.equal(agg2.tomato.score, 7.0);
    assert.equal(agg2.tomato.stale, true);
    assert.equal(agg2.popcorn.score, null, '无缓存的源应返回空值');
  });

  it('putManualRating 分值钳制到 [0,10] 并四舍五入到 1 位小数', () => {
    assert.equal(putManualRating(8100, 'movie', { source: 'popcorn', score: 15 }).score, 10);
    assert.equal(putManualRating(8100, 'movie', { source: 'popcorn', score: -3 }).score, 0);
    assert.equal(putManualRating(8100, 'movie', { source: 'popcorn', score: 8.46 }).score, 8.5);
    assert.equal(putManualRating(8100, 'movie', { source: 'popcorn', score: Number.NaN }).score, null);
  });

  it('putManualRating 无分值时 rawText 回退为分值字符串或 null', () => {
    const withScore = putManualRating(8101, 'movie', { source: 'douban', score: 6 });
    assert.equal(withScore.rawText, '6');
    const noScore = putManualRating(8102, 'movie', { source: 'douban', score: null });
    assert.equal(noScore.rawText, null);
  });

  it('putManualRating 拒绝非法评分源：1001 / 400', () => {
    assert.throws(
      () => putManualRating(8103, 'movie', { source: 'imdb' as RatingSourceKey, score: 5 }),
      (e: unknown) => e instanceof ApiError && e.code === 1001 && e.httpStatus === 400,
    );
  });

  it('provider 抛异常也被兜住，走降级路径而非中断', async () => {
    const throwing = new ScriptedProvider(() => {
      throw new Error('network down');
    });
    setRatingsProvider(throwing);
    const agg = await getAggregatedRatings(8200, 'tv', null);
    assert.equal(agg.degraded, true);
    assert.equal(agg.douban.score, null);
  });
});

describe('db · 时间工具函数', () => {
  it('toSqlTime/fromSqlTime 往返一致（UTC 秒级精度）', () => {
    const d = new Date('2025-06-01T12:34:56.789Z');
    const s = toSqlTime(d);
    assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(fromSqlTime(s).toISOString(), '2025-06-01T12:34:56.000Z');
  });

  it('sqlNow 与 SQLite datetime(\'now\') 字典序可比', () => {
    const now = sqlNow();
    assert.ok(now < toSqlTime(new Date(Date.now() + 60_000)));
    assert.ok(now > toSqlTime(new Date(Date.now() - 60_000)));
  });
});
