/** 逻辑网表通用布局：按门深度分列，D2/D3 共用。 */

import type { Netlist } from '../../types';
import { gateDevices, inputDevices, outputDevice } from './logicEval.ts';

export function sourceIds(netlist: Netlist, deviceId: string): string[] {
  return netlist.connectors
    .filter((connector) => connector.to[0] === deviceId)
    .map((connector) => connector.from[0]);
}

export function gateDepths(netlist: Netlist): Map<string, number> {
  const devices = new Map(netlist.devices.map((device) => [device.id, device]));
  const depths = new Map<string, number>();

  const visit = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const device = devices.get(id);
    if (!device) throw new Error(`网表缺少器件 ${id}`);
    let depth: number;
    if (device.symbolId === 'IN') depth = 0;
    else {
      const sources = sourceIds(netlist, id);
      if (sources.length === 0) throw new Error(`器件 ${id} 无输入`);
      depth = Math.max(...sources.map(visit)) + 1;
    }
    depths.set(id, depth);
    return depth;
  };

  for (const device of netlist.devices) visit(device.id);
  return depths;
}

export interface Layout {
  positions: Map<string, { x: number; y: number }>;
  nodeId: (deviceId: string) => string;
  edgeId: (from: string, to: string) => string;
}

export function buildLayout(netlist: Netlist): Layout {
  const depths = gateDepths(netlist);
  const inputs = inputDevices(netlist);
  const positions = new Map<string, { x: number; y: number }>();

  inputs.forEach((id, index) => {
    positions.set(id, { x: 60, y: 90 + index * 110 });
  });

  const gates = gateDevices(netlist);
  const byDepth = new Map<number, string[]>();
  for (const gate of gates) {
    const depth = depths.get(gate) ?? 1;
    const bucket = byDepth.get(depth) ?? [];
    bucket.push(gate);
    byDepth.set(depth, bucket);
  }

  for (const [depth, bucket] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    bucket.sort();
    bucket.forEach((gate, index) => {
      const sources = sourceIds(netlist, gate);
      const ys = sources
        .map((source) => positions.get(source)?.y)
        .filter((y): y is number => y !== undefined);
      const baseY = ys.length > 0 ? ys.reduce((sum, y) => sum + y, 0) / ys.length : 160;
      const y = baseY + (bucket.length > 1 ? (index - (bucket.length - 1) / 2) * 60 : 0);
      positions.set(gate, { x: 60 + depth * 220, y });
    });
  }

  const output = outputDevice(netlist);
  const outputSources = sourceIds(netlist, output);
  const outputY = positions.get(outputSources[0])?.y ?? 200;
  positions.set(output, {
    x: 60 + ((depths.get(output) ?? 1) * 220),
    y: outputY,
  });

  return {
    positions,
    nodeId: (deviceId) => `node-${deviceId}`,
    edgeId: (from, to) => `edge-${from}-${to}`,
  };
}

export function kindOf(symbolId: string): string {
  if (symbolId === 'IN') return 'input';
  if (symbolId === 'OUT') return 'output';
  return symbolId.toLowerCase();
}