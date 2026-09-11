/**
 * 设置页「下载器（qBittorrent）」分区：
 * 连接配置（地址/用户名/密码）+ 下载位置（电影目录 / 剧集目录 / 预设目录列表）+ 分类。
 * 密码留空表示不修改（后端仅打码回显）；「测试连接」调 /api/qb/status；
 * 「拉取默认路径」读取 qB 的 defaultSavePath 便于一键填充。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { fetchQbStatus, fetchSettings, updateSettings, type QbStatus } from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import Button from '../ui/Button';
import InputField from '../ui/InputField';
import GlassPanel from '../ui/GlassPanel';

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 96,
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-light)',
  background: 'var(--color-bg-card)',
  color: 'var(--text-primary)',
  fontSize: 15,
  lineHeight: 1.6,
  outline: 'none',
  resize: 'vertical',
};

export default function QbittorrentSection() {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);

  const [moviePath, setMoviePath] = useState('');
  const [tvPath, setTvPath] = useState('');
  const [presetPaths, setPresetPaths] = useState('');
  const [movieCategory, setMovieCategory] = useState('');
  const [tvCategory, setTvCategory] = useState('');

  const [status, setStatus] = useState<QbStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [view, qbStatus] = await Promise.all([
        fetchSettings(),
        fetchQbStatus().catch(() => null),
      ]);
      setServerUrl(view.qb_server_url ?? '');
      setUsername(view.qb_username ?? '');
      setPasswordSet(view.qb_password_set ?? false);
      setMoviePath(view.qb_save_path_movie ?? '');
      setTvPath(view.qb_save_path_tv ?? '');
      setPresetPaths(view.qb_save_paths ?? '');
      setMovieCategory(view.qb_category_movie ?? '');
      setTvCategory(view.qb_category_tv ?? '');
      if (qbStatus) setStatus(qbStatus);
    } catch {
      // 静默：设置加载失败时保留空表单
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    const url = serverUrl.trim();
    if (!url) {
      setFeedback({ ok: false, text: '请填写 qBittorrent WebUI 地址' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const patch: Record<string, string> = {
        qb_server_url: url.replace(/\/+$/, ''),
        qb_username: username.trim(),
        qb_save_path_movie: moviePath.trim(),
        qb_save_path_tv: tvPath.trim(),
        qb_save_paths: presetPaths,
        qb_category_movie: movieCategory.trim(),
        qb_category_tv: tvCategory.trim(),
      };
      // 密码留空 = 不修改（避免误清空）
      if (password.trim()) patch.qb_password = password;
      const view = await updateSettings(patch);
      setPassword('');
      setPasswordSet(view.qb_password_set);
      setFeedback({ ok: true, text: '下载器配置已保存' });
      setStatus(await fetchQbStatus().catch(() => null));
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
      const result = await fetchQbStatus();
      setStatus(result);
      if (!result.configured) {
        setFeedback({ ok: false, text: '尚未配置 WebUI 地址' });
      } else if (result.reachable) {
        setFeedback({ ok: true, text: `连接成功（qBittorrent ${result.version ?? '未知版本'}）` });
      } else {
        setFeedback({ ok: false, text: result.error ?? '连接失败，请检查地址与账号' });
      }
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof ApiClientError ? err.message : '测试连接失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const pullDefaultPath = async (): Promise<void> => {
    setLoadingPaths(true);
    setFeedback(null);
    try {
      if (!status?.reachable) {
        const s = await fetchQbStatus();
        setStatus(s);
        if (!s.reachable) {
          setFeedback({ ok: false, text: 'qBittorrent 不可达，无法拉取默认路径' });
          return;
        }
      }
      const s = status?.defaultSavePath ? status : await fetchQbStatus();
      const def = s.defaultSavePath ?? '';
      if (!def) {
        setFeedback({ ok: false, text: '未能获取 qBittorrent 默认保存路径' });
        return;
      }
      setPresetPaths((prev) => (prev.includes(def) ? prev : prev.trim() ? `${prev.trim()}\n${def}` : def));
      setMoviePath((prev) => prev || `${def}/movies`);
      setTvPath((prev) => prev || `${def}/tv`);
      setFeedback({ ok: true, text: `已拉取默认路径：${def}（保存后生效）` });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof ApiClientError ? err.message : '拉取失败' });
    } finally {
      setLoadingPaths(false);
    }
  };

  return (
    <GlassPanel className="mb-4 p-5" bordered>
      <h2 className="type-headline mb-4 flex items-center gap-2">
        <i className="ri-download-2-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        qBittorrent 下载器
      </h2>

      <p className="type-caption mb-4 text-txt-secondary">
        当前状态：
        {status?.configured ? (
          <>
            已配置 ·{' '}
            <span style={{ color: status.reachable ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {status.reachable ? `服务可达（${status.version ?? '版本未知'}）` : '服务不可达'}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-danger)' }}>未配置</span>
        )}
        {status?.authMode === 'anonymous' && <span className="ml-2 text-txt-tertiary">· 免认证模式</span>}
      </p>

      {/* 连接配置 */}
      <div className="flex flex-col gap-3">
        <InputField
          label="WebUI 地址"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="http://192.168.1.10:8080"
          className="w-full"
          autoComplete="off"
        />
        <InputField
          label="用户名（留空表示已开启免登录）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          className="w-full"
          autoComplete="off"
        />
        <InputField
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={passwordSet ? '已设置（留空表示不修改）' : 'qBittorrent 登录密码'}
          className="w-full"
          autoComplete="new-password"
        />
      </div>

      <h3 className="type-headline mb-3 mt-6 flex items-center gap-2">
        <i className="ri-folder-settings-line text-[18px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        下载位置
      </h3>

      <div className="flex flex-col gap-3">
        <InputField
          label="电影默认目录（按类型自动预选）"
          value={moviePath}
          onChange={(e) => setMoviePath(e.target.value)}
          placeholder="/downloads/movies"
          className="w-full"
          autoComplete="off"
        />
        <InputField
          label="剧集默认目录（按类型自动预选）"
          value={tvPath}
          onChange={(e) => setTvPath(e.target.value)}
          placeholder="/downloads/tv"
          className="w-full"
          autoComplete="off"
        />
        <div>
          <label className="type-caption mb-1 block text-txt-secondary">
            预设目录列表（每行一个，下载弹窗可选）
          </label>
          <textarea
            value={presetPaths}
            onChange={(e) => setPresetPaths(e.target.value)}
            placeholder={'/downloads/movies\n/downloads/tv\n/downloads/anime'}
            style={textareaStyle}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <InputField
            label="电影分类（可选，写入 qB 任务分类）"
            value={movieCategory}
            onChange={(e) => setMovieCategory(e.target.value)}
            placeholder="电影"
            className="w-full"
            autoComplete="off"
          />
          <InputField
            label="剧集分类（可选）"
            value={tvCategory}
            onChange={(e) => setTvCategory(e.target.value)}
            placeholder="剧集"
            className="w-full"
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
        <Button variant="gray" loading={loadingPaths} onClick={() => void pullDefaultPath()}>
          拉取默认路径
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
        在资源搜索结果点「下载」即会把该条目的种子推送到 qBittorrent；电影与剧集按上述目录自动区分。
      </p>
    </GlassPanel>
  );
}
