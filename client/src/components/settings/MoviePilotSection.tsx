/**
 * 设置页「MoviePilot」分区：服务器地址 + Token 两项配置，
 * 「测试连接」调 GET /api/moviepilot/status 展示 reachable。
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchMoviepilotStatus, updateSettings } from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import type { MoviePilotStatus } from '../../api/types';
import Button from '../ui/Button';
import InputField from '../ui/InputField';
import GlassPanel from '../ui/GlassPanel';

export default function MoviePilotSection() {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<MoviePilotStatus | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchMoviepilotStatus());
    } catch {
      // 静默：后端未就绪或未配置时不阻塞本分区展示
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const save = async (): Promise<void> => {
    const url = serverUrl.trim();
    const tok = token.trim();
    if (!url || !tok) {
      setFeedback({ ok: false, text: '服务器地址与 Token 均为必填' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await updateSettings({
        moviepilot_server_url: url.replace(/\/+$/, ''),
        moviepilot_token: tok,
      });
      setServerUrl('');
      setToken('');
      setFeedback({ ok: true, text: 'MoviePilot 配置已保存' });
      await loadStatus();
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof ApiClientError ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await fetchMoviepilotStatus();
      setStatus(result);
      setFeedback(
        result.reachable
          ? { ok: true, text: '连接成功，MoviePilot 服务可达' }
          : { ok: false, text: '已配置但服务不可达，请检查地址与 Token' },
      );
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof ApiClientError ? err.message : '测试连接失败',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-download-cloud-2-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        MoviePilot
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {status?.configured ? (
          <>
            已配置 ·{' '}
            <span style={{ color: status.reachable ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {status.reachable ? '服务可达' : '服务不可达'}
            </span>
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
          placeholder="http://192.168.1.10:3000"
          className="w-full"
          autoComplete="off"
        />
        <InputField
          label="API Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="MoviePilot 设定中生成的 API Token"
          className="w-full"
          autoComplete="off"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button variant="gray" loading={testing} onClick={() => void testConnection()}>
          测试连接
        </Button>
      </div>

      {feedback && (
        <p
          className="type-caption mt-3"
          style={{ color: feedback.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
        >
          {feedback.text}
        </p>
      )}

      <p className="type-caption mt-3 text-txt-tertiary">
        配置后可在详情页一键推送订阅，MoviePilot 将自动追更下载。
      </p>
    </GlassPanel>
  );
}
