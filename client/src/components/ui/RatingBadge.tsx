/**
 * 评分胶囊（源图标 + 分值 + 配色语义 + stale 角标）。
 * 展示规则：豆瓣一位小数；烂番茄/爆米花转百分比。
 */

import type { RatingSource } from '../../api/types';

export type RatingSourceName = 'tmdb' | 'douban' | 'tomato' | 'popcorn';

interface RatingBadgeProps {
  source: RatingSourceName;
  data: RatingSource | null;
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

function semanticColor(score: number | null): string {
  if (score == null) return 'var(--text-tertiary)';
  if (score >= 8) return 'var(--color-success)';
  if (score >= 6) return 'var(--text-primary)';
  return 'var(--color-danger)';
}

export default function RatingBadge({ source, data, tmdbScore, onClick }: RatingBadgeProps) {
  if (source === 'tmdb') {
    const value = tmdbScore != null ? tmdbScore.toFixed(1) : '暂无';
    return (
      <span
        className="inline-flex items-center gap-1 rounded-pill border border-line px-3 py-1 text-[13px]"
        style={{ color: semanticColor(tmdbScore ?? null) }}
      >
        <i className="ri-star-fill" aria-hidden />
        <span className="font-semibold">TMDB</span>
        <span>{value}</span>
      </span>
    );
  }

  const meta = SOURCE_META[source];
  const score = data?.score ?? null;
  const stale = data?.stale ?? false;
  const manual = data?.manual ?? false;
  const clickable = typeof onClick === 'function';
  const Tag = (clickable ? 'button' : 'span') as 'button';

  return (
    <Tag
      {...(clickable ? { type: 'button' as const, onClick } : {})}
      title={manual ? '人工修正值' : stale ? '来自缓存或降级数据' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-pill border border-line bg-card px-3 py-1 text-[13px] ${
        clickable ? 'cursor-pointer hover:opacity-80 transition-opacity duration-fast ease-out' : ''
      }`}
    >
      <i className={`${meta.icon}`} style={{ color: 'var(--text-secondary)' }} aria-hidden />
      <span className="font-semibold text-txt-secondary">{meta.label}</span>
      <span className="font-medium" style={{ color: semanticColor(score) }}>
        {data ? formatValue(source, data) : '暂无'}
      </span>
      {(stale || manual) && (
        <span className="rounded-pill px-1 text-[10px]" style={{ background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }}>
          缓存
        </span>
      )}
    </Tag>
  );
}
