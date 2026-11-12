/**
 * A4 MOS 直流工作区：截止 / 饱和 / 三极管区。
 * 产品路径：工作区假设 → 平方律线性化 → MNA 迭代。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMNA, type AnalogCircuit } from './mna.ts';
import { board } from '../../../render/templates/schematicBoard.ts';

export type MosZone = 'cutoff' | 'saturation' | 'triode';

export interface A4Params {
  Vdd: number;
  Rg1: number;
  Rg2: number;
  Rd: number;
  Rs: number;
  Vth: number;
  Kn: number;
  lambda: number;
}

export interface A4Point {
  zone: MosZone;
  id: number;
  vgs: number;
  vds: number;
}

export const A4_DEFAULT: A4Params = {
  Vdd: 12,
  Rg1: 2_000_000,
  Rg2: 1_000_000,
  Rd: 2_000,
  Rs: 1_000,
  Vth: 1,
  Kn: 5e-4,
  lambda: 0.02,
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

export function a4Params(input: Record<string, number | string>): A4Params {
  const num = (key: keyof A4Params): number => {
    const raw = input[key];
    const value = raw === undefined ? A4_DEFAULT[key] : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`A4 参数 ${key} 必须是数字`);
    return value;
  };
  const params: A4Params = {
    Vdd: num('Vdd'),
    Rg1: num('Rg1'),
    Rg2: num('Rg2'),
    Rd: num('Rd'),
    Rs: num('Rs'),
    Vth: num('Vth'),
    Kn: num('Kn'),
    lambda: num('lambda'),
  };
  for (const key of ['Vdd', 'Rg1', 'Rg2', 'Rd', 'Rs', 'Kn'] as const) {
    if (params[key] <= 0) throw new Error(`A4 参数 ${key} 必须为正`);
  }
  if (params.lambda < 0) throw new Error('A4 lambda 不得为负');
  return params;
}

function gateVoltage(params: A4Params): number {
  return (params.Vdd * params.Rg2) / (params.Rg1 + params.Rg2);
}

export function mosCurrent(zone: MosZone, vgs: number, vds: number, params: A4Params): number {
  const vov = vgs - params.Vth;
  if (vov <= 0 || vds <= 0) return 0;
  const channel = 1 + params.lambda * vds;
  if (zone === 'triode') {
    return params.Kn * (vov * vds - 0.5 * vds * vds) * channel;
  }
  return 0.5 * params.Kn * vov * vov * channel;
}

function derivatives(zone: MosZone, vgs: number, vds: number, params: A4Params) {
  const vov = vgs - params.Vth;
  const channel = 1 + params.lambda * vds;
  if (zone === 'triode') {
    const gm = params.Kn * vds * channel;
    const gds =
      params.Kn * (vov - vds) * channel +
      params.Kn * (vov * vds - 0.5 * vds * vds) * params.lambda;
    return { gm, gds };
  }
  return {
    gm: params.Kn * vov * channel,
    gds: 0.5 * params.Kn * vov * vov * params.lambda,
  };
}

export function zoneHolds(zone: MosZone, point: A4Point, params: A4Params): boolean {
  if (!Number.isFinite(point.id)) return false;
  const eps = 1e-9;
  const vov = point.vgs - params.Vth;
  if (zone === 'cutoff') return vov <= eps && Math.abs(point.id) <= eps;
  if (point.id < -eps) return false;
  if (zone === 'saturation') return vov > eps && point.vds >= vov - eps;
  return vov > eps && point.vds < vov;
}

/** 标量回路解（路径 B / 工作区判定共用） */
export function solveZoneScalar(params: A4Params, zone: MosZone): A4Point {
  const vg = gateVoltage(params);
  const maxId = params.Vdd / (params.Rd + params.Rs);
  if (zone === 'cutoff') {
    return { zone, id: 0, vgs: vg, vds: params.Vdd };
  }
  const evaluate = (id: number): number => {
    const vgs = vg - id * params.Rs;
    const vds = params.Vdd - id * (params.Rd + params.Rs);
    return mosCurrent(zone, vgs, vds, params) - id;
  };
  // 饱和/三极管区之间以 VDS=VOV 为分界；搜索区间必须夹在该区间内。
  const splitId = Math.min(maxId, Math.max(0, (params.Vdd - vg + params.Vth) / params.Rd));
  let lo = zone === 'triode' ? splitId : 0;
  let hi = zone === 'saturation' ? splitId : maxId;
  let flo = evaluate(lo);
  let fhi = evaluate(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) {
    return { zone, id: Number.NaN, vgs: Number.NaN, vds: Number.NaN };
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fmid = evaluate(mid);
    if (Math.abs(fmid) < 1e-18) break;
    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  const id = (lo + hi) / 2;
  return {
    zone,
    id,
    vgs: vg - id * params.Rs,
    vds: params.Vdd - id * (params.Rd + params.Rs),
  };
}

export function commitZone(params: A4Params): A4Point {
  for (const zone of ['cutoff', 'saturation', 'triode'] as const) {
    const point = solveZoneScalar(params, zone);
    if (zoneHolds(zone, point, params)) return point;
  }
  throw new Error('A4 工作区无解：三组不等式均不成立');
}

function elementsFor(
  params: A4Params,
  zone: MosZone,
  vgs: number,
  vds: number,
): AnalogCircuit['elements'] {
  const elements: AnalogCircuit['elements'] = [
    { id: 'VDD', kind: 'V', a: 'vdd', b: 'gnd', value: params.Vdd },
    { id: 'RG1', kind: 'R', a: 'vdd', b: 'g', value: params.Rg1 },
    { id: 'RG2', kind: 'R', a: 'g', b: 'gnd', value: params.Rg2 },
    { id: 'RD', kind: 'R', a: 'vdd', b: 'd', value: params.Rd },
    { id: 'RS', kind: 'R', a: 's', b: 'gnd', value: params.Rs },
  ];
  if (zone === 'cutoff') return elements;
  const id = mosCurrent(zone, vgs, vds, params);
  const { gm, gds } = derivatives(zone, vgs, vds, params);
  const ieq = id - gm * vgs - gds * vds;
  elements.push({ id: 'GM', kind: 'VCCS', a: 'd', b: 's', value: gm, control: { a: 'g', b: 's' } });
  if (gds > 0) elements.push({ id: 'GDS', kind: 'R', a: 'd', b: 's', value: 1 / gds });
  elements.push({ id: 'IEQ', kind: 'I', a: 'd', b: 's', value: ieq });
  return elements;
}

export function solveZoneMNA(params: A4Params, zone: MosZone): A4Point {
  const vg = gateVoltage(params);
  let vgs = vg;
  let vds = params.Vdd / 2;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const circuit: AnalogCircuit = {
      nodes: ['vdd', 'g', 'd', 's', 'gnd'],
      ground: 'gnd',
      elements: elementsFor(params, zone, vgs, vds),
    };
    const result = solveMNA(circuit);
    const nextVgs = result.voltage.g - result.voltage.s;
    const nextVds = result.voltage.d - result.voltage.s;
    const delta = Math.max(Math.abs(nextVgs - vgs), Math.abs(nextVds - vds));
    vgs = nextVgs;
    vds = nextVds;
    if (delta < 1e-12) break;
  }
  const id = mosCurrent(zone, vgs, vds, params);
  return { zone, id, vgs, vds };
}

/** 图解法：沿负载线采样求输出特性交点。 */
export function solveZoneGraphical(params: A4Params, zone: MosZone): A4Point {
  if (zone === 'cutoff') {
    return { zone, id: 0, vgs: gateVoltage(params), vds: params.Vdd };
  }
  const vg = gateVoltage(params);
  const f = (vds: number): number => {
    const id = (params.Vdd - vds) / (params.Rd + params.Rs);
    const vgs = vg - id * params.Rs;
    return mosCurrent(zone, vgs, vds, params) - id;
  };
  const steps = 2000;
  let lo = 0;
  let hi = params.Vdd;
  let flo = f(lo);
  for (let index = 1; index <= steps; index += 1) {
    const x = (params.Vdd * index) / steps;
    const fx = f(x);
    if (flo * fx <= 0) {
      lo = (params.Vdd * (index - 1)) / steps;
      hi = x;
      break;
    }
    flo = fx;
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (Math.abs(f(mid)) < 1e-18) break;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const vds = (lo + hi) / 2;
  const id = (params.Vdd - vds) / (params.Rd + params.Rs);
  return { zone, id, vgs: vg - id * params.Rs, vds };
}

function schematicSpec(point: A4Point, params: A4Params, steps: number): RenderSpec {
  const b = board();
  b.text('n-vdd', [523, 84], `VDD ${params.Vdd}V`);
  const rg1 = b.part('n-rg1', 'res', [476, 160], { rot: 90, label: 'Rg1', labelSide: 'left' });
  const rg2 = b.part('n-rg2', 'res', [476, 330], { rot: 90, label: 'Rg2', labelSide: 'left' });
  const m = b.part('n-m', 'nmos', [560, 270], { label: 'M', labelSide: 'right' });
  const rd = b.part('n-rd', 'res', [570, 160], { rot: 90, label: 'Rd', labelSide: 'right' });
  const rs = b.part('n-rs', 'res', [570, 370], { rot: 90, label: 'Rs', labelSide: 'right' });
  b.part('n-gnd', 'gnd', [520, 440], { label: 'GND', labelSide: 'down' });
  b.dot('n-g', [476, 270]);
  b.wire('e-vdd-rail', [[476, 100], [570, 100]], { weight: 2 });
  b.wire('e-vdd-rg1', [[476, 100], rg1.pin('a')]);
  b.wire('e-vdd-rd', [[570, 100], rd.pin('a')]);
  b.wire('e-rg1-g', [rg1.pin('b'), [476, 270]]);
  b.wire('e-rg2-g', [[476, 270], rg2.pin('a')]);
  b.wire('e-g-m', [[476, 270], m.pin('g')]);
  b.wire('e-rd-d', [rd.pin('b'), m.pin('d')]);
  b.wire('e-m-rs', [m.pin('s'), rs.pin('a')]);
  b.wire('e-gnd-rail', [[476, 440], [570, 440]], { weight: 2 });
  b.wire('e-rg2-gnd', [rg2.pin('b'), [476, 440]]);
  b.wire('e-rs-gnd', [rs.pin('b'), [570, 440]]);
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
              { id: 'n-m', text: `ID=${(point.id * 1e3).toFixed(2)}mA` },
              { id: 'n-rd', text: `VDS=${point.vds.toFixed(3)}V` },
            ]
          : [],
    })),
  };
}

export function solveA4(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('A4 只接受结构化参数');
  const params = a4Params(input as Record<string, number | string>);
  const point = commitZone(params);

  const steps: Step[] = [
    {
      i: 0,
      title: '求栅极直流电压',
      formula_tex: `V_G=\\frac{R_{g2}}{R_{g1}+R_{g2}}V_{DD}`,
      substitution: `VG=${gateVoltage(params).toFixed(4)}V`,
      value: '栅极电流为 0，分压器直接定 VG',
      basis: 'MOS 栅极绝缘',
      highlight: ['n-rg1', 'n-rg2'],
    },
    {
      i: 1,
      title: '假设工作区并迭代',
      formula_tex: `I_D=\\frac{K_n}{2}(V_{GS}-V_{th})^2(1+\\lambda V_{DS})`,
      substitution: `Kn=${params.Kn}，Vth=${params.Vth}，λ=${params.lambda}`,
      value: `判定工作区：${point.zone}`,
      basis: '平方律 + 工作区假设',
      highlight: ['n-m'],
    },
    {
      i: 2,
      title: '解出 ID / VGS / VDS',
      formula_tex: `V_{GS}=V_G-I_DR_S,\\quad V_{DS}=V_{DD}-I_D(R_D+R_S)`,
      substitution: `ID=${(point.id * 1e3).toFixed(4)}mA`,
      value: `VGS=${point.vgs.toFixed(4)}V，VDS=${point.vds.toFixed(4)}V`,
      basis: 'KVL 回路方程',
      highlight: ['n-rd', 'n-rs'],
    },
    {
      i: 3,
      title: '回代工作区不等式',
      formula_tex: `V_{GS}>V_{th},\\quad V_{DS}\\gtrless V_{GS}-V_{th}`,
      substitution: `VOV=${(point.vgs - params.Vth).toFixed(4)}V`,
      value: point.zone === 'saturation' ? 'VDS≥VOV，饱和区成立' : point.zone === 'cutoff' ? 'VGS≤Vth，截止区成立' : 'VDS<VOV，三极管区成立',
      basis: '工作区不等式回代',
      highlight: ['n-m'],
    },
    {
      i: 4,
      title: '确认工作点',
      formula_tex: `Q=(I_D,\\;V_{GS},\\;V_{DS})`,
      substitution: `${(point.id * 1e3).toFixed(3)}mA / ${point.vgs.toFixed(3)}V / ${point.vds.toFixed(3)}V`,
      value: point.zone,
      basis: '三组不等式恰好一组成立',
      highlight: ['n-m'],
    },
  ];

  return {
    templateId: 'A4',
    subject: 'analog',
    parsed_given: {
      Vdd: params.Vdd,
      Rg1: params.Rg1,
      Rg2: params.Rg2,
      Rd: params.Rd,
      Rs: params.Rs,
      Vth: params.Vth,
      Kn: params.Kn,
      lambda: params.lambda,
    },
    steps,
    result: {
      zone: point.zone,
      ID: point.id,
      VGS: point.vgs,
      VDS: point.vds,
      VOV: point.vgs - params.Vth,
    },
    render_specs: [schematicSpec(point, params, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}
