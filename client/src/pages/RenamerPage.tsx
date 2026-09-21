/**
 * 媒体重命名页（功能合并自 Media-Renamer）：
 * 扫描本地媒体目录 → 文件名解析 → TMDB 匹配（自动/手动）→
 * Emby 规范重命名预览 → 执行 + 空目录清理 → 操作日志。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  batchMatchRenamerItems,
  autoMatchRenamerItem,
  executeRenamer,
  fetchRenamerScanState,
  fetchRenamerSettings,
  listRenamerDirs,
  listRenamerItems,
  listRenamerLogs,
  manualMatchRenamerItem,
  previewRenamer,
  saveRenamerSettings,
  searchRenamerTmdb,
  startRenamerScan,
  type RenamerItem,
  type RenamerMediaDir,
  type RenamerTmdbHit,
  type RenamePlanEntry,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import Button from '../components/ui/Button';
import GlassPanel from '../components/ui/GlassPanel';
import SegmentedControl from '../components/ui/SegmentedControl';
import Spinner from '../components/ui/Spinner';

function posterUrl(p: string | null): string | undefined {
  return p ? `https://image.tmdb.org/t/p/w92${p}` : undefined;
}

/** 目录选择弹层：逐级进入文件系统目录，选中回填 */
function DirPickerDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [current, setCurrent] = useState<string>('');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listRenamerDirs(p || undefined);
      setCurrent(res.path);
      setParent(res.parent);
      setDirs(res.dirs);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '目录读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--scrim-hero-dim, rgba(0,0,0,0.5))' }} onClick={onClose}>
      <GlassPanel className="w-full max-w-[520px] p-5" bordered onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="type-headline mb-3">选择目录</h3>
        <p className="type-caption mb-3 break-all text-txt-secondary">{current || '加载中…'}</p>
        <div className="mb-3 flex gap-2">
          <Button variant="gray" disabled={!parent || loading} onClick={() => parent && void load(parent)}>
            上一级
          </Button>
          <Button variant="tinted" onClick={() => onPick(current)} disabled={!current}>
            选用当前目录
          </Button>
        </div>
        {error && <p className="type-caption mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div className="max-h-[320px] overflow-y-auto rounded-md" style={{ border: '1px solid var(--border-light)' }}>
          {loading ? (
            <div className="p-4"><Spinner label="读取目录" /></div>
          ) : dirs.length === 0 ? (
            <p className="type-caption p-4 text-txt-tertiary">没有子目录</p>
          ) : (
            dirs.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => void load((current.endsWith('/') || current.endsWith('\\') ? current : current + '/') + d)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] text-txt-primary transition-colors duration-fast hover:bg-[var(--color-bg-secondary)]"
              >
                <i className="ri-folder-3-line text-[18px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
                <span className="truncate">{d}</span>
              </button>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

/** 手动匹配弹窗：TMDB 搜索 + 选择 */
function MatchDialog({
  item,
  onClose,
  onMatched,
}: {
  item: RenamerItem;
  onClose: () => void;
  onMatched: () => void;
}) {
  const [query, setQuery] = useState(item.name);
  const [kind, setKind] = useState<'movie' | 'tv'>(item.type);
  const [results, setResults] = useState<RenamerTmdbHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (): Promise<void> => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await searchRenamerTmdb(query.trim(), kind, item.year ?? undefined);
      setResults(res.results);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '搜索失败');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (tmdbId: number): Promise<void> => {
    setBusy(true);
    try {
      await manualMatchRenamerItem(item.id, tmdbId, kind);
      onMatched();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '匹配失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--scrim-hero-dim, rgba(0,0,0,0.5))' }} onClick={onClose}>
      <GlassPanel className="flex max-h-[80vh] w-full max-w-[560px] flex-col p-5" bordered onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h3 className="type-headline mb-3">手动匹配 · {item.name}</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="搜索标题"
            className="min-h-[40px] min-w-[180px] flex-1 rounded-md px-3 text-[14px]"
            style={{ border: '1px solid var(--border-light)', background: 'var(--color-bg-card)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <SegmentedControl<'movie' | 'tv'>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'movie', label: '电影' },
              { value: 'tv', label: '剧集' },
            ]}
          />
          <Button variant="filled" loading={busy} onClick={() => void search()}>
            搜索
          </Button>
        </div>
        {error && <p className="type-caption mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div className="min-h-[120px] flex-1 overflow-y-auto rounded-md" style={{ border: '1px solid var(--border-light)' }}>
          {results === null ? (
            <p className="type-caption p-4 text-txt-tertiary">输入标题后点击搜索</p>
          ) : results.length === 0 ? (
            <p className="type-caption p-4 text-txt-tertiary">无结果，可调整关键词后重试</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => void pick(r.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-[var(--color-bg-secondary)]"
              >
                {posterUrl(r.poster) ? (
                  <img src={posterUrl(r.poster)} alt="" className="h-[54px] w-[36px] shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-[54px] w-[36px] shrink-0 items-center justify-center rounded" style={{ background: 'var(--color-bg-secondary)' }}>
                    <i className="ri-film-line text-[16px] text-txt-tertiary" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-txt-primary">{r.title}</span>
                  <span className="type-caption text-txt-tertiary">
                    {r.original_title} · {r.year ?? '—'} · tmdbid={r.id}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

export default function RenamerPage() {
  // 设置
  const [dirs, setDirs] = useState<RenamerMediaDir[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState<'movie' | 'tv' | null>(null);

  // 扫描
  const [scan, setScan] = useState<{ running: boolean; progress: number; total: number; found: number; message: string } | null>(null);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 条目
  const [items, setItems] = useState<RenamerItem[] | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'unmatched' | 'matched' | 'renamed'>('all');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [matchItem, setMatchItem] = useState<RenamerItem | null>(null);
  const [preview, setPreview] = useState<RenamePlanEntry[] | null>(null);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ id: number; oldPath: string | null; newPath: string | null; status: string; message: string | null }> | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const s = await fetchRenamerSettings();
      setDirs(s.dirs);
    } catch {
      // 静默
    }
  }, []);

  const loadItems = useCallback(async (): Promise<void> => {
    try {
      const res = await listRenamerItems();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '条目加载失败');
    }
  }, []);

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const res = await listRenamerLogs();
      setLogs(res.logs);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadItems();
    // 恢复扫描进度（防止刷新丢失进行中的扫描）
    void fetchRenamerScanState().then((s) => {
      setScan(s);
      if (s.running) {
        scanPollRef.current = setInterval(() => {
          void fetchRenamerScanState().then((st) => {
            setScan(st);
            if (!st.running) {
              if (scanPollRef.current) clearInterval(scanPollRef.current);
              scanPollRef.current = null;
              void loadItems();
            }
          });
        }, 1000);
      }
    });
    return () => {
      if (scanPollRef.current) clearInterval(scanPollRef.current);
    };
  }, [loadSettings, loadItems]);

  const saveSettings = async (): Promise<void> => {
    setSavingSettings(true);
    setError(null);
    try {
      await saveRenamerSettings({ dirs });
      setExecResult('重命名设置已保存');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '保存失败');
    } finally {
      setSavingSettings(false);
    }
  };

  const startScan = async (): Promise<void> => {
    setError(null);
    try {
      await saveRenamerSettings({ dirs });
      const res = await startRenamerScan();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setScan({ running: true, progress: 0, total: 0, found: 0, message: '扫描已启动' });
      scanPollRef.current = setInterval(() => {
        void fetchRenamerScanState().then((st) => {
          setScan(st);
          if (!st.running) {
            if (scanPollRef.current) clearInterval(scanPollRef.current);
            scanPollRef.current = null;
            void loadItems();
          }
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '扫描启动失败');
    }
  };

  const toggleCheck = (id: number): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const autoMatchOne = async (id: number): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await autoMatchRenamerItem(id);
      await loadItems();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '匹配失败');
    } finally {
      setBusyId(null);
    }
  };

  const batchMatch = async (): Promise<void> => {
    const ids = [...checked].filter((id) => {
      const it = items?.find((i) => i.id === id);
      return it && !it.tmdbId;
    });
    if (ids.length === 0) {
      setExecResult('所选条目均已匹配，无需批量匹配');
      return;
    }
    setError(null);
    setExecResult(`批量匹配中（0/${ids.length}）…`);
    try {
      const res = await batchMatchRenamerItems(ids);
      setExecResult(`批量匹配完成：成功 ${res.matched}，失败 ${res.failed}`);
      await loadItems();
    } catch (err) {
      setExecResult(null);
      setError(err instanceof ApiClientError ? err.message : '批量匹配失败');
    }
  };

  const runPreview = async (): Promise<void> => {
    const ids = [...checked];
    if (ids.length === 0) {
      setExecResult('请先勾选要重命名的条目');
      return;
    }
    setError(null);
    try {
      const res = await previewRenamer(ids);
      setPreview(res.plan);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '预览失败');
    }
  };

  const runExecute = async (plan: RenamePlanEntry[]): Promise<void> => {
    setError(null);
    try {
      const res = await executeRenamer(plan);
      setPreview(null);
      setChecked(new Set());
      setExecResult(
        `重命名完成：成功 ${res.renamed}，失败 ${res.failed}，清理空目录 ${res.removedDirs}` +
          (res.errors.length > 0 ? `。失败原因：${res.errors.map((e) => `「${e.message}」`).join('；')}` : ''),
      );
      await loadItems();
      void loadLogs();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '执行失败');
    }
  };

  const filtered = (items ?? []).filter((i) => filterStatus === 'all' || i.status === filterStatus);
  const matchedCount = (items ?? []).filter((i) => i.tmdbId).length;

  // 按原文件夹分组展示（解决长平铺列表里找不到条目的问题）
  const groups = useMemo(() => {
    const map = new Map<string, RenamerItem[]>();
    for (const it of filtered) {
      const cut = Math.max(it.path.lastIndexOf('/'), it.path.lastIndexOf('\\'));
      const dir = cut > 0 ? it.path.slice(0, cut) : it.path;
      const arr = map.get(dir);
      if (arr) arr.push(it);
      else map.set(dir, [it]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const groupAllChecked = (group: RenamerItem[]): boolean =>
    group.length > 0 && group.every((i) => checked.has(i.id));

  const toggleGroup = (group: RenamerItem[]): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      const allIn = groupAllChecked(group);
      for (const i of group) {
        if (allIn) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });
  };

  const basename = (p: string): string => {
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return cut > 0 ? p.slice(cut + 1) : p;
  };

  return (
    <div className="mx-auto max-w-[860px]">
      {/* ---- 设置：媒体目录 + 命名模式 ---- */}
      <GlassPanel className="mb-4 p-5" bordered>
        <h2 className="type-headline mb-4 flex items-center gap-2">
          <i className="ri-folder-settings-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          媒体目录与命名模式
        </h2>
        {dirs.length === 0 && (
          <p className="type-caption mb-3 text-txt-tertiary">尚未添加目录。点击「添加目录」用目录选择器定位到电影 / 剧集所在的文件夹。</p>
        )}
        <div className="mb-3 flex flex-col gap-2">
          {dirs.map((d, idx) => (
            <div key={`${d.type}-${d.path}`} className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: 'var(--color-bg-secondary)' }}>
              <span className="type-caption shrink-0 rounded-pill px-2 py-0.5" style={{ background: 'var(--color-bg-card)' }}>
                {d.type === 'tv' ? '剧集' : '电影'}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-txt-primary">{d.path}</span>
              <button
                type="button"
                aria-label="移除该目录"
                onClick={() => setDirs((prev) => prev.filter((_, i) => i !== idx))}
                className="press-spring text-txt-tertiary hover:text-danger"
              >
                <i className="ri-delete-bin-6-line text-[16px]" aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="gray" onClick={() => setDirPickerOpen('movie')}>
            <i className="ri-add-line" aria-hidden /> 添加电影目录
          </Button>
          <Button variant="gray" onClick={() => setDirPickerOpen('tv')}>
            <i className="ri-add-line" aria-hidden /> 添加剧集目录
          </Button>
          <Button variant="tinted" loading={savingSettings} onClick={() => void saveSettings()}>
            保存设置
          </Button>
        </div>
        <p className="type-caption text-txt-tertiary">
          重命名只在文件原目录内完成，不会移动到其他位置；目录的「电影/剧集」类型用于扫描时的解析提示。
        </p>
      </GlassPanel>

      {/* ---- 扫描 ---- */}
      <GlassPanel className="mb-4 p-5" bordered>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-headline flex items-center gap-2">
            <i className="ri-scan-2-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
            扫描媒体库
          </h2>
          <Button variant="filled" loading={scan?.running ?? false} onClick={() => void startScan()}>
            {scan?.running ? '扫描中…' : '开始扫描'}
          </Button>
        </div>
        {scan && (
          <div className="mt-3">
            <p className="type-caption text-txt-secondary">{scan.message || (scan.running ? '扫描中…' : '未开始')}</p>
            {scan.running && scan.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-pill" style={{ background: 'var(--color-bg-secondary)' }}>
                <div
                  className="h-full rounded-pill transition-all duration-fast"
                  style={{ width: `${Math.min(100, Math.round((scan.progress / Math.max(1, scan.total)) * 100))}%`, background: 'var(--color-accent)' }}
                />
              </div>
            )}
          </div>
        )}
      </GlassPanel>

      {error && (
        <GlassPanel className="mb-4 p-3" bordered>
          <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>
        </GlassPanel>
      )}
      {execResult && (
        <GlassPanel className="mb-4 p-3" bordered>
          <p className="type-caption" style={{ color: 'var(--color-success)' }}>{execResult}</p>
        </GlassPanel>
      )}

      {/* ---- 条目列表 ---- */}
      <GlassPanel className="mb-4 p-5" bordered>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-headline flex items-center gap-2">
            <i className="ri-file-list-3-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
            条目 {items ? `(${items.length}，已匹配 ${matchedCount})` : ''}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="gray" disabled={checked.size === 0} onClick={() => void batchMatch()}>
              批量自动匹配
            </Button>
            <Button variant="filled" disabled={checked.size === 0} onClick={() => void runPreview()}>
              重命名预览 ({checked.size})
            </Button>
            <Button variant="plain" onClick={() => void loadLogs().then(() => setLogsOpen((v) => !v))}>
              {logsOpen ? '收起日志' : '操作日志'}
            </Button>
          </div>
        </div>

        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
          {([
            ['all', '全部'],
            ['unmatched', '未匹配'],
            ['matched', '已匹配'],
            ['renamed', '已重命名'],
          ] as const).map(([key, label]) => {
            const active = filterStatus === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterStatus(key)}
                className="press-spring flex min-h-[32px] shrink-0 items-center rounded-pill px-3 text-[13px]"
                style={
                  active
                    ? { background: 'var(--surface-warm)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }
                    : { background: 'var(--color-bg-secondary)', color: 'var(--text-secondary)', border: '1px solid transparent' }
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {items === null ? (
          <Spinner label="正在加载条目" />
        ) : filtered.length === 0 ? (
          <p className="type-caption py-6 text-center text-txt-tertiary">
            {items.length === 0 ? '暂无条目，先配置目录并扫描' : '该分类下没有条目'}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([dir, group]) => (
              <div key={dir}>
                {/* 组头：原文件夹 + 组全选 */}
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    checked={groupAllChecked(group)}
                    onChange={() => toggleGroup(group)}
                    aria-label={`全选 ${basename(dir)} 组`}
                    className="h-4 w-4 shrink-0"
                  />
                  <i className="ri-folder-3-line text-[16px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-txt-secondary" title={dir}>
                    {basename(dir)}
                  </span>
                  <span className="type-caption shrink-0 text-txt-tertiary">{group.length} 项</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {group.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5"
                      style={{ background: 'var(--color-bg-secondary)' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(it.id)}
                        onChange={() => toggleCheck(it.id)}
                        aria-label={`选择 ${it.name}`}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="type-caption w-[46px] shrink-0 rounded-pill text-center" style={{ background: 'var(--color-bg-card)' }}>
                        {it.type === 'tv' ? '剧集' : '电影'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-txt-primary" title={it.path}>{basename(it.path)}</span>
                        <span className="type-caption text-txt-tertiary">
                          解析：{it.name}
                          {it.type === 'tv' && it.season != null
                            ? it.epDate
                              ? ` · ${it.epDate}`
                              : ` · S${String(it.season).padStart(2, '0')}${it.epStart != null ? `E${String(it.epStart).padStart(2, '0')}` : ''}`
                            : it.year
                              ? ` · ${it.year}`
                              : ''}
                          {it.version ? ` · ${it.version}` : ''}
                        </span>
                      </span>
                      <span
                        className="type-caption shrink-0 rounded-pill px-2 py-0.5"
                        style={
                          it.status === 'renamed'
                            ? { background: 'rgba(52,199,89,0.15)', color: 'var(--color-success)' }
                            : it.tmdbId
                              ? { background: 'rgba(124,58,237,0.12)', color: 'var(--color-accent)' }
                              : { background: 'var(--color-bg-card)', color: 'var(--text-tertiary)' }
                        }
                      >
                        {it.status === 'renamed' ? '已重命名' : it.tmdbId ? '已匹配' : '未匹配'}
                      </span>
                      {!it.tmdbId && (
                        <>
                          <Button variant="gray" loading={busyId === it.id} onClick={() => void autoMatchOne(it.id)}>
                            自动
                          </Button>
                          <Button variant="plain" onClick={() => setMatchItem(it)}>
                            手动
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* ---- 日志 ---- */}
      {logsOpen && (
        <GlassPanel className="mb-4 p-5" bordered>
          <h2 className="type-headline mb-3">操作日志</h2>
          {logs === null ? (
            <Spinner label="加载日志" />
          ) : logs.length === 0 ? (
            <p className="type-caption text-txt-tertiary">暂无记录</p>
          ) : (
            <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="type-caption flex items-start gap-2">
                  <i
                    className={`${l.status === 'success' ? 'ri-checkbox-circle-line text-[color:var(--color-success)]' : 'ri-close-circle-line text-[color:var(--color-danger)]'} mt-0.5 text-[14px]`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-txt-secondary">{l.oldPath}</span>
                    {l.newPath && <span className="block truncate text-txt-tertiary">→ {l.newPath}</span>}
                    {l.message && <span className="block" style={{ color: 'var(--color-danger)' }}>{l.message}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      )}

      {/* ---- 预览弹层 ---- */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--scrim-hero-dim, rgba(0,0,0,0.5))' }} onClick={() => setPreview(null)}>
          <GlassPanel className="flex max-h-[80vh] w-full max-w-[720px] flex-col p-5" bordered onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <h3 className="type-headline mb-3">重命名预览（{preview.length} 项）</h3>
            <p className="type-caption mb-3 text-txt-tertiary">
              未匹配 TMDB 的条目将按解析出的名称命名（不含 [tmdbid] 标签）；文件名未变化的条目会自动跳过。
            </p>
            <div className="mb-3 flex-1 overflow-y-auto rounded-md" style={{ border: '1px solid var(--border-light)' }}>
              {preview.map((p) => {
                const oldName = p.oldPath.split(/[\\/]/).pop();
                const newName = p.newPath.split(/[\\/]/).pop();
                return (
                  <div key={p.id} className="border-b px-3 py-2 last:border-0" style={{ borderColor: 'var(--border-light)' }}>
                    <p className="type-caption truncate text-txt-tertiary" title={p.oldPath}>{oldName}</p>
                    <p className="truncate text-[13px]" style={{ color: 'var(--color-accent)' }} title={p.newPath}>→ {newName}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="plain" onClick={() => setPreview(null)}>
                取消
              </Button>
              <Button variant="filled" onClick={() => void runExecute(preview)}>
                确认执行
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}

      {dirPickerOpen && (
        <DirPickerDialog
          onClose={() => setDirPickerOpen(null)}
          onPick={(p) => {
            setDirs((prev) => (prev.some((d) => d.path === p && d.type === dirPickerOpen) ? prev : [...prev, { type: dirPickerOpen, path: p }]));
            setDirPickerOpen(null);
          }}
        />
      )}

      {matchItem && <MatchDialog item={matchItem} onClose={() => setMatchItem(null)} onMatched={() => void loadItems()} />}
    </div>
  );
}
