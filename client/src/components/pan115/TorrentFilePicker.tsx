/**
 * 115 种子文件勾选面板（可复用）：
 * 展示 115 解析出的种子文件树，支持「全选 / 清空 / 仅视频」与逐项勾选，
 * 由调用方负责提交（wanted 索引数组）。
 *
 * 同时被资源搜索页的推送面板与 115 管理页的「手动添种」流程复用。
 */

import Button from '../ui/Button';
import type { Pan115TorrentInfo } from '../../api/endpoints';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const i = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${SIZE_UNITS[i]}`;
}

interface TorrentFilePickerProps {
  info: Pan115TorrentInfo;
  /** 已勾选的文件索引 */
  selected: Set<number>;
  onSelectedChange: (next: Set<number>) => void;
  /** 提交按钮文案（不传则不渲染提交/取消按钮，由调用方自绘） */
  submitLabel?: string;
  busy?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  /** 关闭入口（与 onCancel 二选一） */
  onClose?: () => void;
  /** 列表最大高度，默认 180px */
  maxHeight?: number;
}

export default function TorrentFilePicker({
  info,
  selected,
  onSelectedChange,
  submitLabel,
  busy = false,
  onSubmit,
  onCancel,
  onClose,
  maxHeight = 180,
}: TorrentFilePickerProps) {
  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelectedChange(next);
  };

  const selectedSize = info.files
    .filter((file) => selected.has(file.index))
    .reduce((sum, file) => sum + (file.size || 0), 0);

  return (
    <div className="rounded-md border p-3" style={{ borderColor: 'var(--border-light)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="type-caption text-txt-secondary">
          选择要离线下载的文件（已选 {selected.size}/{info.files.length}
          {selectedSize > 0 ? ` · ${formatBytes(selectedSize)}` : ''}）
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSelectedChange(new Set(info.files.map((f) => f.index)))}
            className="type-caption text-accent hover:underline"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => onSelectedChange(new Set())}
            className="type-caption text-txt-tertiary hover:underline"
          >
            清空
          </button>
          <button
            type="button"
            onClick={() =>
              onSelectedChange(new Set(info.files.filter((f) => f.wanted !== -1).map((f) => f.index)))
            }
            className="type-caption text-txt-tertiary hover:underline"
          >
            仅视频
          </button>
        </div>
      </div>

      <div
        className="no-scrollbar overflow-y-auto"
        style={{ borderTop: '1px solid var(--border-light)', maxHeight }}
      >
        {info.files.map((file) => {
          const checked = selected.has(file.index);
          return (
            <label
              key={`${file.index}-${file.path}`}
              className="flex cursor-pointer items-center gap-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(file.index)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
              />
              <span
                className="min-w-0 flex-1 truncate text-[12px] text-txt-secondary"
                title={file.path}
                style={{ textDecoration: checked ? undefined : 'line-through', opacity: checked ? 1 : 0.6 }}
              >
                {file.path}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-txt-tertiary">
                {formatBytes(file.size)}
              </span>
            </label>
          );
        })}
      </div>

      {(submitLabel || onCancel || onClose) && (
        <div className="mt-3 flex items-center gap-2">
          {submitLabel && onSubmit && (
            <Button
              variant="filled"
              className="!min-h-[34px] !px-3 text-[12px]"
              loading={busy}
              disabled={selected.size === 0}
              onClick={() => void onSubmit()}
            >
              {submitLabel}
            </Button>
          )}
          {(onCancel || onClose) && (
            <Button
              variant="gray"
              className="!min-h-[34px] !px-3 text-[12px]"
              onClick={onCancel ?? onClose}
            >
              取消
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
