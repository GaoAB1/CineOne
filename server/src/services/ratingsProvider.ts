/**
 * 第三方评分回源适配器（组合模式）。
 *
 * 链路：AggregatorProvider 先行 → OmdbProvider 仅补仍为 null 的源。
 * - AggregatorProvider：settings 键 `douban_api_base` 指向的社区聚合接口，
 *   形如 {base}/{mediaType}/{tmdbId}，可一次填齐豆瓣/烂番茄/爆米花三源。
 * - OmdbProvider：settings 键 `omdb_api_key`，先经 tmdbService.fetchExternalIds
 *   映射 IMDb ID 再回源 OMDb API；OMDb 只能填 tomato 源（无观众分，
 *   popcorn 恒为 null，由聚合接口兜底）。
 *
 * 降级契约：任何一层未配置 / 请求失败 / 解析失败 → 对应源置 null，绝不抛出；
 * 两者均未配置时整体返回全 null，由 ratingsService 走缓存/手动兜底。
 */

import type { MediaType, RatingSourceKey } from '../types/domain';
import { fetchExternalIds } from './tmdbService';
import { getSetting } from './settingsService';

/** 单个评分源的回源结果 */
export interface ProviderRating {
  source: RatingSourceKey;
  /** 统一 0~10；null=查无数据 */
  score: number | null;
  /** 原始展示文本，如 "85%"、"7.8" */
  rawText: string | null;
  sourceUrl: string | null;
}

export interface RatingsProvider {
  /** 批量查询三个第三方源；任一失败该源置 null，绝不抛出中断聚合 */
  fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]>;
}

const REQUEST_TIMEOUT_MS = 6000;
const SOURCES: RatingSourceKey[] = ['douban', 'tomato', 'popcorn'];

function nullRating(source: RatingSourceKey): ProviderRating {
  return { source, score: null, rawText: null, sourceUrl: null };
}

function nullRatings(): ProviderRating[] {
  return SOURCES.map(nullRating);
}

/** 数值钳制到 [0,10]，非法输入返回 null */
function clampScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(10, Math.max(0, value));
}

/**
 * 聚合接口适配器：一次请求可填齐三源。
 * 响应约定形状 {douban:{score,raw_text,url}, tomato:…, popcorn:…}，容错解析。
 */
export class AggregatorProvider implements RatingsProvider {
  async fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]> {
    const base = getSetting('douban_api_base').trim().replace(/\/+$/, '');
    if (!base) return nullRatings(); // 未配置 → 明确的"暂无评分"降级
    try {
      const res = await fetch(`${base}/${mediaType}/${tmdbId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return nullRatings();
      const body = (await res.json()) as Record<string, unknown>;
      return SOURCES.map((source) => this.parseSource(source, body));
    } catch {
      // 超时/断网 → 全量降级为 null
      return nullRatings();
    }
  }

  /** 容错解析单源条目；缺失/形状不符均视为查无数据 */
  private parseSource(source: RatingSourceKey, body: Record<string, unknown>): ProviderRating {
    const entry = body[source];
    if (entry == null || typeof entry !== 'object') return nullRating(source);
    const obj = entry as Record<string, unknown>;
    return {
      source,
      score: clampScore(obj.score),
      rawText: typeof obj.raw_text === 'string' ? obj.raw_text : null,
      sourceUrl: typeof obj.url === 'string' ? obj.url : null,
    };
  }
}

interface OmdbRatingEntry {
  Source?: string;
  Value?: string;
}

/** OMDb API 适配器：仅能填充 tomato 源（douban/popcorn 恒为 null） */
export class OmdbProvider implements RatingsProvider {
  async fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]> {
    const result = new Map<RatingSourceKey, ProviderRating>(nullRatings().map((r) => [r.source, r]));
    const apiKey = getSetting('omdb_api_key').trim();
    if (!apiKey) return nullRatings(); // 未配 Key → 两源均 null
    try {
      const imdbId = await fetchExternalIds(tmdbId, mediaType);
      if (!imdbId) return nullRatings(); // imdb_id 缺失或映射失败 → OMDb 链路整体降级
      const url =
        `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}` +
        `&apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return nullRatings();
      const body = (await res.json()) as Record<string, unknown>;
      if (body.Response === 'False') return nullRatings(); // OMDb 业务层报错
      const entries = Array.isArray(body.Ratings) ? (body.Ratings as OmdbRatingEntry[]) : [];
      for (const entry of entries) {
        if (entry && entry.Source === 'Rotten Tomatoes') {
          const tomato = this.parseTomato(entry.Value ?? null, body);
          result.set(tomato.source, tomato);
          break;
        }
      }
    } catch {
      // 超时/断网/解析失败 → 全量降级为 null
    }
    return SOURCES.map((s) => result.get(s) ?? nullRating(s));
  }

  /**
   * 解析烂番茄条目：Value 形如 "85%"，score=百分比/10 统一到 0~10，
   * rawText 保留原值供前端展示，sourceUrl 取响应的 tomatoURL 字段。
   */
  private parseTomato(value: string | null, body: Record<string, unknown>): ProviderRating {
    let score: number | null = null;
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
      if (match) score = clampScore(Number.parseFloat(match[1]) / 10);
    }
    const tomatoUrl = typeof body.tomatoURL === 'string' ? body.tomatoURL : null;
    return {
      source: 'tomato',
      score,
      rawText: score != null ? value : null,
      sourceUrl: tomatoUrl,
    };
  }
}

/** 组合适配器：primary 结果先行，fallback 仅补仍为 null 的源 */
export class CompositeRatingsProvider implements RatingsProvider {
  constructor(
    private readonly primary: RatingsProvider,
    private readonly fallback: RatingsProvider,
  ) {}

  async fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]> {
    let merged = new Map<RatingSourceKey, ProviderRating>();
    try {
      merged = new Map(
        (await this.primary.fetchRatings(tmdbId, mediaType)).map((r) => [r.source, r]),
      );
    } catch {
      merged = new Map(nullRatings().map((r) => [r.source, r]));
    }

    const missing = SOURCES.filter((s) => merged.get(s)?.score == null);
    if (missing.length > 0) {
      try {
        for (const r of await this.fallback.fetchRatings(tmdbId, mediaType)) {
          const current = merged.get(r.source);
          if ((!current || current.score == null) && r.score != null) {
            merged.set(r.source, r);
          }
        }
      } catch {
        // 补缺失败 → 维持 primary 结果（含 null），不中断
      }
    }

    return SOURCES.map((s) => merged.get(s) ?? nullRating(s));
  }
}

let provider: RatingsProvider | null = null;

/** 获取单例 Provider（可注入替换实现） */
export function getRatingsProvider(): RatingsProvider {
  if (!provider) {
    provider = new CompositeRatingsProvider(new AggregatorProvider(), new OmdbProvider());
  }
  return provider;
}

/** 测试/扩展时注入真实供应商实现 */
export function setRatingsProvider(p: RatingsProvider): void {
  provider = p;
}
