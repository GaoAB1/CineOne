/**
 * 下载管理页 /downloads：
 * qBittorrent 任务列表（进度/状态/速度/ETA/保存路径），支持暂停、继续、删除（可连同文件）。
 * 页面可见时每 5 秒自动刷新；未配置或不可达时给出引导。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchQbStatus,
  fetchQbTorrents,
  qbDelete,
  qbPause,
  qbResume,
  type QbStatus,
  type QbTorrent,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import Button from '../components/ui/Button';
import GlassPanel from '../components/ui/GlassPanel';
import Spinner from '../components/ui/Spinner';

const REFRESH_MS = 5000;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

type Bucket = 'downloading' | 'paused' | 'completed' | 'error';

const STATE_LABEL: Record<string, { text: string; bucket: Bucket }> = {
  downloading: { text: '下载中', bucket: 'downloading' },
  forcedDL: { text: '下载中（强制）', bucket: 'downloading' },
  metaDL: { text: '获取元数据', bucket: 'downloading' },
  allocating: { text: '分配空间', bucket: 'downloading' },
  checkingDL: { text: '校验中', bucket: 'downloading' },
  queuedDL: { text: '排队中', bucket: 'downloading' },
  stalledDL: { text: '等待连接', bucket: 'downloading' },
  uploading: { text: '做种中', bucket: 'completed' },
  forcedUP: { text: '做种中（强制）', bucket: 'completed' },
  stalledUP: { text: '做种空闲', bucket: 'completed' },
  queuedUP: { text: '排队做种', bucket: 'completed' },
  checkingUP: { text: '做种校验', bucket: 'completed' },
  pausedDL: { text: '已暂停', bucket: 'paused' },
  pausedUP: { text: '已完成（暂停）', bucket: 'completed' },
  stoppedDL: { text: '已停止', bucket: 'paused' },
  stoppedUP: { text: '已完成（停止）', bucket: 'completed' },
  error: { text: '错误', bucket: 'error' },
  missingFiles: { text: '文件缺失', bucket: 'error' },
  unknown: { text: '未知', bucket: 'error' },
};

function stateMeta(state: string): { text: string; bucket: Bucket } {
  return STATE_LABEL[state] ?? { text: state, bucket: 'error' };
}

function isPausedState(state: string): boolean {
  return stateMeta(state).bucket === 'paused';
}

const FILTERS: Array<{ key: Bucket | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'downloading', label: '下载中' },
  { key: 'completed', label: '已完成' },
  { key: 'paused', label: '已暂停' },
  { key: 'error', label: '异常' },
];

export default function DownloadsPage() {
  const [status, setStatus] = useState<QbStatus | null>(null);
  const [torrents, setTorrents] = useState<QbTorrent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Bucket | 'all'>('all');
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QbTorrent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const [s, list] = await Promise.all([fetchQbStatus(), fetchQbTorrents()]);
      setStatus(s);
      setTorrents(list.torrents);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '下载任务加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 自动刷新（页面可见时）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(
    () => (filter === 'all' ? torrents : torrents.filter((t) => stateMeta(t.state).bucket === filter)),
    [torrents, filter],
  );

  const totals = useMemo(
    () =>
      torrents.reduce(
        (acc, t) => ({
          dl: acc.dl + (t.dlspeed || 0),
          up: acc.up + (t.upspeed || 0),
        }),
        { dl: 0, up: 0 },
      ),
    [torrents],
  );

  const act = async (action: 'pause' | 'resume', hash: string, name: string): Promise<void> => {
    setBusyHash(hash);
    setNotice(null);
    try {
      if (action === 'pause') await qbPause(hash);
      else await qbResume(hash);
      setNotice(`已${action === 'pause' ? '暂停' : '继续'}「${name}」`);
      await load(true);
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : '操作失败');
    } finally {
      setBusyHash(null);
    }
  };

  const confirmDelete = async (target: QbTorrent, deleteFiles: boolean): Promise<void> => {
    setDeleteTarget(null);
    setBusyHash(target.hash);
    setNotice(null);
    try {
      await qbDelete(target.hash, deleteFiles);
      setNotice(`已删除「${target.name}」${deleteFiles ? '（含文件）' : ''}`);
      await load(true);
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : '删除失败');
    } finally {
      setBusyHash(null);
    }
  };

  const configured = status?.configured === true;

  return (
    <div className="pb-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-title">下载管理</h1>
          <p className="type-caption mt-1 text-txt-tertiary">
            {configured
              ? status?.reachable
                ? `qBittorrent ${status.version ?? ''} · ${torrents.length} 个任务 · ↓ ${formatSpeed(totals.dl)} ↑ ${formatSpeed(totals.up)}`
                : 'qBittorrent 不可达'
              : '连接 qBittorrent 后可在此管理下载任务'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="gray" className="!min-h-[36px] !px-3 text-[13px]" onClick={() => void load()}>
            刷新
          </Button>
          <Link to="/settings">
            <Button variant="tinted" className="!min-h-[36px] !px-3 text-[13px]">
              <i className="ri-settings-4-line text-[15px]" aria-hidden />
              下载器设置
            </Button>
          </Link>
        </div>
      </div>

      {notice && (
        <p className="type-caption mb-3" style={{ color: 'var(--text-secondary)' }}>
          {notice}
        </p>
      )}

      {!configured && !loading ? (
        <GlassPanel className="mx-auto mt-8 max-w-[480px] p-8 text-center" bordered>
          <i className="ri-download-2-line text-[40px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <h2 className="type-headline mt-3">还没有配置下载器</h2>
          <p className="type-caption mt-2 text-txt-secondary">
            在「设置 → 下载器」填写 qBittorrent WebUI 地址与账号，即可在资源搜索结果一键推送下载。
          </p>
          <Link to="/settings">
            <Button variant="filled" className="mt-5">
              前往设置
            </Button>
          </Link>
        </GlassPanel>
      ) : loading ? (
        <Spinner label="正在加载下载任务" />
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
          {/* 状态筛选 */}
          <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count =
                f.key === 'all'
                  ? torrents.length
                  : torrents.filter((t) => stateMeta(t.state).bucket === f.key).length;
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
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
              <i className="ri-inbox-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
              <p className="type-body mt-3 text-txt-secondary">暂无任务</p>
              <p className="type-caption mt-1 text-txt-tertiary">
                在详情页「查找资源」搜索后，点结果中的「下载」即可推送任务。
              </p>
            </GlassPanel>
          ) : (
            <ul className="flex flex-col gap-3">
              {filtered.map((t) => {
                const meta = stateMeta(t.state);
                const percent = Math.min(100, Math.round((t.progress || 0) * 100));
                const paused = isPausedState(t.state);
                const busy = busyHash === t.hash;
                return (
                  <li key={t.hash}>
                    <GlassPanel className="p-4" bordered>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[14px] font-medium text-txt-primary" title={t.name}>
                            {t.name}
                          </p>

                          {/* 进度条 */}
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
                                    meta.bucket === 'error' ? 'var(--color-danger)' : 'var(--color-glow)',
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
                              style={{
                                color:
                                  meta.bucket === 'error'
                                    ? 'var(--color-danger)'
                                    : meta.bucket === 'completed'
                                      ? 'var(--color-success)'
                                      : 'var(--text-secondary)',
                              }}
                            >
                              <i className="ri-circle-fill text-[7px]" aria-hidden />
                              {meta.text}
                            </span>
                            <span>↓ {formatSpeed(t.dlspeed)}</span>
                            <span>↑ {formatSpeed(t.upspeed)}</span>
                            <span>剩余 {formatEta(t.eta)}</span>
                            <span>
                              {formatBytes(t.size)} · {t.numSeeds} 种子 / {t.numLeeches} 用户
                            </span>
                          </div>

                          <p className="type-caption mt-1 truncate text-txt-tertiary" title={t.savePath}>
                            保存至 {t.savePath || '默认目录'}
                            {t.category ? ` · 分类 ${t.category}` : ''}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col gap-2">
                          <Button
                            variant="gray"
                            className="!min-h-[34px] !px-3 text-[13px]"
                            loading={busy}
                            onClick={() => void act(paused ? 'resume' : 'pause', t.hash, t.name)}
                          >
                            {paused ? '继续' : '暂停'}
                          </Button>
                          <Button
                            variant="gray"
                            className="!min-h-[34px] !px-3 text-[13px]"
                            onClick={() => setDeleteTarget(t)}
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
          )}
        </>
      )}

      {/* 删除确认弹层 */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label="确认删除下载任务"
        >
          <GlassPanel className="w-full max-w-[420px] p-5" bordered>
            <h2 className="type-headline">删除下载任务</h2>
            <p className="type-caption mt-2 break-all text-txt-secondary">{deleteTarget.name}</p>
            <p className="type-caption mt-3 text-txt-tertiary">
              可选择仅从 qBittorrent 移除任务，或连同已下载文件一并删除（不可恢复）。
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="gray" onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button variant="gray" onClick={() => void confirmDelete(deleteTarget, false)}>
                仅移除任务
              </Button>
              <Button variant="destructive" onClick={() => void confirmDelete(deleteTarget, true)}>
                删除并清除文件
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
