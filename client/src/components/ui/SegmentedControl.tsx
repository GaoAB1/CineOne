/**
 * iOS 分段控件（媒体类型切换等）。
 */

import type { ReactNode } from 'react';

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-sm bg-warm p-1"
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`press-spring flex min-h-[36px] items-center justify-center gap-1.5 px-4 text-[15px] transition-all duration-fast ease-out ${
              active ? 'font-semibold' : 'text-txt-secondary'
            }`}
            style={
              active
                ? {
                    background: 'var(--color-bg-elevated)',
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-sm)',
                    borderRadius: 'calc(var(--radius-sm) - 4px)',
                  }
                : undefined
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
