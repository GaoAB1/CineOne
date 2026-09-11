/**
 * hgeme 搜索结果组件（两步式交互）：
 *  1) 分类 Tab（全部/电影/剧集/动漫/种子/网盘）+ 资源类型筛选 chips；
 *  2) 影片候选 → 「查看资源」打开资源面板（影片信息 + 磁力/网盘/在线三 Tab，
 *     支持画质/网盘名筛选与关键字过滤，磁力逐条推送 qBittorrent）；
 *  3) 种子条目 → 直接推送；网盘条目 → 打开链接。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchHgemeDetail,
  fetchHgemeResources,
  pushResourceDownload,
  type HgemeDetail,
  type HgemeResources,
  type HgemeSearchMeta,
  type QbPaths,
  type ResourceItem,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import type { MediaType } from '../../api/types';
import Button from '../ui/Button';
import GlassPanel from '../ui/GlassPanel';
import SegmentedControl from '../ui/SegmentedControl';
import Spinner from '../ui/Spinner';

const RENDER_LIMIT = 200;

interface Props {
  keyword: string;
  meta: HgemeSearchMeta | null;
  items: ResourceItem[];
  type: number;
  filter: string;
  onTypeChange: (type: number) => void;
  onFilterChange: (filter: string) => void;
  qbReady: boolean | null;
  qbPaths: QbPaths | null;
  defaultType: MediaType;
  onNotice: (msg: { ok: boolean; text: string } | null) => void;
}

function kindLabel(item: ResourceItem): string {
  if (item.kind === 'torrent') return '种子';
  if (item.kind === 'pan') return item.netdisk ?? '网盘';
  return item.dir === 'tv' ? '剧集' : item.dir === 'ac' ? '动漫' : '电影';
}

export default function HgemeResults({
  keyword,
  meta,
  items,
  type,
  filter,
  onTypeChange,
  onFilterChange,
  qbReady,
  qbPaths,
  defaultType,
  onNotice,
}: Props) {
  // ---- 资源面板状态 ----
  const [panelItem, setPanelItem] = useState<ResourceItem | null>(null);
  const [detail, setDetail] = useState<HgemeDetail | null>(null);
  const [res, setRes] = useState<HgemeResources | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [tab, setTab] = useState<'magnet' | 'pan' | 'play'>('magnet');
  const [quality, setQuality] = useState('');
  const [netdiskFilter, setNetdiskFilter] = useState('');
  const [text, setText] = useState('');
  const [dlType, setDlType] = useState<MediaType>(defaultType);
  const [dlPath, setDlPath] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [panelMsg, setPanelMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openPanel = useCallback(
    async (item: ResourceItem): Promise<void> => {
      setPanelItem(item);
      setPanelMsg(null);
      setPanelError(null);
      setRes(null);
      setDetail(null);
      setTab('magnet');
      setQuality('');
      setNetdiskFilter('');
      setText('');
      const mediaType: MediaType =
        item.dir === 'tv' || item.dir === 'ac' ? 'tv' : defaultType === 'tv' ? 'tv' : 'movie';
      setDlType(mediaType);
      setDlPath(mediaType === 'tv' ? (qbPaths?.tvPath ?? '') : (qbPaths?.moviePath ?? ''));
      setPanelLoading(true);
      try {
        const [d, r] = await Promise.all([
          fetchHgemeDetail(item.dir ?? 'mv', item.tid),
          fetchHgemeResources(item.dir ?? 'mv', item.tid),
        ]);
        setDetail(d);
        setRes(r);
      } catch (err) {
        setPanelError(err instanceof ApiClientError ? err.message : '资源加载失败');
      } finally {
        setPanelLoading(false);
      }
    },
    [defaultType, qbPaths],
  );

  useEffect(() => {
    if (!panelItem) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPanelItem(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelItem]);

  const magnets = useMemo(() => {
    let list = res?.magnets ?? [];
    if (quality) list = list.filter((m) => m.quality === quality);
    const kw = text.trim().toLowerCase();
    if (kw) list = list.filter((m) => m.title.toLowerCase().includes(kw));
    return list;
  }, [res, quality, text]);

  const pans = useMemo(() => {
    let list = res?.pans ?? [];
    if (netdiskFilter) list = list.filter((p) => p.netdisk === netdiskFilter);
    const kw = text.trim().toLowerCase();
    if (kw) list = list.filter((p) => p.name.toLowerCase().includes(kw));
    return list;
  }, [res, netdiskFilter, text]);

  const pushMagnet = async (magnet: string, title: string): Promise<void> => {
    if (!panelItem) return;
    setBusyKey(magnet);
    setPanelMsg(null);
    try {
      const out = await pushResourceDownload({
        source: 'hgeme',
        dir: panelItem.dir,
        id: panelItem.tid,
        magnet,
        title,
        type: dlType,
        savePath: dlPath.trim() || undefined,
      });
      onNotice({ ok: true, text: `已推送到 qBittorrent：${out.name}` });
      setPanelMsg({ ok: true, text: `已推送：${out.name}` });
    } catch (err) {
      setPanelMsg({ ok: false, text: err instanceof ApiClientError ? err.message : '推送失败' });
    } finally {
      setBusyKey(null);
    }
  };

  const pushTorrentItem = async (item: ResourceItem): Promise<void> => {
    setBusyKey(item.tid);
    onNotice(null);
    try {
      const out = await pushResourceDownload({
        source: 'hgeme',
        btId: item.tid,
        title: item.title,
        type: defaultType,
      });
      onNotice({ ok: true, text: `已推送到 qBittorrent：${out.name}` });
    } catch (err) {
      onNotice({ ok: false, text: err instanceof ApiClientError ? err.message : '推送失败' });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div>
      {/* 分类 Tab */}
      {meta && meta.categories.length > 0 && (
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
          {meta.categories.map((cat) => {
            const active = type === cat.key;
            const count = meta.counts[cat.key];
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => onTypeChange(cat.key)}
                className="press-spring flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-pill px-4 text-[14px] transition-colors duration-fast ease-out"
                style={
                  active
                    ? {
                        background: 'color-mix(in srgb, var(--color-glow) 18%, transparent)',
                        color: 'var(--color-glow)',
                        border: '1px solid color-mix(in srgb, var(--color-glow) 55%, transparent)',
                      }
                    : {
                        background: 'var(--color-bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid transparent',
                      }
                }
              >
                {cat.label}
                {typeof count === 'number' && count > 0 && (
                  <span className="tabular-nums opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 资源类型（画质 / 网盘名）二次筛选 */}
      {meta && Object.keys(meta.filters).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onFilterChange('')}
            className="press-spring min-h-[30px] rounded-pill px-3 text-[12px]"
            style={
              !filter
                ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                : { background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }
            }
          >
            全部类型
          </button>
          {Object.entries(meta.filters).map(([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => onFilterChange(filter === name ? '' : name)}
              className="press-spring min-h-[30px] rounded-pill px-3 text-[12px]"
              style={
                filter === name
                  ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                  : { background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)' }
              }
            >
              {name} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 结果列表 */}
      {items.length === 0 ? (
        <GlassPanel className="mx-auto mt-6 max-w-[440px] p-8 text-center" bordered>
          <i className="ri-file-search-line text-[32px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">该分类下没有结果</p>
          <p className="type-caption mt-1 text-txt-tertiary">可切换分类或更换关键词</p>
        </GlassPanel>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={`${item.kind}-${item.tid}-${item.url}`}>
              <GlassPanel className="p-4" bordered>
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-pill px-2 py-[2px] text-[11px] font-medium"
                        style={{
                          background: 'color-mix(in srgb, var(--color-glow) 16%, transparent)',
                          color: 'var(--color-glow)',
                        }}
                      >
                        {kindLabel(item)}
                      </span>
                      {item.year && (
                        <span className="type-caption text-txt-tertiary">{item.year}</span>
                      )}
                      {item.rating != null && (
                        <span className="type-caption text-txt-tertiary">豆瓣 {item.rating}</span>
                      )}
                      {item.info && (
                        <span className="type-caption line-clamp-1 text-txt-tertiary">{item.info}</span>
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

                    <p className="type-caption mt-1.5 text-txt-tertiary">
                      {[
                        item.author,
                        item.size,
                        item.seeds != null ? `${item.seeds} 做种` : null,
                        item.netdisk,
                        item.hot,
                        item.date,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {item.kind === 'title' ? (
                      <Button
                        variant="filled"
                        className="!min-h-[40px] !px-3 text-[13px]"
                        icon={<i className="ri-folder-open-line text-[15px]" aria-hidden />}
                        onClick={() => void openPanel(item)}
                      >
                        查看资源
                      </Button>
                    ) : item.kind === 'torrent' ? (
                      <Button
                        variant="filled"
                        className="!min-h-[40px] !px-3 text-[13px]"
                        loading={busyKey === item.tid}
                        icon={<i className="ri-download-2-line text-[15px]" aria-hidden />}
                        onClick={() => void pushTorrentItem(item)}
                      >
                        推送
                      </Button>
                    ) : (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="press-spring flex min-h-[40px] items-center gap-1.5 rounded-sm border border-line px-3 text-[13px] font-medium text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
                      >
                        打开
                        <i className="ri-external-link-line text-[14px]" aria-hidden />
                      </a>
                    )}
                  </div>
                </div>
              </GlassPanel>
            </li>
          ))}
        </ul>
      )}

      {/* 资源面板 */}
      {panelItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label={`${panelItem.title} 资源`}
        >
          <GlassPanel className="flex max-h-[88vh] w-full max-w-[760px] flex-col p-5" bordered>
            {/* 头部 */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="type-headline line-clamp-1">{detail?.title ?? panelItem.title}</h2>
                <p className="type-caption mt-1 text-txt-tertiary">
                  {[
                    detail?.typename ?? kindLabel(panelItem),
                    detail?.year ? `${detail.year}` : null,
                    detail?.rating != null ? `豆瓣 ${detail.rating}` : null,
                    detail?.regions?.length ? detail.regions.slice(0, 3).join('/') : null,
                    detail?.languages?.length ? detail.languages.slice(0, 2).join('/') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setPanelItem(null)}
                className="press-spring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-txt-tertiary hover:text-txt-primary"
              >
                <i className="ri-close-line text-[18px]" aria-hidden />
              </button>
            </div>

            {panelLoading ? (
              <div className="py-10">
                <Spinner label="正在获取资源列表" />
              </div>
            ) : panelError ? (
              <p className="type-caption py-4" style={{ color: 'var(--color-danger)' }}>
                {panelError}
              </p>
            ) : (
              <>
                {/* 影片简介 */}
                {detail?.summary && (
                  <p className="type-caption mb-3 line-clamp-3 text-txt-secondary">{detail.summary}</p>
                )}
                {detail?.actors?.length ? (
                  <p className="type-caption mb-3 line-clamp-1 text-txt-tertiary">
                    主演：{detail.actors.slice(0, 6).join(' / ')}
                  </p>
                ) : null}

                {/* 资源 Tab */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {[
                    { key: 'magnet' as const, label: `磁力资源`, count: res?.magnets.length ?? 0 },
                    { key: 'pan' as const, label: `网盘资源`, count: res?.pans.length ?? 0 },
                    { key: 'play' as const, label: `在线播放`, count: res?.playlists.length ?? 0 },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className="press-spring min-h-[34px] rounded-pill px-3.5 text-[13px]"
                      style={
                        tab === t.key
                          ? {
                              background: 'color-mix(in srgb, var(--color-glow) 18%, transparent)',
                              color: 'var(--color-glow)',
                            }
                          : { background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)' }
                      }
                    >
                      {t.label}
                      <span className="ml-1 tabular-nums opacity-70">{t.count}</span>
                    </button>
                  ))}
                </div>

                {/* 筛选与过滤 */}
                {tab !== 'play' && (
                  <div className="mb-3 flex flex-col gap-2">
                    {tab === 'magnet' && (res?.magnetGroups.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQuality('')}
                          className="press-spring min-h-[28px] rounded-pill px-2.5 text-[12px]"
                          style={
                            !quality
                              ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                              : { background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }
                          }
                        >
                          全部画质
                        </button>
                        {res?.magnetGroups.map((g) => (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => setQuality(quality === g.label ? '' : g.label)}
                            className="press-spring min-h-[28px] rounded-pill px-2.5 text-[12px]"
                            style={
                              quality === g.label
                                ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                                : { background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)' }
                            }
                          >
                            {g.label} <span className="opacity-70">{g.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {tab === 'pan' && (res?.panGroups.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNetdiskFilter('')}
                          className="press-spring min-h-[28px] rounded-pill px-2.5 text-[12px]"
                          style={
                            !netdiskFilter
                              ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                              : { background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }
                          }
                        >
                          全部网盘
                        </button>
                        {res?.panGroups.map((g) => (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => setNetdiskFilter(netdiskFilter === g.label ? '' : g.label)}
                            className="press-spring min-h-[28px] rounded-pill px-2.5 text-[12px]"
                            style={
                              netdiskFilter === g.label
                                ? { background: 'var(--surface-warm)', color: 'var(--accent)' }
                                : { background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)' }
                            }
                          >
                            {g.label} <span className="opacity-70">{g.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={tab === 'magnet' ? '按标题过滤（如 HDR / 国语 / DV）' : '按名称过滤'}
                      className="h-9 w-full rounded-sm border border-line bg-card px-3 text-[13px] text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent"
                    />
                  </div>
                )}

                {/* 列表 */}
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                  {tab === 'magnet' &&
                    (magnets.length === 0 ? (
                      <p className="type-caption py-3 text-txt-tertiary">没有匹配的磁力资源</p>
                    ) : (
                      <ul>
                        {magnets.slice(0, RENDER_LIMIT).map((m, i) => (
                          <li
                            key={m.magnet}
                            className="flex items-center gap-3 py-2"
                            style={{ borderTop: i ? '1px solid var(--border-light)' : undefined }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-1 text-[13px] text-txt-primary" title={m.title}>
                                {m.title}
                              </p>
                              <p className="type-caption text-txt-tertiary">
                                {[m.quality, m.size, m.time, m.seeds != null ? `${m.seeds} 做种` : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <Button
                              variant="filled"
                              className="!min-h-[32px] !px-3 text-[12px]"
                              loading={busyKey === m.magnet}
                              onClick={() => void pushMagnet(m.magnet, m.title)}
                            >
                              推送
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ))}

                  {tab === 'pan' &&
                    (pans.length === 0 ? (
                      <p className="type-caption py-3 text-txt-tertiary">没有匹配的网盘资源</p>
                    ) : (
                      <ul>
                        {pans.slice(0, RENDER_LIMIT).map((p, i) => (
                          <li
                            key={`${p.url}-${i}`}
                            className="flex items-center gap-3 py-2"
                            style={{
                              borderTop: i ? '1px solid var(--border-light)' : undefined,
                              opacity: p.invalid ? 0.5 : 1,
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <p
                                className="line-clamp-1 text-[13px] text-txt-primary"
                                title={p.name}
                                style={p.invalid ? { textDecoration: 'line-through' } : undefined}
                              >
                                {p.name}
                              </p>
                              <p className="type-caption text-txt-tertiary">
                                {[p.netdisk, p.user, p.time, p.invalid ? '可能已失效' : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="press-spring flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-[12px] font-medium text-txt-secondary hover:text-txt-primary"
                            >
                              打开
                              <i className="ri-external-link-line text-[13px]" aria-hidden />
                            </a>
                          </li>
                        ))}
                      </ul>
                    ))}

                  {tab === 'play' &&
                    ((res?.playlists.length ?? 0) === 0 ? (
                      <p className="type-caption py-3 text-txt-tertiary">暂无在线播放线路</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {res?.playlists.map((pl) => (
                          <li key={pl.name}>
                            <p className="text-[13px] font-medium text-txt-primary">{pl.name}</p>
                            <p className="type-caption mt-0.5 text-txt-tertiary">
                              {pl.episodes.join(' / ') || '—'}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ))}

                  {((tab === 'magnet' && magnets.length > RENDER_LIMIT) ||
                    (tab === 'pan' && pans.length > RENDER_LIMIT)) && (
                    <p className="type-caption mt-2 text-txt-tertiary">
                      仅显示前 {RENDER_LIMIT} 条，可用上方筛选缩小范围
                    </p>
                  )}
                </div>

                {/* 保存位置 */}
                {tab === 'magnet' && (
                  <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="flex flex-wrap items-center gap-3">
                      <SegmentedControl<MediaType>
                        options={[
                          { value: 'movie', label: '电影' },
                          { value: 'tv', label: '剧集' },
                        ]}
                        value={dlType}
                        onChange={(next) => {
                          setDlType(next);
                          setDlPath(
                            next === 'tv' ? (qbPaths?.tvPath ?? '') : (qbPaths?.moviePath ?? ''),
                          );
                        }}
                        ariaLabel="媒体类型"
                      />
                      <input
                        value={dlPath}
                        onChange={(e) => setDlPath(e.target.value)}
                        placeholder={qbPaths?.defaultSavePath ?? '保存位置（留空用默认目录）'}
                        aria-label="下载保存目录"
                        className="h-9 min-w-[220px] flex-1 rounded-sm border border-line bg-card px-3 text-[13px] text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent"
                      />
                    </div>
                    {qbReady === false && (
                      <p className="type-caption mt-2" style={{ color: 'var(--color-danger)' }}>
                        qBittorrent 未配置或不可达，推送可能失败（请先到设置中配置下载器）
                      </p>
                    )}
                    {panelMsg && (
                      <p
                        className="type-caption mt-2"
                        style={{ color: panelMsg.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
                      >
                        {panelMsg.text}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </GlassPanel>
        </div>
      )}

      {/* 关键词提示 */}
      <p className="type-caption mt-3 text-txt-tertiary">
        当前关键词「{keyword}」的资源来自 hgme：先选影片再挑资源，或直接使用种子/网盘分类。
      </p>
    </div>
  );
}
