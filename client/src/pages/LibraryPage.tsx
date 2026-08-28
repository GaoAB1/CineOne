/**
 * 媒体库页：浏览 Emby 全部媒体（实时分页 + 搜索 + 类型筛选）。
 * 未连接时展示引导空态与「连接 Emby 服务器」登录入口（地址 + 用户名 + 密码）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  embyLogin,
  embyLogout,
  fetchEmbyLibrary,
  fetchEmbyStatus,
} from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { EmbyLibraryItem, EmbyStatus } from '../api/types';
import Button from '../components/ui/Button';
import InputField from '../components/ui/InputField';
import GlassPanel from '../components/ui/GlassPanel';
import Spinner from '../components/ui/Spinner';

const PAGE_SIZE = 40;

type LibraryType = 'all' | 'movie' | 'tv';

const TYPE_FILTERS: Array<{ key: LibraryType; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '剧集' },
];

function PosterFallbackMini({ title }: { title: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center p-2 text-center"
      style={{ borderRadius: 'var(--radius-md)', aspectRatio: '2 / 3', background: 'var(--color-bg-secondary)' }}
    >
      <span className="type-caption line-clamp-3 text-txt-tertiary">{title}</span>
    </div>
  );
}

export default function LibraryPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<EmbyStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [items, setItems] = useState<EmbyLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<LibraryType>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // 登录弹层
  const [loginOpen, setLoginOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginNotice, setLoginNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const configured = status?.configured === true;
  const requestIdRef = useRef(0);

  // 搜索防抖
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchEmbyStatus());
    } catch {
      setStatus(null);
    } finally {
      setStatusLoaded(true);
    }
  }, []);

  const loadFirstPage = useCallback(async (): Promise<void> => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchEmbyLibrary({ page: 1, page_size: PAGE_SIZE, search, type });
      if (reqId !== requestIdRef.current) return;
      setItems(res.items);
      setTotal(res.total);
      setPage(1);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setLoadError(err instanceof ApiClientError ? err.message : '媒体库加载失败');
      setItems([]);
      setTotal(0);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [search, type]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (configured) void loadFirstPage();
  }, [configured, loadFirstPage]);

  const loadMore = async (): Promise<void> => {
    if (loadingMore || items.length >= total) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchEmbyLibrary({ page: next, page_size: PAGE_SIZE, search, type });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(next);
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLogin = async (): Promise<void> => {
    if (!serverUrl.trim() || !username.trim() || !password) {
      setLoginNotice({ ok: false, text: '服务器地址、用户名与密码均为必填' });
      return;
    }
    setLoggingIn(true);
    setLoginNotice(null);
    try {
      await embyLogin({
        server_url: serverUrl.trim(),
        username: username.trim(),
        password,
      });
      setPassword('');
      setLoginOpen(false);
      setLoginNotice(null);
      await loadStatus();
    } catch (err) {
      setLoginNotice({
        ok: false,
        text: err instanceof ApiClientError ? err.message : '登录失败，请稍后重试',
      });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await embyLogout();
    } catch {
      // 忽略：本地状态照常刷新
    }
    setItems([]);
    setTotal(0);
    await loadStatus();
  };

  if (!statusLoaded) return <Spinner label="正在加载媒体库" />;

  return (
    <div>
      {/* 页头：标题 + 状态 + 连接管理 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-title">媒体库</h1>
          <p className="type-caption mt-1 text-txt-tertiary">
            {configured
              ? `已连接${status?.serverName ? ` · ${status.serverName}` : ''}，共 ${total} 个条目`
              : '连接你的 Emby 服务器，在应用内直接观看'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {configured ? (
            <>
              <Button
                variant="gray"
                className="!min-h-[36px] !px-3 text-[13px]"
                onClick={() => setLoginOpen(true)}
              >
                更换账号
              </Button>
              <Button
                variant="gray"
                className="!min-h-[36px] !px-3 text-[13px]"
                onClick={() => void handleLogout()}
              >
                断开
              </Button>
            </>
          ) : (
            <Button
              variant="filled"
              className="!min-h-[36px] !px-3 text-[13px]"
              onClick={() => setLoginOpen(true)}
            >
              <i className="ri-add-line text-[16px]" aria-hidden />
              添加 Emby 媒体库
            </Button>
          )}
        </div>
      </div>

      {/* 连接登录弹层 */}
      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--scrim-hero, rgba(0,0,0,0.5))' }}
          role="dialog"
          aria-modal="true"
          aria-label="连接 Emby 服务器"
        >
          <GlassPanel className="w-full max-w-[400px] p-5" bordered>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="type-headline flex items-center gap-2">
                <i className="ri-server-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
                连接 Emby 服务器
              </h2>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setLoginOpen(false)}
                className="press-spring flex h-8 w-8 items-center justify-center rounded-full text-txt-tertiary hover:text-txt-primary"
              >
                <i className="ri-close-line text-[18px]" aria-hidden />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <InputField
                label="服务器地址"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://192.168.1.10:8096"
                autoComplete="off"
              />
              <InputField
                label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Emby 用户名"
                autoComplete="off"
              />
              <InputField
                label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Emby 密码"
                autoComplete="current-password"
              />
            </div>
            {loginNotice && (
              <p
                className="type-caption mt-3"
                style={{ color: loginNotice.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
              >
                {loginNotice.text}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="gray" onClick={() => setLoginOpen(false)}>
                取消
              </Button>
              <Button variant="filled" loading={loggingIn} onClick={() => void handleLogin()}>
                登录
              </Button>
            </div>
            <p className="type-caption mt-3 text-txt-tertiary">
              登录凭据仅保存在你的 CineOne 服务器；登录后自动识别用户与访问令牌。
            </p>
          </GlassPanel>
        </div>
      )}

      {/* 未连接：引导空态 */}
      {!configured && (
        <GlassPanel className="mx-auto mt-10 max-w-[480px] p-8 text-center" bordered>
          <i className="ri-film-line text-[40px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <h2 className="type-headline mt-3">还没有连接 Emby</h2>
          <p className="type-caption mt-2 text-txt-secondary">
            使用 Emby 地址 + 用户名密码登录，即可浏览并直接播放媒体库内容。
          </p>
          <Button variant="filled" className="mt-5" onClick={() => setLoginOpen(true)}>
            <i className="ri-add-line text-[18px]" aria-hidden />
            添加 Emby 媒体库
          </Button>
        </GlassPanel>
      )}

      {/* 已连接：工具栏 + 海报网格 */}
      {configured && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-[200px] flex-1">
              <InputField
                label=""
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索标题…"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              {TYPE_FILTERS.map((t) => {
                const active = type === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setType(t.key)}
                    className="press-spring flex min-h-[36px] items-center rounded-pill px-4 text-[14px] transition-colors duration-fast ease-out"
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
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loadError && (
            <p className="type-caption mb-4" style={{ color: 'var(--color-danger)' }}>{loadError}</p>
          )}

          {loading ? (
            <Spinner label="正在加载媒体库" />
          ) : items.length === 0 ? (
            <GlassPanel className="mx-auto mt-8 max-w-[420px] p-8 text-center" bordered>
              <i className="ri-file-search-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
              <p className="type-body mt-3 text-txt-secondary">没有匹配的媒体</p>
              <p className="type-caption mt-1 text-txt-tertiary">换个关键词或类型筛选试试。</p>
            </GlassPanel>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {items.map((item) => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => navigate(`/play/${encodeURIComponent(item.itemId)}`)}
                    className="press-spring group text-left"
                    aria-label={`播放 ${item.title}`}
                  >
                    <div className="relative overflow-hidden" style={{ borderRadius: 'var(--radius-md)' }}>
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={`${item.title} 海报`}
                          loading="lazy"
                          className="w-full object-cover transition-transform duration-normal ease-out group-hover:scale-[1.03]"
                          style={{ aspectRatio: '2 / 3', background: 'var(--color-bg-secondary)' }}
                        />
                      ) : (
                        <PosterFallbackMini title={item.title} />
                      )}
                      {/* 播放覆盖 */}
                      <div
                        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-fast ease-out group-hover:opacity-100"
                        style={{ background: 'rgba(0,0,0,0.35)' }}
                      >
                        <i className="ri-play-circle-fill text-[36px] text-white" aria-hidden />
                      </div>
                      {!item.played && item.playedPercentage > 0 && (
                        <div
                          className="absolute inset-x-0 bottom-0 h-[3px]"
                          style={{ background: 'var(--color-bg-secondary)' }}
                        >
                          <div
                            style={{
                              width: `${item.playedPercentage}%`,
                              height: '100%',
                              background: 'var(--color-accent)',
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <p className="type-caption mt-1.5 truncate text-txt-primary">{item.title}</p>
                    <p className="type-caption text-txt-tertiary">
                      {item.year ?? '—'} · {item.mediaType === 'tv' ? '剧集' : '电影'}
                    </p>
                  </button>
                ))}
              </div>

              {items.length < total && (
                <div className="mt-6 text-center">
                  <Button variant="gray" loading={loadingMore} onClick={() => void loadMore()}>
                    加载更多（{items.length}/{total}）
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
