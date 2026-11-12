/**
 * D2/D3 逻辑网表求值（路径 A / solver 共用）。
 *
 * 这里只做拓扑求值，不做任何渲染/校验组装。
 * 路径 B（digitaljs）与路径 C（QMC）不 import 本文件的中间量。
 */

import type { Netlist, TruthTable } from '../../types';

export interface LogicEvalResult {
  inputs: string[];
  output: string;
  rows: TruthTable['rows'];
}

const GATE_OPS = new Set(['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR']);

function deviceMap(netlist: Netlist) {
  return new Map(netlist.devices.map((device) => [device.id, device]));
}

export function inputDevices(netlist: Netlist): string[] {
  return netlist.devices.filter((device) => device.symbolId === 'IN').map((device) => device.id);
}

export function outputDevice(netlist: Netlist): string {
  const output = netlist.devices.find((device) => device.symbolId === 'OUT');
  if (!output) throw new Error('逻辑网表缺少 OUT 器件');
  return output.id;
}

export function gateDevices(netlist: Netlist): string[] {
  return netlist.devices
    .filter((device) => GATE_OPS.has(device.symbolId))
    .map((device) => device.id);
}

function sourceMap(netlist: Netlist): Map<string, string> {
  const sources = new Map<string, string>();
  for (const connector of netlist.connectors) {
    const [toId, toPin] = connector.to;
    const key = `${toId}:${toPin}`;
    if (sources.has(key)) throw new Error(`网表 ${key} 有多个驱动源`);
    sources.set(key, connector.from[0]);
  }
  return sources;
}

function inputSources(netlist: Netlist, deviceId: string, sources: Map<string, string>): string[] {
  return netlist.connectors
    .filter((connector) => connector.to[0] === deviceId)
    .sort((a, b) => a.to[1].localeCompare(b.to[1], undefined, { numeric: true }))
    .map((connector) => {
      const source = sources.get(`${deviceId}:${connector.to[1]}`);
      if (!source) throw new Error(`网表 ${deviceId}:${connector.to[1]} 无驱动源`);
      return source;
    });
}

function applyGate(op: string, values: (0 | 1)[]): 0 | 1 {
  const bools = values.map((value) => value === 1);
  switch (op) {
    case 'NOT':
      if (bools.length !== 1) throw new Error('NOT 必须恰好 1 个输入');
      return bools[0] ? 0 : 1;
    case 'AND':
      return bools.every(Boolean) ? 1 : 0;
    case 'NAND':
      return bools.every(Boolean) ? 0 : 1;
    case 'OR':
      return bools.some(Boolean) ? 1 : 0;
    case 'NOR':
      return bools.some(Boolean) ? 0 : 1;
    case 'XOR':
      return bools.reduce((acc, value) => acc !== value, false) ? 1 : 0;
    default:
      throw new Error(`不支持的逻辑门：${op}`);
  }
}

function evaluateDeviceOutput(
  netlist: Netlist,
  deviceId: string,
  assignment: Record<string, 0 | 1>,
  sources: Map<string, string>,
  memo: Map<string, 0 | 1>,
): 0 | 1 {
  const memoized = memo.get(deviceId);
  if (memoized !== undefined) return memoized;

  const devices = deviceMap(netlist);
  const device = devices.get(deviceId);
  if (!device) throw new Error(`网表缺少器件 ${deviceId}`);

  let value: 0 | 1;
  if (device.symbolId === 'IN') {
    const input = assignment[deviceId];
    if (input === undefined) throw new Error(`缺少输入 ${deviceId}`);
    value = input;
  } else if (device.symbolId === 'OUT') {
    const source = sources.get(`${deviceId}:p`);
    if (!source) throw new Error(`输出 ${deviceId} 无驱动源`);
    value = evaluateDeviceOutput(netlist, source, assignment, sources, memo);
  } else if (GATE_OPS.has(device.symbolId)) {
    const inputs = inputSources(netlist, deviceId, sources).map((source) =>
      evaluateDeviceOutput(netlist, source, assignment, sources, memo),
    );
    value = applyGate(device.symbolId, inputs);
  } else {
    throw new Error(`逻辑求值不支持器件 ${device.symbolId}`);
  }

  memo.set(deviceId, value);
  return value;
}

export function evaluateNetlist(
  netlist: Netlist,
  assignment: Record<string, 0 | 1>,
): 0 | 1 {
  const output = outputDevice(netlist);
  return evaluateDeviceOutput(netlist, output, assignment, sourceMap(netlist), new Map());
}

export function truthTable(netlist: Netlist): LogicEvalResult {
  const inputs = inputDevices(netlist);
  if (inputs.length === 0 || inputs.length > 8) {
    throw new Error(`D2 支持 1–8 个输入，实际 ${inputs.length}`);
  }
  const output = outputDevice(netlist);
  const rows: TruthTable['rows'] = [];
  const total = 2 ** inputs.length;
  const sources = sourceMap(netlist);
  for (let index = 0; index < total; index += 1) {
    const inBits = inputs.map(
      (_, bit) => ((index >> (inputs.length - 1 - bit)) & 1) as 0 | 1,
    );
    const assignment: Record<string, 0 | 1> = {};
    inputs.forEach((id, bit) => {
      assignment[id] = inBits[bit];
    });
    const out = evaluateDeviceOutput(netlist, output, assignment, sources, new Map());
    rows.push({ in: inBits, out: [out] });
  }
  return { inputs, output, rows };
}

function needsParens(expr: string, parentOp: string): boolean {
  if (parentOp === 'AND') return expr.includes('+');
  if (parentOp === 'NOT') return expr.includes('+') || expr.includes('·');
  return false;
}

function expressionOf(
  netlist: Netlist,
  deviceId: string,
  sources: Map<string, string>,
  memo: Map<string, string>,
): string {
  const memoized = memo.get(deviceId);
  if (memoized !== undefined) return memoized;

  const device = deviceMap(netlist).get(deviceId);
  if (!device) throw new Error(`网表缺少器件 ${deviceId}`);

  let expr: string;
  if (device.symbolId === 'IN') {
    expr = deviceId;
  } else if (device.symbolId === 'OUT') {
    const source = sources.get(`${deviceId}:p`);
    if (!source) throw new Error(`输出 ${deviceId} 无驱动源`);
    expr = expressionOf(netlist, source, sources, memo);
  } else if (device.symbolId === 'NOT') {
    const child = inputSources(netlist, deviceId, sources)
      .map((source) => expressionOf(netlist, source, sources, memo))[0];
    if (child === undefined) throw new Error(`NOT ${deviceId} 无输入`);
    expr = `${needsParens(child, 'NOT') ? `(${child})` : child}'`;
  } else if (device.symbolId === 'AND' || device.symbolId === 'NAND') {
    const children = inputSources(netlist, deviceId, sources).map((source) =>
      expressionOf(netlist, source, sources, memo),
    );
    const joined = children
      .map((child) => (needsParens(child, 'AND') ? `(${child})` : child))
      .join('·');
    expr = device.symbolId === 'NAND' ? `(${joined})'` : joined;
  } else if (device.symbolId === 'OR' || device.symbolId === 'NOR') {
    const children = inputSources(netlist, deviceId, sources).map((source) =>
      expressionOf(netlist, source, sources, memo),
    );
    const joined = children.join(' + ');
    expr = device.symbolId === 'NOR' ? `(${joined})'` : joined;
  } else if (device.symbolId === 'XOR') {
    const children = inputSources(netlist, deviceId, sources).map((source) => {
      const child = expressionOf(netlist, source, sources, memo);
      return child.includes('+') ? `(${child})` : child;
    });
    expr = children.join('⊕');
  } else {
    throw new Error(`逻辑表达式不支持器件 ${device.symbolId}`);
  }

  memo.set(deviceId, expr);
  return expr;
}

export function expressionFor(netlist: Netlist, deviceId: string = outputDevice(netlist)): string {
  return expressionOf(netlist, deviceId, sourceMap(netlist), new Map());
}

export function gateSummary(netlist: Netlist): string {
  const counts = new Map<string, number>();
  for (const device of netlist.devices) {
    if (!GATE_OPS.has(device.symbolId)) continue;
    counts.set(device.symbolId, (counts.get(device.symbolId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([op, count]) => `${op}×${count}`).join(', ');
}

export function mintermsOf(rows: TruthTable['rows']): number[] {
  return rows.flatMap((row, index) => (row.out[0] === 1 ? [index] : []));
}

/** 把含 · / ' / + 的结构式转成 KaTeX；只做这两类符号替换。 */
export function toTex(expr: string): string {
  return expr
    .replace(/([A-Za-z0-9_)])(?:')/g, '$1^{\\prime}')
    .replace(/·/g, ' \\cdot ');
}