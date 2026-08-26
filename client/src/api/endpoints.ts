/**
 * 各资源 API 调用函数（按模块分组）。类型与服务端 domain.ts 保持同构。
 */

import { request } from './http';
import type {
  CalendarPayload,
  CreateUpcomingInput,
  DetailPayload,
  EmbyPlayUrl,
  EmbyStatus,
  EmbySyncResult,
  HomeSection,
  MediaItem,
  MediaType,
  RatingSource,
  UpcomingItem,
  UserPublic,
  WatchItem,
  WatchStatus,
} from './types';

// ---- bootstrap / setup / auth ----

export function fetchBootstrap(): Promise<{ initialized: boolean }> {
  return request('/bootstrap');
}

export function apiSetup(username: string, password: string): Promise<{ token: string; user: UserPublic }> {
  return request('/setup', { method: 'POST', body: { username, password } });
}

export function apiLogin(username: string, password: string): Promise<{ token: string; user: UserPublic }> {
  return request('/auth/login', { method: 'POST', body: { username, password } });
}

export function apiLogout(): Promise<null> {
  return request('/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<UserPublic> {
  return request('/auth/me');
}

// ---- settings ----

export interface SettingsView {
  tmdb_api_key_masked: string;
  tmdb_api_key_set: boolean;
  ratings_ttl_hours: number;
  theme_default: string;
}

export function fetchSettings(): Promise<SettingsView> {
  return request('/settings');
}

export function updateSettings(patch: Record<string, string>): Promise<SettingsView> {
  return request('/settings', { method: 'PUT', body: patch });
}

// ---- tmdb ----

export function fetchTmdbStatus(): Promise<{ configured: boolean }> {
  return request('/tmdb/status');
}

export function fetchHome(window: 'day' | 'week' = 'week'): Promise<{ sections: HomeSection[] }> {
  return request('/tmdb/home', { query: { window } });
}

export interface SearchResult {
  page: number;
  results: MediaItem[];
  total_pages: number;
}

export function searchMedia(q: string, page = 1): Promise<SearchResult> {
  return request('/tmdb/search', { query: { q, page } });
}

export function fetchDetail(type: MediaType, id: number): Promise<DetailPayload> {
  return request(`/tmdb/detail/${type}/${id}`);
}

// ---- ratings ----

export interface RatingsAggregate {
  tmdb: { score: number; votes: number } | null;
  douban: RatingSource;
  tomato: RatingSource;
  popcorn: RatingSource;
  degraded: boolean;
}

export function fetchRatings(type: MediaType, id: number): Promise<RatingsAggregate> {
  return request(`/ratings/${type}/${id}`);
}

export function putManualRating(
  type: MediaType,
  id: number,
  source: 'douban' | 'tomato' | 'popcorn',
  score: number | null,
  rawText?: string,
): Promise<RatingSource> {
  return request(`/ratings/${type}/${id}/manual`, {
    method: 'PUT',
    body: { source, score, raw_text: rawText },
  });
}

// ---- watchlist ----

export function listWatchlist(status?: WatchStatus): Promise<WatchItem[]> {
  return request('/watchlist', { query: { status } });
}

export interface CreateWatchInput {
  tmdb_id: number;
  media_type: MediaType;
  title?: string;
  poster_path?: string;
  seasons_snapshot?: { seasonNumber: number; episodeCount: number }[];
}

export function createWatchItem(input: CreateWatchInput): Promise<WatchItem> {
  return request('/watchlist', { method: 'POST', body: input });
}

export interface PatchWatchInput {
  status?: WatchStatus;
  current_season?: number;
  current_episode?: number;
  seasons_snapshot?: { seasonNumber: number; episodeCount: number }[];
}

export function patchWatchItem(id: number, patch: PatchWatchInput): Promise<WatchItem> {
  return request(`/watchlist/${id}`, { method: 'PATCH', body: patch });
}

export function deleteWatchItem(id: number): Promise<null> {
  return request(`/watchlist/${id}`, { method: 'DELETE' });
}

// ---- emby ----

export function fetchEmbyStatus(): Promise<EmbyStatus> {
  return request('/emby/status');
}

export function triggerEmbySync(): Promise<EmbySyncResult> {
  return request('/emby/sync', { method: 'POST' });
}

export function fetchEmbyPlayUrl(tmdbId: number, mediaType: MediaType): Promise<EmbyPlayUrl> {
  return request(`/emby/play/${tmdbId}/${mediaType}`);
}

// ---- calendar / upcoming ----

export function fetchCalendar(): Promise<CalendarPayload> {
  return request('/calendar');
}

/** TMDB 即将上映/播出（电影 upcoming + 剧集 on_the_air 合并） */
export function fetchTmdbUpcoming(): Promise<MediaItem[]> {
  return request('/tmdb/upcoming');
}

export function listUpcoming(): Promise<UpcomingItem[]> {
  return request('/upcoming');
}

export function createUpcoming(input: CreateUpcomingInput): Promise<UpcomingItem> {
  return request('/upcoming', { method: 'POST', body: input });
}

export function deleteUpcoming(id: number): Promise<null> {
  return request(`/upcoming/${id}`, { method: 'DELETE' });
}
