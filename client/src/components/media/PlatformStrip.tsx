/**
 * 首页「流媒体平台」区块（平台入口卡，分美区/国区两组横滑）。
 * 点击入口卡进入对应平台浏览页 /providers/:region/:provider。
 * 数据来自 /api/tmdb/providers；加载失败或平台为空时整块静默隐藏。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProviderRegions,
  type ProviderRegionGroup,
} from '../../api/endpoints';
import { ApiClientError } from '../../api/http';

export default function PlatformStrip() {
  const navigate = useNavigate();
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
    <section className="mb-9" aria-label="流媒体平台">
      <div className="mb-4">
        <h2 className="type-headline">流媒体平台</h2>
        <p className="type-caption mt-0.5 text-txt-tertiary">按平台上架浏览，点击进入该平台片库</p>
      </div>

      {nonEmpty.map((region) => (
        <div key={region.key} className="mb-4 last:mb-0">
          <p className="type-caption mb-2 px-1 font-medium text-txt-tertiary">{region.label}</p>
          <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
            {region.providers.map((provider) => (
              <button
                key={provider.key}
                type="button"
                onClick={() => navigate(`/providers/${region.key}/${provider.key}`)}
                className="glass-glow-card group flex w-[176px] shrink-0 snap-start flex-col items-start gap-3 p-4 text-left"
                aria-label={`浏览 ${provider.name} 片库`}
              >
                <div className="flex w-full items-start justify-between">
                  {provider.logoPath ? (
                    <span
                      className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-line"
                      style={{ background: '#FFFFFF' }}
                    >
                      <img
                        src={provider.logoPath}
                        alt=""
                        loading="lazy"
                        className="h-7 w-7 object-contain"
                      />
                    </span>
                  ) : (
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-xl"
                      style={{
                        background: 'color-mix(in srgb, var(--color-glow) 16%, transparent)',
                        color: 'var(--color-glow)',
                      }}
                    >
                      <i className="ri-play-circle-fill text-[22px]" aria-hidden />
                    </span>
                  )}
                  <i
                    className="ri-arrow-right-s-line text-[20px] text-txt-tertiary transition-colors duration-fast ease-out group-hover:text-txt-primary"
                    aria-hidden
                  />
                </div>
                <span className="line-clamp-1 text-[15px] font-semibold text-txt-primary">
                  {provider.name}
                </span>
                <span className="type-caption text-txt-tertiary">浏览全部 →</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
