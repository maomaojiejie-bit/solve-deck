import { stepDurationMs, stepProgress, type PlayerSpeed } from '../core/player';

interface StepPlayerProps {
  stepIndex: number;
  stepCount: number;
  playing: boolean;
  speed: PlayerSpeed;
  disabled: boolean;
  /** W21-A A4：与顶部徽标 / 结论横幅同一个校验口径。 */
  summary?: string;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeed: () => void;
  onSeek: (index: number) => void;
}

const buttonClass =
  'rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink transition-colors hover:border-cyan/50 hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40';

export function StepPlayer({
  stepIndex,
  stepCount,
  playing,
  speed,
  disabled,
  onToggle,
  onPrev,
  onNext,
  onSpeed,
  onSeek,
  summary,
}: StepPlayerProps) {
  const progress = stepProgress(stepIndex, stepCount);
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[11px] text-muted">
            {stepIndex + 1} / {stepCount}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(stepCount - 1, 0)}
            value={stepIndex}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="步骤进度"
            className="h-1 min-w-0 flex-1 accent-cyan"
          />
          <span className="w-12 shrink-0 text-right text-[11px] text-muted">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button type="button" className={buttonClass} onClick={onPrev} disabled={disabled}>
              上一步
            </button>
            <button
              type="button"
              className={`${buttonClass} min-w-[76px] border-cyan/40 text-cyan`}
              onClick={onToggle}
              disabled={disabled}
            >
              {playing ? '暂停' : '播放'}
            </button>
            <button type="button" className={buttonClass} onClick={onNext} disabled={disabled}>
              下一步
            </button>
            <button type="button" className={buttonClass} onClick={onSpeed} disabled={disabled}>
              {speed}×
            </button>
            <span className="hidden text-[11px] text-muted sm:inline">
              每步 {Math.round(stepDurationMs(speed))} ms
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {disabled ? (
              <span className="rounded border border-danger/40 px-2 py-1 text-danger">
                校验未通过 · 播放已禁用
              </span>
            ) : (
              <span data-testid="player-summary" className="rounded border border-ok/40 px-2 py-1 text-ok">
                {summary ? `${summary} · 允许播放` : '校验通过 · 允许播放'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}