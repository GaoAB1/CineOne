/**
 * TravelSearchBar — AIMRAN Library「Travel search bar (Inputs)」CineOne 移植版。
 * 尺寸 / 色值 / 圆角 / 阴影 / spring 动效与参考实现 1:1；
 * 主题接入项目 html[data-theme] 令牌，下拉段使用自定义 listbox 弹层。
 */
import { useId, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { motion, useReducedMotion, type Transition } from 'framer-motion';
import { Search, type LucideIcon } from 'lucide-react';
import TravelDropdown from './TravelDropdown';

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

export interface TravelSegment {
  id: string;
  label: string;
  /** 状态行：页面可传动态文案（加载中 / 结果数 / 占位提示） */
  hint: string;
  icon: LucideIcon;
  kind: 'input' | 'select';
  value: string;
  onChange: (value: string) => void;
  options?: Array<{ value: string; label: string }>;
}

export interface TravelSearchBarProps {
  /** 搜索按钮主色，默认 #0071e3；也可传 'var(--color-accent)' 跟随项目主题 */
  color?: string;
  segments: TravelSegment[];
  onSearch?: () => void;
  /** 按钮图标，默认 Search；媒体库页传 ArrowDownUp 表示升降序切换 */
  actionIcon?: LucideIcon;
  /** 按钮可访问名，随页面动作变化 */
  actionLabel?: string;
  /** 按钮动作，默认沿用 onSearch */
  onAction?: () => void;
  ariaLabel?: string;
  searchLabel?: string;
  autoFocusFirst?: boolean;
  className?: string;
}

export default function TravelSearchBar({
  color = '#0071e3',
  segments,
  onSearch,
  actionIcon,
  actionLabel,
  onAction,
  ariaLabel = '搜索',
  searchLabel = '搜索',
  autoFocusFirst = false,
  className = '',
}: TravelSearchBarProps) {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();
  const transition: Transition = reduceMotion ? { duration: 0 } : SPRING;
  const layout = !reduceMotion;
  const baseId = useId();
  const ActionIcon = actionIcon ?? Search;

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    (onAction ?? onSearch)?.();
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>, i: number): void => {
    setActive(i);
    const tag = (e.target as HTMLElement).tagName;
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
      e.currentTarget.querySelector('input')?.focus();
    }
  };

  return (
    <motion.form
      layout={layout}
      transition={transition}
      role="search"
      aria-label={ariaLabel}
      onSubmit={handleSubmit}
      className={`travel-search-bar flex w-full max-w-[440px] flex-wrap items-center rounded-[28px] p-1.5 ${className}`}
      style={
        {
          '--ts-accent': color,
          backgroundColor: 'var(--ts-bar-bg)',
          color: 'var(--ts-bar-fg)',
          boxShadow: 'var(--ts-shadow)',
        } as CSSProperties
      }
    >
      {segments.map((seg, i) => {
        const Icon = seg.icon;
        const isActive = active === i;
        const labelId = `${baseId}-${seg.id}-label`;
        return (
          <motion.div
            layout={layout}
            key={seg.id}
            transition={transition}
            data-active={isActive || undefined}
            onPointerDownCapture={(e) => handlePointerDown(e, i)}
            onFocusCapture={() => setActive(i)}
            className="relative flex min-h-[44px] min-w-28 flex-1 items-center gap-2 rounded-full px-4 py-3 text-left"
            style={isActive ? { backgroundColor: 'var(--ts-active-bg)', boxShadow: 'var(--ts-shadow)' } : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {seg.kind === 'input' ? (
              <span className="min-w-0 flex-1">
                <b id={labelId} className="block text-xs font-medium">{seg.label}</b>
                <input
                  type="text"
                  value={seg.value}
                  onChange={(e) => seg.onChange(e.target.value)}
                  placeholder={seg.hint}
                  autoComplete="off"
                  autoFocus={autoFocusFirst && i === 0}
                  aria-labelledby={labelId}
                  className="ts-input block w-full min-w-0 border-0 bg-transparent p-0 text-[11px] leading-[1.35] outline-none"
                  style={{ color: 'var(--ts-bar-fg)' }}
                />
              </span>
            ) : (
              <TravelDropdown
                label={seg.label}
                hint={seg.hint}
                value={seg.value}
                options={seg.options ?? []}
                onChange={seg.onChange}
                align={i === segments.length - 1 ? 'right' : 'left'}
                transition={transition}
              />
            )}
          </motion.div>
        );
      })}
      <button
        type="submit"
        aria-label={actionLabel ?? searchLabel}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: color }}
      >
        <ActionIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.form>
  );
}
