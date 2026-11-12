/**
 * D2 组合逻辑分析 solver（路径 A 的主求解）。
 *
 * 输入：逻辑 Netlist（IN / 门 / OUT + connectors）。
 * 输出：Solution（steps / result / render_specs）；confidence 为占位，
 * 由 physicsValidator.validateSolution 重新组装。
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
import {
  expressionFor,
  gateDevices,
  gateSummary,
  inputDevices,
  mintermsOf,
  outputDevice,
  toTex,
  truthTable,
} from './logicEval.ts';
import { buildLayout, gateDepths, kindOf, type Layout } from './layout.ts';

export const D2_NETLIST: Netlist = {
  kind: 'logic',
  devices: [
    { id: 'A', symbolId: 'IN', rotation: 0 },
    { id: 'B', symbolId: 'IN', rotation: 0 },
    { id: 'C', symbolId: 'IN', rotation: 0 },
    { id: 'G1', symbolId: 'AND', rotation: 0 },
    { id: 'G2', symbolId: 'NOT', rotation: 0 },
    { id: 'G3', symbolId: 'OR', rotation: 0 },
    { id: 'F', symbolId: 'OUT', rotation: 0 },
  ],
  connectors: [
    { from: ['A', 'p'], to: ['G1', 'in1'] },
    { from: ['B', 'p'], to: ['G1', 'in2'] },
    { from: ['C', 'p'], to: ['G2', 'in'] },
    { from: ['G1', 'out'], to: ['G3', 'in1'] },
    { from: ['G2', 'out'], to: ['G3', 'in2'] },
    { from: ['G3', 'out'], to: ['F', 'p'] },
  ],
};

function pendingConfidence(): ConfidenceReport {
  const names = [
    'scopeOk',
    'inputOk',
    'pathsConsistent',
    'residualOk',
    'boundaryOk',
    'goldenOk',
  ];
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

function buildMainSpec(netlist: Netlist, layout: Layout, steps: Step[]): RenderSpec {
  const nodes = netlist.devices.map((device) => {
    const position = layout.positions.get(device.id);
    if (!position) throw new Error(`布局缺少 ${device.id}`);
    return {
      id: layout.nodeId(device.id),
      x: position.x,
      y: position.y,
      kind: kindOf(device.symbolId),
      label: device.id,
    };
  });

  const gateIds = gateDevices(netlist);
  const edges = netlist.connectors.map((connector) => {
    const [from] = connector.from;
    const [to] = connector.to;
    const id = layout.edgeId(from, to);
    const sourceIsGate = gateIds.includes(from);
    const label = sourceIsGate
      ? `w${gateIds.indexOf(from) + 1}`
      : from;
    return {
      id,
      from: layout.nodeId(from),
      to: layout.nodeId(to),
      kind: 'wire',
      label,
    };
  });

  const edgeBetween = (from: string, to: string) => layout.edgeId(from, to);
  const allNodeIds = nodes.map((node) => node.id);
  const allEdgeIds = edges.map((edge) => edge.id);
  const expressions = new Map(gateIds.map((id) => [id, expressionFor(netlist, id)]));
  const depths = gateDepths(netlist);
  const firstLevel = gateIds.filter((id) => depths.get(id) === 1);
  const secondLevel = gateIds.filter((id) => depths.get(id) === 2);
  const output = outputDevice(netlist);
  const outputExpr = expressionFor(netlist, output);

  const stepFrames: Frame[] = [
    {
      stepIndex: 0,
      activeEdges: allEdgeIds,
      activeNodes: allNodeIds,
      labels: [],
    },
    {
      stepIndex: 1,
      activeEdges: netlist.connectors
        .filter((connector) => firstLevel.includes(connector.to[0]))
        .map((connector) => edgeBetween(connector.from[0], connector.to[0])),
      activeNodes: [
        ...inputDevices(netlist).map(layout.nodeId),
        ...firstLevel.map(layout.nodeId),
      ],
      labels: firstLevel.map((id, index) => ({
        id: layout.nodeId(id),
        text: `w${index + 1} = ${expressions.get(id) ?? ''}`,
      })),
    },
    {
      stepIndex: 2,
      activeEdges: netlist.connectors
        .filter(
          (connector) =>
            secondLevel.includes(connector.to[0]) || connector.to[0] === output,
        )
        .map((connector) => edgeBetween(connector.from[0], connector.to[0])),
      activeNodes: [...secondLevel.map(layout.nodeId), layout.nodeId(output)],
      labels: [{ id: layout.nodeId(output), text: `F = ${outputExpr}` }],
    },
    {
      stepIndex: 3,
      activeEdges: allEdgeIds,
      activeNodes: allNodeIds,
      labels: [],
    },
    {
      stepIndex: 4,
      activeEdges: netlist.connectors
        .filter((connector) => connector.to[0] === output)
        .map((connector) => edgeBetween(connector.from[0], connector.to[0])),
      activeNodes: [layout.nodeId(output)],
      labels: [{ id: layout.nodeId(output), text: `F = ${outputExpr}` }],
    },
  ];

  if (steps.length !== 5) throw new Error('D2 需要 5 步');
  return {
    id: 'main',
    role: 'primary',
    type: 'schematic',
    nodes,
    edges,
    frames: stepFrames,
  };
}

function buildTableSpec(table: TruthTable): RenderSpec {
  return {
    id: 'truth',
    role: 'secondary',
    type: 'table',
    nodes: [],
    edges: [],
    table,
    frames: Array.from({ length: 5 }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

export function solveD2(input: SolverInput): Solution {
  const netlist = input as Netlist;
  if (!('kind' in netlist) || netlist.kind !== 'logic') {
    throw new Error('D2 solver 需要逻辑 Netlist');
  }

  const evaluated = truthTable(netlist);
  const expr = expressionFor(netlist, evaluated.output);
  const minterms = mintermsOf(evaluated.rows);
  const ones = evaluated.rows.filter((row) => row.out[0] === 1).length;
  const zeros = evaluated.rows.length - ones;
  const inputs = evaluated.inputs;
  const gateIds = gateDevices(netlist);
  const depths = gateDepths(netlist);
  const firstLevel = gateIds.filter((id) => depths.get(id) === 1);
  const expressions = new Map(gateIds.map((id) => [id, expressionFor(netlist, id)]));
  const layout = buildLayout(netlist);
  const output = outputDevice(netlist);

  const firstLevelTex = firstLevel
    .map((id, index) => `w_${index + 1} = ${toTex(expressions.get(id) ?? '')}`)
    .join(',\\quad ');
  const mintermTex = minterms.join(',');

  const steps: Step[] = [
    {
      i: 0,
      title: '识别电路结构',
      formula_tex: `F = ${toTex(expr)}`,
      substitution: `inputs: ${inputs.join(', ')}；gates: ${gateSummary(netlist)}`,
      value: `组合逻辑，${Math.max(...[...depths.values()])} 级`,
      basis: '组合逻辑分析：先定级、再写式',
      highlight: gateIds.map((id) => layout.nodeId(id)),
    },
    {
      i: 1,
      title: '写中间节点表达式',
      formula_tex: firstLevelTex,
      substitution: firstLevel
        .map((id) => `${id}: ${expressions.get(id) ?? ''}`)
        .join('；'),
      value: firstLevel
        .map((id, index) => `w${index + 1} = ${expressions.get(id) ?? ''}`)
        .join('，'),
      basis: '门的布尔功能定义',
      highlight: [
        ...netlist.connectors
          .filter((connector) => firstLevel.includes(connector.to[0]))
          .map((connector) => layout.edgeId(connector.from[0], connector.to[0])),
        ...firstLevel.map((id) => layout.nodeId(id)),
      ],
    },
    {
      i: 2,
      title: '合成输出表达式',
      formula_tex: `F = ${toTex(expr)}`,
      substitution: `F = ${expr}`,
      value: `F = ${expr}`,
      basis: '逻辑门对中间节点做组合',
      highlight: [
        ...netlist.connectors
          .filter(
            (connector) =>
              connector.to[0] === output ||
              gateIds.includes(connector.to[0]) && !firstLevel.includes(connector.to[0]),
          )
          .map((connector) => layout.edgeId(connector.from[0], connector.to[0])),
        layout.nodeId(output),
      ],
    },
    {
      i: 3,
      title: '枚举真值表',
      formula_tex: `F(${inputs.join(',')})=\\sum m(${mintermTex})`,
      substitution: `${evaluated.rows.length} 种输入组合逐行代入 F = ${expr}`,
      value: `1 的个数：${ones}；0 的个数：${zeros}`,
      basis: '真值表穷举',
      highlight: [
        ...netlist.connectors.map((connector) =>
          layout.edgeId(connector.from[0], connector.to[0]),
        ),
        ...netlist.devices.map((device) => layout.nodeId(device.id)),
      ],
    },
    {
      i: 4,
      title: '确认结论',
      formula_tex: `F = ${toTex(expr)}`,
      substitution: `结构式回写：${expr}`,
      value: `F = ${expr}`,
      basis: '结构式与真值表互检',
      highlight: [layout.nodeId(output)],
    },
  ];

  const main = buildMainSpec(netlist, layout, steps);
  const table = buildTableSpec({
    inputs,
    outputs: [evaluated.output],
    rows: evaluated.rows,
  });

  return {
    templateId: 'D2',
    subject: 'digital',
    parsed_given: {
      inputs: inputs.join(', '),
      gates: gateSummary(netlist),
      topology: `F = ${expr}`,
      gateCount: gateIds.length,
    },
    steps,
    result: {
      expression: `F = ${expr}`,
      minterms: `Σm(${mintermTex})`,
      ones,
      zeros,
    },
    render_specs: [main, table],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}