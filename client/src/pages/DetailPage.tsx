/**
 * 详情页：海报头图 + 演职员 + 四源评分卡 + 加入追剧 / 进度管理。
 * 管理员可对豆瓣/烂番茄/爆米花做手动修正。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchDetail, listWatchlist, createWatchItem, patchWatchItem, deleteWatchItem } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { DetailPayload, MediaType, SeasonSnapshotEntry, WatchStatus } from '../api/types';
import PosterFallback from '../components/media/PosterFallback';
import EpisodeStepper from '../components/media/EpisodeStepper';
import RatingBadge from '../components/ui/RatingBadge';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import GlassPanel from '../components/ui/GlassPanel';
import SegmentedControl from '../components/ui/SegmentedControl';
import useRatings from '../hooks/useRatings';
import { useAuth } from '../stores/AuthContext';

interface WatchEntry {
  id: number;
  status: WatchStatus;
  currentSeason: number;
  currentEpisode: number;
  seasons: SeasonSnapshotEntry[];
}

const STATUS_OPTIONS: Array<{ value: WatchStatus; label: string }> = [
  { value: 'watching', label: '在看' },
  { value: 'planned', label: '想看' },
  { value: 'finished', label: '看完' },
  { value: 'dropped', label: '弃剧' },
];

export default function DetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const mediaType: MediaType | null =
    params.type === 'movie' || params.type === 'tv' ? params.type : null;
  const tmdbId = Number.parseInt(params.id ?? '', 10);

  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [watchEntry, setWatchEntry] = useState<WatchEntry | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';
  const ratingsState = useRatings(mediaType ?? 'movie', Number.isInteger(tmdbId) ? tmdbId : 0);

  // ---- 详情加载 ----
  const loadDetail = useCallback(async () => {
    if (!mediaType || !Number.isInteger(tmdbId)) {
      setDetailError('无效的详情链接');
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await fetchDetail(mediaType, tmdbId));
    } catch (err) {
      setDetailError(err instanceof ApiClientError ? err.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, [mediaType, tmdbId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // ---- 追剧状态加载（登录后） ----
  const loadWatchEntry = useCallback(async (): Promise<void> => {
    if (!mediaType || !Number.isInteger(tmdbId) || !detail) return;
    try {
      const items = await listWatchlist();
      const found = items.find((i) => i.tmdbId === tmdbId && i.mediaType === mediaType);
      if (found) {
        const snapshot = (found as unknown as { seasons_snapshot?: string }).seasons_snapshot;
        let seasons: SeasonSnapshotEntry[] = [];
        if (Array.isArray(detail.seasons)) {
          seasons = detail.seasons.map((s) => ({
            seasonNumber: s.seasonNumber,
            episodeCount: s.episodeCount,
          }));
        }
        setWatchEntry({
          id: found.id,
          status: found.status,
          currentSeason: found.currentSeason,
          currentEpisode: found.currentEpisode,
          seasons,
        });
      } else {
        setWatchEntry(null);
      }
    } catch {
      // 静默：追剧模块失败不影响详情展示
    }
  }, [mediaType, tmdbId, detail]);

  useEffect(() => {
    void loadWatchEntry();
  }, [loadWatchEntry]);

  const backdropUrl = useMemo(() => {
    if (!detail?.backdropPath) return undefined;
    return `https://image.tmdb.org/t/p/w1280${detail.backdropPath}`;
  }, [detail]);

  const posterUrl = useMemo(() => {
    if (!detail?.posterPath) return undefined;
    return `https://image.tmdb.org/t/p/w500${detail.posterPath}`;
  }, [detail]);

  // ---- 追剧动作 ----
  const addToWatchlist = async (): Promise<void> => {
    if (!mediaType || !detail) return;
    setWatchBusy(true);
    setWatchMsg(null);
    try {
      await createWatchItem({
        tmdb_id: tmdbId,
        media_type: mediaType,
        title: detail.title,
        poster_path: detail.posterPath,
        seasons_snapshot:
          mediaType === 'tv' && Array.isArray(detail.seasons)
            ? detail.seasons.map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.episodeCount }))
            : undefined,
      });
      setWatchMsg('已加入追剧');
      await loadWatchEntry();
    } catch (err) {
      setWatchMsg(err instanceof ApiClientError && err.code === 4090 ? '已在追剧列表中' : '加入追剧失败');
    } finally {
      setWatchBusy(false);
    }
  };

  const patchEntry = async (patch: {
    status?: WatchStatus;
    current_season?: number;
    current_episode?: number;
  }): Promise<void> => {
    if (!watchEntry) return;
    setWatchBusy(true);
    try {
      await patchWatchItem(watchEntry.id, patch);
      await loadWatchEntry();
    } catch {
      setWatchMsg('进度更新失败');
    } finally {
      setWatchBusy(false);
    }
  };

  const removeFromWatchlist = async (): Promise<void> => {
    if (!watchEntry) return;
    setWatchBusy(true);
    try {
      await deleteWatchItem(watchEntry.id);
      setWatchEntry(null);
      setWatchMsg('已移出追剧');
    } catch {
      setWatchMsg('移除失败');
    } finally {
      setWatchBusy(false);
    }
  };

  // ---- 手动修正评分（管理员） ----
  const correctRating = async (
    source: 'douban' | 'tomato' | 'popcorn',
  ): Promise<void> => {
    const input = window.prompt(`输入「${source}」修正分值（0-10，留空取消）`);
    if (input === null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    const score = Number.parseFloat(trimmed);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      window.alert('请输入 0-10 之间的数字');
      return;
    }
    if (ratingsState) await ratingsState.correct(source, Math.round(score * 10) / 10);
  };

  // ---- 渲染分支 ----
  if (detailLoading) return <Spinner label="正在加载详情" />;
  if (detailError || !detail || !mediaType) {
    return (
      <GlassPanel className="mx-auto mt-10 max-w-[480px] p-8 text-center" bordered>
        <i className="ri-error-warning-line text-[36px]" style={{ color: 'var(--color-danger)' }} aria-hidden />
        <p className="type-body mt-3">{detailError ?? '内容不存在'}</p>
        <Button variant="gray" className="mt-5" onClick={() => navigate(-1)}>
          返回
        </Button>
      </GlassPanel>
    );
  }

  const year = detail.releaseDate ? detail.releaseDate.slice(0, 4) : '';
  const runtimeText = detail.runtime ? `${detail.runtime} 分钟` : '';

  return (
    <div className="pb-6">
      {/* 背景横幅 */}
      <div
        className="relative mb-6 overflow-hidden"
        style={{ borderRadius: 'var(--radius-lg)', minHeight: 200 }}
      >
        {backdropUrl ? (
          <img src={backdropUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: 'var(--color-bg-secondary)' }} />
        )}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, var(--color-bg-primary), transparent)' }}
        />
        <div className="relative flex items-end gap-5 p-5 md:p-8">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={`${detail.title} 海报`}
              className="hidden w-[160px] shadow-md sm:block"
              style={{ borderRadius: 'var(--radius-card)', aspectRatio: '2 / 3', objectFit: 'cover' }}
            />
          ) : (
            <div className="hidden w-[160px] sm:block">
              <PosterFallback />
            </div>
          )}
          <div className="min-w-0 pb-1">
            <h1 className="type-large-title leading-tight">{detail.title}</h1>
            <p className="type-caption mt-2 flex flex-wrap items-center gap-2 text-txt-secondary">
              <span>{year}</span>
              {runtimeText && <span aria-hidden>·</span>}
              {runtimeText && <span>{runtimeText}</span>}
              {detail.genres.slice(0, 4).map((g) => (
                <span key={g.id} className="rounded-pill px-2 py-0.5" style={{ background: 'var(--nav-bg)', border: '1px solid var(--border-light)' }}>
                  {g.name}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>

      {/* 四源评分卡 */}
      <GlassPanel className="mb-6 p-5" bordered>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="type-headline">评分</h2>
          {isAdmin && <span className="type-caption text-txt-tertiary">点击第三方评分胶囊可手动修正</span>}
        </div>
        {ratingsState?.error ? (
          <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{ratingsState.error}</p>
        ) : ratingsState?.loading ? (
          <Spinner size={20} center={false} label="正在聚合四源评分" />
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <RatingBadge source="tmdb" data={null} tmdbScore={detail.voteAverage} />
            <RatingBadge source="douban" data={ratingsState?.ratings?.douban ?? null} onClick={isAdmin ? () => void correctRating('douban') : undefined} />
            <RatingBadge source="tomato" data={ratingsState?.ratings?.tomato ?? null} onClick={isAdmin ? () => void correctRating('tomato') : undefined} />
            <RatingBadge source="popcorn" data={ratingsState?.ratings?.popcorn ?? null} onClick={isAdmin ? () => void correctRating('popcorn') : undefined} />
          </div>
        )}
      </GlassPanel>

      {/* 追剧管理 */}
      <GlassPanel className="mb-6 p-5" bordered>
        <h2 className="type-headline mb-3">追剧</h2>
        {watchMsg && <p className="type-caption mb-2 text-txt-secondary">{watchMsg}</p>}
        {!watchEntry ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="filled" loading={watchBusy} onClick={() => void addToWatchlist()}>
              <i className="ri-add-line" aria-hidden /> 加入追剧
            </Button>
            {mediaType === 'movie' && (
              <span className="type-caption text-txt-tertiary">电影加入后会出现在追剧列表中便于标记已看。</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <SegmentedControl<WatchStatus>
              options={STATUS_OPTIONS}
              value={watchEntry.status}
              onChange={(v) => void patchEntry({ status: v })}
              ariaLabel="追剧状态"
            />
            {mediaType === 'tv' && watchEntry.seasons.length > 0 && (
              <EpisodeStepper
                seasons={watchEntry.seasons}
                currentSeason={watchEntry.currentSeason}
                currentEpisode={watchEntry.currentEpisode}
                onSeasonChange={(s) => void patchEntry({ current_season: s })}
                onEpisodeChange={(e) => void patchEntry({ current_episode: e })}
              />
            )}
            {watchBusy && <Spinner size={16} center={false} />}
            <div>
            <Button variant="plain" className="text-danger" onClick={() => void removeFromWatchlist()}>
              移出追剧列表
            </Button>
            </div>
          </div>
        )}
      </GlassPanel>

      {/* 简介 */}
      {detail.overview && (
        <section className="mb-6">
          <h2 className="type-headline mb-2">剧情简介</h2>
          <p className="type-body leading-relaxed text-txt-secondary">{detail.overview}</p>
        </section>
      )}

      {/* 主创 */}
      {(detail.crew?.length ?? 0) > 0 && (
        <section className="mb-6">
          <h2 className="type-headline mb-2">主创</h2>
          <p className="type-body text-txt-secondary">
            {detail.crew?.map((c) => `${c.name}（${c.job}）`).join(' · ')}
          </p>
        </section>
      )}

      {/* 演职员 */}
      {detail.cast.length > 0 && (
        <section>
          <h2 className="type-headline mb-3">演职员</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {detail.cast.map((person, idx) => (
              <div key={`${person.name}-${idx}`} className="w-[96px] shrink-0 text-center">
                {person.profilePath ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${person.profilePath}`}
                    alt={person.name}
                    loading="lazy"
                    className="mx-auto h-[120px] w-[96px] object-cover"
                    style={{ borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' }}
                  />
                ) : (
                  <div
                    className="mx-auto flex h-[120px] w-[96px] items-center justify-center"
                    style={{
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <i className="ri-user-3-line text-[28px]" aria-hidden />
                  </div>
                )}
                <p className="mt-2 truncate text-[13px] font-medium text-txt-primary" title={person.name}>
                  {person.name}
                </p>
                {person.character && (
                  <p className="type-caption truncate text-txt-tertiary" title={person.character}>
                    {person.character}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
