/**
 * M5 弯曲变形：EI·v''=M，双积分 + 边界条件求挠曲线。
 *
 * 分工必须写在脸上：
 *  - M(x) 来自 `solveMech`（库的复刻，被 check:mech-parity 钉住）；
 *  - v(x) **本页自算** —— 库的 warnings 明说「本工具不计算变形」，图上的
 *    「变形由本页自算」那行字就是照这句写的，不许让人以为是库给的；
 *  - 三条路径互校：库 M + 数值双积分 / 解析挠曲线 / 单位载荷法（虚功）。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { RenderSpec, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMech } from '../../mechanics/solve.ts';
import type { MechSpec } from '../../mechanics/spec.ts';
import type { ParamRecord } from './common.ts';
import {
  beamFigure,
  chartOf,
  checksMatrix,
  framesFor,
  num,
  pendingConfidence,
  reactionArrowsOf,
  selfCheck,
  step,
  verdictAgainstAllow,
} from './common.ts';
import { deflectionByVirtualWork, deflectionFromMoment } from './beamIntegration.ts';

export interface M5Params {
  L: number;
  /** 集中力作用位置，m。 */
  a: number;
  /** 集中力，kN，向下为正。 */
  P: number;
  /** 截面宽，mm。 */
  b: number;
  /** 截面高，mm。 */
  h: number;
  /** 弹性模量，GPa。 */
  E: number;
}

export const M5_DEFAULTS: M5Params = { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 };

/** 常用挠度限值：L/400。写在结论位上，不藏在代码里。 */
export const M5_DEFLECTION_RATIO = 400;

export function m5Params(input: ParamRecord): M5Params {
  const params: M5Params = {
    L: num(input, 'L', M5_DEFAULTS.L),
    a: num(input, 'a', M5_DEFAULTS.a),
    P: num(input, 'P', M5_DEFAULTS.P),
    b: num(input, 'b', M5_DEFAULTS.b),
    h: num(input, 'h', M5_DEFAULTS.h),
    E: num(input, 'E', M5_DEFAULTS.E),
  };
  if (!(params.L > 0)) throw new Error('M5 跨度 L 必须 > 0');
  if (!(params.a > 0) || params.a >= params.L) throw new Error('M5 载荷位置 a 必须落在 (0, L) 内');
  if (params.P < 0) throw new Error('M5 的 P 表示向下的大小，不得为负');
  if (!(params.b > 0) || !(params.h > 0)) throw new Error('M5 截面尺寸必须 > 0');
  if (!(params.E > 0)) throw new Error('M5 弹性模量 E 必须 > 0');
  return params;
}

/** 截面惯性矩，m⁴。 */
export function m5Iy(params: M5Params): number {
  return ((params.b / 1000) * (params.h / 1000) ** 3) / 12;
}

export function m5EI(params: M5Params): number {
  return params.E * 1e9 * m5Iy(params);
}

export function m5Spec(params: M5Params): MechSpec {
  return {
    kind: 'beam',
    length: params.L,
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    loads: [{ type: 'point_force', x: params.a, value: -params.P }],
    section: { shape: 'rect', params: { b: params.b / 1000, h: params.h / 1000 }, E: params.E * 1e9 },
  };
}

/** 弯矩闭式（向下为正的荷载 ⇒ 正弯矩 = 下侧受拉）。 */
export function m5Moment(params: M5Params, x: number): number {
  const RA = (params.P * (params.L - params.a)) / params.L;
  return RA * x - (x > params.a ? params.P * (x - params.a) : 0);
}

export interface M5Shape {
  /** 最大挠度，m，向下为负。 */
  vMax: number;
  vMaxX: number;
  /** 任意点挠度，m，向下为负。 */
  vAt: (x: number) => number;
}

/** 路径 B：简支梁集中力的标准挠曲线（向下为正，取负号与 EI·v''=M 对齐）。 */
export function m5Closed(params: M5Params): M5Shape {
  const { L, a, P } = params;
  const b = L - a;
  const EI = m5EI(params);
  const load = P * 1e3;
  const vDown = (x: number) => {
    if (x <= a) return (load * b * x * (L * L - b * b - x * x)) / (6 * L * EI);
    return (load * a * (L - x) * (2 * L * x - x * x - a * a)) / (6 * L * EI);
  };
  const longer = a >= b ? b : a;
  const xMax = a >= b ? Math.sqrt((L * L - b * b) / 3) : L - Math.sqrt((L * L - a * a) / 3);
  const vMaxDown = (load * longer * (L * L - longer * longer) ** 1.5) / (9 * Math.sqrt(3) * L * EI);
  return { vMax: -vMaxDown, vMaxX: xMax, vAt: (x: number) => -vDown(x) };
}

/** 路径 C：单位载荷法（虚功）求指定点挠度，向下为负。 */
export function m5VirtualWork(params: M5Params, x0: number): number {
  // 库的弯矩是 kN·m（base 单位），EI 是 N·m² —— 这里统一换算到 N·m，
  // 否则挠度会整整差 1000 倍（这个坑 M4 的 σ 分布也踩过）。
  return -deflectionByVirtualWork(
    (x) => m5Moment(params, x) * 1000,
    params.L,
    x0,
    m5EI(params),
    [params.a],
  );
}

export function solveM5(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M5 只接受结构化参数');
  const params = m5Params(input as ParamRecord);
  const sol = solveMech(m5Spec(params));
  if (!sol.determinate) throw new Error('当前版本不解静不定（M5 只挂静定的简支梁）');

  // 同上：库 diagrams 的 M 是 kN·m，双积分要 N·m。
  const mPoints = (sol.diagrams.M ?? []).map((point) => [point.x, point.value * 1000] as [number, number]);
  const curve = deflectionFromMoment(mPoints, m5EI(params));
  const closed = m5Closed(params);
  const vwAtMax = m5VirtualWork(params, closed.vMaxX);

  const deltaMaxMm = Math.abs(curve.vMax) * 1000;
  const closedMm = Math.abs(closed.vMax) * 1000;
  const vwMm = Math.abs(vwAtMax) * 1000;
  const allowMm = (params.L * 1000) / M5_DEFLECTION_RATIO;
  const verdict = verdictAgainstAllow('δmax', deltaMaxMm, allowMm, 'mm');

  const relClosed = Math.abs(deltaMaxMm - closedMm) / Math.max(deltaMaxMm, closedMm, 1e-12);
  const relVw = Math.abs(closedMm - vwMm) / Math.max(closedMm, vwMm, 1e-12);
  // 边界条件残差：库 M 积分回来的 v(0)、v(L) 必须为 0（数值上就是 0，写出来给人看）
  const bcs = Math.max(
    Math.abs(curve.samples[0].v),
    Math.abs(curve.samples[curve.samples.length - 1].v),
  );

  const checks = [
    selfCheck(
      '库 M(x) 双积分 vs 解析挠曲线（δmax）',
      closedMm,
      deltaMaxMm,
      relClosed,
      relClosed < 1e-9,
      '路径 A（库弯矩 + Simpson 双积分）与路径 B（标准挠曲线公式）',
    ),
    selfCheck(
      '解析式 vs 单位载荷法（δmax）',
      closedMm,
      vwMm,
      relVw,
      relVw < 1e-9,
      '路径 B 与路径 C（虚功 ∫MM̄/EI）',
    ),
    selfCheck(
      '边界条件 v(0)=v(L)=0（相对梁长）',
      0,
      bcs / Math.max(params.L, 1e-12),
      bcs / Math.max(params.L, 1e-12),
      bcs / Math.max(params.L, 1e-12) < 1e-12,
      '双积分后已用刚体位移 C·x 消去 v(L)',
    ),
    selfCheck(
      '库 M 的 |M|max 与 P·a(L−a)/L 一致',
      (params.P * params.a * (params.L - params.a)) / params.L,
      sol.extrema.M?.abs_max ?? 0,
      Math.abs((sol.extrema.M?.abs_max ?? 0) - (params.P * params.a * (params.L - params.a)) / params.L) /
        Math.max(sol.extrema.M?.abs_max ?? 1, 1e-12),
      Math.abs((sol.extrema.M?.abs_max ?? 0) - (params.P * params.a * (params.L - params.a)) / params.L) <=
        1e-9 * Math.max(sol.extrema.M?.abs_max ?? 1, 1),
      '交叉核对：库的弯矩极值必须等于静力闭式',
    ),
  ];

  const vPoints = curve.samples.map((item) => [item.x, item.v * 1000] as [number, number]);
  const chart = chartOf({
    id: 'deflection',
    title: '挠曲线',
    unit: 'mm',
    xLabel: 'x (m)',
    yLabel: 'mm',
    xDomain: [0, params.L],
    series: [{ kind: 'line', points: vPoints, label: 'v(x)', fill: true }],
    marks: [
      {
        x: curve.vMaxX,
        y: curve.vMax * 1000,
        text: `δmax=${deltaMaxMm.toFixed(3)} mm`,
        side: 'down',
      },
    ],
    convention: `变形由本页自算，库不含变形：库只出 M(x)，v 由 EI·v''=M 双积分并代入 v(0)=v(L)=0${'\u3000'}[δ]=L/${M5_DEFLECTION_RATIO}`,
  });

  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'beam',
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    pointLoads: [{ x: params.a, value: -params.P, label: `P = ${params.P} kN` }],
    spanLabel: `L = ${params.L} m　b×h = ${params.b}×${params.h} mm`,
    // 反力箭头与 S 系同一条规矩：箭头数 = 载荷数 + 反力数
    withReactions: true,
    reactions: reactionArrowsOf(sol.reactions, { span: params.L }),
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0', 'n-sup-1'],
    ['e-member', 'n-load-0'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
  ]);

  const steps = [
    step(0, '取整体，求支座反力', 'R_A=\\frac{P(L-a)}{L},\\ R_B=\\frac{Pa}{L}',
      `P=${params.P} kN @ x=${params.a} m`, `RA=${((params.P * (params.L - params.a)) / params.L).toFixed(3)} kN`,
      '刚体平衡（库 reactions）', ['n-sup-0', 'n-sup-1']),
    step(1, '弯矩图 M(x)（库）', 'M(x)=R_A x-P\\,(x-a)_{+}',
      '库 diagrams.M，段内线性', `|M|max=${(sol.extrema.M?.abs_max ?? 0).toFixed(3)} kN·m @ x=${(sol.extrema.M?.abs_max_x ?? 0).toFixed(2)} m`,
      '库的截面内力（check:mech-parity 钉住）', ['e-member', 'n-load-0']),
    step(2, '曲率与微分方程', 'EI\\,v\'\'=M(x)',
      `I=${(m5Iy(params) * 1e12).toFixed(1)} mm⁴，EI=${(m5EI(params) / 1e3).toFixed(1)} kN·m²`,
      '对 M 连续积两次：θ=∫M/EI，v=∫θ', '梁的挠曲线微分方程', ['e-member']),
    step(3, '代入边界条件 v(0)=v(L)=0', 'v(x)=\\int_0^x\\theta\\,ds+C x',
      `双积分后 v(L)=${(curve.samples[curve.samples.length - 1].v).toExponential(2)} m，用 C·x 消去`,
      `δmax=${deltaMaxMm.toFixed(4)} mm @ x=${curve.vMaxX.toFixed(3)} m（解析 ${closedMm.toFixed(4)} mm，虚功 ${vwMm.toFixed(4)} mm）`,
      '**变形由本页自算，库不含变形**', ['e-member', 'n-span']),
    step(4, '挠度校核', '\\delta_{max}\\le[\\delta]=L/400',
      `δmax=${deltaMaxMm.toFixed(3)} mm，[δ]=${allowMm.toFixed(2)} mm`, verdict.text,
      `常用挠度限值 L/${M5_DEFLECTION_RATIO}（本页假设，不是库给的）`, ['e-member', 'n-span']),
  ];

  return {
    templateId: 'M5',
    subject: 'mechanics',
    parsed_given: { L: params.L, a: params.a, P: params.P, b: params.b, h: params.h, E: params.E },
    steps,
    result: {
      Iy: Number((m5Iy(params) * 1e12).toFixed(3)),
      Mmax: Number((sol.extrema.M?.abs_max ?? 0).toFixed(6)),
      deltaMax: Number(deltaMaxMm.toFixed(6)),
      deltaMaxX: Number(curve.vMaxX.toFixed(6)),
      deltaAllow: Number(allowMm.toFixed(6)),
      thetaMaxMrad: Number(
        (curve.samples.reduce((acc, item) => (Math.abs(item.theta) > Math.abs(acc) ? item.theta : acc), 0) *
          1000).toFixed(6),
      ),
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [
      figure,
      { id: 'deflection', role: 'secondary', type: 'beam', nodes: [], edges: [], chart, frames: [] } as RenderSpec,
      checksMatrix(checks, steps.length, checks.map(() => '本页自算')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
