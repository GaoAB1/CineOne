/**
 * 底部居中悬浮 Dock 导航（Apple 液态玻璃，全断点统一）。
 * 玻璃材质只用于这层真正悬浮在内容之上的容器；激活页签用 accent 14% 透镜胶囊。
 * 用户菜单/主题切换/登出在 TopBar，Dock 只承担页面导航。
 */

import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: '首页', iconLine: 'ri-home-5-line', iconFill: 'ri-home-5-fill' },
  { to: '/library', label: '媒体库', iconLine: 'ri-film-line', iconFill: 'ri-film-fill' },
  { to: '/watchlist', label: '追剧', iconLine: 'ri-tv-2-line', iconFill: 'ri-tv-2-fill' },
  { to: '/search', label: '搜索', iconLine: 'ri-search-line', iconFill: 'ri-search-fill' },
  { to: '/settings', label: '设置', iconLine: 'ri-settings-4-line', iconFill: 'ri-settings-4-fill' },
];

export default function TabBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <nav
        aria-label="主导航"
        className="glass pointer-events-auto flex items-center gap-1 rounded-pill shadow-lg"
        style={{
          margin: '0 16px',
          marginBottom: 'calc(12px + env(safe-area-inset-bottom))',
          padding: '6px',
          border: '1px solid var(--border-light)',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `press-spring flex min-h-[52px] min-w-[68px] flex-col items-center justify-center gap-0.5 rounded-pill px-3 transition-colors duration-fast ease-out ${
                isActive ? '' : 'text-txt-secondary hover:text-txt-primary'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                    color: 'var(--color-accent)',
                  }
                : undefined
            }
          >
            {({ isActive }) => (
              <>
                <i
                  className={`${isActive ? item.iconFill : item.iconLine} text-[22px]`}
                  aria-hidden
                />
                <span className="text-[10px] leading-none">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
