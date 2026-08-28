/**
 * 设置页「账户」Tab 内的修改密码表单：本人修改需验证原密码。
 */

import { useState } from 'react';
import { updateUserPassword } from '../../api/endpoints';
import { ApiClientError } from '../../api/http';
import { useAuth } from '../../stores/AuthContext';
import Button from '../ui/Button';
import InputField from '../ui/InputField';

export default function ChangePasswordSection() {
  const { user } = useAuth();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (): Promise<void> => {
    if (!user) return;
    if (newPwd.length < 6) {
      setNotice({ ok: false, text: '新密码至少 6 位' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setNotice({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await updateUserPassword(user.id, { oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setNotice({ ok: true, text: '密码已更新，下次登录请使用新密码' });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiClientError ? err.message : '修改失败，请稍后重试',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <InputField
          label="原密码"
          type="password"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          autoComplete="current-password"
          className="min-w-[200px] flex-1"
        />
        <InputField
          label="新密码"
          type="password"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          autoComplete="new-password"
          className="min-w-[200px] flex-1"
        />
        <InputField
          label="确认新密码"
          type="password"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          autoComplete="new-password"
          className="min-w-[200px] flex-1"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="tinted" loading={busy} onClick={() => void submit()}>
          更新密码
        </Button>
        {notice && (
          <span
            className="type-caption"
            style={{ color: notice.ok ? 'var(--color-success)' : 'var(--color-danger)' }}
          >
            {notice.text}
          </span>
        )}
      </div>
    </div>
  );
}
