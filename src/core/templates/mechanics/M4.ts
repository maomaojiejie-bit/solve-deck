/**
 * M4 弯曲应力：取 |M|max 截面，画 σ(y) 线性分布（上压下拉），标中性轴与受拉侧。
 * σ 值来自库的 stresses（σ=N/A+M·y/Iy），W=bh²/6 与库 section.W 对齐。
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
  step,
  verdictAgainstAllow,
} from './common.ts';

export interface M4Params {
  L: number;
  a: number;
  P: number;
  /** 截面宽，mm。 */
  b: number;
  /** 截面高，mm。 */
  h: number;
  /** 许用应力，MPa。 */
  allow: number;
}

export const M4_DEFAULTS: M4Params = { L: 4, a: 2, P: 20, b: 100, h: 200, allow: 160 };

export function m4Params(input: ParamRecord): M4Params {
  const params: M4Params = {
    L: num(input, 'L', M4_DEFAULTS.L),
    a: num(input, 'a', M4_DEFAULTS.a),
    P: num(input, 'P', M4_DEFAULTS.P),
    b: num(input, 'b', M4_DEFAULTS.b),
    h: num(input, 'h', M4_DEFAULTS.h),
    allow: num(input, 'allow', M4_DEFAULTS.allow),
  };
  if (!(params.L > 0)) throw new Error('M4 跨度 L 必须 > 0');
  if (!(params.a > 0) || params.a >= params.L) throw new Error('M4 载荷位置 a 必须落在 (0, L) 内');
  if (!(params.b > 0) || !(params.h > 0)) throw new Error('M4 截面尺寸必须 > 0');
  if (!(params.allow > 0)) throw new Error('M4 许用应力必须 > 0');
  return params;
}

export function m4Spec(params: M4Params): MechSpec {
  return {
    kind: 'beam',
    length: params.L,
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    loads: [{ type: 'point_force', x: params.a, value: -params.P }],
    section: { shape: 'rect', params: { b: params.b / 1000, h: params.h / 1000 }, E: 200e9 },
  };
}

/** 路径 B：闭式 σ=M/W。 */
export function m4Closed(params: M4Params): { W: number; sigma: number; Mmax: number } {
  const b = params.b / 1000;
  const h = params.h / 1000;
  const W = (b * h ** 2) / 6;
  const RA = (params.P * (params.L - params.a)) / params.L;
  const Mmax = RA * params.a;
  return { W, sigma: Mmax * 1e3 / W / 1e6, Mmax };
}

/** 路径 C：由 σ(y) 分布做数值积分回代（∫σdA=N 与 ∫yσdA=M）。 */
export function m4Numeric(params: M4Params): { sigmaMax: number; intY: number } {
  const closed = m4Closed(params);
  const h = params.h / 1000;
  const b = params.b / 1000;
  const n = 400;
  const dy = h / n;
  const sigma = (y: number) => (closed.Mmax * 1e3 * y) / ((b * h ** 3) / 12) / 1e6;
  let intY = 0;
  for (let i = 0; i < n; i += 1) {
    const y = -h / 2 + (i + 0.5) * dy;
    intY += y * sigma(y) * b * dy;
  }
  // σ(y) 线性 ⇒ 极值必然在边缘纤维，不在条带中点上取（否则会系统性偏小 1/n）。
  const sigmaMax = Math.max(Math.abs(sigma(-h / 2)), Math.abs(sigma(h / 2)));
  return { sigmaMax, intY };
}

export function solveM4(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M4 只接受结构化参数');
  const params = m4Params(input as ParamRecord);
  const sol = solveMech(m4Spec(params));
  if (!sol.determinate) throw new Error('当前版本不解静不定（M4 只挂静定的简支梁）');

  const sigmaMax = sol.stresses.sigma_max ?? 0;
  const verdict = verdictAgainstAllow('σmax', sigmaMax, params.allow, 'MPa');
  const Mmax = sol.extrema.M?.abs_max ?? 0;
  const MmaxX = sol.extrema.M?.abs_max_x ?? 0;

  const sigmaN = sol.stresses.sigma_N ?? 0;
  const sigmaM = sol.stresses.sigma_M ?? 0;
  const area = sol.section.A;
  const Iy = sol.section.Iy;
  // 单位：N/M 来自库的 base 单位（kN、kN·m），A/Iy 是 m²、m⁴ ⇒ 结果是 kN/m²，
  // 必须 ×1e-3 才是 MPa。少了这一步图上会写「σ=-30000.0 MPa」，比数值错更丢人。
  const sigmaAt = (y: number) => (sigmaN / area + (sigmaM * y) / Iy) * 1e-3;

  const half = params.h / 2;
  const points: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) {
    const y = (-half + (params.h * i) / 40) / 1000;
    points.push([-half + (params.h * i) / 40, sigmaAt(y)]);
  }
  const sigmaTop = points[0][1];
  const sigmaBottom = points[points.length - 1][1];
  const neutralAxisRaw = sigmaM === 0 ? 0 : (-sigmaN / area) * Iy / sigmaM / 1e-3;
  // 归一化 -0：否则快照会产出 "x": -0，deepStrictEqual 与 0 不等。
  const neutralAxis = neutralAxisRaw === 0 ? 0 : neutralAxisRaw;

  const stressChart = chartOf({
    id: 'sigma',
    title: `截面正应力分布（x=${MmaxX.toFixed(2)} m）`,
    unit: 'MPa',
    xLabel: 'y (mm，向下为正)',
    yLabel: 'MPa',
    xDomain: [-half, half],
    series: [{ kind: 'line', points, label: 'σ(y)', fill: true }],
    marks: [
      { x: -half, y: sigmaTop, text: `σ=${sigmaTop.toFixed(1)} MPa`, side: 'right' },
      { x: half, y: sigmaBottom, text: `σ=${sigmaBottom.toFixed(1)} MPa`, side: 'left' },
      { x: neutralAxis, y: 0, text: '中性轴 σ=0', side: 'down' },
    ],
    // 库的 σ=N/A+M·y/Iy 里 y 实际是**向下**为正（用悬臂/简支两个工况反解出来的：
    // 简支下挠时应是上缘受压，只有 y 向下为正才对得上）。库自己的 conventions 文案
    // 写的是「向上为正」，与它算出来的数矛盾 —— 以数为准，文案按物理写。
    convention: 'σ = N/A + M·y/Iy，y 自中性轴向下为正（与库算出的数一致），拉应力为正　W=bh²/6',
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
    // 反力箭头与 S 系同一条规矩（箭头数 = 载荷数 + 反力数）
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

  const stressSpec: RenderSpec = {
    id: 'sigma',
    role: 'secondary',
    type: 'stress',
    nodes: [],
    edges: [],
    chart: stressChart,
    frames: [],
  };

  const steps = [
    step(0, '截面几何量', 'I_y=\\frac{bh^3}{12},\\ W=\\frac{bh^2}{6}',
      `b=${params.b} mm，h=${params.h} mm`,
      `Iy=${(sol.section.Iy * 1e12).toFixed(1)} mm⁴，W=${(sol.section.W * 1e9).toFixed(1)} mm³`,
      '矩形截面惯性矩 / 抗弯截面系数', ['e-member']),
    step(1, '取最大弯矩截面', 'M_{max}=\\max|M(x)|',
      `简支梁 P@x=${params.a} m`, `|M|max=${Mmax.toFixed(3)} kN·m @ x=${MmaxX.toFixed(3)} m`,
      '库 diagrams.extrema（dM/dx=Q=0 处）', ['e-member', 'n-load-0']),
    step(2, '最大弯曲正应力', '\\sigma_{max}=\\frac{M}{W}',
      `M=${Mmax.toFixed(3)} kN·m，W=${(sol.section.W * 1e9).toFixed(1)} mm³`,
      `σmax=${sigmaMax.toFixed(3)} MPa（库 stresses.sigma_max）`, '弯曲正应力公式', ['e-member']),
    step(3, '沿截面线性分布', '\\sigma(y)=\\frac{N}{A}+\\frac{My}{I_y}',
      `上缘 ${sigmaTop.toFixed(1)} MPa，下缘 ${sigmaBottom.toFixed(1)} MPa，中性轴 y=${neutralAxis.toFixed(1)} mm`,
      `受拉侧：y=${sigmaBottom > 0 ? '下缘' : '上缘'}；σ 沿高度线性`, '平面假设 + 库 ∫σdA=N / ∫yσdA=M 校核', ['n-span']),
    step(4, '强度校核', '\\sigma_{max}\\le[\\sigma]',
      `σmax=${sigmaMax.toFixed(3)} MPa，[σ]=${params.allow} MPa`, verdict.text,
      '强度条件 + 库 checks[]', ['e-member', 'n-span']),
  ];

  return {
    templateId: 'M4',
    subject: 'mechanics',
    parsed_given: { L: params.L, a: params.a, P: params.P, b: params.b, h: params.h, allow: params.allow },
    steps,
    result: {
      W: Number((sol.section.W * 1e9).toFixed(3)),
      Iy: Number((sol.section.Iy * 1e12).toFixed(3)),
      Mmax: Number(Mmax.toFixed(6)),
      sigmaMax: Number(sigmaMax.toFixed(6)),
      sigmaMin: Number(Math.min(sigmaTop, sigmaBottom).toFixed(6)),
      sigmaAllow: params.allow,
      neutralAxis: Number(neutralAxis.toFixed(6)),
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [figure, stressSpec, checksMatrix(sol.checks, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
