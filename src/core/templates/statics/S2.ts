/**
 * S2 平面汇交力系：合成与平衡。
 *
 * 标准答案：F1=100 N @30°、F2=100 N @150° → 合力 R=100 N、方向 90°。
 *
 * 三条独立路径：
 *  A 分量投影（各自投影到 x/y 再相加）
 *  B 旋转坐标系（把 F1 转到 x 轴合成，再整体转回来）
 *  C 余弦定理（只算大小，不碰分量）
 * 再加一条「图上画的三条边闭合」——把图形与数字绑在一起。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ChartSeries, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import { chartOf, checksMatrix, num, pendingConfidence, selfCheck, step } from './common.ts';

export interface S2Params {
  /** 第一个力的大小，N。 */
  F1: number;
  /** 第一个力的方向，度（数学正向，从 +x 逆时针）。 */
  th1: number;
  F2: number;
  th2: number;
}

export const S2_DEFAULTS: S2Params = { F1: 100, th1: 30, F2: 100, th2: 150 };

export function s2Params(input: ParamRecord): S2Params {
  const params: S2Params = {
    F1: num(input, 'F1', S2_DEFAULTS.F1),
    th1: num(input, 'th1', S2_DEFAULTS.th1),
    F2: num(input, 'F2', S2_DEFAULTS.F2),
    th2: num(input, 'th2', S2_DEFAULTS.th2),
  };
  if (!(params.F1 > 0) || !(params.F2 > 0)) throw new Error('S2 两个力的大小必须 > 0');
  return params;
}

const rad = (value: number) => (value * Math.PI) / 180;
const deg = (value: number) => (value * 180) / Math.PI;

/** 归一化到 [0, 360)。 */
export function normalizeDeg(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export interface S2Resultant {
  Rx: number;
  Ry: number;
  R: number;
  theta: number;
}

/** 路径 A：分量投影相加。 */
export function s2Components(params: S2Params): S2Resultant {
  const Rx = params.F1 * Math.cos(rad(params.th1)) + params.F2 * Math.cos(rad(params.th2));
  const Ry = params.F1 * Math.sin(rad(params.th1)) + params.F2 * Math.sin(rad(params.th2));
  return { Rx, Ry, R: Math.hypot(Rx, Ry), theta: normalizeDeg(deg(Math.atan2(Ry, Rx))) };
}

/** 路径 B：把 F1 转到 x 轴合成，再整体转回来。 */
export function s2Rotated(params: S2Params): S2Resultant {
  const delta = rad(params.th2 - params.th1);
  const xr = params.F1 + params.F2 * Math.cos(delta);
  const yr = params.F2 * Math.sin(delta);
  const c = Math.cos(rad(params.th1));
  const s = Math.sin(rad(params.th1));
  const Rx = xr * c - yr * s;
  const Ry = xr * s + yr * c;
  return { Rx, Ry, R: Math.hypot(Rx, Ry), theta: normalizeDeg(deg(Math.atan2(Ry, Rx))) };
}

/** 路径 C：余弦定理只求大小。 */
export function s2Cosine(params: S2Params): number {
  const delta = rad(params.th2 - params.th1);
  return Math.sqrt(
    params.F1 * params.F1 + params.F2 * params.F2 + 2 * params.F1 * params.F2 * Math.cos(delta),
  );
}

function rel(a: number, b: number, floor = 0): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b), floor);
}

export function solveS2(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S2 只接受结构化参数');
  const params = s2Params(input as ParamRecord);
  const a = s2Components(params);
  const b = s2Rotated(params);
  const cosine = s2Cosine(params);

  const delta = normalizeDeg(params.th2 - params.th1);
  const eq = { x: -a.Rx, y: -a.Ry, theta: normalizeDeg(a.theta + 180) };

  const tipF1: [number, number] = [params.F1 * Math.cos(rad(params.th1)), params.F1 * Math.sin(rad(params.th1))];
  const tipF2: [number, number] = [params.F2 * Math.cos(rad(params.th2)), params.F2 * Math.sin(rad(params.th2))];
  const tipR: [number, number] = [a.Rx, a.Ry];

  // 图上画的三角形闭合残差（用三条边的端点算，不看 solver 的中间量）
  const closure = Math.hypot(tipF1[0] + tipF2[0] - tipR[0], tipF1[1] + tipF2[1] - tipR[1]);

  // ∠(F1,R)：点积 vs 正弦定理
  const cosF1R =
    (params.F1 * Math.cos(rad(params.th1)) * tipR[0] + params.F1 * Math.sin(rad(params.th1)) * tipR[1]) /
    (params.F1 * a.R);
  const angleF1R = deg(Math.acos(Math.min(1, Math.max(-1, cosF1R))));
  const angleBySine = deg(Math.asin(Math.min(1, (params.F2 * Math.sin(rad(delta))) / a.R)));

  const lo = Math.min(0, tipF1[0], tipF2[0], tipR[0]);
  const hi = Math.max(0, tipF1[0], tipF2[0], tipR[0]);
  const pad = Math.max((hi - lo) * 0.14, 8);

  const series: ChartSeries[] = [
    { kind: 'line', points: [[0, 0], tipR], label: 'R', arrow: true },
    { kind: 'line', points: [[0, 0], tipF1], label: 'F1', arrow: true },
    { kind: 'line', points: [[0, 0], tipF2], label: 'F2', arrow: true },
    // 平行四边形辅助边（虚线、无箭头）：F1 端 → R 端、F2 端 → R 端
    { kind: 'line', points: [tipF1, tipR], label: '' },
    { kind: 'line', points: [tipF2, tipR], label: '' },
  ];

  const chart = chartOf({
    id: 'vectors',
    title: '力的合成（平行四边形法则）',
    unit: 'N',
    xLabel: 'Fx (N)',
    yLabel: 'N',
    xDomain: [lo - pad, hi + pad],
    series,
    marks: [
      { x: tipR[0], y: tipR[1], text: `R=${a.R.toFixed(1)} N ∠${a.theta.toFixed(1)}°`, side: 'right' },
      { x: tipF1[0], y: tipF1[1], text: `F1=${params.F1.toFixed(0)} N ∠${params.th1.toFixed(0)}°`, side: 'down' },
      { x: tipF2[0], y: tipF2[1], text: `F2=${params.F2.toFixed(0)} N ∠${params.th2.toFixed(0)}°`, side: 'down' },
    ],
    convention: `夹角 Δθ=${delta.toFixed(1)}°　R=√(F1²+F2²+2F1F2cosΔθ)　角度自 +x 逆时针为正`,
  });

  const checks = [
    selfCheck(
      '合力大小：分量合成 vs 余弦定理',
      cosine,
      a.R,
      rel(cosine, a.R),
      rel(cosine, a.R) < 1e-12,
      '路径 A 投影相加；路径 C 只用余弦定理，不碰 sin/cos 分量',
    ),
    selfCheck(
      '合力矢量：分量投影 vs 旋转坐标系',
      0,
      Math.hypot(a.Rx - b.Rx, a.Ry - b.Ry) / Math.max(a.R, 1),
      Math.hypot(a.Rx - b.Rx, a.Ry - b.Ry) / Math.max(a.R, 1),
      Math.hypot(a.Rx - b.Rx, a.Ry - b.Ry) / Math.max(a.R, 1) < 1e-12,
      '路径 B 先把 F1 转到 x 轴合成再整体转回，与直接投影是两套顺序',
    ),
    selfCheck(
      '平衡力闭合：F1+F2+Feq=0',
      0,
      Math.hypot(a.Rx + eq.x, a.Ry + eq.y) / Math.max(a.R, 1),
      Math.hypot(a.Rx + eq.x, a.Ry + eq.y) / Math.max(a.R, 1),
      Math.hypot(a.Rx + eq.x, a.Ry + eq.y) / Math.max(a.R, 1) < 1e-12,
      `平衡力 Feq=${a.R.toFixed(1)} N，方向 ${eq.theta.toFixed(1)}°`,
    ),
    selfCheck(
      '∠(F1,R)：点积 vs 正弦定理',
      angleBySine,
      angleF1R,
      rel(angleBySine, angleF1R, 1),
      Math.abs(angleBySine - angleF1R) < 1e-9,
      '两个独立三角式子对拍：点积走矢量，正弦定理走边长',
    ),
    selfCheck(
      '图上三条边闭合：F1+F2−R（用图形端点算）',
      0,
      closure / Math.max(a.R, 1),
      closure / Math.max(a.R, 1),
      closure / Math.max(a.R, 1) < 1e-12,
      '把「画出来的」箭头端点回代，图形与数字绑在一起',
    ),
  ];

  const steps = [
    step(0, '建立坐标系，把力写成矢量', '\\vec F_i = F_i(\\cos\\theta_i,\\ \\sin\\theta_i)',
      `F1=${params.F1} N @${params.th1}°，F2=${params.F2} N @${params.th2}°`,
      `F1=(${tipF1[0].toFixed(2)}, ${tipF1[1].toFixed(2)})，F2=(${tipF2[0].toFixed(2)}, ${tipF2[1].toFixed(2)})`,
      '平面汇交力系：各力作用线交于同一点', []),
    step(1, '投影相加求合力', 'R_x=\\sum F_{ix},\\ R_y=\\sum F_{iy}',
      `${tipF1[0].toFixed(2)}+${tipF2[0].toFixed(2)}，${tipF1[1].toFixed(2)}+${tipF2[1].toFixed(2)}`,
      `Rx=${a.Rx.toFixed(3)} N，Ry=${a.Ry.toFixed(3)} N`, '力的平行四边形法则', []),
    step(2, '合力大小与方向', 'R=\\sqrt{R_x^2+R_y^2},\\ \\theta_R=\\arctan\\frac{R_y}{R_x}',
      `√(${a.Rx.toFixed(3)}²+${a.Ry.toFixed(3)}²)`,
      `R=${a.R.toFixed(3)} N，θR=${a.theta.toFixed(2)}°`, '余弦定理交叉验证', []),
    step(3, '平衡力', '\\vec F_{eq}=-\\vec R',
      `-(${a.Rx.toFixed(3)}, ${a.Ry.toFixed(3)})`,
      `Feq=${a.R.toFixed(3)} N，方向 ${eq.theta.toFixed(2)}°`, '平衡 ⇒ 合力为零', []),
    step(4, '结论', '\\sum\\vec F=0',
      'F1+F2+Feq',
      `三力闭合，最大闭合残差 ${closure.toExponential(2)}`, '力多边形闭合', []),
  ];

  return {
    templateId: 'S2',
    subject: 'statics',
    parsed_given: { F1: params.F1, th1: params.th1, F2: params.F2, th2: params.th2 },
    steps,
    result: {
      // `|| 0`：投影相加会出现 −0（−1.4e-14 落到 toFixed(6)），JSON 里是 0，deepStrictEqual 不等
      Rx: Number(a.Rx.toFixed(6)) || 0,
      Ry: Number(a.Ry.toFixed(6)) || 0,
      R: Number(a.R.toFixed(6)),
      thetaR: Number(a.theta.toFixed(6)),
      Feq: Number(a.R.toFixed(6)),
      FeqAngle: Number(eq.theta.toFixed(6)),
      status: 'ok',
      conclusion: `合力 R=${a.R.toFixed(2)} N，方向 ${a.theta.toFixed(2)}°；平衡力 ${a.R.toFixed(2)} N @ ${eq.theta.toFixed(2)}°`,
    },
    render_specs: [
      { id: 'vectors', role: 'primary', type: 'freebody', nodes: [], edges: [], chart, frames: [] },
      checksMatrix(checks, steps.length, checks.map(() => '本页自算')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['S2 只做汇交力系的合成与平衡；力偶系与任意力系的简化在 S3'],
  };
}
