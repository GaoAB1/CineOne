/**
 * TMDB API 封装：home 聚合 / search / detail / 图片拼接。
 * 所有外部请求带 8s 超时；Key 未配置抛 2001，请求失败抛 2002。
 */

import { ApiError } from '../middleware/errorHandler';
import {
  hasTmdbApiKey,
  getSetting,
} from './settingsService';
import type {
  DetailPayload,
  HomeSection,
  MediaItem,
  MediaType,
} from '../types/domain';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = 8000;
/** external_ids 属评分链路的旁路请求，超时更短以便快速降级 */
const EXTERNAL_IDS_TIMEOUT_MS = 6000;

interface ExternalIdsResponse {
  imdb_id?: string | null;
}

/**
 * 获取 TMDB 条目的外部 ID（当前仅消费 imdb_id），供评分链路做 OMDb 映射。
 * 与主链路不同：本函数用于旁路补数据，任何失败（未配 Key / HTTP 非 2xx /
 * 网络错误或超时 / 无 imdb_id）一律返回 null，由调用方整体降级，绝不抛出。
 */
export async function fetchExternalIds(
  tmdbId: number,
  mediaType: MediaType,
): Promise<string | null> {
  if (!hasTmdbApiKey()) return null;
  const url = new URL(`${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids`);
  url.searchParams.set('api_key', getSetting('tmdb_api_key').trim());
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(EXTERNAL_IDS_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ExternalIdsResponse;
    const imdb = typeof body.imdb_id === 'string' ? body.imdb_id.trim() : '';
    return imdb.length > 0 ? imdb : null;
  } catch {
    return null;
  }
}

/** 图片 URL 拼接（浏览器直连 CDN，不经后端代理） */
export function tmdbImage(path: string | null | undefined, size: string): string | undefined {
  if (!path) return undefined;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

interface TmdbListResult {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  vote_average?: number | null;
  genre_ids?: number[];
  media_type?: string;
}

/** 统一把 TMDB 列表条目映射为 MediaItem */
function mapMediaItem(raw: TmdbListResult, fallbackType: MediaType): MediaItem {
  const mediaType: MediaType =
    raw.media_type === 'movie' || raw.media_type === 'tv'
      ? raw.media_type
      : fallbackType;
  const date = raw.release_date || raw.first_air_date || undefined;
  return {
    tmdbId: raw.id,
    mediaType,
    title: raw.title || raw.name || '未知标题',
    overview: raw.overview || undefined,
    posterPath: raw.poster_path ?? undefined,
    backdropPath: raw.backdrop_path ?? undefined,
    releaseDate: date && date.length > 0 ? date : undefined,
    voteAverage: typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : undefined,
    genreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids : undefined,
  };
}

async function tmdbGet<T>(pathName: string, params: Record<string, string>): Promise<T> {
  if (!hasTmdbApiKey()) {
    throw new ApiError(2001, 'TMDB API Key 未配置，请先在设置页配置', 428);
  }
  const url = new URL(`${TMDB_BASE}${pathName}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('api_key', getSetting('tmdb_api_key').trim());
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new ApiError(2002, `TMDB 请求失败（HTTP ${res.status}），请检查 Key 是否有效`, 502);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(2002, 'TMDB 请求失败（网络错误或超时）', 502);
  }
}

interface ListResponse {
  results: TmdbListResult[];
  total_pages?: number;
}

/** 主页四大分区聚合；经典 = top_rated 且上映年份 ≥10 年 */
export async function getHomeSections(windowParam: string): Promise<HomeSection[]> {
  const window = windowParam === 'day' ? 'day' : 'week';
  const [nowPlaying, onAir, trending, topRated] = await Promise.all([
    tmdbGet<ListResponse>('/movie/now_playing', { language: 'zh-CN', page: '1' }),
    tmdbGet<ListResponse>('/tv/on_the_air', { language: 'zh-CN', page: '1' }),
    tmdbGet<ListResponse>(`/trending/all/${window}`, { language: 'zh-CN' }),
    tmdbGet<ListResponse>('/movie/top_rated', { language: 'zh-CN', page: '1' }),
  ]);

  // 经典分区：过滤上映年份距今 ≥10 年
  const cutoffYear = new Date().getFullYear() - 10;
  const classics = topRated.results
    .filter((r) => {
      const date = r.release_date || r.first_air_date || '';
      const year = Number.parseInt(date.slice(0, 4), 10);
      return Number.isFinite(year) && year <= cutoffYear;
    })
    .slice(0, 20)
    .map((r) => mapMediaItem(r, 'movie'));

  return [
    {
      key: 'now_playing',
      title: '新上电影',
      items: nowPlaying.results.map((r) => mapMediaItem(r, 'movie')),
    },
    {
      key: 'on_the_air',
      title: '新上剧集',
      items: onAir.results.map((r) => mapMediaItem(r, 'tv')),
    },
    {
      key: 'trending',
      title: `热门本周`,
      items: trending.results.map((r) => mapMediaItem(r, 'movie')),
    },
    {
      key: 'classics',
      title: '经典佳片',
      items: classics,
    },
  ];
}

/** 全局搜索（multi），仅保留 movie/tv */
export async function searchMulti(q: string, page: number): Promise<{
  page: number;
  results: MediaItem[];
  total_pages: number;
}> {
  const data = await tmdbGet<ListResponse>('/search/multi', {
    language: 'zh-CN',
    query: q,
    page: String(Math.max(1, page)),
    include_adult: 'false',
  });
  const results = data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => mapMediaItem(r, r.media_type === 'tv' ? 'tv' : 'movie'));
  return {
    page: Math.max(1, page),
    results,
    total_pages: data.total_pages ?? 1,
  };
}

interface DetailResponse {
  id: number;
  title?: string;
  name?: string;
  tagline?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  genre_ids?: number[];
  vote_average?: number | null;
  vote_count?: number | null;
  number_of_seasons?: number;
  seasons?: { season_number: number; episode_count: number; name: string }[];
  credits?: {
    cast?: { name: string; character?: string; profile_path?: string | null }[];
    crew?: { name: string; job: string }[];
  };
}

/** 详情（含演职员与季列表）；TMDB 评分实时返回，不入缓存表 */
export async function getDetail(type: MediaType, id: number): Promise<DetailPayload> {
  const append = type === 'movie' ? 'credits' : 'credits';
  const raw = await tmdbGet<DetailResponse>(`/${type}/${id}`, {
    language: 'zh-CN',
    append_to_response: append,
  });

  const base = mapMediaItem(
    {
      ...raw,
      title: raw.title,
      name: raw.name,
      release_date: raw.release_date,
      first_air_date: raw.first_air_date,
      media_type: type,
      genre_ids: raw.genres?.map((g) => g.id),
    },
    type,
  );

  const detail: DetailPayload = {
    ...base,
    runtime:
      type === 'movie'
        ? (raw.runtime ?? undefined)
        : (raw.episode_run_time?.[0] ?? undefined),
    genres: (raw.genres ?? []).map((g) => ({ id: g.id, name: g.name })),
    cast: (raw.credits?.cast ?? []).slice(0, 12).map((c) => ({
      name: c.name,
      character: c.character || undefined,
      profilePath: c.profile_path ?? undefined,
    })),
    crew: (raw.credits?.crew ?? [])
      .filter((c: { name: string; job: string }) =>
        ['Director', 'Screenplay', 'Writer', 'Creator'].includes(c.job),
      )
      .slice(0, 6)
      .map((c: { name: string; job: string }) => ({ name: c.name, job: c.job })),
    numberOfSeasons: type === 'tv' ? raw.number_of_seasons : undefined,
    seasons:
      type === 'tv'
        ? (raw.seasons ?? [])
            .filter((s) => s.season_number > 0)
            .map((s) => ({
              seasonNumber: s.season_number,
              episodeCount: s.episode_count,
            }))
        : undefined,
    voteAverage:
      typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : 0,
  };
  return detail;
}
