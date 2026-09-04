/**
 * 评分徽章（源图标 + 分值 + stale 角标）。
 * 规范 V2.0：权威评分徽章采用 Amber Gold（#F59E0B）琥珀金底 + 深字，
 * 呼应 IMDb / 烂番茄 的黄色评分语言，作为权威标识叠放于玻璃信息卡上。
 * 展示规则：豆瓣一位小数；烂番茄/爆米花转百分比。
 */

import type { CSSProperties } from 'react';
import type { RatingSource } from '../../api/types';

export type RatingSourceName = 'tmdb' | 'douban' | 'tomato' | 'popcorn';

interface RatingBadgeProps {
  source: RatingSourceName;
  data?: RatingSource | null;
  /** TMDB 源直接给分值 */
  tmdbScore?: number;
  onClick?: () => void;
}

const SOURCE_META: Record<Exclude<RatingSourceName, 'tmdb'>, { label: string; icon: string }> = {
  douban: { label: '豆瓣', icon: 'ri-clapperboard-fill' },
  tomato: { label: '烂番茄', icon: 'ri-tomato-line' },
  popcorn: { label: '爆米花', icon: 'ri-popcorn-line' },
};

function formatValue(source: RatingSourceName, data: RatingSource): string {
  if (data.rawText) return data.rawText;
  if (data.score == null) return '暂无';
  if (source === 'douban' || source === 'tmdb') return data.score.toFixed(1);
  // tomato / popcorn：0-10 → 百分比
  return `${Math.round(data.score * 10)}%`;
}

const BADGE_STYLE: CSSProperties = {
  background: 'var(--amber-badge-bg)',
  color: 'var(--amber-badge-text)',
};

export default function RatingBadge({ source, data, tmdbScore, onClick }: RatingBadgeProps) {
  if (source === 'tmdb') {
    const value = tmdbScore != null ? tmdbScore.toFixed(1) : '暂无';
    return (
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium"
        style={BADGE_STYLE}
      >
        <i className="ri-star-fill text-[12px]" aria-hidden />
        <span className="font-bold">TMDB</span>
        <span>{value}</span>
      </span>
    );
  }

  const meta = SOURCE_META[source];
  const score = data?.score ?? null;
  const stale = data?.stale ?? false;
  const manual = data?.manual ?? false;
  // 外链优先：有 sourceUrl 且有分值时整颗胶囊渲染为 <a>
  const href = data?.sourceUrl && score != null ? data.sourceUrl : null;
  const clickable = href == null && typeof onClick === 'function';
  const Tag = (href != null ? 'a' : clickable ? 'button' : 'span') as 'a';

  return (
    <Tag
      {...(href != null
        ? { href, target: '_blank' as const, rel: 'noreferrer' }
        : clickable
          ? { type: 'button' as const, onClick }
          : {})}
      title={manual ? '人工修正值' : stale ? '来自缓存或降级数据' : undefined}
      className={`inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium ${
        href != null || clickable
          ? 'cursor-pointer hover:opacity-85 transition-opacity duration-fast ease-out'
          : ''
      }`}
      style={BADGE_STYLE}
    >
      <i className={`${meta.icon} text-[12px]`} aria-hidden />
      <span className="font-bold">{meta.label}</span>
      <span>{data ? formatValue(source, data) : '暂无'}</span>
      {(stale || manual) && (
        <span
          className="rounded-pill px-1.5 py-[1px] text-[10px] font-semibold"
          style={{ background: 'rgba(0,0,0,0.16)', color: 'var(--amber-badge-text)' }}
        >
          缓存
        </span>
      )}
      {href != null && (
        <i className="ri-external-link-line text-[11px]" aria-hidden />
      )}
    </Tag>
  );
}
