/**
 * 设置页「通知推送（Bark）」分区：
 * 配置 Bark 服务器地址与设备 Key，支持发送测试推送。
 * 启用后服务端会自动推送：115/qB 下载完成、想看剧集上线当天、在看剧集待播当天。
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings, testBarkPush, updateSettings, type SettingsView } from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import Button from '../ui/Button';
import GlassPanel from '../ui/GlassPanel';
import InputField from '../ui/InputField';

export default function BarkSection() {
  const [serverUrl, setServerUrl] = useState('https://api.day.app');
  const [deviceKey, setDeviceKey] = useState('');
  const [keySet, setKeySet] = useState(false);
  const [masked, setMasked] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const view: SettingsView = await fetchSettings();
      setServerUrl(view.bark_server_url || 'https://api.day.app');
      setKeySet(view.bark_device_key_set ?? false);
      setMasked(view.bark_device_key_masked ?? '');
    } catch {
      // 静默：加载失败保留默认表单
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFeedback(null);
    try {
      const patch: Record<string, string> = {
        bark_server_url: serverUrl.trim() || 'https://api.day.app',
      };
      // Key 留空表示不修改，避免误清空
      if (deviceKey.trim()) patch.bark_device_key = deviceKey.trim();
      await updateSettings(patch);
      setDeviceKey('');
      await load();
      setFeedback({ ok: true, text: 'Bark 配置已保存' });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof ApiClientError ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await testBarkPush();
      setFeedback({
        ok: res.ok,
        text: res.ok ? '测试推送已发送，请在 iPhone 上查看 Bark 通知' : res.message,
      });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof ApiClientError ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-notification-3-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        通知推送（Bark）
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {keySet ? (
          <span style={{ color: 'var(--color-success)' }}>已启用（{masked}）</span>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>未配置</span>
        )}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <InputField
          label="Bark 服务器地址"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://api.day.app"
          hint="自建 Bark Server 可改为私有地址"
        />
        <InputField
          label={keySet ? '设备 Key（留空则不修改）' : 'Bark 设备 Key'}
          value={deviceKey}
          onChange={(e) => setDeviceKey(e.target.value)}
          placeholder={keySet ? `已保存：${masked}` : '在 Bark App 首页复制'}
          autoComplete="off"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button variant="gray" loading={testing} onClick={() => void test()}>
          发送测试推送
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

      <div className="type-caption mt-4 text-txt-tertiary">
        <p className="mb-1">· 获取 Key：iPhone 安装 Bark App → 打开首页复制推送 URL 中的 Key 部分。</p>
        <p className="mb-1">· 启用后自动推送：115 / qBittorrent 下载完成、想看的影视上线当天、在看剧集待播集播出当天。</p>
        <p>· 服务器需能访问 Bark 服务器；自建部署请填写可达地址。</p>
      </div>
    </GlassPanel>
  );
}
