/**
 * A3 三路径：
 *  A MNA 小信号       → 'small-signal-params'
 *  B 端口测试法       → 'port-test-results'
 *  C 手推闭式（含 ro） → 'symbolic-residuals'
 */

import {
  a3Params,
  solveA3Analytic,
  solveA3MNA,
  solveA3PortTest,
  type A3Point,
} from '../../core/templates/analog/A3.ts';

export interface A3PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'small-signal-params';
  pathBIntermediate: 'port-test-results';
  pathCIntermediate: 'symbolic-residuals';
  avA: number;
  avB: number;
  avC: number;
  relAv: number;
  relRi: number;
  relRo: number;
}

type Input = Record<string, number | string>;
/** 与 registry 里 symbolic-equiv 声明的 tolerance 必须一致（check:paths 会核对）。 */
export const A3_PATH_TOLERANCE = 1e-6;
const TOLERANCE = A3_PATH_TOLERANCE;

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

function compare(a: A3Point, b: A3Point) {
  return {
    av: rel(a.Av, b.Av),
    ri: rel(a.Ri, b.Ri),
    ro: rel(a.Ro, b.Ro),
  };
}

export function runA3Paths(input: Input): A3PathsResult {
  const params = a3Params(input);
  const a = solveA3MNA(params);
  const b = solveA3PortTest(params);
  const c = solveA3Analytic(params);
  const ab = compare(a, b);
  const ac = compare(a, c);
  const relAv = Math.max(ab.av, ac.av);
  const relRi = Math.max(ab.ri, ac.ri);
  const relRo = Math.max(ab.ro, ac.ro);
  const maxResidual = Math.max(relAv, relRi, relRo);
  const ok = maxResidual <= TOLERANCE;
  return {
    ok,
    maxResidual,
    detail: ok
      ? `A/B/C 一致：Av=${a.Av.toFixed(5)}；最大相对偏差 ${maxResidual.toExponential(3)}`
      : `三路径离散：ΔAv=${relAv.toExponential(3)} ΔRi=${relRi.toExponential(3)} ΔRo=${relRo.toExponential(3)}`,
    pathAIntermediate: 'small-signal-params',
    pathBIntermediate: 'port-test-results',
    pathCIntermediate: 'symbolic-residuals',
    avA: a.Av,
    avB: b.Av,
    avC: c.Av,
    relAv,
    relRi,
    relRo,
  };
}