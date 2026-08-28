/**
 * 追剧页：顶部「追剧 / 想看」分段切换。
 * 追剧：进度条列表 + 状态分组；想看：未上映条目的海报列表（删除/跳详情）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useWatchlist from '../hooks/useWatchlist';
import { deleteUpcoming, listUpcoming } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { UpcomingItem, WatchItem, WatchStatus } from '../api/types';
import ProgressBar from '../components/ui/ProgressBar';
import EpisodeStepper from '../components/media/EpisodeStepper';
import PosterFallback from '../components/media/PosterFallback';
import UpcomingCalendar from '../components/watchlist/UpcomingCalendar';
import SegmentedControl from '../components/ui/SegmentedControl';
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

function upcomingPosterOf(item: UpcomingItem): string | undefined {
  return item.posterPath ? `https://image.tmdb.org/t/p/w342${item.posterPath}` : undefined;
}

export default function WatchlistPage() {
  const { items, loading, error, refresh, update, remove } = useWatchlist();
  const [view, setView] = useState<'watch' | 'upcoming'>('watch');
  const [filter, setFilter] = useState<WatchStatus | 'all'>('all');

  const [upcoming, setUpcoming] = useState<UpcomingItem[] | null>(null);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);

  const loadUpcoming = useCallback(async (): Promise<void> => {
    setUpcomingError(null);
    try {
      setUpcoming(await listUpcoming());
    } catch (err) {
      setUpcomingError(err instanceof ApiClientError ? err.message : '想看列表加载失败');
    }
  }, []);

  useEffect(() => {
    if (view === 'upcoming' && upcoming === null) void loadUpcoming();
  }, [view, upcoming, loadUpcoming]);

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

  const handleUpcomingDelete = async (item: UpcomingItem): Promise<void> => {
    try {
      await deleteUpcoming(item.id);
      setUpcoming((prev) => prev?.filter((u) => u.id !== item.id) ?? prev);
    } catch (err) {
      setUpcomingError(err instanceof ApiClientError ? err.message : '删除失败');
    }
  };

  if (loading && view === 'watch') return <Spinner label="正在加载追剧列表" />;

  const upcomingCount = upcoming?.length;

  return (
    <div>
      {/* 追剧 / 想看 切换 */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel="追剧列表视图"
          value={view}
          onChange={setView}
          options={[
            { value: 'watch', label: `追剧 ${items.length > 0 ? items.length : ''}` },
            { value: 'upcoming', label: `想看 ${upcomingCount != null && upcomingCount > 0 ? upcomingCount : ''}` },
          ]}
        />
        {view === 'upcoming' && upcoming !== null && (
          <button
            type="button"
            onClick={() => void loadUpcoming()}
            className="type-caption press-spring rounded-pill border border-line px-3 py-1.5 text-txt-secondary transition-colors duration-fast ease-out"
          >
            刷新
          </button>
        )}
      </div>

      {view === 'watch' && (
        <>
          {/* 播出日历入口卡 */}
          <UpcomingCalendar />

          {/* 状态过滤 */}
          <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
            {STATUS_GROUPS.map((g) => {
              const active = filter === g.key;
              const count =
                g.key === 'all' ? items.length : items.filter((i) => i.status === g.key).length;
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

          {error && (
            <p className="type-caption mb-4" style={{ color: 'var(--color-danger)' }}>{error}</p>
          )}

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
        </>
      )}

      {view === 'upcoming' && (
        <>
          {upcomingError && (
            <p className="type-caption mb-4" style={{ color: 'var(--color-danger)' }}>{upcomingError}</p>
          )}
          {upcoming === null ? (
            <Spinner label="正在加载想看列表" />
          ) : upcoming.length === 0 ? (
            <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
              <i className="ri-calendar-todo-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
              <p className="type-body mt-3 text-txt-secondary">还没有想看的影视</p>
              <p className="type-caption mt-1 text-txt-tertiary">去详情页点「想看」，上映后这里会显示日期。</p>
              <Link to="/" className="mt-4 inline-block">
                <span className="type-body" style={{ color: 'var(--color-accent)' }}>去逛逛 →</span>
              </Link>
            </GlassPanel>
          ) : (
            <div className="flex flex-col gap-4">
              {upcoming.map((item) => {
                const url = `/detail/${item.mediaType}/${item.tmdbId}`;
                return (
                  <GlassPanel key={item.id} className="flex gap-4 p-4" bordered>
                    <Link to={url} className="w-[80px] shrink-0">
                      {upcomingPosterOf(item) ? (
                        <img
                          src={upcomingPosterOf(item)}
                          alt={`${item.title} 海报`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                          style={{ borderRadius: 'var(--radius-md)', aspectRatio: '2 / 3', background: 'var(--color-bg-secondary)' }}
                        />
                      ) : (
                        <PosterFallback title={item.title} />
                      )}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={url}>
                            <h3 className="type-headline truncate hover:underline">{item.title}</h3>
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span
                              className="type-caption rounded-pill px-2 py-0.5"
                              style={{ background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)' }}
                            >
                              {item.mediaType === 'tv' ? '剧集' : '电影'}
                            </span>
                            <span
                              className="type-caption"
                              style={{ color: 'var(--color-accent)' }}
                            >
                              {item.releaseDate
                                ? `${item.releaseDate.slice(0, 10)} 上映/播出`
                                : '上映日期待定'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`移除想看 ${item.title}`}
                          onClick={() => void handleUpcomingDelete(item)}
                          className="press-spring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-txt-tertiary transition-colors duration-fast ease-out hover:text-danger"
                        >
                          <i className="ri-delete-bin-6-line text-[18px]" aria-hidden />
                        </button>
                      </div>
                      {item.note && (
                        <p className="type-caption text-txt-tertiary">{item.note}</p>
                      )}
                    </div>
                  </GlassPanel>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
