/**
 * 分区卡片流（§4.3 响应式策略）：
 * < lg 横滑 + scroll-snap 吸附；≥ lg 转网格墙（lg 4 列 / xl 5 列 / 2xl 6 列），
 * 桌面端每分区最多渲染 10 条，超出交给「更多」入口。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import MediaCard from './MediaCard';

const DESKTOP_MAX_ITEMS = 10;

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent): void => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

interface MediaRowProps {
  title: string;
  items?: MediaItem[];
  loading?: boolean;
  /** 右侧自定义入口；不传且条目超限时自动渲染「更多」 */
  action?: ReactNode;
}

export default function MediaRow({ title, items, loading = false, action }: MediaRowProps) {
  const isDesktop = useIsDesktop();

  if (loading) return null; // 骨架屏由页面层统一渲染

  const list = items ?? [];
  const shown = isDesktop && list.length > DESKTOP_MAX_ITEMS ? list.slice(0, DESKTOP_MAX_ITEMS) : list;
  const hasMore = !action && list.length > DESKTOP_MAX_ITEMS;

  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="type-headline">{title}</h2>
        {action ?? (hasMore ? (
          <Link
            to="/search"
            className="inline-flex min-h-[36px] items-center gap-0.5 text-[14px] text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
          >
            更多
            <i className="ri-arrow-right-s-line text-[20px]" aria-hidden />
          </Link>
        ) : null)}
      </header>

      {list.length === 0 ? (
        <p className="type-body py-4 text-txt-tertiary">暂无内容</p>
      ) : (
        <div
          className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-5 2xl:grid-cols-6"
        >
          {shown.map((item) => (
            <MediaCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
