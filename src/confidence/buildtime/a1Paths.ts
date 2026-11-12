/** A1 三路径：图解法 / 分段线性 / 理想上下界。 */

import {
  a1Params,
  idealBounds,
  solveGraphical,
  solvePiecewise,
  type A1Point,
} from '../../core/templates/analog/A1.ts';

export interface A1PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'load-line-intersection';
  pathBIntermediate: 'piecewise-states';
  pathCIntermediate: 'ideal-bounds';
}

type Input = Record<string, number | string>;

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

function compare(a: A1Point, b: A1Point): number {
  return Math.max(rel(a.Vout, b.Vout), rel(a.I, b.I));
}

export function runA1Paths(input: Input): A1PathsResult {
  const params = a1Params(input);
  const graphical = solveGraphical(params);
  const piecewise = solvePiecewise(params);
  const bounds = idealBounds(params);
  const numeric = compare(graphical, piecewise);
  const inBounds = graphical.Vout >= bounds.low - 1e-9 && graphical.Vout <= bounds.high + 1e-9;
  const ok = inBounds && numeric <= 1e-3;
  return {
    ok,
    maxResidual: ok ? numeric : Math.max(1, numeric),
    detail: ok
      ? `A/B 一致（Vout=${graphical.Vout.toFixed(4)}V），C 理想上下界 [${bounds.low.toFixed(3)}, ${bounds.high.toFixed(3)}] 包含真值`
      : inBounds
        ? `A/B 离散：Vout=${graphical.Vout} vs ${piecewise.Vout}`
        : `C 理想上下界 [${bounds.low}, ${bounds.high}] 不包含 ${graphical.Vout}`,
    pathAIntermediate: 'load-line-intersection',
    pathBIntermediate: 'piecewise-states',
    pathCIntermediate: 'ideal-bounds',
  };
}
