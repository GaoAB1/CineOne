/**
 * 播出日历路由：GET /api/calendar → {items, lastRefresh}。
 * JWT 保护；?refresh=1 强制绕过内存缓存回源（前端手动刷新按钮）。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { getCalendar } from '../services/calendarService';

const router = Router();
router.use(authRequired);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    ok(res, await getCalendar({ refresh }));
  }),
);

export default router;
