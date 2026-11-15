/**
 * R-37 · 参数扫描曲线（纯函数部分）。
 *
 * 采样轴、极值、ChartSpec 拼装都不碰 DOM / solver，门禁可直接断言；
 * 真正「循环调 solver」的那一段留在 Result.tsx（那里才有已加载的 solver）。
 * Chart 引擎的硬规矩：yDomain 必须覆盖全部采样点，这里统一加 8% 余量。
 */
import type { ChartSpec } from './types.ts';

export type SweepPoint = [number, number];

/** 等距 / 对数采样；非法区间返回空数组，由 UI 提示而不是画一张怪图。 */
export function sweepAxis(min: number, max: number, count: number, log = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const n = Math.max(2, Math.min(81, Math.floor(count)));
  if (log && min > 0 && max > 0) {
    const a = Math.log(min);
    const b = Math.log(max);
    return Array.from({ length: n }, (_, index) => Math.exp(a + ((b - a) * index) / (n - 1)));
  }
  return Array.from({ length: n }, (_, index) => min + ((max - min) * index) / (n - 1));
}

export interface SweepExtremum {
  x: number;
  y: number;
}

/** 极值从采样点里如实取，不做插值、不编一个「更好看」的峰。 */
export function sweepExtrema(points: readonly SweepPoint[]): { min: SweepExtremum; max: SweepExtremum } | null {
  if (points.length === 0) return null;
  let min = { x: points[0][0], y: points[0][1] };
  let max = { x: points[0][0], y: points[0][1] };
  for (const [x, y] of points) {
    if (!Number.isFinite(y)) continue;
    if (y < min.y) min = { x, y };
    if (y > max.y) max = { x, y };
  }
  return { min, max };
}

export function buildSweepChart(args: {
  key: string;
  xLabel: string;
  yLabel: string;
  unit: string;
  title: string;
  points: readonly SweepPoint[];
}): ChartSpec | null {
  const { points } = args;
  if (points.length < 2) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const span = Math.max(1e-9, y1 - y0);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  return {
    id: `sweep-${args.key}`,
    title: args.title,
    unit: args.unit,
    xLabel: args.xLabel,
    yLabel: args.yLabel,
    xDomain: [x0, x1],
    yDomain: [y0 - span * 0.08, y1 + span * 0.08],
    zeroLine: y0 - span * 0.08 < 0 && y1 + span * 0.08 > 0,
    series: [{ kind: 'line', points: [...points], label: args.yLabel }],
  };
}
