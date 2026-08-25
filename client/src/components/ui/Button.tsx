/**
 * Filled / Tinted / Gray / Plain / Destructive 五态按钮。
 * 触控目标最小 44×44；按压弹性反馈；全部颜色走设计令牌。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 是否占满整行 */
  block?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

function variantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case 'filled':
      return 'bg-accent text-white hover:opacity-90';
    case 'tinted':
      // iOS tinted：accent 低透明度底 + accent 文字
      return 'bg-[color:var(--nav-bg)] text-accent hover:opacity-90 border border-line';
    case 'gray':
      return 'bg-surface text-txt-primary hover:opacity-90';
    case 'plain':
      return 'bg-transparent text-accent hover:opacity-70';
    case 'destructive':
      return 'bg-danger text-white hover:opacity-90';
    default:
      return '';
  }
}

export default function Button({
  variant = 'filled',
  block = false,
  icon,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`press-spring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-5 text-[17px] font-medium transition-opacity duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses(
        variant,
      )} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? <span className="ri-loader-4-line animate-spin text-[20px]" aria-hidden /> : icon}
      {children}
    </button>
  );
}
