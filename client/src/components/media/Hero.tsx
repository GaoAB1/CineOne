/**
 * 首页 Apple TV 风格精选区：背景底图模糊铺满，前景是横向滚动海报与半透明信息面板。
 * 滚动海报轨道使用 scroll-snap，点击海报切换当前精选，点击信息区进入详情。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import RatingCapsule from './RatingCapsule';

interface HeroProps {
  items: MediaItem[];
}

function metaLine(item: MediaItem): string {
  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : '';
  const kind = item.mediaType === 'tv' ? '剧集' : '电影';
  return year ? `${year} · ${kind}` : kind;
}

function posterUrlOf(item: MediaItem): string | undefined {
  return item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : undefined;
}

function backdropUrlOf(item: MediaItem): string | undefined {
  return item.backdropPath ? `https://image.tmdb.org/t/p/w1280${item.backdropPath}` : undefined;
}

export default function Hero({ items }: HeroProps) {
  const candidates = useMemo(
    () => items.filter((item) => item.posterPath || item.backdropPath),
    [items],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const activeItem = candidates[activeIndex] ?? candidates[0];

  useEffect(() => {
    if (activeIndex >= candidates.length && candidates.length > 0) setActiveIndex(0);
  }, [activeIndex, candidates.length]);

  if (!activeItem || candidates.length === 0) return null;

  const activeBackdrop = backdropUrlOf(activeItem);
  const activePoster = posterUrlOf(activeItem);
  const detailsHref = `/detail/${activeItem.mediaType}/${activeItem.tmdbId}`;

  const selectItem = (index: number): void => {
    setActiveIndex(index);
    trackRef.current?.children[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  return (
    <section
      className="relative mb-8 overflow-hidden border border-white/10 shadow-lg"
      style={{ borderRadius: 'var(--radius-lg)', isolation: 'isolate' }}
      aria-label="精选影视"
    >
      {activeBackdrop ? (
        <img
          key={activeBackdrop}
          src={activeBackdrop}
          alt=""
          aria-hidden
          className="absolute inset-[-5%] h-[110%] w-[110%] object-cover blur-2xl"
          style={{ opacity: 0.58, transform: 'scale(1.05)' }}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'var(--color-bg-secondary)' }} />
      )}
      <div className="absolute inset-0 bg-black/45" aria-hidden />
      <div
        className="relative flex min-h-[600px] flex-col justify-between gap-6 p-4 sm:min-h-[520px] sm:p-6 md:min-h-[500px] md:p-8"
        style={{ background: 'rgba(10, 10, 12, 0.18)' }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center md:justify-start">
          <Link
            to={detailsHref}
            className="group relative block w-[min(62vw,260px)] shrink-0 overflow-hidden border border-white/30 shadow-lg transition-transform duration-base ease-out hover:-translate-y-1 md:ml-[5%] md:w-[250px]"
            style={{ borderRadius: 'var(--radius-card)', aspectRatio: '2 / 3', background: 'rgba(255,255,255,0.08)' }}
            aria-label={`查看《${activeItem.title}》详情`}
          >
            {activePoster ? (
              <img
                src={activePoster}
                alt={`${activeItem.title} 海报`}
                className="h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-white/80">{activeItem.title}</div>
            )}
          </Link>
        </div>

        <div
          className="relative overflow-hidden border border-white/20 p-5 text-white shadow-lg backdrop-blur-xl backdrop-saturate-150 sm:p-6 md:max-w-[760px] md:p-7"
          style={{ borderRadius: 'var(--radius-card)', background: 'rgba(12, 12, 16, 0.48)' }}
        >
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/70">
            <span>{metaLine(activeItem)}</span>
            <span aria-hidden>·</span>
            <RatingCapsule score={activeItem.voteAverage} />
          </div>
          <h1 className="mt-2 line-clamp-2 text-[28px] font-semibold leading-tight tracking-[-0.01em] text-white sm:text-[34px]">
            {activeItem.title}
          </h1>
          <p className="mt-3 line-clamp-3 text-[14px] leading-7 text-white/[.78] sm:text-[15px]">
            {activeItem.overview || '暂无简介'}
          </p>
          <Link
            to={detailsHref}
            className="press-spring mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm bg-accent px-4 text-[15px] font-medium text-white transition-[background-color] duration-fast ease-out hover:bg-[color:color-mix(in_srgb,var(--color-accent)_88%,_black)]"
          >
            查看详情
            <i className="ri-arrow-right-s-line text-[18px]" aria-hidden />
          </Link>
        </div>

        <div
          ref={trackRef}
          className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 pt-1"
          aria-label="精选海报列表"
          onScroll={(event) => {
            const track = event.currentTarget;
            const first = track.firstElementChild as HTMLElement | null;
            if (!first) return;
            const step = first.offsetWidth + 12;
            const nextIndex = Math.round(track.scrollLeft / step);
            if (nextIndex !== activeIndex && nextIndex >= 0 && nextIndex < candidates.length) {
              setActiveIndex(nextIndex);
            }
          }}
        >
          {candidates.map((item, index) => {
            const poster = posterUrlOf(item);
            const selected = index === activeIndex;
            return (
              <button
                key={`${item.mediaType}-${item.tmdbId}`}
                type="button"
                className="group relative w-[76px] shrink-0 snap-start overflow-hidden border transition-[border-color,opacity,transform] duration-fast ease-out hover:-translate-y-0.5 sm:w-[88px]"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  aspectRatio: '2 / 3',
                  borderColor: selected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.22)',
                  opacity: selected ? 1 : 0.7,
                  background: 'rgba(255,255,255,0.08)',
                }}
                aria-label={`选择《${item.title}》`}
                aria-pressed={selected}
                onClick={() => selectItem(index)}
              >
                {poster ? (
                  <img src={poster} alt="" className="h-full w-full object-cover" loading={index < 3 ? 'eager' : 'lazy'} />
                ) : (
                  <span className="flex h-full items-center justify-center px-1 text-[11px] leading-tight text-white/80">{item.title}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
