/**
 * 四源评分查询 + 管理员手动修正。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin } from '../middleware/auth';
import {
  getAggregatedRatings,
  putManualRating,
} from '../services/ratingsService';
import type { MediaType, RatingSourceKey } from '../types/domain';

const router = Router();

function parseTypeAndId(
  type: string,
  rawId: string,
): { mediaType: MediaType; id: number } {
  if (type !== 'movie' && type !== 'tv') {
    throw new ApiError(1004, `未知的媒体类型：${type}`, 404);
  }
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(1001, '非法的资源 ID', 400);
  }
  return { mediaType: type, id };
}

/** GET /api/ratings/:type/:id（登录）—— TMDB 实时 + 三源缓存聚合 */
router.get(
  '/:type/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { mediaType, id } = parseTypeAndId(req.params.type, req.params.id);
    const aggregate = await getAggregatedRatings(id, mediaType, null);
    ok(res, aggregate);
  }),
);

/** PUT /api/ratings/:type/:id/manual（管理员） */
router.put(
  '/:type/:id/manual',
  authRequired,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { mediaType, id } = parseTypeAndId(req.params.type, req.params.id);
    const body = (req.body ?? {}) as {
      source?: unknown;
      score?: unknown;
      raw_text?: unknown;
    };
    if (
      body.source !== 'douban' &&
      body.source !== 'tomato' &&
      body.source !== 'popcorn'
    ) {
      throw new ApiError(1001, 'source 必须为 douban / tomato / popcorn', 400);
    }
    const score =
      typeof body.score === 'number' && Number.isFinite(body.score)
        ? body.score
        : null;
    const updated = putManualRating(id, mediaType, {
      source: body.source as RatingSourceKey,
      score,
      raw_text: typeof body.raw_text === 'string' ? body.raw_text : undefined,
    });
    ok(res, updated);
  }),
);

export default router;
