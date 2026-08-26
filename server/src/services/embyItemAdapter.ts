/**
 * Emby 条目 → 本地模型适配器：字段映射 + 播放状态解析。
 * 无 Tmdb 映射的条目返回 null，由调用方跳过并计数。
 */

import type { MediaType } from '../types/domain';

/** Emby /Users/{id}/Items 返回条目中本适配器消费的字段 */
export interface EmbyRawItem {
  Id?: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  Genres?: string[];
  ProviderIds?: Record<string, string>;
  ImageTags?: { Primary?: string };
  UserData?: {
    Played?: boolean;
    PlayedPercentage?: number;
  };
}

/** 映射后的媒体库条目（入库 emby_items 的业务形状） */
export interface EmbyMappedItem {
  itemId: string;
  serverId: string | null;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  genres: string[];
  posterUrl: string | null;
  /** 0~100，缺失按 0 */
  playedPercentage: number;
  played: boolean;
}

/**
 * 单条目映射。规则：
 * - ProviderIds.Tmdb 缺失或非法 → null（调用方跳过并计数）；
 * - Type: Movie→movie / Series→tv，其余类型不在此拉取范围；
 * - 海报：ImageTags.Primary 存在时拼 {base}/emby/Items/{Id}/Images/Primary?maxWidth=342。
 */
export function embyItemAdapter(raw: EmbyRawItem, baseUrl: string): EmbyMappedItem | null {
  if (!raw.Id || !raw.Name) return null;
  const tmdbRaw = raw.ProviderIds?.Tmdb;
  const tmdbId = Number.parseInt(String(tmdbRaw ?? ''), 10);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;

  let mediaType: MediaType;
  if (raw.Type === 'Movie') mediaType = 'movie';
  else if (raw.Type === 'Series') mediaType = 'tv';
  else return null;

  const pct =
    typeof raw.UserData?.PlayedPercentage === 'number' && Number.isFinite(raw.UserData.PlayedPercentage)
      ? Math.min(100, Math.max(0, raw.UserData.PlayedPercentage))
      : 0;

  const hasPrimary = Boolean(raw.ImageTags?.Primary);
  return {
    itemId: raw.Id,
    serverId: null, // 由 service 层统一填入（System/Info 或同步上下文）
    tmdbId,
    mediaType,
    title: raw.Name,
    year:
      typeof raw.ProductionYear === 'number' && Number.isInteger(raw.ProductionYear)
        ? raw.ProductionYear
        : null,
    overview: typeof raw.Overview === 'string' && raw.Overview.trim() ? raw.Overview : null,
    genres: Array.isArray(raw.Genres) ? raw.Genres.filter((g) => typeof g === 'string') : [],
    posterUrl: hasPrimary
      ? `${baseUrl.replace(/\/+$/, '')}/emby/Items/${encodeURIComponent(raw.Id)}/Images/Primary?maxWidth=342`
      : null,
    playedPercentage: pct,
    played: raw.UserData?.Played === true,
  };
}

/**
 * 播放状态解析（watchlist 回写用）：
 * - Played → finished；0 < PlayedPercentage < 100 → watching；
 * - 未播放（played=false 且 pct==0）→ null 表示"无播放记录，不回写"。
 */
export function resolvePlaybackState(item: EmbyMappedItem): {
  status: 'watching' | 'finished';
} | null {
  if (item.played) return { status: 'finished' };
  if (item.playedPercentage > 0 && item.playedPercentage < 100) return { status: 'watching' };
  return null;
}
