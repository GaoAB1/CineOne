/**
 * Dock 用户头像 + 下拉菜单（PC SideDock 与移动 TabBar 复用）。
 * 菜单：用户名 / 设置 / 主题切换 / 退出登录。点击外部自动收起。
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GlassPanel from '../ui/GlassPanel';
import { useAuth } from '../../stores/AuthContext';
import { useTheme } from '../../stores/ThemeContext';

interface UserDockItemProps {
  /** 触发钮外层样式（用于 Dock 槽位尺寸/居中） */
  wrapperClassName?: string;
  /** 下拉菜单定位类（相对触发钮） */
  menuClassName?: string;
}

export default function UserDockItem({
  wrapperClassName = '',
  menuClassName = '',
}: UserDockItemProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleLogout = async (): Promise<void> => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  const username = user?.username ?? '';

  return (
    <div ref={rootRef} className={`relative flex items-center justify-center ${wrapperClassName}`}>
      <button
        type="button"
        aria-label="用户菜单"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold transition-shadow duration-fast ease-out"
        style={{
          background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
          color: '#FFFFFF',
          boxShadow: open
            ? '0 0 18px color-mix(in srgb, var(--color-glow) 50%, transparent)'
            : undefined,
        }}
      >
        {username.slice(0, 1).toUpperCase() || <i className="ri-user-line text-[18px]" aria-hidden />}
      </button>

      {open && (
        <GlassPanel
          className={`absolute z-50 w-52 overflow-hidden p-1.5 shadow-lg ${menuClassName}`}
          style={{
            boxShadow: 'var(--shadow-lg), 0 0 40px color-mix(in srgb, var(--color-glow) 12%, transparent)',
          }}
          bordered
        >
          <p className="truncate px-3 py-2 type-caption text-txt-tertiary">{username}</p>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex min-h-[40px] items-center gap-2.5 rounded-sm px-3 text-body text-txt-secondary transition-colors duration-fast ease-out hover:bg-warm hover:text-txt-primary"
          >
            <i className="ri-settings-4-line text-[18px]" aria-hidden /> 设置
          </Link>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              toggleTheme();
            }}
            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-sm px-3 text-left text-body text-txt-secondary transition-colors duration-fast ease-out hover:bg-warm hover:text-txt-primary"
          >
            <i
              className={`${theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'} text-[18px]`}
              style={{ color: 'var(--color-glow)' }}
              aria-hidden
            />
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </button>

          <div className="mx-2 my-1" style={{ height: 1, background: 'var(--border-light)' }} />

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-sm px-3 text-left text-body text-danger transition-colors duration-fast ease-out hover:bg-warm"
          >
            <i className="ri-logout-box-r-line text-[18px]" aria-hidden /> 退出登录
          </button>
        </GlassPanel>
      )}
    </div>
  );
}
