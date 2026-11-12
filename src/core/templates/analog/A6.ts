/**
 * A6 理想运放：虚短虚断 / 有限开环增益 MNA / Aol 极限扫描。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { opampLayout } from '../../../render/templates/analogLayouts.ts';

export type OpampTopology = 'inverting' | 'noninverting';

export interface A6Params {
  topology: OpampTopology;
  Aol: number;
  R1: number;
  R2: number;
  Rin: number;
  Rout: number;
  Vin: number;
}

export const A6_DEFAULT: A6Params = {
  topology: 'inverting',
  Aol: 1e6,
  R1: 10_000,
  R2: 100_000,
  Rin: 1e7,
  Rout: 50,
  Vin: 0.1,
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

export function a6Params(input: Record<string, number | string>): A6Params {
  const topology = String(input.topology ?? A6_DEFAULT.topology) as OpampTopology;
  if (topology !== 'inverting' && topology !== 'noninverting') {
    throw new Error(`A6 不支持 topology=${topology}`);
  }
  const num = (key: string): number => {
    const raw = input[key];
    const value = raw === undefined ? (A6_DEFAULT as unknown as Record<string, number>)[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A6 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A6Params = {
    topology,
    Aol: num('Aol'),
    R1: num('R1'),
    R2: num('R2'),
    Rin: num('Rin'),
    Rout: num('Rout'),
    Vin: num('Vin'),
  };
  for (const key of ['Aol', 'R1', 'R2', 'Rin'] as const) {
    if (params[key] <= 0) throw new Error(`A6 参数 ${key} 必须为正`);
  }
  if (params.Rout < 0) throw new Error('A6 Rout 不得为负');
  return params;
}

export function idealGain(params: A6Params): number {
  return params.topology === 'inverting' ? -params.R2 / params.R1 : 1 + params.R2 / params.R1;
}

export function finiteGain(params: A6Params, Aol = params.Aol): number {
  const inverting = params.topology === 'inverting';
  const elements: AnalogCircuit['elements'] = [
    { id: 'VIN', kind: 'V', a: 'in', b: 'gnd', value: params.Vin },
    { id: 'R1', kind: 'R', a: 'in', b: 'n', value: params.R1 },
    { id: 'R2', kind: 'R', a: 'n', b: 'out', value: params.R2 },
    { id: 'RIN', kind: 'R', a: inverting ? 'n' : 'in', b: 'gnd', value: params.Rin },
    { id: 'ROUT', kind: 'R', a: 'o', b: 'out', value: Math.max(params.Rout, 1e-6) },
    {
      id: 'E1',
      kind: 'VCVS',
      a: 'o',
      b: 'gnd',
      value: Aol,
      control: { a: inverting ? 'gnd' : 'in', b: 'n' },
    },
  ];
  if (params.topology === 'noninverting') {
    // 同相输入接 in；R1 从 n 到地（反馈分压）。
    elements[1] = { id: 'R1', kind: 'R', a: 'n', b: 'gnd', value: params.R1 };
    elements[2] = { id: 'R2', kind: 'R', a: 'n', b: 'out', value: params.R2 };
  }
  const circuit: AnalogCircuit = {
    nodes: ['in', 'n', 'o', 'out', 'gnd'],
    ground: 'gnd',
    elements,
  };
  const result = solveMNA(circuit);
  return result.voltage.out / params.Vin;
}

export interface SweepPoint {
  Aol: number;
  gain: number;
  error: number;
}

export function sweepOpenLoop(params: A6Params): SweepPoint[] {
  const ideal = idealGain(params);
  return [1e3, 1e4, 1e5, 1e6, 1e7].map((Aol) => {
    const gain = finiteGain(params, Aol);
    return { Aol, gain, error: Math.abs((gain - ideal) / ideal) };
  });
}

function schematicSpec(params: A6Params, gain: number, steps: number): RenderSpec {
  const layout = opampLayout(params.topology, {
    'n-vin': `Vin ${params.Vin}V`,
    'n-r1': `R1 ${(params.R1 / 1000).toFixed(1)}k`,
    'n-r2': `R2 ${(params.R2 / 1000).toFixed(0)}k`,
    'n-aol': `Aol ${params.Aol.toExponential(0)}`,
  });
  const { nodes, edges } = layout;
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
      labels: stepIndex >= 2 ? [{ id: 'n-out', text: `Av=${gain.toFixed(4)}` }] : [],
    })),
  };
}

export function solveA6(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A6 只接受结构化参数');
  const params = a6Params(input as Record<string, number | string>);
  const ideal = idealGain(params);
  const finite = finiteGain(params);
  const sweep = sweepOpenLoop(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '虚短虚断列节点方程',
      formula_tex: `V_p=V_n,\\quad I_p=I_n=0`,
      substitution: params.topology === 'inverting' ? '反相端为虚地 Vn≈0' : '同相端 Vp=Vin，Vn 跟随',
      value: `理想增益 ${ideal.toFixed(4)}`,
      basis: '理想运放约束',
      highlight: ['n-op'],
    },
    {
      i: 1,
      title: '闭环增益解析式',
      formula_tex: params.topology === 'inverting' ? `A_v=-\\frac{R_2}{R_1}` : `A_v=1+\\frac{R_2}{R_1}`,
      substitution: `R1=${params.R1}Ω，R2=${params.R2}Ω`,
      value: `Av=${ideal.toFixed(5)}`,
      basis: '虚短 + 分压',
      highlight: ['n-r1', 'n-r2'],
    },
    {
      i: 2,
      title: '有限开环增益 MNA',
      formula_tex: `V_o=A_{ol}(V_p-V_n)`,
      substitution: `Aol=${params.Aol.toExponential(2)}，Rout=${params.Rout}Ω`,
      value: `Av=${finite.toFixed(6)}`,
      basis: '不假设虚短，直接解有限增益模型',
      highlight: ['n-op'],
    },
    {
      i: 3,
      title: '扫描 Aol 验证极限',
      formula_tex: `A_{ol}\\to\\infty\\Rightarrow A_v\\to${ideal.toFixed(3)}`,
      substitution: sweep.map((point) => `${point.Aol.toExponential(0)}:${point.error.toExponential(1)}`).join('，'),
      value: `Aol=1e7 时误差 ${sweep[sweep.length - 1].error.toExponential(2)}`,
      basis: '极限验证：误差随 1/Aol 单调下降',
      highlight: [],
    },
    {
      i: 4,
      title: '确认结论',
      formula_tex: `A_v=${finite.toFixed(5)}`,
      substitution: `理想 ${ideal.toFixed(5)}，有限 ${finite.toFixed(5)}`,
      value: params.topology === 'inverting' ? '反相放大' : '同相放大',
      basis: '极限一致性',
      highlight: ['n-out'],
    },
  ];

  return {
    templateId: 'A6',
    subject: 'analog',
    parsed_given: {
      topology: params.topology,
      Aol: params.Aol,
      R1: params.R1,
      R2: params.R2,
      Rin: params.Rin,
      Rout: params.Rout,
      Vin: params.Vin,
    },
    steps,
    result: {
      topology: params.topology,
      AvIdeal: ideal,
      AvFinite: finite,
      lastSweepError: sweep[sweep.length - 1].error,
      Vout: finite * params.Vin,
    },
    render_specs: [schematicSpec(params, finite, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}
