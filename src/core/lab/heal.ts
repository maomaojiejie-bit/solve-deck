/**
 * W17-A 删除即合并（dc 拓扑修复）。
 *
 * 用户的心智是「删一个串联电阻 = 两端接上」，不是「电路断开，请自己重连」。
 * deleteDevice 之后跑一次 healAfterDeviceDelete：
 *
 *  | 被删的东西                         | 处理 |
 *  | 串联器件（两端网络除它以外无路径） | 合并 A、B：补一条直连导线，两条断头变一条 |
 *  | 一端接 gnd / 电源轨的负载型器件    | 不合并（合并 = 信号网短到地），只记「负载支路开路」 |
 *  | 两端都有别的路径的并联器件         | 不合并，删完图仍连通 |
 *  | 力学族杆件                         | 节点不合并（节点是自由度载体），deleteMember 自己处理 |
 *
 * 三条硬规则（任何一条不满足就不合并，退回断头 + 人话提示）：
 *  1. A !== B（同网器件本来就并联，无可合并）；
 *  2. 合并后 gnd 不与其它网络相撞（{gnd} 与任何非 gnd 网合并 → 拒绝）；
 *  3. 合并后不出现电压源被判短（同 netSolve 的 shortVSource / vSourceLoop 判据）。
 *
 * 合并的实现走几何层：给两侧网络各选一个离被删引脚最近的幸存器件引脚，
 * 补一条 L 形 / 直线导线（owner='shared'）。合并是拓扑层的事，picks.ts 的
 * 归约表一行不改 —— params 里的 0 值由 reduce 读 meta.healedSeries 给出。
 *
 * deleteEdge **不**走合并：删导线 = 断开（W16 语义，check-assemble ㉕① /
 * ㉕④ 与任务 C 的「现状不回退」都押在这上面）；heal 只管器件与杆件。
 */

import { anchorsOfNode, findAnchor } from './pins.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';

/**
 * 变异开关（check:assemble ㉗）：
 *  - mergeSeries=false →「一律不合并」，退回断头（Rs=0 与 Av≈-63.05 两条红）；
 *  - protectGround=false → 允许 gnd 参与合并（gnd 那条红）。
 */
export const HEAL_CONFIG = { mergeSeries: true, protectGround: true };

/** 电气引脚（装饰锚不算）。 */
interface Pin {
  key: string;
  nodeId: string;
  x: number;
  y: number;
}

const TOL = 0.6;

function devicePins(graph: CanvasGraph): Pin[] {
  return graph.nodes
    .filter((node) => node.kind !== 'text' && node.kind !== 'dot' && !node.compositeId && node.kind !== 'block')
    .flatMap((node) =>
      anchorsOfNode(node, graph.family)
        .filter((anchor) => anchor.kind === 'pin')
        .map((anchor) => ({ key: anchor.key, nodeId: node.id, x: anchor.x, y: anchor.y })),
    );
}

/** 边的世界坐标折线（无 points 时解析 from/to：节点 id / `x,y` / 引脚 key）。 */
function polylineOf(graph: CanvasGraph, edge: CanvasEdge): [number, number][] {
  if (edge.points && edge.points.length >= 2) return edge.points;
  const pointOf = (raw: string): [number, number] | null => {
    const node = graph.nodes.find((one) => one.id === raw);
    if (node) return [node.x, node.y];
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
    if (m) return [Number(m[1]), Number(m[2])];
    const anchor = findAnchor(graph, raw);
    return anchor ? [anchor.x, anchor.y] : null;
  };
  const a = pointOf(edge.from);
  const b = pointOf(edge.to);
  return a && b ? [a, b] : [];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function touchesPolyline(points: [number, number][], x: number, y: number): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (segDist(x, y, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]) <= TOL) return true;
  }
  return false;
}

function polylinesTouch(a: [number, number][], b: [number, number][]): boolean {
  for (const [x, y] of a) if (touchesPolyline(b, x, y)) return true;
  for (const [x, y] of b) if (touchesPolyline(a, x, y)) return true;
  return false;
}

/** 并查集：引脚与导线各自一个元素，接触即并。 */
class Union {
  private parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    const root = this.parent.get(id) ?? id;
    if (root === id) return id;
    const top = this.find(root);
    this.parent.set(id, top);
    return top;
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * 引脚级连通性：两个引脚同一网 ⇔ 由导线（含导线间的搭接）连起来。
 * 器件本体不是导线 —— Q 的 c、e 不会因为管子自己在就连通。
 */
function pinNets(graph: CanvasGraph): Map<string, string> {
  const pins = devicePins(graph);
  const wires = graph.edges.map((edge) => polylineOf(graph, edge));
  const uf = new Union();
  pins.forEach((pin) => uf.add(pin.key));
  wires.forEach((_, index) => uf.add(`w${index}`));
  wires.forEach((points, index) => {
    for (const pin of pins) {
      if (touchesPolyline(points, pin.x, pin.y)) uf.union(`w${index}`, pin.key);
    }
  });
  for (let i = 0; i < wires.length; i += 1) {
    for (let j = i + 1; j < wires.length; j += 1) {
      if (polylinesTouch(wires[i], wires[j])) uf.union(`w${i}`, `w${j}`);
    }
  }
  return new Map(pins.map((pin) => [pin.key, uf.find(pin.key)]));
}

/** 器件显示名（label 头部，与 findDevice 的前缀匹配同源）。 */
function displayName(node: CanvasNode): string {
  const text = (node.label ?? '').trim();
  if (!text) return node.id.replace(/^n-/, '');
  const eq = text.indexOf('=');
  const head = (eq >= 0 ? text.slice(0, eq) : text.split(/[\d.]/)[0]).trim();
  return head || node.id;
}

export interface HealOutcome {
  graph: CanvasGraph;
  /** 合并 / 负载开路时替换默认删除规则的人话。 */
  rule?: string;
  merged: boolean;
}

export function healAfterDeviceDelete(pre: CanvasGraph, post: CanvasGraph, victim: CanvasNode): HealOutcome {
  // 力学族：节点是自由度载体，不合并（deleteMember 自己记规则）。
  if (post.family !== 'circuit' || !HEAL_CONFIG.mergeSeries) return { graph: post, merged: false };
  const victimPins = devicePins({ ...pre, nodes: [victim] });
  if (victimPins.length !== 2) return { graph: post, merged: false };

  const preNets = pinNets(pre);
  const sideA = devicePins(pre).filter(
    (pin) => pin.nodeId !== victim.id && preNets.get(pin.key) === preNets.get(victimPins[0].key),
  );
  const sideB = devicePins(pre).filter(
    (pin) => pin.nodeId !== victim.id && preNets.get(pin.key) === preNets.get(victimPins[1].key),
  );
  // 一侧本来就没人（如 Rc 上端只挂 VCC 杠）→ 无可合并，走既有 missing 兜底。
  if (sideA.length === 0 || sideB.length === 0) return { graph: post, merged: false };

  const postNets = pinNets(post);
  const netOf = (pin: Pin) => postNets.get(pin.key);
  // 硬规则 1：删掉后两侧仍连通（并联器件）→ 不合并，照常求解。
  const postA = sideA.filter((pin) => devicePins(post).some((one) => one.key === pin.key));
  const postB = sideB.filter((pin) => devicePins(post).some((one) => one.key === pin.key));
  const stillConnected = postA.some((a) => postB.some((b) => netOf(a) !== undefined && netOf(a) === netOf(b)));
  if (stillConnected) return { graph: post, merged: false };

  const name = displayName(victim);
  // 硬规则 2：{gnd} 与任何非 gnd 网合并 → 拒绝（负载型：Rl / Re / Rss / 旁路电容）。
  const hasGnd = (side: Pin[]) => side.some((pin) => post.nodes.find((one) => one.id === pin.nodeId)?.kind === 'gnd');
  if (HEAL_CONFIG.protectGround && hasGnd(postA) !== hasGnd(postB)) {
    return {
      graph: post,
      merged: false,
      rule: `已删除负载 ${name}：一端接地 / 电源轨，负载支路开路（另一端仍挂在信号网上）`,
    };
  }

  // 硬规则 3：合并后不出现电压源被判短（同 netSolve 的 shortVSource / vSourceLoop）。
  // 按引脚 key 判断（不是 nodeId —— 一只源的两个引脚本来就是同一个 nodeId）。
  const unionKeys = new Set([...postA, ...postB].map((pin) => pin.key));
  const vsrcPins = devicePins(post).filter((pin) => post.nodes.find((one) => one.id === pin.nodeId)?.kind === 'vsrc');
  const byDevice = new Map<string, Pin[]>();
  for (const pin of vsrcPins) {
    byDevice.set(pin.nodeId, [...(byDevice.get(pin.nodeId) ?? []), pin]);
  }
  for (const [id, pins] of byDevice) {
    if (pins.length >= 2 && pins.every((pin) => unionKeys.has(pin.key))) {
      return { graph: post, merged: false, rule: `已删除 ${name}：合并会把电压源「${id}」两端接到同一电气点（短路），不合并` };
    }
  }
  const inUnion = [...byDevice.entries()].filter(([, pins]) => pins.some((pin) => unionKeys.has(pin.key)));
  for (let i = 0; i < inUnion.length; i += 1) {
    for (let j = i + 1; j < inUnion.length; j += 1) {
      const otherOf = (pins: Pin[]) => pins.find((pin) => !unionKeys.has(pin.key));
      const otherA = otherOf(inUnion[i][1]);
      const otherB = otherOf(inUnion[j][1]);
      if (otherA && otherB && netOf(otherA) !== undefined && netOf(otherA) === netOf(otherB)) {
        return { graph: post, merged: false, rule: `已删除 ${name}：合并会让两只电压源成环（无定义），不合并` };
      }
    }
  }

  // 合并：两侧各取离被删引脚最近的幸存引脚，补一条直连导线。
  const nearest = (side: Pin[], to: Pin): Pin =>
    side.reduce((best, pin) => (Math.hypot(pin.x - to.x, pin.y - to.y) < Math.hypot(best.x - to.x, best.y - to.y) ? pin : best));
  const pa = nearest(postA, victimPins[0]);
  const pb = nearest(postB, victimPins[1]);
  let id = `e-heal-1`;
  for (let i = 2; post.edges.some((edge) => edge.id === id); i += 1) id = `e-heal-${i}`;
  const points: [number, number][] =
    pa.x === pb.x || pa.y === pb.y
      ? [
          [pa.x, pa.y],
          [pb.x, pb.y],
        ]
      : [
          [pa.x, pa.y],
          [pa.x, pb.y],
          [pb.x, pb.y],
        ];
  const wire: CanvasEdge = { id, from: pa.key, to: pb.key, kind: 'wire', points, owner: 'shared' };
  const healedNames = String(post.meta.healedSeries ?? '')
    .split(',')
    .filter(Boolean);
  if (!healedNames.includes(name.toUpperCase())) healedNames.push(name.toUpperCase());
  const graph: CanvasGraph = {
    ...post,
    edges: [...post.edges, wire],
    meta: { ...post.meta, healedSeries: healedNames.join(',') },
  };
  return {
    graph,
    merged: true,
    rule: `已删除器件「${name}」：串联在信号链上，两端合并（${displayName(post.nodes.find((one) => one.id === pa.nodeId) ?? victim)} 直连 ${displayName(post.nodes.find((one) => one.id === pb.nodeId) ?? victim)}）`,
  };
}
