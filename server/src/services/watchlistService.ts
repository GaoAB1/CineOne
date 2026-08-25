/**
 * 追剧业务逻辑：唯一约束（重复添加 4090）、进度推进、user_id 行隔离。
 */

import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import type { MediaType, SeasonSnapshotEntry, WatchItem, WatchStatus } from '../types/domain';

const VALID_STATUSES: WatchStatus[] = ['watching', 'finished', 'dropped', 'planned'];

interface WatchRow {
  id: number;
  user_id: number;
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  status: string;
  current_season: number;
  current_episode: number;
  seasons_snapshot: string | null;
  total_episodes: number | null;
  added_at: string;
  updated_at: string;
}

function parseSnapshot(json: string | null): SeasonSnapshotEntry[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is { seasonNumber: number; episodeCount: number } =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { seasonNumber?: unknown }).seasonNumber === 'number' &&
          typeof (e as { episodeCount?: unknown }).episodeCount === 'number',
      );
  } catch {
    return [];
  }
}

/** 服务端计算进度百分比：currentEpisode / 该季总集数 */
function computeProgress(row: WatchRow): number {
  const snapshot = parseSnapshot(row.seasons_snapshot);
  const seasonEntry = snapshot.find((s) => s.seasonNumber === row.current_season);
  let denominator = seasonEntry?.episodeCount ?? row.total_episodes ?? 0;
  if (!denominator || denominator <= 0) {
    // 无任何集数信息：有进度即视为完成度未知，按 100% 展示已看状态由前端处理
    return row.current_episode > 0 ? 100 : 0;
  }
  const percent = Math.round((row.current_episode / denominator) * 100);
  return Math.min(100, Math.max(0, percent));
}

function toWatchItem(row: WatchRow): WatchItem {
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type === 'tv' ? 'tv' : 'movie',
    title: row.title,
    posterPath: row.poster_path ?? undefined,
    status: (VALID_STATUSES as string[]).includes(row.status)
      ? (row.status as WatchStatus)
      : 'watching',
    currentSeason: row.current_season,
    currentEpisode: row.current_episode,
    totalEpisodes: row.total_episodes ?? null,
    progressPercent: computeProgress(row),
    updatedAt: `${row.updated_at.replace(' ', 'T')}Z`,
  };
}

export function listWatchlist(userId: number, status?: string): WatchItem[] {
  if (status != null && !VALID_STATUSES.includes(status as WatchStatus)) {
    throw new ApiError(1001, `非法的追剧状态：${status}`, 400);
  }
  const db = getDb();
  const rows = (
    status
      ? db
          .prepare('SELECT * FROM watchlist WHERE user_id = ? AND status = ? ORDER BY updated_at DESC')
          .all(userId, status)
      : db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
  ) as WatchRow[];
  return rows.map(toWatchItem);
}

export function createWatchItem(
  userId: number,
  input: {
    tmdbId: number;
    mediaType: MediaType;
    title?: string;
    posterPath?: string | null;
    seasonsSnapshot?: SeasonSnapshotEntry[];
  },
): WatchItem {
  const { tmdbId, mediaType, title, posterPath, seasonsSnapshot } = input;
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new ApiError(1001, 'tmdbId 非法', 400);
  }
  if (mediaType !== 'movie' && mediaType !== 'tv') {
    throw new ApiError(1001, 'mediaType 必须为 movie 或 tv', 400);
  }

  const totalEpisodes =
    Array.isArray(seasonsSnapshot) && seasonsSnapshot.length > 0
      ? seasonsSnapshot.reduce((sum, s) => sum + s.episodeCount, 0)
      : null;

  const db = getDb();
  try {
    const info = db
      .prepare(
        `INSERT INTO watchlist
           (user_id, tmdb_id, media_type, title, poster_path, status, current_season, current_episode, seasons_snapshot, total_episodes, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'watching', 1, 0, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        userId,
        tmdbId,
        mediaType,
        title ?? '未命名条目',
        posterPath ?? null,
        Array.isArray(seasonsSnapshot) && seasonsSnapshot.length > 0
          ? JSON.stringify(seasonsSnapshot)
          : null,
        totalEpisodes,
      );
    const created = db
      .prepare('SELECT * FROM watchlist WHERE id = ?')
      .get(info.lastInsertRowid) as WatchRow;
    return toWatchItem(created);
  } catch (err) {
    // better-sqlite3 唯一约束冲突 → 4090 已在列表中
    if (
      typeof err === 'object' &&
      err !== null &&
      String((err as { code?: string }).code).startsWith('SQLITE_CONSTRAINT')
    ) {
      throw new ApiError(4090, '该条目已在追剧列表中', 409);
    }
    throw err;
  }
}

export interface WatchPatch {
  status?: WatchStatus;
  currentSeason?: number;
  currentEpisode?: number;
  seasonsSnapshot?: SeasonSnapshotEntry[];
}

export function updateWatchItem(userId: number, id: number, patch: WatchPatch): WatchItem {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM watchlist WHERE id = ? AND user_id = ?')
    .get(id, userId) as WatchRow | undefined;
  if (!existing) {
    throw new ApiError(1004, '追剧条目不存在', 404);
  }
  if (patch.status != null && !VALID_STATUSES.includes(patch.status)) {
    throw new ApiError(1001, `非法的追剧状态：${patch.status}`, 400);
  }
  if (
    patch.currentSeason != null &&
    (!Number.isInteger(patch.currentSeason) || patch.currentSeason < 1)
  ) {
    throw new ApiError(1001, 'currentSeason 必须为 ≥1 的整数', 400);
  }
  if (
    patch.currentEpisode != null &&
    (!Number.isInteger(patch.currentEpisode) || patch.currentEpisode < 0)
  ) {
    throw new ApiError(1001, 'currentEpisode 必须为 ≥0 的整数', 400);
  }

  const nextStatus = patch.status ?? existing.status;
  const nextSeason = patch.currentSeason ?? existing.current_season;
  const nextEpisode =
    patch.currentEpisode ??
    // 换季时集数归零
    (patch.currentSeason != null && patch.currentSeason !== existing.current_season
      ? 0
      : existing.current_episode);

  let nextSnapshot = existing.seasons_snapshot;
  let nextTotal = existing.total_episodes;
  if (patch.seasonsSnapshot !== undefined) {
    nextSnapshot =
      Array.isArray(patch.seasonsSnapshot) && patch.seasonsSnapshot.length > 0
        ? JSON.stringify(patch.seasonsSnapshot)
        : null;
    nextTotal =
      Array.isArray(patch.seasonsSnapshot) && patch.seasonsSnapshot.length > 0
        ? patch.seasonsSnapshot.reduce((sum, s) => sum + s.episodeCount, 0)
        : null;
  }

  db.prepare(
    `UPDATE watchlist SET status=?, current_season=?, current_episode=?, seasons_snapshot=?, total_episodes=?, updated_at=?
     WHERE id=? AND user_id=?`,
  ).run(nextStatus, nextSeason, nextEpisode, nextSnapshot, nextTotal, sqlNow(), id, userId);

  const updated = db
    .prepare('SELECT * FROM watchlist WHERE id = ?')
    .get(id) as WatchRow;
  return toWatchItem(updated);
}

export function deleteWatchItem(userId: number, id: number): void {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM watchlist WHERE id = ? AND user_id = ?')
    .run(id, userId);
  if (info.changes === 0) {
    throw new ApiError(1004, '追剧条目不存在', 404);
  }
}
