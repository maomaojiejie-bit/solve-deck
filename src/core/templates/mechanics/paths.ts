/**
 * M1–M4 的三条校验路径（运行时可跑，纯函数）。
 *
 * A 库复刻：solveMech 的内力/应力（被 check:mech-parity 钉在 1e-9）
 * B 闭式：材料力学定义式，独立于库的实现
 * C 数值：积分/累积，不引用闭式结论
 *
 * 三条 principle 与 intermediate 必须两两不同，否则注册表不变量会拦。
 */

import type { MechSolution } from '../../mechanics/solve.ts';
import { solveMech } from '../../mechanics/solve.ts';
import { m1Closed, m1Numeric, m1Params, m1Spec } from './M1.ts';
import { m2Closed, m2Numeric, m2Params, m2Spec } from './M2.ts';
import {
  m3CantileverClosed,
  m3CantileverNumeric,
  m3CantileverSpec,
  m3Closed,
  m3Numeric,
  m3Params,
  m3Spec,
} from './M3.ts';
import { m4Closed, m4Numeric, m4Params, m4Spec } from './M4.ts';
import { deflectionFromMoment } from './beamIntegration.ts';
import { m5Closed, m5EI, m5Params, m5Spec, m5VirtualWork } from './M5.ts';
import { m6Closed, m6ExtremumSearch, m6InvariantRoots, m6Params } from './M6.ts';
import { m7Euler, m7Params, m7RayleighClosed, m7RayleighNumeric } from './M7.ts';
import { m8Closed, m8IntegrateBack, m8Params, m8Spec, m8Stress } from './M8.ts';
import type { ParamRecord } from './common.ts';

export interface MechPathsResult {
  ok: boolean;
  detail: string;
  maxResidual: number;
  pathAIntermediate: string;
  pathBIntermediate: string;
  pathCIntermediate: string;
}

/**
 * 相对差。第三个参数是「量级下限」：当期望值本身可能是 0（例如 Pn=0 时 N=0），
 * 裸相对误差会被 1e-14 的舍入噪声放大成假失败，这时用题目的受力量级来折算。
 */
function relative(a: number, b: number, floor = 0): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b), floor);
}

function report(
  id: string,
  pairs: [string, number, number, number?][],
  label: string,
): MechPathsResult {
  let worst = 0;
  let worstName = '';
  for (const [name, a, b, floor] of pairs) {
    const value = relative(a, b, floor);
    if (value > worst) {
      worst = value;
      worstName = name;
    }
  }
  const ok = worst <= 1e-9;
  return {
    ok,
    detail: ok
      ? `${id} ${label}：最大相对差 ${worst.toExponential(3)}`
      : `${id} ${label}：${worstName} 相对差 ${worst.toExponential(3)} 超过 1e-9`,
    maxResidual: worst,
    pathAIntermediate: '',
    pathBIntermediate: '',
    pathCIntermediate: '',
  };
}

function requireDeterminate(sol: MechSolution): void {
  if (!sol.determinate) throw new Error(sol.message ?? '静不定，当前只解静定');
}

export function runMechPaths(templateId: string, input: ParamRecord): MechPathsResult {
  if (templateId === 'M1') {
    const params = m1Params(input);
    const sol = solveMech(m1Spec(params));
    requireDeterminate(sol);
    const closed = m1Closed(params);
    const numeric = m1Numeric(params);
    return {
      ...report(
        'M1',
        [
          ['σmax', sol.stresses.sigma_max ?? 0, closed.sigma / 1e6],
          ['ΔL 闭式 vs 数值', closed.deltaL, numeric.deltaL],
        ],
        '库 vs 闭式 / 闭式 vs 数值积分',
      ),
      pathAIntermediate: 'mech-internal-force',
      pathBIntermediate: 'axial-closed',
      pathCIntermediate: 'axial-integrated',
    };
  }

  if (templateId === 'M2') {
    const params = m2Params(input);
    const sol = solveMech(m2Spec(params));
    requireDeterminate(sol);
    const closed = m2Closed(params);
    const numeric = m2Numeric(params);
    return {
      ...report(
        'M2',
        [
          ['τmax', sol.stresses.tau_torsion_max ?? 0, closed.tau],
          ['φ 闭式 vs 数值', closed.phi, numeric.phi],
        ],
        '库 vs 闭式 / 闭式 vs 分段积分',
      ),
      pathAIntermediate: 'mech-torque',
      pathBIntermediate: 'torsion-closed',
      pathCIntermediate: 'torsion-integrated',
    };
  }

  if (templateId === 'M3') {
    const cantilever = String(input.config ?? '') === 'cantilever';
    const params = m3Params(input);
    const sol = solveMech(cantilever ? m3CantileverSpec(params) : m3Spec(params));
    requireDeterminate(sol);
    const closed = cantilever ? m3CantileverClosed(params) : m3Closed(params);
    const numeric = cantilever ? m3CantileverNumeric(params) : m3Numeric(params);
    return {
      ...report(
        'M3',
        [
          ['|M|max 库 vs 闭式', sol.extrema.M?.abs_max ?? 0, closed.Mmax],
          ['|M|max 闭式 vs 数值积分', closed.Mmax, numeric.Mmax],
        ],
        '库 diagrams vs 静力闭式 / 闭式 vs q 累积积分',
      ),
      pathAIntermediate: 'mech-diagrams',
      pathBIntermediate: 'beam-closed',
      pathCIntermediate: 'beam-integrated',
    };
  }

  if (templateId === 'M4') {
    const params = m4Params(input);
    const sol = solveMech(m4Spec(params));
    requireDeterminate(sol);
    const closed = m4Closed(params);
    const numeric = m4Numeric(params);
    return {
      ...report(
        'M4',
        [
          ['σmax 库 vs 闭式 M/W', sol.stresses.sigma_max ?? 0, closed.sigma],
          ['σmax 闭式 vs 截面数值积分', closed.sigma, numeric.sigmaMax],
        ],
        '库 stresses vs σ=M/W / 闭式 vs 截面条带积分',
      ),
      pathAIntermediate: 'mech-stresses',
      pathBIntermediate: 'bending-closed',
      pathCIntermediate: 'section-integrated',
    };
  }

  if (templateId === 'M5') {
    const params = m5Params(input);
    const sol = solveMech(m5Spec(params));
    requireDeterminate(sol);
    const mPoints = (sol.diagrams.M ?? []).map((point) => [point.x, point.value * 1000] as [number, number]);
    const curve = deflectionFromMoment(mPoints, m5EI(params));
    const closed = m5Closed(params);
    const vw = m5VirtualWork(params, closed.vMaxX);
    const floor = Math.abs(closed.vMax) * 1e-3;
    return {
      ...report(
        'M5',
        [
          ['δmax 库+双积分 vs 解析闭式', Math.abs(curve.vMax), Math.abs(closed.vMax), floor],
          ['δmax 解析闭式 vs 单位载荷法', Math.abs(closed.vMax), Math.abs(vw), floor],
        ],
        '库弯矩双积分 vs 标准挠曲线 / 挠曲线 vs 虚功',
      ),
      pathAIntermediate: 'mech-deflection',
      pathBIntermediate: 'deflection-closed',
      pathCIntermediate: 'deflection-virtual-work',
    };
  }

  if (templateId === 'M6') {
    const params = m6Params(input);
    const closed = m6Closed(params);
    const searched = m6ExtremumSearch(params);
    const roots = m6InvariantRoots(params);
    const floor = Math.abs(closed.sigma1) * 1e-3;
    return {
      ...report(
        'M6',
        [
          ['σ1 极值搜索 vs 闭式', closed.sigma1, searched.sigma1, floor],
          ['σ2 极值搜索 vs 闭式', closed.sigma2, searched.sigma2, floor],
          ['σ1 闭式 vs 特征方程根', closed.sigma1, roots.sigma1, floor],
        ],
        '数值寻优 vs 莫尔圆闭式 / 闭式 vs 应力不变量',
      ),
      pathAIntermediate: 'principal-search',
      pathBIntermediate: 'principal-closed',
      pathCIntermediate: 'principal-invariant',
    };
  }

  if (templateId === 'M7') {
    const params = m7Params(input);
    const euler = m7Euler(params);
    const rayleigh = m7RayleighClosed(params);
    const numeric = m7RayleighNumeric(params);
    return {
      ...report(
        'M7',
        [
          ['σcr 欧拉公式 vs 能量法解析', euler.sigmaCr, rayleigh.sigmaCr],
          ['σcr 能量法解析 vs 能量法数值积分', rayleigh.sigmaCr, numeric.sigmaCr],
        ],
        'λ 定义式 vs Rayleigh 商 / 解析积分 vs 数值积分',
      ),
      pathAIntermediate: 'euler-critical',
      pathBIntermediate: 'energy-rayleigh',
      pathCIntermediate: 'energy-integrated',
    };
  }

  if (templateId === 'M8') {
    const params = m8Params(input);
    const sol = solveMech(m8Spec(params));
    requireDeterminate(sol);
    const closed = m8Closed(params);
    const fromLib = m8Stress(params, sol.extrema.N?.min ?? 0, sol.stresses.sigma_M ?? 0, sol.extrema.T?.max ?? 0);
    const fromClosed = m8Stress(params, closed.N, closed.M, closed.T);
    const back = m8IntegrateBack(params, fromClosed.sigmaN, fromClosed.sigmaM);
    return {
      ...report(
        'M8',
        [
          ['σmax 库 N/M 组合 vs 悬臂闭式', fromLib.sigmaMax, fromClosed.sigmaMax],
          ['∫σdA 回代 N vs 闭式 N', closed.N, back.N, Math.max(Math.abs(closed.N), Math.abs(closed.M) / params.L)],
          [
            '∫yσdA 回代 M vs 闭式 M',
            closed.M,
            back.M,
            Math.max(Math.abs(closed.M), (Math.abs(closed.N) * params.d) / 2000),
          ],
        ],
        '库内力 + 组合 vs 静力闭式 / 闭式 vs 截面积分回代',
      ),
      pathAIntermediate: 'mech-combined',
      pathBIntermediate: 'combined-closed',
      pathCIntermediate: 'combined-integrated',
    };
  }

  throw new Error(`${templateId} 尚未接入力学三路径`);
}
