/**
 * M2 扭转：扭矩反力 → 扭矩图 → Ip/Wp → τmax → 刚度/强度校核。
 * 扭矩与切应力来自 solveMech（库给 Ip/Wp/τ）；扭转角 φ 库不算，这里解析给出并与数值积分互校。
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

export interface M2Params {
  L: number;
  /** 直径，mm。 */
  d: number;
  /** 扭矩，kN·m。 */
  T: number;
  /** 切变模量，GPa。 */
  G: number;
  /** 许用切应力，MPa。 */
  allow: number;
}

export const M2_DEFAULTS: M2Params = { L: 1, d: 40, T: 1, G: 80, allow: 40 };

export function m2Params(input: ParamRecord): M2Params {
  const params: M2Params = {
    L: num(input, 'L', M2_DEFAULTS.L),
    d: num(input, 'd', M2_DEFAULTS.d),
    T: num(input, 'T', M2_DEFAULTS.T),
    G: num(input, 'G', M2_DEFAULTS.G),
    allow: num(input, 'allow', M2_DEFAULTS.allow),
  };
  if (!(params.L > 0) || !(params.d > 0) || !(params.G > 0)) throw new Error('M2 的 L/d/G 必须 > 0');
  if (!(params.allow > 0)) throw new Error('M2 许用切应力必须 > 0');
  return params;
}

export function m2Spec(params: M2Params): MechSpec {
  return {
    kind: 'shaft',
    length: params.L,
    supports: [{ x: 0, type: 'fixed' }],
    loads: [{ type: 'point_torque', x: params.L, value: params.T }],
    section: { shape: 'circle', params: { d: params.d / 1000 }, E: 200e9 },
  };
}

export function m2Closed(params: M2Params): { Wp: number; Ip: number; tau: number; phi: number } {
  const d = params.d / 1000;
  const Wp = (Math.PI * d ** 3) / 16;
  const Ip = (Math.PI * d ** 4) / 32;
  const T = params.T * 1e3;
  const G = params.G * 1e9;
  return { Wp, Ip, tau: T / Wp / 1e6, phi: (T * params.L) / (G * Ip) };
}

export function m2Numeric(params: M2Params): { phi: number } {
  const geo = m2Closed(params);
  const n = 200;
  const dx = params.L / n;
  let phi = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (i + 0.5) * dx;
    const T = x < params.L ? params.T * 1e3 : 0;
    phi += (T / (params.G * 1e9 * geo.Ip)) * dx;
  }
  return { phi };
}

export function solveM2(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M2 只接受结构化参数');
  const params = m2Params(input as ParamRecord);
  const sol = solveMech(m2Spec(params));
  const closed = m2Closed(params);
  const numeric = m2Numeric(params);

  const tauMax = sol.stresses.tau_torsion_max ?? 0;
  const verdict = sol.determinate ? verdictAgainstAllow('τmax', tauMax, params.allow, 'MPa') : INDETERMINATE_VERDICT;
  const Tmax = sol.extrema.T?.abs_max ?? sol.extrema.T?.max ?? 0;

  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'shaft',
    supports: [{ x: 0, type: 'fixed' }],
    moments: [{ x: params.L, value: params.T, label: `T = ${params.T} kN·m（右手螺旋 +x）` }],
    // 固定端的扭矩反力画成圆弧箭头（绕 x 轴），零分量不画
    withReactions: true,
    reactions: reactionArrowsOf(sol.reactions, { span: params.L }),
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0'],
    ['e-member', 'n-moment-0'],
    ['e-member', 'n-moment-0'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
  ]);

  const tPoints = (sol.diagrams.T ?? []).map((point) => [point.x, point.value] as [number, number]);
  const torqueChart = chartOf({
    id: 'torque',
    title: '扭矩图',
    unit: 'kN·m',
    xLabel: 'x (m)',
    yLabel: 'kN·m',
    xDomain: [0, params.L],
    series: [{ kind: 'step', points: tPoints, label: 'T(x)' }],
    marks:
      sol.extrema.T && tPoints.length > 0
        ? [{ x: sol.extrema.T.max_x, y: sol.extrema.T.max, text: `T=${sol.extrema.T.max.toFixed(3)} kN·m`, side: 'up' }]
        : [],
    convention: 'T 右手螺旋 +x 为正　τ = T·ρ/Ip　Wp = πd³/16',
  });

  const radius = params.d / 2;
  const shearChart = chartOf({
    id: 'shear',
    title: '切应力沿半径线性分布',
    unit: 'MPa',
    xLabel: 'ρ (mm)',
    yLabel: 'τ (MPa)',
    xDomain: [0, radius],
    series: [
      {
        kind: 'line',
        points: [
          [0, 0],
          [radius, tauMax],
        ],
        label: 'τ(ρ)',
        fill: true,
      },
    ],
    marks: [{ x: radius, y: tauMax, text: `τmax=${tauMax.toFixed(2)} MPa`, side: 'left' }],
    convention: `Ip = πd⁴/32，Wp = πd³/16，φ = TL/(GIp)（扭转角为解析补充）`,
  });

  const charts: RenderSpec[] = [
    { id: 'torque', role: 'secondary', type: 'shaft', nodes: [], edges: [], chart: torqueChart, frames: [] },
    { id: 'shear', role: 'secondary', type: 'shaft', nodes: [], edges: [], chart: shearChart, frames: [] },
  ];

  const steps = [
    step(
      0,
      '求扭矩反力',
      '\\sum M_x = 0',
      `外扭矩 T=${params.T} kN·m 作用于 x=L`,
      sol.determinate ? `Mx = ${(sol.reactions[0]?.Mx ?? 0).toFixed(4)} kN·m` : '静不定，拒绝求解',
      '绕轴平衡（ΣMx=0）',
      ['n-sup-0'],
    ),
    step(
      1,
      '作扭矩图',
      'T(x) = -\\sum_{a<x} M_x',
      '轴段内无分布扭矩，T(x) 为常量',
      sol.determinate ? `T = ${Tmax.toFixed(4)} kN·m` : '—',
      '库的符号约定（右手螺旋 +x 为正）',
      ['e-member', 'n-moment-0'],
    ),
    step(
      2,
      '截面几何量',
      'I_p = \\frac{\\pi d^4}{32},\\; W_p = \\frac{\\pi d^3}{16}',
      `d = ${params.d} mm`,
      `Ip = ${(closed.Ip * 1e12).toFixed(1)} mm⁴，Wp = ${(closed.Wp * 1e9).toFixed(1)} mm³`,
      '圆截面极惯性矩 / 抗扭截面系数',
      ['e-member'],
    ),
    step(
      3,
      '最大切应力',
      '\\tau_{max} = \\frac{T}{W_p}',
      `T=${Tmax.toFixed(4)} kN·m，Wp=${(closed.Wp * 1e9).toFixed(1)} mm³`,
      `τmax = ${tauMax.toFixed(3)} MPa（库 stresses.tau_torsion_max）`,
      '圆轴扭转切应力',
      ['e-member'],
    ),
    step(
      4,
      '刚度与强度校核',
      '\\varphi = \\frac{TL}{GI_p},\\; \\tau_{max}\\le[\\tau]',
      `G=${params.G} GPa，数值积分 φ=${numeric.phi.toFixed(6)} rad`,
      `φ = ${closed.phi.toFixed(6)} rad（${((closed.phi * 180) / Math.PI).toFixed(2)}°）；${verdict.text}`,
      '扭转角公式（库不算）+ 强度条件',
      ['e-member', 'n-span'],
    ),
  ];

  return {
    templateId: 'M2',
    subject: 'mechanics',
    parsed_given: { L: params.L, d: params.d, T: params.T, G: params.G, allow: params.allow, kind: 'shaft' },
    steps,
    result: {
      Tmax: Number(Tmax.toFixed(6)),
      Wp: Number((closed.Wp * 1e9).toFixed(3)),
      Ip: Number((closed.Ip * 1e12).toFixed(3)),
      tauMax: Number(tauMax.toFixed(6)),
      tauAllow: params.allow,
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      phiPerRad: Number(closed.phi.toFixed(8)),
      phiDeg: Number(((closed.phi * 180) / Math.PI).toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [figure, ...charts, checksMatrix(sol.checks, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
