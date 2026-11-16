/**
 * M1 轴向拉压：反力 → 轴力图 → 正应力 → 胡克定律变形 → 强度校核。
 *
 * 内力/应力全部来自 `solveMech`（库的复刻，被 check:mech-parity 钉住）；
 * 变形 ΔL 不在库的能力范围内（库明说不算变形），由这里的解析式给出，
 * 并与数值积分互校，标注清楚「不是库给的」。
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
  INDETERMINATE_VERDICT,
  num,
  pendingConfidence,
  reactionArrowsOf,
  step,
  verdictAgainstAllow,
} from './common.ts';

export interface M1Params {
  L: number;
  /** 横截面积，mm²。 */
  A: number;
  /** 轴向力，kN，拉为正。 */
  P: number;
  /** 弹性模量，GPa。 */
  E: number;
  /** 许用应力，MPa。 */
  allow: number;
}

export const M1_DEFAULTS: M1Params = { L: 1, A: 200, P: 40, E: 200, allow: 160 };

export function m1Params(input: ParamRecord): M1Params {
  const params: M1Params = {
    L: num(input, 'L', M1_DEFAULTS.L),
    A: num(input, 'A', M1_DEFAULTS.A),
    P: num(input, 'P', M1_DEFAULTS.P),
    E: num(input, 'E', M1_DEFAULTS.E),
    allow: num(input, 'allow', M1_DEFAULTS.allow),
  };
  if (!(params.L > 0)) throw new Error('M1 长度 L 必须 > 0');
  if (!(params.A > 0)) throw new Error('M1 面积 A 必须 > 0');
  if (!(params.E > 0)) throw new Error('M1 弹性模量 E 必须 > 0');
  if (!(params.allow > 0)) throw new Error('M1 许用应力必须 > 0');
  return params;
}

/** 圆杆：由面积反推直径，σ=N/A 与形状无关，截面只用于画图与几何量。 */
function diameterOf(areaMm2: number): number {
  return Math.sqrt((4 * areaMm2) / Math.PI) / 1000;
}

export function m1Spec(params: M1Params): MechSpec {
  return {
    kind: 'bar',
    length: params.L,
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    loads: [{ type: 'point_force', x: params.L, value: params.P, dir: 'axial' }],
    section: { shape: 'circle', params: { d: diameterOf(params.A) }, E: params.E * 1e9 },
  };
}

/** 路径 B：闭式（材料力学定义式）。 */
export function m1Closed(params: M1Params): { N: number; sigma: number; deltaL: number } {
  const area = params.A * 1e-6;
  const N = params.P * 1e3;
  return { N, sigma: N / area, deltaL: (N * params.L) / (params.E * 1e9 * area) };
}

/** 路径 C：200 段数值积分 ∫N/(EA)dx（不引用闭式）。 */
export function m1Numeric(params: M1Params): { N: number; deltaL: number } {
  const area = params.A * 1e-6;
  const E = params.E * 1e9;
  const n = 200;
  const dx = params.L / n;
  let deltaL = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (i + 0.5) * dx;
    const N = x < params.L ? params.P * 1e3 : 0;
    deltaL += (N / (E * area)) * dx;
  }
  return { N: params.P * 1e3, deltaL };
}

export function solveM1(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M1 只接受结构化参数');
  const params = m1Params(input as ParamRecord);
  const spec = m1Spec(params);
  const sol = solveMech(spec);
  const closed = m1Closed(params);
  const numeric = m1Numeric(params);
  const deltaL = closed.deltaL * 1000;

  const verdict = sol.determinate
    ? verdictAgainstAllow('σmax', sol.stresses.sigma_max ?? 0, params.allow, 'MPa')
    : INDETERMINATE_VERDICT;
  const N = sol.extrema.N?.max ?? 0;

  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'beam',
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    pointLoads: [
      { x: params.L, value: params.P, dir: 'axial', label: `P = ${params.P} kN` },
    ],
    // 反力也画箭头（与 S 系同一条规矩）：轴向反力沿轴线，零分量不画
    withReactions: true,
    reactions: reactionArrowsOf(sol.reactions, { span: params.L }),
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0', 'n-sup-1'],
    ['e-member', 'n-load-0'],
    ['e-member', 'n-load-0'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
  ]);

  const nPoints = (sol.diagrams.N ?? []).map((point) => [point.x, point.value] as [number, number]);
  const chart = chartOf({
    id: 'axial',
    // 标题只放中文名、轴标签只放单位：两者都写符号会在图上拼成「N (kN) 轴力图 N(x) (kN)」。
    title: '轴力图',
    unit: 'kN',
    xLabel: 'x (m)',
    yLabel: 'kN',
    xDomain: [0, params.L],
    series: [{ kind: 'step', points: nPoints, label: 'N(x)' }],
    marks:
      sol.extrema.N && nPoints.length > 0
        ? [{ x: sol.extrema.N.max_x, y: sol.extrema.N.max, text: `N=${sol.extrema.N.max.toFixed(2)} kN`, side: 'up' }]
        : [],
    convention: `N 拉为正　σ = N/A　ΔL = NL/(EA)（变形为解析补充，库不算）`,
  });
  const chartSpec: RenderSpec = {
    id: 'axial',
    role: 'secondary',
    type: 'beam',
    nodes: [],
    edges: [],
    chart,
    frames: [],
  };

  const steps = [
    step(
      0,
      '取整体，求支座反力',
      '\\sum F_x = 0',
      `P = ${params.P} kN，两端 pin / roller 只提供轴向约束`,
      sol.determinate ? `Rx = ${(sol.reactions[0]?.Rx ?? 0).toFixed(3)} kN` : '静不定，拒绝求解',
      '刚体平衡（ΣFx=0）',
      ['n-sup-0', 'n-sup-1'],
    ),
    step(
      1,
      '作轴力图：N(x) 全跨常量',
      'N(x) = -\\sum_{a<x} F_x',
      '外载荷只在 x=L 处，故 0<x<L 段 N 恒定',
      sol.determinate ? `N = ${N.toFixed(3)} kN` : '—',
      '库的符号约定（拉为正）',
      ['e-member', 'n-load-0'],
    ),
    step(
      2,
      '正应力 σ = N/A',
      '\\sigma = \\frac{N}{A}',
      `N=${N.toFixed(2)} kN，A=${params.A} mm²`,
      `σmax = ${(sol.stresses.sigma_max ?? 0).toFixed(3)} MPa`,
      '轴向拉压正应力公式',
      ['e-member', 'n-load-0'],
    ),
    step(
      3,
      '变形：胡克定律 ΔL = NL/(EA)',
      '\\Delta L = \\frac{NL}{EA}',
      `L=${params.L} m，E=${params.E} GPa，数值积分互校 ${(numeric.deltaL * 1000).toFixed(6)} mm`,
      `ΔL = ${deltaL.toFixed(4)} mm（**变形不在库的能力内，这里为解析补充**）`,
      '胡克定律（不计算变形）',
      ['e-member', 'n-span'],
    ),
    step(
      4,
      '强度校核',
      '\\sigma_{max} \\le [\\sigma]',
      `σmax=${(sol.stresses.sigma_max ?? 0).toFixed(3)} MPa，[σ]=${params.allow} MPa`,
      verdict.text,
      '强度条件（平衡与应力积分，求解内核自检）',
      ['e-member', 'n-span'],
    ),
  ];

  return {
    templateId: 'M1',
    subject: 'mechanics',
    parsed_given: {
      L: params.L,
      A: params.A,
      P: params.P,
      E: params.E,
      allow: params.allow,
      kind: 'bar',
    },
    steps,
    result: {
      N: Number(N.toFixed(6)),
      sigmaMax: Number((sol.stresses.sigma_max ?? 0).toFixed(6)),
      sigmaAllow: params.allow,
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      deltaL: Number(deltaL.toFixed(6)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [figure, chartSpec, checksMatrix(sol.checks, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
