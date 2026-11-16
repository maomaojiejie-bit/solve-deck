/**
 * A2 BJT 直流工作点：分压偏置、截止/放大/饱和三区判定。
 *
 * 产品路径：工作区假设循环 → 线性化 MNA。
 * 构建期三路径：MNA / 回路方程 / 独立工作区重判。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { board } from '../../../render/templates/schematicBoard.ts';

export type BjtZone = 'cutoff' | 'active' | 'saturation';

export interface A2Params {
  Vcc: number;
  R1: number;
  R2: number;
  Rc: number;
  Re: number;
  beta: number;
  VBE: number;
  VCEsat: number;
}

export interface A2Point {
  zone: BjtZone;
  ib: number;
  ic: number;
  ie: number;
  vbe: number;
  vce: number;
}

export const A2_DEFAULT: A2Params = {
  Vcc: 12,
  // 全覆盖 F3：默认工作点要过自己的体检（VCE 在 33%–67% Vcc）——
  // R1=47k ⇒ VBB=2.105V ⇒ IC≈1.39mA ⇒ VCE≈6.0V（50% Vcc）。
  R1: 47_000,
  R2: 10_000,
  Rc: 3_300,
  Re: 1_000,
  beta: 100,
  VBE: 0.7,
  VCEsat: 0.2,
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

export function a2Params(input: Record<string, number | string>): A2Params {
  const num = (key: keyof A2Params): number => {
    const raw = input[key];
    const value = raw === undefined ? A2_DEFAULT[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A2 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A2Params = {
    Vcc: num('Vcc'),
    R1: num('R1'),
    R2: num('R2'),
    Rc: num('Rc'),
    Re: num('Re'),
    beta: num('beta'),
    VBE: num('VBE'),
    VCEsat: num('VCEsat'),
  };
  for (const key of ['Vcc', 'R1', 'R2', 'Rc', 'Re', 'beta'] as const) {
    if (params[key] <= 0) throw new Error(`A2 参数 ${key} 必须为正`);
  }
  return params;
}

/** 回路方程（路径 B）/ 工作区独立重判（路径 C）共用的标量解。 */
export function solveZoneScalar(params: A2Params, zone: BjtZone): A2Point {
  const Vbb = (params.Vcc * params.R2) / (params.R1 + params.R2);
  const Rb = (params.R1 * params.R2) / (params.R1 + params.R2);
  if (zone === 'cutoff') {
    return { zone, ib: 0, ic: 0, ie: 0, vbe: Vbb, vce: params.Vcc };
  }
  if (zone === 'active') {
    const ib = (Vbb - params.VBE) / (Rb + (1 + params.beta) * params.Re);
    const ic = params.beta * ib;
    const ie = (1 + params.beta) * ib;
    return { zone, ib, ic, ie, vbe: params.VBE, vce: params.Vcc - ic * params.Rc - ie * params.Re };
  }
  // 饱和：VBE、VCEsat 同时固定。
  const A = [
    [Rb + params.Re, params.Re],
    [params.Re, params.Rc + params.Re],
  ];
  const b = [Vbb - params.VBE, params.Vcc - params.VCEsat];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const ib = (b[0] * A[1][1] - A[0][1] * b[1]) / det;
  const ic = (A[0][0] * b[1] - b[0] * A[1][0]) / det;
  return {
    zone,
    ib,
    ic,
    ie: ib + ic,
    vbe: params.VBE,
    vce: params.VCEsat,
  };
}

export function zoneHolds(params: A2Params, point: A2Point): boolean {
  const eps = 1e-9;
  if (point.zone === 'cutoff') {
    return point.vbe <= params.VBE + eps && Math.abs(point.ic) <= eps;
  }
  if (point.zone === 'active') {
    return point.ib > eps && point.ic > 0 && point.vce > params.VCEsat + eps && point.ic <= params.beta * point.ib + eps;
  }
  return point.ib > eps && point.ic > 0 && point.ic <= params.beta * point.ib + eps;
}

export function commitZone(params: A2Params): A2Point {
  for (const zone of ['cutoff', 'active', 'saturation'] as const) {
    const point = solveZoneScalar(params, zone);
    if (zoneHolds(params, point)) return point;
  }
  throw new Error('A2 工作区无解：三组不等式均不成立');
}

function circuitFor(params: A2Params, zone: BjtZone): AnalogCircuit {
  const elements: AnalogCircuit['elements'] = [
    { id: 'VCC', kind: 'V', a: 'vcc', b: 'gnd', value: params.Vcc },
    { id: 'R1', kind: 'R', a: 'vcc', b: 'b', value: params.R1 },
    { id: 'R2', kind: 'R', a: 'b', b: 'gnd', value: params.R2 },
    { id: 'RC', kind: 'R', a: 'vcc', b: 'c', value: params.Rc },
    { id: 'RE', kind: 'R', a: 'e', b: 'gnd', value: params.Re },
  ];
  if (zone === 'active') {
    elements.push({ id: 'VBE', kind: 'V', a: 'b', b: 'e', value: params.VBE });
    elements.push({
      id: 'ICC',
      kind: 'CCCS',
      a: 'c',
      b: 'e',
      value: params.beta,
      controlBranch: 'VBE',
    });
  } else if (zone === 'saturation') {
    elements.push({ id: 'VBE', kind: 'V', a: 'b', b: 'e', value: params.VBE });
    elements.push({ id: 'VCE', kind: 'V', a: 'c', b: 'e', value: params.VCEsat });
  }
  return { nodes: ['vcc', 'b', 'c', 'e', 'gnd'], ground: 'gnd', elements };
}

export function solveZoneMNA(params: A2Params, zone: BjtZone): A2Point {
  const circuit = circuitFor(params, zone);
  const result = solveMNA(circuit);
  const vb = result.voltage.b;
  const vc = result.voltage.c;
  const ve = result.voltage.e;
  let ib = 0;
  let ic = 0;
  if (zone === 'active') {
    ib = result.branchCurrent.VBE;
    ic = params.beta * ib;
  } else if (zone === 'saturation') {
    ib = result.branchCurrent.VBE;
    ic = result.branchCurrent.VCE;
  }
  return {
    zone,
    ib,
    ic,
    ie: ib + ic,
    vbe: vb - ve,
    vce: vc - ve,
  };
}

function schematicSpec(point: A2Point, params: A2Params, steps: number): RenderSpec {
  const b = board();
  b.text('n-vcc', [522, 84], `VCC ${params.Vcc}V`);
  const r1 = b.part('n-r1', 'res', [476, 160], {
    rot: 90,
    label: `R1 ${(params.R1 / 1000).toFixed(1)}k`,
    labelSide: 'left',
  });
  const r2 = b.part('n-r2', 'res', [476, 330], {
    rot: 90,
    label: `R2 ${(params.R2 / 1000).toFixed(1)}k`,
    labelSide: 'left',
  });
  const q = b.part('n-q', 'npn', [560, 270], { label: 'Q', labelSide: 'right' });
  const rc = b.part('n-rc', 'res', [568.8, 160], {
    rot: 90,
    label: `Rc ${(params.Rc / 1000).toFixed(1)}k`,
    labelSide: 'right',
  });
  const re = b.part('n-re', 'res', [568.8, 370], {
    rot: 90,
    label: `Re ${(params.Re / 1000).toFixed(1)}k`,
    labelSide: 'right',
  });
  b.part('n-gnd', 'gnd', [520, 440], { label: 'GND', labelSide: 'down' });
  b.dot('n-b', [476, 270]);
  // VCC 轨 → R1 / Rc
  b.wire('e-vcc-rail', [[476, 100], [568.8, 100]], { weight: 2 });
  b.wire('e-vcc-r1', [[476, 100], r1.pin('a')]);
  b.wire('e-vcc-rc', [[568.8, 100], rc.pin('a')]);
  // 偏置分压：R1 → B → R2，B 抽头接基极
  b.wire('e-r1-b', [r1.pin('b'), [476, 270]]);
  b.wire('e-r2-b', [[476, 270], r2.pin('a')]);
  b.wire('e-b-q', [[476, 270], q.pin('b')]);
  // 集电极 / 发射极
  b.wire('e-rc-c', [rc.pin('b'), q.pin('c')]);
  b.wire('e-q-re', [q.pin('e'), re.pin('a')]);
  // 地轨
  b.wire('e-gnd-rail', [[476, 440], [568.8, 440]], { weight: 2 });
  b.wire('e-r2-gnd', [r2.pin('b'), [476, 440]]);
  b.wire('e-re-gnd', [re.pin('b'), [568.8, 440]]);
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
      activeEdges: stepIndex >= 2 ? edges.map((edge) => edge.id) : [],
      activeNodes: stepIndex >= 2 ? nodes.map((node) => node.id) : [],
      labels:
        stepIndex >= 2
          ? [
              { id: 'n-q', text: `Ib=${(point.ib * 1e6).toFixed(2)}μA Ic=${(point.ic * 1e3).toFixed(2)}mA` },
              { id: 'n-rc', text: `VCE=${point.vce.toFixed(3)}V` },
            ]
          : [],
    })),
  };
}

export function solveA2(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A2 只接受结构化参数');
  const params = a2Params(input as Record<string, number | string>);
  const point = commitZone(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '求基极戴维南等效',
      formula_tex: `V_{BB}=\\frac{R_2}{R_1+R_2}V_{CC},\\quad R_B=R_1\\parallel R_2`,
      substitution: `VBB=${(params.Vcc * params.R2 / (params.R1 + params.R2)).toFixed(3)}V，RB=${((params.R1 * params.R2) / (params.R1 + params.R2)).toFixed(0)}Ω`,
      value: '把分压偏置化成 VBB 串联 RB',
      basis: '戴维南等效（直流）',
      highlight: ['n-r1', 'n-r2'],
    },
    {
      i: 1,
      title: '假设工作区并解直流',
      formula_tex: `I_B=\\frac{V_{BB}-V_{BE}}{R_B+(1+\\beta)R_E}`,
      substitution: `β=${params.beta}，VBE=${params.VBE}V，Re=${params.Re}Ω`,
      value: `判定工作区：${point.zone}`,
      basis: '工作区假设 → 线性化模型 → 不等式回代',
      highlight: ['n-q'],
    },
    {
      i: 2,
      title: '读出工作点',
      formula_tex: `I_C=\\beta I_B,\\quad I_E=(\\beta+1)I_B`,
      substitution: `IB=${(point.ib * 1e6).toFixed(3)}μA，IC=${(point.ic * 1e3).toFixed(3)}mA`,
      value: `IC=${point.ic.toFixed(6)}A，IE=${point.ie.toFixed(6)}A`,
      basis: 'BJT 放大区电流关系',
      highlight: ['n-q', 'n-rc'],
    },
    {
      i: 3,
      title: '回代 VCE 与工作区判据',
      formula_tex: `V_{CE}=V_{CC}-I_CR_C-I_ER_E`,
      substitution: `VCE=${point.vce.toFixed(4)}V，VCEsat=${params.VCEsat}V`,
      value: `${point.zone === 'active' ? 'VCE>VCEsat，放大区成立' : point.zone === 'cutoff' ? 'IB=0，截止区成立' : 'VCE≈VCEsat，饱和区成立'}`,
      basis: '工作区不等式回代',
      highlight: ['n-rc'],
    },
    {
      i: 4,
      title: '确认工作点',
      formula_tex: `Q=(I_B,\\;I_C,\\;V_{CE})`,
      substitution: `${(point.ib * 1e6).toFixed(2)}μA / ${(point.ic * 1e3).toFixed(2)}mA / ${point.vce.toFixed(3)}V`,
      value: point.zone,
      basis: '三组不等式恰好一组成立',
      highlight: ['n-q'],
    },
  ];

  return {
    templateId: 'A2',
    subject: 'analog',
    parsed_given: {
      Vcc: params.Vcc,
      R1: params.R1,
      R2: params.R2,
      Rc: params.Rc,
      Re: params.Re,
      beta: params.beta,
      VBE: params.VBE,
      VCEsat: params.VCEsat,
    },
    steps,
    result: {
      zone: point.zone,
      IB: point.ib,
      IC: point.ic,
      IE: point.ie,
      VBE: point.vbe,
      VCE: point.vce,
    },
    render_specs: [schematicSpec(point, params, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}