/**
 * 分区横向滚动卡片流（标题 + 更多入口）。
 */

import type { ReactNode } from 'react';
import type { MediaItem } from '../../api/types';
import MediaCard from './MediaCard';
import Spinner from '../ui/Spinner';

interface MediaRowProps {
  title: string;
  items?: MediaItem[];
  loading?: boolean;
  /** 右侧"更多"等入口 */
  action?: ReactNode;
}

export default function MediaRow({ title, items, loading = false, action }: MediaRowProps) {
  return (
    <section className="mb-6">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="type-headline">{title}</h2>
        {action}
      </header>

      {loading ? (
        <Spinner label={`正在加载「${title}」`} />
      ) : !items || items.length === 0 ? (
        <p className="type-body py-4 text-txt-tertiary">暂无内容</p>
      ) : (
        <div
          className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2"
          style={{ gap: 'var(--gap-card)' }}
        >
          {items.map((item) => (
            <MediaCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
