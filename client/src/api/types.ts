/**
 * 共享领域类型 —— 与 server/src/types/domain.ts 保持同构。
 */

export type MediaType = 'movie' | 'tv';

export type WatchStatus = 'watching' | 'finished' | 'dropped' | 'planned';

export interface UserPublic {
  id: number;
  username: string;
  role: 'admin' | 'member';
}

export interface MediaItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  overview?: string;
  /** TMDB 相对路径，如 /abc.jpg */
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage?: number;
  genreIds?: number[];
}

export interface RatingSource {
  score: number | null;
  rawText: string | null;
  sourceUrl: string | null;
  stale: boolean;
  manual: boolean;
}

export interface DetailPayload extends MediaItem {
  runtime?: number;
  genres: { id: number; name: string }[];
  cast: { name: string; character?: string; profilePath?: string }[];
  crew?: { name: string; job: string }[];
  numberOfSeasons?: number;
  seasons?: { seasonNumber: number; episodeCount: number }[];
  voteAverage: number;
}

export interface SeasonSnapshotEntry {
  seasonNumber: number;
  episodeCount: number;
}

export interface WatchItem {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath?: string;
  status: WatchStatus;
  currentSeason: number;
  currentEpisode: number;
  totalEpisodes: number | null;
  progressPercent: number;
  updatedAt: string;
}

export interface HomeSection {
  key: string;
  title: string;
  items: MediaItem[];
}

// ---- Emby ----

export interface EmbyStatus {
  configured: boolean;
  verified: boolean;
  serverName: string | null;
  itemCount: number;
  lastSync: string | null;
}

export interface EmbySyncResult {
  synced: number;
  skipped: number;
  matchedToWatchlist: number;
}

export interface EmbyPlayUrl {
  url: string;
}

/** 登录式接入（AuthenticateByName）结果 */
export interface EmbyLoginResult {
  serverName: string | null;
  serverId: string | null;
  userId: string;
  username: string;
}

/** 媒体库浏览条目（实时分页，不落库） */
export interface EmbyLibraryItem {
  itemId: string;
  title: string;
  year: number | null;
  mediaType: MediaType;
  posterUrl: string | null;
  overview: string | null;
  played: boolean;
  playedPercentage: number;
}

export interface EmbyLibraryPayload {
  total: number;
  items: EmbyLibraryItem[];
}

/** Emby 媒体库分类（虚拟库：电影/剧集/…） */
export interface EmbyView {
  id: string;
  name: string;
  /** movies / tvshows / music / homevideos 等 */
  collectionType: string | null;
  posterUrl: string | null;
}

export type EmbyPlayedFilter = 'all' | 'unplayed' | 'played';
export type EmbySortBy =
  | 'SortName'
  | 'DateCreated'
  | 'ProductionYear'
  | 'Random'
  | 'CommunityRating';

/** 观看记录条目（Emby 已看完，按观看时间倒序） */
export interface EmbyHistoryItem {
  itemId: string;
  title: string;
  seriesName: string | null;
  mediaType: MediaType;
  posterUrl: string | null;
  year: number | null;
  watchedDate: string | null;
}

/** 内置播放器播放信息（HLS） */
export interface EmbyPlayInfo {
  title: string;
  hlsUrl: string;
  runtimeTicks: number | null;
  playSessionId: string;
}

export type EmbyPlaybackEvent = 'start' | 'progress' | 'stop';

// ---- 日历与想看 ----

export interface CalendarEntry {
  tmdbId: number;
  title: string;
  season: number;
  episode: number;
  airDate: string;
  posterPath?: string | null;
}

export interface CalendarPayload {
  items: CalendarEntry[];
  lastRefresh: string | null;
}

export interface UpcomingItem {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath?: string | null;
  releaseDate?: string | null;
  /** 备注（详情页加入想看时可填，可为空） */
  note?: string | null;
  /** 加入时间 ISO 字符串 */
  addedAt?: string | null;
}

export interface CreateUpcomingInput {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  poster_path?: string;
  release_date?: string;
}

// ---- 用户管理（admin） ----

/** 管理员视角的用户视图（含创建时间） */
export interface AdminUserView {
  id: number;
  username: string;
  role: 'admin' | 'member';
  createdAt: string;
}

// ---- MoviePilot ----

export interface MoviePilotStatus {
  configured: boolean;
  reachable: boolean;
}

export interface SubscribeInput {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year?: number;
  season?: number;
}

export interface SubscribeResult {
  ok: boolean;
  message?: string;
}
