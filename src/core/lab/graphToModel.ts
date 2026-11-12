/**
 * CanvasGraph → Netlist | BeamModel：装配后的严格契约模型。
 *
 * 电路连线的 pin 归属用「端点就近吸附 + 结点合并」推出，不依赖 symbolRegistry
 * 的 pins 几何 —— 快照里的导线端点本来就是真实的连接点（44px 引脚偏移与
 * 布局函数一致）。
 */

import type { BeamModel, Netlist } from '../types.ts';
import { normalizeDeviceId } from './graphFromSpec.ts';
import { supportRefs } from './attach.ts';
import { REACTION_LABEL, valueFromLabel } from './picks.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';

/** 快照 kind → SymbolDef.id。 */
const KIND_TO_SYMBOL: Record<string, string> = {
  res: 'R',
  cap: 'C',
  ind: 'L',
  diode: 'D',
  led: 'LED',
  vsrc: 'V',
  npn: 'NPN',
  pnp: 'PNP',
  nmos: 'NMOS',
  pmos: 'PMOS',
  gnd: 'GND',
  opamp: 'OPAMP',
};

const LOAD_KINDS: Record<string, 'point' | 'udl' | 'moment' | 'torque'> = {
  arrow: 'point',
  udl: 'udl',
  momentArrow: 'moment',
  torqueArrow: 'torque',
};

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** 电路：端点 → 器件 pin 的归属启发式。 */
function pinOf(node: CanvasNode, px: number, py: number): string | null {
  const dx = px - node.x;
  const dy = py - node.y;
  if (Math.hypot(dx, dy) > 70) return null;
  switch (node.kind) {
    case 'gnd':
      return 'p';
    case 'npn':
    case 'pnp':
    case 'nmos':
    case 'pmos': {
      if (Math.abs(dx) >= Math.abs(dy)) return 'b'; // 基极 / 栅极在左右
      return dy < 0 ? (node.kind === 'nmos' || node.kind === 'pmos' ? 'd' : 'c') : node.kind === 'nmos' || node.kind === 'pmos' ? 's' : 'e';
    }
    case 'opamp': {
      if (dx < -20) return 'inp';
      if (dx > 20 && Math.abs(dy) < 30) return 'out';
      return 'inn';
    }
    default: {
      // 两端器件：rot 90 → 上下两端；否则左右两端
      if (node.rot === 90) return dy < 0 ? 'a' : 'b';
      return dx < 0 ? 'a' : 'b';
    }
  }
}

interface EndRef {
  nodeId: string | null; // 器件节点 id（dot / 悬空为 null）
  pin: string | null;
  x: number;
  y: number;
}

function resolveEnds(graph: CanvasGraph): { wireId: string; ends: [EndRef, EndRef] }[] {
  const devices = graph.nodes.filter((node) => KIND_TO_SYMBOL[node.kind] !== undefined);
  const wires = graph.edges.filter((edge) => edge.kind === 'wire');
  const pointsOf = (edge: CanvasGraph['edges'][number]): [number, number][] =>
    edge.points ?? [
      [0, 0],
      [0, 0],
    ];
  const pointEnd = (edge: CanvasGraph['edges'][number], at: 'from' | 'to'): [number, number] => {
    const points = pointsOf(edge);
    if (edge.points) return at === 'from' ? points[0] : points[points.length - 1];
    const target = graph.nodes.find((node) => node.id === (at === 'from' ? edge.from : edge.to));
    return target ? [target.x, target.y] : [0, 0];
  };
  const resolve = (x: number, y: number): EndRef => {
    let best: { node: CanvasNode; pin: string; d: number } | null = null;
    for (const device of devices) {
      const pin = pinOf(device, x, y);
      if (!pin) continue;
      const d = dist(device.x, device.y, x, y);
      if (!best || d < best.d) best = { node: device, pin, d };
    }
    if (best) return { nodeId: best.node.id, pin: best.pin, x, y };
    return { nodeId: null, pin: null, x, y };
  };
  return wires.map((wire) => ({
    wireId: wire.id,
    ends: [resolveEnd(pointEnd(wire, 'from'), resolve), resolveEnd(pointEnd(wire, 'to'), resolve)],
  }));
}
function resolveEnd(p: [number, number], resolve: (x: number, y: number) => EndRef): EndRef {
  return resolve(p[0], p[1]);
}

/**
 * 未落到器件 pin 的端点（dot / 拐角）都是结点：按坐标把导线两两贯通，
 * 直到两端都落在器件 pin 上。一个结点挂 k 个 pin → 全配对（结构语义）。
 */
function collapseJunctions(wires: { wireId: string; ends: [EndRef, EndRef] }[]): [EndRef, EndRef][] {
  const jkey = (end: EndRef) => `J:${Math.round(end.x)},${Math.round(end.y)}`;
  // 结点键 → 挂在该结点上的导线索引
  const byJunction = new Map<string, number[]>();
  wires.forEach((wire, index) => {
    for (const end of wire.ends) {
      if (!end.nodeId) {
        const key = jkey(end);
        byJunction.set(key, [...(byJunction.get(key) ?? []), index]);
      }
    }
  });
  const used = new Set<string>();
  const out: [EndRef, EndRef][] = [];
  const collect = (index: number, seen: Set<number>): EndRef[] => {
    // 从一根导线出发，沿共享结点把整个连通片走完，返回全部 pin 端
    const pins: EndRef[] = [];
    const walk = (wireIndex: number) => {
      if (seen.has(wireIndex)) return;
      seen.add(wireIndex);
      const wire = wires[wireIndex];
      for (const end of wire.ends) {
        if (end.nodeId) {
          pins.push(end);
          continue;
        }
        for (const partner of byJunction.get(jkey(end)) ?? []) walk(partner);
      }
    };
    walk(index);
    return pins;
  };
  wires.forEach((wire, index) => {
    if (used.has(wire.wireId)) return;
    const seen = new Set<number>();
    const pins = collect(index, seen);
    for (const id of seen) used.add(wires[id].wireId);
    for (let i = 1; i < pins.length; i += 1) out.push([pins[0], pins[i]]);
  });
  return out;
}

export function graphToNetlist(graph: CanvasGraph): Netlist {
  const devices = graph.nodes
    .filter((node) => KIND_TO_SYMBOL[node.kind] !== undefined)
    .map((node) => ({
      id: node.id,
      symbolId: KIND_TO_SYMBOL[node.kind],
      rotation: (node.rot ?? 0) as Netlist['devices'][number]['rotation'],
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.params ? { params: { ...node.params } } : {}),
    }));
  const connectors = collapseJunctions(resolveEnds(graph)).map(([from, to], index) => ({
    id: `c-${index}`,
    from: [from.nodeId, from.pin ?? 'p'] as [string, string],
    to: [to.nodeId, to.pin ?? 'p'] as [string, string],
  }));
  return { kind: 'circuit', devices, connectors };
}

export function graphToBeam(graph: CanvasGraph): BeamModel {
  const joints = graph.nodes.filter((node) => node.kind === 'pin' || node.kind === 'dot');
  const memberEdges = graph.edges.filter(
    (edge) => ['beam', 'shaft', 'line', 'trussMember'].includes(edge.kind) && joints.some((j) => j.id === edge.from) && joints.some((j) => j.id === edge.to),
  );
  const members = memberEdges.map((edge) => ({
    id: edge.id,
    symbolId: edge.kind === 'shaft' ? 'shaftSegment' : edge.kind === 'line' ? 'trussMember' : 'beamSegment',
    from: edge.from,
    to: edge.to,
  }));
  const nearestJoint = (x: number, y: number): string | null => {
    let best: { id: string; d: number } | null = null;
    for (const joint of joints) {
      const d = dist(joint.x, joint.y, x, y);
      if (!best || d < best.d) best = { id: joint.id, d };
    }
    return best && best.d <= 70 ? best.id : null;
  };
  // R3-1 A1：支座读 supportRefs（结点属性 + 旧形态图元）。属性形态的坐标就是
  // 结点坐标 → at 直接是它挂的那个结点，不再靠 70px 就近「猜」。
  const supports = supportRefs(graph).map((ref) => ({
    id: normalizeDeviceId(ref.id).toLowerCase(),
    symbolId: ref.kind,
    at: ref.jointId ?? nearestJoint(ref.x, ref.y) ?? ref.id,
    type: ref.type,
  }));
  const loadNodes = graph.nodes.filter(
    (node) => LOAD_KINDS[node.kind] !== undefined && !node.id.startsWith('n-reaction-') && !REACTION_LABEL.test((node.label ?? '').trim()),
  );
  const loads = loadNodes.map((node) => {
    const type = LOAD_KINDS[node.kind];
    // 位置：R3-1 A3 起结点载荷带 atJoint，跨内载荷按 x 投影出 t。
    const member = memberEdges[0];
    const jointAt = node.atJoint && joints.some((joint) => joint.id === node.atJoint) ? node.atJoint : null;
    const jointNear = jointAt ?? nearestJoint(node.x, node.y);
    let at = jointNear ?? member?.id ?? node.id;
    let t: number | undefined;
    if (member && (!jointNear || type === 'udl')) {
      const a = joints.find((j) => j.id === member.from);
      const b = joints.find((j) => j.id === member.to);
      if (a && b && b.x !== a.x) {
        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        t = clamp((node.x - a.x) / (b.x - a.x));
        at = member.id;
      }
    }
    return {
      id: node.id,
      symbolId: node.kind,
      at,
      ...(t !== undefined ? { t } : {}),
      type,
      value: node.value ?? valueFromLabel(node.label) ?? 0,
    };
  });
  return {
    kind: 'beam',
    nodes: joints.map((joint) => ({ id: joint.id, x: joint.x, y: joint.y })),
    members,
    supports,
    loads,
  };
}
