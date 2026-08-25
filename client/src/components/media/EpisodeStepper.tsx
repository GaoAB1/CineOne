/**
 * 季选择器 + 集 ± 步进器（追剧进度编辑）。
 */

import type { SeasonSnapshotEntry } from '../../api/types';

interface EpisodeStepperProps {
  seasons: SeasonSnapshotEntry[];
  currentSeason: number;
  currentEpisode: number;
  onSeasonChange: (season: number) => void;
  onEpisodeChange: (episode: number) => void;
}

export default function EpisodeStepper({
  seasons,
  currentSeason,
  currentEpisode,
  onSeasonChange,
  onEpisodeChange,
}: EpisodeStepperProps) {
  const seasonEntry = seasons.find((s) => s.seasonNumber === currentSeason);
  const maxEpisode = seasonEntry?.episodeCount ?? null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {seasons.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="type-caption text-txt-secondary">季</span>
          <select
            value={currentSeason}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              if (Number.isInteger(next)) onSeasonChange(next);
            }}
            aria-label="选择季"
            className="h-[36px] rounded-sm border border-line bg-card px-2 text-body text-txt-primary outline-none focus:border-accent"
          >
            {seasons.map((s) => (
              <option key={s.seasonNumber} value={s.seasonNumber}>
                第 {s.seasonNumber} 季{` · ${s.episodeCount} 集`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-2">
        <span className="type-caption text-txt-secondary">已看到</span>
        <button
          type="button"
          aria-label="上一集"
          disabled={currentEpisode <= 0}
          onClick={() => onEpisodeChange(Math.max(0, currentEpisode - 1))}
          className="press-spring flex h-9 w-9 items-center justify-center rounded-full bg-surface text-txt-primary transition-opacity duration-fast ease-out disabled:opacity-40"
        >
          <i className="ri-subtract-line text-[18px]" aria-hidden />
        </button>
        <span className="min-w-[72px] text-center tabular-nums text-body font-medium text-txt-primary">
          S{currentSeason}·E{currentEpisode}
          {maxEpisode != null ? ` / ${maxEpisode}` : ''}
        </span>
        <button
          type="button"
          aria-label="下一集"
          disabled={maxEpisode != null ? currentEpisode >= maxEpisode : false}
          onClick={() => onEpisodeChange(currentEpisode + 1)}
          className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-white transition-opacity duration-fast ease-out disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
        >
          <i className="ri-add-line text-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}
