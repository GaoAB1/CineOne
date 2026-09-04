/**
 * 首页「流媒体平台」区块：分美区/国区两组横向轮滑。
 * 每平台一张 250×141（16:9）黑底小卡：左侧平台名 + 右侧 2~3 张海报错位探出；
 * 每组标题右侧提供 ◀ ▶ 滑动按钮，横向滚动查看更多平台。
 * 点击卡片进入 /providers/:region/:provider 平台片库页。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProviderRegions,
  type ProviderEntry,
  type ProviderRegionGroup,
  type ProviderSample,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';

const CARD_W = 250;
const CARD_GAP = 12;

/** 右半区海报堆叠布局（相对 141 高卡，探出边缘被容器裁切） */
const STACK_LAYOUTS: Array<{ top: number; right: number; rotate: number; width: number; z: number }> = [
  { top: -16, right: -18, rotate: -9, width: 92, z: 2 },
  { top: 6, right: -6, rotate: 4, width: 92, z: 3 },
  { top: 30, right: -28, rotate: -4, width: 92, z: 4 },
  { top: 48, right: -40, rotate: 9, width: 92, z: 5 },
];

function posterUrl(p: ProviderSample): string | null {
  return p.posterPath ? `https://image.tmdb.org/t/p/w185${p.posterPath}` : null;
}

function ProviderCard({ provider, regionKey }: { provider: ProviderEntry; regionKey: 'us' | 'cn' }) {
  const navigate = useNavigate();
  const posters = provider.samples.filter((s) => s.posterPath).slice(0, 4);

  return (
    <button
      type="button"
      onClick={() => navigate(`/providers/${regionKey}/${provider.key}`)}
      className="group relative w-[250px] shrink-0 snap-start overflow-hidden text-left transition-all duration-slow ease-[var(--ease-glow)] hover:-translate-y-1"
      style={{
        height: 141,
        borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, #101018 0%, #171225 100%)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.45)',
      }}
      aria-label={`浏览 ${provider.name} 片库`}
    >
      {/* 海报探出层 */}
      {posters.length > 0 && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {posters.map((sample, index) => {
            const layout = STACK_LAYOUTS[index % STACK_LAYOUTS.length];
            const src = posterUrl(sample);
            if (!src) return null;
            return (
              <span
                key={`${sample.mediaType}-${sample.tmdbId}`}
                className="absolute overflow-hidden"
                style={{
                  top: layout.top,
                  right: layout.right,
                  width: layout.width,
                  aspectRatio: '2 / 3',
                  borderRadius: 10,
                  transform: `rotate(${layout.rotate}deg)`,
                  zIndex: layout.z,
                  boxShadow: '0 10px 22px rgba(0,0,0,0.55)',
                }}
              >
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              </span>
            );
          })}
        </div>
      )}

      {/* 左缘压暗确保文字可读 */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(90deg, rgba(8,6,16,0.92) 0%, rgba(8,6,16,0.62) 34%, rgba(8,6,16,0.12) 62%, transparent 100%)',
        }}
      />

      {/* 文本 */}
      <div className="relative z-10 flex h-full flex-col justify-between p-3">
        <p className="type-caption font-semibold uppercase tracking-[0.14em] text-white/60">
          {regionKey === 'us' ? 'US' : 'CN'}
        </p>
        <div className="flex items-end justify-between gap-1">
          <h3
            className="line-clamp-2 font-black uppercase leading-none text-white"
            style={{
              letterSpacing: '-0.02em',
              fontSize: 20,
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            {provider.name}
          </h3>
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors duration-fast ease-out group-hover:bg-white/15"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            <i className="ri-arrow-right-s-line text-[16px]" aria-hidden />
          </span>
        </div>
      </div>
    </button>
  );
}

function RegionRow({ group }: { group: ProviderRegionGroup }) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollByCards = (delta: number): void => {
    trackRef.current?.scrollBy({ left: delta * (CARD_W + CARD_GAP), behavior: 'smooth' });
  };

  return (
    <div className="mb-7 last:mb-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="type-caption font-medium text-txt-tertiary">{group.label}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="上一组平台"
            onClick={() => scrollByCards(-1)}
            className="press-spring flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
          >
            <i className="ri-arrow-left-s-line text-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="下一组平台"
            onClick={() => scrollByCards(1)}
            className="press-spring flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
          >
            <i className="ri-arrow-right-s-line text-[18px]" aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2"
      >
        {group.providers.map((provider) => (
          <ProviderCard key={provider.key} provider={provider} regionKey={group.key} />
        ))}
      </div>
    </div>
  );
}

export default function PlatformStrip() {
  const [regions, setRegions] = useState<ProviderRegionGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchProviderRegions()
      .then((res) => {
        if (!cancelled) setRegions(res.regions ?? []);
      })
      .catch((err) => {
        if (err instanceof ApiClientError && !cancelled) setRegions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nonEmpty = regions.filter((r) => r.providers.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <section className="mb-10" aria-label="流媒体平台">
      <div className="mb-4">
        <h2 className="type-headline">流媒体平台</h2>
        <p className="type-caption mt-0.5 text-txt-tertiary">
          按平台上架浏览，左右滑动查看更多平台
        </p>
      </div>

      {nonEmpty.map((group) => (
        <RegionRow key={group.key} group={group} />
      ))}
    </section>
  );
}