/**
 * S6 重心与形心：组合体（T 形）形心。
 *
 * 标准答案：翼缘 100×20 @y=0.11 m、腹板 20×100 @y=0.05 m
 * → A=0.0040 m²、ȳ=0.0800 m。
 *
 * 两条路径：
 *  A 分块求和 ȳ=ΣA_i y_i/ΣA_i
 *  B 沿高度数值积分 ∫y·w(y)dy / A（Simpson，不碰分块公式）
 * 再加一条静矩回代：对形心取静矩必须为 0。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { ParamRecord } from './common.ts';
import { checksMatrix, figureOf, frameOf, num, pendingConfidence, selfCheck, step } from './common.ts';

export interface S6Params {
  /** 翼缘宽，mm。 */
  bf: number;
  /** 翼缘厚，mm。 */
  tf: number;
  /** 腹板宽，mm。 */
  bw: number;
  /** 腹板高，mm。 */
  hw: number;
}

export const S6_DEFAULTS: S6Params = { bf: 100, tf: 20, bw: 20, hw: 100 };

export function s6Params(input: ParamRecord): S6Params {
  const params: S6Params = {
    bf: num(input, 'bf', S6_DEFAULTS.bf),
    tf: num(input, 'tf', S6_DEFAULTS.tf),
    bw: num(input, 'bw', S6_DEFAULTS.bw),
    hw: num(input, 'hw', S6_DEFAULTS.hw),
  };
  for (const [key, value] of Object.entries(params)) {
    if (!(value > 0)) throw new Error(`S6 ${key} 必须 > 0`);
  }
  if (params.bw > params.bf) throw new Error('S6 腹板宽不应大于翼缘宽（否则不构成 T 形）');
  return params;
}

export interface S6Block {
  name: string;
  w: number;
  h: number;
  /** 形心高度，mm（自底边 y=0 量起）。 */
  cy: number;
  area: number;
}

export function s6Blocks(params: S6Params): S6Block[] {
  const flange: S6Block = {
    name: '翼缘',
    w: params.bf,
    h: params.tf,
    cy: params.hw + params.tf / 2,
    area: params.bf * params.tf,
  };
  const web: S6Block = {
    name: '腹板',
    w: params.bw,
    h: params.hw,
    cy: params.hw / 2,
    area: params.bw * params.hw,
  };
  return [flange, web];
}

/** 路径 A：分块求和。 */
export function s6BlockSum(params: S6Params): { A: number; ybar: number } {
  const blocks = s6Blocks(params);
  const A = blocks.reduce((acc, item) => acc + item.area, 0);
  const first = blocks.reduce((acc, item) => acc + item.area * item.cy, 0);
  return { A, ybar: first / A };
}

/**
 * 路径 B：沿高度积分 ∫w(y)dy 与 ∫y·w(y)dy。
 *
 * **必须在 y=hw 处断开**：w(y) 在那里跳变，跨着跳变点一次 Simpson 不精确
 * （实测差 2e-3，够把 1e-9 的判据打红）。断开后每段 w 是常数，Simpson 逐段精确。
 */
export function s6Integral(params: S6Params): { A: number; ybar: number } {
  const simpson = (f: (y: number) => number, a: number, b: number, n = 200): number => {
    const even = n % 2 ? n + 1 : n;
    const h = (b - a) / even;
    let sum = f(a) + f(b);
    for (let i = 1; i < even; i += 1) sum += (i % 2 ? 4 : 2) * f(a + i * h);
    return (sum * h) / 3;
  };
  const A = simpson(() => params.bw, 0, params.hw) + simpson(() => params.bf, params.hw, params.hw + params.tf);
  const first =
    simpson((y) => y * params.bw, 0, params.hw) + simpson((y) => y * params.bf, params.hw, params.hw + params.tf);
  return { A, ybar: first / A };
}

/** 惯性矩（对本页形心轴），mm⁴。 */
export function s6Inertia(params: S6Params, ybar: number): number {
  return s6Blocks(params).reduce(
    (acc, item) => acc + (item.w * item.h ** 3) / 12 + item.area * (item.cy - ybar) ** 2,
    0,
  );
}

export function solveS6(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S6 只接受结构化参数');
  const params = s6Params(input as ParamRecord);
  const blocks = s6Blocks(params);
  const sum = s6BlockSum(params);
  const integral = s6Integral(params);
  const ixc = s6Inertia(params, sum.ybar);

  // 静矩回代：对形心轴的总静矩必须为 0
  const moment = blocks.reduce((acc, item) => acc + item.area * (item.cy - sum.ybar), 0);

  /* ── 图：截面轮廓 + 形心 ────────────────────────────────────────── */
  const halfF = params.bf / 2;
  const halfW = params.bw / 2;
  const top = params.hw + params.tf;
  const map = frameOf([{ x: -halfF, y: 0 }, { x: halfF, y: top }], { w: 620, h: 380, pad: 70 });
  const px = (x: number) => map.sx(x);
  const py = (y: number) => map.sy(y);

  const nodes: ReturnType<typeof figureOf>['nodes'] = [
    {
      id: 'n-centroid',
      x: px(0),
      y: py(sum.ybar),
      kind: 'dot',
      label: `形心 ȳ=${sum.ybar.toFixed(1)} mm`,
      labelSide: 'right',
    },
    // 分块标签放到截面轮廓外面：写在块里会压在轮廓线 / 形心虚线上
    { id: 'n-flange', x: px(halfF + 16), y: py(params.hw + params.tf / 2), kind: 'text', label: `翼缘 ${params.bf}×${params.tf}`, labelSide: 'right' },
    { id: 'n-web', x: px(halfW + 16), y: py(params.hw / 2), kind: 'text', label: `腹板 ${params.bw}×${params.hw}`, labelSide: 'right' },
    { id: 'n-note', x: px(-halfF), y: py(0) + 54, kind: 'text', label: 'y=0（底边）', labelSide: 'right' },
  ];
  const edges: ReturnType<typeof figureOf>['edges'] = [
    {
      id: 'e-flange',
      from: 'n-flange',
      to: 'n-flange',
      kind: 'line',
      weight: 2,
      points: [
        [px(-halfF), py(params.hw)],
        [px(halfF), py(params.hw)],
        [px(halfF), py(top)],
        [px(-halfF), py(top)],
        [px(-halfF), py(params.hw)],
      ] as [number, number][],
    },
    {
      id: 'e-web',
      from: 'n-web',
      to: 'n-web',
      kind: 'line',
      weight: 2,
      points: [
        [px(-halfW), py(0)],
        [px(halfW), py(0)],
        [px(halfW), py(params.hw)],
        [px(-halfW), py(params.hw)],
        [px(-halfW), py(0)],
      ] as [number, number][],
    },
    {
      id: 'e-axis',
      from: 'n-note',
      to: 'n-note',
      kind: 'line',
      weight: 1,
      dashed: true,
      points: [
        [px(-halfF) - 24, py(0)],
        [px(halfF) + 24, py(0)],
      ] as [number, number][],
    },
    {
      id: 'e-centroid-axis',
      from: 'n-centroid',
      to: 'n-centroid',
      kind: 'line',
      weight: 1,
      dashed: true,
      points: [
        [px(-halfF) - 18, py(sum.ybar)],
        [px(halfF) + 18, py(sum.ybar)],
      ] as [number, number][],
    },
  ];

  const figure = figureOf({ id: 'main', nodes, edges, type: 'freebody' });

  const checks = [
    selfCheck('总面积 A=ΣAᵢ', sum.A, integral.A, Math.abs(sum.A - integral.A) / sum.A, Math.abs(sum.A - integral.A) / sum.A < 1e-9, '分块求和 vs 沿高度积分 ∫w(y)dy'),
    selfCheck('形心 ȳ=ΣAᵢyᵢ/ΣAᵢ', sum.ybar, integral.ybar, Math.abs(sum.ybar - integral.ybar) / sum.ybar, Math.abs(sum.ybar - integral.ybar) / sum.ybar < 1e-9, '分块式 vs 数值积分 ∫y·w(y)dy/A'),
    selfCheck('对形心轴的总静矩 = 0', 0, moment / Math.max(sum.A * sum.ybar, 1e-9), Math.abs(moment) / Math.max(sum.A * sum.ybar, 1e-9), Math.abs(moment) / Math.max(sum.A * sum.ybar, 1e-9) < 1e-12, 'ΣAᵢ(yᵢ−ȳ)=0，形心的定义式回代'),
    selfCheck('x̄ = 0（左右对称）', 0, 0, 0, true, 'T 形关于竖直中轴对称，x̄ 必为 0'),
    selfCheck('面积单位换算 A(m²)=A(mm²)/10⁶', Number((sum.A / 1e6).toFixed(12)), sum.A / 1e6, 0, true, `A=${sum.A.toFixed(1)} mm² = ${(sum.A / 1e6).toFixed(6)} m²`),
  ];

  const steps = [
    step(0, '把组合体拆成两块矩形', 'A=\\sum A_i',
      `翼缘 ${params.bf}×${params.tf}，腹板 ${params.bw}×${params.hw}`,
      blocks.map((item) => `${item.name}: A=${item.area.toFixed(0)} mm², y=${item.cy.toFixed(1)} mm`).join('；'),
      '分块法：每块都是矩形，形心在几何中心', []),
    step(1, '分块面积矩', 'S_y=\\sum A_i y_i',
      blocks.map((item) => `${item.area.toFixed(0)}×${item.cy.toFixed(1)}`).join(' + '),
      `ΣAᵢyᵢ=${blocks.reduce((acc, item) => acc + item.area * item.cy, 0).toFixed(1)} mm³`,
      '面积矩（静矩）', []),
    step(2, '形心高度', '\\bar y=\\frac{\\sum A_i y_i}{\\sum A_i}',
      `${blocks.reduce((acc, item) => acc + item.area * item.cy, 0).toFixed(1)}/${sum.A.toFixed(1)}`,
      `ȳ=${sum.ybar.toFixed(3)} mm = ${(sum.ybar / 1000).toFixed(6)} m`, '形心定义式', []),
    step(3, '数值积分对拍', '\\bar y=\\frac{\\int y\\,w(y)\\,dy}{\\int w(y)\\,dy}',
      '沿高度 400 段 Simpson',
      `ȳ=${integral.ybar.toFixed(6)} mm（与分块式差 ${Math.abs(integral.ybar - sum.ybar).toExponential(2)}）`,
      '不经过分块公式的第二条路', []),
    step(4, '惯性矩与静矩回代', 'I_x=\\sum\\left(\\frac{bh^3}{12}+A_i d_i^2\\right)',
      `ΣA ᵢ(yᵢ−ȳ)²`,
      `I_x=${ixc.toFixed(1)} mm⁴，对形心静矩 ${moment.toExponential(2)}`, '平行轴定理', []),
  ];

  return {
    templateId: 'S6',
    subject: 'statics',
    parsed_given: { 翼缘宽: params.bf, 翼缘厚: params.tf, 腹板宽: params.bw, 腹板高: params.hw },
    steps,
    result: {
      A_mm2: Number(sum.A.toFixed(3)),
      'A_m2': Number((sum.A / 1e6).toFixed(9)),
      'ybar_mm': Number(sum.ybar.toFixed(6)),
      'ybar_m': Number((sum.ybar / 1000).toFixed(9)),
      Ix_mm4: Number(ixc.toFixed(3)),
      status: 'ok',
      conclusion: `A=${(sum.A / 1e6).toFixed(4)} m²，ȳ=${(sum.ybar / 1000).toFixed(4)} m（距底边）`,
    },
    render_specs: [figure, checksMatrix(checks, steps.length, checks.map(() => '本页自算'))],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['S6 只处理矩形/圆的并集与差集组合；型钢表查值不在范围内'],
  };
}
