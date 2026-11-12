/**
 * 运行时校验组装入口：纯函数，可进浏览器。
 *
 * 有构建期 paths 结果时，pathsConsistent/residualOk 用真值；
 * 没有时两项都是 skipped + skipReason（浏览器端不跑 digitaljs），绝不冒充 pass。
 */

import type { CheckState, ConfidenceReport, Solution } from '../core/types.ts';
import { RESIDUAL_TOLERANCE } from '../core/types.ts';
import { getTemplate } from '../core/templates/registry.ts';
import { boundaryCheck, unitChecker } from './boundary.ts';
import { buildConfidenceReport, type CheckItem } from './confidence.ts';
import { runGoldenSet } from './goldenSet/runner.ts';
import { scopeGate } from './scopeGate.ts';

function templateTolerance(templateId: string): number {
  try {
    return Math.max(
      RESIDUAL_TOLERANCE,
      ...getTemplate(templateId).paths.map((path) => path.tolerance ?? RESIDUAL_TOLERANCE),
    );
  } catch {
    return RESIDUAL_TOLERANCE;
  }
}

export interface RuntimePathsResult {
  state: CheckState;
  detail: string;
  maxResidual: number;
}

export interface RuntimeValidationOptions {
  paths?: RuntimePathsResult;
}

export function validateRuntime(
  solution: Solution,
  options: RuntimeValidationOptions = {},
): ConfidenceReport {
  const scope = scopeGate(solution.templateId);
  const units = unitChecker(solution.templateId, solution.parsed_given);
  const boundary = boundaryCheck(solution);

  let golden = { ok: false, detail: `${solution.templateId} 黄金夹具未运行` };
  try {
    golden = runGoldenSet(solution.templateId);
  } catch (error) {
    golden = {
      ok: false,
      detail: `夹具异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const paths = options.paths;
  const checks: CheckItem[] = [
    { name: 'scopeOk', state: scope.ok ? 'pass' : 'fail', detail: scope.detail },
    { name: 'inputOk', state: units.ok ? 'pass' : 'fail', detail: units.detail },
    paths
      ? { name: 'pathsConsistent', state: paths.state, detail: paths.detail }
      : {
          name: 'pathsConsistent',
          state: 'skipped',
          detail: '浏览器端不跑 digitaljs',
          skipReason: '浏览器端不跑 digitaljs',
        },
    { name: 'boundaryOk', state: boundary.ok ? 'pass' : 'fail', detail: boundary.detail },
    { name: 'goldenOk', state: golden.ok ? 'pass' : 'fail', detail: golden.detail },
  ];

  return buildConfidenceReport(checks, paths?.maxResidual ?? 0, {
    tolerance: templateTolerance(solution.templateId),
    residualUnavailableReason: paths ? undefined : '浏览器端不跑构建期 paths，残差未测',
  });
}