/**
 * PC 桌面端悬浮 Icon Dock（规范 · 沉浸式 Icon Dock 栏）。
 * 左侧竖向悬浮毛玻璃胶囊：品牌标识 + 四个导航页签（首页/媒体库/追剧/搜索）
 * + 底部用户头像菜单（设置/主题/退出）。激活页签呈霓虹紫透镜 + 微光晕。
 * 仅 ≥1024px 显示；移动端使用底部 Dock（TabBar）。
 */

import { NavLink } from 'react-router-dom';
import UserDockItem from './UserDockItem';

const NAV_ITEMS = [
  { to: '/', label: '首页', iconLine: 'ri-home-5-line', iconFill: 'ri-home-5-fill' },
  { to: '/library', label: '媒体库', iconLine: 'ri-film-line', iconFill: 'ri-film-fill' },
  { to: '/watchlist', label: '追剧', iconLine: 'ri-tv-2-line', iconFill: 'ri-tv-2-fill' },
  { to: '/search', label: '搜索', iconLine: 'ri-search-line', iconFill: 'ri-search-fill' },
];

export default function SideDock() {
  return (
    <div className="fixed left-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
      <nav
        aria-label="主导航"
        className="glass flex flex-col items-center gap-1.5 rounded-pill shadow-lg"
        style={{ padding: '10px 8px', border: '1px solid var(--border-light)' }}
      >
        {/* 品牌标识 */}
        <span
          className="mb-1 flex h-10 w-10 items-center justify-center rounded-2xl"
          aria-hidden
          style={{ color: 'var(--color-glow)' }}
        >
          <i className="ri-film-fill text-[22px]" />
        </span>

        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) =>
              `press-spring flex h-[52px] w-[52px] items-center justify-center rounded-2xl transition-colors duration-fast ease-out ${
                isActive ? '' : 'text-txt-secondary hover:text-txt-primary hover:bg-warm'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'color-mix(in srgb, var(--color-glow) 16%, transparent)',
                    color: 'var(--color-glow)',
                    boxShadow: '0 0 18px color-mix(in srgb, var(--color-glow) 35%, transparent)',
                  }
                : undefined
            }
          >
            {({ isActive }) => (
              <i className={`${isActive ? item.iconFill : item.iconLine} text-[24px]`} aria-hidden />
            )}
          </NavLink>
        ))}

        {/* Dock 分隔 + 用户头像 */}
        <div className="my-1" style={{ width: 28, height: 1, background: 'var(--border-light)' }} />
        <UserDockItem menuClassName="left-full top-0 ml-3" />
      </nav>
    </div>
  );
}
