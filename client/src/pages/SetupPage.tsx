/**
 * 管理员初始化页（仅未初始化时可进，路由守卫控制）。
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';
import Button from '../components/ui/Button';
import InputField from '../components/ui/InputField';
import GlassPanel from '../components/ui/GlassPanel';
import PosterFallback from '../components/media/PosterFallback';

export default function SetupPage() {
  const { setup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await setup(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="grid w-full max-w-[820px] overflow-hidden shadow-md md:grid-cols-2" style={{ borderRadius: 'var(--radius-lg)' }}>
        <div
          className="hidden flex-col justify-between p-10 md:flex"
          style={{ background: 'var(--color-bg-secondary)' }}
        >
          <div className="flex items-center gap-2">
            <i className="ri-film-fill text-[28px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
            <span className="type-title">CineOne</span>
          </div>
          <PosterFallback />
          <p className="type-caption text-txt-secondary">首次使用 · 创建管理员账号以保护你的私人影视库</p>
        </div>

        <GlassPanel className="border-0 p-8 md:p-10" bordered={false}>
          <h1 className="type-title mb-2">欢迎来到 CineOne</h1>
          <p className="type-body mb-8 text-txt-secondary">设置管理员账号与密码，开始你的观影之旅。</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
            <InputField
              label="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="字母 / 数字 / 下划线 / 中文"
              autoComplete="username"
              required
            />
            <InputField
              label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete="new-password"
              required
            />
            <InputField
              label="确认密码"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入密码"
              error={error}
              autoComplete="new-password"
              required
            />
            <Button type="submit" block loading={submitting}>
              完成初始化
            </Button>
          </form>
        </GlassPanel>
      </div>
    </div>
  );
}
