/**
 * 设置页「115 网盘（离线下载）」分区：
 * 配置 115 浏览器 Cookie（走 Web 接口，无需开放平台审核），
 * 维护离线下载预设目录（名称:CID，供推送弹层下拉），并测试登录态。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchPan115Status,
  fetchSettings,
  updateSettings,
  type Pan115Status,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import Button from '../ui/Button';
import GlassPanel from '../ui/GlassPanel';
import InputField from '../ui/InputField';
import SegmentedControl from '../ui/SegmentedControl';

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 96,
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

export default function Pan115Section() {
  const [cookie, setCookie] = useState('');
  const [cookieSet, setCookieSet] = useState(false);
  const [masked, setMasked] = useState('');
  const [savePath, setSavePath] = useState('');
  const [paths, setPaths] = useState('');
  const [moviePath, setMoviePath] = useState('');
  const [tvPath, setTvPath] = useState('');
  const [folderPerTask, setFolderPerTask] = useState(true);
  const [status, setStatus] = useState<Pan115Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const view = await fetchSettings();
      setCookieSet(view.pan115_cookie_set ?? false);
      setMasked(view.pan115_cookie_masked ?? '');
      setSavePath(view.pan115_save_path ?? '');
      setPaths(view.pan115_paths ?? '');
      setMoviePath(view.pan115_save_path_movie ?? '');
      setTvPath(view.pan115_save_path_tv ?? '');
      setFolderPerTask(view.pan115_folder_per_task ?? true);
    } catch {
      // 静默：加载失败时保留空表单
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchPan115Status());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshStatus();
  }, [load, refreshStatus]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFeedback(null);
    try {
      const patch: Record<string, string> = {
        pan115_save_path: savePath.trim(),
        pan115_paths: paths,
        pan115_save_path_movie: moviePath.trim(),
        pan115_save_path_tv: tvPath.trim(),
        pan115_folder_per_task: folderPerTask ? '1' : '0',
      };
      // Cookie 留空表示不修改，避免误清空已保存的登录态
      if (cookie.trim()) patch.pan115_cookie = cookie.trim();

      const view = await updateSettings(patch);
      setCookie('');
      setCookieSet(view.pan115_cookie_set);
      setMasked(view.pan115_cookie_masked);
      setFeedback({ ok: true, text: cookie.trim() ? '115 配置已保存，可点击「测试连接」验证' : '115 目录配置已保存' });
      void refreshStatus();
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
      const res = await fetchPan115Status();
      setStatus(res);
      if (!res.configured) {
        setFeedback({ ok: false, text: '尚未配置 Cookie' });
      } else if (res.loggedIn) {
        const quota = res.offlineQuota
          ? `，本月离线配额 剩余 ${res.offlineQuota.surplus}/${res.offlineQuota.total}`
          : '';
        setFeedback({ ok: true, text: `登录成功：${res.username ?? '未知账号'}${res.vip ? '（会员）' : ''}${quota}` });
      } else {
        setFeedback({ ok: false, text: res.error ?? '115 登录态无效，请重新获取 Cookie' });
      }
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof ApiClientError ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-cloud-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        115 网盘离线下载
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {!cookieSet ? (
          <span style={{ color: 'var(--color-danger)' }}>未配置</span>
        ) : status?.loggedIn ? (
          <span style={{ color: 'var(--color-success)' }}>
            已登录（{status.username ?? masked}）
            {status.vip ? ' · 会员' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>
            已保存 Cookie，但登录态无效{status?.error ? `：${status.error}` : ''}
          </span>
        )}
      </p>

      {status?.offlineQuota && (
        <p className="type-caption mb-4 text-txt-tertiary">
          本月离线下载配额：剩余 {status.offlineQuota.surplus} / 共 {status.offlineQuota.total}
          {status.offlineQuota.total === 0 && '（配额为 0 时需开通 115 会员）'}
        </p>
      )}

      <label className="type-caption mb-1 block text-txt-secondary">
        Cookie（登录 115.com 后从浏览器复制）
      </label>
      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder={cookieSet ? `已保存：${masked}（留空则不修改）` : 'UID=...; CID=...; SEID=...; KID=...'}
        style={textareaStyle}
        spellCheck={false}
      />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <InputField
          label="默认保存目录（CID 或预设名）"
          value={savePath}
          onChange={(e) => setSavePath(e.target.value)}
          placeholder="留空表示根目录"
        />
        <InputField
          label="电影默认目录"
          value={moviePath}
          onChange={(e) => setMoviePath(e.target.value)}
          placeholder="如 电影 或 1234567890"
        />
        <InputField
          label="剧集默认目录"
          value={tvPath}
          onChange={(e) => setTvPath(e.target.value)}
          placeholder="如 剧集 或 9876543210"
        />
      </div>

      <div className="mt-4">
        <label className="type-caption mb-1 block text-txt-secondary">
          预设目录列表（每行一个，格式「名称:CID」）
        </label>
        <textarea
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
          placeholder={'电影:1234567890\n剧集:9876543210\n动漫:1122334455'}
          style={{ ...textareaStyle, minHeight: 84 }}
          spellCheck={false}
        />
      </div>

      <div className="mt-4">
        <p className="type-caption mb-2 text-txt-secondary">离线任务目录组织方式</p>
        <SegmentedControl
          value={folderPerTask ? 'folder' : 'flat'}
          onChange={(value) => setFolderPerTask(value === 'folder')}
          options={[
            { value: 'folder', label: '每个任务建独立文件夹' },
            { value: 'flat', label: '直接保存到目标目录' },
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="filled" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button variant="gray" loading={testing} onClick={() => void test()}>
          测试连接
        </Button>
        <Link to="/pan115">
          <Button variant="tinted">
            <i className="ri-list-check-2 text-[16px]" aria-hidden />
            离线任务管理
          </Button>
        </Link>
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
        <p className="mb-1">
          · 获取 Cookie：浏览器登录 115.com → F12 → Application → Cookies → 复制 UID、CID、SEID、KID 等全部字段。
        </p>
        <p className="mb-1">
          · 获取目录 CID：在 115 网页版打开目标文件夹，地址栏 <code>cid=</code> 后面的数字即为 CID。
        </p>
        <p className="mb-1">
          · 推送磁力/直链时会按「电影/剧集」自动选择对应目录；种子文件会先解析出文件树，可勾选要下载的内容。
        </p>
        <p>· 115 的登录态通过 Cookie 维持，长期未使用后需重新获取；离线下载功能需 115 会员。</p>
      </div>
    </GlassPanel>
  );
}
