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

// ---- 搜索 ----

export interface HgemeSearchItem {
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
  title?: string[];
  name?: string[];
  year?: number[];
  d?: string[];
  i?: string[];
  info?: string[];
  daoyan?: string[];
  zhuyan?: string[];
  pf?: { db?: { s?: number[] } };
}

/** 把 _obj.search 映射为条目数组（纯函数，便于单测） */
export function mapSearchInline(data: Record<string, unknown>): HgemeSearchItem[] {
  const l = (data.l ?? {}) as SearchInlineL;
  const titles = l.title ?? [];
  const ids = l.i ?? [];
  const dirs = l.d ?? [];
  return titles
    .map((title, n) => {
      const id = ids[n];
      if (!id) return null;
      const scores = l.pf?.db?.s ?? [];
      return {
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
    .filter((x): x is HgemeSearchItem => x !== null);
}

export interface HgemeSearchResult {
  items: HgemeSearchItem[];
  /** 各分类结果数汇总（服务端提供，用于估算总页数） */
  total: number;
}

/** 搜索（关键词）；每页 19 条 */
export async function searchHgeme(keyword: string, page = 1): Promise<HgemeSearchResult> {
  const kw = keyword.trim();
  if (!kw) throw new ApiError(1001, '搜索关键词不能为空', 400);
  const pageParam = page > 1 ? `&p=${Math.min(50, page)}` : '';
  const html = await requestText(`/search?q=${encodeURIComponent(kw)}${pageParam}`);
  const inline = parseSearchInline(html);
  if (!inline) {
    if (html.includes('浏览器安全验证')) {
      throw new ApiError(2006, 'hgme 需要浏览器验证，请更新 Cookie', 502);
    }
    return { items: [], total: 0 };
  }
  const ns = Array.isArray(inline.ns) ? (inline.ns as unknown[]) : [];
  const total = ns.reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
  return { items: mapSearchInline(inline), total };
}

// ---- 资源（磁力 + 网盘） ----

export interface HgemeMagnet {
  title: string;
  size: string;
  tag: string;
  time: string;
  magnet: string;
}

export interface HgemePan {
  name: string;
  url: string;
  netdisk: string;
  user: string | null;
  time: string | null;
}

export interface HgemeResources {
  magnets: HgemeMagnet[];
  pans: HgemePan[];
}

interface DownurlPayload {
  downlist?: {
    list?: {
      m?: string[];
      t?: string[];
      s?: string[];
      p?: string[];
      n?: string[];
    };
  };
  panlist?: {
    id?: string[];
    name?: string[];
    url?: string[];
    tname?: string[];
    user?: string[];
    time?: string[];
  };
}

/** 把 /res/downurl 响应映射为磁力与网盘列表（纯函数，便于单测） */
export function mapDownurl(payload: DownurlPayload): HgemeResources {
  const list = payload.downlist?.list ?? {};
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
    magnets.push({
      title: t[n] ?? `资源 ${n + 1}`,
      size: list.s?.[n] ?? '',
      tag: list.p?.[n] ?? '',
      time: list.n?.[n] ?? '',
      magnet: `magnet:?xt=urn:btih:${hashLower}&dn=${encodeURIComponent(t[n] ?? '')}`,
    });
  }

  const pan = payload.panlist ?? {};
  const pans: HgemePan[] = (pan.name ?? [])
    .map((name, n) => {
      const url = (pan.url?.[n] ?? '').trim();
      if (!url) return null;
      return {
        name,
        url,
        netdisk: pan.tname?.[n] ?? '',
        user: pan.user?.[n] ?? null,
        time: pan.time?.[n] ?? null,
      };
    })
    .filter((x): x is HgemePan => x !== null);

  return { magnets, pans };
}

/** 拉取某条目的磁力与网盘资源 */
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
