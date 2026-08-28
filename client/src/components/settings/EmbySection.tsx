/**
 * 设置页「Emby 媒体库」分区：登录式接入（服务器地址 + 用户名 + 密码 → AuthenticateByName）。
 * 登录成功后服务端持久化 AccessToken / 用户 ID；支持退出登录与立即同步。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  embyLogin,
  embyLogout,
  fetchEmbyStatus,
  triggerEmbySync,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import type { EmbyStatus, EmbySyncResult } from '../../api/types';
import Button from '../ui/Button';
import InputField from '../ui/InputField';
import GlassPanel from '../ui/GlassPanel';

interface Feedback {
  ok: boolean;
  text: string;
}

function formatLastSync(lastSync: string | null): string {
  if (!lastSync) return '从未同步';
  const date = new Date(lastSync);
  return Number.isNaN(date.getTime()) ? lastSync : date.toLocaleString();
}

export default function EmbySection() {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [loggingIn, setLoggingIn] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [status, setStatus] = useState<EmbyStatus | null>(null);
  const [syncResult, setSyncResult] = useState<EmbySyncResult | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchEmbyStatus());
    } catch {
      // 静默：后端未就绪或未配置时不阻塞本分区展示
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const errText = (err: unknown, fallback: string): string =>
    err instanceof ApiClientError ? err.message : fallback;

  const handleLogin = async (): Promise<void> => {
    const url = serverUrl.trim();
    const name = username.trim();
    if (!url || !name || !password) {
      setFeedback({ ok: false, text: '服务器地址、用户名与密码均为必填' });
      return;
    }
    setLoggingIn(true);
    setFeedback(null);
    try {
      const result = await embyLogin({ server_url: url, username: name, password });
      setPassword('');
      setFeedback({
        ok: true,
        text: `登录成功：${result.serverName ?? 'Emby 服务器'}（${result.username}）`,
      });
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '登录失败') });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setFeedback(null);
    try {
      await embyLogout();
      setFeedback({ ok: true, text: '已断开 Emby 连接' });
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '断开失败') });
    }
  };

  const syncNow = async (): Promise<void> => {
    setSyncing(true);
    setFeedback(null);
    setSyncResult(null);
    try {
      const result = await triggerEmbySync();
      setSyncResult(result);
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '同步失败') });
    } finally {
      setSyncing(false);
    }
  };

  const configured = status?.configured === true;

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-server-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        Emby 媒体库
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {configured ? (
          <>
            <span style={{ color: 'var(--color-success)' }}>已登录</span>
            {status?.serverName && <> · {status.serverName}</>}
            {status?.lastSync && <> · 上次同步 {formatLastSync(status.lastSync)}</>} · {status.itemCount} 个条目
          </>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>未连接</span>
        )}
      </p>

      {/* 登录表单（已登录时仍可更换账号重登） */}
      <div className="flex flex-col gap-3">
        <InputField
          label="服务器地址"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="http://192.168.1.10:8096"
          className="w-full"
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-3">
          <InputField
            label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Emby 用户名"
            className="min-w-[160px] flex-1"
            autoComplete="off"
          />
          <InputField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Emby 密码"
            className="min-w-[160px] flex-1"
            autoComplete="current-password"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={loggingIn} onClick={() => void handleLogin()}>
          {configured ? '重新登录' : '登录'}
        </Button>
        {configured && (
          <>
            <Button variant="tinted" loading={syncing} onClick={() => void syncNow()}>
              立即同步
            </Button>
            <Button variant="gray" onClick={() => void handleLogout()}>
              断开连接
            </Button>
          </>
        )}
      </div>

      {feedback && (
        <p
          className="type-caption mt-3"
          style={{ color: feedback.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
        >
          {feedback.text}
        </p>
      )}
      {syncing && (
        <p className="type-caption mt-3 text-txt-secondary">正在同步 Emby 媒体库，请稍候…</p>
      )}
      {syncResult && (
        <p className="type-caption mt-3" style={{ color: 'var(--color-success)' }}>
          同步完成：入库 {syncResult.synced} · 跳过（无 TMDB 映射）{syncResult.skipped} · 关联追剧{' '}
          {syncResult.matchedToWatchlist}
        </p>
      )}

      <p className="type-caption mt-3 text-txt-tertiary">
        使用 Emby 用户名密码登录（与官方客户端一致）；登录后自动获取访问令牌，无需手填 API Key
        与用户 ID。「媒体库」页可直接浏览并播放。同步仅管理员可触发。
      </p>
    </GlassPanel>
  );
}
