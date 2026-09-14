/**
 * 通知推送路由：Bark 测试推送。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { testBark } from '../services/barkService';

const router = Router();
router.use(authRequired);

/** POST /api/notify/test —— 发送 Bark 测试推送 */
router.post(
  '/test',
  asyncHandler(async (_req, res) => {
    const result = await testBark();
    ok(res, result);
  }),
);

export default router;
