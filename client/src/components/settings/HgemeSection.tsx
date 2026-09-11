/**
 * 设置页「资源站（hgme）」分区：
 * 配置 hgeme.com 的浏览器 Cookie（该站需要登录 + PoW 浏览器验证），
 * 保存后可「测试连接」——后端会自动完成 PoW 计算并复用会话。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { fetchSettings, pingHgeme, updateSettings } from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import Button from '../ui/Button';
import GlassPanel from '../ui/GlassPanel';

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 110,
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-light)',
  background: 'var(--color-bg-card)',
  color: 'var(--text-primary)',
  fontSize: 14,
  lineHeight: 1.6,
  fontFamily: 'var(--font-mono, monospace)',
  outline: 'none',
  resize: 'vertical',
};

export default function HgemeSection() {
  const [cookie, setCookie] = useState('');
  const [cookieSet, setCookieSet] = useState(false);
  const [masked, setMasked] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const view = await fetchSettings();
      setCookieSet(view.hgeme_cookie_set ?? false);
      setMasked(view.hgeme_cookie_masked ?? '');
    } catch {
      // 静默：加载失败时保留空表单
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!cookie.trim()) {
      setFeedback({ ok: false, text: '请粘贴 hgeme.com 的 Cookie' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const view = await updateSettings({ hgeme_cookie: cookie.trim() });
      setCookie('');
      setCookieSet(view.hgeme_cookie_set);
      setMasked(view.hgeme_cookie_masked);
      setFeedback({ ok: true, text: 'hgme Cookie 已保存，可点击「测试连接」验证' });
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
      const res = await pingHgeme();
      setFeedback(
        res.ok
          ? { ok: true, text: '连接成功（已自动完成浏览器验证，会话有效）' }
          : { ok: false, text: '尚未配置 Cookie' },
      );
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof ApiClientError ? err.message : '测试失败',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-database-2-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        hgeme 资源站
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {cookieSet ? (
          <span style={{ color: 'var(--color-success)' }}>已配置（{masked}）</span>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>未配置</span>
        )}
      </p>

      <label className="type-caption mb-1 block text-txt-secondary">
        Cookie（登录后从浏览器复制）
      </label>
      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder="browser_verified=...; PHPSESSID=...; app_auth=..."
        style={textareaStyle}
        spellCheck={false}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button variant="gray" loading={testing} onClick={() => void test()}>
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

      <div className="type-caption mt-4 text-txt-tertiary">
        <p className="mb-1">· 获取方式：浏览器登录 hgeme.com 后，F12 → Application → Cookies，复制全部 Cookie 值。</p>
        <p className="mb-1">
          · 该站需要「浏览器安全验证」，后端会自动完成计算（约 3 秒）并复用会话，无需手动过验证。
        </p>
        <p>· 验证有效期为 1 天，过期后会自动重新验证；若站点要求重新登录，更新 Cookie 即可。</p>
      </div>
    </GlassPanel>
  );
}
