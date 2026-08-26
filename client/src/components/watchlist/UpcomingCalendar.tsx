/**
 * 追剧页顶部「播出日历」入口卡：折叠时显示本周待播集数摘要，
 * 展开为按日期分组的时间线列表（日期头 + 40px 海报缩略图 + SxxExx + 剧名），
 * 支持手动刷新并显示 lastRefresh。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCalendar } from '../../api/endpoints';
import type { CalendarEntry, CalendarPayload } from '../../api/types';
import GlassPanel from '../ui/GlassPanel';
import Spinner from '../ui/Spinner';

const DAY_MS = 24 * 60 * 60 * 1000;

function posterUrl(posterPath?: string | null): string | undefined {
  return posterPath ? `https://image.tmdb.org/t/p/w92${posterPath}` : undefined;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDayHeader(airDate: string): string {
  const date = new Date(`${airDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return airDate;
  const today = startOfToday();
  const diff = Math.round((date.getTime() - today) / DAY_MS);
  const prefix = diff === 0 ? '今天' : diff === 1 ? '明天' : '';
  const label = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date);
  return prefix ? `${prefix} · ${label}` : label;
}

function formatLastRefresh(lastRefresh: string | null): string {
  if (!lastRefresh) return '尚未刷新';
  const date = new Date(lastRefresh);
  return Number.isNaN(date.getTime()) ? lastRefresh : date.toLocaleString();
}

export default function UpcomingCalendar() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCalendar());
    } catch {
      setError('日历加载失败，请稍后刷新');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 本周（今天起 7 天内）待播集数 */
  const weekCount = useMemo(() => {
    if (!data) return 0;
    const from = startOfToday();
    const to = from + 7 * DAY_MS;
    return data.items.filter((it) => {
      const t = Date.parse(it.airDate);
      return Number.isFinite(t) && t >= from && t < to;
    }).length;
  }, [data]);

  const groups = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const it of data?.items ?? []) {
      const key = (it.airDate || '').slice(0, 10) || '未知';
      const bucket = map.get(key);
      if (bucket) bucket.push(it);
      else map.set(key, [it]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <GlassPanel className="mb-5 p-4" bordered>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <i className="ri-calendar-todo-line text-[22px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <span className="min-w-0">
            <span className="type-headline block">播出日历</span>
            <span className="type-caption mt-0.5 block text-txt-tertiary">
              {loading && !data ? '正在获取播出计划…' : `本周 ${weekCount} 集待播`}
            </span>
          </span>
        </span>
        <i
          className={`ri-arrow-down-s-line shrink-0 text-[22px] text-txt-secondary transition-transform duration-fast ease-out ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-default)' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="type-caption text-txt-tertiary">更新于 {formatLastRefresh(data?.lastRefresh ?? null)}</span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="type-caption press-spring flex min-h-[32px] items-center gap-1 rounded-pill border border-line px-3 py-1.5 text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary disabled:opacity-50"
            >
              <i className={loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} aria-hidden />
              刷新
            </button>
          </div>

          {loading && !data ? (
            <Spinner size={20} center={false} label="正在加载播出日历" />
          ) : error ? (
            <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>
          ) : groups.length === 0 ? (
            <p className="type-caption text-txt-tertiary">近期没有「在看」剧集的待播集，追起来就会出现在这里。</p>
          ) : (
            groups.map(([date, entries]) => (
              <div key={date} className="mb-4 last:mb-0">
                <p className="type-caption mb-2 font-medium" style={{ color: 'var(--color-accent)' }}>
                  {formatDayHeader(date)}
                </p>
                <div className="flex flex-col gap-1">
                  {entries.map((e) => (
                    <Link
                      key={`${e.tmdbId}-${e.season}-${e.episode}`}
                      to={`/detail/tv/${e.tmdbId}`}
                      className="press-spring flex items-center gap-3 rounded-md p-2 transition-colors duration-fast ease-out hover:bg-[color:var(--color-bg-secondary)]"
                    >
                      {posterUrl(e.posterPath) ? (
                        <img
                          src={posterUrl(e.posterPath)}
                          alt=""
                          aria-hidden
                          loading="lazy"
                          className="h-[56px] w-[40px] shrink-0 object-cover"
                          style={{ borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-secondary)' }}
                        />
                      ) : (
                        <span
                          className="flex h-[56px] w-[40px] shrink-0 items-center justify-center"
                          style={{
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--color-bg-secondary)',
                            color: 'var(--text-tertiary)',
                          }}
                        >
                          <i className="ri-film-line text-[18px]" aria-hidden />
                        </span>
                      )}
                      <span className="type-caption w-[52px] shrink-0 tabular-nums text-txt-secondary">
                        S{e.season}·E{e.episode}
                      </span>
                      <span className="type-body min-w-0 truncate text-txt-primary" title={e.title}>
                        {e.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </GlassPanel>
  );
}
