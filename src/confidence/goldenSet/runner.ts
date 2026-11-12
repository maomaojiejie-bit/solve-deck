/** 黄金夹具运行器：按题型跑真实 solver，比较 expected 的每个键。 */

import type { Solution } from '../../core/types';
import type { SolverInput } from '../../core/templates/registry';
import { solveD1 } from '../../core/templates/digital/D1.ts';
import { solveD2 } from '../../core/templates/digital/D2.ts';
import { solveD3 } from '../../core/templates/digital/D3.ts';
import { solveD4 } from '../../core/templates/digital/D4.ts';
import { solveD5 } from '../../core/templates/digital/D5.ts';
import { solveD6 } from '../../core/templates/digital/D6.ts';
import { solveA1 } from '../../core/templates/analog/A1.ts';
import { solveA2 } from '../../core/templates/analog/A2.ts';
import { solveA3 } from '../../core/templates/analog/A3.ts';
import { solveA4 } from '../../core/templates/analog/A4.ts';
import { solveA5 } from '../../core/templates/analog/A5.ts';
import { solveA6 } from '../../core/templates/analog/A6.ts';
import { solveA7 } from '../../core/templates/analog/A7.ts';
import { solveM1 } from '../../core/templates/mechanics/M1.ts';
import { solveM2 } from '../../core/templates/mechanics/M2.ts';
import { solveM3 } from '../../core/templates/mechanics/M3.ts';
import { solveM4 } from '../../core/templates/mechanics/M4.ts';
import { solveM5 } from '../../core/templates/mechanics/M5.ts';
import { solveM6 } from '../../core/templates/mechanics/M6.ts';
import { solveM7 } from '../../core/templates/mechanics/M7.ts';
import { solveM8 } from '../../core/templates/mechanics/M8.ts';
import { solveS1 } from '../../core/templates/statics/S1.ts';
import { solveS2 } from '../../core/templates/statics/S2.ts';
import { solveS3 } from '../../core/templates/statics/S3.ts';
import { solveS4 } from '../../core/templates/statics/S4.ts';
import { solveS5 } from '../../core/templates/statics/S5.ts';
import { solveS6 } from '../../core/templates/statics/S6.ts';
import { solveS7 } from '../../core/templates/statics/S7.ts';
import { goldenCasesFor } from './index.ts';

export interface GoldenRunResult {
  ok: boolean;
  detail: string;
  maxResidual: number;
  cases: number;
}

const SOLVERS: Record<string, (input: SolverInput) => Solution> = {
  D1: solveD1,
  D2: solveD2,
  D3: solveD3,
  D4: solveD4,
  D5: solveD5,
  D6: solveD6,
  A1: solveA1,
  A2: solveA2,
  A3: solveA3,
  A4: solveA4,
  A5: solveA5,
  A6: solveA6,
  A7: solveA7,
  M1: solveM1,
  M2: solveM2,
  M3: solveM3,
  M4: solveM4,
  M5: solveM5,
  M6: solveM6,
  M7: solveM7,
  M8: solveM8,
  S1: solveS1,
  S2: solveS2,
  S3: solveS3,
  S4: solveS4,
  S5: solveS5,
  S6: solveS6,
  S7: solveS7,
};

export function runGoldenSet(templateId: string): GoldenRunResult {
  const cases = goldenCasesFor(templateId);
  if (cases.length === 0) {
    return { ok: false, detail: `${templateId} 没有黄金夹具`, maxResidual: 0, cases: 0 };
  }
  const solver = SOLVERS[templateId];
  if (!solver) {
    return { ok: false, detail: `${templateId} 没有可运行的 golden solver`, maxResidual: 0, cases: cases.length };
  }

  for (const item of cases) {
    const solution = solver(item.input as SolverInput);
    for (const [key, expected] of Object.entries(item.expected)) {
      const actual = solution.result[key];
      const bothNumbers = typeof actual === 'number' && typeof expected === 'number';
      const matches = bothNumbers
        ? Math.abs(actual - expected) <= item.residualThreshold
        : String(actual) === String(expected);
      if (!matches) {
        return {
          ok: false,
          detail: `${item.id}.${key} 期望 ${expected}，实际 ${actual}`,
          maxResidual: item.residualThreshold,
          cases: cases.length,
        };
      }
    }
  }

  return {
    ok: true,
    detail: `${cases.length} 道夹具通过`,
    maxResidual: 0,
    cases: cases.length,
  };
}