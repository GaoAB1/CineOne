/**
 * 想看（upcoming）路由：加入 / 本人列表 / 删除（仅本人）。全 JWT 保护。
 * 模式照抄 watchlist.routes.ts。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, type AuthedRequest } from '../middleware/auth';
import {
  createUpcomingItem,
  deleteUpcomingItem,
  listUpcoming,
} from '../services/upcomingService';
import type { MediaType } from '../types/domain';

const router = Router();
router.use(authRequired);

function requireUser(req: AuthedRequest): number {
  const user = req.user;
  if (!user) throw new ApiError(1002, '未登录', 401);
  return user.id;
}

interface CreateBody {
  tmdb_id?: unknown;
  media_type?: unknown;
  title?: unknown;
  poster_path?: unknown;
  release_date?: unknown;
  note?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** GET /api/upcoming —— 本人列表，release_date 升序 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    ok(res, listUpcoming(userId));
  }),
);

/** POST /api/upcoming —— 重复添加返回 4091 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const body = (req.body ?? {}) as CreateBody;
    const tmdbId = Number(body.tmdb_id);
    const mediaType =
      body.media_type === 'tv'
        ? ('tv' as const)
        : body.media_type === 'movie'
          ? ('movie' as const)
          : null;
    if (!mediaType) {
      throw new ApiError(1001, 'media_type 必须为 movie 或 tv', 400);
    }
    if (body.note !== undefined && typeof body.note !== 'string') {
      throw new ApiError(1001, 'note 必须为字符串', 400);
    }
    const item = createUpcomingItem(userId, {
      tmdbId,
      mediaType: mediaType as MediaType,
      title: optionalString(body.title),
      posterPath: optionalString(body.poster_path) ?? null,
      releaseDate: optionalString(body.release_date) ?? null,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    });
    ok(res, item, 201);
  }),
);

/** DELETE /api/upcoming/:id —— 仅本人可删 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req as AuthedRequest);
    const id = Number.parseInt(req.params.id, 10);
    deleteUpcomingItem(userId, id);
    ok(res, null);
  }),
);

export default router;
