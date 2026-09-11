/**
 * 资源搜索路由：代理 BT 站 1lou 的搜索结果，供站内「资源搜索」页展示；
 * 并提供「一键推送到 qBittorrent 下载」。
 */

import { Router } from 'express';
import { asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { ApiError } from '../middleware/errorHandler';
import { getSetting } from '../services/settingsService';
import { addTorrentFile } from '../services/qbService';
import {
  downloadTorrent,
  fetchThreadAttachments,
  searchResources,
} from '../services/resourceService';

const SITE_BASE = 'https://1lou.cc';
const router = Router();

// 源站搜索较慢且为第三方站点，限流从严
router.use(authRequired, rateLimit({ windowMs: 60_000, max: 20 }));

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

/**
 * POST /api/resources/download
 * body: { tid: string; type?: 'movie'|'tv'; save_path?: string; category?: string }
 * 流程：帖子页解析 .torrent 附件 → 下载种子 → 上传 qBittorrent（savepath/category 按类型兜底）。
 */
router.post(
  '/download',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tid = String(body.tid ?? '').trim();
    if (!/^\d+$/.test(tid)) throw new ApiError(1001, 'tid 必须为数字', 400);

    const type = body.type === 'tv' ? 'tv' : 'movie';
    const customPath = typeof body.save_path === 'string' ? body.save_path.trim() : '';
    const customCategory = typeof body.category === 'string' ? body.category.trim() : '';

    // 未显式指定保存位置时，按媒体类型回落到设置中的默认目录
    const savePath =
      customPath ||
      (type === 'tv' ? getSetting('qb_save_path_tv').trim() : getSetting('qb_save_path_movie').trim());
    const category =
      customCategory ||
      (type === 'tv' ? getSetting('qb_category_tv').trim() : getSetting('qb_category_movie').trim());

    const attachments = await fetchThreadAttachments(tid);
    if (attachments.length === 0) {
      throw new ApiError(2005, '该帖子未找到 .torrent 附件', 404);
    }

    const torrent = await downloadTorrent(attachments[0]);
    await addTorrentFile({
      filename: torrent.filename,
      data: torrent.data,
      savePath,
      category,
    });

    ok(res, {
      pushed: true,
      name: torrent.filename,
      savePath: savePath || null,
      category: category || null,
      threadUrl: `${SITE_BASE}/thread-${tid}.htm`,
    });
  }),
);

export default router;
