/**
 * 各资源 API 调用函数（按模块分组）。类型与服务端 domain.ts 保持同构。
 */

import { request } from './http';
import type {
  AdminUserView,
  CalendarPayload,
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
  // hgeme 资源站
  hgeme_cookie_masked: string;
  hgeme_cookie_set: boolean;
  // 115 网盘（离线下载）
  pan115_cookie_masked: string;
  pan115_cookie_set: boolean;
  pan115_save_path: string;
  pan115_paths: string;
  pan115_save_path_movie: string;
  pan115_save_path_tv: string;
  pan115_folder_per_task: boolean;
  // Bark 推送
  bark_server_url: string;
  bark_device_key_masked: string;
  bark_device_key_set: boolean;
  // 网络代理
  proxy_url: string;
  proxy_resource_sites: boolean;
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

// ---- 资源搜索（1lou + hgeme 聚合） ----

/** 资源来源站 */
export type ResourceSource = '1lou' | 'hgeme';
export type ResourceSourceFilter = 'all' | ResourceSource;

/** hgeme 条目类型：影片候选 / 单个种子 / 网盘链接 */
export type ResourceItemKind = 'title' | 'torrent' | 'pan';

export interface ResourceItem {
  source: ResourceSource;
  kind?: ResourceItemKind;
  tid: string;
  title: string;
  url: string;
  tags: string[];
  author: string | null;
  date: string | null;
  views: number | null;
  comments: number | null;
  /** hgeme 专有：类型段（mv/tv/bt…）与附加信息 */
  dir?: string;
  year?: number | null;
  rating?: number | null;
  info?: string | null;
  /** hgeme 种子条目 */
  size?: string;
  seeds?: number | null;
  /** hgeme 网盘条目 */
  netdisk?: string | null;
  hot?: string | null;
}

export interface ResourceSourceStatus {
  source: ResourceSource;
  ok: boolean;
  count: number;
  error?: string;
}

/** hgeme 搜索分类与资源类型筛选元信息 */
export interface HgemeSearchMeta {
  categories: Array<{ key: number; label: string }>;
  ty: number;
  counts: number[];
  filters: Record<string, number>;
  filterCurrent: string;
}

export interface ResourceSearchResult {
  keyword: string;
  page: number;
  totalPages: number;
  items: ResourceItem[];
  cached: boolean;
  sources: ResourceSourceStatus[];
  hgeme: HgemeSearchMeta | null;
}

export function searchResources(
  q: string,
  page = 1,
  source: ResourceSourceFilter = 'all',
  hgeme?: { type?: number; filter?: string },
): Promise<ResourceSearchResult> {
  return request('/resources/search', {
    query: { q, page, source, type: hgeme?.type, filter: hgeme?.filter },
  });
}

// hgeme 影片详情 / 资源 / 单条种子

export interface HgemeDetail {
  id: string;
  dir: string;
  title: string;
  ename: string | null;
  year: number | null;
  typename: string | null;
  rating: number | null;
  genres: string[];
  regions: string[];
  languages: string[];
  releaseDate: string | null;
  status: string | null;
  summary: string | null;
  directors: string[];
  actors: string[];
  hasResources: boolean;
}

export function fetchHgemeDetail(dir: string, id: string): Promise<HgemeDetail> {
  return request('/resources/hgeme/detail', { query: { dir, id } });
}

export interface HgemeBtItem {
  id: string;
  title: string;
  size: string | null;
  magnet: string;
}

export function fetchHgemeBt(id: string): Promise<HgemeBtItem> {
  return request('/resources/hgeme/bt', { query: { id } });
}

export interface HgemeMagnet {
  title: string;
  size: string;
  qualityKey: string;
  quality: string;
  time: string;
  seeds: number | null;
  magnet: string;
}

export interface HgemePan {
  name: string;
  url: string;
  netdisk: string;
  user: string | null;
  time: string | null;
  hot: string | null;
  invalid: boolean;
}

export interface HgemeGroup {
  key: string;
  label: string;
  count: number;
}

export interface HgemePlaylist {
  name: string;
  episodes: string[];
}

export interface HgemeResources {
  magnets: HgemeMagnet[];
  magnetGroups: HgemeGroup[];
  pans: HgemePan[];
  panGroups: HgemeGroup[];
  playlists: HgemePlaylist[];
}

export function fetchHgemeResources(dir: string, id: string): Promise<HgemeResources> {
  return request('/resources/hgeme/resources', { query: { dir, id } });
}

export function pingHgeme(): Promise<{ ok: boolean }> {
  return request('/resources/hgeme/status');
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
  source?: ResourceSource;
  tid?: string;
  dir?: string;
  id?: string;
  index?: number;
  magnet?: string;
  btId?: string;
  title?: string;
  type: 'movie' | 'tv';
  savePath?: string;
  category?: string;
}): Promise<PushDownloadResult> {
  return request('/resources/download', {
    method: 'POST',
    body: {
      source: opts.source ?? '1lou',
      tid: opts.tid,
      dir: opts.dir,
      id: opts.id,
      index: opts.index,
      magnet: opts.magnet,
      bt_id: opts.btId,
      title: opts.title,
      type: opts.type,
      save_path: opts.savePath,
      category: opts.category,
    },
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

// ---- 115 网盘离线下载 ----

export interface Pan115Status {
  configured: boolean;
  reachable: boolean;
  loggedIn: boolean;
  username: string | null;
  vip: boolean;
  offlineQuota: { total: number; used: number; surplus: number } | null;
  error: string | null;
}

export interface Pan115PathPreset {
  name: string;
  cid: string;
}

export interface Pan115Paths {
  presets: Pan115PathPreset[];
  defaultCid: string;
  moviePath: string;
  tvPath: string;
  folderPerTask: boolean;
}

export interface Pan115DirEntry {
  cid: string;
  name: string;
  isDir: boolean;
  size: number;
}

export interface Pan115Task {
  infoHash: string;
  name: string;
  size: number;
  percentDone: number;
  status: number;
  statusText: string;
  /** 分组桶：downloading / completed / error */
  bucket: Pan115TaskBucket;
  url: string;
  fileId: string;
  addTime: number;
  lastUpdate: number;
}

export type Pan115TaskBucket = 'downloading' | 'completed' | 'error';

export interface Pan115TaskStats {
  total: number;
  downloading: number;
  completed: number;
  error: number;
  totalSize: number;
}

export interface Pan115TorrentFile {
  index: number;
  path: string;
  size: number;
  wanted: number;
}

export interface Pan115TorrentInfo {
  infoHash: string;
  name: string;
  size: number;
  fileCount: number;
  files: Pan115TorrentFile[];
  torrentSha1: string;
  pickCode: string;
}

export interface Pan115PushResult {
  pushed: boolean;
  target: string;
  cid: string;
  infoHash: string;
  name: string;
  selected?: number | 'auto';
}

export function fetchPan115Status(): Promise<Pan115Status> {
  return request('/pan115/status');
}

export function fetchPan115Paths(): Promise<Pan115Paths> {
  return request('/pan115/paths');
}

export function fetchPan115Dirs(cid = '0'): Promise<{ cid: string; entries: Pan115DirEntry[] }> {
  return request('/pan115/dirs', { query: { cid } });
}

export function resolvePan115Path(path: string): Promise<{ path: string; cid: string }> {
  return request('/pan115/resolve', { method: 'POST', body: { path } });
}

/** 离线任务列表（可选按分组筛选；stats 为全量统计，不受筛选影响） */
export function fetchPan115Tasks(opts: { bucket?: Pan115TaskBucket } = {}): Promise<{
  tasks: Pan115Task[];
  stats: Pan115TaskStats;
}> {
  return request('/pan115/tasks', { query: { bucket: opts.bucket } });
}

export function deletePan115Tasks(
  infoHashes: string[],
  deleteFiles = false,
): Promise<{ deleted: number; deleteFiles: boolean }> {
  return request('/pan115/tasks/delete', {
    method: 'POST',
    body: { info_hashes: infoHashes, delete_files: deleteFiles },
  });
}

/** 一键清理已完成（可选含失败）的离线任务 */
export function clearPan115Tasks(opts: {
  includeFailed?: boolean;
  deleteFiles?: boolean;
} = {}): Promise<{ deleted: number; includeFailed: boolean; deleteFiles: boolean }> {
  return request('/pan115/tasks/clear', {
    method: 'POST',
    body: { include_failed: opts.includeFailed, delete_files: opts.deleteFiles },
  });
}

/** 推送磁力 / 直链到 115 离线下载 */
export function pushPan115Url(opts: {
  url: string;
  cid?: string;
  dir?: string;
  type?: 'movie' | 'tv';
}): Promise<Pan115PushResult> {
  return request('/pan115/url', {
    method: 'POST',
    body: { url: opts.url, cid: opts.cid, dir: opts.dir, type: opts.type },
  });
}

/** 上传 .torrent 并解析文件树（不创建任务），用于推送到 115 前的文件勾选 */
export function parsePan115Torrent(opts: {
  filename: string;
  base64: string;
}): Promise<Pan115TorrentInfo> {
  return request('/pan115/torrent/parse', {
    method: 'POST',
    body: { filename: opts.filename, torrent_base64: opts.base64 },
  });
}

/** 由服务端抓取 .torrent 直链并交 115 解析文件树（用于先预览再勾选） */
export function parsePan115TorrentFromUrl(opts: { url: string }): Promise<Pan115TorrentInfo> {
  return request('/pan115/torrent/from-url', {
    method: 'POST',
    body: { url: opts.url },
  });
}

/** 提交 BT 离线任务（wantedIndexes 为空则按 115 默认勾选） */
export function addPan115Torrent(opts: {
  info: Pan115TorrentInfo;
  wantedIndexes?: number[];
  cid?: string;
  dir?: string;
  type?: 'movie' | 'tv';
  savePath?: string;
}): Promise<Pan115PushResult> {
  return request('/pan115/torrent/add', {
    method: 'POST',
    body: {
      info_hash: opts.info.infoHash,
      name: opts.info.name,
      torrent_sha1: opts.info.torrentSha1,
      pick_code: opts.info.pickCode,
      files: opts.info.files,
      wanted_indexes: opts.wantedIndexes,
      cid: opts.cid,
      dir: opts.dir,
      type: opts.type,
      save_path: opts.savePath,
    },
  });
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
  /** 初始状态，默认 watching；详情页「想看」入口传 planned */
  status?: WatchStatus;
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

// ---- calendar ----

export function fetchCalendar(): Promise<CalendarPayload> {
  return request('/calendar');
}

/** TMDB 即将上映/播出（电影 upcoming + 剧集 on_the_air 合并） */
export function fetchTmdbUpcoming(): Promise<MediaItem[]> {
  return request('/tmdb/upcoming');
}

// ---- notify（Bark 推送） ----

export interface BarkTestResult {
  ok: boolean;
  message: string;
}

export function testBarkPush(): Promise<BarkTestResult> {
  return request('/notify/test', { method: 'POST' });
}

// ---- renamer（媒体重命名） ----

export interface RenamerMediaDir {
  type: 'movie' | 'tv';
  path: string;
}

export interface RenamerItem {
  id: number;
  type: 'movie' | 'tv';
  path: string;
  name: string;
  year: number | null;
  season: number | null;
  epStart: number | null;
  epEnd: number | null;
  epName: string | null;
  epDate: string | null;
  resolution: string | null;
  version: string | null;
  extension: string | null;
  isExtra: boolean;
  tmdbId: number | null;
  tmdbTitle: string | null;
  tmdbYear: number | null;
  tmdbPoster: string | null;
  matchMethod: string | null;
  status: string;
  newPath: string | null;
}

export interface RenamerScanState {
  running: boolean;
  progress: number;
  total: number;
  found: number;
  message: string;
}

export interface RenamerTmdbHit {
  id: number;
  title: string;
  original_title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  kind: 'movie' | 'tv';
}

export interface RenamePlanEntry {
  id: number;
  oldPath: string;
  newPath: string;
}

export interface RenameExecuteResult {
  renamed: number;
  failed: number;
  removedDirs: number;
  results: RenamePlanEntry[];
  errors: Array<{ id: number; message: string; oldPath?: string }>;
}

export function fetchRenamerSettings(): Promise<{ dirs: RenamerMediaDir[] }> {
  return request('/renamer/settings');
}

export function saveRenamerSettings(input: {
  dirs?: RenamerMediaDir[];
}): Promise<{ dirs: RenamerMediaDir[] }> {
  return request('/renamer/settings', { method: 'PUT', body: input });
}

export function listRenamerDirs(path?: string): Promise<{ path: string; parent: string | null; dirs: string[] }> {
  return request('/renamer/dirs', { query: { path } });
}

export function startRenamerScan(): Promise<{ ok: boolean; message: string }> {
  return request('/renamer/scan', { method: 'POST' });
}

export function fetchRenamerScanState(): Promise<RenamerScanState> {
  return request('/renamer/scan/state');
}

export function listRenamerItems(opts: { status?: string; type?: string } = {}): Promise<{ items: RenamerItem[] }> {
  return request('/renamer/items', { query: { status: opts.status, type: opts.type } });
}

export function searchRenamerTmdb(q: string, kind: 'movie' | 'tv', year?: number): Promise<{ results: RenamerTmdbHit[] }> {
  return request('/renamer/search', { query: { q, kind, year } });
}

export function autoMatchRenamerItem(id: number): Promise<{ item: RenamerItem }> {
  return request(`/renamer/items/${id}/auto-match`, { method: 'POST' });
}

export function manualMatchRenamerItem(id: number, tmdbId: number, kind: 'movie' | 'tv'): Promise<{ item: RenamerItem }> {
  return request(`/renamer/items/${id}/match`, { method: 'POST', body: { tmdb_id: tmdbId, kind } });
}

export function batchMatchRenamerItems(ids: number[]): Promise<{ matched: number; failed: number; errors: Array<{ id: number; message: string }> }> {
  return request('/renamer/match/batch', { method: 'POST', body: { ids } });
}

export function previewRenamer(ids: number[]): Promise<{ plan: RenamePlanEntry[] }> {
  return request('/renamer/rename/preview', { method: 'POST', body: { ids } });
}

export function executeRenamer(plan: RenamePlanEntry[]): Promise<RenameExecuteResult> {
  return request('/renamer/rename/execute', { method: 'POST', body: { plan } });
}

export function listRenamerLogs(): Promise<{
  logs: Array<{ id: number; itemId: number | null; oldPath: string | null; newPath: string | null; status: string; message: string | null; createdAt: string }>;
}> {
  return request('/renamer/logs');
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
