/**
 * 海报玻璃评分胶囊（Forward 主视觉元素，MediaCard 与 Hero 共用）。
 * 分值语义色：≥8.0 success / <6.0 danger / 其余胶囊白；无分值不渲染。
 */

interface RatingCapsuleProps {
  score?: number;
}

export default function RatingCapsule({ score }: RatingCapsuleProps) {
  if (score == null || score <= 0) return null;

  const color =
    score >= 8
      ? 'var(--color-success)'
      : score < 6
        ? 'var(--color-danger)'
        : 'var(--overlay-capsule-text)';

  return (
    <span
      className="pointer-events-none absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-pill px-2 py-[3px]"
      style={{
        background: 'var(--overlay-capsule-bg)',
        border: '1px solid var(--overlay-capsule-border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <i className="ri-star-fill text-[11px]" style={{ color: 'var(--amber-badge-bg)' }} aria-hidden />
      <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </span>
  );
}
