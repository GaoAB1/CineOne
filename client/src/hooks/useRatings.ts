/**
 * 详情页四源评分异步加载。
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchRatings, putManualRating } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { MediaType } from '../api/types';

type RatingsAggregate = Awaited<ReturnType<typeof fetchRatings>>;

interface UseRatingsResult {
  ratings: RatingsAggregate | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  correct: (
    source: 'douban' | 'tomato' | 'popcorn',
    score: number | null,
    rawText?: string,
  ) => Promise<void>;
}

export function useRatings(type: MediaType, tmdbId: number): UseRatingsResult {
  const [ratings, setRatings] = useState<RatingsAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // 无效 ID（如路由参数缺失）时静默置空
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      setRatings(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRatings(await fetchRatings(type, tmdbId));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 2001) {
        // TMDB 未配置时评分接口仍可用，但保持静默降级
        setRatings(null);
      } else {
        setError(err instanceof ApiClientError ? err.message : '评分加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [type, tmdbId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const correct = useCallback(
    async (
      source: 'douban' | 'tomato' | 'popcorn',
      score: number | null,
      rawText?: string,
    ): Promise<void> => {
      await putManualRating(type, tmdbId, source, score, rawText);
      await reload();
    },
    [type, tmdbId, reload],
  );

  return { ratings, loading, error, reload, correct };
}

export default useRatings;
