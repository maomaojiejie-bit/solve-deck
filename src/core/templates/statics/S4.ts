/**
 * S4 摩擦：临界平衡、摩擦角、自锁。
 *
 * 两个不同的 α 不要搞混（文档 §3 只给了 59.05 N 那一组数）：
 *  · `alpha` 是**水平面上斜拉**的拉角 → P_crit=μW/(cosα+μ sinα)，α=30°、μ=0.3、W=200 N ⇒ 59.05 N
 *  · `beta`  是**斜面的倾角** → 下滑自锁判据 β ≤ φf（φf=arctanμ=16.70°）
 *
 * 自锁这件事只能在斜面上讲（水平面上「拉不动」永远只是 P 不够大），
 * 所以两个角分开给，并在页面上写明各自属于哪个工况 —— 不合并成一个「α」蒙过去。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ChartSeries, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import { chartOf, checksMatrix, num, pendingConfidence, selfCheck, step } from './common.ts';
import { figureOf } from './common.ts';

export interface S4Params {
  /** 摩擦系数 μ。 */
  mu: number;
  /** 物重 W，N。 */
  W: number;
  /** 水平面上的拉角 α，度。 */
  alpha: number;
  /** 斜面倾角 β，度（自锁判据用）。 */
  beta: number;
}

export const S4_DEFAULTS: S4Params = { mu: 0.3, W: 200, alpha: 30, beta: 10 };

export function s4Params(input: ParamRecord): S4Params {
  const params: S4Params = {
    mu: num(input, 'mu', S4_DEFAULTS.mu),
    W: num(input, 'W', S4_DEFAULTS.W),
    alpha: num(input, 'alpha', S4_DEFAULTS.alpha),
    beta: num(input, 'beta', S4_DEFAULTS.beta),
  };
  if (!(params.mu > 0)) throw new Error('S4 摩擦系数 μ 必须 > 0');
  if (!(params.W > 0)) throw new Error('S4 物重 W 必须 > 0');
  if (!(params.alpha > 0) || params.alpha >= 90) throw new Error('S4 拉角 α 必须在 (0°, 90°) 内');
  if (!(params.beta >= 0) || params.beta >= 90) throw new Error('S4 斜面倾角 β 必须在 [0°, 90°) 内');
  return params;
}

const rad = (value: number) => (value * Math.PI) / 180;
const deg = (value: number) => (value * 180) / Math.PI;

/** 临界拉力（水平面斜拉）：P=μW/(cosα+μ sinα)。 */
export function s4CriticalPull(mu: number, W: number, alphaDeg: number): number {
  return (mu * W) / (Math.cos(rad(alphaDeg)) + mu * Math.sin(rad(alphaDeg)));
}

/** 摩擦角，度。 */
export function s4FrictionAngle(mu: number): number {
  return deg(Math.atan(mu));
}

/** 最优拉角下的最小拉力：Pmin=μW/√(1+μ²)（在 α=φf 处取到）。 */
export function s4MinPull(mu: number, W: number): number {
  return (mu * W) / Math.sqrt(1 + mu * mu);
}

function rel(a: number, b: number, floor = 0): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b), floor);
}

export function solveS4(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S4 只接受结构化参数');
  const params = s4Params(input as ParamRecord);
  const phiF = s4FrictionAngle(params.mu);
  const pCrit = s4CriticalPull(params.mu, params.W, params.alpha);
  const pMin = s4MinPull(params.mu, params.W);

  // 临界点上：N=W−P sinα，f=P cosα，应严格等于 μN
  const N = params.W - pCrit * Math.sin(rad(params.alpha));
  const f = pCrit * Math.cos(rad(params.alpha));
  const frictionRatio = f / N;
  const equilibriumResidual = pCrit * Math.cos(rad(params.alpha)) - params.mu * N;

  // dP/dα 在 α=φf 处为 0（中心差分）
  const h = 1e-4;
  const slopeAtPhi = (s4CriticalPull(params.mu, params.W, phiF + h) - s4CriticalPull(params.mu, params.W, phiF - h)) / (2 * h);

  const selfLock = params.beta <= phiF;
  // 独立复算：斜面上下滑条件 sinβ ≤ μcosβ（不经过 φf）
  const lockByBalance = Math.sin(rad(params.beta)) <= params.mu * Math.cos(rad(params.beta));

  /* ── P–α 曲线（水平面斜拉） ─────────────────────────────────────── */
  const alphaMin = 1;
  const alphaMax = 80;
  const alphaSet = new Set<number>();
  for (let i = 0; i <= 120; i += 1) alphaSet.add(alphaMin + ((alphaMax - alphaMin) * i) / 120);
  // 采样里必须含当前 α：标注点必须落在画出来的折线上（check:chart ②）
  alphaSet.add(params.alpha);
  const curve: [number, number][] = [...alphaSet]
    .sort((left, right) => left - right)
    .map((value) => [value, s4CriticalPull(params.mu, params.W, value)] as [number, number]);

  const pAtMax = s4CriticalPull(params.mu, params.W, alphaMax);
  const frictionLine: [number, number][] = [
    [phiF, 0],
    [phiF, pAtMax * 1.1],
  ];

  const series: ChartSeries[] = [
    { kind: 'line', points: curve, label: 'P_crit(α)' },
    { kind: 'line', points: frictionLine, label: '摩擦角 φf' },
  ];

  const chart = chartOf({
    id: 'pull',
    title: '临界拉力 P–α 曲线',
    unit: 'N',
    xLabel: '拉角 α (°)',
    yLabel: 'N',
    xDomain: [alphaMin, alphaMax],
    series,
    marks: [
      { x: params.alpha, y: pCrit, text: `P=${pCrit.toFixed(2)} N @ α=${params.alpha}°`, side: 'up' },
      { x: phiF, y: pMin, text: `φf=${phiF.toFixed(2)}°`, side: 'down' },
    ],
    convention: `水平面斜拉：P=μW/(cosα+μ sinα)　α=φf=arctan μ 时 P 最小　斜率 dP/dα=0`,
  });

  /* ── 物块受力图（W / N / f / P） ───────────────────────────────── */
  // 版面：块在中间，W 朝下、N 由地面向上（画在接地线下方，和梁的反力箭一样）、
  // f 贴左脸朝左、P 从右上斜拉走。四个标签分别放在左右两侧与块下方，互不叠字。
  const bx0 = 330;
  const bx1 = 450;
  const by0 = 150;
  const by1 = 215;
  const nodes: ReturnType<typeof figureOf>['nodes'] = [
    { id: 'n-block-a', x: bx0, y: by0, kind: 'pin', label: '' },
    { id: 'n-block-b', x: bx1, y: by0, kind: 'pin', label: '' },
    { id: 'n-block-c', x: bx1, y: by1, kind: 'pin', label: '' },
    { id: 'n-block-d', x: bx0, y: by1, kind: 'pin', label: '' },
    // W 的标签放到箭尾上方（写右边会正好压在接地线上）
    // 重力作用在形心：箭尖落在块内偏下处，标签就落到块顶之上，不压边框
    { id: 'n-w', x: (bx0 + bx1) / 2, y: by1 - 26, kind: 'arrow', rot: 0, label: `W = ${params.W} N`, labelSide: 'up' },
    // N 画在接地线下方、朝上顶住块底（写在块里会和 W 打架）
    { id: 'n-n', x: bx0 + 34, y: by1 + 58, kind: 'arrow', rot: 180, label: `N = ${N.toFixed(1)} N`, labelSide: 'left' },
    // f 贴左脸、朝左（即将右滑，摩擦力向反）
    { id: 'n-f', x: bx0 - 58, y: (by0 + by1) / 2, kind: 'arrow', rot: 90, label: `f = ${f.toFixed(1)} N`, labelSide: 'up' },
    {
      id: 'n-p',
      x: bx1 + 46 * Math.cos(rad(params.alpha)),
      y: by0 - 46 * Math.sin(rad(params.alpha)),
      kind: 'arrow',
      rot: 270 - params.alpha,
      label: `P = ${pCrit.toFixed(1)} N`,
      labelSide: 'right',
    },
    { id: 'n-label', x: (bx0 + bx1) / 2 + 150, y: by1 + 130, kind: 'text', label: '临界平衡（即将右滑，f=μN）', labelSide: 'up' },
  ];
  const edges = [
    {
      id: 'e-block',
      from: 'n-block-a',
      to: 'n-block-d',
      kind: 'line',
      weight: 2 as const,
      points: [
        [bx0, by0],
        [bx1, by0],
        [bx1, by1],
        [bx0, by1],
        [bx0, by0],
      ] as [number, number][],
    },
    {
      id: 'e-ground',
      from: 'n-block-d',
      to: 'n-block-c',
      kind: 'line',
      weight: 1 as const,
      points: [
        [bx0 - 40, by1],
        [bx1 + 40, by1],
      ] as [number, number][],
    },
    // 地面斜线：每根一段独立折线（拼成一条会把它们用横线连成一串）
    ...Array.from({ length: 9 }, (_, i) => {
      const x = bx0 - 36 + i * 24;
      return {
        id: `e-hatch-${i}`,
        from: 'n-block-d',
        to: 'n-block-c',
        kind: 'line',
        weight: 1 as const,
        points: [
          [x, by1 + 14],
          [x + 10, by1],
        ] as [number, number][],
      };
    }),
  ];

  const block = figureOf({ id: 'block', nodes, edges, role: 'secondary', type: 'freebody' });

  const checks = [
    selfCheck(
      '临界平衡残差：P(cosα+μ sinα)−μW',
      0,
      equilibriumResidual,
      Math.abs(equilibriumResidual) / (params.mu * params.W),
      Math.abs(equilibriumResidual) < 1e-9,
      `P=${pCrit.toFixed(3)} N，N=${N.toFixed(3)} N，f=${f.toFixed(3)} N`,
    ),
    selfCheck(
      '临界点摩擦比 f/N = μ',
      params.mu,
      frictionRatio,
      rel(params.mu, frictionRatio),
      rel(params.mu, frictionRatio) < 1e-12,
      '即将滑动 ⇒ 摩擦力刚好用到极限',
    ),
    selfCheck(
      '摩擦角 φf=arctan μ',
      deg(Math.atan(params.mu)),
      phiF,
      0,
      Math.abs(phiF - deg(Math.atan(params.mu))) < 1e-12,
      `φf=${phiF.toFixed(3)}°（tanφf=μ）`,
    ),
    selfCheck(
      '最优拉角处斜率 dP/dα≈0（α=φf）',
      0,
      slopeAtPhi / Math.max(pMin, 1),
      Math.abs(slopeAtPhi) / Math.max(pMin, 1),
      Math.abs(slopeAtPhi) / Math.max(pMin, 1) < 1e-6,
      `P 在 α=φf 取最小值 ${pMin.toFixed(3)} N`,
    ),
    selfCheck(
      '自锁判据：β≤φf 与斜面力平衡 sinβ≤μcosβ 一致',
      1,
      selfLock === lockByBalance ? 1 : 0,
      selfLock === lockByBalance ? 0 : 1,
      selfLock === lockByBalance,
      selfLock
        ? `β=${params.beta}° ≤ φf=${phiF.toFixed(2)}°：斜面上无论多重都不下滑（自锁）`
        : `β=${params.beta}° > φf=${phiF.toFixed(2)}°：不满足自锁，会下滑`,
    ),
  ];

  const steps = [
    step(0, '取物块为隔离体', '\\sum F_x=0,\\ \\sum F_y=0',
      `W=${params.W} N，P 与水平成 ${params.alpha}°，μ=${params.mu}`,
      `N=${N.toFixed(2)} N（P 的竖向分量减载），f=${f.toFixed(2)} N`, '水平面斜拉工况', []),
    step(1, '临界状态取 f=μN', 'f=\\mu N,\\ N=W-P\\sin\\alpha',
      `${params.mu}×${N.toFixed(3)}`,
      `f=${f.toFixed(2)} N（达极限）`, '即将滑动但尚未滑动', []),
    step(2, '解出临界拉力', 'P=\\frac{\\mu W}{\\cos\\alpha+\\mu\\sin\\alpha}',
      `(${params.mu}×${params.W})/(cos${params.alpha}°+${params.mu}·sin${params.alpha}°)`,
      `P_crit=${pCrit.toFixed(3)} N`, '一个方程一个未知量', []),
    step(3, '摩擦角与最优拉角', '\\varphi_f=\\arctan\\mu',
      `arctan ${params.mu}`,
      `φf=${phiF.toFixed(3)}°，此角下拉力最小 Pmin=${pMin.toFixed(3)} N`, 'tanφf=μ', []),
    step(4, '自锁判据（斜面工况）', '\\beta\\le\\varphi_f',
      `β=${params.beta}°，φf=${phiF.toFixed(3)}°`,
      selfLock ? '满足自锁：不加外力也不下滑' : '不满足自锁：会自行下滑',
      '斜面倾角 ≤ 摩擦角', []),
  ];

  return {
    templateId: 'S4',
    subject: 'statics',
    parsed_given: { mu: params.mu, W: params.W, alpha: params.alpha, beta: params.beta },
    steps,
    result: {
      Pcrit: Number(pCrit.toFixed(6)),
      phiF: Number(phiF.toFixed(6)),
      Pmin: Number(pMin.toFixed(6)),
      N: Number(N.toFixed(6)),
      friction: Number(f.toFixed(6)),
      selfLock: selfLock ? 1 : 0,
      status: 'ok',
      conclusion: `P_crit=${pCrit.toFixed(2)} N（α=${params.alpha}°），摩擦角 ${phiF.toFixed(2)}°，${selfLock ? '斜面 β 满足自锁' : '斜面 β 不满足自锁'}`,
    },
    render_specs: [
      { id: 'pull', role: 'primary', type: 'freebody', nodes: [], edges: [], chart, frames: [] },
      block,
      checksMatrix(checks, steps.length, checks.map(() => '本页自算')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [
      'S4 只做临界平衡与自锁判据；不含滚动摩擦与多点接触',
      `「α」是水平面斜拉的拉角，「β」是斜面倾角 —— 两个工况分开算，不合并`,
    ],
  };
}
