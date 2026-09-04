/**
 * 首页 Hero —— 规范 V2.0 电影级沉浸 Banner：
 * · 全宽出血（负 margin 突破页边距），占首屏 65~70vh
 * · 高清场景大图 + 左测渐变压暗，底部 hero-gradient-overlay 融入列表
 * · 左下信息区：评分徽章（琥珀金）/ 年份类型、艺术字标题、一句话梗概、纯白 CTA
 * · 右侧大海报（桌面），底部横向滚动海报轨道驱动切换
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import Button from '../ui/Button';
import RatingBadge from '../ui/RatingBadge';

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
      className="relative mb-10 overflow-hidden -mx-[var(--margin-page)] md:mb-12"
      style={{ isolation: 'isolate' }}
      aria-label="精选影视"
    >
      {/* 场景大图（backdrop） */}
      {activeBackdrop ? (
        <img
          key={activeBackdrop}
          src={activeBackdrop}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'var(--color-bg-secondary)' }} />
      )}

      {/* 顶部轻微压暗 + 左侧文本可读渐变 + 底部融入渐变 */}
      <div className="absolute inset-0 bg-black/30" aria-hidden />
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(90deg, rgba(11,9,20,0.82) 0%, rgba(11,9,20,0.45) 42%, rgba(11,9,20,0.08) 74%, transparent 100%)',
        }}
      />
      <div className="hero-gradient-overlay absolute inset-0" aria-hidden />

      {/* 主体内容 */}
      <div className="relative mx-auto flex min-h-[640px] max-w-[1200px] flex-col justify-between gap-10 px-[var(--margin-page)] py-8 md:min-h-[70vh] md:py-10">
        <div className="flex items-end justify-between gap-12 pt-6 md:pt-8">
          {/* 左信息区 */}
          <div className="max-w-[680px] text-white">
            <div className="flex flex-wrap items-center gap-2.5">
              <RatingBadge source="tmdb" tmdbScore={activeItem.voteAverage} />
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-white/20 px-3 text-[13px] font-medium text-white/85"
                style={{ background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(10px)' }}
              >
                {metaLine(activeItem)}
              </span>
            </div>

            <h1 className="mt-5 line-clamp-2 text-[34px] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[46px] lg:text-[58px]">
              {activeItem.title}
            </h1>

            <p className="mt-4 max-w-[560px] line-clamp-3 text-[15px] leading-7 text-white/80 sm:text-base">
              {activeItem.overview || '暂无简介'}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to={detailsHref} aria-label={`查看《${activeItem.title}》详情`}>
                <Button variant="hero" icon={<i className="ri-play-fill text-[20px]" aria-hidden />}>
                  立即查看
                </Button>
              </Link>
              <Link
                to={detailsHref}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-white/25 px-5 text-[15px] font-medium text-white transition-colors duration-fast ease-out hover:bg-white/10"
                style={{ backdropFilter: 'blur(10px)' }}
              >
                更多信息
                <i className="ri-arrow-right-s-line text-[18px]" aria-hidden />
              </Link>
            </div>
          </div>

          {/* 右大海报（桌面） */}
          {activePoster && (
            <Link
              to={detailsHref}
              className="group relative hidden shrink-0 overflow-hidden ring-1 ring-white/25 md:block"
              style={{
                width: 'clamp(190px, 19vw, 280px)',
                borderRadius: 'var(--radius-card)',
                aspectRatio: '2 / 3',
                boxShadow:
                  '0 30px 70px rgba(0,0,0,0.55), 0 0 46px color-mix(in srgb, var(--color-glow) 26%, transparent)',
              }}
              aria-label={`查看《${activeItem.title}》详情`}
            >
              <img
                src={activePoster}
                alt={`${activeItem.title} 海报`}
                className="h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-[1.04]"
              />
            </Link>
          )}
        </div>

        {/* 底部海报选择轨道 */}
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
                className="group relative w-[78px] shrink-0 snap-start overflow-hidden border transition-[border-color,box-shadow,opacity,transform] duration-fast ease-out hover:-translate-y-1 sm:w-[92px]"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  aspectRatio: '2 / 3',
                  borderColor: selected ? 'var(--color-glow)' : 'rgba(255,255,255,0.22)',
                  boxShadow: selected
                    ? '0 0 20px color-mix(in srgb, var(--color-glow) 45%, transparent)'
                    : 'none',
                  opacity: selected ? 1 : 0.68,
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
