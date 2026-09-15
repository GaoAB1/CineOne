/**
 * 底部居中悬浮 Dock 导航（移动 / 平板；桌面端由 SideDock 接管）。
 * 首页 / 媒体库 / 追剧 / 下载 / 115 / 搜索 + 用户头像菜单；激活页签用霓虹紫透镜胶囊。
 *
 * 宽度自适应：容器放得下时全部显示；放不下时把放不下的尾部项折叠进
 * 「更多」弹层（向上弹出面板），点击可跳转。首次全量渲染以缓存各项宽度，
 * 之后按缓存值计算折叠数，避免「折叠→重渲染→宽度变化→再折叠」的循环。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import UserDockItem from './UserDockItem';

const NAV_ITEMS = [
  { to: '/', label: '首页', iconLine: 'ri-home-5-line', iconFill: 'ri-home-5-fill' },
  { to: '/library', label: '媒体库', iconLine: 'ri-film-line', iconFill: 'ri-film-fill' },
  { to: '/watchlist', label: '追剧', iconLine: 'ri-tv-2-line', iconFill: 'ri-tv-2-fill' },
  { to: '/downloads', label: '下载', iconLine: 'ri-download-2-line', iconFill: 'ri-download-2-fill' },
  { to: '/pan115', label: '115', iconLine: 'ri-cloud-line', iconFill: 'ri-cloud-fill' },
  { to: '/renamer', label: '重命名', iconLine: 'ri-input-cursor-move', iconFill: 'ri-input-cursor-move' },
  { to: '/search', label: '搜索', iconLine: 'ri-search-line', iconFill: 'ri-search-fill' },
];

/** 布局常量（与 JSX 保持同步） */
const GAP = 4;
const NAV_PADDING_X = 8 * 2;
const USER_BTN_W = 52;
const MORE_BTN_W = 54;
const ITEM_FALLBACK_W = 54;

export default function TabBar() {
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const widthCache = useRef<Map<string, number>>(new Map());
  const [overflow, setOverflow] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  const measure = useCallback(() => {
    // 基准用视口宽（nav 外层 margin 16px×2 + 自身 padding 8px×2），
    // 不用 nav.clientWidth —— 它会随折叠收缩，造成「折叠→变窄→再折叠」的发散循环
    if (typeof window === 'undefined') return;
    const contentWidth = window.innerWidth - 32 - NAV_PADDING_X;
    if (contentWidth <= 0) return;
    const fixed = USER_BTN_W + GAP;

    // 首次全量渲染时缓存各 item 实际宽度
    for (const item of NAV_ITEMS) {
      const el = itemRefs.current.get(item.to);
      if (el) widthCache.current.set(item.to, el.offsetWidth);
    }

    const widths = NAV_ITEMS.map((item) => widthCache.current.get(item.to) ?? ITEM_FALLBACK_W);
    const total = widths.reduce((sum, w) => sum + w + GAP, 0) - GAP;

    if (total <= contentWidth - fixed) {
      setOverflow([]);
      return;
    }

    // 放不下：预留「更多」按钮，从头累加，放不下的进弹层
    const avail = contentWidth - fixed - (MORE_BTN_W + GAP);
    const next: string[] = [];
    let acc = 0;
    NAV_ITEMS.forEach((item, index) => {
      const w = widths[index];
      if (acc + w <= avail) acc += w + GAP;
      else next.push(item.to);
    });
    setOverflow(next);
  }, []);

  // 首渲染（全量）后测量并折叠；之后监听 resize 重新计算
  useLayoutEffect(() => {
    measure();
    // 图标字体加载完成会改变图标宽度，补测一次
    if (document.fonts?.ready) void document.fonts.ready.then(() => measure());
  }, [measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  // 路由变化时收起「更多」面板
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const visibleItems = NAV_ITEMS.filter((item) => !overflow.includes(item.to));
  const overflowItems = NAV_ITEMS.filter((item) => overflow.includes(item.to));

  const renderNavLink = (item: (typeof NAV_ITEMS)[number], inPanel: boolean) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={() => inPanel && setMoreOpen(false)}
      ref={
        inPanel
          ? undefined
          : (el: HTMLAnchorElement | null) => {
              if (el) itemRefs.current.set(item.to, el);
              else itemRefs.current.delete(item.to);
            }
      }
      className={({ isActive }) =>
        inPanel
          ? `press-spring flex min-h-[48px] items-center gap-3 rounded-[14px] px-4 text-[14px] transition-colors duration-fast ease-out ${
              isActive ? '' : 'text-txt-secondary hover:text-txt-primary'
            }`
          : `press-spring flex min-h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-pill px-2 transition-colors duration-fast ease-out ${
              isActive ? '' : 'text-txt-secondary hover:text-txt-primary'
            }`
      }
      style={({ isActive }) =>
        isActive
          ? {
              background: 'color-mix(in srgb, var(--color-glow) 15%, transparent)',
              color: 'var(--color-glow)',
            }
          : undefined
      }
    >
      {({ isActive }) => (
        <>
          <i
            className={`${isActive ? item.iconFill : item.iconLine} ${inPanel ? 'text-[20px]' : 'text-[22px]'}`}
            aria-hidden
          />
          <span className={inPanel ? '' : 'text-[10px] leading-none'}>{item.label}</span>
        </>
      )}
    </NavLink>
  );

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center lg:hidden">
        <nav
          aria-label="主导航"
          className="glass pointer-events-auto relative flex items-center gap-1 rounded-pill shadow-lg"
          style={{
            margin: '0 16px',
            marginBottom: 'calc(12px + env(safe-area-inset-bottom))',
            padding: '6px 8px',
            border: '1px solid var(--border-light)',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          {visibleItems.map((item) => renderNavLink(item, false))}

          {overflowItems.length > 0 && (
            <>
              <button
                type="button"
                aria-label="更多导航"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className={`press-spring flex min-h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-pill px-2 transition-colors duration-fast ease-out ${
                  moreOpen ? '' : 'text-txt-secondary hover:text-txt-primary'
                }`}
                style={
                  moreOpen
                    ? {
                        background: 'color-mix(in srgb, var(--color-glow) 15%, transparent)',
                        color: 'var(--color-glow)',
                      }
                    : undefined
                }
              >
                <i className={`${moreOpen ? 'ri-more-fill' : 'ri-more-line'} text-[22px]`} aria-hidden />
                <span className="text-[10px] leading-none">更多</span>
              </button>

              {moreOpen && (
                <div
                  role="menu"
                  aria-label="更多导航"
                  className="glass pointer-events-auto absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 flex-col gap-1 rounded-[18px] p-2 shadow-xl"
                  style={{
                    minWidth: 180,
                    border: '1px solid var(--border-light)',
                  }}
                >
                  {overflowItems.map((item) => renderNavLink(item, true))}
                </div>
              )}
            </>
          )}

          <UserDockItem
            wrapperClassName="min-h-[52px] min-w-[52px]"
            menuClassName="bottom-full left-1/2 mb-3 -translate-x-1/2"
          />
        </nav>
      </div>
    </>
  );
}
