/**
 * 设置页「用户管理」Tab（仅管理员可见）：用户列表 / 新建用户 / 重置密码 / 删除。
 * 权限控制由后端 requireAdmin 兜底，前端仅按 role 展示入口。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createUser,
  deleteUser,
  listUsers,
  updateUserPassword,
  type CreateUserInput,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import type { AdminUserView } from '../../api/types';
import { useAuth } from '../../stores/AuthContext';
import Button from '../ui/Button';
import InputField from '../ui/InputField';
import Spinner from '../ui/Spinner';

function roleLabel(role: AdminUserView['role']): string {
  return role === 'admin' ? '管理员' : '成员';
}

function formatCreatedAt(value: string): string {
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export default function UserManageSection() {
  const { user: me } = useAuth();

  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 新建用户表单
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [creating, setCreating] = useState(false);

  // 重置密码（行内展开）
  const [resettingFor, setResettingFor] = useState<number | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetting, setResetting] = useState(false);

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const res = await listUsers();
      setUsers(res.users);
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : '用户列表加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const errText = (err: unknown, fallback: string): string =>
    err instanceof ApiClientError ? err.message : fallback;

  const handleCreate = async (): Promise<void> => {
    const input: CreateUserInput = {
      username: username.trim(),
      password,
      role,
    };
    if (!input.username || !password) {
      setFeedback({ ok: false, text: '用户名与密码均为必填' });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      await createUser(input);
      setUsername('');
      setPassword('');
      setRole('member');
      setFeedback({ ok: true, text: `用户 ${input.username} 已创建` });
      await load();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '创建失败') });
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (target: AdminUserView): Promise<void> => {
    if (resetPwd.length < 6) {
      setFeedback({ ok: false, text: '新密码至少 6 位' });
      return;
    }
    setResetting(true);
    setFeedback(null);
    try {
      await updateUserPassword(target.id, { newPassword: resetPwd });
      setResettingFor(null);
      setResetPwd('');
      setFeedback({ ok: true, text: `已重置 ${target.username} 的密码` });
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '重置失败') });
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (target: AdminUserView): Promise<void> => {
    const confirmed = window.confirm(
      `确认删除用户「${target.username}」？其追剧与想看记录将一并清除，且无法恢复。`,
    );
    if (!confirmed) return;
    setFeedback(null);
    try {
      await deleteUser(target.id);
      setFeedback({ ok: true, text: `已删除用户 ${target.username}` });
      await load();
    } catch (err) {
      setFeedback({ ok: false, text: errText(err, '删除失败') });
    }
  };

  if (users === null && !loadError) return <Spinner label="正在加载用户列表" />;

  return (
    <div className="flex flex-col gap-4">
      {/* 新建用户 */}
      <div className="flex flex-wrap items-end gap-3">
        <InputField
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3-32 位字母、数字、_ 或 -"
          className="min-w-[180px] flex-1"
          autoComplete="off"
        />
        <InputField
          label="初始密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
          className="min-w-[160px] flex-1"
          autoComplete="new-password"
        />
        <label className="flex items-center gap-2 text-[14px] text-txt-secondary">
          角色
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            className="h-[36px] rounded-sm border border-line bg-card px-2 text-[14px] text-txt-primary outline-none focus:border-accent"
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <Button variant="filled" loading={creating} onClick={() => void handleCreate()}>
          新建用户
        </Button>
      </div>

      {feedback && (
        <p
          className="type-caption"
          style={{ color: feedback.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
        >
          {feedback.text}
        </p>
      )}

      {loadError && <p className="type-caption" style={{ color: 'var(--color-danger)' }}>{loadError}</p>}

      {/* 用户列表 */}
      <div className="flex flex-col gap-2">
        {(users ?? []).map((u) => {
          const isSelf = me != null && me.id === u.id;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="type-body truncate">{u.username}</span>
                  <span
                    className="type-caption rounded-pill px-2 py-0.5"
                    style={{
                      background:
                        u.role === 'admin'
                          ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                          : 'var(--color-bg-secondary)',
                      color:
                        u.role === 'admin' ? 'var(--color-accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {roleLabel(u.role)}
                  </span>
                  {isSelf && <span className="type-caption text-txt-tertiary">（当前账号）</span>}
                </div>
                <p className="type-caption mt-0.5 text-txt-tertiary">
                  创建于 {formatCreatedAt(u.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isSelf && (
                  <>
                    <Button
                      variant="gray"
                      className="!min-h-[30px] !px-3 text-[13px]"
                      onClick={() => {
                        setResettingFor((prev) => (prev === u.id ? null : u.id));
                        setResetPwd('');
                      }}
                    >
                      重置密码
                    </Button>
                    <Button
                      variant="gray"
                      className="!min-h-[30px] !px-3 text-[13px]"
                      style={{ color: 'var(--color-danger)' }}
                      onClick={() => void handleDelete(u)}
                    >
                      删除
                    </Button>
                  </>
                )}
              </div>

              {!isSelf && resettingFor === u.id && (
                <div className="flex w-full flex-wrap items-end gap-2 border-t border-line pt-3">
                  <InputField
                    label={`为 ${u.username} 设置新密码`}
                    type="password"
                    value={resetPwd}
                    onChange={(e) => setResetPwd(e.target.value)}
                    autoComplete="new-password"
                    className="min-w-[200px] flex-1"
                  />
                  <Button
                    variant="tinted"
                    loading={resetting}
                    onClick={() => void handleResetPassword(u)}
                  >
                    确认重置
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {(users ?? []).length === 0 && (
          <p className="type-caption text-center text-txt-tertiary">暂无用户</p>
        )}
      </div>
    </div>
  );
}
