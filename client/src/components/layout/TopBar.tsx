/**
 * 毛玻璃顶栏：搜索入口 / 主题切换 / 用户菜单。
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GlassPanel from '../ui/GlassPanel';
import { useTheme } from '../../stores/ThemeContext';

interface TopBarProps {
  title: string;
  username: string;
  onLogout: () => void;
}

export default function TopBar({ title, username, onLogout }: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 px-3 pt-3">
      <GlassPanel className="flex min-h-[56px] items-center gap-2 px-4 py-2" bordered>
        <h1 className="type-title mr-auto truncate">{title}</h1>

        <button
          type="button"
          aria-label="搜索"
          onClick={() => navigate('/search')}
          className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
        >
          <i className="ri-search-line text-[20px]" aria-hidden />
        </button>

        <button
          type="button"
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          onClick={toggleTheme}
          className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
        >
          <i className={`${theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'} text-[20px]`} aria-hidden />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="用户菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold"
            style={{ background: 'var(--color-accent)', color: '#FFFFFF' }}
          >
            {username.slice(0, 1).toUpperCase()}
          </button>

          {menuOpen && (
            <GlassPanel
              className="absolute right-0 top-11 w-44 overflow-hidden p-1 shadow-md"
              style={{ zIndex: 50 }}
              bordered
            >
              <p className="truncate px-3 py-2 type-caption text-txt-tertiary">{username}</p>
              <Link
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[40px] items-center gap-2 rounded-sm px-3 text-body text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
              >
                <i className="ri-settings-4-line" aria-hidden /> 设置
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="flex min-h-[40px] w-full items-center gap-2 rounded-sm px-3 text-left text-body text-danger"
              >
                <i className="ri-logout-box-r-line" aria-hidden /> 退出登录
              </button>
            </GlassPanel>
          )}
        </div>
      </GlassPanel>
    </header>
  );
}
