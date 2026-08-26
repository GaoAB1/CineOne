/**
 * MoviePilot 订阅路由：状态探测 / 查重 / 推送订阅（写 subscribe_log）。全 JWT 保护。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, type AuthedRequest } from '../middleware/auth';
import {
  getMoviePilotStatus,
  isSubscribed,
  subscribeAndLog,
} from '../services/moviepilotService';
import type { MediaType } from '../types/domain';

const router = Router();
router.use(authRequired);

function requireUser(req: AuthedRequest): number {
  const user = req.user;
  if (!user) throw new ApiError(1002, '未登录', 401);
  return user.id;
}

function parseMediaType(raw: string): MediaType {
  if (raw !== 'movie' && raw !== 'tv') {
    throw new ApiError(1001, 'media_type 必须为 movie 或 tv', 400);
  }
  return raw;
}

/** GET /api/moviepilot/status → {configured, reachable} */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, await getMoviePilotStatus());
  }),
);

/** GET /api/moviepilot/subscribed/:tmdbId/:mediaType → {subscribed: boolean} */
router.get(
  '/subscribed/:tmdbId/:mediaType',
  asyncHandler(async (req, res) => {
    const tmdbId = Number.parseInt(req.params.tmdbId, 10);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new ApiError(1001, '非法的条目 ID', 400);
    }
    const mediaType = parseMediaType(req.params.mediaType);
    ok(res, { subscribed: await isSubscribed(tmdbId, mediaType) });
  }),
);

interface SubscribeBody {
  tmdb_id?: unknown;
  media_type?: unknown;
  title?: unknown;
  year?: unknown;
  season?: unknown;
}

/** POST /api/moviepilot/subscribe —— 推送订阅并落 subscribe_log（成败均记录） */
router.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const body = (req.body ?? {}) as SubscribeBody;

    const tmdbId = Number(body.tmdb_id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new ApiError(1001, 'tmdb_id 必须为正整数', 400);
    }
    if (body.media_type !== 'movie' && body.media_type !== 'tv') {
      throw new ApiError(1001, 'media_type 必须为 movie 或 tv', 400);
    }
    if (typeof body.title !== 'string' || !body.title.trim()) {
      throw new ApiError(1001, 'title 不能为空', 400);
    }
    let year: number | null = null;
    if (body.year != null) {
      year = Number(body.year);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        throw new ApiError(1001, 'year 必须为合理年份', 400);
      }
    }
    let season: number | null = null;
    if (body.season != null && body.media_type === 'tv') {
      season = Number(body.season);
      if (!Number.isInteger(season) || season < 1) {
        throw new ApiError(1001, 'season 必须为 ≥1 的整数', 400);
      }
    }

    const result = await subscribeAndLog(userId, {
      title: body.title.trim(),
      mediaType: body.media_type,
      tmdbId,
      year,
      season,
    });
    ok(res, result, 201);
  }),
);

export default router;
