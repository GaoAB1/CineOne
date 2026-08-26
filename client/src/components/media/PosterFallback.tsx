/**
 * 无海报占位图（path 为 null 时渲染，不发请求）。
 * Forward 版：18px 圆角 + ri-film-line 28px + surface-warm 内层质感。
 */

interface PosterFallbackProps {
  title?: string;
  className?: string;
}

export default function PosterFallback({ title, className = '' }: PosterFallbackProps) {
  return (
    <div
      role="img"
      aria-label={title ? `${title} 的占位海报` : '占位海报'}
      className={`flex flex-col items-center justify-center gap-2 ${className}`}
      style={{
        background:
          'linear-gradient(var(--surface-warm), var(--surface-warm)), var(--color-bg-secondary)',
        border: '1px solid var(--border-light)',
        aspectRatio: '2 / 3',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <i
        className="ri-film-line text-[28px]"
        style={{ color: 'var(--text-tertiary)' }}
        aria-hidden
      />
      {title ? (
        <span
          className="type-caption px-3 text-center"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {title}
        </span>
      ) : null}
    </div>
  );
}
