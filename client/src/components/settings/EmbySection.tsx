/**
 * 设置页「Emby 媒体库」分区：服务器地址 / API Key / 用户 ID 三项配置，
 * 「测试连接」调 GET /api/emby/status，「立即同步」调 POST /api/emby/sync 并反馈结果。
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchEmbyStatus, triggerEmbySync, updateSettings } from '../../api/endpoints';
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
  const [apiKey, setApiKey] = useState('');
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
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

  const save = async (): Promise<void> => {
    const url = serverUrl.trim();
    const key = apiKey.trim();
    const uid = userId.trim();
    if (!url || !key || !uid) {
      setFeedback({ ok: false, text: '服务器地址、API Key 与用户 ID 均为必填' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await updateSettings({
        emby_server_url: url.replace(/\/+$/, ''),
        emby_api_key: key,
        emby_user_id: uid,
        emby_username: username.trim(),
      });
      setServerUrl('');
      setApiKey('');
      setUserId('');
      setUsername('');
      setFeedback({ ok: true, text: 'Emby 配置已保存' });
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '保存失败') });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await fetchEmbyStatus();
      setStatus(result);
      setFeedback(
        result.verified
          ? { ok: true, text: `连接成功：${result.serverName ?? 'Emby 服务器'}，共 ${result.itemCount} 个条目` }
          : { ok: false, text: '已配置但连接未通过，请检查地址与 API Key' },
      );
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '测试连接失败') });
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async (): Promise<void> => {
    setSyncing(true);
    setFeedback(null);
    setSyncResult(null);
    try {
      const result = await triggerEmbySync();
      setSyncResult(result);
      setFeedback(null);
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '同步失败') });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-server-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        Emby 媒体库
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {status?.configured ? (
          <>
            <span style={{ color: 'var(--color-success)' }}>已配置</span>
            {status.serverName && <> · {status.serverName}</>} · {status.itemCount} 个条目 ·{' '}
            {formatLastSync(status.lastSync)}
          </>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>未配置</span>
        )}
      </p>

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
            label="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Emby 控制台生成的 API Key"
            className="min-w-[240px] flex-1"
            autoComplete="off"
          />
          <InputField
            label="用户 ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Emby 用户 GUID"
            className="min-w-[160px] flex-1"
            autoComplete="off"
          />
          <InputField
            label="用户名（可选）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户 ID 无效时按此自动识别"
            className="min-w-[160px] flex-1"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button variant="gray" loading={testing} onClick={() => void testConnection()}>
          测试连接
        </Button>
        <Button variant="tinted" loading={syncing} onClick={() => void syncNow()}>
          立即同步
        </Button>
      </div>

      {feedback && (
        <p className="type-caption mt-3" style={{ color: feedback.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
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
        在 Emby 控制台 → 高级 → API Key 中生成密钥；用户 ID 可在用户页面链接中查看。若 ID
        无效，「测试连接」会自动尝试按用户名识别并回填。同步仅管理员可触发。
      </p>
    </GlassPanel>
  );
}
