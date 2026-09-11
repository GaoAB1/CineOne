/**
 * qBittorrent WebAPI v2 客户端（零依赖，Node 内置 fetch/FormData/Blob）。
 *
 * 能力：登录（SID cookie 缓存 + 403 自动重登）、添加种子文件、
 *       任务列表、暂停/恢复/删除、版本与默认保存路径查询。
 *
 * 注意：
 *  - qB 自 4.1 起校验 CSRF（Referer 必须与 WebUI 同源），所有请求带 Referer。
 *  - 用户名留空视为「免认证环境」（qB 勾选 localhost 免登录），跳过登录直接请求。
 *  - 登录失败抛 2004；网络不可达抛 2004(504)。
 */

import { ApiError } from '../middleware/errorHandler';
import { getSetting } from './settingsService';

const REQUEST_TIMEOUT_MS = 15_000;
const COOKIE_TTL_MS = 30 * 60 * 1000;
const NOT_CONFIGURED = () => new ApiError(2004, 'qBittorrent 未配置，请先在设置页填写 WebUI 地址', 428);
const UNREACHABLE = () =>
  new ApiError(2004, '无法连接 qBittorrent，请检查地址、端口与网络', 504);

interface CookieState {
  sid: string;
  ts: number;
}

let cookie: CookieState | null = null;

/** 清空会话（配置变更或测试时调用） */
export function clearQbSession(): void {
  cookie = null;
}

function baseUrl(): string {
  const url = getSetting('qb_server_url').trim().replace(/\/+$/, '');
  if (!url) throw NOT_CONFIGURED();
  return url;
}

function authRequired(): boolean {
  return getSetting('qb_username').trim().length > 0;
}

async function login(): Promise<void> {
  const base = baseUrl();
  const username = getSetting('qb_username').trim();
  const password = getSetting('qb_password');
  if (!username) {
    cookie = null; // 免认证环境
    return;
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: base,
      },
      body: new URLSearchParams({ username, password }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw UNREACHABLE();
  }
  const text = (await res.text().catch(() => '')).trim();
  if (!res.ok || text !== 'Ok.') {
    throw new ApiError(2004, 'qBittorrent 登录失败，请检查用户名与密码', 401);
  }
  const raw = res.headers.get('set-cookie') ?? '';
  const sid = /SID=([^;]+)/.exec(raw)?.[1];
  cookie = sid ? { sid, ts: Date.now() } : null;
}

async function ensureSession(force = false): Promise<void> {
  if (!force && !authRequired()) return;
  if (!force && cookie && Date.now() - cookie.ts < COOKIE_TTL_MS) return;
  await login();
}

/** 统一请求（自动带 Referer/Cookie；403 重登一次） */
async function qbFetch(path: string, init: RequestInit = {}, retry = true, timeout = REQUEST_TIMEOUT_MS): Promise<Response> {
  const base = baseUrl();
  await ensureSession();
  const headers = new Headers(init.headers);
  headers.set('Referer', base);
  if (cookie?.sid) headers.set('Cookie', `SID=${cookie.sid}`);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw UNREACHABLE();
  }
  if (res.status === 403 && retry && authRequired()) {
    await ensureSession(true);
    return qbFetch(path, init, false, timeout);
  }
  return res;
}

async function readOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const detail = await res.text().catch(() => '');
  throw new ApiError(2004, `qBittorrent ${action}失败（HTTP ${res.status}）${detail ? `：${detail.slice(0, 120)}` : ''}`, 502);
}

// ---- 查询类 ----

export interface QbStatus {
  configured: boolean;
  reachable: boolean;
  version: string | null;
  defaultSavePath: string | null;
  authMode: 'anonymous' | 'account';
  error: string | null;
}

export async function getQbStatus(): Promise<QbStatus> {
  const configured = getSetting('qb_server_url').trim().length > 0;
  const authMode = authRequired() ? 'account' : 'anonymous';
  if (!configured) {
    return { configured: false, reachable: false, version: null, defaultSavePath: null, authMode, error: null };
  }
  try {
    const [version, defaultSavePath] = await Promise.all([
      getVersion(),
      getDefaultSavePath(),
    ]);
    return { configured: true, reachable: true, version, defaultSavePath, authMode, error: null };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      version: null,
      defaultSavePath: null,
      authMode,
      error: err instanceof ApiError ? err.message : 'qBittorrent 不可达',
    };
  }
}

export async function getVersion(): Promise<string> {
  const res = await qbFetch('/api/v2/app/version');
  await readOk(res, '查询版本');
  return (await res.text()).trim();
}

export async function getDefaultSavePath(): Promise<string> {
  const res = await qbFetch('/api/v2/app/defaultSavePath');
  await readOk(res, '查询默认保存路径');
  return (await res.text()).trim();
}

export interface QbTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  state: string;
  eta: number;
  savePath: string;
  category: string;
  addedOn: number;
  numSeeds: number;
  numLeeches: number;
  downloaded: number;
  uploaded: number;
}

interface RawTorrent {
  hash?: string;
  name?: string;
  size?: number;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  state?: string;
  eta?: number;
  save_path?: string;
  category?: string;
  added_on?: number;
  num_seeds?: number;
  num_leechs?: number;
  downloaded?: number;
  uploaded?: number;
}

export async function listTorrents(): Promise<QbTorrent[]> {
  const res = await qbFetch('/api/v2/torrents/info');
  await readOk(res, '获取任务列表');
  let raw: RawTorrent[];
  try {
    raw = (await res.json()) as RawTorrent[];
  } catch {
    throw new ApiError(2004, 'qBittorrent 返回数据解析失败', 502);
  }
  return (Array.isArray(raw) ? raw : [])
    .filter((t) => t.hash)
    .map((t) => ({
      hash: t.hash as string,
      name: t.name ?? '',
      size: t.size ?? 0,
      progress: t.progress ?? 0,
      dlspeed: t.dlspeed ?? 0,
      upspeed: t.upspeed ?? 0,
      state: t.state ?? 'unknown',
      eta: typeof t.eta === 'number' ? t.eta : 0,
      savePath: t.save_path ?? '',
      category: t.category ?? '',
      addedOn: t.added_on ?? 0,
      numSeeds: t.num_seeds ?? 0,
      numLeeches: t.num_leechs ?? 0,
      downloaded: t.downloaded ?? 0,
      uploaded: t.uploaded ?? 0,
    }));
}

// ---- 写入类 ----

export interface AddTorrentOptions {
  filename: string;
  data: Uint8Array;
  savePath?: string;
  category?: string;
  tags?: string;
  paused?: boolean;
}

/** 上传 .torrent 文件添加任务（multipart/form-data） */
export async function addTorrentFile(opts: AddTorrentOptions): Promise<void> {
  const form = new FormData();
  const bytes = new Uint8Array(opts.data);
  form.append('torrents', new Blob([bytes], { type: 'application/x-bittorrent' }), opts.filename);
  if (opts.savePath?.trim()) form.append('savepath', opts.savePath.trim());
  if (opts.category?.trim()) form.append('category', opts.category.trim());
  if (opts.tags?.trim()) form.append('tags', opts.tags.trim());
  if (opts.paused) form.append('paused', 'true');

  const res = await qbFetch('/api/v2/torrents/add', { method: 'POST', body: form }, true, 60_000);
  await readOk(res, '添加任务');
}

/** 通过 magnet / http 种子链接添加任务 */
export async function addTorrentUrl(opts: {
  url: string;
  savePath?: string;
  category?: string;
  paused?: boolean;
}): Promise<void> {
  const form = new FormData();
  form.append('urls', opts.url.trim());
  if (opts.savePath?.trim()) form.append('savepath', opts.savePath.trim());
  if (opts.category?.trim()) form.append('category', opts.category.trim());
  if (opts.paused) form.append('paused', 'true');
  const res = await qbFetch('/api/v2/torrents/add', { method: 'POST', body: form }, true, 60_000);
  await readOk(res, '添加任务');
}

export type QbTorrentAction = 'pause' | 'resume' | 'delete';

export async function controlTorrents(
  action: QbTorrentAction,
  hashes: string,
  deleteFiles = false,
): Promise<void> {
  const form = new FormData();
  form.append('hashes', hashes);
  if (action === 'delete') form.append('deleteFiles', deleteFiles ? 'true' : 'false');
  const res = await qbFetch(`/api/v2/torrents/${action}`, { method: 'POST', body: form });
  await readOk(res, action === 'pause' ? '暂停任务' : action === 'resume' ? '恢复任务' : '删除任务');
}
