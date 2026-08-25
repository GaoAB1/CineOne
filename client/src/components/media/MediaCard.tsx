/**
 * 海报卡片：悬浮微缩放 + 标题年份。
 * 图片规则：w342 列表海报；无 posterPath 渲染 PosterFallback。
 */

import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import PosterFallback from './PosterFallback';

interface MediaCardProps {
  item: MediaItem;
}

function yearOf(item: MediaItem): string {
  if (!item.releaseDate) return '';
  return item.releaseDate.slice(0, 4);
}

export default function MediaCard({ item }: MediaCardProps) {
  const href = `/detail/${item.mediaType}/${item.tmdbId}`;
  const posterUrl = item.posterPath
    ? `https://image.tmdb.org/t/p/w342${item.posterPath}`
    : undefined;

  return (
    <Link to={href} className="group block w-[150px] shrink-0 focus:outline-none">
      <div
        className="hover-lift overflow-hidden shadow-sm"
        style={{ borderRadius: 'var(--radius-card)', aspectRatio: '2 / 3', background: 'var(--color-bg-secondary)' }}
      >
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={`${item.title} 海报`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-fast ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <PosterFallback title={item.title} />
        )}
      </div>
      <p className="mt-2 truncate text-[14px] font-medium text-txt-primary" title={item.title}>
        {item.title}
      </p>
      <p className="type-caption mt-0.5 flex items-center gap-1.5 text-txt-secondary">
        <span>{yearOf(item)}</span>
        {item.voteAverage != null && item.voteAverage > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5">
              <i className="ri-star-fill text-[11px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
              {item.voteAverage.toFixed(1)}
            </span>
          </>
        )}
      </p>
    </Link>
  );
}
