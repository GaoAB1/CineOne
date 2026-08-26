/**
 * 追剧播出日历：watchlist 中 status='watching' 且 media_type='tv' 的剧集
 * → TMDB 拉取集表 → 收集未来 60 天内的待播集，按 airDate 升序。
 * 内存缓存 1 小时；settings 键 calendar_last_sync 记录最近一次成功刷新时间。
 * 单部剧回源失败跳过，不阻断整个日历；TMDB Key 未配置抛 2001（HTTP 428）。
 */

import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import { hasTmdbApiKey, setSetting } from './settingsService';
import { tmdbGet } from './tmdbService';

const CACHE_TTL_MS = 3600_000;
/** 只收集未来 60 天内的待播集 */
const WINDOW_DAYS = 60;

export interface CalendarEpisode {
  tmdbId: number;
  title: string;
  season: number;
  episode: number;
  /** yyyy-MM-dd */
  airDate: string;
  posterPath?: string;
}

export interface CalendarPayload {
  items: CalendarEpisode[];
  lastRefresh: string | null;
}

interface EpisodeRef {
  season_number?: number;
  episode_number?: number;
  air_date?: string | null;
}

interface TvBrief {
  number_of_seasons?: number;
  next_episode_to_air?: EpisodeRef | null;
}

interface SeasonEpisodes {
  episodes?: EpisodeRef[];
}

let cache: { expiresAt: number; payload: CalendarPayload } | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function windowEnd(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * 单部剧：从下一集所在季开始拉集表（存在下一季则一并拉取，覆盖跨季边界）。
 * 返回该剧中所有带有效播出日的集；单季请求失败仅跳过该季。
 */
async function collectShowEpisodes(
  tmdbId: number,
): Promise<Array<{ season: number; episode: number; airDate: string }>> {
  const brief = await tmdbGet<TvBrief>(`/tv/${tmdbId}`, { language: 'zh-CN' });
  const next = brief.next_episode_to_air;
  const nextSeason = next?.season_number;
  if (
    !next ||
    typeof next.air_date !== 'string' ||
    !Number.isInteger(nextSeason)
  ) {
    return []; // 已完结或无排期
  }
  const seasonNumber0 = nextSeason as number;
  const seasons = new Set<number>([seasonNumber0]);
  if (Number.isInteger(brief.number_of_seasons) && brief.number_of_seasons! > seasonNumber0) {
    seasons.add(seasonNumber0 + 1);
  }

  const out: Array<{ season: number; episode: number; airDate: string }> = [];
  for (const seasonNumber of seasons) {
    try {
      const season = await tmdbGet<SeasonEpisodes>(
        `/tv/${tmdbId}/season/${seasonNumber}`,
        { language: 'zh-CN' },
      );
      for (const ep of season.episodes ?? []) {
        const episodeNumber = ep.episode_number;
        if (
          typeof ep.air_date === 'string' &&
          ep.air_date.length === 10 &&
          Number.isInteger(episodeNumber)
        ) {
          out.push({ season: seasonNumber, episode: episodeNumber as number, airDate: ep.air_date });
        }
      }
    } catch {
      // 单季失败跳过，不阻断
    }
  }
  return out;
}

async function buildCalendar(): Promise<CalendarPayload> {
  if (!hasTmdbApiKey()) {
    throw new ApiError(2001, 'TMDB API Key 未配置，请先在设置页配置', 428);
  }
  const db = getDb();
  const shows = db
    .prepare(
      `SELECT tmdb_id, MAX(title) AS title, MAX(poster_path) AS poster_path
       FROM watchlist WHERE status = 'watching' AND media_type = 'tv'
       GROUP BY tmdb_id`,
    )
    .all() as Array<{ tmdb_id: number; title: string; poster_path: string | null }>;

  const start = todayStr();
  const end = windowEnd(start);
  const items: CalendarEpisode[] = [];
  for (const show of shows) {
    try {
      for (const ep of await collectShowEpisodes(show.tmdb_id)) {
        if (ep.airDate >= start && ep.airDate <= end) {
          items.push({
            tmdbId: show.tmdb_id,
            title: show.title,
            season: ep.season,
            episode: ep.episode,
            airDate: ep.airDate,
            posterPath: show.poster_path ?? undefined,
          });
        }
      }
    } catch {
      // 单部剧回源失败跳过，不阻断整个日历
    }
  }

  items.sort(
    (a, b) =>
      a.airDate.localeCompare(b.airDate) ||
      a.tmdbId - b.tmdbId ||
      a.season - b.season ||
      a.episode - b.episode,
  );

  const nowStr = sqlNow();
  setSetting('calendar_last_sync', nowStr);
  return { items, lastRefresh: nowStr };
}

/**
 * 获取播出日历。内存缓存 TTL 1 小时；options.refresh=true 强制回源
 * （对应前端"手动刷新"按钮）。
 */
export async function getCalendar(options?: { refresh?: boolean }): Promise<CalendarPayload> {
  if (!options?.refresh && cache && Date.now() < cache.expiresAt) {
    return cache.payload;
  }
  const payload = await buildCalendar();
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  return payload;
}
