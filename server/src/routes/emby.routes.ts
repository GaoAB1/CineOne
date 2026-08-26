/**
 * Emby 接入路由：状态探测 / 手动同步（仅 admin）/ 播放跳转。
 * 全部端点 JWT 保护；sync 需管理员身份（照抄 watchlist.routes 的判定方式）。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin } from '../middleware/auth';
import {
  getEmbyStatus,
  getPlayUrl,
  syncEmbyLibrary,
} from '../services/embyService';

const router = Router();
router.use(authRequired);

/** GET /api/emby/status → {configured, verified, serverName, itemCount, lastSync} */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, await getEmbyStatus());
  }),
);

/** POST /api/emby/sync —— 仅管理员手动触发 */
router.post(
  '/sync',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, await syncEmbyLibrary());
  }),
);

/** GET /api/emby/play/:tmdbId/:mediaType → {url}；未同步返回 404 */
router.get(
  '/play/:tmdbId/:mediaType',
  asyncHandler(async (req, res) => {
    const tmdbId = Number.parseInt(req.params.tmdbId, 10);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new ApiError(1001, '非法的条目 ID', 400);
    }
    const mediaTypeRaw = req.params.mediaType;
    if (mediaTypeRaw !== 'movie' && mediaTypeRaw !== 'tv') {
      throw new ApiError(1001, 'media_type 必须为 movie 或 tv', 400);
    }
    const url = getPlayUrl(tmdbId, mediaTypeRaw);
    if (!url) {
      throw new ApiError(3004, '该条目尚未同步到 Emby，请先执行媒体库同步', 404);
    }
    ok(res, { url });
  }),
);

export default router;
