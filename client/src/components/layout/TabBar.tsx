/**
 * 窄屏底部 Tab 栏（fill 图标，毛玻璃，安全区适配）。
 */

import { NavLink } from 'react-router-dom';
import GlassPanel from '../ui/GlassPanel';

const TAB_ITEMS = [
  { to: '/', label: '首页', iconLine: 'ri-home-5-line', iconFill: 'ri-home-5-fill' },
  { to: '/watchlist', label: '追剧', iconLine: 'ri-tv-2-line', iconFill: 'ri-tv-2-fill' },
  { to: '/search', label: '搜索', iconLine: 'ri-search-line', iconFill: 'ri-search-fill' },
  { to: '/settings', label: '设置', iconLine: 'ri-settings-4-line', iconFill: 'ri-settings-4-fill' },
];

export default function TabBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <GlassPanel className="mx-3 mb-3 flex items-stretch justify-around p-1" bordered>
        {TAB_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-sm py-1.5 transition-colors duration-fast ease-out ${
                isActive ? '' : 'text-txt-secondary'
              }`
            }
            style={({ isActive }) => (isActive ? { color: 'var(--color-accent)' } : undefined)}
          >
            {({ isActive }) => (
              <>
                <i className={`${isActive ? item.iconFill : item.iconLine} text-[22px]`} aria-hidden />
                <span className="text-[10px] leading-none">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </GlassPanel>
    </div>
  );
}
