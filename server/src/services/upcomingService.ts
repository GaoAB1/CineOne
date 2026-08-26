/**
 * 想看（upcoming）业务逻辑：唯一约束（重复添加 4091）、release_date 升序列表、
 * user_id 行隔离。模式与 watchlistService 保持一致。
 */

import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import type { MediaType } from '../types/domain';

interface UpcomingRow {
  id: number;
  user_id: number;
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  release_date: string | null;
  note: string | null;
  added_at: string;
}

export interface UpcomingItem {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath?: string;
  releaseDate?: string;
  note?: string;
  addedAt: string;
}

function toUpcomingItem(row: UpcomingRow): UpcomingItem {
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type === 'tv' ? 'tv' : 'movie',
    title: row.title,
    posterPath: row.poster_path ?? undefined,
    releaseDate: row.release_date ?? undefined,
    note: row.note ?? undefined,
    addedAt: `${row.added_at.replace(' ', 'T')}Z`,
  };
}

/** 本人想看列表，release_date 升序（空值排最后），同日期按加入时间倒序 */
export function listUpcoming(userId: number): UpcomingItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM upcoming WHERE user_id = ?
       ORDER BY CASE WHEN release_date IS NULL THEN 1 ELSE 0 END, release_date ASC, added_at DESC`,
    )
    .all(userId) as UpcomingRow[];
  return rows.map(toUpcomingItem);
}

export function createUpcomingItem(
  userId: number,
  input: {
    tmdbId: number;
    mediaType: MediaType;
    title?: string;
    posterPath?: string | null;
    releaseDate?: string | null;
    note?: string | null;
  },
): UpcomingItem {
  const { tmdbId, mediaType, title, posterPath, releaseDate, note } = input;
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new ApiError(1001, 'tmdbId 非法', 400);
  }
  if (mediaType !== 'movie' && mediaType !== 'tv') {
    throw new ApiError(1001, 'mediaType 必须为 movie 或 tv', 400);
  }
  if (releaseDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    throw new ApiError(1001, 'release_date 必须为 yyyy-MM-dd 格式', 400);
  }

  try {
    const info = getDb()
      .prepare(
        `INSERT INTO upcoming (user_id, tmdb_id, media_type, title, poster_path, release_date, note, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        tmdbId,
        mediaType,
        title ?? '未命名条目',
        posterPath ?? null,
        releaseDate ?? null,
        note ?? null,
        sqlNow(),
      );
    const created = getDb()
      .prepare('SELECT * FROM upcoming WHERE id = ?')
      .get(info.lastInsertRowid) as UpcomingRow;
    return toUpcomingItem(created);
  } catch (err) {
    // 仅唯一约束冲突 → 4091 已在想看列表中；FK/CHECK 等其余约束原样抛出
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw new ApiError(4091, '该条目已在想看列表中', 409);
    }
    throw err;
  }
}

export function deleteUpcomingItem(userId: number, id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(1001, '非法的条目 ID', 400);
  }
  const info = getDb()
    .prepare('DELETE FROM upcoming WHERE id = ? AND user_id = ?')
    .run(id, userId);
  if (info.changes === 0) {
    throw new ApiError(1004, '想看条目不存在', 404);
  }
}
