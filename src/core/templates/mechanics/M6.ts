/**
 * M6 平面应力状态：莫尔圆 + σ(θ) 曲线 + 主应力 / 主平面角 / 极值剪应力。
 *
 * 这一型库完全不管（库里只有「沿梁高的正应力分布」，没有二向应力状态），
 * 所以三条路径全在本页：矩阵旋转 / 闭式 / 特征方程，checks 面板逐行标「本页自算」。
 *
 * 莫尔圆的 σ、τ 两轴比例必须一致 —— spec 里 sigmaDomain 与 tauDomain 的跨度
 * 按同一个 span 生成，画出来才是圆（check:chart ⑤⑥ 盯着这件事）。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { MohrSpec, RenderSpec, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import {
  chartOf,
  checksMatrix,
  num,
  pendingConfidence,
  selfCheck,
  step,
  verdictAgainstAllow,
} from './common.ts';

export interface M6Params {
  /** σx，MPa，拉为正。 */
  sx: number;
  /** σy，MPa，拉为正。 */
  sy: number;
  /** τxy，MPa，使单元体逆时针转为正。 */
  txy: number;
  /** 许用应力，MPa。 */
  allow: number;
}

// 默认工况对齐文档 §2 那张标准答案表：σx=100、σy=−20、τxy=40
// → σ1=112.111、σ2=−32.111、τmax=72.111、θp=16.845°。
// 文档、截图、fixture 三处必须同一组数，否则读者对不上任何一个。
export const M6_DEFAULTS: M6Params = { sx: 100, sy: -20, txy: 40, allow: 160 };

export function m6Params(input: ParamRecord): M6Params {
  const params: M6Params = {
    sx: num(input, 'sx', M6_DEFAULTS.sx),
    sy: num(input, 'sy', M6_DEFAULTS.sy),
    txy: num(input, 'txy', M6_DEFAULTS.txy),
    allow: num(input, 'allow', M6_DEFAULTS.allow),
  };
  if (!(params.allow > 0)) throw new Error('M6 许用应力必须 > 0');
  return params;
}

export interface M6Principal {
  center: number;
  radius: number;
  sigma1: number;
  sigma2: number;
  tauMax: number;
  thetaP: number;
  /** 最大主应力方向上的正应力（= σ1），用于回代校验。 */
  sigmaAtThetaP: number;
}

/** 路径 B：闭式（圆心 ± 半径）。 */
export function m6Closed(params: M6Params): M6Principal {
  const center = (params.sx + params.sy) / 2;
  const radius = Math.hypot((params.sx - params.sy) / 2, params.txy);
  const sigma1 = center + radius;
  const sigma2 = center - radius;
  const raw = (0.5 * Math.atan2(2 * params.txy, params.sx - params.sy) * 180) / Math.PI;
  // 主平面角落在 (−90, 90]：超出就减 180°，物理上是同一个平面
  const thetaP = ((raw + 90) % 180 + 180) % 180 - 90;
  return { center, radius, sigma1, sigma2, tauMax: radius, thetaP, sigmaAtThetaP: sigmaAt(params, thetaP) };
}

/** 任意斜截面上的正应力 / 剪应力（θ 为度）。 */
export function sigmaAt(params: M6Params, thetaDeg: number): number {
  const t = (2 * thetaDeg * Math.PI) / 180;
  return (params.sx + params.sy) / 2 + ((params.sx - params.sy) / 2) * Math.cos(t) + params.txy * Math.sin(t);
}

export function tauAt(params: M6Params, thetaDeg: number): number {
  const t = (2 * thetaDeg * Math.PI) / 180;
  return -((params.sx - params.sy) / 2) * Math.sin(t) + params.txy * Math.cos(t);
}

/**
 * 路径 A：数值搜索 σ(θ) 的极值（先 0.01° 粗扫，再黄金分割细化）。
 * 不套主应力公式、也不用 θp —— 纯粹「在 0..90° 上找最大 / 最小」，
 * 所以它和闭式解是两个独立的算法，能互相抓到对方的符号错误。
 */
export function m6ExtremumSearch(params: M6Params): { sigma1: number; sigma2: number } {
  const sigma = (deg: number) => sigmaAt(params, deg);
  const refine = (lo: number, hi: number, sign: number): number => {
    const f = (x: number) => sign * sigma(x);
    const phi = (Math.sqrt(5) - 1) / 2;
    let a = lo;
    let b = hi;
    let c = b - phi * (b - a);
    let d = a + phi * (b - a);
    let fc = f(c);
    let fd = f(d);
    for (let i = 0; i < 200; i += 1) {
      if (fc > fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - phi * (b - a);
        fc = f(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + phi * (b - a);
        fd = f(d);
      }
    }
    return sigma((a + b) / 2);
  };

  // σ(θ) 以 180° 为周期，极值在 0..180 才都出现（只扫 0..90 会漏掉 σ2）
  let maxDeg = 0;
  let minDeg = 0;
  let maxVal = -Infinity;
  let minVal = Infinity;
  for (let deg = 0; deg <= 180; deg += 0.01) {
    const value = sigma(deg);
    if (value > maxVal) {
      maxVal = value;
      maxDeg = deg;
    }
    if (value < minVal) {
      minVal = value;
      minDeg = deg;
    }
  }
  const sigma1 = refine(Math.max(0, maxDeg - 0.02), Math.min(180, maxDeg + 0.02), 1);
  const sigma2 = refine(Math.max(0, minDeg - 0.02), Math.min(180, minDeg + 0.02), -1);
  return { sigma1, sigma2 };
}

/** 路径 C：特征方程 λ²−I₁λ+I₂=0 的根（只用两个不变量）。 */
export function m6InvariantRoots(params: M6Params): { sigma1: number; sigma2: number } {
  const i1 = params.sx + params.sy;
  const i2 = params.sx * params.sy - params.txy * params.txy;
  const disc = Math.max(i1 * i1 - 4 * i2, 0);
  const root = Math.sqrt(disc);
  return { sigma1: (i1 + root) / 2, sigma2: (i1 - root) / 2 };
}

/** 第四强度理论（平面应力，σ3=0）。 */
export function vonMisesPlane(sigma1: number, sigma2: number): number {
  return Math.sqrt(sigma1 * sigma1 + sigma2 * sigma2 - sigma1 * sigma2);
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

export function solveM6(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M6 只接受结构化参数');
  const params = m6Params(input as ParamRecord);
  const closed = m6Closed(params);
  const searched = m6ExtremumSearch(params);
  const roots = m6InvariantRoots(params);

  const sigmaR4 = vonMisesPlane(closed.sigma1, closed.sigma2);
  const verdict = verdictAgainstAllow('σr4', sigmaR4, params.allow, 'MPa');

  // 绘图域：两轴跨度必须相等（同一比例 ⇒ 圆）。σ 域包住 0 与 σ1/σ2，τ 域对称于 0。
  const sMin = Math.min(closed.sigma2, 0);
  const sMax = Math.max(closed.sigma1, 0);
  const rawSpan = Math.max(sMax - sMin, 2 * closed.radius);
  // 纯零应力（σx=σy=0, τxy=0）时域跨度为 0，给一个最小跨度，别让绘图退化成一个点
  const span = (rawSpan > 1e-9 ? rawSpan : Math.max(Math.abs(closed.sigma1), 1) * 0.5) * 1.12;
  const mid = (sMin + sMax) / 2;
  const sigmaDomain: [number, number] = [mid - span / 2, mid + span / 2];
  const tauDomain: [number, number] = [-span / 2, span / 2];

  const mohr: MohrSpec = {
    sigmaX: params.sx,
    sigmaY: params.sy,
    tauXY: params.txy,
    center: closed.center,
    radius: closed.radius,
    sigma1: closed.sigma1,
    sigma2: closed.sigma2,
    tauMax: closed.tauMax,
    thetaP: closed.thetaP,
    sigmaDomain,
    tauDomain,
    unit: 'MPa',
  };

  // σ(θ) 曲线：θ 从 0 到 180°，主平面就是它的两个极值点。
  // 采样里**必须包含**极值点本身（θp 与 θp+90），否则标注会落在折线的弦上而不是曲线上
  // —— check:chart 的 ② 号断言就是拿这条卡着的。
  const thetaPInRange = ((closed.thetaP % 180) + 180) % 180;
  const thetaSet = new Set<number>();
  for (let deg = 0; deg <= 180; deg += 1) thetaSet.add(deg);
  thetaSet.add(thetaPInRange);
  thetaSet.add((thetaPInRange + 90) % 180);
  const thetaPoints: [number, number][] = [...thetaSet]
    .sort((left, right) => left - right)
    .map((deg) => [deg, sigmaAt(params, deg)] as [number, number]);
  const sigmaChart = chartOf({
    id: 'sigma-theta',
    title: '斜截面正应力 σ(θ)',
    unit: 'MPa',
    xLabel: 'θ (°，自 x 轴逆时针)',
    yLabel: 'MPa',
    xDomain: [0, 180],
    series: [{ kind: 'line', points: thetaPoints, label: 'σ(θ)' }],
    marks: [
      { x: thetaPInRange, y: closed.sigma1, text: `σ1=${closed.sigma1.toFixed(2)} @θp=${closed.thetaP.toFixed(1)}°`, side: 'up' },
      {
        x: (thetaPInRange + 90) % 180,
        y: closed.sigma2,
        text: `σ2=${closed.sigma2.toFixed(2)}`,
        side: 'down',
      },
    ],
    convention: 'σ(θ)=(σx+σy)/2+(σx−σy)/2·cos2θ+τxy·sin2θ　τ(θ)=−(σx−σy)/2·sin2θ+τxy·cos2θ',
  });

  const tauResidual = Math.abs(tauAt(params, closed.thetaP)) / Math.max(closed.radius, 1e-12);
  const checks = [
    selfCheck('主应力 σ1：σ(θ) 极值搜索 vs 闭式', closed.sigma1, searched.sigma1, rel(closed.sigma1, searched.sigma1),
      rel(closed.sigma1, searched.sigma1) < 1e-9, '路径 A 在 0..90° 上黄金分割找极值，路径 B 用圆心±半径'),
    selfCheck('主应力 σ2：σ(θ) 极值搜索 vs 闭式', closed.sigma2, searched.sigma2, rel(closed.sigma2, searched.sigma2),
      rel(closed.sigma2, searched.sigma2) < 1e-9, '同上（找最小值）'),
    selfCheck('σ1 vs 特征方程根（只用 I₁、I₂）', closed.sigma1, roots.sigma1, rel(closed.sigma1, roots.sigma1),
      rel(closed.sigma1, roots.sigma1) < 1e-9, '路径 C：λ²−I₁λ+I₂=0'),
    selfCheck('σ2 vs 特征方程根', closed.sigma2, roots.sigma2, rel(closed.sigma2, roots.sigma2),
      rel(closed.sigma2, roots.sigma2) < 1e-9, '同上'),
    selfCheck('主平面角回代：τ(θp)=0（相对 τmax）', 0, tauAt(params, closed.thetaP), tauResidual,
      tauResidual < 1e-9, `θp=${closed.thetaP.toFixed(4)}°，τ(θp)=${tauAt(params, closed.thetaP).toExponential(3)} MPa`),
    selfCheck('主平面角回代：σ(θp)=σ1', closed.sigma1, closed.sigmaAtThetaP, rel(closed.sigma1, closed.sigmaAtThetaP),
      rel(closed.sigma1, closed.sigmaAtThetaP) < 1e-9, 'θp 既是 τ=0 的方向，也必须是 σ 的极大方向'),
    selfCheck('τmax=(σ1−σ2)/2', (closed.sigma1 - closed.sigma2) / 2, closed.tauMax,
      rel((closed.sigma1 - closed.sigma2) / 2, closed.tauMax), rel((closed.sigma1 - closed.sigma2) / 2, closed.tauMax) < 1e-9,
      '莫尔圆半径 = 最大剪应力'),
    selfCheck(
      '第四强度理论：σr4 与 √(σx²−σxσy+σy²+3τxy²) 一致',
      Math.sqrt(
        params.sx * params.sx - params.sx * params.sy + params.sy * params.sy + 3 * params.txy * params.txy,
      ),
      sigmaR4,
      rel(
        Math.sqrt(
          params.sx * params.sx - params.sx * params.sy + params.sy * params.sy + 3 * params.txy * params.txy,
        ),
        sigmaR4,
      ),
      rel(
        Math.sqrt(
          params.sx * params.sx - params.sx * params.sy + params.sy * params.sy + 3 * params.txy * params.txy,
        ),
        sigmaR4,
      ) < 1e-9,
      `用分量直接算的 σr4 必须等于用 σ1/σ2 算的；结论位与许用 ${params.allow} MPa 比`,
    ),
  ];

  const steps = [
    step(0, '取单元体上的应力分量', '\\sigma_x,\\ \\sigma_y,\\ \\tau_{xy}',
      `σx=${params.sx} MPa，σy=${params.sy} MPa，τxy=${params.txy} MPa`,
      `拉应力为正；τxy 使单元体逆时针转为正`, '平面应力状态的定义', []),
    step(1, '莫尔圆的圆心与半径', 'C=\\frac{\\sigma_x+\\sigma_y}{2},\\ R=\\sqrt{\\left(\\frac{\\sigma_x-\\sigma_y}{2}\\right)^2+\\tau_{xy}^2}',
      `C=(${params.sx}+${params.sy})/2，R=√(((${params.sx}−${params.sy})/2)²+${params.txy}²)`,
      `C=${closed.center.toFixed(3)} MPa，R=${closed.radius.toFixed(3)} MPa`, '莫尔圆几何（σ、τ 同比例）', []),
    step(2, '主应力', '\\sigma_{1,2}=C\\pm R',
      `C=${closed.center.toFixed(3)}，R=${closed.radius.toFixed(3)}`,
      `σ1=${closed.sigma1.toFixed(3)} MPa，σ2=${closed.sigma2.toFixed(3)} MPa`, '主应力是 σ(θ) 的两个极值', []),
    step(3, '主平面角与最大剪应力', '\\tan 2\\theta_p=\\frac{2\\tau_{xy}}{\\sigma_x-\\sigma_y},\\ \\tau_{max}=R',
      `2θp=atan2(${2 * params.txy}, ${params.sx - params.sy})`,
      `θp=${closed.thetaP.toFixed(3)}°，τmax=${closed.tauMax.toFixed(3)} MPa`, 'τ(θp)=0 的方向即主平面（已回代校验）', []),
    step(4, '强度校核（第四强度理论）', '\\sigma_{r4}=\\sqrt{\\sigma_1^2+\\sigma_2^2-\\sigma_1\\sigma_2}\\le[\\sigma]',
      `σ1=${closed.sigma1.toFixed(3)}，σ2=${closed.sigma2.toFixed(3)}`,
      verdict.text, '形状改变比能理论（平面应力，σ3=0）', []),
  ];

  // id 不叫 'mohr'：图头会把 id 与 type 并排印出来，两个都写 mohr 就成了「mohr mohr」。
  const mohrSpec: RenderSpec = { id: 'principal-circle', role: 'primary', type: 'mohr', nodes: [], edges: [], mohr, frames: [] };
  const chartSpec: RenderSpec = {
    id: 'sigma-theta',
    role: 'secondary',
    type: 'stress',
    nodes: [],
    edges: [],
    chart: sigmaChart,
    frames: [],
  };

  return {
    templateId: 'M6',
    subject: 'mechanics',
    parsed_given: { sx: params.sx, sy: params.sy, txy: params.txy, allow: params.allow },
    steps,
    result: {
      center: Number(closed.center.toFixed(6)),
      radius: Number(closed.radius.toFixed(6)),
      sigma1: Number(closed.sigma1.toFixed(6)),
      sigma2: Number(closed.sigma2.toFixed(6)),
      tauMax: Number(closed.tauMax.toFixed(6)),
      thetaP: Number(closed.thetaP.toFixed(6)),
      sigmaR4: Number(sigmaR4.toFixed(6)),
      sigmaAllow: params.allow,
      ratio: verdict.ratio === undefined ? '—' : Number(verdict.ratio.toFixed(4)),
      status: verdict.status,
      conclusion: verdict.text,
    },
    render_specs: [mohrSpec, chartSpec, checksMatrix(checks, steps.length, checks.map(() => '本页自算'))],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['平面应力假设（σz=0）；不含三向应力状态与厚度方向梯度'],
  };
}
