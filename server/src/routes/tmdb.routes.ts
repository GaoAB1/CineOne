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
import { fetchUpcoming } from '../services/tmdbUpcoming';
import {
  discoverProviderItems,
  listProviderRegions,
} from '../services/providerService';
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

/** GET /api/tmdb/upcoming?limit=10 —— 即将上映（今天~90 天，升序） */
router.get(
  '/upcoming',
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? '10'), 10) || 10;
    ok(res, { items: await fetchUpcoming(Math.min(50, Math.max(1, limit))) });
  }),
);

/** GET /api/tmdb/providers —— 流媒体平台分组（美区/国区，供首页平台入口卡） */
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    ok(res, { regions: await listProviderRegions() });
  }),
);

/** GET /api/tmdb/providers/items?region=us&provider_id=8&type=movie&page=1 —— 平台条目分页 */
router.get(
  '/providers/items',
  asyncHandler(async (req, res) => {
    const regionKey = typeof req.query.region === 'string' ? req.query.region : '';
    const type = typeof req.query.type === 'string' ? req.query.type : 'movie';
    if (regionKey !== 'us' && regionKey !== 'cn') {
      throw new ApiError(1001, 'region 仅支持 us / cn', 400);
    }
    if (type !== 'movie' && type !== 'tv') {
      throw new ApiError(1001, 'type 仅支持 movie / tv', 400);
    }
    const providerId = Number.parseInt(String(req.query.provider_id ?? ''), 10);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      throw new ApiError(1001, 'provider_id 必须为正整数', 400);
    }
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = Math.min(60, Math.max(1, Number.parseInt(String(req.query.page_size ?? '40'), 10) || 40));
    ok(
      res,
      await discoverProviderItems({
        regionKey,
        providerId,
        mediaType: type as MediaType,
        page,
        pageSize,
      }),
    );
  }),
);

export default router;
