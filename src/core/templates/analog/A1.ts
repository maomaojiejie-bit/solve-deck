/**
 * A1 二极管：串联限幅 / 稳压管。
 * A 图解法（负载线与分段特性交点）；B 分段线性迭代；C 理想模型上下界。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { board } from '../../../render/templates/schematicBoard.ts';

export type DiodeMode = 'series' | 'zener';

export interface A1Params {
  mode: DiodeMode;
  Vs: number;
  R: number;
  Vf: number;
  Vz: number;
  Rz: number;
}

export interface A1Point {
  on: boolean;
  Vout: number;
  I: number;
}

export const A1_DEFAULT: A1Params = {
  mode: 'series',
  Vs: 5,
  R: 1_000,
  Vf: 0.7,
  Vz: 5.1,
  Rz: 10,
};

function pendingConfidence(): ConfidenceReport {
  const names = ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk'];
  return {
    scopeOk: 'skipped',
    inputOk: 'skipped',
    pathsConsistent: 'skipped',
    residualOk: 'skipped',
    boundaryOk: 'skipped',
    goldenOk: 'skipped',
    maxResidual: 0,
    checks: names.map((name) => ({
      name,
      state: 'skipped' as const,
      detail: 'solver 输出占位，等待 validateSolution',
      skipReason: '待校验',
    })),
    failedCount: 0,
    skippedCount: 6,
    allPassed: false,
  };
}

export function a1Params(input: Record<string, number | string>): A1Params {
  const mode = String(input.mode ?? A1_DEFAULT.mode) as DiodeMode;
  if (mode !== 'series' && mode !== 'zener') throw new Error(`A1 不支持 mode=${mode}`);
  const num = (key: string): number => {
    const raw = input[key];
    const value = raw === undefined ? (A1_DEFAULT as unknown as Record<string, number>)[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A1 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A1Params = {
    mode,
    Vs: num('Vs'),
    R: num('R'),
    Vf: num('Vf'),
    Vz: num('Vz'),
    Rz: num('Rz'),
  };
  if (params.R <= 0) throw new Error('A1 R 必须为正');
  if (params.Rz < 0) throw new Error('A1 Rz 不得为负');
  return params;
}

export function solvePiecewise(params: A1Params): A1Point {
  if (params.mode === 'series') {
    if (params.Vs > params.Vf) {
      const I = (params.Vs - params.Vf) / (params.R + params.Rz);
      return { on: true, Vout: params.Vf + I * params.Rz, I };
    }
    return { on: false, Vout: params.Vs, I: 0 };
  }
  if (params.Vs > params.Vz) {
    const I = (params.Vs - params.Vz) / (params.R + params.Rz);
    return { on: true, Vout: params.Vz + I * params.Rz, I };
  }
  return { on: false, Vout: params.Vs, I: 0 };
}

/** 图解法：在伏安特性上用负载线扫描找交点。 */
export function solveGraphical(params: A1Params): A1Point {
  const sample = (vout: number): number => {
    const iLoad = (params.Vs - vout) / params.R;
    if (params.mode === 'series') {
      if (vout < params.Vf) return iLoad; // 二极管截止，电流应为 0 才成立
      const iDiode = (vout - params.Vf) / Math.max(params.Rz, 1e-12);
      return iLoad - iDiode;
    }
    if (vout < params.Vz) return iLoad;
    const iZener = (vout - params.Vz) / Math.max(params.Rz, 1e-12);
    return iLoad - iZener;
  };
  const max = Math.max(params.Vs, params.Vf, params.Vz) + 1;
  const steps = 2000;
  let lo = 0;
  let hi = max;
  let flo = sample(lo);
  for (let index = 1; index <= steps; index += 1) {
    const x = (max * index) / steps;
    const fx = sample(x);
    if (flo * fx <= 0) {
      lo = (max * (index - 1)) / steps;
      hi = x;
      break;
    }
    flo = fx;
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (Math.abs(sample(mid)) < 1e-15) break;
    if (sample(lo) * sample(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const vout = (lo + hi) / 2;
  const I = (params.Vs - vout) / params.R;
  return { on: vout > (params.mode === 'series' ? params.Vf : params.Vz), Vout: vout, I };
}

export function idealBounds(params: A1Params): { low: number; high: number; detail: string } {
  if (params.mode === 'series') {
    const exact = solvePiecewise(params);
    if (!exact.on) return { low: params.Vs, high: params.Vs, detail: '理想开路=实际' };
    const idealShort = 0;
    return {
      low: idealShort,
      high: params.Vs,
      detail: '理想二极管短路(Vd=0)与恒压降(Vd=Vf)给出上下界',
    };
  }
  if (params.Vs <= params.Vz) return { low: params.Vs, high: params.Vs, detail: '未击穿，理想开路=实际' };
  return { low: params.Vz, high: params.Vs, detail: '理想稳压管钳位 Vz 到下界，未稳压 Vs 到上界' };
}

function schematicSpec(params: A1Params, point: A1Point, steps: number): RenderSpec {
  const b = board();
  const vs = b.part('n-src', 'vsrc', [160, 300], { label: `Vs ${params.Vs}V`, labelSide: 'left' });
  const r = b.part('n-r', 'res', [320, 200], { label: `R ${params.R}Ω`, labelSide: 'up' });
  const d = b.part('n-d', params.mode === 'zener' ? 'zener' : 'diode', [500, 200], {
    label: params.mode === 'zener' ? 'Z' : 'D',
    labelSide: 'up',
  });
  const gnd = b.part('n-gnd', 'gnd', [600, 400], { label: 'GND', labelSide: 'down' });
  b.dot('n-corner', [600, 400]);
  // 一个闭合回路：源 → R → D → 右侧竖线 → 底边 → 源
  b.wire('e-src-r', [vs.pin('p'), [160, 200], r.pin('a')]);
  b.wire('e-r-d', [r.pin('b'), d.pin('a')]);
  b.wire('e-d-gnd', [d.pin('c'), [600, 200], gnd.pin('t')]);
  b.wire('e-loop', [gnd.pin('t'), [160, 400], vs.pin('n')]);
  const nodes = b.nodes;
  const edges = b.edges;
  return {
    id: 'main',
    role: 'primary',
    type: 'schematic',
    nodes,
    edges,
    frames: Array.from({ length: steps }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: stepIndex >= 1 ? edges.map((edge) => edge.id) : [],
      activeNodes: stepIndex >= 1 ? nodes.map((node) => node.id) : [],
      labels: stepIndex >= 2 ? [{ id: 'n-d', text: `V=${point.Vout.toFixed(3)}V I=${(point.I * 1e3).toFixed(3)}mA` }] : [],
    })),
  };
}

export function solveA1(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A1 只接受结构化参数');
  const params = a1Params(input as Record<string, number | string>);
  const point = solvePiecewise(params);
  const bounds = idealBounds(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '画负载线与二极管特性',
      formula_tex: `V_S=I R+V_D`,
      substitution: `Vs=${params.Vs}V，R=${params.R}Ω，Vf=${params.Vf}V${params.mode === 'zener' ? `，Vz=${params.Vz}V` : ''}`,
      value: '负载线与分段特性交点即工作点',
      basis: '图解法',
      highlight: ['n-d'],
    },
    {
      i: 1,
      title: '假设导通/截止并回代',
      formula_tex: params.mode === 'series' ? `I=(V_S-V_f)/(R+R_z)` : `I=(V_S-V_Z)/(R+R_z)`,
      substitution: point.on ? '假设导通：电流为正、电压极性相符' : '假设截止：电流应为 0',
      value: `Vout=${point.Vout.toFixed(4)}V，I=${point.I.toFixed(6)}A`,
      basis: '分段线性迭代',
      highlight: ['n-d'],
    },
    {
      i: 2,
      title: '理想模型上下界',
      formula_tex: `0\\le V_D\\le V_f`,
      substitution: bounds.detail,
      value: `上界 ${bounds.high.toFixed(3)}V，下界 ${bounds.low.toFixed(3)}V`,
      basis: '理想二极管/稳压管的极限模型',
      highlight: [],
    },
    {
      i: 3,
      title: '确认工作点',
      formula_tex: `V_D=${point.Vout.toFixed(4)}V,\\quad I=${point.I.toFixed(6)}A`,
      substitution: `真实解落在理想上下界内：${point.Vout >= bounds.low - 1e-9 && point.Vout <= bounds.high + 1e-9}`,
      value: point.on ? '导通' : '截止',
      basis: '区间校验',
      highlight: ['n-d'],
    },
  ];

  return {
    templateId: 'A1',
    subject: 'analog',
    parsed_given: {
      mode: params.mode,
      Vs: params.Vs,
      R: params.R,
      Vf: params.Vf,      Vz: params.Vz,
      Rz: params.Rz,
    },
    steps,
    result: {
      mode: params.mode,
      on: point.on ? '是' : '否',
      Vout: point.Vout,
      I: point.I,
      lower: bounds.low,
      upper: bounds.high,
    },
    render_specs: [schematicSpec(params, point, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    // 修复计划 T3.2：结果卡写明模型口径 —— 表里的 Vout 就是这条式子算出来的，
    // 不再让人把 0.7426 V 当成「理想二极管 0.7V」的近似。
    warnings: [
      `模型口径：V_D = ${params.mode === 'zener' ? 'V_Z' : 'V_f'} + I·R_z（导通段把二极管 / 稳压管画成 ${params.mode === 'zener' ? 'V_Z' : 'V_f'} 串 Rz 的一阶线性模型；截止段 I=0、V_D=V_S）。`,
    ],
  };
}