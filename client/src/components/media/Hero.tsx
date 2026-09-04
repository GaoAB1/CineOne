/**
 * 首页 Hero —— 规范 V2.0 电影级沉浸 Banner（自动轮播 + 自然过渡版）：
 * · 全视口出血（100vw 突破内容 max-w 与页边距），背景图左/右/上三向超出血铺满、
 *   底部经 hero-gradient-overlay 渐出融入列表
 * · 背景过渡：旧图淡出 + 新图 zoom-settle 淡入（crossfade），前景信息错峰浮现
 * · 左下信息区：琥珀 TMDB 评分徽章 / 年份类型、标题、梗概、纯白 CTA
 * · 右侧大海报（桌面）仅展示当前条目
 * · 每 6s 自动轮播（hover 暂停），左右箭头 + 紫光进度点手动切换
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '../../api/types';
import Button from '../ui/Button';
import RatingBadge from '../ui/RatingBadge';

const AUTOPLAY_MS = 6000;

interface HeroProps {
  items: MediaItem[];
}

/** 背景图定位：四向超出血（左右上溢出容器，底部贴齐交给渐出） */
const BG_STYLE: CSSProperties = {
  position: 'absolute',
  left: '-14%',
  right: '-14%',
  top: '-12%',
  bottom: 0,
  width: '128%',
  height: '112%',
};

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
  const [paused, setPaused] = useState(false);
  const activeItem = candidates[activeIndex] ?? candidates[0];
  const activeBackdrop = activeItem ? backdropUrlOf(activeItem) : undefined;

  // 上一张背景：轮播切换时与当前图交叉淡化
  const lastBackdropRef = useRef<string | undefined>(undefined);
  const [prevBackdrop, setPrevBackdrop] = useState<string | null>(null);

  useEffect(() => {
    if (candidates.length === 0) return;
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [activeIndex, candidates.length]);

  // 自动轮播：hover / focus 暂停
  useEffect(() => {
    if (paused || candidates.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % candidates.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [paused, candidates.length]);

  // 记录旧背景并让其淡出，淡出完成后移除节点
  useEffect(() => {
    if (activeBackdrop && lastBackdropRef.current !== activeBackdrop) {
      if (lastBackdropRef.current) setPrevBackdrop(lastBackdropRef.current);
      lastBackdropRef.current = activeBackdrop;
    }
  }, [activeBackdrop]);

  useEffect(() => {
    if (!prevBackdrop) return;
    const timer = window.setTimeout(() => setPrevBackdrop(null), 620);
    return () => window.clearTimeout(timer);
  }, [prevBackdrop]);

  if (!activeItem || candidates.length === 0) return null;

  const activePoster = posterUrlOf(activeItem);
  const detailsHref = `/detail/${activeItem.mediaType}/${activeItem.tmdbId}`;

  const goTo = (index: number): void => {
    setActiveIndex(((index % candidates.length) + candidates.length) % candidates.length);
  };

  const handleMouseEnter = (): void => setPaused(true);
  const handleMouseLeave = (): void => setPaused(false);

  return (
    <section
      className="relative mb-10 -mt-2 overflow-hidden md:mb-12 lg:-mt-4"
      style={{ width: '100vw', marginLeft: 'calc(50% - 50vw)', isolation: 'isolate' }}
      aria-label="精选影视"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 场景大图（crossfade 双图）：旧图淡出、新图 zoom-settle 淡入 */}
      {prevBackdrop && (
        <img
          key={`leave-${prevBackdrop}`}
          src={prevBackdrop}
          alt=""
          aria-hidden
          className="hero-bg-leave object-cover"
          style={BG_STYLE}
        />
      )}
      {activeBackdrop ? (
        <img
          key={`enter-${activeBackdrop}`}
          src={activeBackdrop}
          alt=""
          aria-hidden
          className="hero-bg-enter object-cover"
          style={BG_STYLE}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'var(--color-bg-secondary)' }} />
      )}

      {/* 顶部轻微压暗 + 左侧文本可读渐变 + 底部渐出（浅色主题用同调暗化保证白色文字） */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(180deg, rgba(8,6,16,0.28) 0%, rgba(8,6,16,0.05) 18%, transparent 40%), linear-gradient(90deg, rgba(8,6,16,0.82) 0%, rgba(8,6,16,0.42) 44%, rgba(8,6,16,0.06) 78%, transparent 100%)',
        }}
      />
      <div className="hero-gradient-overlay absolute inset-0" aria-hidden />

      {/* 主体内容 */}
      <div className="relative mx-auto flex min-h-[640px] max-w-[1200px] flex-col justify-center gap-8 px-[var(--margin-page)] py-12 md:min-h-[70vh] md:py-14">
        <div className="flex items-center justify-between gap-12">
          {/* 左信息区（背景落定后错峰浮现） */}
          <div key={activeItem.tmdbId} className="hero-panel-enter max-w-[680px] text-white">
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

            {/* 轮播控制：左右箭头 + 进度点 */}
            <div className="mt-9 flex items-center gap-3">
              <button
                type="button"
                aria-label="上一个精选"
                onClick={() => goTo(activeIndex - 1)}
                className="press-spring flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white transition-colors duration-fast ease-out hover:bg-white/15"
                style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(10px)' }}
              >
                <i className="ri-arrow-left-s-line text-[20px]" aria-hidden />
              </button>
              <div className="flex items-center gap-2" role="tablist" aria-label="精选位置">
                {candidates.map((item, index) => (
                  <button
                    key={`${item.mediaType}-${item.tmdbId}`}
                    type="button"
                    role="tab"
                    aria-selected={index === activeIndex}
                    aria-label={`第 ${index + 1} 个精选：${item.title}`}
                    onClick={() => goTo(index)}
                    className="press-spring h-2 rounded-pill transition-all duration-base ease-out"
                    style={{
                      width: index === activeIndex ? 22 : 8,
                      background:
                        index === activeIndex
                          ? 'var(--color-glow)'
                          : 'rgba(255,255,255,0.35)',
                      boxShadow:
                        index === activeIndex
                          ? '0 0 12px color-mix(in srgb, var(--color-glow) 70%, transparent)'
                          : 'none',
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label="下一个精选"
                onClick={() => goTo(activeIndex + 1)}
                className="press-spring flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white transition-colors duration-fast ease-out hover:bg-white/15"
                style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(10px)' }}
              >
                <i className="ri-arrow-right-s-line text-[20px]" aria-hidden />
              </button>
            </div>
          </div>

          {/* 右大海报（桌面，仅当前条目） */}
          {activePoster && (
            <Link
              key={activePoster}
              to={detailsHref}
              className="hero-panel-enter group relative hidden shrink-0 overflow-hidden ring-1 ring-white/25 md:block"
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
      </div>
    </section>
  );
}
