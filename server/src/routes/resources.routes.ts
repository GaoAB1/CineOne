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
import { addTorrentFile, addTorrentUrl } from '../services/qbService';
import { fetchHgemeResources, pingHgeme } from '../services/hgemeService';
import {
  downloadTorrent,
  fetchThreadAttachments,
  searchAggregated,
  type ResourceSourceFilter,
} from '../services/resourceService';

const SITE_BASE = 'https://1lou.cc';
const HgemeBase = 'https://www.hgeme.com';
const router = Router();

// 源站搜索较慢且为第三方站点，限流从严
router.use(authRequired, rateLimit({ windowMs: 60_000, max: 20 }));

/** GET /api/resources/search?q=&page=&source=all|1lou|hgeme —— 多源资源搜索 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) throw new ApiError(1001, '搜索关键词 q 不能为空', 400);
    if (q.length > 80) throw new ApiError(1001, '搜索关键词过长', 400);
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    const rawSource = typeof req.query.source === 'string' ? req.query.source : 'all';
    const source: ResourceSourceFilter =
      rawSource === '1lou' || rawSource === 'hgeme' ? rawSource : 'all';
    ok(res, await searchAggregated(q, page, source));
  }),
);

/** GET /api/resources/hgeme/status —— hgeme 会话可用性探测（必要时自动完成 PoW 验证） */
router.get(
  '/hgeme/status',
  asyncHandler(async (_req, res) => {
    ok(res, await pingHgeme());
  }),
);

/** GET /api/resources/hgeme/resources?dir=&id= —— hgeme 条目的磁力与网盘资源 */
router.get(
  '/hgeme/resources',
  asyncHandler(async (req, res) => {
    const dir = typeof req.query.dir === 'string' ? req.query.dir.trim() : '';
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!dir || !id) throw new ApiError(1001, 'dir 与 id 均为必填', 400);
    ok(res, await fetchHgemeResources(dir, id));
  }),
);

/**
 * POST /api/resources/download
 * body: { source?: '1lou'|'hgeme'; type?: 'movie'|'tv'; save_path?: string; category?: string }
 *   1lou（默认）：{ tid } —— 解析帖子附件 .torrent 后上传
 *   hgeme：{ dir, id, index? } 或 { dir, id, magnet } —— 取该条目磁力推送到 qB
 */
router.post(
  '/download',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = body.source === 'hgeme' ? 'hgeme' : '1lou';
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

    if (source === 'hgeme') {
      const dir = String(body.dir ?? '').trim();
      const id = String(body.id ?? '').trim();
      const directMagnet = typeof body.magnet === 'string' ? body.magnet.trim() : '';
      let magnet = directMagnet;
      let name = typeof body.title === 'string' ? body.title.trim() : '';

      if (!magnet) {
        const resources = await fetchHgemeResources(dir, id);
        const index = Number.parseInt(String(body.index ?? '0'), 10) || 0;
        const picked = resources.magnets[index];
        if (!picked) throw new ApiError(2005, '该条目没有可用的磁力资源', 404);
        magnet = picked.magnet;
        name = name || picked.title;
      }
      if (!/^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}/i.test(magnet)) {
        throw new ApiError(1001, 'magnet 链接格式非法', 400);
      }
      await addTorrentUrl({ url: magnet, savePath, category });
      ok(res, {
        pushed: true,
        name: name || 'hgme 资源',
        savePath: savePath || null,
        category: category || null,
        threadUrl: dir && id ? `${HgemeBase}/${dir}/${id}` : HgemeBase,
      });
      return;
    }

    const tid = String(body.tid ?? '').trim();
    if (!/^\d+$/.test(tid)) throw new ApiError(1001, 'tid 必须为数字', 400);

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
