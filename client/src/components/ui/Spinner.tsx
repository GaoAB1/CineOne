/**
 * 加载指示器。
 */

interface SpinnerProps {
  size?: number;
  label?: string;
  /** 占满父容器居中 */
  center?: boolean;
}

export default function Spinner({ size = 28, label, center = true }: SpinnerProps) {
  const icon = (
    <span
      className="inline-block animate-spin"
      role="status"
      aria-label={label ?? '加载中'}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 50 50" width={size} height={size} aria-hidden>
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="var(--border-light)"
          strokeWidth="5"
        />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="90 126"
        />
      </svg>
    </span>
  );
  if (!center) return icon;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      {icon}
      {label ? <span className="type-caption text-txt-secondary">{label}</span> : null}
    </div>
  );
}
