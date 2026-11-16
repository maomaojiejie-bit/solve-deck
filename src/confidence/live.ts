/**
 * 参数实验场的运行时校验。
 *
 * 构建期三路径（digitaljs/QMC/黄金夹具）不能在浏览器里跑；
 * 这里只调用各 solver 已导出的纯函数做**独立复算**，再交给 buildConfidenceReport 组装六项。
 * 黄金夹具对任意拖动参数不适用，按 skipped + 理由记账，不伪造 pass。
 */

import type { ConfidenceReport, Solution } from '../core/types.ts';
import type {
  SolverInput,
  TemplateEntry,
  TemplateVariant,
} from '../core/templates/registry.ts';
import { buildConfidenceReport } from './confidence.ts';
import { scopeGate } from './scopeGate.ts';

export interface LiveValidation {
  confidence: ConfidenceReport;
  notes: string[];
}

function relative(a: number, b: number): number {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const diff = Math.abs(a - b);
  // 物理量为 0 时相对误差没有意义：A1 截止态的两条路径会给出 0 与 2e-16 A，
  // 若直接除以 1e-12 会得到 2e-4，把正确的截止解判成「两条路径不一致」。
  // 先按绝对容差归零，再对真实非零量算相对误差。
  if (diff <= 1e-12) return 0;
  return diff / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

function maxRelative(pairs: [number, number][]): number {
  return pairs.reduce((max, [a, b]) => Math.max(max, relative(a, b)), 0);
}

function numeric(record: Record<string, number | string>, key: string): number {
  const value = Number(record[key]);
  if (!Number.isFinite(value)) throw new Error(`参数 ${key} 不是有限数`);
  return value;
}

function bitsFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^[01]+$/.test(value)) {
    throw new Error(`位串非法：${String(value)}`);
  }
  return value;
}

/** 返回 [pathsState, maxResidual, pathDetail]。 */
async function runLivePaths(
  entry: TemplateEntry,
  solution: Solution,
  input: SolverInput,
): Promise<{ state: 'pass' | 'fail'; maxResidual: number; detail: string }> {
  const record = input as Record<string, number | string>;
  const id = entry.id;
  try {
    if (id.startsWith('M')) {
      const m = await import('../core/templates/mechanics/paths.ts');
      const result = m.runMechPaths(id, record);
      return {
        state: result.ok ? 'pass' : 'fail',
        maxResidual: result.maxResidual,
        detail: result.detail,
      };
    }
    if (id.startsWith('S')) {
      const m = await import('../core/templates/statics/paths.ts');
      const result = m.runStaticsPaths(id, record);
      return {
        state: result.ok ? 'pass' : 'fail',
        maxResidual: result.maxResidual,
        detail: result.detail,
      };
    }
    if (id === 'A1') {
      const m = await import('../core/templates/analog/A1.ts');
      const p = m.a1Params(record);
      const piece = m.solvePiecewise(p);
      const graph = m.solveGraphical(p);
      const residual = maxRelative([
        [piece.Vout, graph.Vout],
        [piece.I, graph.I],
      ]);
      return {
        state: residual <= 1e-6 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `分段线性 vs 图解法：Vout/I 最大相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A2') {
      const m = await import('../core/templates/analog/A2.ts');
      const p = m.a2Params(record);
      const scalar = m.commitZone(p);
      const mna = m.solveZoneMNA(p, scalar.zone);
      const residual = maxRelative([
        [scalar.ic, mna.ic],
        [scalar.vce, mna.vce],
      ]);
      return {
        state: residual <= 1e-6 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `工作区标量 vs MNA：IC/VCE 最大相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A3') {
      const m = await import('../core/templates/analog/A3.ts');
      const p = m.a3Params(record);
      const mna = m.solveA3MNA(p);
      const closed = m.solveA3Analytic(p);
      const residual = maxRelative([
        [mna.Av, closed.Av],
        [mna.Ri, closed.Ri],
        [mna.Ro, closed.Ro],
      ]);
      return {
        state: residual <= 1e-6 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `MNA vs 含 ro 闭式：Av/Ri/Ro 最大相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A4') {
      const m = await import('../core/templates/analog/A4.ts');
      const p = m.a4Params(record);
      const scalar = m.commitZone(p);
      const mna = m.solveZoneMNA(p, scalar.zone);
      const residual = maxRelative([
        [scalar.id, mna.id],
        [scalar.vds, mna.vds],
      ]);
      return {
        state: residual <= 1e-6 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `工作区标量 vs MNA：ID/VDS 最大相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A5') {
      const m = await import('../core/templates/analog/A5.ts');
      const p = m.a5Params(record);
      const mna = m.solveA5MNA(p);
      const closed = m.solveA5Analytic(p);
      const residual = maxRelative([
        [mna.Av, closed.Av],
        [mna.Ri, closed.Ri],
        [mna.Ro, closed.Ro],
      ]);
      return {
        state: residual <= 1e-6 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `MNA vs 含 gds 闭式：Av/Ri/Ro 最大相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A6') {
      const m = await import('../core/templates/analog/A6.ts');
      const p = m.a6Params(record);
      const ideal = m.idealGain(p);
      const finite = m.finiteGain(p);
      const residual = relative(ideal, finite);
      return {
        state: residual <= 1e-3 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `理想 vs 有限 Aol：Av 相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'A7') {
      const m = await import('../core/templates/analog/A7.ts');
      const p = m.a7Params(record);
      const loop = m.loopGainGain(p);
      const mna = m.closedLoopMNA(p);
      const residual = relative(loop, mna);
      return {
        state: residual <= 5e-3 ? 'pass' : 'fail',
        maxResidual: residual,
        detail: `回路增益 vs 闭环 MNA：Af 相对差 ${residual.toExponential(3)}`,
      };
    }
    if (id === 'D4') {
      const m = await import('../core/templates/digital/D4.ts');
      const ff = String(record.ff ?? 'JK') as 'JK';
      const q0 = Number(record.q0 ?? 0) === 1 ? 1 : 0;
      const j = bitsFrom(record.j);
      const k = bitsFrom(record.k);
      let q: 0 | 1 = q0;
      let sequence = '';
      for (let index = 0; index < j.length; index += 1) {
        q = m.nextState(ff, q, {
          j: j[index] === '1' ? 1 : 0,
          k: k[index] === '1' ? 1 : 0,
        }).q;
        sequence += String(q);
      }
      const matches = sequence === String(solution.result.sequence);
      return {
        state: matches ? 'pass' : 'fail',
        maxResidual: matches ? 0 : 1,
        detail: `nextState 逐拍重放：${sequence} vs ${String(solution.result.sequence)}`,
      };
    }
    if (id === 'D5') {
      const kind = String(record.kind ?? 'seq-detector');
      if (kind !== 'seq-detector') {
        return {
          state: 'fail',
          maxResidual: 1,
          detail: `D5 运行时校验只覆盖 seq-detector，当前 ${kind}`,
        };
      }
      const pattern = bitsFrom(record.pattern);
      const inputBits = bitsFrom(record.input);
      let outputs = '';
      for (let index = 0; index < inputBits.length; index += 1) {
        const suffix = inputBits.slice(0, index + 1).slice(-pattern.length);
        outputs += suffix === pattern ? '1' : '0';
      }
      const matches = outputs === String(solution.result.outputs);
      return {
        state: matches ? 'pass' : 'fail',
        maxResidual: matches ? 0 : 1,
        detail: `直接后缀扫描：${outputs} vs ${String(solution.result.outputs)}`,
      };
    }
    if (id === 'D6') {
      const m = await import('../core/templates/digital/D6.ts');
      const value = numeric(record, 'value');
      const bits = numeric(record, 'bits');
      const binary = m.fixedBits(value, bits);
      const expectedBinary = `0b${binary}`;
      const matches = String(solution.result.binary) === expectedBinary;
      return {
        state: matches ? 'pass' : 'fail',
        maxResidual: matches ? 0 : 1,
        detail: `fixedBits 回验：${expectedBinary} vs ${String(solution.result.binary)}`,
      };
    }
    return {
      state: 'fail',
      maxResidual: 1,
      detail: `${id} 尚未接入运行时复算`,
    };
  } catch (error) {
    return {
      state: 'fail',
      maxResidual: 1,
      detail: `运行时复算异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validateLive(
  entry: TemplateEntry,
  _variant: TemplateVariant | undefined,
  solution: Solution,
  input: SolverInput,
): Promise<LiveValidation> {
  const notes: string[] = [];
  const scope = scopeGate(entry.id);
  const paths = await runLivePaths(entry, solution, input);

  let boundary = { state: 'pass' as 'pass' | 'fail', detail: '边界检查通过' };
  if (entry.id === 'A2') {
    const zone = String(solution.result.zone);
    if (zone !== 'active') {
      boundary = {
        state: 'fail',
        detail: `管子已进入 ${zone === 'cutoff' ? '截止' : '饱和'}区，线性模型不适用`,
      };
    }
  } else if (entry.id === 'A4') {
    const zone = String(solution.result.zone);
    if (zone !== 'saturation') {
      boundary = {
        state: 'fail',
        detail: `管子已进入 ${zone === 'cutoff' ? '截止' : '三极管'}区，线性模型不适用`,
      };
    }
  } else if (entry.id === 'A3' || entry.id === 'A5') {
    const ri = solution.result.Ri;
    const ro = solution.result.Ro;
    const ok = (value: number | string) =>
      value === '∞' || (Number.isFinite(Number(value)) && Number(value) > 0);
    if (!ok(ri) || !ok(ro)) boundary = { state: 'fail', detail: 'Ri/Ro 非正或非有限' };
  }

  if (entry.id === 'A7') {
    const t = Number(solution.result.T);
    if (t < 100) {
      notes.push(
        `回路增益 T=${t.toFixed(1)} < 100，超出深度负反馈近似域；Af 只给 AfLoop/MNA 值`,
      );
    }
  }

  if (entry.id === 'A3' || entry.id === 'A5') {
    const av = Number(solution.result.Av);
    const noRo = Number(solution.result.AvNoRo);
    if (Number.isFinite(av) && Number.isFinite(noRo) && av !== 0) {
      const error = Math.abs((noRo - av) / av);
      const va = Number((input as Record<string, number | string>).VA);
      if (error > 0.01 || (entry.id === 'A3' && Number.isFinite(va) && va < 100)) {
        const detail =
          entry.id === 'A3'
            ? Number.isFinite(va) && va < 100
              ? `当前 VA=${va}V 下该近似不成立`
              : '误差超过 1% 即不可忽略'
            : '当前 ro 较低，该近似不成立';
        notes.push(`忽略 ro 会差 ${(error * 100).toFixed(2)}% —— ${detail}`);
      }
    }
  }

  if (paths.state === 'fail') notes.push(paths.detail);
  if (boundary.state === 'fail') notes.push(boundary.detail);

  const tolerance =
    Math.max(...entry.paths.map((path) => path.tolerance ?? 1e-6), 1e-6);
  const confidence = buildConfidenceReport(
    [
      { name: 'scopeOk', state: scope.ok ? 'pass' : 'fail', detail: scope.detail },
      {
        name: 'inputOk',
        state: 'pass',
        detail: '参数实验场输入已通过求解器域检查',
      },
      { name: 'pathsConsistent', state: paths.state, detail: paths.detail },
      { name: 'boundaryOk', state: boundary.state, detail: boundary.detail },
      {
        name: 'goldenOk',
        state: 'skipped',
        detail: '黄金夹具只覆盖固定输入',
        skipReason: '参数实验场输入不在构建期夹具集，夹具不适用',
      },
    ],
    paths.maxResidual,
    { tolerance },
  );

  return { confidence, notes };
}