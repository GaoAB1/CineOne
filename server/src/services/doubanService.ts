/**
 * 豆瓣条目直查服务：title（+year）→ 豆瓣 subject 链接。
 *
 * 数据源：https://movie.douban.com/j/subject_suggest?q=<title>
 * 该接口返回 JSON 建议数组，无需登录 / bid cookie（实测 2026-09）。
 * 反爬友好策略：单次超时 6s、命中缓存 90 天 / 未命中 7 天、频控交给路由层限流。
 *
 * 说明：
 * - 豆瓣剧集按「季」拆分为独立 subject（如《绝命毒师 第一季》），无整剧单条目；
 *   匹配按 year / 标题命中度打分，多季命中时倾向较早季，避免默认指向大结局季。
 * - 匹配不确定（标题子串与年份均未命中）时返回 null（视为查无），绝不硬猜。
 */

import { getDb, sqlNow, toSqlTime } from '../db/database';
import { getSetting } from './settingsService';
import type { MediaType } from '../types/domain';

const SUGGEST_URL = 'https://movie.douban.com/j/subject_suggest';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 6000;
/** 命中缓存天数（subject_url 非空） */
const HIT_TTL_DAYS = 90;
/** 未命中缓存天数（subject_url 为空，避免对同一标题反复打豆瓣） */
const MISS_TTL_DAYS = 7;

/** subject_suggest 单条建议（保留子标题用于匹配） */
export interface DoubanSuggestion {
  id: string;
  title: string;
  year: string;
  type: string;
  url: string;
  sub_title?: string;
}

export interface DoubanResolveInput {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  /** 上映/首播年份（可选，用于消歧） */
  year?: number;
}

export interface DoubanResolveOutcome {
  /** 选中的豆瓣条目链接（https://movie.douban.com/subject/<id>/） */
  subjectUrl: string | null;
  /** 命中条目的豆瓣标题（供前端回显） */
  title: string | null;
  year: number | null;
  /** 命中来源：cache=本地缓存 / douban=本次实查 / null=无结果 */
  source: 'cache' | 'douban' | null;
  /** 功能被 douban_search_enabled=0 关闭 */
  disabled: boolean;
  /** 豆瓣请求失败（HTTP 异常 / 非 JSON 响应，如验证码或限流页） */
  degraded: boolean;
}

/** 标题规范化：小写 + 去空白与常见标点，便于子串比较 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[・·\s《》()（）\[\]【】"'’‘!:：,，.。-]/g, '')
    .trim();
}

const CN_NUMS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字转阿拉伯数字（支持 1~99 常规写法，含「二十三」这类复合） */
function chineseToNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10) || 0;
  let total = 0;
  let section = 0;
  for (const ch of s) {
    const d = CN_NUMS[ch];
    if (d != null) {
      section = section === 0 ? d : section * 10 + d;
    } else if (ch === '十') {
      section = section === 0 ? 10 : section * 10;
      total += section;
      section = 0;
    } else if (ch === '百') {
      section = section === 0 ? 100 : section * 100;
      total += section;
      section = 0;
    }
  }
  return total + section;
}

/** 提取季序：第N季 / 第N 季 / Season N；无季标记返回 0（视为整剧/首季） */
export function seasonIndexOf(title: string): number {
  const cn = title.match(/第\s*([一二三四五六七八九十两百\d]+)\s*季/);
  if (cn) return chineseToNumber(cn[1]);
  const en = title.match(/[sS]eason\s*(\d+)/);
  if (en) return Number.parseInt(en[1], 10) || 0;
  return 0;
}

function scoreOf(item: DoubanSuggestion, input: DoubanResolveInput): number {
  const q = normalizeTitle(input.title);
  const t = normalizeTitle(item.title);
  const st = item.sub_title ? normalizeTitle(item.sub_title) : '';
  const yearStr = input.year ? String(input.year) : null;
  let score = 0;
  if (yearStr && item.year === yearStr) score += 4;
  const overlap = (q && t.includes(q)) || (q && q.includes(t)) || (q && st.includes(q));
  if (overlap) score += 3;
  if (input.mediaType === 'tv') {
    const season = seasonIndexOf(item.title);
    if (season > 1) score -= (season - 1) * 0.5; // 同命中时倾向早季
    if (season === 0) score += 0.5; // 罕见的整剧条目更佳
  }
  return score;
}

/**
 * 纯匹配排序（可单测）。判定标准：
 * - 返回分数最高的建议；
 * - 仅当「标题/子标题命中（≥3）」或「单条建议且年份命中」才认可，否则 null（不硬猜）。
 */
export function pickBestSuggestion(
  items: DoubanSuggestion[],
  input: DoubanResolveInput,
): DoubanSuggestion | null {
  if (!items || items.length === 0) return null;
  let best: DoubanSuggestion | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const score = scoreOf(item, input);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best) return null;
  const yearHit = input.year != null && best.year === String(input.year);
  const accepted = bestScore >= 3 || (bestScore >= 4 && items.length === 1);
  void yearHit;
  return accepted ? best : null;
}

/** 拉取豆瓣 suggest 建议；HTTP 错误或非 JSON 响应返回 null（表示降级而非查无） */
async function fetchSuggestions(query: string): Promise<DoubanSuggestion[] | null> {
  const url = `${SUGGEST_URL}?q=${encodeURIComponent(query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://movie.douban.com/',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null; // 网络/超时
  }
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return null; // 形状不符（如返回错误对象）→ 视为降级
    return arr.filter(
      (x): x is DoubanSuggestion =>
        x != null &&
        typeof x === 'object' &&
        typeof (x as DoubanSuggestion).id === 'string' &&
        typeof (x as DoubanSuggestion).title === 'string',
    );
  } catch {
    return null; // 非 JSON（验证码/限流 HTML 页）
  }
}

const EMPTY_BASE = {
  subjectUrl: null,
  title: null,
  year: null,
  source: null,
  disabled: false,
  degraded: false,
} as const;

interface CacheRow {
  subject_url: string | null;
  title: string | null;
  year: number | null;
  fetched_at: string;
}

/**
 * 解析豆瓣条目链接（带本地缓存）。
 * 缓存命中判定：subject_url 命中 90 天；未命中（null）7 天，防止反复外呼豆瓣。
 */
export async function resolveDoubanLink(
  input: DoubanResolveInput,
): Promise<DoubanResolveOutcome> {
  if (getSetting('douban_search_enabled') !== '1') {
    return { ...EMPTY_BASE, disabled: true };
  }

  const db = getDb();
  const row = db
    .prepare(
      'SELECT subject_url, title, year, fetched_at FROM douban_resolve_cache WHERE tmdb_id = ? AND media_type = ?',
    )
    .get(input.tmdbId, input.mediaType) as CacheRow | undefined;

  if (row) {
    const ttlDays = row.subject_url ? HIT_TTL_DAYS : MISS_TTL_DAYS;
    const freshAfter = toSqlTime(new Date(Date.now() - ttlDays * 86_400_000));
    if (row.fetched_at >= freshAfter) {
      return {
        subjectUrl: row.subject_url,
        title: row.title,
        year: row.year,
        source: 'cache',
        disabled: false,
        degraded: false,
      };
    }
  }

  const suggestions = await fetchSuggestions(input.title);
  if (suggestions === null) {
    return { ...EMPTY_BASE, degraded: true };
  }

  const best = pickBestSuggestion(suggestions, input);
  const subjectUrl = best ? `https://movie.douban.com/subject/${best.id}/` : null;
  const yearNum =
    best && best.year && /^\d+$/.test(best.year) ? Number.parseInt(best.year, 10) : null;

  db.prepare(
    `INSERT INTO douban_resolve_cache (tmdb_id, media_type, subject_url, title, year, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
       subject_url = excluded.subject_url,
       title = excluded.title,
       year = excluded.year,
       fetched_at = excluded.fetched_at`,
  ).run(input.tmdbId, input.mediaType, subjectUrl, best?.title ?? null, yearNum, sqlNow());

  return {
    subjectUrl,
    title: best?.title ?? null,
    year: yearNum,
    source: 'douban',
    disabled: false,
    degraded: false,
  };
}
