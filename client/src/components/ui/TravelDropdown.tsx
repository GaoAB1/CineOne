/**
 * TravelDropdown — 胶囊栏下拉段的自定义弹层（替代原生 <select>）。
 * 视觉与 bar 同材质（含顶部箭头）；交互覆盖鼠标 / 触摸 / 键盘 / 读屏。
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { Check } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
}

export interface TravelDropdownProps {
  label: string;
  hint: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** 最后一段右对齐，避免 320px 下弹层溢出 */
  align?: 'left' | 'right';
  transition: Transition;
}

export default function TravelDropdown({
  label, hint, value, options, onChange, align = 'left', transition,
}: TravelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const labelId = `${uid}-label`;
  const valueId = `${uid}-value`;
  const listId = `${uid}-list`;
  const selectedLabel = options.find((o) => o.value === value)?.label ?? hint;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openMenu = useCallback((startAt?: number) => {
    const idx = startAt ?? Math.max(0, options.findIndex((o) => o.value === value));
    setCursor(idx);
    setOpen(true);
    window.requestAnimationFrame(() => popRef.current?.focus());
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(options.length - 1); }
    else if (e.key === 'Escape') close();
  };

  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!options.length) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setCursor((c) => (c + 1) % options.length); break;
      case 'ArrowUp': e.preventDefault(); setCursor((c) => (c - 1 + options.length) % options.length); break;
      case 'Home': e.preventDefault(); setCursor(0); break;
      case 'End': e.preventDefault(); setCursor(options.length - 1); break;
      case 'Enter':
      case ' ': e.preventDefault(); onChange(options[cursor].value); close(); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(false); break;
      default: break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center bg-transparent p-0 text-left"
      >
        <b id={labelId} className="block text-xs font-medium">{label}</b>
        <small id={valueId} className="block truncate text-[11px] leading-[1.35]" style={{ color: 'var(--ts-hint)' }}>
          {selectedLabel}
        </small>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="popover"
            id={listId}
            ref={popRef}
            role="listbox"
            aria-labelledby={labelId}
            aria-activedescendant={`${listId}-opt-${cursor}`}
            tabIndex={-1}
            onKeyDown={handleListKeyDown}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={transition}
            data-align={align}
            className="ts-popover absolute z-50 outline-none"
          >
            <p className="ts-popover-title">{label}</p>
            <div className="ts-popover-list">
              {options.map((o, i) => {
                const selected = o.value === value;
                return (
                  <div
                    key={o.value}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    data-cursor={cursor === i || undefined}
                    onClick={() => { onChange(o.value); close(); }}
                    onPointerEnter={() => setCursor(i)}
                    className="ts-option"
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
