/**
 * 资源搜索路由：代理 BT 站 1lou 的搜索结果，供站内「资源搜索」页展示。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { ApiError } from '../middleware/errorHandler';
import { searchResources } from '../services/resourceService';

const router = Router();

// 源站搜索较慢且为第三方站点，限流从严
router.use(authRequired, rateLimit({ windowMs: 60_000, max: 10 }));

/** GET /api/resources/search?q=&page= —— 站内资源搜索结果 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw new ApiError(1001, '搜索关键词 q 不能为空', 400);
    if (q.length > 80) throw new ApiError(1001, '搜索关键词过长', 400);
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    ok(res, await searchResources(q, page));
  }),
);

export default router;
