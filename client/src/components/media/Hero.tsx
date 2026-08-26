/**
 * 首页 Hero 精选区（§4.1）：取每周热门第 1 项的 backdrop 大图，
 * 双层遮罩 + 左下角标题/元信息/评分胶囊/查看详情按钮，整图可点。
 */

import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import RatingCapsule from './RatingCapsule';

interface HeroProps {
  item: MediaItem;
}

function metaLine(item: MediaItem): string {
  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : '';
  const kind = item.mediaType === 'tv' ? '剧集' : '电影';
  return year ? `${year} · ${kind}` : kind;
}

export default function Hero({ item }: HeroProps) {
  if (!item.backdropPath) return null;

  const href = `/detail/${item.mediaType}/${item.tmdbId}`;
  const backdropUrl = `https://image.tmdb.org/t/p/w1280${item.backdropPath}`;

  return (
    <section
      className="relative mb-6 overflow-hidden shadow-md"
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      <div
        className="aspect-[3/4] max-h-[520px] md:aspect-[21/9] xl:max-h-[480px]"
        style={{ background: 'var(--color-bg-secondary)' }}
      >
        <img
          src={backdropUrl}
          alt=""
          aria-hidden
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>

      {/* 压暗层 */}
      <div className="absolute inset-0" style={{ background: 'var(--scrim-hero-dim)' }} aria-hidden />
      {/* 底部渐变遮罩 */}
      <div
        className="absolute inset-x-0 bottom-0 h-[70%]"
        style={{ background: 'var(--scrim-hero)' }}
        aria-hidden
      />

      {/* 整图可点区域 */}
      <Link
        to={href}
        aria-label={`查看《${item.title}》详情`}
        className="absolute inset-0 z-10 rounded-lg"
      />

      {/* 左下角文字层 */}
      <div className="absolute bottom-0 left-0 z-20 p-5 md:p-7">
        <h2
          className="type-large-title leading-tight text-white"
          style={{ textShadow: '0 2px 8px rgba(0, 0, 0, 0.35)' }}
        >
          {item.title}
        </h2>
        <p
          className="mt-1.5 text-[13px]"
          style={{ color: 'color-mix(in srgb, #FFFFFF 80%, transparent)' }}
        >
          {metaLine(item)}
        </p>
        <div className="mt-2.5 flex items-center gap-3">
          <RatingCapsule score={item.voteAverage} />
          <Link
            to={href}
            className="press-spring inline-flex min-h-[44px] items-center gap-1.5 rounded-sm bg-accent px-4 text-[15px] font-medium text-white transition-[background-color] duration-fast ease-out hover:bg-[color:color-mix(in_srgb,var(--color-accent)_88%,_black)]"
          >
            查看详情
            <i className="ri-arrow-right-s-line text-[18px]" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
