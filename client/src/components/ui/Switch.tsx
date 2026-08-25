/**
 * iOS 开关。
 */

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-pill transition-colors duration-fast ease-out disabled:opacity-50"
      style={{ background: checked ? 'var(--color-success)' : 'var(--text-tertiary)' }}
    >
      <span
        className="absolute h-[27px] w-[27px] rounded-full bg-white shadow-sm transition-all duration-fast ease-out"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}
