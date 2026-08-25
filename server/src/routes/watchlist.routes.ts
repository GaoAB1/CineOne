/**
 * 追剧列表 CRUD + 进度更新。行按 user_id 隔离。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, type AuthedRequest } from '../middleware/auth';
import {
  createWatchItem,
  deleteWatchItem,
  listWatchlist,
  updateWatchItem,
} from '../services/watchlistService';
import type {
  MediaType,
  SeasonSnapshotEntry,
  WatchStatus,
} from '../types/domain';

const router = Router();
router.use(authRequired);

function requireUser(req: AuthedRequest): number {
  const user = req.user;
  if (!user) throw new ApiError(1002, '未登录', 401);
  return user.id;
}

function parseSnapshotInput(value: unknown): SeasonSnapshotEntry[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ApiError(1001, 'seasons_snapshot 必须为数组', 400);
  }
  return value.map((entry, idx) => {
    const obj = entry as Record<string, unknown>;
    const seasonNumber = Number(obj.seasonNumber);
    const episodeCount = Number(obj.episodeCount);
    if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeCount)) {
      throw new ApiError(
        1001,
        `seasons_snapshot[${idx}] 必须包含整数 seasonNumber 与 episodeCount`,
        400,
      );
    }
    return { seasonNumber, episodeCount };
  });
}

interface CreateBody {
  tmdb_id?: unknown;
  media_type?: unknown;
  title?: unknown;
  poster_path?: unknown;
  seasons_snapshot?: unknown;
}

/** GET /api/watchlist?status= */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    ok(res, listWatchlist(userId, status));
  }),
);

/** POST /api/watchlist —— 重复添加返回 4090 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const body = (req.body ?? {}) as CreateBody;
    const tmdbId = Number(body.tmdb_id);
    const mediaType =
      body.media_type === 'tv' ? ('tv' as const) : body.media_type === 'movie' ? ('movie' as const) : null;
    if (!mediaType) {
      throw new ApiError(1001, 'media_type 必须为 movie 或 tv', 400);
    }
    const item = createWatchItem(userId, {
      tmdbId,
      mediaType: mediaType as MediaType,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
      posterPath:
        typeof body.poster_path === 'string' && body.poster_path
          ? body.poster_path
          : undefined,
      seasonsSnapshot: parseSnapshotInput(body.seasons_snapshot),
    });
    ok(res, item, 201);
  }),
);

interface PatchBody extends CreateBody {
  status?: unknown;
  current_season?: unknown;
  current_episode?: unknown;
}

/** PATCH /api/watchlist/:id */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(1001, '非法的条目 ID', 400);
    }
    const body = (req.body ?? {}) as PatchBody;

    let status: WatchStatus | undefined;
    if (body.status !== undefined) {
      if (
        body.status !== 'watching' &&
        body.status !== 'finished' &&
        body.status !== 'dropped' &&
        body.status !== 'planned'
      ) {
        throw new ApiError(1001, 'status 非法', 400);
      }
      status = body.status;
    }

    const currentSeason =
      body.current_season !== undefined ? Number(body.current_season) : undefined;
    const currentEpisode =
      body.current_episode !== undefined ? Number(body.current_episode) : undefined;

    ok(
      res,
      updateWatchItem(userId, id, {
        status,
        currentSeason,
        currentEpisode,
        seasonsSnapshot: parseSnapshotInput(body.seasons_snapshot),
      }),
    );
  }),
);

/** DELETE /api/watchlist/:id */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(1001, '非法的条目 ID', 400);
    }
    deleteWatchItem(userId, id);
    ok(res, null);
  }),
);

export default router;
