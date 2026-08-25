/**
 * 共享领域类型与错误码约定 —— 服务端唯一事实源。
 * 前端在 client/src/api/endpoints.ts 中保持同构类型。
 */

export type MediaType = 'movie' | 'tv';

export type RatingSourceKey = 'douban' | 'tomato' | 'popcorn';

export type WatchStatus = 'watching' | 'finished' | 'dropped' | 'planned';

export interface UserPublic {
  id: number;
  username: string;
  role: 'admin' | 'member';
}

/** TMDB 列表条目（首页分区 / 搜索结果通用） */
export interface MediaItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  overview?: string;
  /** TMDB 相对路径，如 /abc.jpg */
  posterPath?: string;
  backdropPath?: string;
  /** ISO yyyy-MM-dd */
  releaseDate?: string;
  /** TMDB 0~10 */
  voteAverage?: number;
  genreIds?: number[];
}

/** 单一评分源（豆瓣/烂番茄/爆米花） */
export interface RatingSource {
  score: number | null;
  rawText: string | null;
  sourceUrl: string | null;
  /** true = 来自过期缓存或手动修正或降级空值 */
  stale: boolean;
  /** true = 人工修正值 */
  manual: boolean;
}

/** 详情页负载 */
export interface DetailPayload extends MediaItem {
  runtime?: number;
  genres: { id: number; name: string }[];
  cast: { name: string; character?: string; profilePath?: string }[];
  crew?: { name: string; job: string }[];
  numberOfSeasons?: number;
  seasons?: { seasonNumber: number; episodeCount: number }[];
  voteAverage: number;
}

/** 追剧行（服务端计算 progressPercent） */
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

/** 季快照条目 */
export interface SeasonSnapshotEntry {
  seasonNumber: number;
  episodeCount: number;
}

/** 首页分区 */
export interface HomeSection {
  key: string;
  title: string;
  items: MediaItem[];
}

/** 统一响应包裹 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}
