/** A5 三路径：MNA / 端口测试 / 含 ro 的手推闭式。 */

import {
  a5Params,
  solveA5Analytic,
  solveA5MNA,
  solveA5PortTest,
  type A5Point,
} from '../../core/templates/analog/A5.ts';

export interface A5PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'small-signal-params';
  pathBIntermediate: 'port-test-results';
  pathCIntermediate: 'symbolic-residuals';
  avA: number;
  avB: number;
  avC: number;
}

type Input = Record<string, number | string>;
/** 与 registry 里 symbolic-equiv 声明的 tolerance 必须一致（check:paths 会核对）。 */
export const A5_PATH_TOLERANCE = 1e-6;
const TOLERANCE = A5_PATH_TOLERANCE;

function rel(a: number, b: number): number {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

function compare(a: A5Point, b: A5Point): number {
  return Math.max(rel(a.Av, b.Av), rel(a.Ri, b.Ri), rel(a.Ro, b.Ro));
}

export function runA5Paths(input: Input): A5PathsResult {
  const params = a5Params(input);
  const a = solveA5MNA(params);
  const b = solveA5PortTest(params);
  const c = solveA5Analytic(params);
  const maxResidual = Math.max(compare(a, b), compare(a, c));
  const ok = maxResidual <= TOLERANCE;
  return {
    ok,
    maxResidual,
    detail: ok
      ? `A/B/C 一致：Av=${a.Av.toFixed(5)}；最大相对偏差 ${maxResidual.toExponential(3)}`
      : `三路径离散：A/B=${compare(a, b).toExponential(3)}，A/C=${compare(a, c).toExponential(3)}`,
    pathAIntermediate: 'small-signal-params',
    pathBIntermediate: 'port-test-results',
    pathCIntermediate: 'symbolic-residuals',
    avA: a.Av,
    avB: b.Av,
    avC: c.Av,
  };
}