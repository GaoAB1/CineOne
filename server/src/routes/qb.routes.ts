/**
 * qBittorrent 路由：连接状态 / 任务列表 / 暂停·恢复·删除 / 路径信息。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { ApiError } from '../middleware/errorHandler';
import { getSetting } from '../services/settingsService';
import {
  controlTorrents,
  getDefaultSavePath,
  getQbStatus,
  listTorrents,
} from '../services/qbService';

const router = Router();

router.use(authRequired, rateLimit({ windowMs: 60_000, max: 60 }));

function parseHashes(body: unknown): string {
  const raw = (body ?? {}) as Record<string, unknown>;
  const hashes = typeof raw.hashes === 'string' ? raw.hashes.trim() : '';
  if (!hashes) throw new ApiError(1001, 'hashes 不能为空', 400);
  if (hashes.length > 4000) throw new ApiError(1001, 'hashes 过长', 400);
  // 允许 all 或 hash 列表（| 分隔）
  if (hashes !== 'all' && !/^[a-fA-F0-9|]+$/.test(hashes)) {
    throw new ApiError(1001, 'hashes 格式非法', 400);
  }
  return hashes;
}

/** GET /api/qb/status */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, await getQbStatus());
  }),
);

/** GET /api/qb/torrents —— 任务列表 */
router.get(
  '/torrents',
  asyncHandler(async (_req, res) => {
    ok(res, { torrents: await listTorrents() });
  }),
);

/** GET /api/qb/paths —— 预设路径与默认路径（供下载弹窗预选） */
router.get(
  '/paths',
  asyncHandler(async (_req, res) => {
    let defaultSavePath: string | null = null;
    try {
      defaultSavePath = await getDefaultSavePath();
    } catch {
      // 未配置或不可达时不影响预设路径回显
    }
    const presetPaths = getSetting('qb_save_paths')
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    ok(res, {
      defaultSavePath,
      presetPaths,
      moviePath: getSetting('qb_save_path_movie').trim(),
      tvPath: getSetting('qb_save_path_tv').trim(),
      movieCategory: getSetting('qb_category_movie').trim(),
      tvCategory: getSetting('qb_category_tv').trim(),
    });
  }),
);

/** POST /api/qb/pause { hashes } */
router.post(
  '/pause',
  asyncHandler(async (req, res) => {
    await controlTorrents('pause', parseHashes(req.body));
    ok(res, { paused: true });
  }),
);

/** POST /api/qb/resume { hashes } */
router.post(
  '/resume',
  asyncHandler(async (req, res) => {
    await controlTorrents('resume', parseHashes(req.body));
    ok(res, { resumed: true });
  }),
);

/** POST /api/qb/delete { hashes, delete_files } */
router.post(
  '/delete',
  asyncHandler(async (req, res) => {
    const hashes = parseHashes(req.body);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const deleteFiles = raw.delete_files === true || raw.delete_files === 'true';
    await controlTorrents('delete', hashes, deleteFiles);
    ok(res, { deleted: true, deleteFiles });
  }),
);

export default router;
