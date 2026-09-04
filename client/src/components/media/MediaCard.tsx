/**
 * 海报卡片（Forward 重塑版）：18px 圆角海报 + 左下角毛玻璃评分胶囊
 * + 标题年份两行。宽度：< md 128px / md–lg 148px / 网格模式自适应。
 */

import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import PosterFallback from './PosterFallback';
import RatingCapsule from './RatingCapsule';

interface MediaCardProps {
  item: MediaItem;
  /** 网格模式（搜索页结果网格等）：宽度交给父级格子撑满 */
  fill?: boolean;
}

function yearOf(item: MediaItem): string {
  if (!item.releaseDate) return '';
  return item.releaseDate.slice(0, 4);
}

export default function MediaCard({ item, fill = false }: MediaCardProps) {
  const href = `/detail/${item.mediaType}/${item.tmdbId}`;
  const posterUrl = item.posterPath
    ? `https://image.tmdb.org/t/p/w342${item.posterPath}`
    : undefined;

  return (
    <Link
      to={href}
      className={`group block rounded-card focus:outline-none focus-visible:shadow-[var(--focus-ring)] ${
        fill ? 'w-full' : 'w-[128px] shrink-0 snap-start md:w-[148px] lg:w-full'
      }`}
    >
      <div
        className="group relative overflow-hidden shadow-sm transition-[transform,box-shadow] duration-slow ease-[var(--ease-glow)] group-hover:-translate-y-2 group-hover:scale-[1.02] group-hover:shadow-[var(--glow-card-hover)]"
        style={{
          borderRadius: 'var(--radius-card)',
          aspectRatio: '2 / 3',
          background: 'var(--color-bg-secondary)',
        }}
      >
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={`${item.title} 海报`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-base ease-out group-hover:scale-105"
          />
        ) : (
          <PosterFallback title={item.title} />
        )}
        <RatingCapsule score={item.voteAverage} />
      </div>
      <p className="mt-2 truncate text-[14px] font-medium text-txt-primary" title={item.title}>
        {item.title}
      </p>
      <p className="type-caption mt-0.5 text-txt-secondary">{yearOf(item)}</p>
    </Link>
  );
}
