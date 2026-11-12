import type { ReactNode } from 'react';
import type { RenderSpec } from '../core/types';

const STEP = 54;
const ROW = 46;
const LEFT = 80;
const TOP = 22;

/** 数字波形：借用 WaveDrom 的 {name,wave,data} 表达法，自绘 SVG。 */
export function Timing({ spec }: { spec: RenderSpec }) {
  const signals = spec.signals ?? [];
  const ticks = Math.max(
    1,
    ...signals.map((signal) => signal.wave.length || 1),
  );
  const width = LEFT + ticks * STEP + 16;
  const height = TOP + signals.length * ROW + 8;

  const levelOf = (signal: { wave: string }, tick: number, previous: number): number => {
    const char = signal.wave[tick] ?? '.';
    if (char === '1' || char === 'n') return 1;
    if (char === '0' || char === 'p') return 0;
    if (char === 'x') return previous;
    return previous;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="时序波形">
      {signals.map((signal, row) => {
        const yHigh = TOP + row * ROW + 10;
        const yLow = TOP + row * ROW + ROW - 12;
        const elements: ReactNode[] = [];
        let previous = 0;
        for (let tick = 0; tick < ticks; tick += 1) {
          const char = signal.wave[tick] ?? '.';
          const x0 = LEFT + tick * STEP;
          const x1 = x0 + STEP;
          if (char === 'p') {
            elements.push(
              <path
                key={`p-${tick}`}
                d={`M${x0} ${yLow} L${x0 + STEP * 0.25} ${yLow} L${x0 + STEP * 0.25} ${yHigh} L${x0 + STEP * 0.75} ${yHigh} L${x0 + STEP * 0.75} ${yLow} L${x1} ${yLow}`}
                fill="none"
                stroke="var(--sch-wave)"
                strokeWidth={1.6}
              />,
            );
            previous = 0;
            continue;
          }
          if (char === 'n') {
            elements.push(
              <path
                key={`n-${tick}`}
                d={`M${x0} ${yHigh} L${x0 + STEP * 0.25} ${yHigh} L${x0 + STEP * 0.25} ${yLow} L${x0 + STEP * 0.75} ${yLow} L${x0 + STEP * 0.75} ${yHigh} L${x1} ${yHigh}`}
                fill="none"
                stroke="var(--sch-wave)"
                strokeWidth={1.6}
              />,
            );
            previous = 1;
            continue;
          }
          if (char === 'x') {
            elements.push(
              <path
                key={`x-${tick}`}
                d={`M${x0} ${yHigh} L${x1} ${yLow} M${x0} ${yLow} L${x1} ${yHigh}`}
                stroke="var(--sch-wave-x)"
                strokeWidth={1.2}
                fill="none"
              />,
            );
            continue;
          }
          const level = levelOf(signal, tick, previous);
          const y = level === 1 ? yHigh : yLow;
          const nextChar = signal.wave[tick + 1] ?? '.';
          const nextLevel =
            nextChar === '1' || nextChar === 'n' ? 1 : nextChar === '0' || nextChar === 'p' ? 0 : level;
          elements.push(
            <path
              key={`lvl-${tick}`}
              d={`M${x0} ${y} L${x1} ${y}${nextLevel !== level ? ` L${x1} ${nextLevel === 1 ? yHigh : yLow}` : ''}`}
              fill="none"
              stroke="var(--sch-wave-flat)"
              strokeWidth={1.6}
            />,
          );
          previous = level;
        }
        return (
          <g key={signal.name}>
            <text x={LEFT - 10} y={TOP + row * ROW + ROW / 2 + 4} textAnchor="end" fill="currentColor" fontSize="12">
              {signal.name}
            </text>
            {signal.data?.map((label, tick) =>
              label ? (
                <text
                  key={`data-${tick}`}
                  x={LEFT + tick * STEP + STEP / 2}
                  y={TOP + row * ROW + ROW / 2 + 4}
                  textAnchor="middle"
                  fill="var(--sch-wave-label)"
                  fontSize="10"
                >
                  {label}
                </text>
              ) : null,
            )}
            {elements}
          </g>
        );
      })}
      {Array.from({ length: ticks + 1 }, (_, tick) => (
        <line
          key={`grid-${tick}`}
          x1={LEFT + tick * STEP}
          y1={TOP - 4}
          x2={LEFT + tick * STEP}
          y2={height - 4}
          stroke="var(--sch-wave-grid)"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}