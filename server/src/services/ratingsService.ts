/**
 * 评分聚合编排：缓存判定 → 回源 → 手动兜底。
 * TMDB 评分始终实时（由 tmdbService 提供，不入缓存表）；
 * 豆瓣/烂番茄/爆米花走 ratings_cache：TTL 内命中直接返回，
 * 过期/缺失则回源第三方聚合接口；回源失败回退手动修正值或空值。
 */

import { getDb, sqlNow, toSqlTime, fromSqlTime } from '../db/database';
import { getSetting } from './settingsService';
import { getRatingsProvider } from './ratingsProvider';
import type {
  MediaType,
  RatingSource,
  RatingSourceKey,
} from '../types/domain';
import { ApiError } from '../middleware/errorHandler';

const MANUAL_EXPIRES_AT = '9999-12-31 00:00:00';

interface CacheRow {
  id: number;
  tmdb_id: number;
  media_type: string;
  source: string;
  score: number | null;
  raw_text: string | null;
  source_url: string | null;
  manual_override: number;
  fetched_at: string;
  expires_at: string;
}

function emptySource(stale: boolean): RatingSource {
  return { score: null, rawText: null, sourceUrl: null, stale, manual: false };
}

/** TTL（小时），settings 可配，默认 72 */
function ttlHours(): number {
  const parsed = Number.parseInt(getSetting('ratings_ttl_hours'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}

export interface RatingsAggregate {
  tmdb: unknown | null;
  douban: RatingSource;
  tomato: RatingSource;
  popcorn: RatingSource;
  /** 任一外部源本次降级（回源失败且无手动兜底） */
  degraded: boolean;
}

/**
 * 查询四源评分。tmdb 字段由路由层从详情实时取得后填入，
 * 本函数只负责三个第三方源的聚合。
 */
export async function getAggregatedRatings(
  tmdbId: number,
  mediaType: MediaType,
  tmdbRating: { score: number; votes: number } | null,
): Promise<RatingsAggregate> {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT * FROM ratings_cache WHERE tmdb_id = ? AND media_type = ?',
    )
    .all(tmdbId, mediaType) as CacheRow[];

  const bySource = new Map<string, CacheRow>();
  for (const row of rows) bySource.set(row.source, row);

  const nowStr = sqlNow();
  const result: Record<RatingSourceKey, RatingSource> = {
    douban: emptySource(false),
    tomato: emptySource(false),
    popcorn: emptySource(false),
  };

  // 判定哪些非 manual 源需要回源
  const needRefresh: RatingSourceKey[] = [];
  for (const key of ['douban', 'tomato', 'popcorn'] as RatingSourceKey[]) {
    const row = bySource.get(key);
    if (!row || (row.manual_override === 0 && row.expires_at <= nowStr)) {
      needRefresh.push(key);
      continue;
    }
    const manual = row.manual_override === 1;
    result[key] = {
      score: row.score,
      rawText: row.raw_text,
      sourceUrl: row.source_url,
      stale: manual || row.expires_at <= nowStr,
      manual,
    };
  }

  let degraded = false;
  if (needRefresh.length > 0) {
    // getRatingsProvider() 返回 RatingsProvider 实例（工厂→单例）
    type ProviderFetchResult = Awaited<ReturnType<ReturnType<typeof getRatingsProvider>['fetchRatings']>>;
    let providerRatings: ProviderFetchResult | null = null;
    try {
      providerRatings = await getRatingsProvider().fetchRatings(tmdbId, mediaType);
    } catch {
      providerRatings = null; // provider 契约上不抛错，这里再兜一层
    }

    if (providerRatings && providerRatings.some((r) => r.score != null)) {
      // 回源成功 → UPSERT 非 manual 行
      const expiresAt = toSqlTime(new Date(Date.now() + ttlHours() * 3600_000));
      const upsert = db.prepare(
        `INSERT INTO ratings_cache (tmdb_id, media_type, source, score, raw_text, source_url, manual_override, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(tmdb_id, media_type, source) DO UPDATE SET
           score = excluded.score,
           raw_text = excluded.raw_text,
           source_url = excluded.source_url,
           manual_override = 0,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at
         WHERE ratings_cache.manual_override = 0`,
      );
      const writeAll = db.transaction(() => {
        for (const pr of providerRatings!) {
          upsert.run(tmdbId, mediaType, pr.source, pr.score, pr.rawText, pr.sourceUrl, nowStr, expiresAt);
        }
      });
      writeAll();
      // 重新读取以获得权威行状态
      for (const key of needRefresh) {
        const fresh = bySource.get(key);
        void fresh;
        const updated = db
          .prepare(
            'SELECT * FROM ratings_cache WHERE tmdb_id=? AND media_type=? AND source=?',
          )
          .get(tmdbId, mediaType, key) as CacheRow | undefined;
        if (updated) {
          result[key] = {
            score: updated.score,
            rawText: updated.raw_text,
            sourceUrl: updated.source_url,
            stale: false,
            manual: false,
          };
        }
      }
    } else {
      // 回源失败/查无数据 → 手动兜底或空值
      degraded = true;
      for (const key of needRefresh) {
        const row = bySource.get(key);
        if (row && row.manual_override === 1) {
          result[key] = {
            score: row.score,
            rawText: row.raw_text,
            sourceUrl: row.source_url,
            stale: true,
            manual: true,
          };
        } else {
          result[key] = emptySource(true); // 前端渲染"暂无"
        }
      }
    }
  }

  return {
    tmdb: tmdbRating,
    douban: result.douban,
    tomato: result.tomato,
    popcorn: result.popcorn,
    degraded,
  };
}

/** 管理员手动修正：写入 manual_override=1，永不被回源覆盖 */
export function putManualRating(
  tmdbId: number,
  mediaType: MediaType,
  input: { source: RatingSourceKey; score: number | null; raw_text?: string | null },
): RatingSource {
  const allowed: RatingSourceKey[] = ['douban', 'tomato', 'popcorn'];
  if (!allowed.includes(input.source)) {
    throw new ApiError(1001, `非法的评分源：${input.source}`, 400);
  }
  const score =
    typeof input.score === 'number' && Number.isFinite(input.score)
      ? Math.min(10, Math.max(0, Math.round(input.score * 10) / 10))
      : null;
  const db = getDb();
  db.prepare(
    `INSERT INTO ratings_cache (tmdb_id, media_type, source, score, raw_text, source_url, manual_override, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)
     ON CONFLICT(tmdb_id, media_type, source) DO UPDATE SET
       score = excluded.score,
       raw_text = excluded.raw_text,
       manual_override = 1,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
  ).run(tmdbId, mediaType, input.source, score, input.raw_text ?? null, sqlNow(), MANUAL_EXPIRES_AT);

  return {
    score,
    rawText: input.raw_text ?? (score != null ? String(score) : null),
    sourceUrl: null,
    stale: true,
    manual: true,
  };
}

// 保持 fromSqlTime 引用（供未来过期清理任务使用）
export { fromSqlTime };
