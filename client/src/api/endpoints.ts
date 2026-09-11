/**
 * 各资源 API 调用函数（按模块分组）。类型与服务端 domain.ts 保持同构。
 */

import { request } from './http';
import type {
  AdminUserView,
  CalendarPayload,
  CreateUpcomingInput,
  DetailPayload,
  EmbyPlayUrl,
  EmbyLoginResult,
  EmbyLibraryPayload,
  EmbyHistoryItem,
  EmbyPlayInfo,
  EmbyPlaybackEvent,
  EmbyPlayedFilter,
  EmbySortBy,
  EmbyView,
  EmbyStatus,
  EmbySyncResult,
  HomeSection,
  MediaItem,
  MediaType,
  MoviePilotStatus,
  RatingSource,
  SubscribeInput,
  SubscribeResult,
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
  // qBittorrent（下载器）
  qb_server_url: string;
  qb_username: string;
  qb_password_masked: string;
  qb_password_set: boolean;
  qb_save_path_movie: string;
  qb_save_path_tv: string;
  qb_save_paths: string;
  qb_category_movie: string;
  qb_category_tv: string;
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

// ---- tmdb 流媒体平台分组 ----

export interface ProviderEntry {
  key: string;
  id: number;
  name: string;
  logoPath: string | null;
  /** 平台 6 张热门样例海报（首页平台大幅卡右侧堆叠） */
  samples: ProviderSample[];
}

export interface ProviderSample {
  tmdbId: number;
  mediaType: MediaType;
  posterPath: string | null;
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

/** 首页平台入口卡数据（美区/国区） */
export function fetchProviderRegions(): Promise<{ regions: ProviderRegionGroup[] }> {
  return request('/tmdb/providers');
}

/** 平台条目分页（浏览页） */
export function fetchProviderItems(opts: {
  region: 'us' | 'cn';
  providerId: number;
  type: MediaType;
  page: number;
}): Promise<ProviderPagePayload> {
  return request('/tmdb/providers/items', {
    query: { region: opts.region, provider_id: opts.providerId, type: opts.type, page: opts.page },
  });
}

export interface SearchResult {
  page: number;
  results: MediaItem[];
  total_pages: number;
}

export function searchMedia(q: string, page = 1): Promise<SearchResult> {
  return request('/tmdb/search', { query: { q, page } });
}

// ---- 资源搜索（1lou 聚合，站内展示） ----

export interface ResourceItem {
  tid: string;
  title: string;
  url: string;
  tags: string[];
  author: string | null;
  date: string | null;
  views: number | null;
  comments: number | null;
}

export interface ResourceSearchResult {
  keyword: string;
  page: number;
  totalPages: number;
  items: ResourceItem[];
  cached: boolean;
}

export function searchResources(q: string, page = 1): Promise<ResourceSearchResult> {
  return request('/resources/search', { query: { q, page } });
}

/** 一键推送资源到 qBittorrent 下载 */
export interface PushDownloadResult {
  pushed: boolean;
  name: string;
  savePath: string | null;
  category: string | null;
  threadUrl: string;
}

export function pushResourceDownload(opts: {
  tid: string;
  type: 'movie' | 'tv';
  savePath?: string;
  category?: string;
}): Promise<PushDownloadResult> {
  return request('/resources/download', {
    method: 'POST',
    body: { tid: opts.tid, type: opts.type, save_path: opts.savePath, category: opts.category },
  });
}

// ---- qBittorrent ----

export interface QbStatus {
  configured: boolean;
  reachable: boolean;
  version: string | null;
  defaultSavePath: string | null;
  authMode: 'anonymous' | 'account';
  error: string | null;
}

export interface QbTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  state: string;
  eta: number;
  savePath: string;
  category: string;
  addedOn: number;
  numSeeds: number;
  numLeeches: number;
  downloaded: number;
  uploaded: number;
}

export interface QbPaths {
  defaultSavePath: string | null;
  presetPaths: string[];
  moviePath: string;
  tvPath: string;
  movieCategory: string;
  tvCategory: string;
}

export function fetchQbStatus(): Promise<QbStatus> {
  return request('/qb/status');
}

export function fetchQbTorrents(): Promise<{ torrents: QbTorrent[] }> {
  return request('/qb/torrents');
}

export function fetchQbPaths(): Promise<QbPaths> {
  return request('/qb/paths');
}

export function qbPause(hashes: string): Promise<{ paused: boolean }> {
  return request('/qb/pause', { method: 'POST', body: { hashes } });
}

export function qbResume(hashes: string): Promise<{ resumed: boolean }> {
  return request('/qb/resume', { method: 'POST', body: { hashes } });
}

export function qbDelete(hashes: string, deleteFiles = false): Promise<{ deleted: boolean }> {
  return request('/qb/delete', { method: 'POST', body: { hashes, delete_files: deleteFiles } });
}

export function fetchDetail(type: MediaType, id: number): Promise<DetailPayload> {
  return request(`/tmdb/detail/${type}/${id}`);
}

// ---- douban resolve（查找资源豆瓣直查） ----

export interface DoubanResolveResult {
  subjectUrl: string | null;
  title: string | null;
  year: number | null;
  source: 'cache' | 'douban' | null;
  disabled: boolean;
  degraded: boolean;
}

/** 无聚合豆瓣链接时，经豆瓣 suggest 反查条目链接 */
export function resolveDoubanLink(
  type: MediaType,
  tmdbId: number,
  title: string,
  year?: number,
): Promise<DoubanResolveResult> {
  return request('/douban/resolve', {
    query: { type, tmdb_id: tmdbId, title, year },
  });
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

/** Emby 登录式接入：地址 + 用户名 + 密码（AuthenticateByName，成功后服务端持久化） */
export function embyLogin(input: {
  server_url: string;
  username: string;
  password: string;
}): Promise<EmbyLoginResult> {
  return request('/emby/login', { method: 'POST', body: input });
}

/** 退出 Emby 登录（清空 AccessToken 与用户 ID） */
export function embyLogout(): Promise<null> {
  return request('/emby/logout', { method: 'POST' });
}

/** 媒体库分类（Emby /Users/{id}/Views：电影/剧集/…虚拟库） */
export function fetchEmbyViews(): Promise<{ views: EmbyView[] }> {
  return request('/emby/views');
}

/** 媒体库实时分页（浏览页，支持分类/观看状态筛选/排序） */
export function fetchEmbyLibrary(params: {
  page: number;
  page_size?: number;
  search?: string;
  type?: 'all' | 'movie' | 'tv';
  parent_id?: string;
  played?: EmbyPlayedFilter;
  sort_by?: EmbySortBy;
  sort_order?: 'Ascending' | 'Descending';
}): Promise<EmbyLibraryPayload> {
  return request('/emby/library', { query: params as unknown as Record<string, string> });
}

/** 观看记录：已看完条目按 LastPlayedDate 倒序 */
export function fetchEmbyHistory(limit = 30): Promise<{ items: EmbyHistoryItem[] }> {
  return request('/emby/history', { query: { limit: String(limit) } });
}

/** 内置播放器：取 HLS 播放信息（剧集自动取第一集） */
export function fetchEmbyPlayInfo(itemId: string): Promise<EmbyPlayInfo> {
  return request(`/emby/playinfo/${encodeURIComponent(itemId)}`);
}

/** 播放进度上报（start/progress/stop，失败由服务端静默） */
export function reportEmbyPlayback(
  itemId: string,
  payload: {
    event: EmbyPlaybackEvent;
    position_ticks?: number;
    paused?: boolean;
    play_session_id?: string;
  },
): Promise<{ delivered: boolean }> {
  return request(`/emby/playing/${encodeURIComponent(itemId)}`, {
    method: 'POST',
    body: payload,
  });
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

// ---- moviepilot ----

export function fetchMoviepilotStatus(): Promise<MoviePilotStatus> {
  return request('/moviepilot/status');
}

export function fetchMoviepilotSubscribed(
  tmdbId: number,
  mediaType: MediaType,
): Promise<{ subscribed: boolean }> {
  return request(`/moviepilot/subscribed/${tmdbId}/${mediaType}`);
}

export function subscribeMoviepilot(input: SubscribeInput): Promise<SubscribeResult> {
  return request('/moviepilot/subscribe', { method: 'POST', body: input });
}

// ---- users（管理端） ----

export function listUsers(): Promise<{ users: AdminUserView[] }> {
  return request('/users');
}

export interface CreateUserInput {
  username: string;
  password: string;
  role?: 'admin' | 'member';
}

export function createUser(input: CreateUserInput): Promise<{ user: AdminUserView }> {
  return request('/users', { method: 'POST', body: input });
}

export interface UpdateUserPasswordInput {
  /** 管理员重置他人密码时可不传；本人修改须携带 */
  oldPassword?: string;
  newPassword: string;
}

export function updateUserPassword(id: number, input: UpdateUserPasswordInput): Promise<null> {
  return request(`/users/${id}/password`, { method: 'PATCH', body: input });
}

export function deleteUser(id: number): Promise<null> {
  return request(`/users/${id}`, { method: 'DELETE' });
}
