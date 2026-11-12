/**
 * W17-C 物件与杆分开选：左栏分组、选中互斥、画布命中的**核心契约**。
 *
 * 页面（Lab.tsx 左栏 + 选中条）和门禁（check-assemble ㉘）读同一份函数 ——
 * 门禁走 UI 动作序列后断言行数与选中行为，不直接戳 DOM。
 *
 * 分组语义（力学族）：
 *  - 物件（nodes）：结点、支座（固定铰 / 可动铰 / 固定端）、集中力 / 均布 / 力偶；
 *  - 杆（members）：桁架杆 / 梁段，可改 A / I / E、可删。
 * 电路族沿用「器件 / 导线」两组（W16 已分开，这里只补同款选中互斥）。
 */

import { anchorsOfNode } from './pins.ts';
import { SUPPORT_LABEL, isJoint, supportRefs } from './attach.ts';
import type { CanvasGraph } from './types.ts';

/**
 * 变异开关（check-assemble ㉘ 变异）：membersSeparate=false → 把杆的行挪回
 * 「器件」组（S5 行数断言红）。
 */
export const INSPECT_CONFIG = { membersSeparate: true };

export interface InspectRow {
  id: string;
  /** 行主名：`A` / `固定铰` / `P = 10 kN`。 */
  name: string;
  /** 行类型词：`节点` / `固定铰` / `集中力` / `桁架杆` / `梁段`。 */
  kindLabel: string;
  /**
   * R3-1 A1：子行挂在哪个结点下面（支座行）。支座是结点属性，不是独立物件 ——
   * 行照旧显示（看得见约束），但选中 / 删除都落到结点上，id 只是渲染用的图元 id。
   */
  parentId?: string;
}

const LOAD_LABEL: Record<string, string> = {
  arrow: '集中力',
  udl: '均布载荷',
  momentArrow: '力偶',
  torqueArrow: '扭矩',
};

const nodeShortName = (id: string, label: string | undefined): string => {
  const text = (label ?? '').trim();
  if (text) return text;
  return id.replace(/^n-/, '').toUpperCase();
};

/**
 * 力学族「物件」组：结点（含它上面的支座子行）与载荷，画布顺序。
 * 支座不再是独立物件：它跟着结点走，所以行也就跟着结点那一行 —— 子行只能
 * 「看清这个点有什么约束」，选中 / 删除都落到结点上。
 */
export function beamObjectRows(graph: CanvasGraph): InspectRow[] {
  const rows: InspectRow[] = [];
  const supports = supportRefs(graph).filter((ref) => !ref.nodeForm);
  for (const node of graph.nodes) {
    if (node.kind === 'text') continue;
    rows.push({
      id: node.id,
      name: nodeShortName(node.id, node.label),
      kindLabel: SUPPORT_LABEL[node.kind] ?? LOAD_LABEL[node.kind] ?? (isJoint(node) ? '节点' : '物件'),
    });
    const support = supports.find((ref) => ref.jointId === node.id);
    if (support) {
      rows.push({
        id: support.id,
        name: support.label || SUPPORT_LABEL[support.kind] || '支座',
        kindLabel: '支座',
        parentId: node.id,
      });
    }
  }
  return rows;
}

/** 力学族「杆」组：全部杆 / 梁，画布顺序。 */
export function beamMemberRows(graph: CanvasGraph): InspectRow[] {
  if (!INSPECT_CONFIG.membersSeparate) return [];
  return graph.edges.map((edge) => ({
    id: edge.id,
    name: edge.id.replace(/^e-/, '').toUpperCase(),
    kindLabel: edge.kind === 'beam' || edge.kind === 'shaft' ? '构件' : '桁架杆',
  }));
}

/** membersSeparate=false 的变异形态：杆混回物件组（供门禁断言变红）。 */
export function beamCollapsedRows(graph: CanvasGraph): InspectRow[] {
  return [...beamObjectRows(graph), ...beamMemberRows(graph)];
}

/** 电路族「器件」组（text / dot 除外）。 */
export function circuitDeviceRows(graph: CanvasGraph): InspectRow[] {
  return graph.nodes
    .filter((node) => !['text', 'dot'].includes(node.kind))
    .map((node) => ({
      id: node.id,
      name: (node.label ?? '').trim() || node.kind,
      kindLabel: node.kind.toUpperCase(),
    }));
}

/** 电路族「导线」组。 */
export function circuitWireRows(graph: CanvasGraph): InspectRow[] {
  return graph.edges.map((edge) => ({ id: edge.id, name: edge.id, kindLabel: '导线' }));
}

/* ── 选中互斥：同一时刻只有一个选择 ─────────────────────────────── */

export type SelectionKind = 'device' | 'wire' | 'member' | 'object';
export interface Selection {
  kind: SelectionKind;
  id: string;
}

/** 再点同一个 = 取消；点别的 = 换选（跨组也互斥）。 */
export function selectTarget(current: Selection | null, target: Selection | null): Selection | null {
  if (!target) return null;
  if (current && current.kind === target.kind && current.id === target.id) return null;
  return target;
}

/** 选中条文案（页面与门禁同源）：「已选：物件 A · 固定铰」/「已选：杆 AC」。 */
export function selectionText(selection: Selection | null, graph: CanvasGraph): string {
  if (!selection) return '';
  if (selection.kind === 'member') {
    const edge = graph.edges.find((one) => one.id === selection.id);
    return `已选：杆 ${edge ? edge.id.replace(/^e-/, '').toUpperCase() : selection.id}`;
  }
  if (selection.kind === 'wire') return `已选：导线 ${selection.id}`;
  if (selection.kind === 'device') {
    const node = graph.nodes.find((one) => one.id === selection.id);
    return `已选：器件 ${(node?.label ?? '').trim() || selection.id}`;
  }
  const node = graph.nodes.find((one) => one.id === selection.id);
  const name = nodeShortName(selection.id, node?.label);
  const kindLabel = node ? SUPPORT_LABEL[node.kind] ?? LOAD_LABEL[node.kind] ?? '节点' : '物件';
  return `已选：物件 ${name} · ${kindLabel}`;
}

/* ── 画布命中（几何层契约；SpecGrid 的 DOM 热区与其同判据） ──────── */

export type HitKind = 'pin' | 'node' | 'member' | 'wire' | 'blank';
export interface CanvasHit {
  kind: HitKind;
  /** pin → 引脚 key（`n-q:b`）；node → 节点 id；member/wire → 边 id。 */
  id: string;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function edgePoints(graph: CanvasGraph, edge: { from: string; to: string; points?: [number, number][] }): [number, number][] {
  if (edge.points && edge.points.length >= 2) return edge.points;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const a = byId.get(edge.from);
  const b = byId.get(edge.to);
  return a && b ? [
    [a.x, a.y],
    [b.x, b.y],
  ] : [];
}

/**
 * 世界坐标命中测试：节点圆点（8 世界单位）→ 杆 / 导线线体（6 容差，与
 * SpecGrid 的 6px 线体热区一致）→ 空白。电路族引脚圆点优先于导线。
 */
export function hitTest(graph: CanvasGraph, x: number, y: number): CanvasHit {
  const family = graph.family;
  // 1) 引脚（电路）优先
  if (family === 'circuit') {
    for (const node of graph.nodes) {
      if (node.kind === 'text' || node.kind === 'dot') continue;
      for (const anchor of anchorsOfNode(node, family)) {
        if (anchor.kind !== 'pin') continue;
        if (Math.hypot(anchor.x - x, anchor.y - y) <= 8) return { kind: 'pin', id: anchor.key };
      }
    }
  }
  // 2) 节点圆点
  for (const node of graph.nodes) {
    if (node.kind === 'text') continue;
    if (Math.hypot(node.x - x, node.y - y) <= 8) return { kind: 'node', id: node.id };
  }
  // 3) 杆 / 导线线体
  for (const edge of graph.edges) {
    const points = edgePoints(graph, edge);
    for (let i = 0; i + 1 < points.length; i += 1) {
      if (segDist(x, y, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]) <= 6) {
        return { kind: family === 'beam' ? 'member' : 'wire', id: edge.id };
      }
    }
  }
  return { kind: 'blank', id: '' };
}
