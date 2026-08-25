/**
 * 第三方评分聚合接口适配器 —— 接口契约 + mock 实现。
 *
 * 真实供应商未锁定（候选：SIMKL / Trakt 衍生服务 / 社区公开镜像）。
 * 当前实现：若配置了 RATINGS_API_URL 环境变量则尝试真实调用（带超时与降级），
 * 否则直接返回 null 表示"查无数据"，由 ratingsService 走缓存/手动兜底。
 */

import type { MediaType, RatingSourceKey } from '../types/domain';

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

/** mock / 降级实现：RATINGS_API_URL 存在时回源，否则全部返回 null */
export class MockRatingsProvider implements RatingsProvider {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = (endpoint ?? '').trim();
  }

  async fetchRatings(tmdbId: number, mediaType: MediaType): Promise<ProviderRating[]> {
    if (!this.endpoint) {
      // 未配置供应商 → 明确的"暂无评分"降级
      return SOURCES.map((source) => ({ source, score: null, rawText: null, sourceUrl: null }));
    }
    try {
      const res = await fetch(`${this.endpoint}/${mediaType}/${tmdbId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return SOURCES.map((source) => ({ source, score: null, rawText: null, sourceUrl: null }));
      }
      const body = (await res.json()) as Record<string, unknown>;
      return SOURCES.map((source) => this.parseSource(source, body));
    } catch {
      // 超时/断网 → 全量降级为 null
      return SOURCES.map((source) => ({ source, score: null, rawText: null, sourceUrl: null }));
    }
  }

  /** 解析约定形状 {douban:{score,raw_text,url}, tomato:…, popcorn:…}，容错解析 */
  private parseSource(source: RatingSourceKey, body: Record<string, unknown>): ProviderRating {
    const entry = body[source];
    if (entry == null || typeof entry !== 'object') {
      return { source, score: null, rawText: null, sourceUrl: null };
    }
    const obj = entry as Record<string, unknown>;
    const score =
      typeof obj.score === 'number' && Number.isFinite(obj.score)
        ? Math.min(10, Math.max(0, obj.score))
        : null;
    const rawText = typeof obj.raw_text === 'string' ? obj.raw_text : null;
    const sourceUrl = typeof obj.url === 'string' ? obj.url : null;
    return { source, score, rawText, sourceUrl };
  }
}

let provider: RatingsProvider | null = null;

/** 获取单例 Provider（可注入替换实现） */
export function getRatingsProvider(): RatingsProvider {
  if (!provider) {
    provider = new MockRatingsProvider(process.env.RATINGS_API_URL);
  }
  return provider;
}

/** 测试/扩展时注入真实供应商实现 */
export function setRatingsProvider(p: RatingsProvider): void {
  provider = p;
}
