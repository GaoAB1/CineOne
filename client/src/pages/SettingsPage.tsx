/**
 * 设置页：TMDB Key 管理 / 缓存 TTL / 主题切换 / 账户信息。
 * （修改密码属 P1：后端 API 清单未包含，暂不展示入口）
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchSettings, updateSettings, type SettingsView } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import Button from '../components/ui/Button';
import InputField from '../components/ui/InputField';
import Switch from '../components/ui/Switch';
import GlassPanel from '../components/ui/GlassPanel';
import Spinner from '../components/ui/Spinner';
import { useAuth } from '../stores/AuthContext';
import { useTheme } from '../stores/ThemeContext';

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className={`${icon} text-[20px]`} style={{ color: 'var(--color-accent)' }} aria-hidden />
        {title}
      </h2>
      {children}
    </GlassPanel>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState('');
  const [ttlInput, setTtlInput] = useState('72');
  const [savingKey, setSavingKey] = useState(false);
  const [savingTtl, setSavingTtl] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const view = await fetchSettings();
      setSettings(view);
      setTtlInput(String(view.ratings_ttl_hours));
    } catch (err) {
      // 非管理员（P1 多用户预留）会得到 1003：此时展示只读提示
      setLoadError(
        err instanceof ApiClientError && err.code === 1003
          ? '系统设置仅管理员可管理'
          : err instanceof ApiClientError
            ? err.message
            : '设置加载失败',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveApiKey = async (): Promise<void> => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setNotice({ ok: false, text: '请输入 TMDB API Key' });
      return;
    }
    setSavingKey(true);
    setNotice(null);
    try {
      const view = await updateSettings({ tmdb_api_key: trimmed });
      setSettings(view);
      setKeyInput('');
      setNotice({ ok: true, text: 'API Key 已保存' });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiClientError ? err.message : '保存失败' });
    } finally {
      setSavingKey(false);
    }
  };

  const saveTtl = async (): Promise<void> => {
    const parsed = Number.parseInt(ttlInput, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 24 * 365) {
      setNotice({ ok: false, text: 'TTL 须为正整数小时数' });
      return;
    }
    setSavingTtl(true);
    setNotice(null);
    try {
      const view = await updateSettings({ ratings_ttl_hours: String(parsed) });
      setSettings(view);
      setNotice({ ok: true, text: `评分缓存 TTL 已设为 ${parsed} 小时` });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiClientError ? err.message : '保存失败' });
    } finally {
      setSavingTtl(false);
    }
  };

  if (loading) return <Spinner label="正在加载设置" />;

  return (
    <div className="mx-auto max-w-[640px]">
      {notice && (
        <GlassPanel
          className={`mb-4 p-3 text-center type-caption ${notice.ok ? '' : ''}`}
          style={{ borderColor: notice.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
          bordered
        >
          <span style={{ color: notice.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {notice.text}
          </span>
        </GlassPanel>
      )}

      {/* 外观 */}
      <Section title="外观" icon="ri-contrast-2-line">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body">深色模式</p>
            <p className="type-caption mt-0.5 text-txt-tertiary">沉浸暗色优先，偏好自动保存</p>
          </div>
          <Switch checked={theme === 'dark'} onChange={() => toggleTheme()} label="切换深色模式" />
        </div>
      </Section>

      {/* TMDB Key */}
      <Section title="TMDB 数据源" icon="ri-key-2-line">
        {loadError ? (
          <p className="type-body text-txt-secondary">{loadError}</p>
        ) : (
          <>
            <p className="type-caption mb-4 text-txt-secondary">
              当前状态：
              {settings?.tmdb_api_key_set ? (
                <code className="mx-1 rounded px-1.5 py-0.5" style={{ background: 'var(--color-bg-secondary)' }}>
                  {settings.tmdb_api_key_masked}
                </code>
              ) : (
                <span style={{ color: 'var(--color-danger)' }}>未配置</span>
              )}
              。Key 仅保存在你的服务器，前端与日志永不回显明文。
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <InputField
                label={settings?.tmdb_api_key_set ? '更换 API Key' : '填入 API Key (v3 auth)'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="32 位十六进制字符串"
                className="min-w-[240px] flex-1"
                autoComplete="off"
              />
              <Button variant="filled" loading={savingKey} onClick={() => void saveApiKey()}>
                保存
              </Button>
            </div>
            <p className="type-caption mt-3 text-txt-tertiary">
              在 themoviedb.org 注册后，于 设置 → API → Create 中申请免费 Key。
            </p>
          </>
        )}
      </Section>

      {/* 评分缓存 */}
      {!loadError && (
        <Section title="评分缓存" icon="ri-time-line">
          <div className="flex flex-wrap items-end gap-3">
            <InputField
              label="第三方评分缓存 TTL（小时）"
              type="number"
              min={1}
              value={ttlInput}
              onChange={(e) => setTtlInput(e.target.value)}
              className="w-[200px]"
            />
            <Button variant="gray" loading={savingTtl} onClick={() => void saveTtl()}>
              应用
            </Button>
          </div>
          <p className="type-caption mt-3 text-txt-tertiary">默认 72 小时；过期后在访问详情页时回源刷新。</p>
        </Section>
      )}

      {/* 账户 */}
      <Section title="账户" icon="ri-user-3-line">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body">{user?.username ?? '-'}</p>
            <p className="type-caption mt-0.5 text-txt-tertiary">
              角色：{user?.role === 'admin' ? '管理员' : user?.role ?? '-'}
            </p>
          </div>
          <span className="type-caption text-txt-tertiary">修改密码将在后续版本提供</span>
        </div>
      </Section>
    </div>
  );
}
