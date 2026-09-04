/**
 * 首页「流媒体平台」大幅卡区块：分美区/国区两组横滑。
 * 每平台一张 21:9 宽幅黑色胶囊：左侧大字号平台名 + 右侧 6 张热门海报倾斜堆叠。
 * 点击进入 /providers/:region/:provider 平台片库页。
 * 数据来自 /api/tmdb/providers（含 samples）。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProviderRegions,
  type ProviderEntry,
  type ProviderRegionGroup,
  type ProviderSample,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';

const STACK_LAYOUTS: Array<{ top: string; left: string; rotate: number; width: string; z: number }> = [
  { top: '6%', left: '2%', rotate: -8, width: '46%', z: 1 },
  { top: '14%', left: '24%', rotate: 5, width: '46%', z: 3 },
  { top: '32%', left: '8%', rotate: -3, width: '46%', z: 4 },
  { top: '40%', left: '40%', rotate: 9, width: '46%', z: 5 },
  { top: '8%', left: '54%', rotate: -10, width: '46%', z: 2 },
  { top: '28%', left: '60%', rotate: 4, width: '46%', z: 6 },
];

function posterUrl(p: ProviderSample): string | null {
  return p.posterPath ? `https://image.tmdb.org/t/p/w342${p.posterPath}` : null;
}

function ProviderPosterStack({ samples }: { samples: ProviderSample[] }) {
  if (samples.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-txt-tertiary">
        <i className="ri-clapperboard-line text-[36px]" aria-hidden />
      </div>
    );
  }
  return (
    <div className="relative hidden h-full w-[58%] sm:block">
      {samples.map((sample, index) => {
        const layout = STACK_LAYOUTS[index % STACK_LAYOUTS.length];
        const src = posterUrl(sample);
        return (
          <div
            key={`${sample.mediaType}-${sample.tmdbId}-${index}`}
            className="absolute overflow-hidden ring-1 ring-white/15"
            style={{
              top: layout.top,
              left: layout.left,
              width: layout.width,
              aspectRatio: '2 / 3',
              borderRadius: 'var(--radius-md)',
              transform: `rotate(${layout.rotate}deg)`,
              zIndex: layout.z,
              boxShadow:
                '0 18px 40px rgba(0,0,0,0.6), 0 0 24px color-mix(in srgb, var(--color-glow) 10%, transparent)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            {src ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProviderCard({ provider, regionKey }: { provider: ProviderEntry; regionKey: 'us' | 'cn' }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/providers/${regionKey}/${provider.key}`)}
      className="group relative flex shrink-0 snap-start overflow-hidden text-left transition-transform duration-slow ease-[var(--ease-glow)] hover:scale-[1.01] focus-visible:scale-[1.01]"
      style={{
        minWidth: 'min(100%, 720px)',
        aspectRatio: '21 / 9',
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, #0B0B12 0%, #15121F 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow:
          '0 30px 60px rgba(0,0,0,0.55), 0 0 60px color-mix(in srgb, var(--color-glow) 10%, transparent)',
      }}
      aria-label={`浏览 ${provider.name} 片库`}
    >
      {/* 左侧文字 */}
      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col justify-between p-6 sm:p-8 md:p-10">
        <p className="type-caption font-medium uppercase tracking-[0.16em] text-white/55">
          热门上映 · {regionKey === 'us' ? '美区' : '国区'}
        </p>
        <div>
          <h3
            className="break-words font-black uppercase text-white"
            style={{
              fontFamily: 'var(--font-system)',
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 0.86,
              fontSize: 'clamp(48px, 8.6vw, 116px)',
              textShadow: '0 6px 30px rgba(0,0,0,0.45)',
            }}
          >
            {provider.name}
          </h3>
          <div className="mt-4 flex items-center gap-2 text-[13px] font-medium text-white/80">
            <span>浏览全部片库</span>
            <i className="ri-arrow-right-s-line text-[20px] transition-transform duration-base ease-out group-hover:translate-x-1" aria-hidden />
          </div>
        </div>
      </div>

      {/* 右侧海报堆叠 */}
      <ProviderPosterStack samples={provider.samples} />
    </button>
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
          按平台上架浏览，点击进入该平台片库
        </p>
      </div>

      {nonEmpty.map((region) => (
        <div key={region.key} className="mb-6 last:mb-0">
          <p className="type-caption mb-2 px-1 font-medium text-txt-tertiary">{region.label}</p>
          <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto px-1 pb-2">
            {region.providers.map((provider) => (
              <ProviderCard
                key={provider.key}
                provider={provider}
                regionKey={region.key}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}