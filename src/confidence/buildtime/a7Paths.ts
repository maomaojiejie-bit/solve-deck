/** A7 三路径：环路增益 / 闭环 MNA / 深度负反馈渐近判据。 */

import {
  a7Params,
  loopGain,
  loopGainGain,
  sweepFeedback,
} from '../../core/templates/analog/A7.ts';

/** 与 registry 里 asymptotic 声明的最松容差 / 误差带必须一致（check:paths 会核对）。 */
export const A7_PATH_TOLERANCE = 5e-3;
export const A7_DOMAIN_BAND = 0.05;

export interface A7PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'loop-gain';
  pathBIntermediate: 'closed-loop-mna';
  pathCIntermediate: 'asymptotic-error';
  points: { T: number; loop: number; mna: number; deep: number; error: number; inDomain: boolean }[];
  monotonic: boolean;
  within5Percent: boolean;
}

type Input = Record<string, number | string>;

export function runA7Paths(input: Input): A7PathsResult {
  const params = a7Params(input);
  const sweep = sweepFeedback(params);
  const points = sweep.map((point) => ({
    T: point.T,
    loop: loopGainGain({ ...params, beta: point.beta }),
    mna: point.mna,
    deep: point.deep,
    error: point.error,
    inDomain: point.inDomain,
  }));

  // 深度负反馈近似只在 T≥100 的适域内成立；T<100 直接判超域，不参与残差。
  const domain = points.filter((point) => point.inDomain);
  let monotonic = true;
  for (let index = 1; index < domain.length; index += 1) {
    if (!(domain[index].error < domain[index - 1].error)) monotonic = false;
  }
  const within5Percent = domain.every((point) => point.error < A7_DOMAIN_BAND);
  const last = domain[domain.length - 1];
  if (!last) throw new Error('A7 没有落入 T≥100 适域的点');
  const loopVsMna = Math.abs((last.loop - last.mna) / last.mna);
  const maxResidual = Math.max(last.error, loopVsMna);
  const ok = monotonic && within5Percent && maxResidual <= A7_PATH_TOLERANCE && loopGain(params) > 0;

  return {
    ok,
    maxResidual: ok ? maxResidual : 1,
    detail: ok
      ? `T<100 超域；T=100→1000 误差 ${domain.map((point) => `${(point.error * 100).toFixed(2)}%`).join('→')}，单调下降；T≥100 <5%`
      : !monotonic
        ? '深度负反馈近似误差不随 T 单调下降'
        : !within5Percent
          ? 'T≥100 时仍有误差 ≥5%'
          : `闭环解不一致：loop vs MNA = ${loopVsMna.toExponential(2)}`,
    pathAIntermediate: 'loop-gain',
    pathBIntermediate: 'closed-loop-mna',
    pathCIntermediate: 'asymptotic-error',
    points,
    monotonic,
    within5Percent,
  };
}