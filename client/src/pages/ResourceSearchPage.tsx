/**
 * 资源搜索结果页 /resources?q=片名：
 * 聚合两个源：1lou（BT 种子附件）与 hgeme（磁力 + 网盘）。
 * 支持来源筛选、改词重搜、分页加载更多、原帖外链与一键推送 qBittorrent。
 * 源站搜索较慢（10~30s），首查有明确等待提示。
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchHgemeResources,
  fetchQbPaths,
  fetchQbStatus,
  pushResourceDownload,
  searchResources,
  type HgemeResources,
  type HgemeSearchMeta,
  type QbPaths,
  type ResourceItem,
  type ResourceSourceFilter,
  type ResourceSourceStatus,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { MediaType } from '../api/types';
import Button from '../components/ui/Button';
import GlassPanel from '../components/ui/GlassPanel';
import SegmentedControl from '../components/ui/SegmentedControl';
import Spinner from '../components/ui/Spinner';
import HgemeResults from '../components/media/HgemeResults';

const SITE_BASE = 'https://1lou.cc';

const SOURCE_LABEL: Record<string, string> = {
  '1lou': '1lou',
  hgeme: 'hgme',
};

const SOURCE_FILTERS: Array<{ key: ResourceSourceFilter; label: string }> = [
  { key: 'all', label: '全部来源' },
  { key: '1lou', label: '1lou' },
  { key: 'hgeme', label: 'hgme' },
];

function fallbackSearchUrl(keyword: string): string {
  return `${SITE_BASE}/search-${encodeURIComponent(keyword.trim())}.htm`;
}

function metaLine(item: ResourceItem): string {
  const parts: string[] = [];
  if (item.author) parts.push(item.author);
  if (item.date) parts.push(item.date);
  if (item.views != null) parts.push(`${item.views} 次查看`);
  if (item.comments != null) parts.push(`${item.comments} 回复`);
  if (item.source === 'hgeme' && item.rating != null) parts.push(`豆瓣 ${item.rating}`);
  return parts.join(' · ');
}

export default function ResourceSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = (searchParams.get('q') ?? '').trim();

  const [input, setInput] = useState(keyword);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [source, setSource] = useState<ResourceSourceFilter>('all');
  const [sourceStatus, setSourceStatus] = useState<ResourceSourceStatus[]>([]);
  const [hgType, setHgType] = useState(0);
  const [hgFilter, setHgFilter] = useState('');
  const [hgMeta, setHgMeta] = useState<HgemeSearchMeta | null>(null);

  // ---- 推送到 qBittorrent ----
  const [qbPaths, setQbPaths] = useState<QbPaths | null>(null);
  const [qbReady, setQbReady] = useState<boolean | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<ResourceItem | null>(null);
  const defaultType: MediaType = searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const [dlType, setDlType] = useState<MediaType>(defaultType);
  const [dlPath, setDlPath] = useState('');
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- hgeme 资源选择（磁力 / 网盘） ----
  const [hgResources, setHgResources] = useState<HgemeResources | null>(null);
  const [hgLoading, setHgLoading] = useState(false);
  const [hgError, setHgError] = useState<string | null>(null);
  const [magnetBusy, setMagnetBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQbPaths().catch(() => null), fetchQbStatus().catch(() => null)])
      .then(([paths, status]) => {
        if (cancelled) return;
        if (paths) setQbPaths(paths);
        setQbReady(status ? status.configured && status.reachable : false);
      })
      .catch(() => {
        if (!cancelled) setQbReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pathForType = useCallback(
    (type: MediaType): string => {
      if (!qbPaths) return '';
      return type === 'tv' ? qbPaths.tvPath : qbPaths.moviePath;
    },
    [qbPaths],
  );

  const openDownload = (item: ResourceItem): void => {
    setDownloadTarget(item);
    setDlMsg(null);
    setDlType(defaultType);
    setDlPath(pathForType(defaultType) || qbPaths?.defaultSavePath || '');
    setHgResources(null);
    setHgError(null);
    if (item.source === 'hgeme') void loadHgResources(item);
  };

  const loadHgResources = async (item: ResourceItem): Promise<void> => {
    if (!item.dir) return;
    setHgLoading(true);
    setHgError(null);
    try {
      setHgResources(await fetchHgemeResources(item.dir, item.tid));
    } catch (err) {
      setHgError(err instanceof ApiClientError ? err.message : '资源列表加载失败');
    } finally {
      setHgLoading(false);
    }
  };

  /** hgeme：直接推送选中的磁力 */
  const pushMagnet = async (index: number): Promise<void> => {
    if (!downloadTarget || !hgResources) return;
    const pick = hgResources.magnets[index];
    if (!pick) return;
    setMagnetBusy(index);
    setDlMsg(null);
    try {
      const res = await pushResourceDownload({
        source: 'hgeme',
        dir: downloadTarget.dir,
        id: downloadTarget.tid,
        magnet: pick.magnet,
        title: pick.title,
        type: dlType,
        savePath: dlPath.trim() || undefined,
      });
      setDlMsg({
        ok: true,
        text: `已推送到 qBittorrent：${res.name}${res.savePath ? ` → ${res.savePath}` : ''}`,
      });
      setDownloadTarget(null);
    } catch (err) {
      setDlMsg({ ok: false, text: err instanceof ApiClientError ? err.message : '推送下载失败' });
    } finally {
      setMagnetBusy(null);
    }
  };

  const submitDownload = async (): Promise<void> => {
    if (!downloadTarget) return;
    setDlBusy(true);
    setDlMsg(null);
    try {
      const res = await pushResourceDownload({
        tid: downloadTarget.tid,
        type: dlType,
        savePath: dlPath.trim() || undefined,
      });
      setDlMsg({
        ok: true,
        text: `已推送到 qBittorrent：${res.name}${res.savePath ? ` → ${res.savePath}` : ''}`,
      });
      setDownloadTarget(null);
    } catch (err) {
      setDlMsg({ ok: false, text: err instanceof ApiClientError ? err.message : '推送下载失败' });
    } finally {
      setDlBusy(false);
    }
  };

  useEffect(() => {
    setInput(keyword);
  }, [keyword]);

  const runSearch = useCallback(
    async (
      kw: string,
      src: ResourceSourceFilter = 'all',
      opts: { type?: number; filter?: string } = {},
    ): Promise<void> => {
      setLoading(true);
      setError(null);
      setSearched(false);
      try {
        const res = await searchResources(kw, 1, src, opts);
        setItems(res.items);
        setPage(res.page);
        setTotalPages(res.totalPages);
        setCached(res.cached);
        setSourceStatus(res.sources ?? []);
        setHgMeta(res.hgeme ?? null);
        setSearched(true);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : '资源检索失败');
        setItems([]);
        setSourceStatus([]);
        setHgMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!keyword) {
      setItems([]);
      setSearched(false);
      setError(null);
      setSourceStatus([]);
      setHgMeta(null);
      return;
    }
    void runSearch(keyword, source, { type: hgType, filter: hgFilter || undefined });
  }, [keyword, source, hgType, hgFilter, runSearch]);

  const handleSubmit = (): void => {
    const kw = input.trim();
    if (!kw) return;
    if (kw === keyword) void runSearch(kw, source);
    else setSearchParams({ q: kw });
  };

  const loadMore = async (): Promise<void> => {
    if (loadingMore || page >= totalPages) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await searchResources(keyword, next, source, {
        type: hgType,
        filter: hgFilter || undefined,
      });
      setItems((prev) => [...prev, ...res.items]);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setSourceStatus(res.sources ?? []);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  /** 结果按来源拆分：hgme 走专属组件（分类/筛选/资源面板），1lou 走原有列表 */
  const hgmeItems = items.filter((it) => it.source === 'hgeme');
  const oneLouItems = items.filter((it) => it.source !== 'hgeme');

  /** 保存位置选择器（两个来源共用：类型决定默认目录） */
  const locationPicker = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="type-caption mb-2 text-txt-secondary">媒体类型（决定默认下载目录）</p>
        <SegmentedControl<MediaType>
          options={[
            { value: 'movie', label: '电影' },
            { value: 'tv', label: '剧集' },
          ]}
          value={dlType}
          onChange={(next) => {
            setDlType(next);
            setDlPath(pathForType(next) || qbPaths?.defaultSavePath || '');
          }}
          ariaLabel="媒体类型"
        />
      </div>

      <div>
        <label className="type-caption mb-1 block text-txt-secondary">保存位置</label>
        {qbPaths && qbPaths.presetPaths.length > 0 && (
          <select
            value={qbPaths.presetPaths.includes(dlPath) ? dlPath : ''}
            onChange={(e) => {
              if (e.target.value) setDlPath(e.target.value);
            }}
            aria-label="预设下载目录"
            className="mb-2 h-[40px] w-full rounded-sm border border-line bg-card px-3 text-[14px] text-txt-primary outline-none focus:border-accent"
          >
            <option value="">选择预设目录…</option>
            {qbPaths.presetPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <input
          value={dlPath}
          onChange={(e) => setDlPath(e.target.value)}
          placeholder={qbPaths?.defaultSavePath ?? '/downloads/movies'}
          aria-label="下载保存目录"
          className="h-11 w-full rounded-md border border-line bg-card px-3 text-[15px] text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent focus:shadow-[var(--focus-ring)]"
        />
        <p className="type-caption mt-1 text-txt-tertiary">
          留空则使用 qBittorrent 默认目录；电影/剧集目录可在设置中预设。
        </p>
      </div>
    </div>
  );

  return (
    <div className="pb-8">
      <div className="mb-5 flex items-center gap-2">
        <Button
          variant="plain"
          className="-ml-3 text-[15px]"
          icon={<i className="ri-arrow-left-line text-[20px]" aria-hidden />}
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="返回上一级"
        >
          返回
        </Button>
      </div>

      <div className="mb-2">
        <h1 className="type-title">资源搜索</h1>
        <p className="type-caption mt-1 text-txt-tertiary">
          聚合 BT 站 1lou 的片源索引 · 点击条目在原站查看详情
        </p>
      </div>

      {/* 搜索框 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <i
            className="ri-search-line pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px]"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="搜索影视名称或规格关键词…"
            aria-label="资源搜索关键词"
            className="h-11 w-full rounded-pill border border-line bg-card pl-11 pr-4 text-body text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent focus:shadow-[var(--focus-ring)]"
            style={{ borderRadius: 'var(--radius-pill)' }}
          />
        </div>
        <Button variant="filled" onClick={handleSubmit} loading={loading}>
          搜索
        </Button>
      </div>

      {/* 来源筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SOURCE_FILTERS.map((f) => {
          const active = source === f.key;
          const status = sourceStatus.find((s) => s.source === f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setSource(f.key)}
              className="press-spring flex min-h-[34px] items-center gap-1.5 rounded-pill px-3.5 text-[13px] transition-colors duration-fast ease-out"
              style={
                active
                  ? {
                      background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                      color: 'var(--color-accent)',
                      border: '1px solid color-mix(in srgb, var(--color-accent) 55%, transparent)',
                    }
                  : {
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent',
                    }
              }
            >
              {f.label}
              {status && (
                <span className="tabular-nums opacity-70">{status.ok ? status.count : '×'}</span>
              )}
            </button>
          );
        })}
        {sourceStatus.some((s) => !s.ok) && (
          <span className="type-caption" style={{ color: 'var(--color-danger)' }}>
            {sourceStatus
              .filter((s) => !s.ok)
              .map((s) => `${SOURCE_LABEL[s.source] ?? s.source}：${s.error ?? '不可用'}`)
              .join('；')}
          </span>
        )}
      </div>

      {/* 状态区 */}
      {loading && (
        <div className="py-10">
          <Spinner label="正在检索资源站，首次查询约需 10~30 秒" />
        </div>
      )}

      {!loading && error && (
        <GlassPanel className="mx-auto mt-6 max-w-[520px] p-6 text-center" bordered>
          <i className="ri-cloud-off-line text-[32px]" style={{ color: 'var(--color-danger)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">{error}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button variant="gray" onClick={() => void runSearch(keyword)}>
              重试
            </Button>
            {keyword && (
              <a
                href={fallbackSearchUrl(keyword)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-4 text-[15px] font-medium"
                style={{ color: 'var(--color-accent)' }}
              >
                在原站打开
                <i className="ri-external-link-line text-[16px]" aria-hidden />
              </a>
            )}
          </div>
        </GlassPanel>
      )}

      {!loading && !error && searched && items.length === 0 && (
        <GlassPanel className="mx-auto mt-6 max-w-[480px] p-8 text-center" bordered>
          <i className="ri-file-search-line text-[34px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">未找到与「{keyword}」相关的资源</p>
          <p className="type-caption mt-1 text-txt-tertiary">可尝试缩短关键词（仅保留片名）后重试</p>
          <a
            href={fallbackSearchUrl(keyword)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-4 text-[15px] font-medium"
            style={{ color: 'var(--color-accent)' }}
          >
            在原站搜索
            <i className="ri-external-link-line text-[16px]" aria-hidden />
          </a>
        </GlassPanel>
      )}

      {!loading && !keyword && (
        <GlassPanel className="mx-auto mt-10 max-w-[440px] p-8 text-center" bordered>
          <i className="ri-download-cloud-2-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">输入片名开始检索资源</p>
          <p className="type-caption mt-1 text-txt-tertiary">支持电影 / 剧集名称与规格关键词</p>
        </GlassPanel>
      )}

      {/* 结果区 */}
      {!loading && items.length > 0 && (
        <>
          {dlMsg && (
            <p
              className="type-caption mb-3"
              style={{ color: dlMsg.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
            >
              {dlMsg.text}
              {dlMsg.ok && (
                <>
                  {' '}
                  <Link className="underline" to="/downloads" style={{ color: 'var(--color-accent)' }}>
                    查看下载
                  </Link>
                </>
              )}
            </p>
          )}
          {/* hgeme：分类 Tab + 资源面板 */}
          {source !== '1lou' && (
            <HgemeResults
              keyword={keyword}
              meta={hgMeta}
              items={hgmeItems}
              type={hgType}
              filter={hgFilter}
              onTypeChange={setHgType}
              onFilterChange={setHgFilter}
              qbReady={qbReady}
              qbPaths={qbPaths}
              defaultType={defaultType}
              onNotice={setDlMsg}
            />
          )}

          {/* 1lou 列表 */}
          {source !== 'hgeme' && oneLouItems.length > 0 && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <p className="type-caption text-txt-tertiary">
                  {source === 'all' ? '1lou · ' : ''}共 {oneLouItems.length} 条结果
                  {totalPages > 1 ? ` · 第 ${page}/${totalPages} 页` : ''}
                </p>
                {cached && (
                  <span
                    className="rounded-pill px-2 py-[2px] text-[11px]"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }}
                  >
                    缓存
                  </span>
                )}
              </div>

              <ul className="flex flex-col gap-3">
                {oneLouItems.map((item) => (
                  <li key={item.tid}>
                <GlassPanel className="p-4" bordered>
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-pill px-2 py-[2px] text-[11px] font-medium"
                          style={
                            item.source === 'hgeme'
                              ? {
                                  background: 'color-mix(in srgb, var(--color-glow) 16%, transparent)',
                                  color: 'var(--color-glow)',
                                }
                              : {
                                  background: 'var(--surface-warm)',
                                  color: 'var(--text-secondary)',
                                }
                          }
                        >
                          {SOURCE_LABEL[item.source] ?? item.source}
                        </span>
                        {item.info && (
                          <span className="type-caption text-txt-tertiary">{item.info}</span>
                        )}
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-[15px] font-medium text-txt-primary transition-colors duration-fast ease-out hover:text-accent"
                        title={item.title}
                      >
                        {item.title}
                      </a>

                      {item.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {item.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-pill px-2 py-[2px] text-[11px]"
                              style={{
                                background: 'var(--surface-warm)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="type-caption mt-2 text-txt-tertiary">{metaLine(item)}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="filled"
                        className="!min-h-[40px] !px-3 text-[13px]"
                        icon={<i className="ri-download-2-line text-[15px]" aria-hidden />}
                        onClick={() => openDownload(item)}
                      >
                        下载
                      </Button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="press-spring flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-[13px] font-medium text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
                      >
                        原帖
                        <i className="ri-external-link-line text-[14px]" aria-hidden />
                      </a>
                    </div>
                  </div>
                </GlassPanel>
              </li>
            ))}
              </ul>
            </>
          )}

          {page < totalPages && (
            <div className="mt-6 text-center">
              <Button variant="gray" loading={loadingMore} onClick={() => void loadMore()}>
                加载更多（第 {page + 1}/{totalPages} 页）
              </Button>
            </div>
          )}
        </>
      )}

      {/* 下载推送到 qBittorrent 弹层 */}
      {downloadTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label="推送下载到 qBittorrent"
        >
          <GlassPanel className="w-full max-w-[520px] p-5" bordered>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="type-headline">推送到 qBittorrent</h2>
                <p className="type-caption mt-1 line-clamp-2 text-txt-tertiary" title={downloadTarget.title}>
                  {downloadTarget.title}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setDownloadTarget(null)}
                className="press-spring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-txt-tertiary hover:text-txt-primary"
              >
                <i className="ri-close-line text-[18px]" aria-hidden />
              </button>
            </div>

            {qbReady === false ? (
              <div className="py-2">
                <p className="type-caption" style={{ color: 'var(--color-danger)' }}>
                  qBittorrent 未配置或不可达，请先在设置中完成下载器配置。
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="gray" onClick={() => setDownloadTarget(null)}>
                    关闭
                  </Button>
                  <Link to="/settings">
                    <Button variant="filled">前往设置</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {locationPicker}

                {/* hgeme：选择磁力条目推送（网盘仅可跳转） */}
                {downloadTarget.source === 'hgeme' && (
                  <div className="mt-4">
                    {hgLoading ? (
                      <Spinner label="正在获取磁力资源，请稍候" />
                    ) : hgError ? (
                      <p className="type-caption" style={{ color: 'var(--color-danger)' }}>
                        {hgError}
                      </p>
                    ) : (
                      <>
                        <p className="type-caption mb-1 text-txt-secondary">
                          磁力资源（{hgResources?.magnets.length ?? 0}）
                        </p>
                        {hgResources && hgResources.magnets.length > 0 ? (
                          <ul className="no-scrollbar max-h-[240px] overflow-y-auto pr-1">
                            {hgResources.magnets.map((m, i) => (
                              <li
                                key={`${m.magnet}-${i}`}
                                className="flex items-center gap-3 py-2"
                                style={{ borderTop: i ? '1px solid var(--border-light)' : undefined }}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-1 text-[13px] text-txt-primary" title={m.title}>
                                    {m.title}
                                  </p>
                                  <p className="type-caption text-txt-tertiary">
                                    {[m.quality, m.size, m.time].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                <Button
                                  variant="filled"
                                  className="!min-h-[34px] !px-3 text-[13px]"
                                  loading={magnetBusy === i}
                                  onClick={() => void pushMagnet(i)}
                                >
                                  推送
                                </Button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="type-caption text-txt-tertiary">该条目暂无磁力资源</p>
                        )}

                        {hgResources && hgResources.pans.length > 0 && (
                          <>
                            <p className="type-caption mb-1 mt-4 text-txt-secondary">
                              网盘资源（{hgResources.pans.length}）· 不支持推送，点击跳转
                            </p>
                            <ul className="no-scrollbar max-h-[200px] overflow-y-auto pr-1">
                              {hgResources.pans.map((p, i) => (
                                <li
                                  key={`${p.url}-${i}`}
                                  className="flex items-center gap-3 py-2"
                                  style={{ borderTop: i ? '1px solid var(--border-light)' : undefined }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="line-clamp-1 text-[13px] text-txt-primary" title={p.name}>
                                      {p.name}
                                    </p>
                                    <p className="type-caption text-txt-tertiary">
                                      {[p.netdisk, p.user, p.time].filter(Boolean).join(' · ')}
                                    </p>
                                  </div>
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="press-spring flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-[13px] font-medium text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
                                  >
                                    打开
                                    <i className="ri-external-link-line text-[14px]" aria-hidden />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {dlMsg && (
                  <p
                    className="type-caption mt-3"
                    style={{ color: dlMsg.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
                  >
                    {dlMsg.text}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="gray" onClick={() => setDownloadTarget(null)}>
                    取消
                  </Button>
                  {downloadTarget.source !== 'hgeme' && (
                    <Button variant="filled" loading={dlBusy} onClick={() => void submitDownload()}>
                      推送下载
                    </Button>
                  )}
                </div>
              </>
            )}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
