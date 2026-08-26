/**
 * 最简顶部提示条：fixed 顶部居中，自动关闭；成功/失败两态。
 */

import { useEffect } from 'react';
import GlassPanel from './GlassPanel';

interface ToastProps {
  message: string;
  ok?: boolean;
  /** 自动关闭时长（ms），默认 3000 */
  duration?: number;
  onClose: () => void;
}

export default function Toast({ message, ok = true, duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(id);
  }, [duration, onClose]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <GlassPanel className="pointer-events-auto px-4 py-2.5" bordered>
        <span className="type-body flex items-center gap-2">
          <i
            className={ok ? 'ri-checkbox-circle-fill text-[18px]' : 'ri-error-warning-fill text-[18px]'}
            style={{ color: ok ? 'var(--color-success)' : 'var(--color-danger)' }}
            aria-hidden
          />
          {message}
        </span>
      </GlassPanel>
    </div>
  );
}
