/**
 * 资源搜索服务：代理抓取 BT 站 1lou（壹楼）搜索页并解析为结构化条目。
 *
 * 站点事实（实测）：
 *  - 搜索页路由：/search-<urlencode(关键词)>.htm，翻页为 /search-<关键词>-1-<page>.htm
 *  - 结果为 Xiuno 模板 li.media.thread，每页 20 条，含标题/标签/作者/日期/查看/评论
 *  - 搜索响应较慢（30s 级），故超时 45s + 20 分钟内存缓存 + 同 key 并发去重
 */

import { ApiError } from '../middleware/errorHandler';
import { HGEME_CATEGORIES, hgemeConfigured, searchHgeme, type HgemeSearchItem } from './hgemeService';

const SITE_BASE = 'https://1lou.cc';
const Hgeme = 'https://www.hgeme.com';
const REQUEST_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 20 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 资源来源站 */
export type ResourceSource = '1lou' | 'hgeme';

export interface ResourceItem {
  /** 来源站标识（前端据此展示标签与下载流程） */
  source: ResourceSource;
  /** hgeme 条目类型：影片候选 / 单个种子 / 网盘链接 */
  kind?: 'title' | 'torrent' | 'pan';
  tid: string;
  title: string;
  url: string;
  tags: string[];
  author: string | null;
  date: string | null;
  views: number | null;
  comments: number | null;
  /** hgeme 专有：类型段（mv/tv/bt…），下载时回传 */
  dir?: string;
  year?: number | null;
  rating?: number | null;
  info?: string | null;
  /** hgeme 种子条目：体积与做种数 */
  size?: string;
  seeds?: number | null;
  /** hgeme 网盘条目：网盘名与热度标记 */
  netdisk?: string | null;
  hot?: string | null;
}

export interface ResourceSearchResult {
  keyword: string;
  page: number;
  totalPages: number;
  items: ResourceItem[];
  /** 结果来自缓存（供前端提示） */
  cached: boolean;
}

/** 站内搜索 URL（page<=1 时省略分页段） */
export function buildSearchUrl(keyword: string, page = 1): string {
  const kw = encodeURIComponent(keyword.trim());
  return page <= 1
    ? `${SITE_BASE}/search-${kw}.htm`
    : `${SITE_BASE}/search-${kw}-1-${page}.htm`;
}

/** 去除标签并解码常见 HTML 实体 */
export function decodeEntities(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 1lou 搜索结果页 HTML（纯函数，便于单测）。
 * 无结果 / 结构变化时不抛错，返回空列表。
 */
export function parseSearchHtml(html: string): { items: ResourceItem[]; totalPages: number } {
  const items: ResourceItem[] = [];
  const blocks = html.match(/<li class="media thread[\s\S]*?<\/li>/g) ?? [];

  for (const block of blocks) {
    const tid = /data-tid="(\d+)"/.exec(block)?.[1];
    const titleRaw =
      /<div class="subject[^"]*">[\s\S]*?<a href="thread-\d+\.htm"[^>]*>([\s\S]*?)<\/a>/.exec(
        block,
      )?.[1];
    if (!tid || !titleRaw) continue;
    const title = decodeEntities(titleRaw);
    if (!title) continue;

    const tags: string[] = [];
    const tagRe = /<a href="forum-[^"]*"[^>]*class="badge[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRe.exec(block)) !== null) {
      const tag = decodeEntities(tagMatch[1]);
      if (tag) tags.push(tag);
    }

    items.push({
      source: '1lou',
      tid,
      title,
      url: `${SITE_BASE}/thread-${tid}.htm`,
      tags,
      author: decodeEntities(/<span class="username[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1] ?? '') || null,
      date: decodeEntities(/<span class="date[^"]*">([\s\S]*?)<\/span>/.exec(block)?.[1] ?? '') || null,
      views: toNumber(/icon-eye"><\/i>\s*([\d,]+)/.exec(block)?.[1]),
      comments: toNumber(/icon-comment-o"><\/i>\s*([\d,]+)/.exec(block)?.[1]),
    });
  }

  // 总页数：取分页链接 search-<kw>-1-<n>.htm 中的最大 n
  let totalPages = 1;
  const pageRe = /search-[^"]*?-1-(\d+)\.htm/g;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageRe.exec(html)) !== null) {
    const n = Number.parseInt(pageMatch[1], 10);
    if (Number.isFinite(n) && n > totalPages) totalPages = n;
  }

  return { items, totalPages };
}

const cache = new Map<string, { ts: number; data: ResourceSearchResult }>();
const inflight = new Map<string, Promise<ResourceSearchResult>>();

/** 清空缓存（测试 / 手动刷新用） */
export function clearResourceCache(): void {
  cache.clear();
  inflight.clear();
  attachmentCache.clear();
}

// ---- 帖子附件（.torrent）解析与下载 ----

export interface ResourceAttachment {
  aid: string;
  filename: string;
  url: string;
}

export interface TorrentFile {
  filename: string;
  data: Uint8Array;
}

const THREAD_TIMEOUT_MS = 20_000;
const ATTACH_TIMEOUT_MS = 60_000;
const attachmentCache = new Map<string, { ts: number; items: ResourceAttachment[] }>();

/**
 * 解析帖子页「上传的附件」区块，提取 .torrent 附件（1lou 无磁力，只提供种子文件）。
 * 结构：<li aid="2995163"><a href="attach-download-2995163.htm"><i class="...torrent"></i>名字.torrent</a></li>
 */
export function parseThreadAttachments(html: string): ResourceAttachment[] {
  const items: ResourceAttachment[] = [];
  const re = /<li aid="(\d+)"[\s\S]*?<a href="(attach-download-\d+\.htm)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const aid = m[1];
    const href = m[2];
    const filename = decodeEntities(m[3]);
    if (!filename) continue;
    if (!/\.torrent$/i.test(filename)) continue;
    items.push({ aid, filename, url: `${SITE_BASE}/${href}` });
  }
  return items;
}

/** 抓取帖子页并解析种子附件（30 分钟缓存） */
export async function fetchThreadAttachments(tid: string): Promise<ResourceAttachment[]> {
  const cached = attachmentCache.get(tid);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const url = `${SITE_BASE}/thread-${encodeURIComponent(tid)}.htm`;
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(THREAD_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
  } catch {
    throw new ApiError(2005, '抓取资源帖子超时，请稍后重试', 504);
  }
  if (!res.ok) throw new ApiError(2005, `抓取资源帖子失败（HTTP ${res.status}）`, 502);

  const items = parseThreadAttachments(await res.text());
  attachmentCache.set(tid, { ts: Date.now(), items });
  return items;
}

/** 下载种子文件（校验 bencode 头，避免把登录/权限提示页当种子返回） */
export async function downloadTorrent(attachment: ResourceAttachment): Promise<TorrentFile> {
  let res: Response;
  try {
    res = await fetch(attachment.url, {
      signal: AbortSignal.timeout(ATTACH_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
  } catch {
    throw new ApiError(2005, '下载种子文件超时，请稍后重试', 504);
  }
  if (!res.ok) throw new ApiError(2005, `下载种子文件失败（HTTP ${res.status}）`, 502);

  const buf = new Uint8Array(await res.arrayBuffer());
  const head = Buffer.from(buf.slice(0, 16)).toString('latin1');
  // 合法 torrent 为 bencode 字典（以 d 开头，通常 d8:announce）
  if (!head.startsWith('d') || buf.length < 30) {
    throw new ApiError(2005, '未获取到有效的种子文件（源站可能要求登录）', 502);
  }
  return { filename: attachment.filename, data: buf };
}

// ---- 多源聚合（1lou + hgeme） ----

/** hgeme 每页条目数（站点固定 19 条） */
const HgemePageSize = 19;

export type ResourceSourceFilter = 'all' | ResourceSource;

export interface ResourceSourceStatus {
  source: ResourceSource;
  ok: boolean;
  count: number;
  error?: string;
}

export interface AggregatedSearchResult {
  keyword: string;
  page: number;
  totalPages: number;
  items: ResourceItem[];
  cached: boolean;
  sources: ResourceSourceStatus[];
  /** hgeme 专属：分类 Tab 计数与资源类型筛选字典 */
  hgeme: {
    categories: Array<{ key: number; label: string }>;
    ty: number;
    counts: number[];
    filters: Record<string, number>;
    filterCurrent: string;
  } | null;
}

/** hgeme 搜索结果 → 统一 ResourceItem（支持影片/种子/网盘三类） */
export function mapHgemeItems(items: HgemeSearchItem[]): ResourceItem[] {
  return items.map((item) => {
    if (item.kind === 'torrent') {
      const tags: string[] = [];
      if (item.size) tags.push(item.size);
      if (item.seeds != null) tags.push(`${item.seeds} 做种`);
      return {
        source: 'hgeme',
        kind: 'torrent',
        tid: item.id,
        dir: 'bt',
        title: item.title,
        url: `${Hgeme}/bt/${item.id}`,
        tags,
        author: null,
        date: item.time,
        views: null,
        comments: null,
        size: item.size,
        seeds: item.seeds,
      };
    }

    if (item.kind === 'pan') {
      return {
        source: 'hgeme',
        kind: 'pan',
        tid: item.url,
        title: item.title,
        url: item.url,
        tags: [item.netdisk].filter(Boolean),
        author: item.user,
        date: item.time,
        views: null,
        comments: null,
        netdisk: item.netdisk || null,
        hot: item.hot,
      };
    }

    const tags: string[] = [];
    if (item.year) tags.push(String(item.year));
    if (item.info) tags.push(...item.info.split(/\s*\/\s*/).filter(Boolean).slice(0, 3));
    return {
      source: 'hgeme',
      kind: 'title',
      tid: item.id,
      dir: item.dir,
      title: item.title,
      url: `${Hgeme}/${item.dir}/${item.id}`,
      tags,
      author: item.directors[0] ?? null,
      date: null,
      views: null,
      comments: null,
      year: item.year,
      rating: item.rating,
      info: item.info,
    };
  });
}

/**
 * 聚合搜索：按 source 参数选择来源（all = 并行两源，单源失败不影响另一源）。
 */
export async function searchAggregated(
  keyword: string,
  page: number,
  source: ResourceSourceFilter = 'all',
  hgemeOpts: { type?: number; filter?: string } = {},
): Promise<AggregatedSearchResult> {
  const kw = keyword.trim();
  if (!kw) throw new ApiError(1001, '搜索关键词不能为空', 400);
  const sources: ResourceSourceStatus[] = [];
  const items: ResourceItem[] = [];
  let totalPages = 1;
  let cached = false;
  let hgeme: AggregatedSearchResult['hgeme'] = null;

  const wantOneLou = source === 'all' || source === '1lou';
  const wantHgeme = (source === 'all' || source === 'hgeme') && hgemeConfigured();

  const tasks: Array<Promise<void>> = [];

  if (wantOneLou) {
    tasks.push(
      searchResources(kw, page)
        .then((res) => {
          items.push(...res.items);
          totalPages = Math.max(totalPages, res.totalPages);
          cached = cached || res.cached;
          sources.push({ source: '1lou', ok: true, count: res.items.length });
        })
        .catch((err: unknown) => {
          sources.push({
            source: '1lou',
            ok: false,
            count: 0,
            error: err instanceof ApiError ? err.message : '1lou 搜索失败',
          });
        }),
    );
  }

  if (wantHgeme) {
    tasks.push(
      searchHgeme(kw, page, hgemeOpts)
        .then((res) => {
          const mapped = mapHgemeItems(res.items);
          items.push(...mapped);
          const tyCount = res.counts[res.ty] ?? mapped.length;
          if (tyCount > 0) totalPages = Math.max(totalPages, Math.ceil(tyCount / HgemePageSize));
          hgeme = {
            categories: HGEME_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
            ty: res.ty,
            counts: res.counts,
            filters: res.filters,
            filterCurrent: res.filterCurrent,
          };
          sources.push({ source: 'hgeme', ok: true, count: mapped.length });
        })
        .catch((err: unknown) => {
          sources.push({
            source: 'hgeme',
            ok: false,
            count: 0,
            error: err instanceof ApiError ? err.message : 'hgme 搜索失败',
          });
        }),
    );
  }

  if (tasks.length === 0) {
    throw new ApiError(2006, '未启用任何资源源（请在设置中配置 hgeme Cookie 或使用 1lou）', 400);
  }

  await Promise.all(tasks);

  // 全部源都失败 → 抛出首个错误，便于前端提示
  if (sources.length > 0 && sources.every((s) => !s.ok) && items.length === 0) {
    throw new ApiError(2007, sources[0].error ?? '资源搜索失败', 502);
  }

  return { keyword: kw, page, totalPages, items, cached, sources, hgeme };
}


async function fetchSearchPage(keyword: string, page: number): Promise<ResourceSearchResult> {
  const url = buildSearchUrl(keyword, page);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
  } catch {
    throw new ApiError(2003, '资源站访问超时或网络不可达，请稍后重试', 504);
  }
  if (!res.ok) {
    throw new ApiError(2003, `资源站返回异常（HTTP ${res.status}）`, 502);
  }
  const html = await res.text();
  const { items, totalPages } = parseSearchHtml(html);
  return { keyword, page, totalPages, items, cached: false };
}

/** 搜索资源（带 20 分钟缓存 + 同 key 并发去重） */
export async function searchResources(keyword: string, page = 1): Promise<ResourceSearchResult> {
  const kw = keyword.trim();
  if (!kw) throw new ApiError(1001, '搜索关键词不能为空', 400);
  const safePage = Math.min(50, Math.max(1, page));
  const key = `${kw}|${safePage}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { ...hit.data, cached: true };
  }

  const running = inflight.get(key);
  if (running) return running;

  const task = fetchSearchPage(kw, safePage)
    .then((data) => {
      cache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}
