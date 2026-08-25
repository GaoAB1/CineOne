/**
 * 追剧列表加载/变更 mutations。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createWatchItem,
  deleteWatchItem as apiDeleteWatchItem,
  listWatchlist,
  patchWatchItem,
  type CreateWatchInput,
  type PatchWatchInput,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { WatchItem, WatchStatus } from '../api/types';

interface UseWatchlistResult {
  items: WatchItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (input: CreateWatchInput) => Promise<WatchItem>;
  update: (id: number, patch: PatchWatchInput) => Promise<WatchItem>;
  remove: (id: number) => Promise<void>;
}

export function useWatchlist(status?: WatchStatus): UseWatchlistResult {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listWatchlist(status));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '追剧列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async (input: CreateWatchInput): Promise<WatchItem> => {
    const created = await createWatchItem(input);
    setItems((prev) =>
      prev.some((i) => i.tmdbId === created.tmdbId && i.mediaType === created.mediaType)
        ? prev.map((i) =>
            i.tmdbId === created.tmdbId && i.mediaType === created.mediaType ? created : i,
          )
        : [created, ...prev],
    );
    return created;
  }, []);

  const update = useCallback(async (id: number, patch: PatchWatchInput): Promise<WatchItem> => {
    const updated = await patchWatchItem(id, patch);
    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    return updated;
  }, []);

  const remove = useCallback(async (id: number): Promise<void> => {
    await apiDeleteWatchItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return { items, loading, error, refresh, add, update, remove };
}

export default useWatchlist;
