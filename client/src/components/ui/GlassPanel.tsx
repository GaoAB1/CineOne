/**
 * 毛玻璃面板（导航/侧栏/弹层复用）。
 */

import type { CSSProperties, ReactNode } from 'react';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 额外描边（深色下低透明度白描边营造玻璃质感） */
  bordered?: boolean;
}

export default function GlassPanel({ children, className = '', style, bordered = true }: GlassPanelProps) {
  return (
    <div
      className={`glass rounded-lg ${bordered ? 'border border-line' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
