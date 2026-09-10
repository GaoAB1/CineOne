/**
 * 资源搜索服务：代理抓取 BT 站 1lou（壹楼）搜索页并解析为结构化条目。
 *
 * 站点事实（实测）：
 *  - 搜索页路由：/search-<urlencode(关键词)>.htm，翻页为 /search-<关键词>-1-<page>.htm
 *  - 结果为 Xiuno 模板 li.media.thread，每页 20 条，含标题/标签/作者/日期/查看/评论
 *  - 搜索响应较慢（30s 级），故超时 45s + 20 分钟内存缓存 + 同 key 并发去重
 */

import { ApiError } from '../middleware/errorHandler';

const SITE_BASE = 'https://1lou.cc';
const REQUEST_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 20 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface ResourceItem {
  tid: string;
  title: string;
  url: string;
  tags: string[];
  author: string | null;
  date: string | null;
  views: number | null;
  comments: number | null;
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
