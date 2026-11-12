/**
 * M8 组合变形：轴向 + 弯曲 + 扭转同时作用在悬臂圆轴上。
 *
 * σ = N/A + M·y/I 两个分量分别画出来再叠加，中性轴标在图上；
 * 有扭矩时按第四强度理论合成 σr4 = √(σ²+3τ²)。
 *
 * 库能算 N / M / T（kind='shaft' + 固定端），但**不会组合** —— 组合与强度评定在本页，
 * checks 面板逐行标「库」还是「本页自算」，不混成一套。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ChartMark, RenderSpec, Solution } from '../../types.ts';
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

export interface M8Params {
  L: number;
  /** 圆截面直径，mm。 */
  d: number;
  /** 轴向压力，kN（压为正，图上按 −x 方向加载）。 */
  Pn: number;
  /** 自由端横向集中力，kN（向下为正）。 */
  Pt: number;
  /** 扭矩，kN·m。 */
  T: number;
  /** 许用应力，MPa。 */
  allow: number;
}

export const M8_DEFAULTS: M8Params = { L: 2, d: 140, Pn: 150, Pt: 8, T: 0.5, allow: 160 };

export function m8Params(input: ParamRecord): M8Params {
  const params: M8Params = {
    L: num(input, 'L', M8_DEFAULTS.L),
    d: num(input, 'd', M8_DEFAULTS.d),
    Pn: num(input, 'Pn', M8_DEFAULTS.Pn),
    Pt: num(input, 'Pt', M8_DEFAULTS.Pt),
    T: num(input, 'T', M8_DEFAULTS.T),
    allow: num(input, 'allow', M8_DEFAULTS.allow),
  };
  if (!(params.L > 0)) throw new Error('M8 长度 L 必须 > 0');
  if (!(params.d > 0)) throw new Error('M8 直径 d 必须 > 0');
  if (params.Pn < 0 || params.Pt < 0) throw new Error('M8 的 Pn / Pt 表示大小，不得为负');
  if (params.T < 0) throw new Error('M8 的 T 不得为负');
  if (!(params.allow > 0)) throw new Error('M8 许用应力必须 > 0');
  return params;
}

export interface M8Section {
  /** 面积，m²。 */
  A: number;
  /** 惯性矩，m⁴。 */
  I: number;
  /** 抗弯截面系数，m³。 */
  W: number;
  /** 抗扭截面系数，m³。 */
  Wp: number;
}

export function m8Section(params: M8Params): M8Section {
  const R = params.d / 2000;
  const A = Math.PI * R * R;
  const I = (Math.PI * R ** 4) / 4;
  return { A, I, W: I / R, Wp: (Math.PI * R ** 3) / 2 };
}

export function m8Spec(params: M8Params): MechSpec {
  return {
    kind: 'shaft',
    length: params.L,
    supports: [{ x: 0, type: 'fixed' }],
    loads: [
      // 轴向压力沿 −x；横向力向下（transverse 正为向上）；扭矩右手螺旋 +x
      { type: 'point_force', x: params.L, value: -params.Pn, dir: 'axial' },
      { type: 'point_force', x: params.L, value: -params.Pt },
      { type: 'point_torque', x: params.L, value: params.T },
    ],
    section: { shape: 'circle', params: { d: params.d / 1000 }, E: 200e9 },
  };
}

/** 路径 B：悬臂闭式 N=−Pn、M=−Pt·L、T=T（根截面）。 */
export function m8Closed(params: M8Params): { N: number; M: number; T: number } {
  return { N: -params.Pn, M: -params.Pt * params.L, T: params.T };
}

export interface M8Stress {
  sigmaN: number;
  /** 边缘弯曲应力（带符号，压为正号约定见 σ(y)）。 */
  sigmaM: number;
  sigmaMax: number;
  tau: number;
  sigmaR4: number;
  /** 中性轴位置，mm（自中性轴原点向上为正；在截面外时为 null）。 */
  neutralAxisMm: number | null;
}

/** 由 N / M / T（kN、kN·m）算组合应力，单位 MPa。 */
export function m8Stress(params: M8Params, N: number, M: number, T: number): M8Stress {
  const section = m8Section(params);
  const sigmaN = (N / section.A) * 1e-3; // kN/m² → MPa
  const kEdge = (M / section.W) * 1e-3;
  const halfMm = params.d / 2;
  const sigmaTop = sigmaN + kEdge;
  const sigmaBottom = sigmaN - kEdge;
  const sigmaMax = Math.max(Math.abs(sigmaTop), Math.abs(sigmaBottom));
  const tau = (T / section.Wp) * 1e-3;
  const sigmaR4 = T > 0 ? Math.hypot(sigmaMax, Math.sqrt(3) * tau) : sigmaMax;
  const neutralRaw = M === 0 ? null : (-(N / section.A) / (M / section.I)) * 1000; // mm
  const neutralAxisMm = neutralRaw !== null && Math.abs(neutralRaw) <= halfMm ? neutralRaw : null;
  return { sigmaN, sigmaM: kEdge, sigmaMax, tau, sigmaR4, neutralAxisMm };
}

/**
 * 路径 C：把 σ(y) 分布沿截面数值积分回去（∫σdA=N、∫yσdA=M）。
 * 用 y=R·sinθ 换元（dA=2R²cos²θ dθ），被积函数是 θ 的光滑三角多项式，Simpson 收敛到 1e-13。
 */
export function m8IntegrateBack(params: M8Params, sigmaN: number, kEdge: number): { N: number; M: number } {
  const R = params.d / 2000;
  const k = kEdge / R; // MPa/m（σ = σN + k·y）
  const n = 2000;
  const a = -Math.PI / 2;
  const b = Math.PI / 2;
  const h = (b - a) / n;
  const strip = (theta: number) => {
    const y = R * Math.sin(theta);
    const weight = 2 * R * R * Math.cos(theta) ** 2;
    return { sigma: sigmaN + k * y, y, weight };
  };
  let intSigma = 0;
  let intYSigma = 0;
  const acc = (theta: number, factor: number) => {
    const s = strip(theta);
    intSigma += factor * s.sigma * s.weight;
    intYSigma += factor * s.y * s.sigma * s.weight;
  };
  acc(a, 1);
  acc(b, 1);
  for (let i = 1; i < n; i += 1) acc(a + i * h, i % 2 ? 4 : 2);
  intSigma *= h / 3;
  intYSigma *= h / 3;
  // MPa·m² = MN → ×1000 = kN；弯矩同理 ×1000 = kN·m
  return { N: intSigma * 1000, M: intYSigma * 1000 };
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

export function solveM8(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M8 只接受结构化参数');
  const params = m8Params(input as ParamRecord);
  const sol = solveMech(m8Spec(params));
  if (!sol.determinate) throw new Error('当前版本不解静不定（M8 只挂固定端静定轴）');

  const section = m8Section(params);
  const N = sol.extrema.N?.min ?? 0; // 全跨受压，取极值（负）
  const M = sol.extrema.M?.abs_max ?? 0;
  const Msign = sol.stresses.sigma_M ?? 0; // 带符号：负 = 上侧受拉（悬臂）
  const T = sol.extrema.T?.max ?? 0;

  // 库给 N（kN，带符号）与 M（kN·m，带符号）；组合在本页
  const fromLib = m8Stress(params, N, Msign, T);
  const closed = m8Closed(params);
  const fromClosed = m8Stress(params, closed.N, closed.M, closed.T);
  const back = m8IntegrateBack(params, fromClosed.sigmaN, fromClosed.sigmaM);

  const verdict = verdictAgainstAllow(
    params.T > 0 ? 'σr4' : 'σmax',
    fromLib.sigmaR4,
    params.allow,
    'MPa',
  );

  const half = params.d / 2;
  // 归一化 -0：JSON 里 -0 会写成 0，快照与实时对象就 deepStrictEqual 不上了
  const z = (v: number) => (v === 0 ? 0 : v);
  const totalPoints: [number, number][] = [];
  const linearPoints: [number, number][] = [];
  const constantPoints: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) {
    const yMm = -half + (params.d * i) / 40;
    const yM = yMm / 1000;
    const sigmaM = (Msign / section.I) * yM * 1e-3;
    totalPoints.push([yMm, z(fromLib.sigmaN + sigmaM)]);
    linearPoints.push([yMm, z(sigmaM)]);
    constantPoints.push([yMm, z(fromLib.sigmaN)]);
  }
  const sigmaTop = totalPoints[0][1];
  const sigmaBottom = totalPoints[totalPoints.length - 1][1];
  // 标注往图内写（圆截面端点就在框边上，朝外的标注会被裁掉）
  const marks: ChartMark[] = [
    { x: -half, y: sigmaTop, text: `σ=${sigmaTop.toFixed(1)} MPa`, side: 'down' },
    { x: half, y: sigmaBottom, text: `σ=${sigmaBottom.toFixed(1)} MPa`, side: 'up' },
  ];
  if (fromLib.neutralAxisMm !== null) {
    marks.push({ x: fromLib.neutralAxisMm, y: 0, text: '中性轴 σ=0', side: 'down' });
  }

  const stressChart = chartOf({
    id: 'combined',
    title: '组合应力沿截面高度',
    unit: 'MPa',
    xLabel: 'y (mm，向下为正)',
    yLabel: 'MPa',
    xDomain: [-half, half],
    series: [
      { kind: 'line', points: totalPoints, label: 'σ=σN+σM', fill: true },
      { kind: 'line', points: linearPoints, label: '弯曲分量 σM' },
      { kind: 'line', points: constantPoints, label: '轴向分量 σN' },
    ],
    marks,
    convention: `σ=N/A+M·y/I（y 自形心向下为正，拉为正）　库提供 N/M/T，组合与 σr4 由本页算`,
  });

  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'shaft',
    supports: [{ x: 0, type: 'fixed' }],
    pointLoads: [
      { x: params.L, value: -params.Pn, dir: 'axial', label: `Pn = ${params.Pn} kN` },
      { x: params.L, value: -params.Pt, label: `Pt = ${params.Pt} kN` },
    ],
    moments: params.T > 0 ? [{ x: params.L, value: params.T, label: `T = ${params.T} kN·m` }] : [],
    spanLabel: `L = ${params.L} m　d = ${params.d} mm`,
    // 固定端三个反力分量都画：R_Ax / R_Ay 是力箭头，M_A（绕 z）与 T_A（绕 x）是圆弧箭头
    withReactions: true,
    reactions: reactionArrowsOf(sol.reactions, { span: params.L }),
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0'],
    ['e-member', 'n-load-0', 'n-load-1'],
    ['e-member', 'n-load-1'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
  ]);

  const checks = [
    ...sol.checks.map((item) => ({ ...item, note: `库：${item.note}` })),
    selfCheck('σmax：库 N/M 组合 vs 悬臂闭式', fromClosed.sigmaMax, fromLib.sigmaMax, rel(fromClosed.sigmaMax, fromLib.sigmaMax),
      rel(fromClosed.sigmaMax, fromLib.sigmaMax) < 1e-9, '路径 A（库 N/M/T + 组合）与路径 B（N=−Pn、M=−PtL 闭式）'),
    // 期望值可能是 0（例如 Pn=0 时 N=0），裸相对误差会被 1e-13 的舍入噪声放大成假失败；
    // 按题目受力量级换算绝对容差：力的量级取 max(|N|, |M|/L)，弯矩的量级取 max(|M|, |N|·R)。
    selfCheck(
      '∫σdA 回代 N（容差按 max(|N|,|M|/L) 折算）',
      closed.N,
      back.N,
      Math.abs(closed.N - back.N) / Math.max(Math.abs(closed.N), Math.abs(closed.M) / params.L, 1),
      Math.abs(closed.N - back.N) / Math.max(Math.abs(closed.N), Math.abs(closed.M) / params.L, 1) < 1e-9,
      '路径 C：由 σ(y) 分布沿圆截面数值积分回代（y=R·sinθ 换元 + Simpson）',
    ),
    selfCheck(
      '∫yσdA 回代 M（容差按 max(|M|,|N|R) 折算）',
      closed.M,
      back.M,
      Math.abs(closed.M - back.M) / Math.max(Math.abs(closed.M), (Math.abs(closed.N) * params.d) / 2000, 1),
      Math.abs(closed.M - back.M) / Math.max(Math.abs(closed.M), (Math.abs(closed.N) * params.d) / 2000, 1) < 1e-9,
      '同上',
    ),
    selfCheck(
      params.T > 0 ? '弯扭组合 σr4=√(σmax²+3τ²) 与 [σ]' : 'σmax 与 [σ]',
      params.allow,
      fromLib.sigmaR4,
      Math.abs(fromLib.sigmaR4 / params.allow - 1),
      fromLib.sigmaR4 <= params.allow,
      `τ=T/Wp=${fromLib.tau.toFixed(3)} MPa，σmax=${fromLib.sigmaMax.toFixed(3)} MPa`,
    ),
  ];

  const steps = [
    step(0, '取固定端反力（库）', 'R_x=P_n,\\ R_y=P_t,\\ M_A=P_tL,\\ M_x=T',
      `Pn=${params.Pn} kN，Pt=${params.Pt} kN，T=${params.T} kN·m，L=${params.L} m`,
      `Rx=${(sol.reactions[0]?.Rx ?? 0).toFixed(2)} kN，Ry=${(sol.reactions[0]?.Ry ?? 0).toFixed(2)} kN，Mz=${(sol.reactions[0]?.Mz ?? 0).toFixed(2)} kN·m`,
      '库 reactions（check:mech-parity 钉住）', ['n-sup-0']),
    step(1, '危险截面内力', 'N=-P_n,\\ M=-P_tL,\\ T',
      `根截面 x=0`, `N=${N.toFixed(2)} kN，|M|=${M.toFixed(2)} kN·m，T=${T.toFixed(3)} kN·m`,
      '库 diagrams（悬臂：弯矩在固定端最大）', ['e-member', 'n-load-1']),
    step(2, '两个应力分量', '\\sigma_N=\\frac{N}{A},\\ \\sigma_M=\\frac{M}{W}',
      `A=${(section.A * 1e6).toFixed(1)} mm²，W=${(section.W * 1e9).toFixed(1)} mm³`,
      `σN=${fromLib.sigmaN.toFixed(3)} MPa，σM=${Math.abs(fromLib.sigmaM).toFixed(3)} MPa`,
      '轴向正应力 + 弯曲正应力（**组合由本页算**）', ['e-member']),
    step(3, '叠加与中性轴', '\\sigma(y)=\\frac{N}{A}+\\frac{My}{I}',
      `边缘：${sigmaTop.toFixed(2)} / ${sigmaBottom.toFixed(2)} MPa`,
      fromLib.neutralAxisMm === null
        ? '中性轴落在截面外（弯曲分量不足以抵消轴向压应力，全截面受压）'
        : `中性轴 y=${fromLib.neutralAxisMm.toFixed(2)} mm`,
      '叠加原理（小变形、材料线弹性）', ['e-member', 'n-span']),
    step(4, '强度校核', params.T > 0 ? '\\sigma_{r4}=\\sqrt{\\sigma_{max}^2+3\\tau^2}\\le[\\sigma]' : '\\sigma_{max}\\le[\\sigma]',
      params.T > 0
        ? `τ=${fromLib.tau.toFixed(3)} MPa，σmax=${fromLib.sigmaMax.toFixed(3)} MPa，[σ]=${params.allow} MPa`
        : `σmax=${fromLib.sigmaMax.toFixed(3)} MPa，[σ]=${params.allow} MPa`,
      verdict.text, '第四强度理论（弯扭组合）+ [σ]', ['e-member', 'n-span']),
  ];

  const chartSpec: RenderSpec = {
    id: 'combined',
    role: 'secondary',
    type: 'stress',
    nodes: [],
    edges: [],
    chart: stressChart,
    frames: [],
  };

  return {
    templateId: 'M8',
    subject: 'mechanics',
    parsed_given: { L: params.L, d: params.d, Pn: params.Pn, Pt: params.Pt, T: params.T, allow: params.allow },
    steps,
    result: {
      A: Number((section.A * 1e6).toFixed(3)),
      W: Number((section.W * 1e9).toFixed(3)),
      Wp: Number((section.Wp * 1e9).toFixed(3)),
      N: Number(N.toFixed(6)),
      M: Number(M.toFixed(6)),
      T: Number(T.toFixed(6)),
      sigmaN: Number(fromLib.sigmaN.toFixed(6)),
      sigmaM: Number(Math.abs(fromLib.sigmaM).toFixed(6)),
      sigmaMax: Number(fromLib.sigmaMax.toFixed(6)),
      tau: Number(fromLib.tau.toFixed(6)),
      sigmaR4: Number(fromLib.sigmaR4.toFixed(6)),
      neutralAxis: fromLib.neutralAxisMm === null ? '截面外' : Number(fromLib.neutralAxisMm.toFixed(6)),
      sigmaAllow: params.allow,
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [
      figure,
      chartSpec,
      checksMatrix(
        checks,
        steps.length,
        [
          ...sol.checks.map(() => '库 checks[]'),
          '本页自算',
          '本页自算',
          '本页自算',
          '本页自算',
        ],
      ),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
