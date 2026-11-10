/**
 * 全局搜索页（P1 占位实现：基础 multi 搜索 + 结果网格）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { searchMedia } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { MediaItem } from '../api/types';
import MediaCard from '../components/media/MediaCard';
import TravelSearchBar from '../components/ui/TravelSearchBar';
import { Film, Layers } from 'lucide-react';
import Spinner from '../components/ui/Spinner';
import GlassPanel from '../components/ui/GlassPanel';

type TypeFilter = 'all' | 'movie' | 'tv';

export default function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const doSearch = useCallback(async (q: string): Promise<void> => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchMedia(trimmed, 1);
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 输入防抖自动搜索
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void doSearch(keyword);
    }, 450);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [keyword, doSearch]);

  const shown = results.filter((r) => typeFilter === 'all' || r.mediaType === typeFilter);

  return (
    <div>
      {/* 胶囊搜索栏：片名输入（450ms 防抖）+ 类型本地过滤 + 立即搜索 */}
      <TravelSearchBar
        className="mb-4"
        ariaLabel="全局搜索"
        autoFocusFirst
        actionLabel="立即搜索"
        onAction={() => void doSearch(keyword)}
        segments={[
          {
            id: 'keyword',
            label: '片名',
            icon: Film,
            kind: 'input',
            hint: loading ? '正在搜索…' : searched && shown.length > 0 ? `找到 ${shown.length} 项` : '搜索电影 / 剧集…',
            value: keyword,
            onChange: setKeyword,
          },
          {
            id: 'type',
            label: '类型',
            hint: '全部',
            icon: Layers,
            kind: 'select',
            value: typeFilter,
            onChange: (v) => setTypeFilter(v as TypeFilter),
            options: [
              { value: 'all', label: '全部' },
              { value: 'movie', label: '电影' },
              { value: 'tv', label: '剧集' },
            ],
          },
        ]}
      />

      {loading && <Spinner label="正在搜索" />}
      {!loading && error && (
        <GlassPanel className="mx-auto mt-6 max-w-[420px] p-6 text-center" bordered>
          <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>
        </GlassPanel>
      )}
      {!loading && !error && searched && shown.length === 0 && (
        <p className="type-body py-12 text-center text-txt-tertiary">没有找到与「{keyword}」相关的内容</p>
      )}
      {!loading && shown.length > 0 && (
        <div className="grid grid-cols-3 justify-items-center gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((item) => (
            <MediaCard key={`${item.mediaType}-${item.tmdbId}`} item={item} fill />
          ))}
        </div>
      )}
      {!searched && !loading && (
        <GlassPanel className="mx-auto mt-10 max-w-[420px] p-8 text-center" bordered>
          <i className="ri-search-eye-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">输入关键词开始搜索</p>
          <p className="type-caption mt-1 text-txt-tertiary">支持电影与剧集的模糊匹配</p>
        </GlassPanel>
      )}
    </div>
  );
}
