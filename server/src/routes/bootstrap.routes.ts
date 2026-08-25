/**
 * GET /api/bootstrap —— 系统初始化状态（公开）。
 */

import { Router } from 'express';
import { getDb } from '../db/database';
import { asyncHandler, ok } from '../middleware/errorHandler';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'")
      .get() as { cnt: number };
    ok(res, { initialized: row.cnt > 0 });
  }),
);

export default router;
