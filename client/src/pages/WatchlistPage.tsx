/**
 * 追剧页：进度条列表 + 状态分组（P1 完整分组，此处按状态分区渲染）。
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useWatchlist from '../hooks/useWatchlist';
import type { WatchItem, WatchStatus } from '../api/types';
import ProgressBar from '../components/ui/ProgressBar';
import EpisodeStepper from '../components/media/EpisodeStepper';
import PosterFallback from '../components/media/PosterFallback';
import Spinner from '../components/ui/Spinner';
import GlassPanel from '../components/ui/GlassPanel';

const STATUS_GROUPS: Array<{ key: WatchStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'watching', label: '在看' },
  { key: 'planned', label: '想看' },
  { key: 'finished', label: '看完' },
  { key: 'dropped', label: '弃剧' },
];

function posterOf(item: WatchItem): string | undefined {
  return item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : undefined;
}

export default function WatchlistPage() {
  const { items, loading, error, refresh, update, remove } = useWatchlist();
  const [filter, setFilter] = useState<WatchStatus | 'all'>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.status === filter)),
    [items, filter],
  );

  const handleSeasonChange = (item: WatchItem, season: number): void => {
    void update(item.id, { current_season: season });
  };
  const handleEpisodeChange = (item: WatchItem, episode: number): void => {
    void update(item.id, { current_episode: episode });
  };

  if (loading) return <Spinner label="正在加载追剧列表" />;

  return (
    <div>
      {/* 状态过滤（P1 分组） */}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {STATUS_GROUPS.map((g) => {
          const active = filter === g.key;
          const count = g.key === 'all' ? items.length : items.filter((i) => i.status === g.key).length;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setFilter(g.key)}
              className="press-spring flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-pill px-4 text-[14px] transition-colors duration-fast ease-out"
              style={
                active
                  ? {
                      background: 'var(--surface-warm)',
                      color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent)',
                    }
                  : {
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent',
                    }
              }
            >
              {g.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="type-caption mb-4" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {filtered.length === 0 ? (
        <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
          <i className="ri-tv-2-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">这里还空空如也</p>
          <p className="type-caption mt-1 text-txt-tertiary">去首页发现好剧，点进详情即可「加入追剧」。</p>
          <Link to="/" className="mt-4 inline-block">
            <span className="type-body" style={{ color: 'var(--color-accent)' }}>去逛逛 →</span>
          </Link>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((item) => {
            const seasons =
              item.totalEpisodes != null
                ? [{ seasonNumber: item.currentSeason, episodeCount: item.totalEpisodes }]
                : [];
            const url = `/detail/${item.mediaType}/${item.tmdbId}`;
            return (
              <GlassPanel key={item.id} className="flex gap-4 p-4" bordered>
                <Link to={url} className="w-[80px] shrink-0">
                  {posterOf(item) ? (
                    <img
                      src={posterOf(item)}
                      alt={`${item.title} 海报`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      style={{ borderRadius: 'var(--radius-md)', aspectRatio: '2 / 3', background: 'var(--color-bg-secondary)' }}
                    />
                  ) : (
                    <PosterFallback title={item.title} />
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={url}>
                        <h3 className="type-headline truncate hover:underline">{item.title}</h3>
                      </Link>
                      <p className="type-caption mt-0.5 text-txt-tertiary">
                        S{item.currentSeason}·E{item.currentEpisode}
                        {item.totalEpisodes != null ? ` / 共 ${item.totalEpisodes} 集` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`移除 ${item.title}`}
                      onClick={() => void remove(item.id)}
                      className="press-spring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-txt-tertiary transition-colors duration-fast ease-out hover:text-danger"
                    >
                      <i className="ri-delete-bin-6-line text-[18px]" aria-hidden />
                    </button>
                  </div>

                  <ProgressBar percent={item.progressPercent} />

                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <EpisodeStepper
                      seasons={seasons}
                      currentSeason={item.currentSeason}
                      currentEpisode={item.currentEpisode}
                      onSeasonChange={(s) => handleSeasonChange(item, s)}
                      onEpisodeChange={(e) => handleEpisodeChange(item, e)}
                    />
                    <select
                      value={item.status}
                      onChange={(e) => void update(item.id, { status: e.target.value as WatchStatus })}
                      aria-label={`${item.title} 的状态`}
                      className="h-[36px] rounded-sm border border-line bg-card px-2 text-[14px] text-txt-primary outline-none focus:border-accent"
                    >
                      {STATUS_GROUPS.filter((s) => s.key !== 'all').map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => void refresh()}
          className="type-caption press-spring rounded-pill border border-line px-4 py-2 text-txt-secondary transition-colors duration-fast ease-out"
        >
          刷新列表
        </button>
      </div>
    </div>
  );
}
