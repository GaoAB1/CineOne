/**
 * 媒体重命名路由（源自 Media-Renamer 项目合并）：
 * 扫描 / 条目 / TMDB 匹配 / 重命名预览与执行 / 日志 / 目录浏览 / 设置。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin, type AuthedRequest } from '../middleware/auth';
import {
  autoMatchBatch,
  autoMatchItem,
  buildPreview,
  executeRename,
  getRenamerSettings,
  getScanState,
  listDirs,
  listMediaItems,
  listRenameLogs,
  manualMatchItem,
  saveRenamerSettings,
  searchTmdb,
  startScan,
} from '../services/mediaRenamerService';

const router = Router();
router.use(authRequired, requireAdmin);

function bodyOf(req: AuthedRequest): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function idArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(1001, `${field} 不能为空`, 400);
  }
  const ids = value.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw new ApiError(1001, `${field} 无有效 ID`, 400);
  return ids;
}

/** GET /api/renamer/settings */
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    ok(res, getRenamerSettings());
  }),
);

/** PUT /api/renamer/settings { dirs?: [{type,path}] } */
router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const body = bodyOf(req);
    saveRenamerSettings({
      dirs: body.dirs as Array<{ type: 'movie' | 'tv'; path: string }> | undefined,
    });
    ok(res, getRenamerSettings());
  }),
);

/** GET /api/renamer/dirs?path= —— 目录浏览（前端目录选择器） */
router.get(
  '/dirs',
  asyncHandler(async (req, res) => {
    const p = typeof req.query.path === 'string' ? req.query.path : '';
    ok(res, listDirs(p));
  }),
);

/** POST /api/renamer/scan —— 启动全量扫描 */
router.post(
  '/scan',
  asyncHandler(async (_req, res) => {
    ok(res, startScan());
  }),
);

/** GET /api/renamer/scan/state —— 扫描进度 */
router.get(
  '/scan/state',
  asyncHandler(async (_req, res) => {
    ok(res, getScanState());
  }),
);

/** GET /api/renamer/items?status=&type= */
router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    ok(res, { items: listMediaItems({ status, type }) });
  }),
);

/** GET /api/renamer/search?q=&kind=&year= —— TMDB 搜索（手动匹配弹窗） */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw new ApiError(1001, '缺少搜索关键词', 400);
    const kind = req.query.kind === 'tv' ? 'tv' : 'movie';
    const year = req.query.year ? Number.parseInt(String(req.query.year), 10) : undefined;
    ok(res, { results: await searchTmdb(kind, q, Number.isFinite(year) ? year : undefined) });
  }),
);

/** POST /api/renamer/items/:id/auto-match */
router.post(
  '/items/:id/auto-match',
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(1001, '非法 ID', 400);
    ok(res, { item: await autoMatchItem(id) });
  }),
);

/** POST /api/renamer/items/:id/match { tmdbId, kind } */
router.post(
  '/items/:id/match',
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(1001, '非法 ID', 400);
    const body = bodyOf(req);
    const tmdbId = Number(body.tmdb_id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new ApiError(1001, 'tmdb_id 非法', 400);
    if (body.kind !== 'movie' && body.kind !== 'tv') throw new ApiError(1001, 'kind 必须为 movie 或 tv', 400);
    ok(res, { item: await manualMatchItem(id, body.kind, tmdbId) });
  }),
);

/** POST /api/renamer/match/batch { ids } —— 批量自动匹配（限 50 条/次） */
router.post(
  '/match/batch',
  asyncHandler(async (req, res) => {
    const ids = idArray(bodyOf(req).ids, 'ids');
    ok(res, await autoMatchBatch(ids));
  }),
);

/** POST /api/renamer/rename/preview { ids } */
router.post(
  '/rename/preview',
  asyncHandler(async (req, res) => {
    const ids = idArray(bodyOf(req).ids, 'ids');
    const { plan } = buildPreview(ids);
    if (plan.length === 0) {
      throw new ApiError(1001, '所选条目均无法生成重命名计划', 400);
    }
    ok(res, { plan });
  }),
);

/** POST /api/renamer/rename/execute { plan: [{id,newPath}] } */
router.post(
  '/rename/execute',
  asyncHandler(async (req, res) => {
    const raw = bodyOf(req).plan;
    if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(1001, '重命名计划为空', 400);
    const plan = raw
      .map((entry) => entry as { id?: unknown; newPath?: unknown })
      .filter((e) => Number.isInteger(Number(e.id)) && Number(e.id) > 0 && typeof e.newPath === 'string' && e.newPath.length > 0)
      .map((e) => ({ id: Number(e.id), newPath: String(e.newPath) }));
    if (plan.length === 0) throw new ApiError(1001, '重命名计划无有效条目', 400);
    ok(res, executeRename(plan));
  }),
);

/** GET /api/renamer/logs */
router.get(
  '/logs',
  asyncHandler(async (_req, res) => {
    ok(res, { logs: listRenameLogs() });
  }),
);

export default router;
