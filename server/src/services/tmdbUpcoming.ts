/**
 * 「即将上映」数据源：/3/movie/upcoming（region 不指定）+ /3/tv/on_the_air 合并，
 * 过滤 release_date 在今天 ~ 90 天内且非空，按日期升序取前 limit 条。
 * 复用 tmdbService 的请求封装与条目映射。
 */

import { tmdbGet, mapMediaItem } from './tmdbService';
import type { MediaItem } from '../types/domain';

/** 过滤窗口：今天 ~ 90 天 */
const WINDOW_DAYS = 90;

interface UpcomingPage {
  results?: Array<{
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
  }>;
  total_pages?: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 拉取即将上映/在播内容。两个源各取第 1 页（各约 20 条），
 * 合并过滤后通常足以填满 limit；不足时按实际数量返回，不强行翻页。
 */
export async function fetchUpcoming(limit = 10): Promise<MediaItem[]> {
  const [movies, shows] = await Promise.all([
    tmdbGet<UpcomingPage>('/movie/upcoming', { language: 'zh-CN', page: '1' }),
    tmdbGet<UpcomingPage>('/tv/on_the_air', { language: 'zh-CN', page: '1' }),
  ]);

  const start = todayStr();
  const end = addDays(start, WINDOW_DAYS);
  const merged = [
    ...(movies.results ?? []).map((r) => mapMediaItem({ ...r, media_type: 'movie' }, 'movie')),
    ...(shows.results ?? []).map((r) => mapMediaItem({ ...r, media_type: 'tv' }, 'tv')),
  ].filter((item) => {
    const d = item.releaseDate;
    return typeof d === 'string' && d.length === 10 && d >= start && d <= end;
  });

  merged.sort(
    (a, b) =>
      (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '') || a.tmdbId - b.tmdbId,
  );
  return merged.slice(0, Math.max(1, limit));
}
