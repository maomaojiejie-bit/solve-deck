/**
 * D3 组合逻辑设计：从目标函数反推门级网表。
 *
 * 产品路径：目标真值表 → 自写最小化器 → 两级 AND-OR 网表。
 * 构建期路径 B 用 digitaljs 跑生成的网表，路径 C 用第三方 QMC 独立化简目标函数。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type {
  ConfidenceReport,
  Frame,
  Netlist,
  RenderSpec,
  Solution,
  Step,
  TruthTable,
} from '../../types.ts';
import type { SolverInput } from '../registry';
import { expressionFor, gateDevices, inputDevices, mintermsOf, outputDevice, toTex, truthTable } from './logicEval.ts';
import { buildLayout, gateDepths, kindOf } from './layout.ts';
import { implicantText, minimize, type Implicant } from './minimize.ts';

type D3Op =
  | 'mux2'
  | 'decoder2to4'
  | 'adder-sum'
  | 'adder-carry'
  | 'comparator-gt'
  | 'comparator-eq'
  | 'parity4';

const OPS: Record<D3Op, { inputs: string[]; title: string }> = {
  mux2: { inputs: ['S', 'A', 'B'], title: '2 选 1 MUX：F = S′A + S B' },
  decoder2to4: { inputs: ['A', 'B'], title: '2-4 译码器单个输出（minterm）' },
  'adder-sum': { inputs: ['A', 'B', 'C'], title: '全加器本位和：S = A⊕B⊕C' },
  'adder-carry': { inputs: ['A', 'B', 'C'], title: '全加器进位：Cout = AB + AC + BC' },
  'comparator-gt': { inputs: ['A', 'B'], title: '1 位比较器 A>B' },
  'comparator-eq': { inputs: ['A', 'B'], title: '1 位比较器 A=B' },
  parity4: { inputs: ['A', 'B', 'C', 'D'], title: '4 位奇校验' },
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

function targetValue(op: D3Op, bit: number, assignment: Record<string, 0 | 1>): 0 | 1 {
  const bools = (names: string[]) => names.map((name) => assignment[name] === 1);
  switch (op) {
    case 'mux2':
      return (assignment.S === 1 ? assignment.B : assignment.A) as 0 | 1;
    case 'decoder2to4':
      return ((assignment.A << 1) | assignment.B) === bit ? 1 : 0;
    case 'adder-sum':
      return (assignment.A ^ assignment.B ^ assignment.C) as 0 | 1;
    case 'adder-carry': {
      const [a, b, c] = bools(['A', 'B', 'C']);
      return a && b || a && c || b && c ? 1 : 0;
    }
    case 'comparator-gt':
      return assignment.A === 1 && assignment.B === 0 ? 1 : 0;
    case 'comparator-eq':
      return assignment.A === assignment.B ? 1 : 0;
    case 'parity4': {
      const [a, b, c, d] = bools(['A', 'B', 'C', 'D']);
      return a !== b !== c !== d ? 1 : 0;
    }
    default:
      throw new Error(`未知 D3 op：${String(op)}`);
  }
}

function targetRows(op: D3Op, bit: number, inputs: string[]): TruthTable['rows'] {
  return Array.from({ length: 2 ** inputs.length }, (_, index) => {
    const inBits = inputs.map(
      (_, position) => ((index >> (inputs.length - 1 - position)) & 1) as 0 | 1,
    );
    const assignment: Record<string, 0 | 1> = {};
    inputs.forEach((name, position) => {
      assignment[name] = inBits[position];
    });
    return { in: inBits, out: [targetValue(op, bit, assignment)] };
  });
}

interface GateSpec {
  id: string;
  symbolId: 'NOT' | 'AND' | 'OR';
  inputs: string[];
}

function synthesize(inputs: string[], terms: Implicant[], variableCount: number): Netlist {
  const devices: Netlist['devices'] = inputs.map((id) => ({ id, symbolId: 'IN', rotation: 0 }));
  const connectors: Netlist['connectors'] = [];
  const notCache = new Map<string, string>();
  let counter = 0;

  const wire = (from: string, to: string, pin: string) => {
    const source = inputs.includes(from) ? ['p'] : ['out'];
    connectors.push({ from: [from, source[0]], to: [to, pin] });
  };
  const addGate = (symbolId: GateSpec['symbolId'], sources: string[]): string => {
    counter += 1;
    const id = `G${counter}`;
    devices.push({ id, symbolId, rotation: 0 });
    sources.forEach((source, index) =>
      wire(source, id, symbolId === 'NOT' ? 'in' : `in${index + 1}`),
    );
    return id;
  };
  const literal = (name: string, positive: boolean): string => {
    if (positive) return name;
    const cached = notCache.get(name);
    if (cached) return cached;
    const gate = addGate('NOT', [name]);
    notCache.set(name, gate);
    return gate;
  };

  const termOutputs = terms.map((term) => {
    const literals: string[] = [];
    for (let position = 0; position < variableCount; position += 1) {
      const bit = variableCount - 1 - position;
      if ((term.mask >>> bit) & 1) continue;
      literals.push(literal(inputs[position], ((term.value >>> bit) & 1) === 1));
    }
    if (literals.length === 0) {
      // 恒 1：用 A + A' 造一个常量，避免引入新器件类型。
      return addGate('OR', [literal(inputs[0], true), literal(inputs[0], false)]);
    }
    if (literals.length === 1) return literals[0];
    return addGate('AND', literals);
  });

  let source: string;
  if (termOutputs.length === 0) {
    source = addGate('AND', [literal(inputs[0], true), literal(inputs[0], false)]); // 恒 0
  } else if (termOutputs.length === 1) {
    source = termOutputs[0];
  } else {
    source = termOutputs[0];
    for (let index = 1; index < termOutputs.length; index += 1) {
      source = addGate('OR', [source, termOutputs[index]]);
    }
  }

  devices.push({ id: 'F', symbolId: 'OUT', rotation: 0 });
  connectors.push({ from: [source, inputs.includes(source) ? 'p' : 'out'], to: ['F', 'p'] });
  return { kind: 'logic', devices, connectors };
}

function buildSchematic(netlist: Netlist, steps: Step[]): RenderSpec {
  const layout = buildLayout(netlist);
  const nodes = netlist.devices.map((device) => {
    const position = layout.positions.get(device.id);
    if (!position) throw new Error(`D3 布局缺少 ${device.id}`);
    return {
      id: layout.nodeId(device.id),
      x: position.x,
      y: position.y,
      kind: kindOf(device.symbolId),
      label: device.id,
    };
  });
  const edges = netlist.connectors.map((connector) => ({
    id: layout.edgeId(connector.from[0], connector.to[0]),
    from: layout.nodeId(connector.from[0]),
    to: layout.nodeId(connector.to[0]),
    kind: 'wire',
  }));
  const gateIds = gateDevices(netlist);
  const depths = gateDepths(netlist);
  const inputs = inputDevices(netlist);
  const output = outputDevice(netlist);
  const allNodes = nodes.map((node) => node.id);
  const allEdges = edges.map((edge) => edge.id);

  const frames: Frame[] = Array.from({ length: steps.length }, (_, stepIndex) => {
    if (stepIndex === 0) {
      return {
        stepIndex,
        activeEdges: [],
        activeNodes: inputs.map(layout.nodeId),
        labels: [],
      };
    }
    if (stepIndex === 2) {
      const level1 = gateIds.filter((id) => (depths.get(id) ?? 0) === 1);
      return {
        stepIndex,
        activeEdges: netlist.connectors
          .filter((connector) => level1.includes(connector.to[0]))
          .map((connector) => layout.edgeId(connector.from[0], connector.to[0])),
        activeNodes: [...inputs.map(layout.nodeId), ...level1.map(layout.nodeId)],
        labels: level1.map((id) => ({ id: layout.nodeId(id), text: id })),
      };
    }
    if (stepIndex >= 3) {
      return {
        stepIndex,
        activeEdges: allEdges,
        activeNodes: allNodes,
        labels: [{ id: layout.nodeId(output), text: `F = ${expressionFor(netlist)}` }],
      };
    }
    return { stepIndex, activeEdges: allEdges, activeNodes: allNodes, labels: [] };
  });

  return { id: 'main', role: 'primary', type: 'schematic', nodes, edges, frames };
}

function buildTable(inputs: string[], rows: TruthTable['rows'], steps: Step[]): RenderSpec {
  return {
    id: 'truth',
    role: 'secondary',
    type: 'table',
    nodes: [],
    edges: [],
    table: { inputs, outputs: ['F'], rows },
    frames: Array.from({ length: steps.length }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

export interface D3Build {
  op: D3Op;
  spec: { inputs: string[]; title: string };
  rows: TruthTable['rows'];
  minterms: number[];
  terms: Implicant[];
  sop: string;
  netlist: Netlist;
}

/** 由结构化输入重建目标函数与生成网表（solver 与构建期路径共用）。 */
export function buildD3(input: Record<string, number | string>): D3Build {
  const op = String(input.op ?? '') as D3Op;
  const spec = OPS[op];
  if (!spec) throw new Error(`D3 不支持 op=${String(input.op)}`);
  const bit = op === 'decoder2to4' ? Number(input.bit ?? 0) : 0;
  if (op === 'decoder2to4' && (!Number.isInteger(bit) || bit < 0 || bit > 3)) {
    throw new Error('decoder2to4.bit 必须是 0–3');
  }

  const rows = targetRows(op, bit, spec.inputs);
  const minterms = mintermsOf(rows);
  const terms = minimize(minterms, [], spec.inputs.length);
  const sop = terms.map((term) => implicantText(term, spec.inputs)).join(' + ') || '0';
  const netlist = synthesize(spec.inputs, terms, spec.inputs.length);
  const generated = truthTable(netlist);
  if (JSON.stringify(generated.rows) !== JSON.stringify(rows)) {
    throw new Error('D3 综合失败：生成网表真值表与目标函数不一致');
  }
  return { op, spec, rows, minterms, terms, sop, netlist };
}

export function solveD3(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('D3 solver 只接受结构化已知量');
  const record = input as Record<string, number | string>;
  const built = buildD3(record);
  const { op, spec, rows, minterms, terms, sop, netlist } = built;

  const gateCount = gateDevices(netlist).length;
  const steps: Step[] = [
    {
      i: 0,
      title: '明确目标函数',
      formula_tex: `F(${spec.inputs.join(',')})=\\sum m(${minterms.join(',')})`,
      substitution: spec.title,
      value: `${2 ** spec.inputs.length} 行目标真值表，${minterms.length} 个 1`,
      basis: '组合逻辑设计：需求先落成真值表',
      highlight: spec.inputs.map((id) => `node-${id}`),
    },
    {
      i: 1,
      title: '提取最小项',
      formula_tex: `\\sum m(${minterms.join(',')})`,
      substitution: rows
        .map((row) => `${row.in.join('')}${row.out[0] === 1 ? '→1' : ''}`)
        .filter((text) => text.endsWith('1'))
        .join('，'),
      value: `minterms = {${minterms.join(', ')}}`,
      basis: '最小项表示',
      highlight: [],
    },
    {
      i: 2,
      title: '先用最小化器化简',
      formula_tex: `F=${toTex(sop)}`,
      substitution: `${terms.length} 个乘积项`,
      value: `F = ${sop}`,
      basis: 'Quine-McCluskey 最小化',
      highlight: [],
    },
    {
      i: 3,
      title: '综合成两级 AND-OR 网表',
      formula_tex: `\\text{AND 平面}\\rightarrow\\text{OR 平面}`,
      substitution: `${gateCount} 个门，${netlist.connectors.length} 条连线`,
      value: `gateCount=${gateCount}`,
      basis: 'SOP 直接映射：积项进 AND，和项进 OR',
      highlight: [],
    },
    {
      i: 4,
      title: '回代生成的网表',
      formula_tex: `F_{net}=${toTex(expressionFor(netlist))}`,
      substitution: `逐行比对 ${rows.length} 种输入组合`,
      value: '生成网表与目标真值表逐位一致',
      basis: '结构回代检查',
      highlight: [],
    },
  ];

  return {
    templateId: 'D3',
    subject: 'digital',
    parsed_given: {
      op,
      inputs: spec.inputs.join(', '),
      gateCount,
      target: spec.title,
    },
    steps,
    result: {
      op,
      expression: `F = ${sop}`,
      minterms: `Σm(${minterms.join(',')})`,
      gateCount,
      inputs: spec.inputs.join(''),
    },
    render_specs: [buildSchematic(netlist, steps), buildTable(spec.inputs, rows, steps)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}