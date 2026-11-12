/** ConfidenceReport 组装器：六项状态、计数与 allPassed 的唯一来源。 */

import type { CheckState, ConfidenceReport } from '../core/types.ts';
import { RESIDUAL_TOLERANCE } from '../core/types.ts';

export { RESIDUAL_TOLERANCE };
export const MAX_SKIPPED = 3;

export interface CheckItem {
  name: string;
  state: CheckState;
  detail: string;
  skipReason?: string;
}

export interface ConfidenceOptions {
  /** 该型最宽路径容差；缺省 1e-6。 */
  tolerance?: number;
  /** 浏览器端没有构建期 paths 时的跳过理由。 */
  residualUnavailableReason?: string;
}

/**
 * residualOk 只能由 maxResidual 推导，外部传的 residualOk 一律丢弃。
 * maxResidual 必须显式传入（不许默认 0），并与本型 tolerance 比较。
 */
export function buildConfidenceReport(
  checks: CheckItem[],
  maxResidual: number,
  options: ConfidenceOptions = {},
): ConfidenceReport {
  const tolerance = options.tolerance ?? RESIDUAL_TOLERANCE;
  const reason = options.residualUnavailableReason;
  const residual: CheckItem = reason
    ? {
        name: 'residualOk',
        state: 'skipped',
        detail: `残差未测：${reason}`,
        skipReason: reason,
      }
    : {
        name: 'residualOk',
        state: maxResidual <= tolerance ? 'pass' : 'fail',
        detail: `maxResidual=${maxResidual}，tolerance=${tolerance}`,
      };

  const normalized = checks
    .filter((item) => item.name !== 'residualOk')
    .concat(residual);

  const failedCount = normalized.filter(
    (item) => item.state === 'fail' || (item.state === 'skipped' && !item.skipReason),
  ).length;
  const skippedCount = normalized.filter(
    (item) => item.state === 'skipped' && Boolean(item.skipReason),
  ).length;
  const allPassed = failedCount === 0 && skippedCount <= MAX_SKIPPED;

  const stateOf = (name: string): CheckState =>
    normalized.find((item) => item.name === name)?.state ?? 'fail';

  return {
    scopeOk: stateOf('scopeOk'),
    inputOk: stateOf('inputOk'),
    pathsConsistent: stateOf('pathsConsistent'),
    residualOk: stateOf('residualOk'),
    boundaryOk: stateOf('boundaryOk'),
    goldenOk: stateOf('goldenOk'),
    maxResidual,
    checks: normalized,
    failedCount,
    skippedCount,
    allPassed,
  };
}

/** 绿牌的必要条件：全绿 + 构建期 paths/residual 都真的 pass。 */
export function isFullyValidated(report: ConfidenceReport): boolean {
  return (
    report.allPassed &&
    report.pathsConsistent === 'pass' &&
    report.residualOk === 'pass'
  );
}