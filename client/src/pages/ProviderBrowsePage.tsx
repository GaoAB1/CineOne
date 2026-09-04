/**
 * 平台浏览页 /providers/:regionKey/:providerKey：
 * 按流媒体平台分页浏览片库（电影/剧集 Tab），点击进入详情。
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchProviderItems,
  fetchProviderRegions,
  type ProviderEntry,
  type ProviderRegionGroup,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { MediaItem, MediaType } from '../api/types';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import SegmentedControl from '../components/ui/SegmentedControl';
import GlassPanel from '../components/ui/GlassPanel';
import MediaCard from '../components/media/MediaCard';

const PAGE_SIZE = 40;

export default function ProviderBrowsePage() {
  const { regionKey = '', providerKey = '' } = useParams<{
    regionKey: string;
    providerKey: string;
  }>();
  const navigate = useNavigate();

  const [regions, setRegions] = useState<ProviderRegionGroup[]>([]);
  const [metaReady, setMetaReady] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [type, setType] = useState<MediaType>('movie');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 平台元信息（名称/logo/稳定 id）
  useEffect(() => {
    let cancelled = false;
    fetchProviderRegions()
      .then((res) => {
        if (!cancelled) {
          setRegions(res.regions ?? []);
          setMetaReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMetaReady(true);
          setNotFound(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const group = regions.find((r) => r.key === regionKey);
  const provider: ProviderEntry | undefined = group?.providers.find(
    (p) => p.key === providerKey,
  );

  useEffect(() => {
    if (metaReady && (!group || !provider)) setNotFound(true);
  }, [metaReady, group, provider]);

  const loadFirstPage = useCallback(
    async (mediaType: MediaType, providerId: number, region: 'us' | 'cn'): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchProviderItems({
          region,
          providerId,
          type: mediaType,
          page: 1,
        });
        setItems(res.results);
        setTotal(res.totalPages);
        setPage(1);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : '片库加载失败');
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!metaReady || !provider || notFound) return;
    void loadFirstPage(type, provider.id, group!.key);
  }, [metaReady, provider, notFound, type, loadFirstPage, group]);

  const loadMore = async (): Promise<void> => {
    if (!provider || loadingMore || page >= total) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchProviderItems({
        region: group!.key,
        providerId: provider.id,
        type,
        page: next,
      });
      setItems((prev) => [...prev, ...res.results]);
      setTotal(res.totalPages);
      setPage(next);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  if (notFound && metaReady) {
    return (
      <GlassPanel className="mx-auto mt-10 max-w-[460px] p-8 text-center" bordered>
        <i className="ri-film-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
        <h2 className="type-headline mt-3">未找到该平台</h2>
        <p className="type-caption mt-2 text-txt-secondary">返回首页从「流媒体平台」选择进入。</p>
        <Link to="/">
          <Button variant="filled" className="mt-5">
            返回首页
          </Button>
        </Link>
      </GlassPanel>
    );
  }

  const handleBack = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="pb-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="plain"
            className="-ml-3 text-[15px]"
            icon={<i className="ri-arrow-left-line text-[20px]" aria-hidden />}
            onClick={handleBack}
            aria-label="返回上一级"
          >
            返回
          </Button>
          {provider && (
            <span
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-line"
              style={{ background: '#FFFFFF' }}
            >
              {provider.logoPath ? (
                <img src={provider.logoPath} alt="" className="h-7 w-7 object-contain" />
              ) : (
                <i
                  className="ri-play-circle-fill text-[22px]"
                  style={{ color: 'var(--color-glow)' }}
                  aria-hidden
                />
              )}
            </span>
          )}
          <div>
            <h1 className="type-title leading-tight">{provider?.name ?? '平台片库'}</h1>
            <p className="type-caption text-txt-tertiary">
              {group?.label ?? ''} · TMDB Watch Provider
            </p>
          </div>
        </div>

        <SegmentedControl<MediaType>
          options={[
            { value: 'movie', label: '电影' },
            { value: 'tv', label: '剧集' },
          ]}
          value={type}
          onChange={setType}
          ariaLabel="媒体类型"
        />
      </div>

      {loading ? (
        <Spinner label="正在加载片库" />
      ) : error ? (
        <GlassPanel className="mx-auto mt-6 max-w-[420px] p-6 text-center" bordered>
          <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>
        </GlassPanel>
      ) : items.length === 0 ? (
        <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
          <i className="ri-file-search-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">该平台暂无收录内容</p>
        </GlassPanel>
      ) : (
        <>
          <div className="grid grid-cols-3 justify-items-center gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <MediaCard key={`${item.mediaType}-${item.tmdbId}`} item={item} fill />
            ))}
          </div>
          {page < total && (
            <div className="mt-6 text-center">
              <Button variant="gray" loading={loadingMore} onClick={() => void loadMore()}>
                加载更多（{items.length}）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
