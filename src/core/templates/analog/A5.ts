/**
 * A5 MOS 小信号：CS/CG/CD 三种组态。
 * A MNA；B 端口测试；C 手推解析式（忽略 gds）。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { mosLayout } from '../../../render/templates/analogLayouts.ts';
import { mosAmpLayout } from '../../../render/templates/mosAmp.ts';

export type MosConfig = 'CS' | 'CG' | 'CD';

export interface A5Params {
  config: MosConfig;
  gm: number;
  ro: number;
  Rd: number;
  Rl: number;
  Rs: number;
  Rss: number;
}

export interface A5Point {
  Av: number;
  Ri: number;
  Ro: number;
}

export const A5_DEFAULT: A5Params = {
  config: 'CS',
  gm: 1e-3,
  ro: 5_000_000,
  Rd: 2_000,
  Rl: 10_000,
  Rs: 1_000,
  Rss: 1_000,
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

export function a5Params(input: Record<string, number | string>): A5Params {
  const config = String(input.config ?? A5_DEFAULT.config) as MosConfig;
  if (!['CS', 'CG', 'CD'].includes(config)) throw new Error(`A5 不支持 config=${config}`);
  const num = (key: string): number => {
    const raw = input[key];
    const value = raw === undefined ? (A5_DEFAULT as unknown as Record<string, number>)[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A5 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A5Params = {
    config,
    gm: num('gm'),
    ro: num('ro'),
    Rd: num('Rd'),
    Rl: num('Rl'),
    Rs: num('Rs'),
    Rss: num('Rss'),
  };
  for (const key of ['gm', 'ro', 'Rd', 'Rl', 'Rs', 'Rss'] as const) {
    if (params[key] <= 0) throw new Error(`A5 参数 ${key} 必须为正`);
  }
  return params;
}

function groundOf(params: A5Params): string {
  return params.config === 'CG' ? 'g' : params.config === 'CD' ? 'd' : 's';
}
function inputNode(params: A5Params): string {
  return params.config === 'CG' ? 's' : 'g';
}
function outputNode(params: A5Params): string {
  return params.config === 'CD' ? 's' : 'd';
}

interface BuildOptions {
  vsValue?: number;
  includeRs?: boolean;
  includeLoad?: boolean;
  test?: 'ri' | 'ro';
}

function buildCircuit(params: A5Params, options: BuildOptions = {}): AnalogCircuit {
  const gnd = groundOf(params);
  const input = inputNode(params);
  const output = outputNode(params);
  const src = 'src';
  const elements: AnalogCircuit['elements'] = [];
  if (options.test === 'ri') {
    elements.push({ id: 'VTEST_I', kind: 'V', a: input, b: gnd, value: 1 });
  } else if (options.test === 'ro') {
    elements.push({ id: 'VSRC', kind: 'V', a: src, b: gnd, value: 0 });
    if (options.includeRs !== false) elements.push({ id: 'RS', kind: 'R', a: src, b: input, value: params.Rs });
    elements.push({ id: 'VTEST_O', kind: 'V', a: output, b: gnd, value: 1 });
  } else {
    elements.push({ id: 'VSRC', kind: 'V', a: src, b: gnd, value: options.vsValue ?? 1 });
    if (options.includeRs !== false) elements.push({ id: 'RS', kind: 'R', a: src, b: input, value: params.Rs });
  }
  elements.push({ id: 'GM', kind: 'VCCS', a: 'd', b: 's', value: params.gm, control: { a: 'g', b: 's' } });
  elements.push({ id: 'RO', kind: 'R', a: 'd', b: 's', value: params.ro });
  elements.push({ id: 'RD', kind: 'R', a: 'd', b: gnd, value: params.Rd });
  if (params.config === 'CD') {
    elements.push({ id: 'RSS', kind: 'R', a: 's', b: gnd, value: params.Rss });
  }
  if (options.includeLoad !== false) {
    elements.push({ id: 'RL', kind: 'R', a: output, b: gnd, value: params.Rl });
  }
  return { nodes: ['src', 'g', 'd', 's'], ground: gnd, elements };
}

/** A：直接由节点电压/两次负载解求 Av/Ri/Ro（不用测试源）。 */
export function solveA5MNA(params: A5Params): A5Point {
  const loaded = solveMNA(buildCircuit(params));
  const Av = loaded.voltage[outputNode(params)] / loaded.voltage.src;
  let Ri = Number.POSITIVE_INFINITY;
  if (params.config === 'CG') {
    const iIn = (loaded.voltage.src - loaded.voltage[inputNode(params)]) / params.Rs;
    Ri = loaded.voltage[inputNode(params)] / iIn;
  }
  const open = solveMNA(buildCircuit(params, { includeLoad: false }));
  const Ro = params.Rl * (open.voltage[outputNode(params)] / loaded.voltage[outputNode(params)] - 1);
  return { Av, Ri, Ro };
}

/** B：端口测试法，输入/输出各加 1V 测试源测 Ri/Ro。 */
export function solveA5PortTest(params: A5Params): A5Point {
  const av = solveMNA(buildCircuit(params));
  const Av = av.voltage[outputNode(params)] / av.voltage.src;
  const Ri =
    params.config === 'CG'
      ? 1 / Math.abs(solveMNA(buildCircuit(params, { test: 'ri' })).branchCurrent.VTEST_I)
      : Number.POSITIVE_INFINITY;
  const Ro = 1 / Math.abs(solveMNA(buildCircuit(params, { test: 'ro', includeLoad: false })).branchCurrent.VTEST_O);
  return { Av, Ri, Ro };
}

function parallel(a: number, b: number): number {
  return (a * b) / (a + b);
}

/**
 * C 路径：含 ro 的手推闭式（不再是近似）。
 *
 * CS  Av = -gm·(Rd∥Rl∥ro)，Ri = ∞，Ro = Rd∥ro
 * CG  Av = k·Ri/(Rs+Ri)，k = (1+gm·ro)·RdL/(RdL+ro)，Ri = (RdL+ro)/(1+gm·ro)
 *     Ro = Rd ∥ [ro + Rs(1+gm·ro)]
 * CD  Reff = Rss∥Rl∥ro，Av = gm·Reff/(1+gm·Reff)，Ri = ∞，Ro = (1/gm)∥Rss∥ro
 */
export function solveA5Analytic(params: A5Params): A5Point {
  const gm = params.gm;
  const ro = params.ro;
  const RdL = parallel(params.Rd, params.Rl);

  if (params.config === 'CS') {
    return {
      Av: -gm * parallel(RdL, ro),
      Ri: Number.POSITIVE_INFINITY,
      Ro: parallel(params.Rd, ro),
    };
  }

  if (params.config === 'CG') {
    const k = ((1 + gm * ro) * RdL) / (RdL + ro);
    const Ri = (RdL + ro) / (1 + gm * ro);
    return {
      Av: k * (Ri / (params.Rs + Ri)),
      Ri,
      Ro: parallel(params.Rd, ro + params.Rs * (1 + gm * ro)),
    };
  }

  const Reff = parallel(parallel(params.Rss, params.Rl), ro);
  return {
    Av: (gm * Reff) / (1 + gm * Reff),
    Ri: Number.POSITIVE_INFINITY,
    Ro: parallel(parallel(1 / gm, params.Rss), ro),
  };
}

/** 只用来讲课的「忽略 ro」版本，不作为答案。 */
export function solveA5NoRo(params: A5Params): A5Point {
  const gm = params.gm;
  const RdL = parallel(params.Rd, params.Rl);
  if (params.config === 'CS') {
    return { Av: -gm * RdL, Ri: Number.POSITIVE_INFINITY, Ro: params.Rd };
  }
  if (params.config === 'CG') {
    const Ri = 1 / gm;
    return { Av: gm * RdL * (Ri / (params.Rs + Ri)), Ri, Ro: params.Rd };
  }
  const ReL = parallel(params.Rss, params.Rl);
  return {
    Av: (gm * ReL) / (1 + gm * ReL),
    Ri: Number.POSITIVE_INFINITY,
    Ro: parallel(1 / gm, params.Rss),
  };
}

function specFrames(
  nodes: { id: string }[],
  edges: { id: string }[],
  steps: number,
  plan: { nodes: string[] | 'all'; edges: string[] | 'all' }[],
  extraLabels: (stepIndex: number) => { id: string; text: string }[] = () => [],
) {
  return Array.from({ length: steps }, (_, stepIndex) => {
    const p = plan[Math.min(stepIndex, plan.length - 1)];
    return {
      stepIndex,
      activeNodes: p.nodes === 'all' ? nodes.map((node) => node.id) : p.nodes,
      activeEdges: p.edges === 'all' ? edges.map((edge) => edge.id) : p.edges,
      labels: extraLabels(stepIndex),
    };
  });
}

function schematicSpecs(params: A5Params, point: A5Point, steps: number): RenderSpec[] {
  const isCD = params.config === 'CD';
  const passives = {
    'n-rd': `Rd ${(params.Rd / 1000).toFixed(1)}k`,
    'n-rl': isCD ? `Rss ${(params.Rss / 1000).toFixed(1)}k` : `Rl ${(params.Rl / 1000).toFixed(1)}k`,
  };
  const amp = mosAmpLayout(params.config, passives);
  const pi = mosLayout(params.config, {
    ...passives,
    'n-gm': `gm·vgs (${(params.gm * 1e3).toFixed(2)}mS)`,
    'n-ro': `ro ${(params.ro / 1e6).toFixed(1)}M`,
  });

  const ampPlan = [
    { nodes: ['n-vs', 'n-rs'], edges: ['e-in', 'e-vs-gnd', params.config === 'CG' ? 'e-rs-s' : 'e-rs-g'] },
    { nodes: ['n-q'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
    { nodes: ['n-rd', 'n-rl', 'n-gnd'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
  ];
  const piPlan = [
    { nodes: [] as string[], edges: [] as string[] },
    { nodes: ['pi-n-gm'], edges: 'all' as const },
    { nodes: ['pi-n-gm', 'pi-n-ro'], edges: 'all' as const },
    { nodes: ['pi-n-ro', 'pi-n-rd', 'pi-n-rl', 'pi-n-gnd'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
  ];
  const resultLabel = (stepIndex: number) =>
    stepIndex >= 3
      ? [
          {
            id: 'pi-n-gnd',
            text: `Av=${point.Av.toFixed(3)} Ri=${Number.isFinite(point.Ri) ? `${(point.Ri / 1000).toFixed(2)}k` : '∞'} Ro=${(point.Ro / 1000).toFixed(2)}k`,
          },
        ]
      : [];

  return [
    {
      id: 'main',
      role: 'primary',
      type: 'schematic',
      nodes: amp.nodes,
      edges: amp.edges,
      frames: specFrames(amp.nodes, amp.edges, steps, ampPlan),
    },
    {
      id: 'pi',
      role: 'secondary',
      derivedFrom: 'main',
      type: 'schematic',
      nodes: pi.nodes,
      edges: pi.edges,
      frames: specFrames(pi.nodes, pi.edges, steps, piPlan, resultLabel),
    },
  ];
}

export function solveA5(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A5 只接受结构化参数');
  const params = a5Params(input as Record<string, number | string>);
  const point = solveA5MNA(params);
  const analytic = solveA5Analytic(params);
  const noRo = solveA5NoRo(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '识别原电路与交流通路',
      formula_tex: `V_{DD}\\Rightarrow\\text{交流地},\\quad C_b\\Rightarrow\\text{短路}`,
      substitution: `组态 ${params.config}：输入 ${inputNode(params)}，输出 ${outputNode(params)}`,
      value: '晶体管仍是器件符号，其余元件按交流通路重画（主图）',
      basis: '直流通路 → 交流通路',
      highlight: ['n-vs', 'n-rs'],
    },
    {
      i: 1,
      title: '晶体管换成小信号模型',
      formula_tex: `i_d=g_m v_{gs},\\quad v_{gs}=v_g-v_s`,
      substitution: 'VCCS 接在 d-s 之间，ro 并接在 d-s 之间',
      value: '受控源 gm·vgs 与 ro 并接（辅图）',
      basis: 'MOS 混合 π 模型',
      highlight: ['n-q', 'pi-n-gm'],
    },
    {
      i: 2,
      title: '确定 gm 与 ro',
      formula_tex: `g_m=\\frac{2I_D}{V_{OV}},\\quad r_o=\\frac{1}{\\lambda I_D}`,
      substitution: `gm=${(params.gm * 1e3).toFixed(3)}mS，ro=${(params.ro / 1e6).toFixed(2)}MΩ`,
      value: '小信号参数由直流工作点决定',
      basis: 'MOS 小信号参数定义',
      highlight: ['pi-n-gm', 'pi-n-ro'],
    },
    {
      i: 3,
      title: 'MNA 求 Av / Ri / Ro',
      formula_tex: `A_v=\\frac{v_o}{v_s}`,
      substitution: `Av=${point.Av.toFixed(5)}，Ro=${(point.Ro / 1000).toFixed(3)}kΩ`,
      value: `Av=${point.Av.toFixed(4)}`,
      basis: '节点电压法（含 gds/ro）',
      highlight: ['pi-n-ro', 'n-rd', 'n-rl'],
    },
    {
      i: 4,
      title: '手推闭式（含 ro）与教学近似',
      formula_tex: `A_v=${params.config === 'CS' ? '-g_m(R_D\\parallel R_L\\parallel r_o)' : params.config === 'CG' ? 'k\\frac{R_i}{R_s+R_i},\\ k=\\frac{(1+g_m r_o)R_{DL}}{R_{DL}+r_o}' : '\\frac{g_m R_{eff}}{1+g_m R_{eff}}'}`,
      substitution: `闭式 Av=${analytic.Av.toFixed(5)}；忽略 ro 教学近似 Av=${noRo.Av.toFixed(5)}；${
        params.config === 'CS' ? '反相电压放大' : params.config === 'CG' ? '同相、低输入阻抗' : '电压跟随'
      }`,
      value: `闭式 vs MNA 偏差 ${(Math.abs((analytic.Av - point.Av) / point.Av) * 100).toExponential(2)}%；忽略 ro 误差 ${(Math.abs((noRo.Av - point.Av) / point.Av) * 100).toFixed(2)}%`,
      basis: '含 ro 闭式；忽略 ro 仅作教学对照',
      highlight: [],
    },
  ];

  return {
    templateId: 'A5',
    subject: 'analog',
    parsed_given: {
      config: params.config,
      gm: params.gm,
      ro: params.ro,
      Rd: params.Rd,
      Rl: params.Rl,
      Rs: params.Rs,
      Rss: params.Rss,
    },
    steps,
    result: {
      config: params.config,
      Av: point.Av,
      Ri: Number.isFinite(point.Ri) ? point.Ri : '∞',
      Ro: point.Ro,
      AvApprox: analytic.Av,
      AvNoRo: noRo.Av,
    },
    render_specs: schematicSpecs(params, point, steps.length),
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}