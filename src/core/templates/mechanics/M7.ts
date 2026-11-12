/**
 * M7 压杆稳定：欧拉临界应力 λ–σcr 曲线 + 当前工作点。
 *
 * 这一型最容易糊弄人的地方是「先给个数再标黄」。这里的规矩：
 *   λ < λp 时 **一个数字都不给** —— σcr / Pcr 写「—」，结论位黄底写
 *   「超出欧拉适用范围，本工具不适用」，图上也不画当前点。
 *   只有 λ ≥ λp 才出 σcr、Pcr 与稳定校核。
 *
 * 三条路径：λ 定义式 + 欧拉公式 / 能量法（解析）/ 能量法（数值积分）。库不管压杆稳定。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { RenderSpec, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import {
  chartOf,
  checksMatrix,
  num,
  outOfScopeVerdict,
  pendingConfidence,
  selfCheck,
  step,
  verdictAgainstAllow,
} from './common.ts';

export interface M7Params {
  L: number;
  /** 截面宽，mm。 */
  b: number;
  /** 截面高，mm。 */
  h: number;
  /** 弹性模量，GPa。 */
  E: number;
  /** 长度系数 μ（两端铰支 1.0、一端固定一端铰 0.7、两端固定 0.5、悬臂 2.0）。 */
  mu: number;
  /** 工作压力，kN。 */
  P: number;
  /** 比例极限 σp，MPa（欧拉公式的适用上限）。 */
  sp: number;
}

export const M7_DEFAULTS: M7Params = { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 };

/** 稳定安全系数（本页假设，写在结论位旁）。 */
export const M7_STABILITY_FACTOR = 3;

export function m7Params(input: ParamRecord): M7Params {
  const params: M7Params = {
    L: num(input, 'L', M7_DEFAULTS.L),
    b: num(input, 'b', M7_DEFAULTS.b),
    h: num(input, 'h', M7_DEFAULTS.h),
    E: num(input, 'E', M7_DEFAULTS.E),
    mu: num(input, 'mu', M7_DEFAULTS.mu),
    P: num(input, 'P', M7_DEFAULTS.P),
    sp: num(input, 'sp', M7_DEFAULTS.sp),
  };
  if (!(params.L > 0)) throw new Error('M7 杆长 L 必须 > 0');
  if (!(params.b > 0) || !(params.h > 0)) throw new Error('M7 截面尺寸必须 > 0');
  if (!(params.E > 0)) throw new Error('M7 弹性模量 E 必须 > 0');
  if (!(params.mu > 0)) throw new Error('M7 长度系数 μ 必须 > 0');
  if (!(params.sp > 0)) throw new Error('M7 比例极限 σp 必须 > 0');
  if (params.P < 0) throw new Error('M7 工作压力 P 不得为负');
  return params;
}

export interface M7Geometry {
  /** 面积，mm²。 */
  A: number;
  /** 最小惯性矩，mm⁴。 */
  Imin: number;
  /** 最小回转半径，mm。 */
  i: number;
  /** 长细比。 */
  lambda: number;
  /** 欧拉公式适用下限 λp。 */
  lambdaP: number;
}

export function m7Geometry(params: M7Params): M7Geometry {
  const A = params.b * params.h;
  const Ix = (params.b * params.h ** 3) / 12;
  const Iy = (params.h * params.b ** 3) / 12;
  const Imin = Math.min(Ix, Iy);
  const i = Math.sqrt(Imin / A);
  const lambda = (params.mu * params.L * 1000) / i;
  const eMpa = params.E * 1000;
  const lambdaP = Math.PI * Math.sqrt(eMpa / params.sp);
  return { A, Imin, i, lambda, lambdaP };
}

/** 路径 A：λ 定义式 + 欧拉公式 σcr=π²E/λ²。 */
export function m7Euler(params: M7Params): { sigmaCr: number; pCr: number; geometry: M7Geometry } {
  const geometry = m7Geometry(params);
  const sigmaCr = (Math.PI * Math.PI * params.E * 1000) / (geometry.lambda * geometry.lambda);
  return { sigmaCr, pCr: (sigmaCr * geometry.A) / 1000, geometry };
}

/** 路径 B：能量法（Rayleigh 商）解析式，取 v=sin(πx/Le) ⇒ Pcr=π²EI/Le²。 */
export function m7RayleighClosed(params: M7Params): { pCr: number; sigmaCr: number } {
  const { A, Imin } = m7Geometry(params);
  const Le = params.mu * params.L;
  const pCr = (Math.PI * Math.PI * params.E * 1e9 * (Imin * 1e-12)) / (Le * Le); // N
  const sigmaCr = pCr / (A * 1e-6) / 1e6; // MPa
  return { pCr: pCr / 1000, sigmaCr };
}

/** 路径 C：同一条 Rayleigh 商，但两个积分用 Simpson 数值算（不引用 π² 的结果）。 */
export function m7RayleighNumeric(params: M7Params): { pCr: number; sigmaCr: number } {
  const { A, Imin } = m7Geometry(params);
  const Le = params.mu * params.L;
  const EI = params.E * 1e9 * (Imin * 1e-12); // N·m²
  const n = 2000;
  const h = Le / n;
  const k = Math.PI / Le;
  const v2 = (x: number) => k * Math.cos(k * x);
  const vdd = (x: number) => -k * k * Math.sin(k * x);
  const simpson = (f: (x: number) => number) => {
    let sum = f(0) + f(Le);
    for (let idx = 1; idx < n; idx += 1) sum += (idx % 2 ? 4 : 2) * f(idx * h);
    return (sum * h) / 3;
  };
  const num = EI * simpson((x) => vdd(x) ** 2);
  const den = simpson((x) => v2(x) ** 2);
  const pCr = num / den;
  return { pCr: pCr / 1000, sigmaCr: pCr / (A * 1e-6) / 1e6 };
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

export function solveM7(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M7 只接受结构化参数');
  const params = m7Params(input as ParamRecord);
  const euler = m7Euler(params);
  const rayleigh = m7RayleighClosed(params);
  const numeric = m7RayleighNumeric(params);
  const g = euler.geometry;

  const eulerValid = g.lambda >= g.lambdaP;
  const sigmaWork = (params.P * 1000) / g.A;
  const allowStability = eulerValid ? euler.sigmaCr / M7_STABILITY_FACTOR : Number.NaN;
  const verdict = eulerValid
    ? verdictAgainstAllow('工作应力 σ=P/A', sigmaWork, allowStability, 'MPa')
    : outOfScopeVerdict(
        `λ=${g.lambda.toFixed(1)} < λp=${g.lambdaP.toFixed(1)}：超出欧拉公式适用范围，本工具不适用（不给 σcr / Pcr 数值，也不做稳定校核）`,
      );

  // λ–σcr 曲线只画适用范围（λ ≥ λp）
  const lambdaMax = Math.max(250, g.lambda * 1.15, g.lambdaP * 1.6);
  const sigmaOf = (lambda: number) => (Math.PI * Math.PI * params.E * 1000) / (lambda * lambda);
  // 采样里包含当前 λ 本身：标注点必须落在画出来的折线上（check:chart ②），
  // 不能落在相邻两点的弦上 —— 欧拉曲线是凸的，弦上值与真值差 3e-2 就会被抓出来。
  const lambdas = new Set<number>();
  const stepsCount = 80;
  for (let k = 0; k <= stepsCount; k += 1) {
    lambdas.add(g.lambdaP + ((lambdaMax - g.lambdaP) * k) / stepsCount);
  }
  if (eulerValid) lambdas.add(g.lambda);
  const curve: [number, number][] = [...lambdas]
    .sort((left, right) => left - right)
    .map((lambda) => [lambda, sigmaOf(lambda)] as [number, number]);
  const sigmaPLine: [number, number][] = [
    [g.lambdaP, params.sp],
    [lambdaMax, params.sp],
  ];

  const marks = eulerValid
    ? [{ x: g.lambda, y: euler.sigmaCr, text: `σcr=${euler.sigmaCr.toFixed(2)} MPa`, side: 'up' as const }]
    : [];

  const chart = chartOf({
    id: 'euler',
    title: '欧拉临界应力曲线',
    unit: 'MPa',
    xLabel: 'λ',
    yLabel: 'MPa',
    xDomain: [g.lambdaP, lambdaMax],
    series: [
      { kind: 'line', points: curve, label: 'σcr=π²E/λ²' },
      { kind: 'line', points: sigmaPLine, label: '比例极限 σp' },
    ],
    marks,
    convention: eulerValid
      ? `λ ≥ λp=${g.lambdaP.toFixed(1)} 才用欧拉公式　σcr=π²E/λ²　[n]=${M7_STABILITY_FACTOR}（本页假设）`
      : `λ=${g.lambda.toFixed(1)} < λp=${g.lambdaP.toFixed(1)}：欧拉公式不适用，本页不给数字`,
  });

  const checks = [
    selfCheck('σcr：λ 定义式 vs 能量法解析', euler.sigmaCr, rayleigh.sigmaCr, rel(euler.sigmaCr, rayleigh.sigmaCr),
      rel(euler.sigmaCr, rayleigh.sigmaCr) < 1e-9, '路径 A：π²E/λ²；路径 B：Rayleigh 商解析'),
    selfCheck('σcr：能量法解析 vs 能量法数值积分', rayleigh.sigmaCr, numeric.sigmaCr, rel(rayleigh.sigmaCr, numeric.sigmaCr),
      rel(rayleigh.sigmaCr, numeric.sigmaCr) < 1e-9, '路径 C：两积分用 Simpson，全程不出现 π² 结论'),
    selfCheck('长细比 λ=μL/i 与回转半径回代', g.lambda, (params.mu * params.L * 1000) / Math.sqrt(g.Imin / g.A),
      rel(g.lambda, (params.mu * params.L * 1000) / Math.sqrt(g.Imin / g.A)),
      rel(g.lambda, (params.mu * params.L * 1000) / Math.sqrt(g.Imin / g.A)) < 1e-12, `i=${g.i.toFixed(3)} mm，Imin=${g.Imin.toFixed(1)} mm⁴`),
    selfCheck('适用性判据 λ/λp ≥ 1', 1, g.lambda / g.lambdaP, Math.abs(g.lambda / g.lambdaP - 1), eulerValid,
      eulerValid
        ? `λ=${g.lambda.toFixed(1)} ≥ λp=${g.lambdaP.toFixed(1)}，欧拉公式适用`
        : `λ=${g.lambda.toFixed(1)} < λp=${g.lambdaP.toFixed(1)}：**不给 σcr / Pcr 数值**`),
  ];

  const steps = [
    step(0, '截面几何量与回转半径', 'A=bh,\\ I_{min}=\\frac{hb^3}{12},\\ i=\\sqrt{I_{min}/A}',
      `b=${params.b} mm，h=${params.h} mm`,
      `A=${g.A.toFixed(1)} mm²，Imin=${g.Imin.toFixed(1)} mm⁴，i=${g.i.toFixed(3)} mm`,
      '压杆绕弱轴失稳（取 Imin）', []),
    step(1, '长细比与适用范围', '\\lambda=\\frac{\\mu L}{i},\\ \\lambda_p=\\pi\\sqrt{\\frac{E}{\\sigma_p}}',
      `μ=${params.mu}，L=${params.L} m，E=${params.E} GPa，σp=${params.sp} MPa`,
      `λ=${g.lambda.toFixed(2)}，λp=${g.lambdaP.toFixed(2)}`,
      eulerValid ? 'λ ≥ λp ⇒ 落在欧拉适用范围内' : 'λ < λp ⇒ **超出欧拉适用范围**', []),
    step(2, '欧拉临界应力', '\\sigma_{cr}=\\frac{\\pi^2E}{\\lambda^2}',
      eulerValid ? `π²·${params.E * 1000}/${g.lambda.toFixed(1)}²` : '不适用：λ < λp，公式前提不成立',
      eulerValid ? `σcr=${euler.sigmaCr.toFixed(3)} MPa` : '—（不给数字）',
      '欧拉公式（仅 λ ≥ λp 有效）', []),
    step(3, '临界载荷', 'P_{cr}=\\sigma_{cr}A',
      eulerValid ? `${euler.sigmaCr.toFixed(3)} MPa × ${g.A.toFixed(1)} mm²` : '不适用',
      eulerValid ? `Pcr=${euler.pCr.toFixed(2)} kN` : '—（不给数字）', '临界载荷定义', []),
    step(4, '稳定校核', '\\sigma=\\frac{P}{A}\\le\\frac{\\sigma_{cr}}{[n]}',
      eulerValid ? `σ=${sigmaWork.toFixed(3)} MPa，σcr/[n]=${allowStability.toFixed(3)} MPa` : '超出适用范围，不做稳定校核',
      verdict.text, `稳定安全系数 [n]=${M7_STABILITY_FACTOR}（本页假设，不是库给的）`, []),
  ];

  const chartSpec: RenderSpec = {
    id: 'euler',
    role: 'primary',
    type: 'beam',
    nodes: [],
    edges: [],
    chart,
    frames: [],
  };

  return {
    templateId: 'M7',
    subject: 'mechanics',
    parsed_given: { L: params.L, b: params.b, h: params.h, E: params.E, mu: params.mu, P: params.P, sp: params.sp },
    steps,
    result: {
      A: Number(g.A.toFixed(3)),
      Imin: Number(g.Imin.toFixed(3)),
      i: Number(g.i.toFixed(6)),
      lambda: Number(g.lambda.toFixed(6)),
      lambdaP: Number(g.lambdaP.toFixed(6)),
      sigmaCr: eulerValid ? Number(euler.sigmaCr.toFixed(6)) : '—',
      pCr: eulerValid ? Number(euler.pCr.toFixed(6)) : '—',
      sigmaWork: Number(sigmaWork.toFixed(6)),
      sigmaAllowStability: eulerValid ? Number(allowStability.toFixed(6)) : '—',
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [chartSpec, checksMatrix(checks, steps.length, checks.map(() => '本页自算'))],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: eulerValid
      ? [`稳定安全系数 [n]=${M7_STABILITY_FACTOR} 与比例极限 σp=${params.sp} MPa 为本页假设，可按材料替换`]
      : [
          `λ=${g.lambda.toFixed(1)} < λp=${g.lambdaP.toFixed(1)}：超出欧拉公式适用范围，本页不给 σcr / Pcr 数字`,
        ],
  };
}
