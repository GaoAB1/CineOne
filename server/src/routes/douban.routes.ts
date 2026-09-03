/**
 * 豆瓣条目直查路由：title(+year) → 豆瓣 subject 链接。
 * 供详情页「查找资源」在无聚合豆瓣链接时反查豆瓣用。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { resolveDoubanLink } from '../services/doubanService';
import { ApiError } from '../middleware/errorHandler';
import type { MediaType } from '../types/domain';

const router = Router();

router.use(authRequired, rateLimit({ windowMs: 60_000, max: 20 }));

/** GET /api/douban/resolve?type=&tmdb_id=&title=&year= */
router.get(
  '/resolve',
  asyncHandler(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    if (type !== 'movie' && type !== 'tv') {
      throw new ApiError(1001, 'type 必须为 movie / tv', 400);
    }
    const tmdbId = Number.parseInt(String(req.query.tmdb_id ?? ''), 10);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new ApiError(1001, '非法的 tmdb_id', 400);
    }
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    if (!title) throw new ApiError(1001, 'title 不能为空', 400);
    const yearRaw = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1888 || year > 2100)) {
      throw new ApiError(1001, '非法的 year', 400);
    }
    ok(
      res,
      await resolveDoubanLink({
        tmdbId,
        mediaType: type as MediaType,
        title,
        year,
      }),
    );
  }),
);

export default router;
