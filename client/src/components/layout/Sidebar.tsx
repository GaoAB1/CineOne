/**
 * 桌面端侧边导航（首页/追剧/搜索/设置 + 登出）。
 */

import { NavLink } from 'react-router-dom';
import GlassPanel from '../ui/GlassPanel';

interface SidebarProps {
  username: string;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { to: '/', label: '首页', iconLine: 'ri-home-5-line', iconFill: 'ri-home-5-fill' },
  { to: '/watchlist', label: '追剧', iconLine: 'ri-tv-2-line', iconFill: 'ri-tv-2-fill' },
  { to: '/search', label: '搜索', iconLine: 'ri-search-line', iconFill: 'ri-search-fill' },
  { to: '/settings', label: '设置', iconLine: 'ri-settings-4-line', iconFill: 'ri-settings-4-fill' },
];

export default function Sidebar({ username, onLogout }: SidebarProps) {
  return (
    <aside className="hidden h-screen w-[232px] shrink-0 p-4 md:block">
      <GlassPanel className="flex h-full flex-col p-4" bordered>
        <div className="flex items-center gap-2 px-2 pb-6 pt-2">
          <i className="ri-film-fill text-[24px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <span className="type-headline">CineOne</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `press-spring flex min-h-[44px] items-center gap-3 rounded-sm px-3 text-body transition-colors duration-fast ease-out ${
                  isActive ? 'font-semibold' : 'text-txt-secondary hover:bg-warm hover:text-txt-primary'
                }`
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                      color: 'var(--color-accent)',
                      borderRadius: 'var(--radius-sm)',
                    }
                  : undefined
              }
            >
              {({ isActive }) => (
                <>
                  <i className={`${isActive ? item.iconFill : item.iconLine} text-[20px]`} aria-hidden />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
              style={{ background: 'var(--color-accent)', color: '#FFFFFF' }}
              aria-hidden
            >
              {username.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[15px] text-txt-secondary">{username}</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="退出登录"
            className="press-spring flex h-8 w-8 items-center justify-center rounded-full text-txt-secondary transition-colors duration-fast ease-out hover:text-danger"
          >
            <i className="ri-logout-box-r-line text-[20px]" aria-hidden />
          </button>
        </div>
      </GlassPanel>
    </aside>
  );
}
