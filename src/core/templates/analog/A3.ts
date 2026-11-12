/**
 * A3 BJT 小信号：π 模型、CE/CB/CC 三种组态、Av/Ri/Ro。
 *
 * A 路径：MNA 交流小信号数值解；
 * B 路径：端口测试（输入/输出各加测试源测 Ri/Ro）；
 * C 路径：含 ro 的手推闭式；忽略 ro 仅作教学对照。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { bjtPiLayout } from '../../../render/templates/analogLayouts.ts';
import { bjtAmpLayout } from '../../../render/templates/bjtAmp.ts';

export type BjtConfig = 'CE' | 'CB' | 'CC';

export interface A3Params {
  config: BjtConfig;
  beta: number;
  Ic: number;
  Rc: number;
  Rl: number;
  Rs: number;
  Re: number;
  Vt: number;
  VA: number;
}

export interface A3Point {
  Av: number;
  Ri: number;
  Ro: number;
}

export const A3_DEFAULT: A3Params = {
  config: 'CE',
  beta: 100,
  Ic: 1e-3,
  Rc: 2_000,
  Rl: 10_000,
  Rs: 1_000,
  Re: 1_000,
  Vt: 0.026,
  VA: 100,
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

export function a3Params(input: Record<string, number | string>): A3Params {
  const config = String(input.config ?? A3_DEFAULT.config) as BjtConfig;
  if (!['CE', 'CB', 'CC'].includes(config)) throw new Error(`A3 不支持 config=${config}`);
  const num = (key: string): number => {
    const raw = input[key];
    const value = raw === undefined ? (A3_DEFAULT as unknown as Record<string, number>)[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A3 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A3Params = {
    config,
    beta: num('beta'),
    Ic: num('Ic'),
    Rc: num('Rc'),
    Rl: num('Rl'),
    Rs: num('Rs'),
    Re: num('Re'),
    Vt: num('Vt'),
    VA: num('VA'),
  };
  for (const key of ['beta', 'Ic', 'Rc', 'Rl', 'Rs', 'Re', 'Vt', 'VA'] as const) {
    if (params[key] <= 0) throw new Error(`A3 参数 ${key} 必须为正`);
  }
  return params;
}

export function gmOf(params: A3Params): number {
  return params.Ic / params.Vt;
}
export function rpiOf(params: A3Params): number {
  return params.beta / gmOf(params);
}
export function roOf(params: A3Params): number {
  return params.VA / params.Ic;
}

function groundOf(params: A3Params): string {
  return params.config === 'CB' ? 'b' : params.config === 'CC' ? 'c' : 'e';
}

function inputNode(params: A3Params): string {
  return params.config === 'CB' ? 'e' : 'b';
}
function outputNode(params: A3Params): string {
  return params.config === 'CC' ? 'e' : 'c';
}
function sourceNode(): string {
  return 'src';
}

interface BuildOptions {
  vsValue?: number;
  includeRs?: boolean;
  includeLoad?: boolean;
  test?: 'ri' | 'ro';
}

function buildCircuit(params: A3Params, options: BuildOptions = {}): AnalogCircuit {
  const gm = gmOf(params);
  const rpi = rpiOf(params);
  const ro = roOf(params);
  const gnd = groundOf(params);
  const input = inputNode(params);
  const output = outputNode(params);
  const src = sourceNode();
  const uniqueNodes = ['src', 'b', 'c', 'e'];
  const elements: AnalogCircuit['elements'] = [];
  const vsValue = options.vsValue ?? 1;

  if (options.test === 'ri') {
    elements.push({ id: 'VTEST_I', kind: 'V', a: input, b: gnd, value: 1 });
  } else if (options.test === 'ro') {
    elements.push({ id: 'VSRC', kind: 'V', a: src, b: gnd, value: 0 });
    if (options.includeRs !== false) elements.push({ id: 'RS', kind: 'R', a: src, b: input, value: params.Rs });
    elements.push({ id: 'VTEST_O', kind: 'V', a: output, b: gnd, value: 1 });
  } else {
    elements.push({ id: 'VSRC', kind: 'V', a: src, b: gnd, value: vsValue });
    if (options.includeRs !== false) elements.push({ id: 'RS', kind: 'R', a: src, b: input, value: params.Rs });
  }

  // π 模型：B-E 之间 rπ，C-E 之间 VCCS gm·vbe 与 ro。
  const control = { a: 'b', b: 'e' };
  if (params.config === 'CB') {
    // 基极交流接地：rπ 从 e 到地。
    elements.push({ id: 'RPI', kind: 'R', a: 'e', b: 'b', value: rpi });
    elements.push({ id: 'GM', kind: 'VCCS', a: 'c', b: 'e', value: gm, control });
  } else if (params.config === 'CC') {
    // 集电极交流接地：VCCS 从地流入 e。
    elements.push({ id: 'RPI', kind: 'R', a: 'b', b: 'e', value: rpi });
    elements.push({ id: 'GM', kind: 'VCCS', a: 'c', b: 'e', value: gm, control });
  } else {
    elements.push({ id: 'RPI', kind: 'R', a: 'b', b: 'e', value: rpi });
    elements.push({ id: 'GM', kind: 'VCCS', a: 'c', b: 'e', value: gm, control });
  }
  elements.push({ id: 'RO', kind: 'R', a: 'c', b: 'e', value: ro });
  elements.push({ id: 'RC', kind: 'R', a: 'c', b: gnd, value: params.Rc });
  if (params.config === 'CC') {
    elements.push({ id: 'RE', kind: 'R', a: 'e', b: gnd, value: params.Re });
  }
  if (options.includeLoad !== false) {
    elements.push({ id: 'RL', kind: 'R', a: output, b: gnd, value: params.Rl });
  }
  return { nodes: uniqueNodes, ground: gnd, elements };
}

/** A：直接由节点电压 + 开路/负载两次解求 Av/Ri/Ro（不用测试源）。 */
export function solveA3MNA(params: A3Params): A3Point {
  const loaded = solveMNA(buildCircuit(params));
  const Av = loaded.voltage[outputNode(params)] / loaded.voltage[sourceNode()];
  const vin = loaded.voltage[inputNode(params)];
  const iIn = (loaded.voltage[sourceNode()] - vin) / params.Rs;
  const Ri = vin / iIn;
  const open = solveMNA(buildCircuit(params, { includeLoad: false }));
  const Ro = params.Rl * (open.voltage[outputNode(params)] / loaded.voltage[outputNode(params)] - 1);
  return { Av, Ri, Ro };
}

/** 端口测试法：Ri/Ro 由测试源直接测得，Av 用 Vs=1 的节点电压。 */
export function solveA3PortTest(params: A3Params): A3Point {
  const avResult = solveMNA(buildCircuit(params));
  const Av = avResult.voltage[outputNode(params)] / avResult.voltage[sourceNode()];
  const Ri = 1 / Math.abs(solveMNA(buildCircuit(params, { test: 'ri' })).branchCurrent.VTEST_I);
  const Ro = 1 / Math.abs(solveMNA(buildCircuit(params, { test: 'ro', includeLoad: false })).branchCurrent.VTEST_O);
  return { Av, Ri, Ro };
}

function parallel(a: number, b: number): number {
  return (a * b) / (a + b);
}

/**
 * C 路径：含 ro 的手推闭式（不再是近似）。
 *
 * CE  Av = -gm·(Rc∥Rl∥ro)·rπ/(Rs+rπ)，Ri = rπ，Ro = Rc∥ro
 * CB  Av = k·Ri/(Rs+Ri)，k = (1+gm·ro)·RcL/(RcL+ro)，Ri = 1/(1/rπ + gm + (1-gm·RcL)/(RcL+ro))
 *     Ro = Rc ∥ [ro + (rπ∥Rs)(1+gm·ro)]
 * CC  Reff = Re∥Rl∥ro，Av = (β+1)Reff/(Rs+rπ+(β+1)Reff)，Ri = rπ+(β+1)Reff，
 *     Ro = [(Rs+rπ)/(β+1)] ∥ Re ∥ ro
 *
 * 三个组态都与 MNA 数值解吻合到 1e-12 量级，所以这条路径的 tolerance 回到默认的
 * RESIDUAL_TOLERANCE（1e-6），不再需要 approximation 声明。
 */
export function solveA3Analytic(params: A3Params): A3Point {
  const gm = gmOf(params);
  const rpi = rpiOf(params);
  const ro = roOf(params);
  const RcL = parallel(params.Rc, params.Rl);

  if (params.config === 'CE') {
    return {
      Av: -gm * parallel(RcL, ro) * (rpi / (params.Rs + rpi)),
      Ri: rpi,
      Ro: parallel(params.Rc, ro),
    };
  }

  if (params.config === 'CB') {
    const k = ((1 + gm * ro) * RcL) / (RcL + ro);
    const Ri = 1 / (1 / rpi + gm + (1 - gm * RcL) / (RcL + ro));
    const Rp = parallel(rpi, params.Rs);
    return {
      Av: k * (Ri / (params.Rs + Ri)),
      Ri,
      Ro: parallel(params.Rc, ro + Rp * (1 + gm * ro)),
    };
  }

  const Reff = parallel(parallel(params.Re, params.Rl), ro);
  return {
    Av: ((params.beta + 1) * Reff) / (params.Rs + rpi + (params.beta + 1) * Reff),
    Ri: rpi + (params.beta + 1) * Reff,
    Ro: parallel(parallel((params.Rs + rpi) / (params.beta + 1), params.Re), ro),
  };
}

/**
 * 只用来讲课的「忽略 ro」版本：当题目要求「按理想受控源估算」时，
 * 用它算出百分比误差给学生看，**不作为任何一条路径的答案**。
 */
export function solveA3NoRo(params: A3Params): A3Point {
  const gm = gmOf(params);
  const rpi = rpiOf(params);
  const RcL = parallel(params.Rc, params.Rl);
  if (params.config === 'CE') {
    return { Av: -gm * RcL * (rpi / (params.Rs + rpi)), Ri: rpi, Ro: params.Rc };
  }
  if (params.config === 'CB') {
    const Ri = rpi / (params.beta + 1);
    return { Av: gm * RcL * (Ri / (params.Rs + Ri)), Ri, Ro: params.Rc };
  }
  const ReL = parallel(params.Re, params.Rl);
  return {
    Av: ((params.beta + 1) * ReL) / (params.Rs + rpi + (params.beta + 1) * ReL),
    Ri: rpi + (params.beta + 1) * ReL,
    Ro: parallel((params.Rs + rpi) / (params.beta + 1), params.Re),
  };
}

/**
 * 两张图：主图是「原电路」（晶体管仍是器件符号），辅图是它的等效电路。
 * 两图共用外部网络的坐标（母线 164 / 电源横杠 76 / 地 470 / 上器件 560 / 负载 700），
 * 所以上下摆在一起就是「中间那块晶体管被换成了等效三件套」。
 */
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

function schematicSpecs(params: A3Params, point: A3Point, steps: number): RenderSpec[] {
  const isCC = params.config === 'CC';
  const passives = {
    'n-rc': `Rc ${(params.Rc / 1000).toFixed(1)}k`,
    'n-rl': isCC ? `Re ${(params.Re / 1000).toFixed(1)}k` : `Rl ${(params.Rl / 1000).toFixed(1)}k`,
  };
  const amp = bjtAmpLayout(params.config, passives);
  const pi = bjtPiLayout(params.config, {
    ...passives,
    'n-gm': `gm·vbe (${(gmOf(params) * 1e3).toFixed(1)}mS)`,
    'n-ro': `ro ${
      roOf(params) >= 1e6 ? `${(roOf(params) / 1e6).toFixed(1)}M` : `${(roOf(params) / 1000).toFixed(0)}k`
    }`,
  });

  const ampPlan = [
    { nodes: ['n-vs', 'n-rs'], edges: ['e-in', 'e-vs-gnd', 'e-rs-q'] },
    { nodes: ['n-q'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
    { nodes: isCC ? ['n-rl', 'n-gnd'] : ['n-rc', 'n-rl', 'n-gnd'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
  ];
  const piPlan = [
    { nodes: [] as string[], edges: [] as string[] },
    { nodes: ['pi-n-rpi', 'pi-n-gm'], edges: 'all' as const },
    { nodes: ['pi-n-rpi', 'pi-n-gm', 'pi-n-ro'], edges: 'all' as const },
    { nodes: isCC ? ['pi-n-ro', 'pi-n-rl', 'pi-n-gnd'] : ['pi-n-ro', 'pi-n-rc', 'pi-n-rl', 'pi-n-gnd'], edges: 'all' as const },
    { nodes: 'all' as const, edges: 'all' as const },
  ];
  const resultLabel = (stepIndex: number) =>
    stepIndex >= 3
      ? [
          {
            id: 'pi-n-gnd',
            text: `Av=${point.Av.toFixed(3)} Ri=${(point.Ri / 1000).toFixed(2)}k Ro=${(point.Ro / 1000).toFixed(2)}k`,
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

export function solveA3(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A3 只接受结构化参数');
  const params = a3Params(input as Record<string, number | string>);
  const point = solveA3MNA(params);
  const analytic = solveA3Analytic(params);
  const noRo = solveA3NoRo(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '识别原电路与交流通路',
      formula_tex: 'V_{CC}\\Rightarrow\\text{交流地},\\quad C_b\\Rightarrow\\text{短路},\\quad R_e\\parallel C_e\\Rightarrow\\text{短路}',
      substitution: `组态 ${params.config}：输入 ${inputNode(params)}，输出 ${outputNode(params)}`,
      value: '晶体管仍是器件符号，其余元件按交流通路重画（主图）',
      basis: '直流通路 → 交流通路',
      highlight: ['n-vs', 'n-rs'],
    },
    {
      i: 1,
      title: '晶体管换成 π 模型',
      formula_tex: 'i_c=g_m v_{be},\\quad v_{be}=v_b-v_e',
      substitution: 'rπ 并在 b-e 之间，gm·vbe 从 c 流向 e，ro 并在 c-e 之间',
      value: '受控源 gm·vbe 与 ro 并接（辅图）',
      basis: '混合 π 模型',
      highlight: ['pi-n-rpi', 'pi-n-gm'],
    },
    {
      i: 2,
      title: '求 gm / rπ / ro',
      formula_tex: 'g_m=\\frac{I_C}{V_T},\\quad r_\\pi=\\frac{\\beta}{g_m},\\quad r_o=\\frac{V_A}{I_C}',
      substitution: `IC=${(params.Ic * 1e3).toFixed(3)}mA，β=${params.beta}，VA=${params.VA}V`,
      value: `gm=${(gmOf(params) * 1e3).toFixed(3)}mS，rπ=${(rpiOf(params) / 1000).toFixed(2)}kΩ，ro=${(roOf(params) / 1000).toFixed(0)}kΩ`,
      basis: 'BJT 小信号参数定义',
      highlight: ['pi-n-rpi', 'pi-n-gm', 'pi-n-ro'],
    },
    {
      i: 3,
      title: 'MNA 求 Av / Ri / Ro',
      formula_tex: 'A_v=\\frac{v_o}{v_s}',
      substitution: `Av=${point.Av.toFixed(5)}，Ri=${(point.Ri / 1000).toFixed(3)}kΩ，Ro=${(point.Ro / 1000).toFixed(3)}kΩ`,
      value: `Av=${point.Av.toFixed(4)}`,
      basis: '节点电压法（含 ro）',
      highlight: params.config === 'CC' ? ['pi-n-ro', 'n-rl', 'n-gnd'] : ['pi-n-ro', 'n-rc', 'n-rl'],
    },
    {
      i: 4,
      title: '手推闭式（含 ro）与教学近似',
      formula_tex: `A_v=${
        params.config === 'CE'
          ? '-g_m(R_C\\parallel R_L\\parallel r_o)\\frac{r_\\pi}{R_s+r_\\pi}'
          : params.config === 'CB'
            ? 'k\\frac{R_i}{R_s+R_i},\\ k=\\frac{(1+g_m r_o)R_{CL}}{R_{CL}+r_o}'
            : '\\frac{(\\beta+1)R_{eff}}{R_s+r_\\pi+(\\beta+1)R_{eff}}'
      }`,
      substitution: `闭式 Av=${analytic.Av.toFixed(5)}；忽略 ro 教学近似 Av=${noRo.Av.toFixed(5)}；${
        params.config === 'CE' ? '反相电压放大' : params.config === 'CB' ? '同相、低输入阻抗' : '电压跟随、低输出阻抗'
      }`,
      value: `闭式 vs MNA 偏差 ${(Math.abs((analytic.Av - point.Av) / point.Av) * 100).toExponential(2)}%；忽略 ro 误差 ${(Math.abs((noRo.Av - point.Av) / point.Av) * 100).toFixed(2)}%`,
      basis: '含 ro 闭式；忽略 ro 仅作教学对照',
      highlight: [],
    },
  ];
  return {
    templateId: 'A3',
    subject: 'analog',
    parsed_given: {
      config: params.config,
      beta: params.beta,
      Ic: params.Ic,
      Rc: params.Rc,
      Rl: params.Rl,
      Rs: params.Rs,
      Re: params.Re,
      Vt: params.Vt,
      VA: params.VA,
    },
    steps,
    result: {
      config: params.config,
      gm: gmOf(params),
      rpi: rpiOf(params),
      ro: roOf(params),
      Av: point.Av,
      Ri: point.Ri,
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