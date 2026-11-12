/** 构建期完整校验：唯一允许调用 digitaljs/QMC 的入口。 */

import type { ConfidenceReport, Netlist, Solution } from '../../core/types';
import type { SolverInput } from '../../core/templates/registry';
import { validateRuntime, type RuntimePathsResult } from '../index.ts';
import { runD1Paths } from './d1Paths.ts';
import { runD3Paths } from './d3Paths.ts';
import { runD4Paths } from './d4Paths.ts';
import { runD5Paths } from './d5Paths.ts';
import { runD6Paths } from './d6Paths.ts';
import { runA1Paths } from './a1Paths.ts';
import { runA2Paths } from './a2Paths.ts';
import { runA3Paths } from './a3Paths.ts';
import { runA4Paths } from './a4Paths.ts';
import { runA5Paths } from './a5Paths.ts';
import { runA6Paths } from './a6Paths.ts';
import { runA7Paths } from './a7Paths.ts';
import { runPaths } from './paths.ts';
import { runMechPaths } from '../../core/templates/mechanics/paths.ts';
import { runStaticsPaths } from '../../core/templates/statics/paths.ts';

function pathsFor(solution: Solution, input: SolverInput): RuntimePathsResult {
  const templateId = solution.templateId;
  try {
    if (templateId === 'D2') {
      if ('kind' in input && input.kind === 'logic') {
        const result = runPaths(input as Netlist);
        return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
      }
      return { state: 'fail', detail: 'D2 需要逻辑网表', maxResidual: 1 };
    }
    if ('devices' in input || 'members' in input) {
      return { state: 'fail', detail: `${templateId} 需要结构化已知量，不接受网表`, maxResidual: 1 };
    }
    const record = input as Record<string, number | string>;
    if (templateId === 'D1') {
      const result = runD1Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'D3') {
      const result = runD3Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'D4') {
      const result = runD4Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'D5') {
      const result = runD5Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'D6') {
      const result = runD6Paths(record, solution.result);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A1') {
      const result = runA1Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A2') {
      const result = runA2Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A3') {
      const result = runA3Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A4') {
      const result = runA4Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A5') {
      const result = runA5Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A6') {
      const result = runA6Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId === 'A7') {
      const result = runA7Paths(record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId.startsWith('S')) {
      const result = runStaticsPaths(templateId, record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    if (templateId.startsWith('M')) {
      const result = runMechPaths(templateId, record);
      return { state: result.ok ? 'pass' : 'fail', detail: result.detail, maxResidual: result.maxResidual };
    }
    return { state: 'fail', detail: `${templateId} 尚未接入三路径`, maxResidual: 1 };
  } catch (error) {
    return {
      state: 'fail',
      detail: `三路径异常：${error instanceof Error ? error.message : String(error)}`,
      maxResidual: 1,
    };
  }
}

export function validateSolution(
  solution: Solution,
  input?: SolverInput,
): ConfidenceReport {
  if (!input) {
    return validateRuntime(solution, {
      paths: { state: 'fail', detail: '缺少输入，三路径未执行', maxResidual: 1 },
    });
  }
  return validateRuntime(solution, { paths: pathsFor(solution, input) });
}