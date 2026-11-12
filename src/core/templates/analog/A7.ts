/**
 * A7 负反馈：环路增益法 / 闭环 MNA / 深度负反馈渐近判据。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { feedbackLayout } from '../../../render/templates/analogLayouts.ts';

export interface A7Params {
  A: number;
  beta: number;
  Rin: number;
  Rout: number;
  Rl: number;
}

export const A7_DEFAULT: A7Params = {
  A: 1e5,
  beta: 0.01,
  Rin: 10_000,
  Rout: 100,
  Rl: 10_000,
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

export function a7Params(input: Record<string, number | string>): A7Params {
  const num = (key: keyof A7Params): number => {
    const raw = input[key];
    const value = raw === undefined ? (A7_DEFAULT as unknown as Record<string, number>)[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A7 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A7Params = {
    A: num('A'),
    beta: num('beta'),
    Rin: num('Rin'),
    Rout: num('Rout'),
    Rl: num('Rl'),
  };
  if (params.A <= 0 || params.Rin <= 0 || params.Rl <= 0) throw new Error('A7 A/Rin/Rl 必须为正');
  if (params.beta <= 0 || params.beta >= 1) throw new Error('A7 beta 必须在 (0,1)');
  if (params.Rout < 0) throw new Error('A7 Rout 不得为负');
  return params;
}

function forwardGain(params: A7Params): number {
  return (params.A * params.Rl) / (params.Rout + params.Rl);
}

export function closedLoopMNA(params: A7Params): number {
  const elements: AnalogCircuit['elements'] = [
    { id: 'VIN', kind: 'V', a: 'in', b: 'gnd', value: 1 },
    { id: 'RIN', kind: 'R', a: 'in', b: 'a', value: params.Rin },
    {
      id: 'VF',
      kind: 'VCVS',
      a: 'a',
      b: 'e',
      value: params.beta,
      control: { a: 'out', b: 'gnd' },
    },
    {
      id: 'E1',
      kind: 'VCVS',
      a: 'o',
      b: 'gnd',
      value: params.A,
      control: { a: 'e', b: 'gnd' },
    },
    { id: 'ROUT', kind: 'R', a: 'o', b: 'out', value: Math.max(params.Rout, 1e-6) },
    { id: 'RL', kind: 'R', a: 'out', b: 'gnd', value: params.Rl },
  ];
  const result = solveMNA({ nodes: ['in', 'a', 'e', 'o', 'out', 'gnd'], ground: 'gnd', elements });
  return result.voltage.out;
}

export function loopGain(params: A7Params): number {
  return forwardGain(params) * params.beta;
}

export function loopGainGain(params: A7Params): number {
  const T = loopGain(params);
  return forwardGain(params) / (1 + T);
}

export function deepFeedbackGain(params: A7Params): number {
  return 1 / params.beta;
}

export interface A7SweepPoint {
  T: number;
  beta: number;
  loop: number;
  mna: number;
  deep: number;
  /** T < 100 时超出深度负反馈近似域，error 为 NaN。 */
  inDomain: boolean;
  error: number;
}

export function sweepFeedback(params: A7Params): A7SweepPoint[] {
  const Aforward = forwardGain(params);
  return [10, 30, 100, 300, 1000].map((T) => {
    const beta = T / Aforward;
    const local = { ...params, beta };
    const loop = (Aforward * beta) / (1 + Aforward * beta);
    const mna = closedLoopMNA(local);
    const deep = 1 / beta;
    const inDomain = T >= 100;
    return {
      T,
      beta,
      loop,
      mna,
      deep,
      inDomain,
      error: inDomain ? Math.abs((deep - mna) / mna) : Number.NaN,
    };
  });
}

function schematicSpec(params: A7Params, gain: number, steps: number): RenderSpec {
  const layout = feedbackLayout({
    'n-rin': `Rin ${(params.Rin / 1000).toFixed(1)}k`,
    'n-amp': `A ${params.A.toExponential(0)}`,
    'n-rout': `Rout ${params.Rout}Ω`,
    'n-fb': `β ${params.beta}`,
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
      labels: stepIndex >= 2 ? [{ id: 'n-out', text: `Af=${gain.toFixed(3)}` }] : [],
    })),
  };
}

export function solveA7(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A7 只接受结构化参数');
  const params = a7Params(input as Record<string, number | string>);
  const forward = forwardGain(params);
  const T = loopGain(params);
  const loopClosed = loopGainGain(params);
  const mnaClosed = closedLoopMNA(params);
  const deep = deepFeedbackGain(params);
  const sweep = sweepFeedback(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '判断反馈组态',
      formula_tex: `\\text{series-shunt}`,
      substitution: `A=${params.A.toExponential(2)}，β=${params.beta}，Rout=${params.Rout}Ω，Rl=${params.Rl}Ω`,
      value: '电压串联负反馈',
      basis: '输入串联求和、输出取电压',
      highlight: ['n-fb'],
    },
    {
      i: 1,
      title: '断开环路求环路增益 T',
      formula_tex: `T=A'\\beta,\\quad A'=A\\frac{R_L}{R_{out}+R_L}`,
      substitution: `A'=${forward.toFixed(3)}，T=${T.toFixed(2)}`,
      value: `T=${T.toFixed(3)}`,
      basis: '环路增益法',
      highlight: ['n-amp'],
    },
    {
      i: 2,
      title: '闭环增益',
      formula_tex: `A_f=\\frac{A'}{1+T}`,
      substitution: `A'=${forward.toFixed(3)}，T=${T.toFixed(2)}`,
      value: `Af=${loopClosed.toFixed(5)}`,
      basis: '负反馈基本关系',
      highlight: ['n-out'],
    },
    {
      i: 3,
      title: '闭环 MNA 直接求解',
      formula_tex: `V_e=V_s-\\beta V_o`,
      substitution: `不拆环路，直接解 MNA：Af=${mnaClosed.toFixed(5)}`,
      value: `闭环 MNA A_f=${mnaClosed.toFixed(5)}（答案位；1/β=${deep.toFixed(3)} 仅作参照）`,
      basis: '闭环节点方程',
      highlight: ['n-sum', 'n-out'],
    },
    {
      i: 4,
      title: '深度负反馈渐近判据',
      formula_tex: `\\left|1/\\beta-A_f\\right|/|A_f|\\downarrow\\ (T\\uparrow)`,
      substitution: sweep
        .map((point) => (point.inDomain ? `T=${point.T}:${(point.error * 100).toFixed(2)}%` : `T=${point.T}:超域`))
        .join('，'),
      value: `T<100 超出深度负反馈近似域；T≥100 时误差 <5%：${sweep.filter((point) => point.inDomain).every((point) => point.error < 0.05)}`,
      basis: '渐近一致性（不是等式判据）',
      highlight: [],
    },
  ];

  return {
    templateId: 'A7',
    subject: 'analog',
    parsed_given: {
      A: params.A,
      beta: params.beta,
      Rin: params.Rin,
      Rout: params.Rout,
      Rl: params.Rl,
    },
    steps,
    result: {
      T,
      AfAnswer: loopClosed,
      AfLoop: loopClosed,
      AfMNA: mnaClosed,
      AfDeep: deep,
      errorAtT1000: sweep[sweep.length - 1].error,
    },
    render_specs: [schematicSpec(params, mnaClosed, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}