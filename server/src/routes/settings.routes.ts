/**
 * 系统设置 CRUD（管理员）。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin } from '../middleware/auth';
import {
  getSettingsView,
  updateSettings,
} from '../services/settingsService';

const router = Router();

router.use(authRequired, requireAdmin);

/** GET /api/settings —— Key 打码 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    ok(res, getSettingsView());
  }),
);

/** PUT /api/settings —— 局部更新 {key: value, …} */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = (req.body ?? {}) as Record<string, unknown>;
    updateSettings(patch);
    ok(res, getSettingsView());
  }),
);

export default router;
