/**
 * S7 虚位移原理：单自由度杠杆。
 *
 * 标准答案：支点 O、左臂 0.4 m 挂 100 N、右臂 0.6 m → F=66.67 N。
 *
 * 两条路径：
 *  A 虚功方程（给虚转角 δθ → δ₁=aδθ、δ₂=bδθ → W·δ₁ = F·δ₂）
 *  B 静力平衡 ΣM_O=0
 * 两者必须一致；再加一条「位移比 = 臂长比」把几何关系钉住。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import { checksMatrix, figureOf, frameOf, num, pendingConfidence, selfCheck, step } from './common.ts';

export interface S7Params {
  /** 左臂（重物侧），m。 */
  a: number;
  /** 右臂（平衡力侧），m。 */
  b: number;
  /** 左端重物，N。 */
  W: number;
}

export const S7_DEFAULTS: S7Params = { a: 0.4, b: 0.6, W: 100 };

export function s7Params(input: ParamRecord): S7Params {
  const params: S7Params = {
    a: num(input, 'a', S7_DEFAULTS.a),
    b: num(input, 'b', S7_DEFAULTS.b),
    W: num(input, 'W', S7_DEFAULTS.W),
  };
  if (!(params.a > 0) || !(params.b > 0)) throw new Error('S7 两个臂长必须 > 0');
  if (!(params.W > 0)) throw new Error('S7 重物 W 必须 > 0');
  return params;
}

/** 路径 A：虚功方程。δθ 取 1e-3 rad。 */
export function s7VirtualWork(params: S7Params): { F: number; d1: number; d2: number; work: number } {
  const dtheta = 1e-3;
  const d1 = params.a * dtheta;
  const d2 = params.b * dtheta;
  const F = (params.W * d1) / d2;
  return { F, d1, d2, work: params.W * d1 - F * d2 };
}

/** 路径 B：对 O 取矩。 */
export function s7Moment(params: S7Params): number {
  return (params.W * params.a) / params.b;
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

export function solveS7(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S7 只接受结构化参数');
  const params = s7Params(input as ParamRecord);
  const vw = s7VirtualWork(params);
  const F = s7Moment(params);

  const map = frameOf(
    [
      { x: -params.a, y: -0.18 },
      { x: params.b, y: 0.18 },
    ],
    { w: 700, h: 260, pad: 64 },
  );
  const px = (x: number) => map.sx(x);
  const py = (y: number) => map.sy(y);

  // 虚位移示意：放大到 4° 才看得见（标注写明「示意放大」）
  const theta = (4 * Math.PI) / 180;
  const rotated = (x: number): [number, number] => [px(x * Math.cos(theta)), py(x * Math.sin(theta))];

  const [leftX, leftY] = rotated(-params.a);
  const [rightX, rightY] = rotated(params.b);

  const nodes: ReturnType<typeof figureOf>['nodes'] = [
    { id: 'n-end-a', x: px(-params.a), y: py(0), kind: 'pin', label: '' },
    { id: 'n-end-b', x: px(params.b), y: py(0), kind: 'pin', label: '' },
    { id: 'n-pivot', x: px(0), y: py(0), kind: 'pinSupport', label: '支点 O', labelSide: 'down' },
    {
      id: 'n-w',
      x: px(-params.a),
      y: py(0),
      kind: 'arrow',
      rot: 0,
      label: `W = ${params.W} N`,
      labelSide: 'left',
    },
    {
      id: 'n-f',
      x: px(params.b),
      y: py(0),
      kind: 'arrow',
      rot: 180,
      label: `F = ${F.toFixed(2)} N`,
      labelSide: 'right',
    },
    { id: 'n-a', x: px(-params.a / 2), y: py(0) + 26, kind: 'text', label: `${params.a} m`, labelSide: 'down' },
    { id: 'n-b', x: px(params.b / 2), y: py(0) + 26, kind: 'text', label: `${params.b} m`, labelSide: 'down' },
    { id: 'n-note', x: px(0), y: py(0) - 96, kind: 'text', label: '虚线 = 虚位移（示意放大 4°）', labelSide: 'up' },
  ];

  const edges: ReturnType<typeof figureOf>['edges'] = [
    {
      id: 'e-lever',
      from: 'n-end-a',
      to: 'n-end-b',
      kind: 'line',
      weight: 2,
      points: [
        [px(-params.a), py(0)],
        [px(params.b), py(0)],
      ] as [number, number][],
    },
    {
      id: 'e-virtual',
      from: 'n-end-a',
      to: 'n-end-b',
      kind: 'line',
      weight: 1,
      dashed: true,
      points: [
        [leftX, leftY],
        [rightX, rightY],
      ] as [number, number][],
    },
  ];

  const figure = figureOf({ id: 'main', nodes, edges, type: 'freebody' });

  const checks = [
    selfCheck('虚功方程残差 W·δ₁−F·δ₂', 0, vw.work, Math.abs(vw.work) / (params.W * vw.d1), Math.abs(vw.work) < 1e-12, `δθ=1e-3 rad ⇒ δ₁=${vw.d1.toExponential(3)} m，δ₂=${vw.d2.toExponential(3)} m`),
    selfCheck('虚功解 vs 静力解 F=Wa/b', F, vw.F, rel(F, vw.F), rel(F, vw.F) < 1e-12, '两条完全不同的推理：一个用虚位移，一个用 ΣM_O=0'),
    selfCheck('位移比 = 臂长比 δ₁/δ₂', params.a / params.b, vw.d1 / vw.d2, rel(params.a / params.b, vw.d1 / vw.d2), rel(params.a / params.b, vw.d1 / vw.d2) < 1e-12, `δ₁/δ₂=${(vw.d1 / vw.d2).toFixed(6)}，a/b=${(params.a / params.b).toFixed(6)}`),
    selfCheck('ΣM_O=0 残差', 0, params.W * params.a - F * params.b, Math.abs(params.W * params.a - F * params.b) / (params.W * params.a), Math.abs(params.W * params.a - F * params.b) < 1e-12, `W·a=${(params.W * params.a).toFixed(3)} N·m = F·b=${(F * params.b).toFixed(3)} N·m`),
  ];

  const steps = [
    step(0, '识别单自由度机构', '\\text{DOF}=1',
      `杠杆绕 O 转动，只有一个独立虚位移 δθ`,
      `左臂 ${params.a} m、右臂 ${params.b} m`, '虚位移原理要求理想约束', ['e-lever', 'n-pivot']),
    step(1, '给虚位移，写出各点位移', '\\delta_1=a\\,\\delta\\theta,\\ \\delta_2=b\\,\\delta\\theta',
      `δθ=1e-3 rad`,
      `δ₁=${vw.d1.toExponential(3)} m（向下），δ₂=${vw.d2.toExponential(3)} m（向上）`, '刚体绕定轴转动', ['e-virtual']),
    step(2, '虚功方程', '\\delta W=W\\delta_1-F\\delta_2=0',
      `${params.W}×${vw.d1.toExponential(3)} − F×${vw.d2.toExponential(3)} = 0`,
      `F=${vw.F.toFixed(3)} N`, '理想约束不做功，只有主动力做功', []),
    step(3, '静力法对照', '\\sum M_O=0:\\ Fb=Wa',
      `${params.W}×${params.a}/${params.b}`,
      `F=${F.toFixed(3)} N`, '与虚功解一致', []),
    step(4, '结论', 'F=\\frac{Wa}{b}',
      `${params.W}×${params.a}/${params.b}`,
      `F=${F.toFixed(2)} N（臂越长越省力）`, '杠杆原理', []),
  ];

  return {
    templateId: 'S7',
    subject: 'statics',
    parsed_given: { 左臂: params.a, 右臂: params.b, 重物: params.W },
    steps,
    result: {
      F: Number(F.toFixed(6)),
      delta1: Number(vw.d1.toExponential(6)),
      delta2: Number(vw.d2.toExponential(6)),
      ratio: Number((vw.d1 / vw.d2).toFixed(6)),
      status: 'ok',
      conclusion: `F=${F.toFixed(2)} N（虚功 F=Wa/b 与静力 ΣM_O=0 一致）`,
    },
    render_specs: [figure, checksMatrix(checks, steps.length, checks.map(() => '本页自算'))],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['S7 只做单自由度杠杆 / 简单机构；多自由度与摩擦做功不在范围内'],
  };
}
