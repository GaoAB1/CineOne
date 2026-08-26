/**
 * MoviePilot 订阅确认弹层：居中 GlassPanel 对话框，
 * 显示标题/年份/类型；剧集需选季（选项来自详情 seasons）。
 */

import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import GlassPanel from '../ui/GlassPanel';
import SegmentedControl from '../ui/SegmentedControl';
import type { MediaType } from '../../api/types';

interface SubscribeDialogProps {
  title: string;
  year?: string;
  mediaType: MediaType;
  seasons: { seasonNumber: number; episodeCount: number }[];
  busy: boolean;
  onConfirm: (season?: number) => void;
  onClose: () => void;
}

export default function SubscribeDialog({
  title,
  year,
  mediaType,
  seasons,
  busy,
  onConfirm,
  onClose,
}: SubscribeDialogProps) {
  const firstSeason = mediaType === 'tv' ? seasons[0]?.seasonNumber : undefined;
  const [season, setSeason] = useState<number | undefined>(firstSeason);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="关闭对话框"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: 'var(--scrim-hero-dim)' }}
      />

      <GlassPanel
        className="relative w-full max-w-[400px] p-5"
        bordered
        role="dialog"
        aria-modal="true"
        aria-label={`订阅 ${title}`}
      >
        <h2 className="type-headline mb-3 flex items-center gap-2">
          <i className="ri-notification-3-line text-[20px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
          订阅到 MoviePilot
        </h2>

        <p className="type-body text-txt-primary">
          {title}
          {year ? <span className="text-txt-secondary">（{year}）</span> : null}
        </p>
        <p className="type-caption mt-1 text-txt-tertiary">{mediaType === 'movie' ? '电影' : '电视剧'}</p>

        {mediaType === 'tv' && seasons.length > 0 && (
          <div className="mt-4">
            <p className="type-caption mb-2 text-txt-secondary">选择季</p>
            <SegmentedControl<string>
              options={seasons.map((s) => ({ value: String(s.seasonNumber), label: `第 ${s.seasonNumber} 季` }))}
              value={String(season ?? seasons[0].seasonNumber)}
              onChange={(v) => setSeason(Number.parseInt(v, 10))}
              ariaLabel="选择要订阅的季"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="gray" onClick={onClose}>
            取消
          </Button>
          <Button variant="filled" loading={busy} onClick={() => onConfirm(season)}>
            确认订阅
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}
