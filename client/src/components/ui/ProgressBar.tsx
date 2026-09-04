/**
 * 追剧集数进度条。
 */

interface ProgressBarProps {
  percent: number;
  className?: string;
  showLabel?: boolean;
}

export default function ProgressBar({ percent, className = '', showLabel = true }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[3px] flex-1 overflow-hidden"
        style={{ background: 'var(--surface-warm)', borderRadius: 'var(--radius-pill)' }}
      >
        <div
          className="h-full transition-all duration-base ease-out"
          style={{
            width: `${clamped}%`,
            background: 'var(--color-glow)',
            borderRadius: 'var(--radius-pill)',
            boxShadow: '0 0 8px color-mix(in srgb, var(--color-glow) 65%, transparent)',
          }}
        />
      </div>
      {showLabel && (
        <span className="type-caption tabular-nums text-txt-secondary">{clamped}%</span>
      )}
    </div>
  );
}
