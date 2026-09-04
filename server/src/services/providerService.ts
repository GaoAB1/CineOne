/**
 * TMDB Watch Providers 平台分组服务（首页“流媒体平台”入口卡 + 平台浏览页）：
 *  - listProviderRegions：按地区（US/CN）从 /watch/providers 拉取平台列表，
 *    用名称别名模糊匹配出目标平台（Netflix / Apple TV+ / Prime / Disney+ / Hulu / Max，
 *    国区爱奇艺 / 腾讯视频 / 优酷 / 芒果TV / 哔哩哔哩），带平台 Logo 与稳定 id；
 *  - discoverProviderItems：/discover/{movie|tv}?watch_region&with_watch_providers 分页拉条目。
 * 平台列表带 6 小时内存缓存，条目浏览不缓存（实时，配合路由限流）。
 */

import { ApiError } from '../middleware/errorHandler';
import { tmdbGet, tmdbImage, mapMediaItem } from './tmdbService';
import type { MediaItem, MediaType } from '../types/domain';

interface ProviderTarget {
  key: string;
  /** 规范化（小写去空格）后的候选名 */
  aliases: string[];
}

interface RegionDef {
  key: 'us' | 'cn';
  label: string;
  targets: ProviderTarget[];
}

const REGION_DEFS: RegionDef[] = [
  {
    key: 'us',
    label: '美区',
    targets: [
      { key: 'netflix', aliases: ['netflix'] },
      { key: 'apple-tv', aliases: ['apple tv+', 'appletv+', 'apple tv'] },
      { key: 'prime', aliases: ['prime video', 'amazon prime video', 'amazon prime'] },
      { key: 'disney', aliases: ['disney+', 'disney plus', 'disneyplus', 'disney'] },
      { key: 'hulu', aliases: ['hulu'] },
      { key: 'max', aliases: ['max', 'hbo max'] },
    ],
  },
  {
    key: 'cn',
    label: '国区',
    targets: [
      { key: 'iqiyi', aliases: ['爱奇艺', 'iqiyi'] },
      { key: 'tencent', aliases: ['腾讯视频', 'tencent video', 'tencent'] },
      { key: 'youku', aliases: ['优酷', 'youku'] },
      { key: 'mango', aliases: ['芒果tv', '芒果', 'mango tv', 'mango'] },
      { key: 'bilibili', aliases: ['哔哩哔哩', 'bilibili', 'b站'] },
    ],
  },
];

export interface ProviderEntry {
  /** 稳定逻辑键（netflix/apple-tv/…，用于前端路由） */
  key: string;
  id: number;
  name: string;
  logoPath: string | null;
}

export interface ProviderRegionGroup {
  key: 'us' | 'cn';
  label: string;
  providers: ProviderEntry[];
}

export interface ProviderPagePayload {
  page: number;
  totalPages: number;
  results: MediaItem[];
}

interface TmdbProviderItem {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
  display_priority?: number;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 列表缓存：<regionKey, {ts, group}>，TTL 6 小时 */
const listCache = new Map<string, { ts: number; group: ProviderRegionGroup }>();
const LIST_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchRegionGroup(region: RegionDef): Promise<ProviderRegionGroup> {
  const cached = listCache.get(region.key);
  if (cached && Date.now() - cached.ts < LIST_TTL_MS) return cached.group;

  const data = await tmdbGet<{ results?: TmdbProviderItem[] }>(
    '/watch/providers/movie',
    { watch_region: region.key.toUpperCase() },
  );
  const all = data.results ?? [];
  const providers: ProviderEntry[] = [];
  for (const target of region.targets) {
    const hit = all.find((p) => {
      const name = typeof p.provider_name === 'string' ? p.provider_name : '';
      return target.aliases.includes(normalize(name));
    });
    if (hit && typeof hit.provider_id === 'number') {
      providers.push({
        key: target.key,
        id: hit.provider_id,
        name: hit.provider_name ?? target.key,
        logoPath: tmdbImage(hit.logo_path, 'w92') ?? null,
      });
    }
  }
  const group: ProviderRegionGroup = { key: region.key, label: region.label, providers };
  listCache.set(region.key, { ts: Date.now(), group });
  return group;
}

/** 全部地区平台组（首页平台入口卡数据源） */
export async function listProviderRegions(): Promise<ProviderRegionGroup[]> {
  return Promise.all(REGION_DEFS.map((region) => fetchRegionGroup(region)));
}

export function providerRegionDefs(): RegionDef[] {
  return REGION_DEFS;
}

/** 清空平台列表缓存（单元测试 / 平台列表刷新时使用） */
export function clearProviderListCache(): void {
  listCache.clear();
}

/**
 * 平台浏览分页：discover 该平台可看内容。
 * @param mediaType movie | tv
 */
export async function discoverProviderItems(opts: {
  regionKey: string;
  providerId: number;
  mediaType: MediaType;
  page: number;
  pageSize: number;
}): Promise<ProviderPagePayload> {
  const def = REGION_DEFS.find((r) => r.key === opts.regionKey);
  if (!def) throw new ApiError(1004, `未知的地区：${opts.regionKey}`, 404);
  const mediaType = opts.mediaType === 'tv' ? 'tv' : 'movie';
  const params: Record<string, string> = {
    language: 'zh-CN',
    watch_region: def.key.toUpperCase(),
    with_watch_providers: String(opts.providerId),
    sort_by: 'popularity.desc',
    page: String(Math.max(1, opts.page)),
  };
  if (mediaType === 'movie') params.with_monetization_types = 'flatrate';

  const data = await tmdbGet<{ page?: number; total_pages?: number; results?: Array<Record<string, unknown> & { media_type?: string }> }>(
    `/discover/${mediaType}`,
    params,
  );
  const rawItems = data.results ?? [];
  const results = rawItems
    .filter((r) => r.title || r.name)
    .map((r) =>
      mapMediaItem(
        {
          id: Number(r.id),
          title: typeof r.title === 'string' ? r.title : undefined,
          name: typeof r.name === 'string' ? r.name : undefined,
          overview: typeof r.overview === 'string' ? r.overview : undefined,
          poster_path: typeof r.poster_path === 'string' ? r.poster_path : undefined,
          backdrop_path: typeof r.backdrop_path === 'string' ? r.backdrop_path : undefined,
          release_date: typeof r.release_date === 'string' ? r.release_date : undefined,
          first_air_date: typeof r.first_air_date === 'string' ? r.first_air_date : undefined,
          vote_average: typeof r.vote_average === 'number' ? r.vote_average : undefined,
          media_type: mediaType,
        },
        mediaType,
      ),
    );
  return {
    page: typeof data.page === 'number' ? data.page : 1,
    totalPages: typeof data.total_pages === 'number' ? Math.min(500, data.total_pages) : 1,
    results,
  };
}
