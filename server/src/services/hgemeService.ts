/**
 * hgeme.com 资源站服务（影视 + 磁力/网盘资源聚合）。
 *
 * 站点事实（实测）：
 *  - 全站强制 PoW 浏览器验证：GET /res/pow → {N,x,t}，需计算 y = x^(2^t) mod N
 *    后 POST /res/pow（form: y=十六进制）→ 下发 browser_verified（有效期 1 天）
 *  - 搜索：GET /search?q=<关键词>，结果内联在 HTML 的 _obj.search.l（19 条/页，
 *    含 title/name/year/pf.db.s 评分/daoyan/zhuyan/info，类型段 d=mv|tv）
 *  - 资源：GET /res/downurl/<dir>/<id> → downlist.list（m=btih 字面量, t=标题,
 *    s=体积, p=画质, n=时间）+ panlist（网盘 name/url/tname）
 *  - 详情页：/<dir>/<id>
 *
 * 会话：内存 cookie jar（初始 Cookie 来自设置项 hgeme_cookie），
 * 遇到 419/验证页自动重新求解 PoW；求解过程分片让出事件循环避免阻塞服务。
 */

import { ApiError } from '../middleware/errorHandler';
import { getSetting } from './settingsService';

const SITE = 'https://www.hgeme.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20_000;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const POW_CHUNK = 20_000;

export const hgemeConfigured = (): boolean => getSetting('hgeme_cookie').trim().length > 0;

function baseError(message: string, status = 502): ApiError {
  return new ApiError(2006, message, status);
}

// ---- Cookie 会话 ----

type Jar = Record<string, string>;

let jar: Jar = {};
let sessionTs = 0;
let verifying: Promise<void> | null = null;

/** 解析「name=value; name2=value2」形式 Cookie 串 */
export function parseCookieString(raw: string): Jar {
  const out: Jar = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function cookieHeader(): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function absorb(res: Response): void {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const first = sc.split(';')[0];
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) continue;
    if (value === 'deleted' || value === '') delete jar[name];
    else jar[name] = value;
  }
}

export function clearHgemeSession(): void {
  jar = {};
  sessionTs = 0;
  verifying = null;
}

/** 分片计算 y = x^(2^t) mod N（每 chunk 次让出事件循环） */
export async function solvePow(N: string, x: string, t: number): Promise<string> {
  const n = BigInt('0x' + N);
  let y = BigInt('0x' + x);
  const total = t | 0;
  for (let i = 0; i < total; i += POW_CHUNK) {
    const end = Math.min(total, i + POW_CHUNK);
    for (let j = i; j < end; j += 1) y = (y * y) % n;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return y.toString(16);
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${SITE}${path}`, {
      ...init,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: `${SITE}/`,
        ...(jar.browser_verified ? { Cookie: cookieHeader() } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw baseError('无法连接 hgeme.com，请检查网络', 504);
  }
}

/** 是否需要重新验证（无 browser_verified / 超时） */
function needsVerify(): boolean {
  return !jar.browser_verified || Date.now() - sessionTs > SESSION_TTL_MS;
}

/** 执行一次 PoW 验证（并发去重） */
async function verifySession(): Promise<void> {
  if (verifying) return verifying;
  verifying = (async () => {
    const initial = parseCookieString(getSetting('hgeme_cookie'));
    if (Object.keys(initial).length === 0) {
      throw new ApiError(2006, 'hgme 未配置 Cookie，请先在设置页填写', 428);
    }
    jar = { ...initial };
    const chRes = await rawFetch('/res/pow', { headers: { Accept: '*/*' } });
    absorb(chRes);
    let challenge: { N?: string; x?: string; t?: number };
    try {
      challenge = (await chRes.json()) as { N?: string; x?: string; t?: number };
    } catch {
      throw baseError('hgme 验证挑战解析失败');
    }
    if (!challenge.N || !challenge.x || !challenge.t) {
      throw baseError('hgme 验证挑战数据不完整');
    }
    const y = await solvePow(challenge.N, challenge.x, challenge.t);
    const postRes = await rawFetch('/res/pow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: SITE,
        Accept: '*/*',
      },
      body: new URLSearchParams({ y }).toString(),
    });
    absorb(postRes);
    const payload = (await postRes.json().catch(() => null)) as { success?: boolean } | null;
    if (!payload?.success || !jar.browser_verified) {
      throw new ApiError(2006, 'hgme 浏览器验证失败，请更新 Cookie 后重试', 502);
    }
    sessionTs = Date.now();
  })().finally(() => {
    verifying = null;
  });
  return verifying;
}

/** 验证页判定（返回 HTML 内含 PoW 脚本或 419 JSON） */
function isChallengePage(text: string): boolean {
  return (
    text.includes('pow-scope') ||
    text.includes('powSolve') ||
    /"code":\s*419/.test(text) ||
    text.includes('浏览器验证已过期')
  );
}

/** 带会话自愈的请求（返回文本；验证过期自动重验一次） */
async function requestText(path: string, init: RequestInit = {}, retry = true): Promise<string> {
  if (needsVerify()) await verifySession();
  const res = await rawFetch(path, init);
  absorb(res);
  const text = await res.text();
  if (isChallengePage(text)) {
    if (!retry) throw new ApiError(2006, 'hgme 浏览器验证未能通过，请更新 Cookie', 502);
    clearHgemeSession();
    await verifySession();
    return requestText(path, init, false);
  }
  return text;
}

/** 会话可用性探测（必要时自动完成 PoW 验证） */
export async function pingHgeme(): Promise<{ ok: boolean }> {
  if (!hgemeConfigured()) return { ok: false };
  await requestText('/', { headers: { Accept: 'text/html' } });
  return { ok: true };
}

// ---- 搜索（分类 Tab + 资源类型筛选） ----

/**
 * 站点搜索分类 Tab（前端 cats 定义）：
 * 0 全部（影片候选）/ 1 电影 / 2 剧集 / 3 动漫 / 4 种子（直接种子资源）/ 5 网盘（直接网盘资源）
 */
export const HGEME_CATEGORIES = [
  { key: 0, label: '全部' },
  { key: 1, label: '电影' },
  { key: 2, label: '剧集' },
  { key: 3, label: '动漫' },
  { key: 4, label: '种子' },
  { key: 5, label: '网盘' },
] as const;

/** 影片候选（ty 0-3）：选择后才进入资源详情 */
export interface HgemeTitleItem {
  kind: 'title';
  id: string;
  dir: string;
  title: string;
  ename: string | null;
  year: number | null;
  rating: number | null;
  info: string | null;
  directors: string[];
  actors: string[];
}

/** 种子资源条目（ty 4）：直接给出种子（点击可解析磁力） */
export interface HgemeTorrentItem {
  kind: 'torrent';
  id: string;
  title: string;
  size: string;
  seeds: number | null;
  time: string | null;
}

/** 网盘资源条目（ty 5）：直接给出网盘直链 */
export interface HgemePanItem {
  kind: 'pan';
  title: string;
  url: string;
  netdisk: string;
  user: string | null;
  time: string | null;
  hot: string | null;
}

export type HgemeSearchItem = HgemeTitleItem | HgemeTorrentItem | HgemePanItem;

/** 从搜索页 HTML 提取 _obj.search（括号匹配，容错返回 null） */
export function parseSearchInline(html: string): Record<string, unknown> | null {
  const key = '_obj.search=';
  const start = html.indexOf(key);
  if (start < 0) return null;
  const rest = html.slice(start + key.length);
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(rest.slice(0, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface SearchInlineL {
  /* 影片维度（ty 0-3） */
  title?: string[];
  name?: string[];
  year?: number[];
  d?: string[];
  i?: string[];
  info?: string[];
  daoyan?: string[];
  zhuyan?: string[];
  pf?: { db?: { s?: number[] } };
  /* 种子维度（ty 4） */
  size?: string[];
  seeds?: number[];
  time?: string[];
  /* 网盘维度（ty 5） */
  tname?: string[];
  url?: string[];
  pw?: string[];
  user?: string[];
  gid?: number[];
}

/** 把 _obj.search 映射为条目数组（按数据形态区分影片/种子/网盘，纯函数便于单测） */
export function mapSearchInline(data: Record<string, unknown>): HgemeSearchItem[] {
  const l = (data.l ?? {}) as SearchInlineL;
  const titles = l.title ?? [];
  const dirs = l.d ?? [];

  // 网盘：存在 url 字段
  if (Array.isArray(l.url) && l.url.length > 0) {
    return titles
      .map((title, n) => {
        const url = (l.url?.[n] ?? '').trim();
        if (!url) return null;
        return {
          kind: 'pan' as const,
          title,
          url,
          netdisk: (l.tname?.[n] ?? '').trim(),
          user: (l.user?.[n] ?? '').trim() || null,
          time: (l.time?.[n] ?? '').trim() || null,
          hot: (l.pw?.[n] ?? '').trim() || null,
        };
      })
      .filter((x): x is HgemePanItem => x !== null);
  }

  // 种子：dir 段为 bt
  if (dirs.length > 0 && dirs.every((d) => d === 'bt')) {
    return titles
      .map((title, n) => {
        const id = l.i?.[n];
        if (!id) return null;
        return {
          kind: 'torrent' as const,
          id,
          title,
          size: (l.size?.[n] ?? '').trim(),
          seeds: typeof l.seeds?.[n] === 'number' ? (l.seeds?.[n] as number) : null,
          time: (l.time?.[n] ?? '').trim() || null,
        };
      })
      .filter((x): x is HgemeTorrentItem => x !== null);
  }

  // 影片候选
  const ids = l.i ?? [];
  return titles
    .map((title, n) => {
      const id = ids[n];
      if (!id) return null;
      const scores = l.pf?.db?.s ?? [];
      return {
        kind: 'title' as const,
        id,
        dir: dirs[n] ?? 'mv',
        title,
        ename: (l.name?.[n] ?? '').trim() || null,
        year: typeof l.year?.[n] === 'number' ? (l.year?.[n] as number) : null,
        rating: typeof scores[n] === 'number' ? scores[n] : null,
        info: (l.info?.[n] ?? '').trim() || null,
        directors: (l.daoyan?.[n] ?? '').split(/\s*\/\s*/).filter(Boolean).slice(0, 3),
        actors: (l.zhuyan?.[n] ?? '').split(/\s*\/\s*/).filter(Boolean).slice(0, 5),
      };
    })
    .filter((x): x is HgemeTitleItem => x !== null);
}

export interface HgemeSearchResult {
  items: HgemeSearchItem[];
  /** 当前分类（0-5） */
  ty: number;
  /** 各分类结果数（对应 HGEME_CATEGORIES 顺序） */
  counts: number[];
  /** 资源类型筛选字典（画质或网盘名 → 数量） */
  filters: Record<string, number>;
  /** 当前选中的资源类型筛选 */
  filterCurrent: string;
}

/**
 * 搜索（关键词 + 分类 + 资源类型筛选）。
 * URL 形如 /search?q=&type=<分类>&mode=&page=<页码>[&ziyuan=<筛选>]
 */
export async function searchHgeme(
  keyword: string,
  page = 1,
  opts: { type?: number; filter?: string } = {},
): Promise<HgemeSearchResult> {
  const kw = keyword.trim();
  if (!kw) throw new ApiError(1001, '搜索关键词不能为空', 400);
  const ty = Number.isInteger(opts.type) && (opts.type as number) >= 0 && (opts.type as number) <= 5 ? (opts.type as number) : 0;
  const pageParam = page > 1 ? `&page=${Math.min(200, page)}` : '';
  const filterParam = opts.filter?.trim() ? `&ziyuan=${encodeURIComponent(opts.filter.trim())}` : '';
  const html = await requestText(`/search?q=${encodeURIComponent(kw)}&type=${ty}&mode=${pageParam}${filterParam}`);
  const inline = parseSearchInline(html);
  if (!inline) {
    if (html.includes('浏览器安全验证')) {
      throw new ApiError(2006, 'hgme 需要浏览器验证，请更新 Cookie', 502);
    }
    return { items: [], ty, counts: [0, 0, 0, 0, 0, 0], filters: {}, filterCurrent: '' };
  }
  const rawCounts = Array.isArray(inline.ns) ? (inline.ns as unknown[]) : [];
  const counts = rawCounts.map((n) => (typeof n === 'number' ? n : Number.parseInt(String(n), 10) || 0));
  const filters = (inline.zy && typeof inline.zy === 'object' ? (inline.zy as Record<string, number>) : {}) ?? {};
  return {
    items: mapSearchInline(inline),
    ty: typeof inline.ty === 'number' ? inline.ty : ty,
    counts,
    filters,
    filterCurrent: typeof inline.zy_cur === 'string' ? inline.zy_cur : '',
  };
}

// ---- 影片详情（资源面板头部） ----

export interface HgemeDetail {
  id: string;
  dir: string;
  title: string;
  ename: string | null;
  year: number | null;
  typename: string | null;
  rating: number | null;
  genres: string[];
  regions: string[];
  languages: string[];
  releaseDate: string | null;
  status: string | null;
  summary: string | null;
  directors: string[];
  actors: string[];
  /** 是否含资源（站点 fa 字段） */
  hasResources: boolean;
}

interface DetailInline {
  id?: string;
  dir?: string;
  title?: string;
  name?: string;
  year?: number;
  dname?: string;
  leixing?: string[];
  diqu?: string[];
  yuyan?: string[];
  stime?: string;
  status?: string;
  summary?: string;
  fa?: number;
  daoyan?: string[];
  zhuyan?: string[];
  pf?: { db?: { s?: number } };
}

/** 从详情页 HTML 提取 _obj.d（纯函数） */
export function parseDetailInline(html: string): Record<string, unknown> | null {
  const key = '_obj.d=';
  const start = html.indexOf(key);
  if (start < 0) return null;
  const rest = html.slice(start + key.length);
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(rest.slice(0, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 详情内联数据 → 结构化（纯函数） */
export function mapDetailInline(raw: Record<string, unknown>, fallbackDir: string, fallbackId: string): HgemeDetail {
  const d = raw as DetailInline;
  return {
    id: d.id ?? fallbackId,
    dir: d.dir ?? fallbackDir,
    title: d.title ?? '',
    ename: (d.name ?? '').trim() || null,
    year: typeof d.year === 'number' ? d.year : null,
    typename: (d.dname ?? '').trim() || null,
    rating: typeof d.pf?.db?.s === 'number' ? (d.pf?.db?.s as number) : null,
    genres: Array.isArray(d.leixing) ? d.leixing : [],
    regions: Array.isArray(d.diqu) ? d.diqu : [],
    languages: Array.isArray(d.yuyan) ? d.yuyan : [],
    releaseDate: (d.stime ?? '').trim() || null,
    status: (d.status ?? '').trim() || null,
    summary: (d.summary ?? '').trim() || null,
    directors: Array.isArray(d.daoyan) ? d.daoyan : [],
    actors: Array.isArray(d.zhuyan) ? d.zhuyan : [],
    hasResources: d.fa === 1,
  };
}

/** 拉取影片详情（资源面板头部信息） */
export async function fetchHgemeDetail(dir: string, id: string): Promise<HgemeDetail> {
  if (!/^[a-z]{2,6}$/i.test(dir) || !/^[\w-]{2,16}$/.test(id)) {
    throw new ApiError(1001, '非法的资源标识', 400);
  }
  const html = await requestText(`/${encodeURIComponent(dir)}/${encodeURIComponent(id)}`);
  const raw = parseDetailInline(html);
  if (!raw) throw baseError('hgme 影片详情解析失败');
  return mapDetailInline(raw, dir, id);
}

// ---- 资源（磁力 + 网盘 + 在线播放） ----

export interface HgemeMagnet {
  title: string;
  size: string;
  /** 画质分类键（如 i3） */
  qualityKey: string;
  /** 画质分类中文（如 1080P） */
  quality: string;
  time: string;
  /** 做种/热度（站点 e 字段） */
  seeds: number | null;
  magnet: string;
}

export interface HgemePan {
  name: string;
  url: string;
  netdisk: string;
  user: string | null;
  time: string | null;
  /** 热度标记（站点 p 字段，含 emoji） */
  hot: string | null;
  /** gid=6 视为失效资源 */
  invalid: boolean;
}

export interface HgemePlaylist {
  name: string;
  episodes: string[];
}

export interface HgemeGroup {
  key: string;
  label: string;
  count: number;
}

export interface HgemeResources {
  magnets: HgemeMagnet[];
  /** 磁力按画质分组统计 */
  magnetGroups: HgemeGroup[];
  pans: HgemePan[];
  /** 网盘按网盘名分组统计 */
  panGroups: HgemeGroup[];
  playlists: HgemePlaylist[];
}

interface DownurlPayload {
  downlist?: {
    type?: { a?: string[]; b?: string[] };
    list?: {
      m?: string[];
      t?: string[];
      s?: string[];
      p?: string[];
      n?: string[];
      e?: number[];
    };
  };
  panlist?: {
    id?: string[];
    name?: string[];
    url?: string[];
    /** 网盘名字典（长度 = 网盘种类） */
    tname?: string[];
    user?: string[];
    time?: string[];
    p?: string[];
    /** 每条资源的网盘索引（对应 tname[type]） */
    type?: number[];
    /** 状态码，6 = 失效 */
    gid?: number[];
  };
  playlist?: Array<{ i?: string; t?: string; list?: string[] }>;
}

/** 把 /res/downurl 响应映射为磁力/网盘/在线线路（纯函数，便于单测） */
export function mapDownurl(payload: DownurlPayload): HgemeResources {
  const list = payload.downlist?.list ?? {};
  const qualityKeys = payload.downlist?.type?.b ?? [];
  const qualityLabels = payload.downlist?.type?.a ?? [];
  const qualityOf = (key: string | undefined): string => {
    if (!key) return '';
    const idx = qualityKeys.indexOf(key);
    return idx >= 0 ? (qualityLabels[idx] ?? key) : key;
  };

  const m = list.m ?? [];
  const t = list.t ?? [];
  const magnets: HgemeMagnet[] = [];
  const seen = new Set<string>();
  for (let n = 0; n < m.length; n += 1) {
    const hash = (m[n] ?? '').trim();
    if (!/^[a-fA-F0-9]{40}$/.test(hash)) continue;
    const hashLower = hash.toLowerCase();
    if (seen.has(hashLower)) continue;
    seen.add(hashLower);
    const qualityKey = (list.p?.[n] ?? '').trim();
    magnets.push({
      title: t[n] ?? `资源 ${n + 1}`,
      size: list.s?.[n] ?? '',
      qualityKey,
      quality: qualityOf(qualityKey),
      time: list.n?.[n] ?? '',
      seeds: typeof list.e?.[n] === 'number' ? (list.e?.[n] as number) : null,
      magnet: `magnet:?xt=urn:btih:${hashLower}&dn=${encodeURIComponent(t[n] ?? '')}`,
    });
  }

  const qualityCount = new Map<string, number>();
  for (const item of magnets) {
    const label = item.quality || '其他';
    qualityCount.set(label, (qualityCount.get(label) ?? 0) + 1);
  }
  const magnetGroups: HgemeGroup[] = [...qualityCount.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count);

  const pan = payload.panlist ?? {};
  const panDict = pan.tname ?? [];
  const pans: HgemePan[] = (pan.name ?? [])
    .map((name, n) => {
      const url = (pan.url?.[n] ?? '').trim();
      if (!url) return null;
      const typeIdx = pan.type?.[n];
      const netdisk =
        typeof typeIdx === 'number' && panDict[typeIdx] ? panDict[typeIdx] : '未知网盘';
      return {
        name,
        url,
        netdisk,
        user: (pan.user?.[n] ?? '').trim() || null,
        time: (pan.time?.[n] ?? '').trim() || null,
        hot: (pan.p?.[n] ?? '').trim() || null,
        invalid: pan.gid?.[n] === 6,
      };
    })
    .filter((x): x is HgemePan => x !== null);

  const panCount = new Map<string, number>();
  for (const item of pans) {
    panCount.set(item.netdisk, (panCount.get(item.netdisk) ?? 0) + 1);
  }
  const panGroups: HgemeGroup[] = [...panCount.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count);

  const playlists: HgemePlaylist[] = (payload.playlist ?? [])
    .filter((p) => p?.t)
    .map((p) => ({ name: p.t as string, episodes: Array.isArray(p.list) ? p.list : [] }));

  return { magnets, magnetGroups, pans, panGroups, playlists };
}

/** 拉取某影片条目的磁力/网盘/在线播放资源 */
export async function fetchHgemeResources(dir: string, id: string): Promise<HgemeResources> {
  if (!/^[a-z]{2,6}$/i.test(dir) || !/^[\w-]{2,16}$/.test(id)) {
    throw new ApiError(1001, '非法的资源标识', 400);
  }
  const text = await requestText(`/res/downurl/${encodeURIComponent(dir)}/${encodeURIComponent(id)}`);
  let payload: DownurlPayload;
  try {
    payload = JSON.parse(text) as DownurlPayload;
  } catch {
    throw baseError('hgme 资源数据解析失败');
  }
  return mapDownurl(payload);
}

// ---- 单条种子（ty 4 列表点击后） ----

export interface HgemeBtItem {
  id: string;
  title: string;
  size: string | null;
  magnet: string;
}

/** 从 /bt/<id> 页面解析磁力（纯函数） */
export function parseBtPage(html: string, id: string): HgemeBtItem | null {
  const magnet = /magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/i.exec(html);
  if (!magnet) return null;
  const title =
    /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ??
    (/_obj\.d=\{[^}]*"title":"([^"]*)"/.exec(html)?.[1] ?? '');
  const size = /"size":"([^"]*)"/.exec(html)?.[1] ?? null;
  return {
    id,
    title: title.replace(/^Loading\.\.\.$/i, ''),
    size,
    magnet: `magnet:?xt=urn:btih:${magnet[1].toLowerCase()}`,
  };
}

/** 拉取单条种子的磁力（种子 Tab 直接推送用） */
export async function fetchHgemeBt(id: string): Promise<HgemeBtItem> {
  if (!/^[\w-]{2,16}$/.test(id)) throw new ApiError(1001, '非法的种子标识', 400);
  const html = await requestText(`/bt/${encodeURIComponent(id)}`);
  const item = parseBtPage(html, id);
  if (!item) throw new ApiError(2005, '未从该种子页面解析到磁力链接', 502);
  return item;
}
