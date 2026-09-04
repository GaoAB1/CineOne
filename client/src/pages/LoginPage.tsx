/**
 * 登录页。
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';
import Button from '../components/ui/Button';
import InputField from '../components/ui/InputField';
import GlassPanel from '../components/ui/GlassPanel';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* 影院灯光氛围：霓虹紫 / 琥珀光斑（纯装饰） */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-[380px] w-[380px] rounded-full"
        style={{
          background: 'color-mix(in srgb, var(--color-glow) 22%, transparent)',
          filter: 'blur(90px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -right-20 h-[340px] w-[340px] rounded-full"
        style={{
          background: 'color-mix(in srgb, var(--amber-badge-bg) 14%, transparent)',
          filter: 'blur(90px)',
        }}
      />
      <GlassPanel
        className="relative w-full max-w-[400px] border-line p-8 shadow-lg md:p-10"
        style={{ boxShadow: 'var(--shadow-lg), 0 0 60px color-mix(in srgb, var(--color-glow) 14%, transparent)' }}
        bordered
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span
            className="flex h-[68px] w-[68px] items-center justify-center rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
              boxShadow: '0 10px 30px color-mix(in srgb, var(--color-glow) 45%, transparent)',
              color: '#FFFFFF',
            }}
          >
            <i className="ri-film-fill text-[34px]" aria-hidden />
          </span>
          <h1 className="type-title mt-1">CineOne</h1>
          <p className="type-caption text-txt-secondary">家庭影视聚合 · 私有自托管</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
          <InputField
            label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <InputField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            autoComplete="current-password"
            required
          />
          <Button type="submit" block loading={submitting}>
            登录
          </Button>
        </form>
      </GlassPanel>
    </div>
  );
}
