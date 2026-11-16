/**
 * 两次点击连线的判据（W10-B §1.3）。
 *
 * 电路点引脚、力学点节点；这里只做「能不能连」，不改图。拒绝时页面只 toast，
 * 不派发 op —— 所以 dirty 与 appliedRules 一个字都不会动。
 */

import { edgeEnds, findAnchor } from './pins.ts';
import type { CanvasGraph, GraphOp } from './types.ts';

export interface WireVerdict {
  ok: boolean;
  /** 拒绝理由（页面 toast）。 */
  reason?: string;
  op?: GraphOp;
}

export const SAME_POINT = '两端是同一个点，接不了';
export const DUPLICATE_WIRE = '这两个引脚之间已经有导线了';
export const SELF_LOOP = '导线两端在这个器件的两个脚上，会短路';
/** W12：点器件本体只提示一次，给出该点的中文引脚名。 */
export const PIN_HINT = '请点它的引脚（基极 / 集电极 / 发射极）';
export const TEXT_HINT = '这是标注，不是电气点';

/** 按器件种类给更具体的引脚提示；三条都含「请点它的引脚」。 */
export function bodyHint(nodeKind?: string): string {
  if (nodeKind === 'npn' || nodeKind === 'pnp') return PIN_HINT;
  if (nodeKind === 'nmos' || nodeKind === 'pmos' || nodeKind === 'nmos-r90' || nodeKind === 'pmos-r90') {
    return '请点它的引脚（栅极 / 漏极 / 源极）';
  }
  if (nodeKind === 'res' || nodeKind === 'cap') return '请点它的引脚（电阻有端 A / 端 B）';
  if (nodeKind === 'opamp') return '请点它的引脚（同相输入 / 反相输入 / 输出）';
  return PIN_HINT;
}

export const nodeOf = (key: string): string => key.split(':')[0];

/** 同一对锚点是否已经连过（按世界坐标无序比较，也认显式 key 的 from/to）。 */
function alreadyConnected(graph: CanvasGraph, a: { x: number; y: number; key: string }, b: { x: number; y: number; key: string }): boolean {
  const same = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2) < 0.6;
  for (const edge of graph.edges) {
    const keys = [edge.from, edge.to];
    if (keys.includes(a.key) && keys.includes(b.key)) return true;
    const ends = edgeEnds(graph, edge);
    if (
      (same(ends.fromXY[0], ends.fromXY[1], a.x, a.y) && same(ends.toXY[0], ends.toXY[1], b.x, b.y)) ||
      (same(ends.fromXY[0], ends.fromXY[1], b.x, b.y) && same(ends.toXY[0], ends.toXY[1], a.x, a.y))
    ) {
      return true;
    }
  }
  return false;
}

/** 电路：两个引脚 key（如 `n-vs:p`、`n-rl:b`）。 */
export function validateWire(graph: CanvasGraph, fromKey: string, toKey: string): WireVerdict {
  const a = findAnchor(graph, fromKey);
  const b = findAnchor(graph, toKey);
  if (!a || !b) return { ok: false, reason: '引脚不在当前画布上，先恢复骨架或重新点。' };
  if (fromKey === toKey) return { ok: false, reason: SAME_POINT };
  // rail 端点的 nodeId 是「几何最近的器件」，不是它自己的电气节点：
  // 拿它和该器件的引脚相比不算自环（W12 让汇流条也能被点来连线）。
  if (a.nodeId === b.nodeId && a.kind !== 'rail' && b.kind !== 'rail') return { ok: false, reason: SELF_LOOP };
  if (alreadyConnected(graph, a, b)) return { ok: false, reason: DUPLICATE_WIRE };
  return { ok: true, op: { op: 'addEdge', from: fromKey, to: toKey, kind: 'wire' } };
}

/** 力学：两个结点 id（S5 的 n-A / n-B / n-C）。
 *  `element` 由调用方给（PICKS[templateId].element）：弯曲题（M3/M4/M5）落 beam，
 *  桁架 / 杆系（S5/M1/M2/M7）保持 truss（轴力杆）—— 巡检 A1：画布两次点击
 *  加杆 previously 硬编码 truss，弯曲题里自建的梁全被当桁架杆，跨中挂集中力
 *  直接被拒，整块内力输出静默消失。 */
export function validateMember(
  graph: CanvasGraph,
  fromNode: string,
  toNode: string,
  enforceStatic = true,
  element?: 'beam' | 'bar' | 'shaft' | 'truss',
): WireVerdict {
  const joints = graph.nodes.filter((node) => node.kind === 'dot');
  const members = graph.edges.filter((edge) => edge.kind === 'line' || edge.kind === 'trussMember');
  if (fromNode === toNode || !joints.some((node) => node.id === fromNode) || !joints.some((node) => node.id === toNode)) {
    return { ok: false, reason: SAME_POINT };
  }
  const duplicate = graph.edges.some(
    (edge) =>
      (edge.from === fromNode && edge.to === toNode) || (edge.from === toNode && edge.to === fromNode),
  );
  if (duplicate) return { ok: false, reason: '这两个节点之间已经有杆了' };
  const max = 2 * joints.length - 3;
  // 梁段（M3 等）没有桁架静定判据，只管零长与重复；桁架才卡 m ≤ 2j−3。
  if (enforceStatic && members.length + 1 > max) {
    return { ok: false, reason: `再加一根就超过静定桁架 m = 2j−3 = ${max}；先删掉一根构件，或换题型。` };
  }
  // 落图的构件种类：给 element 就按它（弯曲题落 beam、桁架 / 杆系落 truss）；
  // 没给就按图里已有构件推断（有 beam/shaft → beam），全 trussMember / 空图退 truss。
  const memberKind: 'beam' | 'truss' =
    element === 'beam' ? 'beam' : element === 'truss' || element === 'bar' || element === 'shaft' ? 'truss' : graph.edges.some((edge) => edge.kind === 'beam' || edge.kind === 'shaft') ? 'beam' : 'truss';
  return { ok: true, op: { op: 'addMember', from: fromNode, to: toNode, kind: memberKind } };
}

export function validateConnection(
  graph: CanvasGraph,
  fromKey: string,
  toKey: string,
  element?: 'beam' | 'bar' | 'shaft' | 'truss',
): WireVerdict {
  return graph.family === 'beam'
    ? validateMember(graph, nodeOf(fromKey), nodeOf(toKey), undefined, element)
    : validateWire(graph, fromKey, toKey);
}
