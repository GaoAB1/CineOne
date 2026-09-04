/**
 * Filled / Tinted / Gray / Plain / Destructive / Hero 六态按钮。
 * 触控目标最小 44×44；按压弹性反馈；全部颜色走设计令牌。
 * Hero = 规范纯白 CTA（黑字 + 白光晕），用于 Hero Banner「立即播放」类主操作。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive' | 'hero';

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
      // 霓虹紫主按钮：hover 提亮 + 紫色光晕
      return 'bg-accent text-[var(--text-on-accent)] hover:bg-accentHover hover:shadow-[var(--shadow-cta-violet)]';
    case 'hero':
      // 规范 · Hero CTA：纯白底黑字 + 白光晕
      return 'bg-[#FFFFFF] text-[#181521] hover:bg-[#F1EFFA] shadow-[var(--shadow-cta-white)]';
    case 'tinted':
      return 'bg-[color:var(--nav-bg)] text-accent hover:bg-[color:var(--surface-warm)] border border-line';
    case 'gray':
      return 'bg-surface text-txt-primary hover:bg-[color:color-mix(in_srgb,var(--color-bg-secondary)_88%,_var(--text-secondary))]';
    case 'plain':
      return 'bg-transparent text-accent hover:opacity-70';
    case 'destructive':
      return 'bg-danger text-white hover:bg-[color:color-mix(in_srgb,var(--color-danger)_88%,_black)]';
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
      className={`press-spring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-5 text-[17px] font-medium transition-[background-color,box-shadow,opacity] duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses(
        variant,
      )} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? <span className="ri-loader-4-line animate-spin text-[20px]" aria-hidden /> : icon}
      {children}
    </button>
  );
}
