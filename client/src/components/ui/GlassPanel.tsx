/**
 * 毛玻璃面板（导航/侧栏/弹层复用）。
 * radiusClass：允许调用方覆盖圆角（如 TabBar 传 rounded-pill）。
 */

import type { CSSProperties, ReactNode } from 'react';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 额外描边（深色下低透明度白描边营造玻璃质感） */
  bordered?: boolean;
  /** 圆角类名，默认 rounded-lg（24px） */
  radiusClass?: string;
}

export default function GlassPanel({
  children,
  className = '',
  style,
  bordered = true,
  radiusClass = 'rounded-lg',
}: GlassPanelProps) {
  return (
    <div
      className={`glass ${radiusClass} ${bordered ? 'border border-line' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
