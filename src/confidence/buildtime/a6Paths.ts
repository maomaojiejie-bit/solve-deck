/** A6 三路径：虚短解析 / 有限增益 MNA / Aol 极限扫描。 */

import {
  a6Params,
  finiteGain,
  idealGain,
  sweepOpenLoop,
} from '../../core/templates/analog/A6.ts';

/** 与 registry 里 limit-sweep 声明的 tolerance 必须一致（check:paths 会核对）。 */
export const A6_PATH_TOLERANCE = 1e-3;

export interface A6PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'node-equations';
  pathBIntermediate: 'finite-gain-mna';
  pathCIntermediate: 'limit-sweep';
  ideal: number;
  finite: number;
  lastError: number;
  monotonic: boolean;
}

type Input = Record<string, number | string>;

export function runA6Paths(input: Input): A6PathsResult {
  const params = a6Params(input);
  const ideal = idealGain(params);
  const finite = finiteGain(params);
  const sweep = sweepOpenLoop(params);
  let monotonic = true;
  for (let index = 1; index < sweep.length; index += 1) {
    if (!(sweep[index].error < sweep[index - 1].error)) monotonic = false;
  }
  const lastError = sweep[sweep.length - 1].error;
  const rel = Math.abs((finite - ideal) / ideal);
  const ok = monotonic && lastError <= A6_PATH_TOLERANCE && rel <= A6_PATH_TOLERANCE;
  return {
    ok,
    maxResidual: ok ? Math.max(rel, lastError) : 1,
    detail: ok
      ? `虚短解 ${ideal.toFixed(5)}，有限增益 ${finite.toFixed(5)}，Aol=1e7 误差 ${lastError.toExponential(2)}，单调下降`
      : monotonic
        ? `Aol 极限误差 ${lastError.toExponential(2)} 未达 ${A6_PATH_TOLERANCE}，或解析/有限解偏差 ${rel.toExponential(2)}`
        : 'Aol 扫描误差不再单调下降（未收敛）',
    pathAIntermediate: 'node-equations',
    pathBIntermediate: 'finite-gain-mna',
    pathCIntermediate: 'limit-sweep',
    ideal,
    finite,
    lastError,
    monotonic,
  };
}