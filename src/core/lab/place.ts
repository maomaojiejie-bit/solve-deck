/**
 * R3-4 U1 · 智能选点与「一句话定条件」。
 *
 * 这一层只做两件事，且两件都是**纯函数**（门禁能直接驱动，不戳 DOM）：
 *  1. `placeHit(graph, x, y)`：光标落在世界坐标 (x,y) 时，命中的到底是什么 ——
 *     优先级 `pin > 结点 > 杆端 > 杆内 > 物件 > 器件本体 > 空白`，同距时引脚优先
 *     （端点属于器件，不许被杆身抢走；这是 H-01 的病根）。
 *  2. `placePlan(graph, tool, hit, opts)`：在这个命中上按一下，该产出一条什么
 *     `GraphOp`、以及那句人话。位置（t）、方向（dir）、支座类型都由这里定死。
 *
 * 为什么不塞进 `pointer.ts`：那里的 `wireClick` 是「两次点击连线」的 reducer，
 * 它的不变式被 check:labshell / check:assemble 钉住，一个字节都不该动；杆身命中
 * 与连线无关，硬塞进去只会让老 reducer 认识一种它永远不该处理的类型。
 *
 * 变异位（check:pointer ⑦）：
 *  - `PLACE_CONFIG.memberPriority = true` → 杆身抢在引脚 / 结点之前（② 必红）
 *  - `PLACE_CONFIG.tSnap = 0`            → 不做刻度吸附（③ 必红）
 */

import { LOAD_DIR_LABEL, SUPPORT_LABEL, normalizeDir, isJoint, pointOnSpan } from './attach.ts';
import { anchorsOfNode } from './pins.ts';
import { anchorDisplay, deviceName } from './pinNames.ts';
import type { CanvasGraph, CanvasNode, GraphOp, SupportType } from './types.ts';

/**
 * 变异开关 + 全部容差。数字都要有出处：
 * - pinRadius 12 / jointRadius 10：任务书 §1「引脚吸附半径 12，dot 10（junction 比
 *   引脚小，避免抢）」；
 * - memberTol 12：杆身线体容差，比渲染的 6px 热区宽一倍 —— 「点了没反应」多半是
 *   差那一两个像素；
 * - tSnap 6：距刻度 ≤6 世界单位就取刻度值；
 * - grid 20：空白放结点吸 20 网格（比拖动的 8 网格粗，结点是结构点不是像素）；
 * - dragThreshold 8：松手位移小于它按「垂直向下」。
 */
export const PLACE_CONFIG = {
  memberPriority: false,
  tSnap: 6,
  pinRadius: 12,
  jointRadius: 10,
  objectRadius: 14,
  memberTol: 12,
  bodyRadius: 46,
  grid: 20,
  dragThreshold: 8,
  ambiguous: 3,
};

/** 跨内位置吸附到这几个刻度（t=1/3、2/3 是真分数，不是 0.33）。 */
export const T_STOPS: readonly number[] = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];

export type PlaceTool = 'off' | 'point' | 'udl' | 'support' | 'node';

export const PLACE_TOOLS: { tool: PlaceTool; label: string; hint: string }[] = [
  { tool: 'off', label: '选中', hint: '点哪儿选哪儿（拖动结点改位置）' },
  { tool: 'point', label: '集中力', hint: '在杆上按下并朝受力方向拖出，松手即落' },
  { tool: 'udl', label: '均布', hint: '在杆上按一下，落整跨均布 q' },
  { tool: 'support', label: '支座', hint: '点结点换类型（循环）；点杆中切段再加支座' },
  { tool: 'node', label: '结点', hint: '点空白放一个结点（吸 20 网格）' },
];

/** 命中：比 PointerHit 多带坐标与人话（渲染与门禁都读它）。 */
export type PlaceHit =
  | { kind: 'pin'; key: string; x: number; y: number; text: string; dist: number }
  | { kind: 'joint'; id: string; x: number; y: number; text: string; dist: number }
  | { kind: 'member'; edgeId: string; t: number; x: number; y: number; dist: number }
  | { kind: 'object'; id: string; x: number; y: number; text: string; dist: number }
  | { kind: 'body'; id: string; x: number; y: number; text: string; dist: number }
  | { kind: 'blank'; x: number; y: number };

const MEMBER_KINDS = new Set(['beam', 'shaft', 'line', 'trussMember']);
const LOAD_KINDS = new Set(['arrow', 'udl', 'momentArrow', 'torqueArrow']);

export const memberShort = (edgeId: string): string => edgeId.replace(/^e-/, '').replace(/-member-add/, '').toUpperCase();

export const jointShort = (node: CanvasNode): string => {
  const text = (node.label ?? '').trim();
  if (text) return text;
  return node.id.replace(/^n-/, '').toUpperCase();
};

function segProject(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { t: 0, dist: Math.hypot(x - ax, y - ay) };
  const raw = ((x - ax) * dx + (y - ay) * dy) / len2;
  const t = Math.min(1, Math.max(0, raw));
  return { t, dist: Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) };
}

/** 跨内 t 吸附：距刻度 ≤tSnap 世界单位取刻度，否则自由 t（两位、开区间）。 */
export function snapT(graph: CanvasGraph, edgeId: string, raw: number): number {
  const edge = graph.edges.find((one) => one.id === edgeId);
  const a = edge && graph.nodes.find((node) => node.id === edge.from);
  const b = edge && graph.nodes.find((node) => node.id === edge.to);
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const free = Math.min(0.98, Math.max(0.02, Math.round(raw * 100) / 100));
  if (!(PLACE_CONFIG.tSnap > 0) || length <= 0) return free;
  for (const stop of T_STOPS) {
    if (Math.abs(raw - stop) * length <= PLACE_CONFIG.tSnap) {
      // 端点只能落在结点上：跨内载荷不许 t=0 / 1（那是另一个 op 的事）。
      if (stop === 0) return 0.02;
      if (stop === 1) return 0.98;
      return stop;
    }
  }
  return free;
}

/** 空白吸附 20 网格。 */
export function snapBlank(x: number, y: number): { x: number; y: number } {
  const g = PLACE_CONFIG.grid;
  return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
}

interface Candidate {
  hit: PlaceHit;
  rank: number;
  dist: number;
}

const RANK = { pin: 0, joint: 1, member: 2, object: 3, body: 4, blank: 9 } as const;

/**
 * 世界坐标 → 命中。`alt` 取 0 或 1：两个候选距离差 < ambiguous 时，页面按 Tab
 * 在它们之间切换（`placeCandidates` 会把两个都列出来）。
 */
export function placeHit(graph: CanvasGraph, x: number, y: number, alt = 0): PlaceHit {
  const list = placeCandidates(graph, x, y);
  const first = list[0];
  if (!first) return { kind: 'blank', x, y };
  const second = list[1];
  const ambiguous =
    second !== undefined && second.dist - first.dist < PLACE_CONFIG.ambiguous && second.rank !== first.rank;
  if (alt > 0 && ambiguous && second) return second.hit;
  return first.hit;
}

/** 候选列表（按「优先级 → 距离」排序），hover 的 Tab 切换与「差 <3 提示」都读它。 */
export function placeCandidates(graph: CanvasGraph, x: number, y: number): Candidate[] {
  const out: Candidate[] = [];
  const rankOf = (kind: keyof typeof RANK): number =>
    PLACE_CONFIG.memberPriority && kind === 'member' ? -1 : RANK[kind];

  // 1) 引脚（电路族）：端点属于器件，位置最准，永远排最前。
  if (graph.family === 'circuit') {
    for (const node of graph.nodes) {
      if (node.kind === 'text' || node.kind === 'dot') continue;
      for (const anchor of anchorsOfNode(node, 'circuit')) {
        if (anchor.kind !== 'pin') continue;
        const dist = Math.hypot(anchor.x - x, anchor.y - y);
        if (dist > PLACE_CONFIG.pinRadius) continue;
        out.push({
          hit: { kind: 'pin', key: anchor.key, x: anchor.x, y: anchor.y, text: anchorDisplay(graph, anchor).text, dist },
          rank: rankOf('pin'),
          dist,
        });
      }
    }
  }

  // 2) 结点（自由度载体）
  for (const node of graph.nodes) {
    if (!isJoint(node)) continue;
    const dist = Math.hypot(node.x - x, node.y - y);
    if (dist > PLACE_CONFIG.jointRadius) continue;
    out.push({
      hit: { kind: 'joint', id: node.id, x: node.x, y: node.y, text: `结点 ${jointShort(node)}`, dist },
      rank: rankOf('joint'),
      dist,
    });
  }

  // 3) 杆身（投影点 + t 吸附）
  for (const edge of graph.edges) {
    if (!MEMBER_KINDS.has(edge.kind)) continue;
    const a = graph.nodes.find((node) => node.id === edge.from);
    const b = graph.nodes.find((node) => node.id === edge.to);
    if (!a || !b) continue;
    const proj = segProject(x, y, a.x, a.y, b.x, b.y);
    if (proj.dist > PLACE_CONFIG.memberTol) continue;
    const t = snapT(graph, edge.id, proj.t);
    const point = pointOnSpan({ a, b }, t);
    out.push({
      hit: { kind: 'member', edgeId: edge.id, t, x: point.x, y: point.y, dist: proj.dist },
      rank: rankOf('member'),
      dist: proj.dist,
    });
  }

  // 4) 别的物件（载荷 / 支座图元 / 器件本体）
  for (const node of graph.nodes) {
    if (node.kind === 'text' || isJoint(node)) continue;
    const dist = Math.hypot(node.x - x, node.y - y);
    if (LOAD_KINDS.has(node.kind) || node.support) {
      if (dist <= PLACE_CONFIG.objectRadius) {
        out.push({
          hit: { kind: 'object', id: node.id, x: node.x, y: node.y, text: (node.label ?? '').trim() || node.id, dist },
          rank: rankOf('object'),
          dist,
        });
      }
      continue;
    }
    if (graph.family === 'circuit' && dist <= PLACE_CONFIG.bodyRadius) {
      out.push({
        hit: { kind: 'body', id: node.id, x: node.x, y: node.y, text: deviceName(node), dist },
        rank: rankOf('body'),
        dist,
      });
    }
  }

  out.sort((left, right) => left.rank - right.rank || left.dist - right.dist);
  return out;
}

/* ── hover 预告：点下去会发生什么 ─────────────────────────────────── */export interface PlaceGhost {
  /** 光标旁那一行字。 */
  text: string;
  /** 追加提示（`Tab 切换候选`）—— 只有两个候选咬得很近时才出现。 */
  hint?: string;
  point: { x: number; y: number };
  kind: PlaceHit['kind'];
  edgeId?: string;
  t?: number;
  /** 语义方向角（↓0 / →90 / ↑180 / ←270）。 */
  dir?: number;
  /** 候选点（差 <3 时都画虚线环）。 */
  candidates?: { x: number; y: number }[];
  /** 电路本体：可选引脚。 */
  pins?: { key: string; x: number; y: number; label: string }[];
}

export interface PlaceOptions {
  /** 放置器要落的量（集中力 kN / 均布 kN/m）。 */
  value: number;
  /** 集中力方向（语义角）。 */
  dir: number;
}

/** 结点的支座循环：无 → 固定铰 → 可动铰 → 固定端 → 无。 */
export const SUPPORT_CYCLE: (SupportType | null)[] = ['pin', 'roller', 'fixed', null];
export const SUPPORT_CYCLE_HINT = '无 → 固定铰 → 可动铰 → 固定端 → 无';

export function nextSupportType(current: SupportType | undefined): SupportType | null {
  const index = SUPPORT_CYCLE.findIndex((type) => (type ?? undefined) === (current ?? undefined));
  const next = SUPPORT_CYCLE[(index + 1 + SUPPORT_CYCLE.length) % SUPPORT_CYCLE.length];
  return next;
}

export function ghostOf(graph: CanvasGraph, tool: PlaceTool, hit: PlaceHit, opts: PlaceOptions, ambiguous = false): PlaceGhost {
  const dirText = LOAD_DIR_LABEL[normalizeDir(opts.dir)] ?? '↓';
  const hint = ambiguous ? 'Tab 切换候选' : undefined;
  if (tool === 'point') {
    if (hit.kind === 'member') {
      return {
        text: `${memberShort(hit.edgeId)} 上 t=${hit.t.toFixed(2)} 加集中力 ${dirText}`,
        point: { x: hit.x, y: hit.y },
        kind: hit.kind,
        edgeId: hit.edgeId,
        t: hit.t,
        dir: opts.dir,
        ...(hint ? { hint } : {}),
      };
    }
    if (hit.kind === 'joint') {
      return { text: `${hit.text} 上加集中力 ${dirText}`, point: { x: hit.x, y: hit.y }, kind: hit.kind, dir: opts.dir, ...(hint ? { hint } : {}) };
    }
    return { text: `集中力只能落在杆或结点上：先在杆上按下`, point: { x: hit.x, y: hit.y }, kind: hit.kind };
  }
  if (tool === 'udl') {
    if (hit.kind === 'member') {
      return {
        text: `${memberShort(hit.edgeId)} 上加均布 q = ${opts.value} kN/m（整跨）`,
        point: { x: hit.x, y: hit.y },
        kind: hit.kind,
        edgeId: hit.edgeId,
        t: hit.t,
        ...(hint ? { hint } : {}),
      };
    }
    return { text: '均布只能落在杆上：把光标移到杆身', point: { x: hit.x, y: hit.y }, kind: hit.kind };
  }
  if (tool === 'support') {
    if (hit.kind === 'joint') {
      const node = graph.nodes.find((one) => one.id === hit.id);
      const current = node?.support?.type;
      const next = nextSupportType(current);
      const before = current ? SUPPORT_LABEL[`${current}Support`] : '无支座';
      const after = next ? SUPPORT_LABEL[`${next}Support`] : '无（摘掉）';
      return {
        text: `${hit.text}：${before} → ${after}（点一下换，循环 ${SUPPORT_CYCLE_HINT}）`,
        point: { x: hit.x, y: hit.y },
        kind: hit.kind,
        ...(hint ? { hint } : {}),
      };
    }
    if (hit.kind === 'member') {
      return {
        text: `${memberShort(hit.edgeId)} 的 t=${hit.t.toFixed(2)} 处切段 + 加固定铰`,
        point: { x: hit.x, y: hit.y },
        kind: hit.kind,
        edgeId: hit.edgeId,
        t: hit.t,
        ...(hint ? { hint } : {}),
      };
    }
    return { text: '支座要落在结点或杆上', point: { x: hit.x, y: hit.y }, kind: hit.kind };
  }
  if (tool === 'node') {
    if (hit.kind === 'blank') {
      const snapped = snapBlank(hit.x, hit.y);
      return { text: `放一个结点（吸附到网格 ${snapped.x}, ${snapped.y}）`, point: snapped, kind: 'blank' };
    }
    return { text: `${hit.kind === 'member' ? '杆上' : hit.kind === 'joint' ? '这里是结点' : '这里有东西'}：要让空白处才放新结点`, point: { x: hit.x, y: hit.y }, kind: hit.kind };
  }
  // tool='off'：不画 ghost（选中/拖动沿用老路径）。
  if (hit.kind === 'body') {
    return {
      text: `${hit.text} 不是接线端点：点它列出引脚`,
      point: { x: hit.x, y: hit.y },
      kind: 'body',
      pins: pinsOfNode(graph, hit.id),
    };
  }
  return { text: '', point: { x: hit.x, y: hit.y }, kind: hit.kind };
}

/* ── 一步定条件 ─────────────────────────────────────────────────── */

export interface PlacePlan {
  ops: GraphOp[];
  /** 预防性拒绝（不改图）：说清楚为什么落不下去。 */
  refused?: string;
}

/** 器件本体的引脚名（电路）：点本体不再是「一句提示」，而是把引脚列出来。 */
export function pinsOfNode(graph: CanvasGraph, nodeId: string): { key: string; x: number; y: number; label: string }[] {
  const node = graph.nodes.find((one) => one.id === nodeId);
  if (!node) return [];
  return anchorsOfNode(node, 'circuit')
    .filter((anchor) => anchor.kind === 'pin')
    .map((anchor) => ({
      key: anchor.key,
      x: anchor.x,
      y: anchor.y,
      label: anchorDisplay(graph, anchor).short,
    }));
}

/**
 * 松手方向：位移够大就取「最近的四分之一方向」，否则垂直向下。
 * 语义角：↓0 / →90 / ↑180 / ←270（与 LOAD_DIR_LABEL 同一套）。
 */
export function dirFromDrag(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < PLACE_CONFIG.dragThreshold) return 0;
  const angle = (90 - (Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

/**
 * hover 的一次完整回答：命中 + ghost + 「要不要提示 Tab」。
 * 页面每帧只调这一个函数，几何判断不散落在 UI 里。
 */
export function hoverAt(
  graph: CanvasGraph,
  tool: PlaceTool,
  x: number,
  y: number,
  opts: PlaceOptions,
  alt = 0,
): { hit: PlaceHit; ghost: PlaceGhost; ambiguous: boolean } {
  const list = placeCandidates(graph, x, y);
  const first = list[0];
  const second = list[1];
  const ambiguous =
    first !== undefined &&
    second !== undefined &&
    second.dist - first.dist < PLACE_CONFIG.ambiguous &&
    second.rank !== first.rank;
  const hit = alt > 0 && ambiguous && second ? second.hit : (first?.hit ?? { kind: 'blank', x, y });
  return { hit, ghost: ghostOf(graph, tool, hit, opts, ambiguous), ambiguous };
}

/** 一次点击该落到图上的东西（单条 op，切段+支座也在同一条里）。 */
export function placePlan(graph: CanvasGraph, tool: PlaceTool, hit: PlaceHit, opts: PlaceOptions): PlacePlan {
  if (tool === 'off') return { ops: [] };
  if (tool === 'point') {
    if (hit.kind === 'member') {
      return { ops: [{ op: 'addLoad', atMember: { edgeId: hit.edgeId, t: hit.t }, type: 'point', value: opts.value, dir: opts.dir }] };
    }
    if (hit.kind === 'joint') {
      return { ops: [{ op: 'addLoad', atNodeId: hit.id, type: 'point', value: opts.value, dir: opts.dir }] };
    }
    return { ops: [], refused: '集中力要落在杆或结点上：把光标移到杆身上再按下。' };
  }
  if (tool === 'udl') {
    if (hit.kind === 'member') {
      return { ops: [{ op: 'addLoad', atMember: { edgeId: hit.edgeId, t: hit.t }, type: 'udl', value: opts.value }] };
    }
    return { ops: [], refused: '均布要落在杆上：把光标移到杆身再点。' };
  }
  if (tool === 'support') {
    if (hit.kind === 'joint') {
      const node = graph.nodes.find((one) => one.id === hit.id);
      const next = nextSupportType(node?.support?.type);
      return { ops: [{ op: 'setSupport', nodeId: hit.id, type: next }] };
    }
    if (hit.kind === 'member') {
      return { ops: [{ op: 'splitMember', edgeId: hit.edgeId, t: hit.t, support: 'pin' }] };
    }
    return { ops: [], refused: '支座要落在结点或杆上。' };
  }
  if (tool === 'node') {
    if (hit.kind !== 'blank') {
      return { ops: [], refused: '这个位置已经有东西了：要到空白处才放新结点。' };
    }
    const snapped = snapBlank(hit.x, hit.y);
    return { ops: [{ op: 'addNode', x: snapped.x, y: snapped.y }] };
  }
  return { ops: [] };
}


