/**
 * Emby 接入路由：状态探测 / 手动同步（仅 admin）/ 播放跳转。
 * 全部端点 JWT 保护；sync 需管理员身份（照抄 watchlist.routes 的判定方式）。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin } from '../middleware/auth';
import {
  getEmbyStatus,
  getLibraryItems,
  getPlayInfo,
  getPlayUrl,
  loginEmby,
  logoutEmby,
  reportPlayback,
  syncEmbyLibrary,
} from '../services/embyService';

const router = Router();
router.use(authRequired);

/** POST /api/emby/login {server_url, username, password} → AuthenticateByName 并持久化 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await loginEmby({
      serverUrl: typeof body.server_url === 'string' ? body.server_url : '',
      username: typeof body.username === 'string' ? body.username : '',
      password: typeof body.password === 'string' ? body.password : '',
    });
    ok(res, result);
  }),
);

/** POST /api/emby/logout —— 清空登录态（AccessToken/用户 ID） */
router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    logoutEmby();
    ok(res, null);
  }),
);

/** GET /api/emby/library?page=&page_size=&search=&type=all|movie|tv —— 浏览页实时分页 */
router.get(
  '/library',
  asyncHandler(async (req, res) => {
    const pageNum = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = Number.parseInt(String(req.query.page_size ?? '40'), 10) || 40;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const typeRaw = typeof req.query.type === 'string' ? req.query.type : 'all';
    const itemType = typeRaw === 'movie' || typeRaw === 'tv' ? typeRaw : 'all';
    ok(
      res,
      await getLibraryItems({
        startIndex: (Math.max(1, pageNum) - 1) * pageSize,
        limit: pageSize,
        search,
        itemType,
      }),
    );
  }),
);

/** GET /api/emby/playinfo/:itemId → {title, hlsUrl, runtimeTicks, playSessionId} */
router.get(
  '/playinfo/:itemId',
  asyncHandler(async (req, res) => {
    const itemId = (req.params.itemId ?? '').trim();
    if (!itemId) throw new ApiError(1001, '非法的条目 ID', 400);
    ok(res, await getPlayInfo(itemId));
  }),
);

/** POST /api/emby/playing/:itemId {event, positionTicks, paused, playSessionId} —— 进度上报 */
router.post(
  '/playing/:itemId',
  asyncHandler(async (req, res) => {
    const itemId = (req.params.itemId ?? '').trim();
    if (!itemId) throw new ApiError(1001, '非法的条目 ID', 400);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const eventRaw = typeof body.event === 'string' ? body.event : '';
    if (eventRaw !== 'start' && eventRaw !== 'progress' && eventRaw !== 'stop') {
      throw new ApiError(1001, 'event 必须为 start | progress | stop', 400);
    }
    const delivered = await reportPlayback(itemId, {
      event: eventRaw,
      positionTicks:
        typeof body.position_ticks === 'number' ? body.position_ticks : undefined,
      paused: typeof body.paused === 'boolean' ? body.paused : undefined,
      playSessionId:
        typeof body.play_session_id === 'string' ? body.play_session_id : undefined,
    });
    ok(res, { delivered });
  }),
);

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
