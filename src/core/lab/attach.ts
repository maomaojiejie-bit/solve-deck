/**
 * R3-1 · 「点在哪儿」的唯一答案：支座是**结点属性**，载荷有**明确位置与方向**。
 *
 * 三个 P0 的症状都出在「同一个位置存了两份坐标」：
 *  - H-01 新加的支座与结点同坐标 → 两个热区叠在一起，结点再也点不到、连不了杆；
 *  - H-02 支座是独立图元 → 能单独拖走、单独删掉，脱离结构还能算；
 *  - H-06 删结点不连带 → 结点没了，支座 / 载荷还浮在原地。
 *
 * 本模块的模型：
 *  - `CanvasNode.support = { type, id, label? }`：支座挂在结点上，坐标**只有一份**
 *    （读结点的 x/y）；删结点 → 支座随结点消失，不可能悬空；
 *  - 旧快照（35 份不许改）读入时由 `foldSupports` 把 `pinSupport`/`rollerSupport`/
 *    `fixedSupport` 图元折叠成属性；**折叠不到结点上的（旧分享链接 / 手改数据）
 *    保留成图元节点**，仍由 resolve 的 supportOffJoint 判 U —— 不静默吸附、不假装合法；
 *  - 渲染时 `supportSpecNodes` 把属性展开回图元（id / 坐标 / 标签与旧快照逐字一致），
 *    所以 35 份快照、截图与既有门禁看到的图没有变化。
 *
 * 门禁：scripts/check-attach.mjs（七条 + 一变异）。变异位 = ATTACH_CONFIG.preferSelection：
 * 关掉 → 加支座退回「猜第一个 dot」（H-01 的老行为），① 必红。
 */

import type { CanvasGraph, CanvasNode, SupportType } from './types.ts';

/**
 * 变异开关：
 *  - fold：折叠旧支座图元（关掉 = 保留独立支座节点，① 红）
 *  - preferSelection：加物件只认选中结点（关掉 = 回退「第一个 dot」的老行为，① 红）
 *  - cascade：删结点连带删支座 / 载荷（关掉 = 留下孤儿，③ 红）
 *  - tolerance：折叠 / 挂靠的共点容差（0.6px，与 pins.snapAnchor 同档）
 */
export const ATTACH_CONFIG = { fold: true, preferSelection: true, cascade: true, tolerance: 0.6 };

export const SUPPORT_TYPE_OF: Record<string, SupportType> = {
  pinSupport: 'pin',
  rollerSupport: 'roller',
  fixedSupport: 'fixed',
};

export const SUPPORT_KIND_OF: Record<SupportType, string> = {
  pin: 'pinSupport',
  roller: 'rollerSupport',
  fixed: 'fixedSupport',
};

export const SUPPORT_LABEL: Record<string, string> = {
  pinSupport: '固定铰',
  rollerSupport: '可动铰',
  fixedSupport: '固定端',
};

/** 力学图里的结点：自由度载体。支座只能挂在这两种 kind 上。 */
export function isJoint(node: CanvasNode): boolean {
  return node.kind === 'dot' || node.kind === 'pin';
}

/** 支座引用：结点属性与旧形态图元在这里被抹平成同一种东西。 */
export interface SupportRef {
  /** 图元 id（渲染 / 门禁用）。属性形态用存下来的 id（旧快照就是 n-sup-A）。 */
  id: string;
  /** 图元种类（pinSupport / rollerSupport / fixedSupport）。 */
  kind: string;
  type: SupportType;
  /** 挂在哪个结点；null = 旧形态孤儿（折叠不到结点上）。 */
  jointId: string | null;
  x: number;
  y: number;
  label: string;
  labelSide: 'up' | 'down' | 'left' | 'right';
  /** 折叠前的图元位置（渲染顺序用）；旧形态图元没有。 */
  order?: number;
  /** true = 仍是 graph.nodes 里的图元（旧形态），false = 结点属性。 */
  nodeForm: boolean;
}

function nearestJoint(joints: CanvasNode[], x: number, y: number): { joint: CanvasNode; d: number } | null {
  let best: { joint: CanvasNode; d: number } | null = null;
  for (const joint of joints) {
    const d = Math.hypot(joint.x - x, joint.y - y);
    if (!best || d < best.d) best = { joint, d };
  }
  return best;
}

/**
 * 一张图上的全部支座（两种形态都算）。顺序：先结点属性（画布顺序），再旧形态图元。
 * picks 的「恰好一个固定铰 + 一个可动铰」、frameSolve 的约束、resolve 的钉结点判据
 * 全部读这一份 —— 单一来源，不会出现「渲染有支座、求解没支座」。
 */
export function supportRefs(graph: CanvasGraph): SupportRef[] {
  const refs: SupportRef[] = [];
  for (const node of graph.nodes) {
    if (!node.support) continue;
    const kind = SUPPORT_KIND_OF[node.support.type];
    refs.push({
      id: node.support.id ?? `${node.id}:support`,
      kind,
      type: node.support.type,
      jointId: node.id,
      x: node.x,
      y: node.y,
      label: node.support.label ?? SUPPORT_LABEL[kind] ?? '',
      labelSide: node.support.labelSide ?? 'down',
      ...(node.support.order !== undefined ? { order: node.support.order } : {}),
      nodeForm: false,
    });
  }
  const joints = graph.nodes.filter(isJoint);
  for (const node of graph.nodes) {
    const type = SUPPORT_TYPE_OF[node.kind];
    if (!type) continue;
    const near = nearestJoint(joints, node.x, node.y);
    refs.push({
      id: node.id,
      kind: node.kind,
      type,
      jointId: near && near.d <= ATTACH_CONFIG.tolerance ? near.joint.id : null,
      x: node.x,
      y: node.y,
      label: node.label ?? SUPPORT_LABEL[node.kind] ?? '',
      labelSide: node.labelSide ?? 'down',
      nodeForm: true,
    });
  }
  return refs;
}

/** 某结点上的支座（没有就是 undefined）。 */
export function supportAt(graph: CanvasGraph, jointId: string): SupportRef | undefined {
  return supportRefs(graph).find((ref) => ref.jointId === jointId);
}

/**
 * 旧形态 → 属性：把与结点共点（≤ tolerance）的支座图元折到结点上并删掉图元。
 * 一个结点最多接一个支座；折叠不到结点的图元**原样保留**（孤儿交给 resolve 判 U）。
 * 幂等：对已经折过的图再跑一次不会有任何变化。
 */
export function foldSupports(graph: CanvasGraph): CanvasGraph {
  if (!ATTACH_CONFIG.fold) return graph;
  const supportNodes = graph.nodes.filter((node) => SUPPORT_TYPE_OF[node.kind]);
  if (supportNodes.length === 0) return graph;
  const nodes = graph.nodes.map((node) => ({
    ...node,
    ...(node.support ? { support: { ...node.support } } : {}),
  }));
  const joints = nodes.filter(isJoint);
  const taken = new Set(nodes.filter((node) => node.support).map((node) => node.id));
  const drop = new Set<string>();
  for (const source of supportNodes) {
    let best: { joint: CanvasNode; d: number } | null = null;
    for (const joint of joints) {
      if (taken.has(joint.id)) continue;
      const d = Math.hypot(joint.x - source.x, joint.y - source.y);
      if (d > ATTACH_CONFIG.tolerance) continue;
      if (!best || d < best.d) best = { joint, d };
    }
    if (!best) continue;
    const target = nodes.find((node) => node.id === best.joint.id);
    if (!target) continue;
    target.support = {
      type: SUPPORT_TYPE_OF[source.kind],
      id: source.id,
      ...(source.label !== undefined ? { label: source.label } : {}),
      ...(source.labelSide !== undefined ? { labelSide: source.labelSide } : {}),
      // 记住原位置：渲染时按它插回去，图层顺序也与快照一致。
      order: nodes.findIndex((node) => node.id === source.id),
    };
    taken.add(target.id);
    drop.add(source.id);
  }
  if (drop.size === 0) return graph;
  return { ...graph, nodes: nodes.filter((node) => !drop.has(node.id)) };
}

/**
 * 属性 → 渲染图元：id / 坐标 / 标签与旧快照逐字一致，图看起来没有任何变化。
 * 只展开**属性形态**（nodeForm=false）：旧形态孤儿本来就是 graph.nodes 里的图元，
 * 再展开一次会画出两个支座。
 */
export function supportSpecNodes(graph: CanvasGraph): { id: string; x: number; y: number; kind: string; label?: string; labelSide?: 'up' | 'down' | 'left' | 'right'; order?: number }[] {
  return supportRefs(graph)
    .filter((ref) => !ref.nodeForm)
    .map((ref) => ({
      id: ref.id,
      x: ref.x,
      y: ref.y,
      kind: ref.kind,
      ...(ref.label ? { label: ref.label } : {}),
      labelSide: ref.labelSide,
      ...(ref.order !== undefined ? { order: ref.order } : {}),
    }));
}

/* ── A2：加东西一律认选中 ───────────────────────────────────────── */

export interface AddTarget {
  /** 目标结点；null = 没得加。 */
  nodeId: string | null;
  /** 没得加时的人话（按钮 tooltip 与 toast 共用）。 */
  reason: string;
}

/** 当前选中是不是一个结点（物件）。 */
export function selectedJointOf(graph: CanvasGraph, selectionId: string | null | undefined): CanvasNode | null {
  if (!selectionId) return null;
  const node = graph.nodes.find((one) => one.id === selectionId);
  return node && isJoint(node) ? node : null;
}

/**
 * 加支座 / 加载荷的唯一目标入口。**只认选中**：选中的是结点就用它；没选中就拒绝
 * 并给人话（按钮 disabled + tooltip）。preferSelection=false 是变异位 —— 退回
 * 「猜第一个 dot」（H-01 的病根），check:attach ① 必红。
 */
export function addTargetOf(graph: CanvasGraph, selectionId: string | null | undefined): AddTarget {
  const selected = selectedJointOf(graph, selectionId);
  if (selected) return { nodeId: selected.id, reason: '' };
  if (ATTACH_CONFIG.preferSelection) {
    return {
      nodeId: null,
      reason: '先在画布或左栏点一个结点（选中它），再加支座 / 载荷 —— 不许替你猜是哪个点。',
    };
  }
  const first = graph.nodes.find(isJoint);
  return first
    ? { nodeId: first.id, reason: '' }
    : { nodeId: null, reason: '画布上没有结点：先恢复骨架。' };
}

/* ── A3：载荷的位置（t）与方向（↓→↑←） ────────────────────────── */

/** 方向枚举（语义：↓0 / →90 / ↑180 / ←270）。显示与求解都以这里的字面为准。 */
export const LOAD_DIRECTIONS = [0, 90, 180, 270] as const;
export const LOAD_DIR_LABEL: Record<number, string> = { 0: '↓', 90: '→', 180: '↑', 270: '←' };

/**
 * 语义角归一化：↓0 / →90 / ↑180 / ←270，450° 也收成 90°。
 * **GraphOp / 门禁 / UI 只用这一套角**；图元 rot 是 SVG 的事，只在落盘时算一次。
 */
export function normalizeDir(dir: number): number {
  return ((Math.round(dir / 90) * 90) % 360 + 360) % 360;
}

/**
 * 图元 rot → 语义方向角（UI 高亮、门禁读回都用它；这是唯一对外方向 API）。
 * 图元 rot 走 SVG rotate（顺时针，y 向下）：rot90 画成朝左、rot270 画成朝右，
 * 而语义 90 是朝右 —— 所以两者差一个 (360 − x)。
 */
export function rotToDir(rot: number | undefined): number {
  return (360 - normalizeDir(rot ?? 0)) % 360;
}

/** 主跨（唯一的梁 / 轴 / 杆）——载荷 t 的参照物。 */
export function mainSpanOf(graph: CanvasGraph): { id: string; a: CanvasNode; b: CanvasNode } | null {
  const member = graph.edges.find((edge) => ['beam', 'shaft', 'line', 'trussMember'].includes(edge.kind));
  if (!member) return null;
  const a = graph.nodes.find((node) => node.id === member.from);
  const b = graph.nodes.find((node) => node.id === member.to);
  return a && b ? { id: member.id, a, b } : null;
}

/** 跨上相对位置 t∈[0,1]（按 x 投影；竖杆返回 null）。 */
export function tOnSpan(span: { a: CanvasNode; b: CanvasNode }, x: number): number | null {
  const dx = span.b.x - span.a.x;
  if (Math.abs(dx) <= 1e-9) return null;
  return Math.min(1, Math.max(0, (x - span.a.x) / dx));
}

/** t → 画布坐标（沿跨插值，斜杆也落在杆上）。 */
export function pointOnSpan(span: { a: CanvasNode; b: CanvasNode }, t: number): { x: number; y: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: span.a.x + clamped * (span.b.x - span.a.x),
    y: span.a.y + clamped * (span.b.y - span.a.y),
  };
}

/** 载荷位置摘要：结点载荷 → `B`；跨内 → `t=0.50`。 */
export function loadSpotText(graph: CanvasGraph, node: CanvasNode): string {
  if (node.atJoint) {
    const joint = graph.nodes.find((one) => one.id === node.atJoint);
    return joint ? `结点 ${joint.label?.trim() || joint.id.replace(/^n-/, '').toUpperCase()}` : '结点';
  }
  const span = mainSpanOf(graph);
  const t = span ? tOnSpan(span, node.x) : null;
  return t === null ? '跨内' : `t=${t.toFixed(2)}`;
}

/** 载荷标签：`P = 10 kN · t=0.50`（跨内才带 t，结点载荷不加噪）。 */
export function loadLabelOf(name: string, value: number, unit: string, spot: { atJoint?: string; t?: number }): string {
  const head = `${name} = ${Number(value.toPrecision(5))}${unit ? ` ${unit}` : ''}`;
  if (spot.atJoint || spot.t === undefined) return head;
  if (spot.t <= 0 || spot.t >= 1) return head;
  return `${head} · t=${spot.t.toFixed(2)}`;
}
