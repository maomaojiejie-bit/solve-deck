/**
 * 引脚几何与导线重算（W10-B）。
 *
 * 唯一真相是 `src/render/symbols.ts` 的积木表：引脚局部坐标 + 节点 rot →
 * 世界坐标。这里不复制任何一份引脚表，避免「改了 svg 接法、画布还指老位置」。
 *
 * relayout 的语义：拖动只改节点坐标，**pointerup 时**才把每条导线的首末点
 * 重新吸附到锚点的最新坐标，中间折点按两端位移线性插值平移。这样拖完每条
 * edge.points 的两端仍严格落在引脚上（误差 0），拖动过程中不重算、不抖。
 */

import { SYMBOLS } from '../../render/symbols.ts';
import { allComposites, portPins } from './composite.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';

export interface Anchor {
  /** `${nodeId}:${pinId}`，无引脚的结点用 `${nodeId}:center`，汇流条端点用 `${edgeId}:from|to`。 */
  key: string;
  nodeId: string;
  x: number;
  y: number;
  /** pin = 器件引脚；node = 结点中心；rail = 布局画的汇流条端点（跟着所属节点移动）。 */
  kind: 'pin' | 'node' | 'rail';
  /** rail 锚点归属的节点（取几何上最近的一个），拖动时按它的位移平移。 */
  ownerNodeId?: string;
}

/** 局部坐标按节点 rot（顺时针 90° 整数倍）旋转到世界坐标。 */
export function rotateLocal(x: number, y: number, rot = 0): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

/** 一个节点的所有可连接锚点。力学节点 / dot / gnd 用中心点；复合器件用端口引脚。 */
export function anchorsOfNode(node: CanvasNode, family: CanvasGraph['family'] = 'circuit'): Anchor[] {
  // W13：复合器件的引脚 = 定义里的端口（block 图元两侧），不是 SYMBOLS.block 的固定三脚。
  if (node.compositeId) {
    const def = allComposites()[node.compositeId];
    if (def) {
      return portPins(def).map((pin) => ({
        key: `${node.id}:${pin.id}`,
        nodeId: node.id,
        x: node.x + pin.x,
        y: node.y + pin.y,
        kind: 'pin' as const,
      }));
    }
  }
  const def = SYMBOLS[node.kind];
  const pins = family === 'beam' ? [] : def?.pins ?? [];
  if (pins.length === 0) {
    if (node.kind === 'text') return [];
    return [{ key: `${node.id}:center`, nodeId: node.id, x: node.x, y: node.y, kind: 'node' as const }];
  }
  return pins.map((pin) => {
    const [dx, dy] = rotateLocal(pin.x, pin.y, node.rot ?? 0);
    return {
      key: `${node.id}:${pin.id}`,
      nodeId: node.id,
      x: node.x + dx,
      y: node.y + dy,
      kind: 'pin' as const,
    };
  });
}

/**
 * 全部可吸附端点 = 器件引脚 + 结点中心 + 汇流条端点。
 *
 * 快照里不少导线的端点并不在器件脚上（例如 A3 的地轨 160,470、输出端 762,164
 * 都是布局画出来的汇流条端点）。这些点也必须算锚点，否则拖动后「每条边的
 * 端点仍落在锚点上」只对一半边成立。它们按几何最近归属到一个节点。
 */
export function anchorsOf(graph: CanvasGraph): Anchor[] {
  const primary = graph.nodes.flatMap((node) => anchorsOfNode(node, graph.family));
  const rails: Anchor[] = [];
  for (const edge of graph.edges) {
    if (!edge.points || edge.points.length < 2) continue;
    ([['from', edge.points[0]], ['to', edge.points[edge.points.length - 1]]] as const).forEach(([side, [x, y]]) => {
      // 端点若已和某个引脚 / 结点重合，就不必再造一个 rail 锚点。
      if (primary.some((anchor) => Math.hypot(anchor.x - x, anchor.y - y) < 0.6)) return;
      let owner = graph.nodes[0];
      let best = Infinity;
      for (const node of graph.nodes) {
        if (node.kind === 'text') continue;
        const d = Math.hypot(node.x - x, node.y - y);
        if (d < best) {
          best = d;
          owner = node;
        }
      }
      rails.push({
        key: `${edge.id}:${side}`,
        nodeId: owner?.id ?? edge.id,
        x,
        y,
        kind: 'rail',
        ownerNodeId: owner?.id,
      });
    });
  }
  return [...primary, ...rails];
}

/** 画布上要画成可点圆点的锚点（电路：器件引脚 + 结点 + 汇流条端点；力学：结点）。
 *
 * W12：rail 端点也变成可点连接点。与器件脚距离 < 14px 的 rail 不再画圆点
 * （否则两个热区叠在一起会抢点击），但它仍在 anchorsOf 里参与吸附与重算。
 */
export function clickableAnchors(graph: CanvasGraph): Anchor[] {
  if (graph.family === 'beam') {
    return graph.nodes
      .filter((node) => node.kind === 'dot')
      .map((node) => ({ key: `${node.id}:center`, nodeId: node.id, x: node.x, y: node.y, kind: 'node' as const }));
  }
  const primary = graph.nodes
    .filter((node) => node.kind !== 'text')
    .flatMap((node) => anchorsOfNode(node, graph.family));
  const rails = anchorsOf(graph).filter(
    (anchor) => anchor.kind === 'rail' && !primary.some((pin) => Math.hypot(pin.x - anchor.x, pin.y - anchor.y) < 14),
  );
  // W22-D F7：轨端点常是多条线的公共结点（A3 的 e-gnd-rail:from 与 e-vs-gnd:to
  // 同坐标叠放）—— 两个 data-pin 圆叠在一起互相遮挡，点谁都是 covered。
  // 一个电气点只留一个引脚：同点（0.6 内）保留先到的（器件脚优先，先到的轨端点优先）。
  const merged: Anchor[] = [];
  for (const anchor of [...primary, ...rails]) {
    if (merged.some((one) => Math.hypot(one.x - anchor.x, one.y - anchor.y) < 0.6)) continue;
    merged.push(anchor);
  }
  return merged;
}

export function findAnchor(graph: CanvasGraph, key: string): Anchor | undefined {
  return anchorsOf(graph).find((anchor) => anchor.key === key);
}

/** 找离 (x,y) 最近的锚点；tol 之外返回 undefined。 */
export function snapAnchor(graph: CanvasGraph, x: number, y: number, tol = 0.6): Anchor | undefined {
  let best: Anchor | undefined;
  let bestDist = Infinity;
  for (const anchor of anchorsOf(graph)) {
    const d = Math.hypot(anchor.x - x, anchor.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = anchor;
    }
  }
  return bestDist <= tol ? best : undefined;
}

/** 一条边的两个端点（有 points 用 points 首尾，否则用 from/to 锚点）。 */
export function edgeEnds(graph: CanvasGraph, edge: CanvasEdge): { from?: Anchor; to?: Anchor; fromXY: [number, number]; toXY: [number, number] } {
  let fromXY: [number, number];
  let toXY: [number, number];
  if (edge.points && edge.points.length >= 2) {
    fromXY = [edge.points[0][0], edge.points[0][1]];
    toXY = [edge.points[edge.points.length - 1][0], edge.points[edge.points.length - 1][1]];
  } else {
    const a = findAnchor(graph, edge.from);
    const b = findAnchor(graph, edge.to);
    fromXY = a ? [a.x, a.y] : [0, 0];
    toXY = b ? [b.x, b.y] : [0, 0];
  }
  return {
    from: snapAnchor(graph, fromXY[0], fromXY[1]),
    to: snapAnchor(graph, toXY[0], toXY[1]),
    fromXY,
    toXY,
  };
}

/** 8px 网格吸附。 */
export const snapGrid = (value: number): number => Math.round(value / 8) * 8;

/** 夹回画布边界（用拖动前那张图的 viewBox 范围，留 16px 内边距）。 */
export function clampToCanvas(graph: CanvasGraph, x: number, y: number): [number, number] {
  const xs = graph.nodes.map((node) => node.x);
  const ys = graph.nodes.map((node) => node.y);
  for (const edge of graph.edges) {
    for (const [px, py] of edge.points ?? []) {
      xs.push(px);
      ys.push(py);
    }
  }
  const minX = Math.min(...xs) - 76;
  const maxX = Math.max(...xs) + 76;
  const minY = Math.min(...ys) - 76;
  const maxY = Math.max(...ys) + 76;
  return [
    Math.min(Math.max(x, minX + 16), maxX - 16),
    Math.min(Math.max(y, minY + 16), maxY - 16),
  ];
}

/**
 * 拖动后重算全部 edge.points。
 *
 * `before` = 拖动开始那张图（节点坐标与 points 都自洽），`after` = 只改了
 * 节点坐标的图。先把 before 的每个端点吸附到锚点 key，再查 after 里同一个
 * key 的新坐标；中间折点按首末位移插值平移。没有 points 的边不动。
 */
export function relayout(before: CanvasGraph, after: CanvasGraph): CanvasEdge[] {
  const anchorsAfter = new Map(anchorsOf(after).map((anchor) => [anchor.key, anchor]));
  return after.edges.map((edge, index) => {
    const old = before.edges[index];
    if (!edge.points || edge.points.length < 2 || !old?.points || old.points.length < 2) return edge;
    const start = snapAnchor(before, old.points[0][0], old.points[0][1]);
    const end = snapAnchor(before, old.points[old.points.length - 1][0], old.points[old.points.length - 1][1]);
    const oldFrom: [number, number] = [old.points[0][0], old.points[0][1]];
    const oldTo: [number, number] = [old.points[old.points.length - 1][0], old.points[old.points.length - 1][1]];
    const nodeDelta = (ownerNodeId?: string): [number, number] => {
      const b = before.nodes.find((node) => node.id === ownerNodeId);
      const a = after.nodes.find((node) => node.id === ownerNodeId);
      return b && a ? [a.x - b.x, a.y - b.y] : [0, 0];
    };
    const resolve = (anchor: Anchor | undefined, oldXY: [number, number]): [number, number] => {
      if (!anchor) return oldXY;
      if (anchor.kind === 'rail') {
        const [dx, dy] = nodeDelta(anchor.ownerNodeId);
        return [oldXY[0] + dx, oldXY[1] + dy];
      }
      const fresh = anchorsAfter.get(anchor.key);
      return fresh ? [fresh.x, fresh.y] : oldXY;
    };
    const from = resolve(start, oldFrom);
    const to = resolve(end, oldTo);
    const dxFrom = from[0] - oldFrom[0];
    const dyFrom = from[1] - oldFrom[1];
    const dxTo = to[0] - oldTo[0];
    const dyTo = to[1] - oldTo[1];
    const count = old.points.length;
    const points = old.points.map(([px, py], i) => {
      if (i === 0) return from;
      if (i === count - 1) return to;
      const t = count > 2 ? i / (count - 1) : 0;
      return [px + dxFrom * (1 - t) + dxTo * t, py + dyFrom * (1 - t) + dyTo * t] as [number, number];
    });
    // from/to 原样保留：力学边靠 `from/to` 指向节点 id（graphToBeam 要用），
    // 电路边有 points 就够（graphToModel 用 points 首尾吸附），一律不改写端点引用。
    return { ...edge, points };
  });
}
