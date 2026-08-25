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
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <GlassPanel className="w-full max-w-[400px] border-line p-8 md:p-10 shadow-md" bordered>
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <i className="ri-film-fill text-[40px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <h1 className="type-title">CineOne</h1>
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
