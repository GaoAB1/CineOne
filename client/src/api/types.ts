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
}

export interface CreateUpcomingInput {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  poster_path?: string;
  release_date?: string;
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
