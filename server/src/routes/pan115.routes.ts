/**
 * 115 网盘路由：登录状态 / 离线任务 / 目录解析 / 预设路径 / 推送磁力与种子。
 *
 * 推送入口与 qB 保持一致的返回结构（pushed/name/...），前端可复用同一套提示逻辑。
 */

import { Router } from 'express';
import { asyncHandler, ok, ApiError } from '../middleware/errorHandler';
import { authRequired } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { getSetting } from '../services/settingsService';
import { watchPan115Task } from '../services/notifyService';
import {
  addPan115Torrent,
  addPan115Url,
  clearPan115Tasks,
  deletePan115Tasks,
  downloadTorrentByUrl,
  getPan115Status,
  listPan115Dirs,
  listPan115Tasks,
  parsePan115Torrent,
  parsePresetPaths,
  resolvePan115CidByPath,
  resolvePresetCid,
  summarizePan115Tasks,
  type Pan115TaskBucket,
} from '../services/pan115Service';

const router = Router();

router.use(authRequired, rateLimit({ windowMs: 60_000, max: 60 }));

function asString(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string') throw new ApiError(1001, `${field} 必须为字符串`, 400);
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(1001, `${field} 不能为空`, 400);
  if (trimmed.length > max) throw new ApiError(1001, `${field} 过长`, 400);
  return trimmed;
}

function optionalString(value: unknown, max = 4000): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** 解析目标目录：优先显式 cid → 预设名 → 按类型默认目录 → 全局默认目录 */
async function resolveTargetCid(opts: {
  cid?: string;
  dirName?: string;
  type?: string;
}): Promise<string> {
  if (opts.cid && opts.cid.trim()) return await resolvePresetCid(opts.cid.trim());

  const type = (opts.type ?? '').trim();
  const scope = type === 'tv' ? 'pan115_save_path_tv' : type === 'movie' ? 'pan115_save_path_movie' : '';
  if (scope) {
    const value = getSetting(scope as 'pan115_save_path_tv').trim();
    if (value) return await resolvePresetCid(value);
  }

  if (opts.dirName && opts.dirName.trim()) return await resolvePresetCid(opts.dirName.trim());

  const fallback = getSetting('pan115_save_path').trim();
  return fallback ? await resolvePresetCid(fallback) : '0';
}

/** GET /api/pan115/status */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, await getPan115Status());
  }),
);

/** GET /api/pan115/paths —— 预设目录（供推送弹层下拉） */
router.get(
  '/paths',
  asyncHandler(async (_req, res) => {
    ok(res, {
      presets: parsePresetPaths(getSetting('pan115_paths')),
      defaultCid: getSetting('pan115_save_path').trim(),
      moviePath: getSetting('pan115_save_path_movie').trim(),
      tvPath: getSetting('pan115_save_path_tv').trim(),
      folderPerTask: getSetting('pan115_folder_per_task') === '1',
    });
  }),
);

/** GET /api/pan115/dirs?cid=0 —— 浏览网盘目录 */
router.get(
  '/dirs',
  asyncHandler(async (req, res) => {
    const cid = typeof req.query.cid === 'string' ? req.query.cid.trim() : '0';
    ok(res, { cid: cid || '0', entries: await listPan115Dirs(cid || '0') });
  }),
);

/** POST /api/pan115/resolve { path } —— 路径 → CID */
router.post(
  '/resolve',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const path = asString(raw.path, 'path', 500);
    const cid = await resolvePan115CidByPath(path);
    ok(res, { path, cid });
  }),
);

/**
 * GET /api/pan115/tasks?bucket=downloading|completed|error
 * 离线任务列表；带 bucket 时只返回该分组（下载中/已完成/异常）。
 */
router.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.bucket === 'string' ? req.query.bucket.trim() : '';
    const bucket = raw as Pan115TaskBucket | '';
    const valid = bucket === 'downloading' || bucket === 'completed' || bucket === 'error';
    const all = await listPan115Tasks();
    const tasks = valid ? all.filter((task) => task.bucket === bucket) : all;
    ok(res, { tasks, stats: summarizePan115Tasks(all) });
  }),
);

/** POST /api/pan115/tasks/delete { info_hashes: string[], delete_files?: boolean } */
router.post(
  '/tasks/delete',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const list = raw.info_hashes;
    if (!Array.isArray(list) || list.length === 0) {
      throw new ApiError(1001, 'info_hashes 不能为空', 400);
    }
    if (list.length > 100) throw new ApiError(1001, '单次最多删除 100 个任务', 400);
    const hashes = list.map((item) => asString(item, 'info_hash', 64));
    const deleteFiles = raw.delete_files === true || raw.delete_files === 'true';
    await deletePan115Tasks(hashes, deleteFiles);
    ok(res, { deleted: hashes.length, deleteFiles });
  }),
);

/**
 * POST /api/pan115/tasks/clear { include_failed?: boolean, delete_files?: boolean }
 * 一键清理：默认清理全部「已完成」任务，include_failed 为真时连失败任务一并清理。
 */
router.post(
  '/tasks/clear',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const includeFailed = raw.include_failed === true || raw.include_failed === 'true';
    const deleteFiles = raw.delete_files === true || raw.delete_files === 'true';
    const deleted = await clearPan115Tasks({ includeFailed, deleteFiles });
    ok(res, { deleted, includeFailed, deleteFiles });
  }),
);

/**
 * POST /api/pan115/url { url, cid?, dir?, type? }
 * 推送磁力 / 直链到 115 离线下载。
 */
router.post(
  '/url',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const url = asString(raw.url, 'url', 4000);
    if (!/^magnet:\?xt=urn:btih:[a-z0-9]{32,}/i.test(url) && !/^https?:\/\//i.test(url) && !/^ed2k:\/\//i.test(url)) {
      throw new ApiError(1001, '仅支持磁力、ED2K 或 http(s) 直链', 400);
    }
    const cid = await resolveTargetCid({
      cid: optionalString(raw.cid, 64),
      dirName: optionalString(raw.dir, 200),
      type: optionalString(raw.type, 20),
    });
    const result = await addPan115Url({ url, cid });
    // 推送成功 → 注册即时跟随检测，完成后立即 Bark 通知（无需等全局轮询）
    watchPan115Task(result.infoHash, result.name || url.slice(0, 80));
    ok(res, {
      pushed: true,
      target: '115',
      cid,
      infoHash: result.infoHash,
      name: result.name || url.slice(0, 80),
    });
  }),
);

/**
 * POST /api/pan115/torrent/parse —— 上传种子并解析文件树（不创建任务）
 * 请求：multipart/form-data，字段 file；或 JSON { torrent_base64, filename }
 */
router.post(
  '/torrent/parse',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const base64 = typeof raw.torrent_base64 === 'string' ? raw.torrent_base64 : '';
    const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
    if (!base64) throw new ApiError(1001, '缺少 torrent_base64', 400);
    if (filename && !/\.torrent$/i.test(filename)) {
      throw new ApiError(1001, '种子文件名需以 .torrent 结尾', 400);
    }
    const cleaned = base64.replace(/^data:application\/x-bittorrent;base64,/, '');
    if (cleaned.length > 8_000_000) throw new ApiError(1001, '种子文件过大', 400);
    let data: Uint8Array;
    try {
      data = new Uint8Array(Buffer.from(cleaned, 'base64'));
    } catch {
      throw new ApiError(1001, 'torrent_base64 解码失败', 400);
    }
    if (data.length < 30) throw new ApiError(1001, '种子文件内容无效', 400);
    const info = await parsePan115Torrent({
      filename: filename || `upload-${Date.now()}.torrent`,
      data,
    });
    ok(res, info);
  }),
);

/**
 * POST /api/pan115/torrent/add
 * { info_hash, name, torrent_sha1, pick_code, files?, wanted_indexes?, cid?, dir?, type?, save_path? }
 * 提交 BT 离线任务（wanted_indexes 为空则按 115 默认勾选）。
 */
router.post(
  '/torrent/add',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const infoHash = asString(raw.info_hash, 'info_hash', 64);
    const name = optionalString(raw.name, 300) || infoHash;
    const torrentSha1 = asString(raw.torrent_sha1, 'torrent_sha1', 64);
    const pickCode = asString(raw.pick_code, 'pick_code', 64);

    const rawFiles = Array.isArray(raw.files) ? raw.files : [];
    const files = rawFiles.map((item, index) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return {
        index: typeof entry.index === 'number' ? entry.index : index,
        path: typeof entry.path === 'string' ? entry.path : '',
        size: typeof entry.size === 'number' ? entry.size : 0,
        wanted: typeof entry.wanted === 'number' ? entry.wanted : 1,
      };
    });

    const wantedIndexes = Array.isArray(raw.wanted_indexes)
      ? raw.wanted_indexes.filter((n): n is number => typeof n === 'number')
      : undefined;

    const cid = await resolveTargetCid({
      cid: optionalString(raw.cid, 64),
      dirName: optionalString(raw.dir, 200),
      type: optionalString(raw.type, 20),
    });

    const folderPerTask = getSetting('pan115_folder_per_task') === '1';
    const result = await addPan115Torrent({
      info: {
        infoHash,
        name,
        size: 0,
        fileCount: files.length,
        files,
        torrentSha1,
        pickCode,
      },
      wantedIndexes,
      cid,
      savePath: folderPerTask ? optionalString(raw.save_path, 300) || name : '',
    });
    // 推送成功 → 注册即时跟随检测，完成后立即 Bark 通知
    watchPan115Task(result.infoHash, result.name || name);
    ok(res, {
      pushed: true,
      target: '115',
      cid,
      infoHash: result.infoHash,
      name: result.name || name,
      selected: wantedIndexes?.length ?? 'auto',
    });
  }),
);

/**
 * POST /api/pan115/torrent/from-url
 * { url, cid?, dir?, type? } —— 传磁力或 .torrent 直链，由后端抓取种子并解析文件树。
 * 用于搜索结果里的磁力/种子在没有本地文件时的“先预览再勾选”流程。
 */
router.post(
  '/torrent/from-url',
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const url = asString(raw.url, 'url', 4000);

    let data: Uint8Array | null = null;
    let filename = `remote-${Date.now()}.torrent`;

    if (/\.torrent(\?|$)/i.test(url) || /^https?:\/\//i.test(url)) {
      // 直链种子：下载后交给 115 解析
      const torrent = await downloadTorrentByUrl(url);
      data = torrent.data;
      filename = torrent.filename;
    } else {
      throw new ApiError(
        1001,
        '该来源只提供磁力，115 需要先由服务端获取种子才能预览文件；可直接推送整体下载',
        400,
      );
    }

    if (!data || data.length < 30) {
      throw new ApiError(2005, '未获取到有效的种子文件', 502);
    }
    const info = await parsePan115Torrent({ filename, data });
    ok(res, info);
  }),
);

export default router;
