/**
 * 115 网盘离线下载管理页 /pan115：
 *  - 账号状态卡：登录账号 / 会员 / 本月离线配额（剩余-已用-总量 + 使用率条）
 *  - 离线任务列表：状态筛选（全部/下载中/已完成/异常）+ 计数，进度条、大小、加入时间、
 *    单条删除与批量删除（可选连同已下载文件）
 *  - 一键清理：默认清理已完成任务，可勾选一并清理失败任务
 *  - 手动添加：磁力 / ED2K / http(s) 直链；.torrent 直链可先解析文件树再勾选
 *  - 目录浏览：列 115 网盘目录（辅助查找 CID），点击可回填到添加表单
 * 页面可见时每 5 秒自动刷新；未配置 Cookie 时给出引导。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addPan115Torrent,
  clearPan115Tasks,
  deletePan115Tasks,
  fetchPan115Dirs,
  fetchPan115Paths,
  fetchPan115Status,
  fetchPan115Tasks,
  parsePan115TorrentFromUrl,
  pushPan115Url,
  type Pan115DirEntry,
  type Pan115Paths,
  type Pan115Status,
  type Pan115Task,
  type Pan115TaskBucket,
  type Pan115TaskStats,
  type Pan115TorrentInfo,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import Button from '../components/ui/Button';
import GlassPanel from '../components/ui/GlassPanel';
import Spinner from '../components/ui/Spinner';
import Toast from '../components/ui/Toast';
import TorrentFilePicker, { formatBytes } from '../components/pan115/TorrentFilePicker';

const REFRESH_MS = 5000;

/** 秒级时间戳 → 本地可读时间（115 返回的是秒） */
function formatTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_COLOR: Record<Pan115TaskBucket, string> = {
  completed: 'var(--color-success)',
  error: 'var(--color-danger)',
  downloading: 'var(--text-secondary)',
};

const FILTERS: Array<{ key: Pan115TaskBucket | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'downloading', label: '下载中' },
  { key: 'completed', label: '已完成' },
  { key: 'error', label: '异常' },
];

type AddTab = 'url' | 'torrent';

export default function Pan115Page() {
  const [status, setStatus] = useState<Pan115Status | null>(null);
  const [tasks, setTasks] = useState<Pan115Task[]>([]);
  const [stats, setStats] = useState<Pan115TaskStats | null>(null);
  const [paths, setPaths] = useState<Pan115Paths | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Pan115TaskBucket | 'all'>('all');
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- 选择与批量操作 ----
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<Pan115Task[] | null>(null);
  const [clearing, setClearing] = useState(false);

  // ---- 手动添加 ----
  const [addTab, setAddTab] = useState<AddTab>('url');
  const [addUrl, setAddUrl] = useState('');
  const [dir, setDir] = useState('');
  const [adding, setAdding] = useState(false);
  const [torrentInfo, setTorrentInfo] = useState<Pan115TorrentInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [parsing, setParsing] = useState(false);

  // ---- 目录浏览 ----
  const [dirsOpen, setDirsOpen] = useState(false);
  const [dirCid, setDirCid] = useState('0');
  const [dirTrail, setDirTrail] = useState<Array<{ cid: string; name: string }>>([]);
  const [entries, setEntries] = useState<Pan115DirEntry[]>([]);
  const [dirsLoading, setDirsLoading] = useState(false);
  const [dirsError, setDirsError] = useState<string | null>(null);

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [s, t] = await Promise.all([fetchPan115Status(), fetchPan115Tasks()]);
      setStatus(s);
      setTasks(t.tasks);
      setStats(t.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '115 任务加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetchPan115Paths()
      .then(setPaths)
      .catch(() => {
        /* 未配置或不可达：预设目录留空 */
      });
  }, [load]);

  // 自动刷新（页面可见时；有弹层/正在操作时跳过，避免打断）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (deleteTargets || dirsOpen) return;
      void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, deleteTargets, dirsOpen]);

  const configured = status?.configured === true;
  const loggedIn = status?.loggedIn === true;

  const filtered = useMemo(
    () => (filter === 'all' ? tasks : tasks.filter((t) => t.bucket === filter)),
    [tasks, filter],
  );

  const countOf = useCallback(
    (key: Pan115TaskBucket | 'all'): number => {
      if (!stats) return 0;
      if (key === 'all') return stats.total;
      return stats[key];
    },
    [stats],
  );

  const allChecked = filtered.length > 0 && filtered.every((t) => checked.has(t.infoHash));

  const toggleOne = (hash: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const toggleAll = (): void => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(filtered.map((t) => t.infoHash)));
  };

  const confirmDelete = async (targets: Pan115Task[], withFiles: boolean): Promise<void> => {
    setDeleteTargets(null);
    setBusyHash(targets.length === 1 ? targets[0].infoHash : '__batch__');
    try {
      const hashes = targets.map((t) => t.infoHash).filter(Boolean);
      if (hashes.length === 0) throw new ApiClientError(1001, '任务缺少 info_hash，无法删除');
      await deletePan115Tasks(hashes, withFiles);
      setToast({
        ok: true,
        text: `已删除 ${hashes.length} 个任务${withFiles ? '（含文件）' : ''}`,
      });
      setChecked(new Set());
      await load(true);
    } catch (err) {
      setToast({ ok: false, text: err instanceof ApiClientError ? err.message : '删除失败' });
    } finally {
      setBusyHash(null);
    }
  };

  const handleClear = async (): Promise<void> => {
    setClearing(true);
    try {
      const out = await clearPan115Tasks({ deleteFiles });
      setToast(
        out.deleted > 0
          ? { ok: true, text: `已清理 ${out.deleted} 个已完成任务${deleteFiles ? '（含文件）' : ''}` }
          : { ok: false, text: '没有可清理的已完成任务' },
      );
      await load(true);
    } catch (err) {
      setToast({ ok: false, text: err instanceof ApiClientError ? err.message : '清理失败' });
    } finally {
      setClearing(false);
    }
  };

  const submitUrl = async (): Promise<void> => {
    const url = addUrl.trim();
    if (!url) {
      setToast({ ok: false, text: '请填写磁力或直链' });
      return;
    }
    setAdding(true);
    try {
      const out = await pushPan115Url({ url, dir: dir.trim() || undefined });
      setToast({ ok: true, text: `已推送到 115 离线下载：${out.name || url.slice(0, 60)}` });
      setAddUrl('');
      await load(true);
    } catch (err) {
      setToast({ ok: false, text: err instanceof ApiClientError ? err.message : '推送失败' });
    } finally {
      setAdding(false);
    }
  };

  const parseTorrent = async (): Promise<void> => {
    const url = addUrl.trim();
    if (!url) {
      setToast({ ok: false, text: '请填写 .torrent 直链或磁力' });
      return;
    }
    setParsing(true);
    try {
      const info = await parsePan115TorrentFromUrl({ url });
      setTorrentInfo(info);
      setSelectedFiles(new Set(info.files.filter((f) => f.wanted !== -1).map((f) => f.index)));
      setToast({ ok: true, text: `已解析出 ${info.files.length} 个文件，请勾选要下载的内容` });
    } catch (err) {
      setToast({ ok: false, text: err instanceof ApiClientError ? err.message : '种子解析失败' });
    } finally {
      setParsing(false);
    }
  };

  const submitTorrent = async (): Promise<void> => {
    if (!torrentInfo) return;
    setAdding(true);
    try {
      const out = await addPan115Torrent({
        info: torrentInfo,
        wantedIndexes: [...selectedFiles],
        dir: dir.trim() || undefined,
      });
      setToast({ ok: true, text: `已推送（${selectedFiles.size} 个文件）：${out.name}` });
      setTorrentInfo(null);
      setAddUrl('');
      await load(true);
    } catch (err) {
      setToast({ ok: false, text: err instanceof ApiClientError ? err.message : '推送失败' });
    } finally {
      setAdding(false);
    }
  };

  const openDirs = async (cid: string): Promise<void> => {
    setDirsOpen(true);
    setDirCid(cid);
    setDirsLoading(true);
    setDirsError(null);
    try {
      const res = await fetchPan115Dirs(cid);
      setEntries(res.entries);
    } catch (err) {
      setDirsError(err instanceof ApiClientError ? err.message : '目录加载失败');
      setEntries([]);
    } finally {
      setDirsLoading(false);
    }
  };

  const enterDir = (entry: Pan115DirEntry): void => {
    if (!entry.isDir) return;
    setDirTrail((prev) => [...prev, { cid: dirCid, name: entry.name }]);
    void openDirs(entry.cid);
  };

  const gotoTrail = (index: number): void => {
    const target = index < 0 ? '0' : dirTrail[index].cid;
    setDirTrail((prev) => (index < 0 ? [] : prev.slice(0, index)));
    void openDirs(target);
  };

  const quota = status?.offlineQuota ?? null;
  const quotaPercent = quota && quota.total > 0 ? Math.round((quota.used / quota.total) * 100) : 0;

  return (
    <div className="pb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-title">115 离线下载</h1>
          <p className="type-caption mt-1 text-txt-tertiary">
            {!configured
              ? '配置 115 登录 Cookie 后可在此管理离线下载任务'
              : loggedIn
                ? `${status?.username ?? ''}${status?.vip ? ' · 会员' : ''}${
                    quota ? ` · 配额剩余 ${quota.surplus}/${quota.total}` : ''
                  }${stats ? ` · ${stats.total} 个任务` : ''}`
                : '已保存 Cookie，但登录态无效'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="gray"
            className="!min-h-[36px] !px-3 text-[13px]"
            loading={refreshing}
            onClick={() => void load(true)}
          >
            刷新
          </Button>
          <Link to="/settings">
            <Button variant="tinted" className="!min-h-[36px] !px-3 text-[13px]">
              <i className="ri-settings-4-line text-[15px]" aria-hidden />
              115 设置
            </Button>
          </Link>
        </div>
      </div>

      {!configured && !loading ? (
        <GlassPanel className="mx-auto mt-8 max-w-[480px] p-8 text-center" bordered>
          <i className="ri-cloud-line text-[40px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <h2 className="type-headline mt-3">还没有配置 115 网盘</h2>
          <p className="type-caption mt-2 text-txt-secondary">
            在「设置 → 115 网盘」粘贴浏览器登录后的 Cookie（UID / CID / SEID / KID），即可把磁力与种子推送到 115 离线下载。
          </p>
          <Link to="/settings">
            <Button variant="filled" className="mt-5">
              前往设置
            </Button>
          </Link>
        </GlassPanel>
      ) : loading ? (
        <Spinner label="正在加载 115 离线任务" />
      ) : error ? (
        <GlassPanel className="mx-auto mt-6 max-w-[480px] p-6 text-center" bordered>
          <i className="ri-cloud-off-line text-[32px]" style={{ color: 'var(--color-danger)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">{error}</p>
          <Button variant="gray" className="mt-4" onClick={() => void load()}>
            重试
          </Button>
        </GlassPanel>
      ) : (
        <>
          {/* 账号 / 配额概览 */}
          <GlassPanel className="mb-4 p-4" bordered>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="type-caption text-txt-tertiary">登录账号</p>
                <p className="mt-0.5 flex items-center gap-2 text-[15px] font-medium text-txt-primary">
                  <i
                    className="ri-circle-fill text-[8px]"
                    style={{ color: loggedIn ? 'var(--color-success)' : 'var(--color-danger)' }}
                    aria-hidden
                  />
                  {status?.username ?? '—'}
                  {status?.vip && (
                    <span
                      className="rounded-pill px-2 py-0.5 text-[11px]"
                      style={{
                        background: 'color-mix(in srgb, #E8B54E 18%, transparent)',
                        color: '#C8912B',
                      }}
                    >
                      会员
                    </span>
                  )}
                </p>
                {status?.error && (
                  <p className="type-caption mt-1" style={{ color: 'var(--color-danger)' }}>
                    {status.error}
                  </p>
                )}
              </div>

              <div className="w-full max-w-[320px] shrink-0">
                <div className="flex items-center justify-between">
                  <p className="type-caption text-txt-tertiary">本月离线配额</p>
                  {quota && (
                    <p className="type-caption tabular-nums text-txt-secondary">
                      剩余 {quota.surplus} / {quota.total}
                    </p>
                  )}
                </div>
                {quota ? (
                  <div
                    className="mt-2 h-[6px] overflow-hidden"
                    style={{ background: 'var(--surface-warm)', borderRadius: 'var(--radius-pill)' }}
                  >
                    <div
                      className="h-full transition-all duration-base ease-out"
                      style={{
                        width: `${quotaPercent}%`,
                        background: quotaPercent >= 90 ? 'var(--color-danger)' : 'var(--color-glow)',
                        borderRadius: 'var(--radius-pill)',
                        boxShadow: '0 0 8px color-mix(in srgb, var(--color-glow) 60%, transparent)',
                      }}
                    />
                  </div>
                ) : (
                  <p className="type-caption mt-1 text-txt-tertiary">未获取到配额信息（离线下载需 115 会员）</p>
                )}
                {stats && (
                  <p className="type-caption mt-2 text-txt-tertiary">
                    共 {stats.total} 个任务 · 合计 {formatBytes(stats.totalSize)}
                    {stats.downloading > 0 && ` · ${stats.downloading} 进行中`}
                  </p>
                )}
              </div>
            </div>
          </GlassPanel>

          {/* 手动添加 */}
          <GlassPanel className="mb-4 p-4" bordered>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-headline flex items-center gap-2">
                <i className="ri-add-circle-line text-[18px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
                添加离线任务
              </h2>
              <div className="flex gap-1 rounded-sm bg-warm p-1" style={{ borderRadius: 'var(--radius-sm)' }}>
                {(
                  [
                    { key: 'url', label: '磁力 / 直链' },
                    { key: 'torrent', label: '种子（可勾选文件）' },
                  ] as Array<{ key: AddTab; label: string }>
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setAddTab(item.key);
                      setTorrentInfo(null);
                    }}
                    className={`press-spring min-h-[30px] rounded-sm px-3 text-[13px] transition-colors duration-fast ${
                      addTab === item.key ? 'font-semibold text-txt-primary' : 'text-txt-secondary'
                    }`}
                    style={
                      addTab === item.key ? { background: 'var(--color-bg-elevated)' } : undefined
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <textarea
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder={
                  addTab === 'url'
                    ? 'magnet:?xt=urn:btih:... 或 https://example.com/file.zip 或 ed2k://...'
                    : 'https://example.com/movie.torrent（种子直链，解析后可勾选文件）'
                }
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: addTab === 'url' ? 64 : 52,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-light)',
                  background: 'var(--color-bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-mono, monospace)',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />

              <div className="flex flex-wrap items-center gap-2">
                {(paths?.presets.length ?? 0) > 0 ? (
                  <>
                    {addTab === 'url' && (
                      <select
                        value=""
                        onChange={(e) => {
                          const preset = paths?.presets.find((p) => p.name === e.target.value);
                          if (preset) setDir(preset.name);
                        }}
                        aria-label="选择预设目录"
                        className="h-9 rounded-sm border border-line bg-card px-3 text-[13px] text-txt-secondary outline-none focus:border-accent"
                      >
                        <option value="">选择预设目录…</option>
                        {paths?.presets.map((preset) => (
                          <option key={`${preset.name}-${preset.cid}`} value={preset.name}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {addTab === 'torrent' && (
                      <select
                        value={dir}
                        onChange={(e) => setDir(e.target.value)}
                        aria-label="选择预设目录"
                        className="h-9 min-w-[160px] flex-1 rounded-sm border border-line bg-card px-3 text-[13px] text-txt-primary outline-none focus:border-accent"
                      >
                        <option value="">默认目录</option>
                        {paths?.presets.map((preset) => (
                          <option key={`${preset.name}-${preset.cid}`} value={preset.name}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                ) : null}

                {addTab === 'url' && (
                  <input
                    value={dir}
                    onChange={(e) => setDir(e.target.value)}
                    placeholder="保存目录（预设名 / CID / 路径，留空用默认）"
                    aria-label="115 保存目录"
                    className="h-9 min-w-[220px] flex-1 rounded-sm border border-line bg-card px-3 text-[13px] text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent"
                  />
                )}

                <Button
                  variant="gray"
                  className="!min-h-[36px] !px-3 text-[13px]"
                  onClick={() => void openDirs('0')}
                >
                  <i className="ri-folder-open-line text-[15px]" aria-hidden />
                  浏览目录
                </Button>
              </div>

              {torrentInfo && (
                <TorrentFilePicker
                  info={torrentInfo}
                  selected={selectedFiles}
                  onSelectedChange={setSelectedFiles}
                  submitLabel={`推送 ${selectedFiles.size} 个文件`}
                  busy={adding}
                  onSubmit={() => void submitTorrent()}
                  onClose={() => setTorrentInfo(null)}
                  maxHeight={220}
                />
              )}

              <div className="flex flex-wrap items-center gap-3">
                {addTab === 'url' ? (
                  <Button variant="filled" loading={adding} onClick={() => void submitUrl()}>
                    推送到 115
                  </Button>
                ) : (
                  <>
                    <Button variant="gray" loading={parsing} onClick={() => void parseTorrent()}>
                      解析文件树
                    </Button>
                    <Button
                      variant="filled"
                      loading={adding}
                      disabled={!torrentInfo || selectedFiles.size === 0}
                      onClick={() => void submitTorrent()}
                    >
                      推送到 115
                    </Button>
                  </>
                )}
              </div>
            </div>
          </GlassPanel>

          {/* 任务列表 */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className="press-spring flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-pill px-4 text-[14px] transition-colors duration-fast ease-out"
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
                    <span className="tabular-nums opacity-70">{countOf(f.key)}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="type-caption flex cursor-pointer items-center gap-1.5 text-txt-secondary">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                删除时同时删除文件
              </label>
              {checked.size > 0 && (
                <Button
                  variant="destructive"
                  className="!min-h-[36px] !px-3 text-[13px]"
                  loading={busyHash === '__batch__'}
                  onClick={() => setDeleteTargets(tasks.filter((t) => checked.has(t.infoHash)))}
                >
                  删除选中 {checked.size} 项
                </Button>
              )}
              <Button
                variant="gray"
                className="!min-h-[36px] !px-3 text-[13px]"
                loading={clearing}
                disabled={countOf('completed') === 0}
                onClick={() => void handleClear()}
              >
                清理已完成
                {countOf('completed') > 0 ? ` ${countOf('completed')}` : ''}
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
              <i className="ri-inbox-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
              <p className="type-body mt-3 text-txt-secondary">暂无离线任务</p>
              <p className="type-caption mt-1 text-txt-tertiary">
                在上方粘贴磁力或种子推送，也可在资源搜索结果页把结果推送到 115。
              </p>
            </GlassPanel>
          ) : (
            <>
              <label className="type-caption mb-2 flex cursor-pointer items-center gap-2 text-txt-secondary">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                全选当前列表（{filtered.length} 项）
              </label>

              <ul className="flex flex-col gap-3">
                {filtered.map((task) => {
                  const percent = task.status === 2 ? 100 : Math.min(100, Math.round((task.percentDone || 0) * 100));
                  const busy = busyHash === task.infoHash;
                  return (
                    <li key={task.infoHash || task.name}>
                      <GlassPanel className="p-4" bordered>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked.has(task.infoHash)}
                            onChange={() => toggleOne(task.infoHash)}
                            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                            aria-label={`选择 ${task.name}`}
                          />

                          <div className="min-w-0 flex-1">
                            <p
                              className="line-clamp-2 text-[14px] font-medium text-txt-primary"
                              title={task.name}
                            >
                              {task.name || '(未命名任务)'}
                            </p>

                            <div className="mt-2.5 flex items-center gap-3">
                              <div
                                className="h-[6px] flex-1 overflow-hidden"
                                style={{ background: 'var(--surface-warm)', borderRadius: 'var(--radius-pill)' }}
                              >
                                <div
                                  className="h-full transition-all duration-base ease-out"
                                  style={{
                                    width: `${percent}%`,
                                    background:
                                      task.bucket === 'error' ? 'var(--color-danger)' : 'var(--color-glow)',
                                    borderRadius: 'var(--radius-pill)',
                                    boxShadow: '0 0 8px color-mix(in srgb, var(--color-glow) 60%, transparent)',
                                  }}
                                />
                              </div>
                              <span className="type-caption w-[42px] shrink-0 text-right tabular-nums text-txt-secondary">
                                {percent}%
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-txt-tertiary">
                              <span
                                className="inline-flex items-center gap-1"
                                style={{ color: STATUS_COLOR[task.bucket] }}
                              >
                                <i className="ri-circle-fill text-[7px]" aria-hidden />
                                {task.statusText}
                              </span>
                              <span>{formatBytes(task.size)}</span>
                              <span>加入 {formatTime(task.addTime)}</span>
                              {task.lastUpdate > 0 && <span>更新 {formatTime(task.lastUpdate)}</span>}
                            </div>

                            {task.url && (
                              <p className="type-caption mt-1 truncate text-txt-tertiary" title={task.url}>
                                来源 {task.url.startsWith('magnet:') ? '磁力链接' : task.url}
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col gap-2">
                            <Button
                              variant="gray"
                              className="!min-h-[34px] !px-3 text-[13px]"
                              loading={busy}
                              onClick={() => setDeleteTargets([task])}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      </GlassPanel>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {/* 删除确认弹层 */}
      {deleteTargets && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero-dim, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label="确认删除离线任务"
        >
          <GlassPanel className="w-full max-w-[440px] p-5" bordered>
            <h2 className="type-headline">
              删除 {deleteTargets.length === 1 ? '离线任务' : `${deleteTargets.length} 个离线任务`}
            </h2>
            <p className="type-caption mt-2 break-all text-txt-secondary">
              {deleteTargets.length === 1
                ? deleteTargets[0].name || '(未命名任务)'
                : deleteTargets
                    .slice(0, 3)
                    .map((t) => t.name)
                    .join('、') + (deleteTargets.length > 3 ? ` 等 ${deleteTargets.length} 项` : '')}
            </p>
            <p className="type-caption mt-3 text-txt-tertiary">
              可选择仅从 115 离线列表移除任务，或连同已下载到网盘的文件一并删除（不可恢复）。
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="gray" onClick={() => setDeleteTargets(null)}>
                取消
              </Button>
              <Button variant="gray" onClick={() => void confirmDelete(deleteTargets, false)}>
                仅移除任务
              </Button>
              <Button variant="destructive" onClick={() => void confirmDelete(deleteTargets, true)}>
                删除并清除文件
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* 目录浏览弹层 */}
      {dirsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero-dim, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label="浏览 115 目录"
        >
          <GlassPanel className="flex max-h-[80vh] w-full max-w-[520px] flex-col p-5" bordered>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="type-headline">浏览 115 目录</h2>
                <p className="type-caption mt-1 truncate text-txt-tertiary">
                  / {dirTrail.map((t) => t.name).join(' / ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDirsOpen(false)}
                className="press-spring shrink-0 rounded-full p-1 text-txt-tertiary hover:text-txt-primary"
                aria-label="关闭"
              >
                <i className="ri-close-line text-[20px]" aria-hidden />
              </button>
            </div>

            <div className="mb-2 flex items-center gap-2">
              <Button
                variant="gray"
                className="!min-h-[32px] !px-3 text-[12px]"
                disabled={dirTrail.length === 0}
                onClick={() => gotoTrail(dirTrail.length - 2)}
              >
                <i className="ri-arrow-left-line text-[14px]" aria-hidden />
                上一级
              </Button>
              <Button
                variant="gray"
                className="!min-h-[32px] !px-3 text-[12px]"
                onClick={() => gotoTrail(-1)}
              >
                根目录
              </Button>
              <span className="type-caption truncate text-txt-tertiary">
                CID {dirCid} · {entries.filter((e) => e.isDir).length} 个子目录
              </span>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {dirsLoading ? (
                <Spinner label="正在加载目录" size={22} />
              ) : dirsError ? (
                <p className="type-caption py-4 text-center" style={{ color: 'var(--color-danger)' }}>
                  {dirsError}
                </p>
              ) : entries.length === 0 ? (
                <p className="type-caption py-4 text-center text-txt-tertiary">该目录为空</p>
              ) : (
                <ul>
                  {entries.map((entry, i) => (
                    <li
                      key={`${entry.cid}-${entry.name}`}
                      className="flex items-center gap-3 py-2"
                      style={{ borderTop: i ? '1px solid var(--border-light)' : undefined }}
                    >
                      <i
                        className={`${entry.isDir ? 'ri-folder-3-fill' : 'ri-file-3-line'} text-[16px]`}
                        style={{ color: entry.isDir ? 'var(--color-accent)' : 'var(--text-tertiary)' }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-txt-primary" title={entry.name}>
                        {entry.name}
                      </span>
                      {!entry.isDir && (
                        <span className="type-caption shrink-0 tabular-nums text-txt-tertiary">
                          {formatBytes(entry.size)}
                        </span>
                      )}
                      {entry.isDir && (
                        <>
                          <button
                            type="button"
                            onClick={() => enterDir(entry)}
                            className="type-caption shrink-0 text-accent hover:underline"
                          >
                            进入
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDir(entry.cid);
                              setDirsOpen(false);
                              setToast({ ok: true, text: `已选择目录「${entry.name}」(CID ${entry.cid})` });
                            }}
                            className="type-caption shrink-0 text-txt-secondary hover:underline"
                          >
                            选用
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--border-light)' }}>
              <p className="type-caption text-txt-tertiary">
                当前目录 CID：<code>{dirCid}</code>
              </p>
              <Button
                variant="filled"
                className="!min-h-[34px] !px-3 text-[13px]"
                onClick={() => {
                  setDir(dirCid);
                  setDirsOpen(false);
                  setToast({ ok: true, text: `已选择当前目录 (CID ${dirCid})` });
                }}
              >
                选用当前目录
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}

      {toast && (
        <Toast message={toast.text} ok={toast.ok} onClose={() => setToast(null)} duration={4000} />
      )}
    </div>
  );
}
