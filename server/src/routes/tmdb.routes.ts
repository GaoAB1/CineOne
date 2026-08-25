/**
 * TMDB 代理路由：status / home / search / detail。
 * 全部挂简易限流防滥用。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import {
  getDetail,
  getHomeSections,
  searchMulti,
} from '../services/tmdbService';
import { hasTmdbApiKey } from '../services/settingsService';
import { ApiError } from '../middleware/errorHandler';
import type { MediaType } from '../types/domain';

const router = Router();

router.use(authRequired, rateLimit({ windowMs: 60_000, max: 60 }));

/** GET /api/tmdb/status */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, { configured: hasTmdbApiKey() });
  }),
);

/** GET /api/tmdb/home?window=week */
router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const window = typeof req.query.window === 'string' ? req.query.window : 'week';
    ok(res, { sections: await getHomeSections(window) });
  }),
);

/** GET /api/tmdb/search?q=&page= */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw new ApiError(1001, '搜索关键词 q 不能为空', 400);
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    ok(res, await searchMulti(q, page));
  }),
);

/** GET /api/tmdb/detail/:type/:id */
router.get(
  '/detail/:type/:id',
  asyncHandler(async (req, res) => {
    const type = req.params.type;
    if (type !== 'movie' && type !== 'tv') {
      throw new ApiError(1004, `未知的媒体类型：${type}`, 404);
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(1001, '非法的资源 ID', 400);
    }
    ok(res, await getDetail(type as MediaType, id));
  }),
);

export default router;
