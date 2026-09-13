/**
 * 115 网盘离线下载客户端（Cookie 通道，零依赖，Node 内置 fetch/FormData/Blob）。
 *
 * 能力：
 *  - 会话：浏览器 Cookie（UID/CID/SEID/KID）→ uid / sign+time 换取（内存缓存，TTL 25 分钟）
 *  - 磁力 / 直链：ac=add_task_url（支持 wp_path_id 指定离线保存目录）
 *  - 种子文件：上传 .torrent → 解析文件树（可勾选 wanted）→ ac=add_task_bt
 *  - 任务：列表查询（分页拉全）、删除
 *  - 目录：列目录、按路径查 CID（files/getid）、预设目录解析
 *
 * 115 的 sign 有效期很短（约 30 分钟），过期后接口返回 state=false/errno=990009，
 * 因此这里对签名错误做一次自动刷新重试。
 */

import { ApiError } from '../middleware/errorHandler';
import { getSetting } from './settingsService';

const WEB_API = 'https://webapi.115.com';
const MAIN = 'https://115.com';
const MY = 'https://my.115.com';
const UPLOAD = 'https://upload.115.com';

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const SIGN_TTL_MS = 25 * 60 * 1000;

const NOT_CONFIGURED = () =>
  new ApiError(2005, '115 网盘未配置，请先在设置页填写登录 Cookie', 428);
const UNREACHABLE = () =>
  new ApiError(2005, '无法连接 115 网盘，请检查网络或 Cookie 是否有效', 504);
const AUTH_FAILED = () =>
  new ApiError(2005, '115 登录态已失效，请重新获取并填写 Cookie', 401);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 115 业务错误码 → 中文提示（非穷举，未命中回落到原始 error_msg） */
const ERROR_MESSAGES: Record<string, string> = {
  '911': '115 账号未登录，请检查 Cookie',
  '990001': '115 签名校验失败，请重试',
  '990002': '115 请求参数错误',
  '990005': '115 请求过于频繁，请稍后再试',
  '990009': '115 签名已过期（已自动重试）',
  '10001': '离线下载链接无效',
  '10002': '离线下载解析失败',
  '10003': '离线下载任务已存在',
  '10004': '115 空间不足',
  '10008': '离线下载任务已存在',
  '10009': '离线下载任务数量超出限制',
  '10010': '离线下载配额不足',
  '10012': '该链接已被 115 限制离线下载',
  '10013': '离线下载任务创建失败',
  '10014': '文件大小超出限制',
  '10015': '目录不存在',
  '10016': '离线下载功能仅限 115 会员使用',
};

function describeError(errno: number | string | undefined, fallback: string | undefined): string {
  const key = errno === undefined ? '' : String(errno);
  return ERROR_MESSAGES[key] ?? (fallback?.trim() || `115 接口返回错误${key ? `（${key}）` : ''}`);
}

// ---- Cookie 处理 ----

/** 规范化 Cookie：兼容用户直接粘整串、或带 "Cookie: " 前缀、或换行分隔 */
export function normalizeCookie(raw: string): string {
  return raw
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ');
}

function cookieHeader(): string {
  const raw = getSetting('pan115_cookie').trim();
  if (!raw) throw NOT_CONFIGURED();
  const cookie = normalizeCookie(raw);
  if (!cookie) throw NOT_CONFIGURED();
  return cookie;
}

/** Cookie 里是否含有 115 的登录态字段 */
export function hasAuthCookie(raw: string): boolean {
  const cookie = normalizeCookie(raw);
  return /(?:^|;\s*)UID=/i.test(cookie) && /(?:^|;\s*)CID=/i.test(cookie);
}

// ---- 会话与签名 ----

interface SignState {
  uid: string;
  sign: string;
  time: string;
  ts: number;
}

let signCache: SignState | null = null;

/** 清空缓存（Cookie 变更或测试时调用） */
export function clearPan115Session(): void {
  signCache = null;
}

/** 统一请求：带 Cookie / UA / Referer；捕获网络异常 */
async function rawFetch(
  url: string,
  init: RequestInit = {},
  timeout = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookieHeader());
  headers.set('User-Agent', UA);
  headers.set('Referer', `${MAIN}/`);
  headers.set('Origin', MAIN);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain, */*');
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw UNREACHABLE();
  }
}

async function readJson<T = any>(res: Response, action: string): Promise<T> {
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new ApiError(2005, `115 ${action}失败（HTTP ${res.status}）`, 502);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(2005, `115 ${action}返回数据解析失败`, 502);
  }
}

function form(data: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) params.append(key, value);
  return params;
}

/** 拉取 uid（my.115.com 导航接口） */
async function fetchUid(): Promise<string> {
  const res = await rawFetch(`${MY}/?ct=ajax&ac=nav`);
  const json = await readJson(res, '获取用户信息');
  const uid = json?.data?.user_id ?? json?.data?.uid;
  if (!uid) {
    if (json?.state === false) throw AUTH_FAILED();
    throw new ApiError(2005, '115 未返回用户 ID，Cookie 可能不完整（需含 UID/CID/SEID）', 401);
  }
  return String(uid);
}

/** 拉取离线签名 sign/time */
async function fetchSign(): Promise<{ sign: string; time: string }> {
  const res = await rawFetch(`${MAIN}/?ct=offline&ac=space&_=${Date.now()}`);
  const json = await readJson(res, '获取离线签名');
  const sign = json?.sign;
  if (!sign) {
    if (json?.state === false) throw AUTH_FAILED();
    throw new ApiError(2005, '115 未能获取离线下载签名，请检查 Cookie 是否有效', 401);
  }
  return { sign: String(sign), time: String(json?.time ?? Math.floor(Date.now() / 1000)) };
}

async function ensureSign(force = false): Promise<SignState> {
  if (!force && signCache && Date.now() - signCache.ts < SIGN_TTL_MS) return signCache;
  const [uid, { sign, time }] = await Promise.all([fetchUid(), fetchSign()]);
  signCache = { uid, sign, time, ts: Date.now() };
  return signCache;
}

/**
 * POST 到离线下载接口，自动处理「签名过期」（990009）与「未登录」（911）：
 *  - 990009：强制刷新 sign 后重试一次
 *  - 911：清空缓存并抛 AUTH_FAILED
 */
async function postLixian(
  ac: string,
  data: Record<string, string>,
  retry = true,
): Promise<any> {
  const state = await ensureSign();
  const body = form({ ...data, uid: state.uid, sign: state.sign, time: state.time });
  const res = await rawFetch(`${MAIN}/web/lixian/?ct=lixian&ac=${ac}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await readJson(res, `离线下载(${ac})`);

  const errno = json?.errno ?? json?.errcode;
  const failed = json?.state === false || json?.state === 0 || json?.state === '0';
  const expired = String(errno ?? '') === '990009' || String(errno ?? '') === '911';

  if (failed && expired && retry) {
    signCache = null;
    await ensureSign(true);
    return postLixian(ac, data, false);
  }
  if (failed && String(errno ?? '') === '911') {
    signCache = null;
    throw AUTH_FAILED();
  }
  return json;
}

/** 检查接口返回是否为失败，失败抛 ApiError */
function assertOk(json: any, action: string): void {
  const failed = json?.state === false || json?.state === 0 || json?.state === '0';
  if (!failed) return;
  const msg = describeError(json?.errno ?? json?.errcode, json?.error_msg ?? json?.error);
  // 「任务已存在」不是致命错误，返回给上层提示
  throw new ApiError(2005, `115 ${action}失败：${msg}`, 502);
}

// ---- 状态 / 目录 ----

export interface Pan115Status {
  configured: boolean;
  reachable: boolean;
  loggedIn: boolean;
  username: string | null;
  vip: boolean;
  offlineQuota: { total: number; used: number; surplus: number } | null;
  error: string | null;
}

/** 登录态与离线配额探测 */
export async function getPan115Status(): Promise<Pan115Status> {
  const raw = getSetting('pan115_cookie').trim();
  const configured = raw.length > 0;
  if (!configured) {
    return { configured: false, reachable: false, loggedIn: false, username: null, vip: false, offlineQuota: null, error: null };
  }
  try {
    const [navRes, quotaRes] = await Promise.all([
      rawFetch(`${MY}/?ct=ajax&ac=nav`),
      rawFetch(`${MAIN}/?ct=offline&ac=space&_=${Date.now()}`),
    ]);
    const nav = await readJson<any>(navRes, '获取用户信息');
    const quota = await readJson<any>(quotaRes, '获取离线配额');
    const uid = nav?.data?.user_id;
    if (!uid) throw AUTH_FAILED();
    const total = Number(quota?.count ?? 0);
    const used = Number(quota?.used ?? 0);
    return {
      configured: true,
      reachable: true,
      loggedIn: true,
      username: nav?.data?.user_name ?? nav?.data?.uname ?? String(uid),
      vip: Number(nav?.data?.vip ?? 0) > 0 || Boolean(nav?.data?.is_vip),
      offlineQuota: total > 0 ? { total, used, surplus: Math.max(0, total - used) } : null,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: !(err instanceof ApiError && err.httpStatus === 504),
      loggedIn: false,
      username: null,
      vip: false,
      offlineQuota: null,
      error: err instanceof ApiError ? err.message : '115 不可用',
    };
  }
}

export interface Pan115DirEntry {
  cid: string;
  name: string;
  isDir: boolean;
  size: number;
}

/** 列目录（cid 默认 '0' 根目录） */
export async function listPan115Dirs(cid = '0'): Promise<Pan115DirEntry[]> {
  const res = await rawFetch(
    `${WEB_API}/files?aid=1&cid=${encodeURIComponent(cid || '0')}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=200&snap=0&natsort=1`,
  );
  const json = await readJson(res, '获取目录列表');
  const list = Array.isArray(json?.data) ? json.data : [];
  if (!json?.state && list.length === 0) {
    if (String(json?.errno ?? '') === '911' || json?.errno === 40101017) throw AUTH_FAILED();
  }
  return list
    .filter((item: any) => item?.fid || item?.cid)
    .map((item: any) => ({
      cid: String(item.cid ?? item.fid ?? ''),
      name: String(item.n ?? item.name ?? ''),
      isDir: item.sha === undefined || item.sha === null || item.sha === '',
      size: Number(item.s ?? item.size ?? 0) || 0,
    }));
}

/** 按路径查询目录 CID（'/' 或 '电影/2024'，返回根目录则为 '0'） */
export async function resolvePan115CidByPath(path: string): Promise<string> {
  const target = (path || '/').trim() || '/';
  if (target === '/' || target === '0') return '0';
  const res = await rawFetch(`${WEB_API}/files/getid?path=${encodeURIComponent(target)}`);
  const json = await readJson(res, '解析目录路径');
  if (json?.state === false || json?.state === 0) {
    const msg = describeError(json?.errno, json?.error_msg);
    throw new ApiError(2005, `115 目录「${target}」解析失败：${msg}`, 404);
  }
  return String(json?.id ?? json?.cid ?? '0');
}

export interface Pan115PathPreset {
  name: string;
  cid: string;
}

/**
 * 解析预设目录配置（每行形如 `电影:1234567`，也接受 `电影 1234567` 或纯 CID）。
 * 纯名称（无 CID）的行会在推送时按名称为根目录下的子目录处理 —— 这里跳过，
 * 交由 resolvePresetCid 在需要时实时解析。
 */
export function parsePresetPaths(raw: string): Pan115PathPreset[] {
  return (raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.+?)\s*[:：]\s*(\d+)$/.exec(line) ?? /^(\d+)$/.exec(line);
      if (!match) return null;
      if (match.length === 2) return { name: `目录 ${match[1]}`, cid: match[1] };
      return { name: match[1].trim(), cid: match[2] };
    })
    .filter((item): item is Pan115PathPreset => item !== null && item.cid.length > 0);
}

/** 预设目录名 → CID（未在预设中找到时抛错，避免静默存到根目录） */
export async function resolvePresetCid(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) return '0';
  if (/^\d+$/.test(trimmed)) return trimmed;
  const presets = parsePresetPaths(getSetting('pan115_paths'));
  const hit = presets.find((item) => item.name === trimmed);
  if (hit) return hit.cid;
  // 预设里没有：尝试按路径实时解析（支持「电影/2024」这类多级路径）
  try {
    return await resolvePan115CidByPath(trimmed);
  } catch {
    throw new ApiError(2005, `未找到 115 目录「${trimmed}」，请在设置页的预设目录中补充，或填写目录 CID`, 404);
  }
}

// ---- 离线任务 ----

export interface Pan115Task {
  infoHash: string;
  name: string;
  size: number;
  percentDone: number;
  status: number;
  statusText: string;
  url: string;
  fileId: string;
  addTime: number;
  lastUpdate: number;
}

function taskStatusText(status: number): string {
  if (status === -1) return '失败';
  if (status === 0) return '分配中';
  if (status === 1) return '下载中';
  if (status === 2) return '已完成';
  return '未知';
}

function mapTask(raw: any): Pan115Task {
  const status = Number(raw?.status ?? 0);
  return {
    infoHash: String(raw?.info_hash ?? raw?.infoHash ?? ''),
    name: String(raw?.name ?? ''),
    size: Number(raw?.size ?? 0) || 0,
    percentDone: Number(raw?.percentDone ?? raw?.percent_done ?? 0) || 0,
    status,
    statusText: taskStatusText(status),
    url: String(raw?.url ?? ''),
    fileId: String(raw?.file_id ?? raw?.fileId ?? ''),
    addTime: Number(raw?.add_time ?? 0) || 0,
    lastUpdate: Number(raw?.last_update ?? 0) || 0,
  };
}

/** 离线任务列表（自动翻页，最多 10 页 / 1000 条） */
export async function listPan115Tasks(): Promise<Pan115Task[]> {
  const all: Pan115Task[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await rawFetch(
      `${MAIN}/web/lixian/?ct=lixian&ac=task_lists&page=${page}&page_row=100`,
    );
    const json = await readJson(res, '获取离线任务列表');
    if (json?.state === false || json?.state === 0) {
      const msg = describeError(json?.errno, json?.error_msg ?? json?.error);
      throw new ApiError(2005, `115 获取离线任务列表失败：${msg}`, 502);
    }
    const tasks = Array.isArray(json?.tasks) ? json.tasks : [];
    all.push(...tasks.map(mapTask));
    const pageCount = Number(json?.page_count ?? 0);
    if (pageCount > 0 ? page >= pageCount : tasks.length < 100) break;
  }
  return all;
}

/** 删除离线任务（hash 数组）；deleteFiles 为真时同时删除已下载文件 */
export async function deletePan115Tasks(
  infoHashes: string[],
  deleteFiles = false,
): Promise<void> {
  const hashes = infoHashes.map((h) => h.trim()).filter(Boolean);
  if (hashes.length === 0) return;
  const data: Record<string, string> = {};
  hashes.forEach((hash, index) => {
    data[`hash[${index}]`] = hash;
  });
  data.flag = deleteFiles ? '1' : '0';
  const json = await postLixian('task_del', data);
  assertOk(json, '删除离线任务');
}

export interface AddMagnetResult {
  infoHash: string;
  url: string;
  name: string;
}

/** 添加磁力 / 直链离线任务（wp_path_id 指定保存目录） */
export async function addPan115Url(opts: {
  url: string;
  cid?: string;
}): Promise<AddMagnetResult> {
  const url = opts.url.trim();
  if (!url) throw new ApiError(1001, '离线下载链接不能为空', 400);
  const json = await postLixian('add_task_url', {
    url,
    wp_path_id: opts.cid?.trim() || '0',
    savepath: '',
  });
  if (json?.state === false || json?.state === 0) {
    const msg = describeError(json?.errno ?? json?.errcode, json?.error_msg);
    // 任务已存在视为成功（幂等）
    if (/已存在|已经存在/.test(msg)) {
      return { infoHash: String(json?.info_hash ?? ''), url, name: '' };
    }
    throw new ApiError(2005, `115 添加离线任务失败：${msg}`, 502);
  }
  return {
    infoHash: String(json?.info_hash ?? ''),
    url,
    name: String(json?.name ?? ''),
  };
}

export interface Pan115TorrentFile {
  index: number;
  path: string;
  size: number;
  /** 115 的默认勾选状态：-1 表示不下载，其余视为默认选中 */
  wanted: number;
}

export interface Pan115TorrentInfo {
  infoHash: string;
  name: string;
  size: number;
  fileCount: number;
  files: Pan115TorrentFile[];
  /** 上传后的种子在网盘中的 sha1 / pickcode，提交任务时需要 */
  torrentSha1: string;
  pickCode: string;
}

/** 下载远端 .torrent 直链（用于「先预览文件树再勾选」流程） */
export async function downloadTorrentByUrl(
  url: string,
): Promise<{ filename: string; data: Uint8Array }> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: `${MAIN}/` },
    });
  } catch {
    throw new ApiError(2005, '下载种子文件超时，请稍后重试', 504);
  }
  if (!res.ok) throw new ApiError(2005, `下载种子文件失败（HTTP ${res.status}）`, 502);

  const buf = new Uint8Array(await res.arrayBuffer());
  const head = Buffer.from(buf.slice(0, 16)).toString('latin1');
  // 合法 torrent 为 bencode 字典（以 d 开头）
  if (!head.startsWith('d') || buf.length < 30) {
    throw new ApiError(2005, '未获取到有效的种子文件（源站可能要求登录）', 502);
  }

  // 文件名优先取 Content-Disposition，其次取 URL 末段
  const disposition = res.headers.get('content-disposition') ?? '';
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  let filename = fromHeader ? decodeURIComponent(fromHeader) : '';
  if (!filename) {
    const tail = url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
    filename = /\.torrent$/i.test(tail) ? tail : `remote-${Date.now()}.torrent`;
  }
  if (!/\.torrent$/i.test(filename)) filename += '.torrent';

  return { filename, data: buf };
}

/**
 * 上传 .torrent 并解析文件树（本步骤不创建任务）。
 *
 * 115 的流程：上传种子 → 查 sha1/pickcode → 解析文件列表 → 再由调用方
 * 选择 wanted 后提交 add_task_bt。这里把前三步合并，便于前端先展示勾选界面。
 */
export async function parsePan115Torrent(opts: {
  filename: string;
  data: Uint8Array;
}): Promise<Pan115TorrentInfo> {
  const state = await ensureSign();

  // step 1: 取种子专用上传目录 cid
  const idRes = await rawFetch(
    `${MAIN}/?ct=lixian&ac=get_id&torrent=1&_=${Math.floor(Date.now() / 1000)}`,
  );
  const idJson = await readJson(idRes, '获取种子上传目录');
  const uploadCid = String(idJson?.cid ?? '');
  if (!uploadCid) throw new ApiError(2005, '115 未返回种子上传目录，Cookie 可能已失效', 401);

  // step 2: 上传种子文件（multipart）
  const uploadUrl = `${UPLOAD}/upload?${new URLSearchParams({
    cid: uploadCid,
    aid: '1',
  }).toString()}`;
  const formData = new FormData();
  const bytes = new Uint8Array(opts.data);
  formData.append('Filename', opts.filename);
  formData.append('target', `U_1_${uploadCid}`);
  formData.append(
    'Filedata',
    new Blob([bytes], { type: 'application/octet-stream' }),
    opts.filename,
  );
  formData.append('Upload', 'Submit Query');

  const uploadRes = await rawFetch(
    uploadUrl,
    { method: 'POST', body: formData },
    UPLOAD_TIMEOUT_MS,
  );
  const uploadJson = await readJson(uploadRes, '上传种子文件');
  if (uploadJson?.state === false || !uploadJson?.data?.file_id) {
    throw new ApiError(
      2005,
      `115 上传种子失败：${describeError(uploadJson?.errno, uploadJson?.error_msg)}`,
      502,
    );
  }
  const fileId = String(uploadJson.data.file_id);
  let pickCode = String(uploadJson.data.pick_code ?? '');

  // step 3: 取 sha1（解析接口需要）
  const fileRes = await rawFetch(`${WEB_API}/files/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ file_id: fileId }).toString(),
  });
  const fileJson = await readJson(fileRes, '获取种子文件信息');
  const fileEntry = Array.isArray(fileJson?.data) ? fileJson.data[0] : fileJson?.data;
  const sha1 = String(fileEntry?.sha1 ?? '');
  pickCode = String(fileEntry?.pick_code ?? pickCode);
  if (!sha1 || !pickCode) throw new ApiError(2005, '115 未能解析种子文件信息', 502);

  // step 4: 解析种子，取文件树
  const parseJson = await postLixian('torrent', { pickcode: pickCode, sha1 });
  if (parseJson?.state === false || !parseJson?.info_hash) {
    throw new ApiError(
      2005,
      `115 解析种子失败：${describeError(parseJson?.errno, parseJson?.error_msg)}`,
      502,
    );
  }
  const rawList = Array.isArray(parseJson?.torrent_filelist_web)
    ? parseJson.torrent_filelist_web
    : [];
  const files: Pan115TorrentFile[] = rawList.map((item: any, index: number) => ({
    index,
    path: String(item?.path ?? item?.name ?? ''),
    size: Number(item?.size ?? 0) || 0,
    wanted: Number(item?.wanted ?? 1),
  }));

  return {
    infoHash: String(parseJson.info_hash),
    name: String(parseJson.torrent_name ?? parseJson.name ?? opts.filename),
    size: Number(parseJson.file_size ?? 0) || 0,
    fileCount: Number(parseJson.file_count ?? files.length) || files.length,
    files,
    torrentSha1: sha1,
    pickCode,
  };
}

/**
 * 提交 BT 离线任务。
 * @param wantedIndexes 需要下载的文件索引；不传则按 115 默认勾选（wanted != -1）
 */
export async function addPan115Torrent(opts: {
  info: Pan115TorrentInfo;
  wantedIndexes?: number[];
  cid?: string;
  savePath?: string;
}): Promise<AddMagnetResult> {
  const { info } = opts;
  const selected =
    opts.wantedIndexes && opts.wantedIndexes.length > 0
      ? [...new Set(opts.wantedIndexes)].sort((a, b) => a - b)
      : info.files.filter((file) => file.wanted !== -1).map((file) => file.index);

  if (selected.length === 0) {
    throw new ApiError(1001, '请至少勾选一个需要下载的文件', 400);
  }

  // 115 的 savepath 是「保存目录名」，wp_path_id 才是目标目录 CID。
  // 官方 web 端行为：savepath 传种子名会在目标目录下新建同名文件夹；传空则直接铺开。
  const savePath = (opts.savePath ?? info.name).replace(/'/g, '');

  const json = await postLixian('add_task_bt', {
    info_hash: info.infoHash,
    wanted: selected.join(','),
    savepath: savePath,
    wp_path_id: opts.cid?.trim() || '0',
    torrent_sha1: info.torrentSha1,
    pickcode: info.pickCode,
  });
  if (json?.state === false || json?.state === 0) {
    const msg = describeError(json?.errno ?? json?.errcode, json?.error_msg);
    if (/已存在|已经存在/.test(msg)) {
      return { infoHash: info.infoHash, url: '', name: info.name };
    }
    throw new ApiError(2005, `115 添加 BT 离线任务失败：${msg}`, 502);
  }
  return {
    infoHash: String(json?.info_hash ?? info.infoHash),
    url: String(json?.url ?? ''),
    name: String(json?.name ?? info.name),
  };
}
