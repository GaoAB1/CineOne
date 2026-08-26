/**
 * 44pt 高度 iOS 风格输入框。
 * Forward 版：label 去 uppercase；focus 边框 accent + 焦点环双反馈。
 */

import { useId, type InputHTMLAttributes } from 'react';

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export default function InputField({ label, error, hint, className = '', ...rest }: InputFieldProps) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-txt-secondary">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        className={`h-11 w-full rounded-md border bg-card px-4 text-body text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent focus:shadow-[var(--focus-ring)] ${
          error ? 'border-danger' : 'border-line'
        }`}
        style={{ borderRadius: 'var(--radius-md)' }}
      />
      {error ? (
        <p className="type-caption text-danger">{error}</p>
      ) : hint ? (
        <p className="type-caption text-txt-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}
