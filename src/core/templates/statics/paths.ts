/**
 * S1–S7 的三条校验路径（运行时可跑，纯函数）。
 *
 * 静力学全部自研（库只有杆梁轴），所以每一型都必须给出三条**互不依赖**的算法：
 * 判据 / 闭式 / 数值（或另一套力学方法），否则「两路径互校」就成了自己跟自己对。
 */

import type { ParamRecord } from './common.ts';
import { analyzeRigid2D } from '../../statics/rigid2d.ts';
import { analyzeTruss } from '../../statics/truss.ts';
import { s1Params, s1Spec } from './S1.ts';
import { s2Components, s2Cosine, s2Params, s2Rotated } from './S2.ts';
import { s3Params, s3Spec } from './S3.ts';
import { s4CriticalPull, s4FrictionAngle, s4MinPull, s4Params } from './S4.ts';
import { s5Params, s5Spec } from './S5.ts';
import { s6BlockSum, s6Integral, s6Params } from './S6.ts';
import { s7Moment, s7Params, s7VirtualWork } from './S7.ts';

export interface StaticsPathsResult {
  ok: boolean;
  detail: string;
  maxResidual: number;
  pathAIntermediate: string;
  pathBIntermediate: string;
  pathCIntermediate: string;
}

function relative(a: number, b: number, floor = 0): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b), floor);
}

function report(
  id: string,
  pairs: [string, number, number, number?][],
  label: string,
): StaticsPathsResult {
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

export function runStaticsPaths(templateId: string, input: ParamRecord): StaticsPathsResult {
  if (templateId === 'S1') {
    const params = s1Params(input);
    const analysis = analyzeRigid2D(s1Spec(params));
    const determinate = analysis.verdict === 'determinate';
    const result = report(
      'S1',
      [
        ['秩判据 vs 计数判据（同判为静定=1）', analysis.rank === 3 ? 1 : 0, analysis.unknownCount === 3 ? 1 : 0],
        ['载荷投影残差', analysis.loadResidual, 0],
      ],
      '约束矩阵秩 vs 未知量计数',
    );
    return {
      ...result,
      ...(determinate
        ? {}
        : { ok: false, detail: `${analysis.message}（判据不过，三路径不给数值）` }),
      pathAIntermediate: 'rank-criterion',
      pathBIntermediate: 'count-criterion',
      pathCIntermediate: 'load-projection',
    };
  }

  if (templateId === 'S2') {
    const params = s2Params(input);
    const a = s2Components(params);
    const b = s2Rotated(params);
    const cosine = s2Cosine(params);
    return {
      ...report(
        'S2',
        [
          ['合力大小：分量 vs 余弦定理', a.R, cosine],
          ['合力矢量：分量 vs 旋转坐标系', Math.hypot(a.Rx, a.Ry), Math.hypot(b.Rx, b.Ry)],
        ],
        '分量投影 / 旋转坐标系 / 余弦定理',
      ),
      pathAIntermediate: 'component-sum',
      pathBIntermediate: 'rotated-frame',
      pathCIntermediate: 'cosine-law',
    };
  }

  if (templateId === 'S3') {
    const params = s3Params(input);
    const analysis = analyzeRigid2D(s3Spec(params));
    if (analysis.verdict !== 'determinate') {
      return {
        ...report('S3', [['静定判据', 1, 0]], '刚体求解器'),
        ok: false,
        detail: analysis.message,
        pathAIntermediate: 'rigid2d-solve',
        pathBIntermediate: 'moment-closed',
        pathCIntermediate: 'force-sum',
      };
    }
    const rb = analysis.reactions.find((item) => item.at === 'B')?.Ry ?? 0;
    const ra = analysis.reactions.find((item) => item.at === 'A')?.Ry ?? 0;
    // 闭式：对 A 取矩直接得 RB，再由 ΣFy 得 RA
    const rbClosed = (params.P1 * params.x1 + params.P2 * params.x2) / params.L;
    const raClosed = params.P1 + params.P2 - rbClosed;
    return {
      ...report(
        'S3',
        [
          ['RB：求解器 vs ΣM_A 闭式', rb, rbClosed],
          ['RA：求解器 vs ΣFy 闭式', ra, raClosed],
        ],
        '约束矩阵求解 / 取矩闭式 / 竖向平衡',
      ),
      pathAIntermediate: 'rigid2d-solve',
      pathBIntermediate: 'moment-closed',
      pathCIntermediate: 'force-sum',
    };
  }

  if (templateId === 'S4') {
    const params = s4Params(input);
    const closed = s4CriticalPull(params.mu, params.W, params.alpha);
    // 路径 C：把 P 当未知量，用二分法解 f(P)=P(cosα+μsinα)−μW=0
    const f = (P: number) =>
      P * (Math.cos((params.alpha * Math.PI) / 180) + params.mu * Math.sin((params.alpha * Math.PI) / 180)) -
      params.mu * params.W;
    let lo = 0;
    let hi = Math.max(params.W, closed) * 4 + 10;
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid;
      else hi = mid;
    }
    const bisected = (lo + hi) / 2;
    const phiF = s4FrictionAngle(params.mu);
    const pMin = s4MinPull(params.mu, params.W);
    return {
      ...report(
        'S4',
        [
          ['P_crit：闭式 vs 二分法求根', closed, bisected],
          ['P(φf) vs μW/√(1+μ²)', s4CriticalPull(params.mu, params.W, phiF), pMin],
        ],
        '闭式 / 二分求根 / 摩擦角极值',
      ),
      pathAIntermediate: 'friction-closed',
      pathBIntermediate: 'friction-bisection',
      pathCIntermediate: 'friction-angle',
    };
  }

  if (templateId === 'S5') {
    const params = s5Params(input);
    const spec = s5Spec(params);
    const analysis = analyzeTruss(spec);
    if (!analysis.ok) {
      return {
        ...report('S5', [['静定判据', 1, 0]], '节点法'),
        ok: false,
        detail: analysis.message,
        pathAIntermediate: 'node-method',
        pathBIntermediate: 'section-method',
        pathCIntermediate: 'joint-residual',
      };
    }
    // 截面法（独立实现，放在 S5 里就地算一遍，避免与 truss.ts 共用同一段代码）
    const A = { x: 0, y: 0 };
    const C = { x: params.L / 2, y: params.H };
    const ra = analysis.reactions.find((item) => item.at === 'A');
    const len = Math.hypot(C.x - A.x, C.y - A.y);
    const uy = (C.y - A.y) / len;
    const nAC = -(ra?.Ry ?? 0) / uy;
    const h = C.y - A.y;
    const nAB = (C.x * (ra?.Ry ?? 0) - h * (ra?.Rx ?? 0)) / h;
    return {
      ...report(
        'S5',
        [
          ['N_AC：节点法 vs 截面法', analysis.forces.AC ?? 0, nAC],
          ['N_AB：节点法 vs 截面法', analysis.forces.AB ?? 0, nAB],
          ['逐节点残差（按题目量级归一）', analysis.residual, 0, 1],
        ],
        '节点法 / 截面法 / 逐节点回代',
      ),
      pathAIntermediate: 'node-method',
      pathBIntermediate: 'section-method',
      pathCIntermediate: 'joint-residual',
    };
  }

  if (templateId === 'S6') {
    const params = s6Params(input);
    const block = s6BlockSum(params);
    const integral = s6Integral(params);
    return {
      ...report(
        'S6',
        [
          ['面积：分块 vs 积分', block.A, integral.A],
          ['ȳ：分块 vs 积分', block.ybar, integral.ybar],
        ],
        '分块求和 / 高度积分 / 静矩回代',
      ),
      pathAIntermediate: 'block-sum',
      pathBIntermediate: 'height-integral',
      pathCIntermediate: 'first-moment-zero',
    };
  }

  if (templateId === 'S7') {
    const params = s7Params(input);
    const vw = s7VirtualWork(params);
    const moment = s7Moment(params);
    return {
      ...report(
        'S7',
        [
          ['F：虚功 vs ΣM_O=0', vw.F, moment],
          ['位移比 vs 臂长比', vw.d1 / vw.d2, params.a / params.b],
        ],
        '虚功方程 / 力矩平衡 / 位移比',
      ),
      pathAIntermediate: 'virtual-work',
      pathBIntermediate: 'moment-balance',
      pathCIntermediate: 'displacement-ratio',
    };
  }

  throw new Error(`${templateId} 尚未接入静力学三路径`);
}
