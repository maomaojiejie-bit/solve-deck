/**
 * 装配操作：只允许白名单内的增删改；布局由骨架给，拖坐标不存在。
 * 每个结构 op 产出一条人话规则，进 appliedRules 证据卡与导出 PDF。
 */

import { applyParams, valueFromLabel } from './picks.ts';
import { deviceName } from './labels.ts';
import { anchorsOfNode, findAnchor, relayout } from './pins.ts';
import { expandComposites, portPins, type CompositeDef } from './composite.ts';
import { allComposites, loadStoredComposites, registerComposites, storeComposites } from './compositeStore.ts';
import { validateMember, validateWire } from './wiring.ts';
/** 两点连线的折线要避开器件本体：与通用求解器共用 S6 穿体判据。 */
import { buildNets } from './netSolve.ts';
import { SYMBOLS } from '../../render/symbols.ts';
import { healAfterDeviceDelete } from './heal.ts';
import { deviceParamFields } from './deviceParams.ts';
import { nextId } from './ids.ts';
import {
  ATTACH_CONFIG,
  LOAD_DIR_LABEL,
  SUPPORT_KIND_OF,
  SUPPORT_LABEL,
  normalizeDir,
  isJoint,
  loadLabelOf,
  mainSpanOf,
  pointOnSpan,
  tOnSpan,
} from './attach.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode, GraphOp } from './types.ts';
import type { ParamValue } from '../templates/registry.ts';

export interface OpOutput {
  graph: CanvasGraph;
  /** 这一步改了什么（给人看）。 */
  rules: string[];
  /** 白名单外 / 不认识的操作 → 拒绝并给建议，不改图。 */
  refused?: string;
  /**
   * W16：非结构改动（setDeviceValue）不走 appliedRules，但页面 toast 仍要说话
   * —— 一句话放这里，labUiStep 拿它当 note，rules 保持空。
   */
  note?: string;
}

export const CIRCUIT_KINDS = ['res', 'cap', 'vsrc', 'diode'];

/**
 * W14 残留清理开关：变异测试把 textWithOwner 关掉 = 删器件后
 * 「VCC（交流地）」这类纯说明文字留在半空 —— check:assemble ㉒① 必须变红。
 */
export const RESIDUE_CONFIG = { textWithOwner: true };
export const KIND_LABEL: Record<string, string> = {
  res: '电阻', cap: '电容', vsrc: '电压源', diode: '二极管',
};

/* ── W16 setDeviceValue：数值是唯一真相，label 只是显示格式 ──────── */

/** 每种器件的数值单位（界面只显示不可改 —— 不给填错单位的机会）。 */
export const UNIT_OF: Record<string, string> = {
  res: 'Ω', cap: 'F', vsrc: 'V', isrc: 'A', npn: 'A', nmos: 'A',
};

/**
 * 源器件的量值可以是 0 或负值：0V 源 = 短路（测等效电阻 / 关掉这一路供电），
 * 负值 = 反极性（-5V 就是反向电源）。无源件（R / C）不同：0Ω 与负电阻在
 * 归约与 MNA 里都没有意义，仍按 (0, 1e12] 收。
 *
 * 以前一刀切 (0, 1e12]：学生想把 Vs 设 0 做「关源」实验时，输入框显示 0、
 * 图上却还是旧值，也不说为什么 —— 静默失败。现在按 kind 分开判，界面
 * 把「为什么不收」写在输入框旁边。
 */
export const SIGNED_VALUE_KINDS: ReadonlySet<string> = new Set(['vsrc', 'isrc']);

/** 器件数值的合法区间（按 kind 分档，界面与 ops 共用同一套判据）。 */
export function valueInRange(kind: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (Math.abs(value) > 1e12) return false;
  return SIGNED_VALUE_KINDS.has(kind) ? true : value > 0;
}

/** 拒收时的人话（ops 的 refused 与界面提示同源）。 */
export function valueRangeNote(kind: string): string {
  return SIGNED_VALUE_KINDS.has(kind)
    ? '数值要在 [-1e12, 1e12] 里：空 / 非数字不收。电压源、电流源可以是 0 或负值（0 = 短路，负 = 反极性）。'
    : '数值要在 (0, 1e12] 里：负数 / 0 / 空都不收。';
}

/** 输入框旁边的短提示（红字，占不了几个字）。 */
export function valueRangeHint(kind: string): string {
  return SIGNED_VALUE_KINDS.has(kind) ? '±1e12 内' : '需 > 0';
}

/** 变异开关（check:assemble ㉔④）：关掉 = 旋转后不重新吸附导线端点。 */
export const ROTATE_CONFIG = { resnap: true };
/** 变异开关（check:assemble ㉕④）：关掉 = 删线后不复查孤立 dot。 */
export const DELETE_EDGE_CONFIG = { prune: true };

/**
 * W20：语义角 → 图元 rot，**私有**，只在把载荷落盘成 SVG 图元时用一次。
 * 对外（GraphOp / UI / 门禁）一律是语义角 ↓0 / →90 / ↑180 / ←270；
 * 图元 rot 走 SVG 顺时针，所以 rot = (360 − 语义角) % 360。
 * 保留 CanvasNode.rot 字段是为了 35 份快照与渲染层不动（红线）。
 */
function glyphRotOf(dir: number): number {
  return (360 - normalizeDir(dir)) % 360;
}

/** 最多 4 位有效数字、去尾零：3300 → '3.3'，10000 → '10'。 */
function trimNum(value: number): string {
  let text = value.toPrecision(4);
  if (text.includes('.')) text = text.replace(/\.?0+$/, '');
  return text;
}

/** 数值 → 显示格式（k/M / nF/µF / mA）：label 里的数不再是 SI 真相。 */
export function formatValue(kind: string, value: number): string {
  const abs = Math.abs(value);
  switch (kind) {
    case 'res':
      return abs >= 1e6 ? `${trimNum(value / 1e6)}M` : abs >= 1000 ? `${trimNum(value / 1000)}k` : `${trimNum(value)}`;
    case 'cap':
      return abs >= 1e-3
        ? `${trimNum(value * 1e3)}mF`
        : abs >= 1e-6
          ? `${trimNum(value * 1e6)}µF`
          : abs >= 1e-9
            ? `${trimNum(value * 1e9)}nF`
            : abs >= 1e-12
              ? `${trimNum(value * 1e12)}pF`
              : `${trimNum(value)}F`;
    case 'npn':
    case 'nmos':
      return `${trimNum(value * 1e3)}mA`;
    default:
      return `${trimNum(value)}${UNIT_OF[kind] ?? ''}`;
  }
}

/** setDeviceValue 的配套：按 kind 把数值写成显示格式（Rc 4.7k / C 10nF / Vs 5V）。 */
export function rewriteLabel(kind: string, label: string | undefined, value: number): string {
  return `${deviceName(label, kind)} ${formatValue(kind, value)}`;
}

/** 'e-AC' → 'AC'；'e-member' → '梁段'。杆件列表上的短名。 */
export function memberLabel(edgeId: string): string {
  const short = edgeId.replace(/^e-/, '');
  return short.startsWith('member') ? '构件' : short.toUpperCase();
}

/** 载荷图元 ↔ 种类（与 picks 的 LOAD_KIND_OF 同义，这里只用于「可删的载荷」判定）。 */
const LOAD_NODE_KINDS = new Set(['arrow', 'udl', 'momentArrow', 'torqueArrow']);

/** 结点短名：`n-B` → `B`；有 label 用 label。 */
function jointName(node: CanvasNode): string {
  const text = (node.label ?? '').trim();
  return text || node.id.replace(/^n-/, '').toUpperCase();
}

/** 图里没被占用的 id（删过再加不许撞 id）。 */
function freeId(nodes: CanvasNode[], base: string): string {
  if (!nodes.some((node) => node.id === base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!nodes.some((node) => node.id === candidate)) return candidate;
  }
}

/**
 * 一条边（沿端点 → 共享结点 dot → 其他导线）是否仍连着某个器件。
 * W13 P0：shared 汇流条的「删后吸附检查」用 —— 删掉器件后两端都不再连
 * 任何剩余器件的 shared 边一并删，仍连着的（如 VCC 母线还挂着 Rl）保留。
 */
export function connectedToAnyDevice(graph: CanvasGraph, edge: CanvasEdge, tol = 0.6): boolean {
  if (graph.family === 'beam') return true;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const devicePoints = graph.nodes
    .filter((node) => node.kind !== 'text' && node.kind !== 'dot')
    .map((node) => anchorsOfNode(node, graph.family).map((anchor) => [anchor.x, anchor.y] as [number, number]));
  const dots = graph.nodes.filter((node) => node.kind === 'dot');
  const others = graph.edges.filter((one) => one.id !== edge.id);
  const endsOf = (one: CanvasEdge): [number, number][] => {
    if (one.points && one.points.length >= 2) return [one.points[0], one.points[one.points.length - 1]];
    const pointOf = (raw: string): [number, number] | null => {
      const node = nodeById.get(raw);
      if (node) return [node.x, node.y];
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
      return m ? [Number(m[1]), Number(m[2])] : null;
    };
    const a = pointOf(one.from);
    const b = pointOf(one.to);
    return a && b ? [a, b] : [];
  };
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= tol;
  const seenEdges = new Set([edge.id]);
  const seenJunctions = new Set<string>();
  const queue: [number, number][] = endsOf(edge);
  while (queue.length > 0) {
    const [x, y] = queue.pop() as [number, number];
    const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
    if (seenJunctions.has(key)) continue;
    seenJunctions.add(key);
    if (devicePoints.some((pts) => pts.some(([px, py]) => near(px, py, x, y)))) return true;
    for (const dot of dots) {
      if (near(dot.x, dot.y, x, y)) queue.push([dot.x, dot.y]);
    }
    for (const other of others) {
      if (seenEdges.has(other.id)) continue;
      const ends = endsOf(other);
      if (ends.some(([ox, oy]) => near(ox, oy, x, y))) {
        seenEdges.add(other.id);
        queue.push(...ends);
      }
    }
  }
  return false;
}

/** 复合器件四操作的共用小件：边的端点（points 首尾或 from/to 节点坐标）。 */
function edgeEndPoints(edge: CanvasEdge, nodeById: Map<string, CanvasNode>): [number, number][] {
  if (edge.points && edge.points.length >= 2) return [edge.points[0], edge.points[edge.points.length - 1]];
  const pointOf = (raw: string): [number, number] | null => {
    const node = nodeById.get(raw);
    if (node) return [node.x, node.y];
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = pointOf(edge.from);
  const b = pointOf(edge.to);
  return a && b ? [a, b] : [];
}

/* ── W14 残留清理：回缩空头端点 / 复查孤立 dot ───────────────────── */

/** 点到线段距离。 */
function segDistOps(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 折线是否触碰 (x,y) 附近 tol（端点或穿越）。 */
function polylineTouches(points: [number, number][], x: number, y: number, tol = 0.6): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (segDistOps(x, y, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]) <= tol) return true;
  }
  return false;
}

/** 最近点在 i 段上的位置沿折线的累计长度（从折线起点算）。 */
function alongFromStart(points: [number, number][], segment: number, qx: number, qy: number): number {
  let total = 0;
  for (let i = 0; i < segment; i += 1) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  return total + Math.hypot(qx - points[segment][0], qy - points[segment][1]);
}

/**
 * 删器件后，把「这次删除弄出来的空头端点」回缩到最后一个仍有器件附着的接点；
 * 裁完长度 < 2 的整条删掉。已设计为开放端（如 Vo 输出头）不受影响：
 * 只有触碰 lostXys（被删器件引脚 / 被删导线）的端点才回缩。
 */
function retractFreeEnds(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  family: CanvasGraph['family'],
  lostXys: [number, number][],
  tol = 0.6,
): { edges: CanvasEdge[]; retracted: number; dropped: number } {
  if (family === 'circuit') {
    /* 电路：折线边逐端检查 */
    const deviceAnchors = nodes
      .filter((node) => node.kind !== 'text' && node.kind !== 'dot')
      .flatMap((node) => anchorsOfNode(node, family).map((anchor) => [anchor.x, anchor.y] as [number, number]));
    const dots = nodes.filter((node) => node.kind === 'dot');
    const pinNear = (x: number, y: number) => deviceAnchors.some(([px, py]) => Math.hypot(px - x, py - y) <= tol);
    const touchLost = (x: number, y: number) => removed.some(([lx, ly]) => Math.hypot(lx - x, ly - y) <= tol);
    const removed: [number, number][] = [...lostXys];
    let current = edges.map((edge) => ({ ...edge, ...(edge.points ? { points: [...edge.points] } : {}) }));
    let retracted = 0;
    let dropped = 0;
    for (let pass = 0; pass < 6; pass += 1) {
      let changed = false;
      const survivors: CanvasEdge[] = [];
      for (const edge of current) {
        const points = edge.points;
        if (!points || points.length < 2) {
          survivors.push(edge);
          continue;
        }
        let pts = points;
        let drop = false;
        for (const side of [0, 1] as const) {
          const end = side === 0 ? pts[0] : pts[pts.length - 1];
          // 本端仍连器件 / 仍连别的边 → 不是空头（别的边这一轮被删也没关系，下一轮复查）
          if (pinNear(end[0], end[1]) || current.some((one) => one.id !== edge.id && one.points && one.points.length >= 2 && polylineTouches(one.points, end[0], end[1], tol))) continue;
          // 不是这次删除弄出来的 → 开放端（如 Vo 输出头），不动
          if (!touchLost(end[0], end[1])) continue;
          // 找回缩目标：沿折线从空头端往里，最后一个「有器件附着」的接点
          const total = pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])), 0);
          let bestDist = Infinity;
          let bestX = 0;
          let bestY = 0;
          const consider = (qx: number, qy: number) => {
            let dist = 0;
            for (let i = 0; i + 1 < pts.length; i += 1) {
              const d = segDistOps(qx, qy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
              if (d <= tol) {
                const along = alongFromStart(pts, i, qx, qy);
                dist = side === 0 ? along : total - along;
                break;
              }
            }
            if (dist < bestDist) {
              bestDist = dist;
              bestX = qx;
              bestY = qy;
            }
          };
          // a) 器件引脚在折线上
          for (const [ax, ay] of deviceAnchors) {
            for (let i = 0; i + 1 < pts.length; i += 1) {
              const dx = pts[i + 1][0] - pts[i][0];
              const dy = pts[i + 1][1] - pts[i][1];
              const len2 = dx * dx + dy * dy;
              const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((ax - pts[i][0]) * dx + (ay - pts[i][1]) * dy) / len2));
              const qx = pts[i][0] + t * dx;
              const qy = pts[i][1] + t * dy;
              if (Math.hypot(ax - qx, ay - qy) <= tol) consider(qx, qy);
            }
          }
          // b) 结点 dot 在折线上，且删掉本边后仍能通过其他边连到器件
          const probe: CanvasGraph = { templateId: '', family, nodes, edges: current.filter((one) => one.id !== edge.id), meta: {} };
          for (const dot of dots) {
            if (!polylineTouches(pts, dot.x, dot.y, tol)) continue;
            const reachable = current.some((one) => {
              if (one.id === edge.id || !one.points || one.points.length < 2) return false;
              if (!polylineTouches(one.points, dot.x, dot.y, tol)) return false;
              return connectedToAnyDevice(probe, one);
            });
            if (reachable) consider(dot.x, dot.y);
          }
          if (!Number.isFinite(bestDist)) {
            drop = true;
            break;
          }
          const cut: [number, number] = [bestX, bestY];
          pts = side === 0 ? [cut, ...pts.slice(1)] : [...pts.slice(0, -1), cut];
          retracted += 1;
          changed = true;
        }
        if (drop) {
          dropped += 1;
          changed = true;
          removed.push(pts[0], pts[pts.length - 1]);
          continue;
        }
        const length = pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])), 0);
        if (length < 2) {
          dropped += 1;
          changed = true;
          removed.push(pts[0], pts[pts.length - 1]);
          continue;
        }
        survivors.push(pts === points ? edge : { ...edge, points: pts });
      }
      current = survivors;
      if (!changed) break;
    }
    return { edges: current, retracted, dropped };
  }
  /* 力学：边是杆 / 梁（from/to 节点 id），删支座不裁梁 —— 原样返回 */
  return { edges, retracted: 0, dropped: 0 };
}

export function applyOp(templateId: string, graph: CanvasGraph, op: GraphOp): OpOutput {
  const rules: string[] = [];
  const nodes = graph.nodes.map((node) => ({ ...node, ...(node.params ? { params: { ...node.params } } : {}) }));
  const edges = graph.edges.map((edge) => ({ ...edge }));
  const next: CanvasGraph = { ...graph, nodes, edges, meta: { ...graph.meta } };

  switch (op.op) {
    case 'clearGraph': {
      if (graph.nodes.length === 0 && graph.edges.length === 0) {
        return { graph, rules, refused: '画布已经是空的 —— 直接点「+ R / + V / + 接地」开始自建。' };
      }
      // 纯说明文字也要清掉：留着它，画布 viewBox 会缩成只有一行字，
      // 而且旧骨架的标注会让人误以为电路还在。
      const cleared: CanvasGraph = {
        ...graph,
        nodes: [],
        edges: [],
        meta: { ...graph.meta, resetAt: (typeof graph.meta.resetAt === 'number' ? graph.meta.resetAt : 0) + 1 },
      };
      rules.push('已清空画布：器件 / 导线 / 结点 / 旧标注全部移除，接下来从零自建（本题参数表与求解器不变）');
      return { graph: cleared, rules };
    }
    case 'deleteDevice': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.nodeId}」这个器件。` };
      if (victim.kind === 'text') {
        return { graph, rules, refused: '标注不是器件，不能按器件删除。' };
      }
      // W17-C：力学族的结点可以删 —— 节点是自由度载体，删它必须连带挂在上面
      // 的杆（确认条会把连带清单先亮出来）；电路族的结点仍不可按器件删。
      // R3-1 A1/H-06：支座是结点属性（随结点消失）；载荷是图元，按 atJoint
      // 或共点一并删 —— 结点没了载荷还浮在原地，就是「假的结构」。
      if (victim.kind === 'dot' || victim.kind === 'pin') {
        if (graph.family !== 'beam') {
          return { graph, rules, refused: '结点不是器件，不能按器件删除。' };
        }
        const attached = edges.filter((edge) => edge.from === victim.id || edge.to === victim.id);
        // R3 修复：级联范围补上「atMember 指向被删杆」的载荷 —— 删结点连带删杆后，
        // 显式挂靠的载荷会成孤儿（悬空箭头 + reduce 归不出 a）。只认显式挂靠：
        // 骨架 / 快照载荷只有坐标，几何推断会误伤（S3 刚体载荷就画在杆身上）。
        const attachedEdgeIds = new Set(attached.map((edge) => edge.id));
        const cascadeLoads = ATTACH_CONFIG.cascade
          ? nodes.filter((node) => {
              if (!LOAD_NODE_KINDS.has(node.kind)) return false;
              if (node.atJoint === victim.id) return true;
              return Boolean(node.atMember && attachedEdgeIds.has(node.atMember));
            })
          : [];
        const dropped = new Set([victim.id, ...cascadeLoads.map((node) => node.id)]);
        next.nodes = nodes.filter((node) => !dropped.has(node.id));
        next.edges = edges.filter((edge) => edge.from !== victim.id && edge.to !== victim.id);
        const name = jointName(victim);
        const supportText = victim.support ? `支座（${SUPPORT_LABEL[SUPPORT_KIND_OF[victim.support.type]]}）` : '';
        const loadText = cascadeLoads.length > 0 ? `${cascadeLoads.length} 个载荷（${cascadeLoads.map((node) => node.label ?? node.id).join('、')}）` : '';
        const parts = [attached.length > 0 ? `${attached.length} 根杆（${attached.map((edge) => memberLabel(edge.id)).join('、')}）` : '', supportText, loadText].filter(Boolean);
        rules.push(`已删除节点 ${name}${parts.length > 0 ? `，连带 ${parts.join('、')}` : ''}`);
        return { graph: next, rules };
      }
      // W13 P0：删器件按 owner 连带删导线 —— 快照边 from/to 是坐标串、点击
      // 连线是引脚 id，按端点字符串比较永远匹配不到。owner 由 graphFromSpec
      // 打标；没有 owner 的旧边保守保留。
      // W13：复合器件实例删除 —— 删实例不删定义；接到端口引脚上的导线一并删
      // （它们只服务于这个实例，留着的端点没有任何器件可吸附）。
      if (victim.compositeId) {
        const victimAnchors = anchorsOfNode(victim, graph.family);
        const nodeByIdAll = new Map(nodes.map((node) => [node.id, node]));
        next.nodes = nodes.filter((node) => node.id !== op.nodeId);
        next.edges = edges.filter((edge) =>
          edgeEndPoints(edge, nodeByIdAll).every(([x, y]) => !victimAnchors.some((anchor) => Math.hypot(anchor.x - x, anchor.y - y) <= 0.6)),
        );
        rules.push(`已删除复合器件实例「${victim.label ?? victim.compositeId}」（定义保留在组件定义区）`);
        return { graph: next, rules };
      }
      next.nodes = nodes.filter((node) => node.id !== op.nodeId && !(node.kind === 'dot' && node.owner === op.nodeId));
      const owned = edges.filter((edge) => edge.owner === op.nodeId);
      const shared = edges.filter((edge) => edge.owner === 'shared');
      const untouched = edges.filter((edge) => edge.owner === undefined || (edge.owner !== op.nodeId && edge.owner !== 'shared'));
      const after: CanvasGraph = { ...graph, nodes: next.nodes };
      // shared 边删后吸附检查：两端都不再连任何剩余器件 → 一并删。
      const keptShared: CanvasEdge[] = [];
      const removedEdges: CanvasEdge[] = [...owned];
      let removedShared = 0;
      for (const edge of shared) {
        const probe: CanvasGraph = { ...after, edges: [...untouched, ...keptShared, edge] };
        if (connectedToAnyDevice(probe, edge)) keptShared.push(edge);
        else {
          removedShared += 1;
          removedEdges.push(edge);
        }
      }
      // W14：三处残留一次清掉 —— 空头端点回缩 / 孤立 dot 复查 / 失效文字。
      // 「这次连接断在哪里」= 被删器件引脚 + 被删导线的全部顶点。
      const lostXys: [number, number][] = removedEdges.flatMap((edge) => edgeEndPoints(edge, new Map(nodes.map((node) => [node.id, node]))));
      lostXys.push(...anchorsOfNode(victim, graph.family).map((anchor) => [anchor.x, anchor.y] as [number, number]));
      const retracted = retractFreeEnds(next.nodes, [...untouched, ...keptShared], graph.family, lostXys);
      let workingEdges = retracted.edges;
      let workingNodes = next.nodes;
      const removedCount = owned.length + removedShared;
      if (graph.family === 'circuit') {
        // 孤立 dot 复查：不再有任何边穿过、1.0 内无器件引脚 → 删。
        const deviceAnchors = workingNodes
          .filter((node) => node.kind !== 'text' && node.kind !== 'dot')
          .flatMap((node) => anchorsOfNode(node, graph.family).map((anchor) => [anchor.x, anchor.y] as [number, number]));
        const beforeDots = workingNodes.filter((node) => node.kind === 'dot').length;
        workingNodes = workingNodes.filter((node) => {
          if (node.kind !== 'dot') return true;
          const touched = workingEdges.some((edge) => edge.points && edge.points.length >= 2 && polylineTouches(edge.points, node.x, node.y, 0.6));
          const pinned = deviceAnchors.some(([px, py]) => Math.hypot(px - node.x, py - node.y) <= 1.0);
          return touched || pinned;
        });
        const removedDots = beforeDots - workingNodes.filter((node) => node.kind === 'dot').length;
        // 失效文字：纯说明性标注随 owner 走（Vo 这类开放端标注 owner=shared，保留）。
        let removedTexts = 0;
        if (RESIDUE_CONFIG.textWithOwner) {
          const beforeTexts = workingNodes.filter((node) => node.kind === 'text').length;
          workingNodes = workingNodes.filter((node) => !(node.kind === 'text' && node.owner === op.nodeId));
          removedTexts = beforeTexts - workingNodes.filter((node) => node.kind === 'text').length;
        }
        next.nodes = workingNodes;
        next.edges = workingEdges;
        const details: string[] = [];
        if (removedDots > 0) details.push(`清理 ${removedDots} 个失效结点`);
        if (retracted.retracted > 0) details.push(`回缩 ${retracted.retracted} 处空头端点`);
        if (retracted.dropped - removedShared > 0) details.push(`删除 ${retracted.dropped - removedShared} 条裁短的公共线`);
        if (removedTexts > 0) details.push(`移除 ${removedTexts} 条失效标注`);
        // W17-A 删除即合并：串联器件删掉后两端网络补一条直连导线（三条硬规则
        // 把关）；负载型只记「支路开路」；并联器件与无可合并侧维持现状。
        const heal = healAfterDeviceDelete(graph, next, victim);
        const suffix = details.length > 0 ? `；${details.join('、')}` : '';
        if (heal.rule) {
          rules.push(`${heal.rule}${suffix}`);
          return { graph: heal.graph, rules };
        }
        rules.push(
          `已删除器件「${victim.label ?? victim.kind}」（${op.nodeId}）${removedCount > 0 ? `，连带 ${removedCount} 条附属导线` : ''}${suffix}`,
        );
        return { graph: heal.graph, rules };
      }
      rules.push(
        `已删除器件「${victim.label ?? victim.kind}」（${op.nodeId}）${removedCount > 0 ? `，连带 ${removedCount} 条附属导线` : ''}`,
      );
      return { graph: next, rules };
    }
    case 'addDevice': {
      // W13：从「自定义模块」面板加一个复合器件实例。
      if (op.compositeId) {
        const def = allComposites()[op.compositeId];
        if (!def) return { graph, rules, refused: '没有这个复合器件定义（分享的图缺 defs？）。' };
        // W22-A：id 走单调 seq —— 连加两个同类模块 / 删一个再加都不许撞。
        const cmp = nextId(graph, 'n-cmp');
        next.meta = cmp.graph.meta;
        next.nodes = [...nodes, { id: cmp.id, x: op.x, y: op.y, kind: 'block', label: def.title, compositeId: def.id }];
        rules.push(`已加入复合器件「${def.title}」（${def.ports.length} 个端口）`);
        return { graph: next, rules };
      }
      // W22-A：守卫原来比 `node.id === op.label`（'R' 对 'n-add-R'，永不相等 = 死守卫）。
      // 同名提示保留但不再阻断 —— id 已由 seq 保证唯一，连加两个「R」各拿各的 id。
      const sameName = nodes.some((node) => node.label === op.label);
      const add = nextId(graph, 'n-add');
      next.meta = add.graph.meta;
      next.nodes = [
        ...nodes,
        {
          id: add.id,
          x: op.x,
          y: op.y,
          kind: op.kind,
          label: op.label,
          ...(op.value !== undefined ? { value: op.value } : {}),
          ...(op.params ? { params: { ...op.params } } : {}),
        },
      ];
      if (op.connect) {
        const wire = nextId(next, 'e-add');
        next.meta = wire.graph.meta;
        next.edges = [...edges, { id: wire.id, from: op.connect[0], to: op.connect[1], kind: 'wire' }];
      }
      rules.push(`已加入器件「${op.label}」${op.connect ? '并连入电路' : ''}`);
      if (sameName) rules.push(`画布上已有同名器件「${op.label}」—— 这是新的一只（id ${add.id}），改数值请认准行内的输入框`);
      return { graph: next, rules };
    }
    case 'addEdge': {
      // W10-B：画布点的是引脚 key（`n-vs:p`），不是器件中心。导线必须带世界坐标
      // points，否则渲染器会把 from/to 当成节点 id 去找，画不出来。
      const pinKeys = op.from.includes(':') && op.to.includes(':');
      if (pinKeys) {
        const verdict = validateWire(graph, op.from, op.to);
        if (!verdict.ok) return { graph, rules, refused: verdict.reason };
      } else if (!nodes.some((node) => node.id === op.from) || !nodes.some((node) => node.id === op.to)) {
        // 兼容旧的「两次点击选节点」列表（W10-A）：按节点中心连。
        return { graph, rules, refused: '连线两端必须都落在已有器件 / 节点上（两次点击两个 pin）。' };
      }
      const anchorOf = (key: string) =>
        pinKeys
          ? findAnchor(graph, key)
          : (() => {
              const node = nodes.find((one) => one.id === key);
              return node ? { key, nodeId: node.id, x: node.x, y: node.y } : undefined;
            })();
      const a = anchorOf(op.from);
      const b = anchorOf(op.to);
      if (!a || !b) return { graph, rules, refused: '引脚不在当前画布上，先恢复骨架或重新点。' };
      /**
       * 从零自建电路时器件默认排在同一行，只走「先竖后横」会把水平段压在
       * 器件中心线上，S6 判为导线穿体 —— 整张图直接拒答（用户什么都没做错）。
       * 这里给两条正交候选，用 netSolve 同一份 bodyCross 判据择优：平手保留
       * 原画法（骨架连线的既有外观不变），只有原画法真的穿体时才换「先横后竖」。
       *
       * R-36d 绕障布线：两条 L 之外，再按器件本体矩形生成「绕行车车道」——
       * 水平车道 / 垂直车道各几条（障碍带的间隙中点 + 带外两侧，留 28 边距），
       * 全部候选统一按 crossings·1e6 + 长度打分。任何一条不穿体就绝不交
       * bodyCross 拒答；都不穿体的平手里最短优先，长度再平手保留原画法。
       */
      const candidates: [number, number][][] = [
        [
          [a.x, a.y],
          [a.x, b.y],
          [b.x, b.y],
        ],
        [
          [a.x, a.y],
          [b.x, a.y],
          [b.x, b.y],
        ],
      ];
      {
        const bodies = graph.nodes
          .filter((node) => SYMBOLS[node.kind] && node.kind !== 'text' && node.kind !== 'dot')
          .map((node) => {
            const def = SYMBOLS[node.kind];
            const rot = (((node.rot ?? 0) % 360) + 360) % 360;
            const swap = rot === 90 || rot === 270;
            const hw = swap ? def.hh : def.hw;
            const hh = swap ? def.hw : def.hh;
            return { x0: node.x - hw, x1: node.x + hw, y0: node.y - hh, y1: node.y + hh };
          });
        const MARGIN = 28;
        /** 连线主方向上与连线带相交的障碍，返回它们在 axis 上的封闭带（有序）。 */
        const blockedBands = (axis: 'x' | 'y', lo: number, hi: number) => {
          const bands = bodies
            .filter((b) => (axis === 'x' ? b.x1 > lo && b.x0 < hi : b.y1 > lo && b.y0 < hi))
            .map((b) => (axis === 'x' ? { lo: b.x0, hi: b.x1 } : { lo: b.y0, hi: b.y1 }))
            .sort((p, q) => p.lo - q.lo);
          return bands;
        };
        /** 与连线带相交的障碍之间/之外的可行车道，夹在 [lo-160, hi+160] 防绕飞。 */
        const detourLanes = (axis: 'x' | 'y', lo0: number, hi0: number): number[] => {
          const lo = Math.min(lo0, hi0);
          const hi = Math.max(lo0, hi0);
          const bands = blockedBands(axis, lo, hi).filter((b) => b.hi - b.lo > 8);
          const out: number[] = [(lo + hi) / 2];
          let cursor = lo;
          for (const band of bands) {
            const above = band.lo - MARGIN;
            if (above > cursor + 16) out.push((cursor + above) / 2);
            cursor = Math.max(cursor, band.hi);
          }
          out.push(Math.max(cursor + MARGIN, hi + MARGIN));
          return [...new Set(out.map((v) => Math.round(v)))].filter((v) => v >= lo - 160 && v <= hi + 160);
        };
        for (const y of detourLanes('y', a.y, b.y)) {
          candidates.push([
            [a.x, a.y],
            [a.x, y],
            [b.x, y],
            [b.x, b.y],
          ]);
        }
        for (const x of detourLanes('x', a.x, b.x)) {
          candidates.push([
            [a.x, a.y],
            [x, a.y],
            [x, b.y],
            [b.x, b.y],
          ]);
        }
      }
      const probe = { id: '__wire_route_probe__', from: op.from, to: op.to, kind: op.kind ?? 'wire' };
      const crossings = (points: [number, number][]) =>
        buildNets({ ...graph, edges: [{ ...probe, points }] }).crossings.length;
      const lengthOf = (points: [number, number][]) =>
        points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
      // 打分：穿体一票否决（×1e6），再比路径长度；原画法参与平手（保持骨架外观稳定）。
      let points = candidates[0];
      let bestScore = crossings(points) * 1e6 + lengthOf(points);
      for (const candidate of candidates.slice(1)) {
        const score = crossings(candidate) * 1e6 + lengthOf(candidate);
        if (score < bestScore) {
          points = candidate;
          bestScore = score;
        }
      }
      void bestScore;
      next.edges = [
        ...edges,
        // 点击连的线两端各落一个器件（自环已被拒）→ owner 记 shared：
        // 之后删掉任何一端器件，这条线靠「另一端仍连器件」检查保命。
        // W22-A：id 走单调 seq —— 删线后再连线不许复用 e-pin-N。
        (() => {
          const edge = nextId(graph, 'e-pin');
          next.meta = edge.graph.meta;
          return { id: edge.id, from: op.from, to: op.to, kind: op.kind ?? 'wire', points, owner: 'shared' as const };
        })(),
      ];
      rules.push(`已连线 ${op.from} → ${op.to}（端点落在引脚上）`);
      return { graph: next, rules };
    }
    case 'deleteMember': {
      const victim = edges.find((edge) => edge.id === op.edgeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.edgeId}」这根杆。` };
      next.edges = edges.filter((edge) => edge.id !== op.edgeId);
      // R3 修复：删杆级联清掉**显式挂在它身上**的载荷（atMember 指向它，放置器落的）。
      // 只认显式挂靠、不做几何推断：骨架 / 快照载荷只有坐标（S3 刚体的载荷就画在
      // 杆身上，W11 门禁「删主跨→补回→与快照逐位一致」要求它们活下来，补回即还原）。
      // 显式载荷跟着杆走 —— 不清掉就是孤儿：列表还在、画布悬空箭头、reduce 归不出 a。
      const orphanLoads = ATTACH_CONFIG.cascade
        ? nodes.filter((node) => LOAD_NODE_KINDS.has(node.kind) && node.atMember === op.edgeId)
        : [];
      if (orphanLoads.length > 0) {
        const dropped = new Set(orphanLoads.map((node) => node.id));
        next.nodes = nodes.filter((node) => !dropped.has(node.id));
      }
      // W17-C：删杆走 m = 2j−3 判据 —— 杆照删（节点是自由度载体不合并），
      // 但少于静定根数要说清楚：少杆桁架成机构，通解会拒答。
      let tail = '';
      if (graph.family === 'beam') {
        const joints = new Set(next.edges.flatMap((edge) => [edge.from, edge.to]));
        const m = next.edges.length;
        const twoJm3 = 2 * joints.size - 3;
        if (m < twoJm3) tail = `；判据：m = ${m} < 2j−3 = ${twoJm3}，少一根 —— 少杆桁架成机构，通解会拒答`;
      }
      const loadText = orphanLoads.length > 0 ? `，连带 ${orphanLoads.length} 个载荷（${orphanLoads.map((node) => node.label ?? node.id).join('、')}）` : '';
      rules.push(`已删除构件 ${memberLabel(victim.id)}（${op.edgeId}）${loadText}${tail}`);
      return { graph: next, rules };
    }
    case 'setMemberProps': {
      const edge = edges.find((one) => one.id === op.edgeId);
      if (!edge) return { graph, rules, refused: `画布上没有「${op.edgeId}」这根杆。` };
      if (graph.family !== 'beam') return { graph, rules, refused: '截面属性只有力学族的杆 / 梁有。' };
      const updates: string[] = [];
      const candidates: [string, number | undefined][] = [
        ['A', op.A],
        ['I', op.I],
        ['E', op.E],
      ];
      for (const [key, value] of candidates) {
        if (value === undefined) continue;
        if (!(Number.isFinite(value) && value > 0 && value <= 1e12)) {
          return { graph, rules, refused: `${key} 要在 (0, 1e12] 里：负数 / 0 / 空都不收。` };
        }
        if (key === 'A') edge.A = value;
        else if (key === 'I') edge.I = value;
        else edge.E = value;
        updates.push(`${key}=${value}`);
      }
      if (updates.length === 0) return { graph, rules, refused: '没有要改的属性（A / I / E 至少给一个）。' };
      return {
        graph: next,
        rules: [],
        note: `已改杆 ${memberLabel(edge.id)}：${updates.join(' ')}（相对比例：EA=E·A、EI=E·I，缺省全 1）`,
      };
    }
    case 'addMember': {
      // 力学两次点击的判据：不得零长 / 不得平行重复杆 / m ≤ 2j−3。
      const verdict = validateMember(graph, op.from, op.to, op.kind === 'truss');
      if (!verdict.ok) return { graph, rules, refused: verdict.reason };
      const kind = op.kind === 'truss' ? 'line' : 'beam';
      const id = `e-member-add-${edges.length}`;
      next.edges = [...edges, { id, from: op.from, to: op.to, kind }];
      rules.push(`已在 ${op.from}–${op.to} 加一根${op.kind === 'truss' ? '桁架杆' : '构件'}`);
      return { graph: next, rules };
    }
    case 'addNode': {
      // R3-4 U1：空白处放结点。结点是自由度载体，没有种类可选 —— 坐标已经由
      // 放置器吸附过网格；这里只做两件不能省的事：id 不撞车、标签给个字母。
      if (graph.family !== 'beam') {
        return { graph, rules, refused: '电路族没有「结点」这个概念：导线端点自己就是结点。' };
      }
      const x = Math.round(op.x);
      const y = Math.round(op.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { graph, rules, refused: '结点坐标不合法。' };
      const clash = nodes.find((node) => isJoint(node) && Math.hypot(node.x - x, node.y - y) <= 1);
      if (clash) return { graph, rules, refused: `${jointName(clash)} 已经在这儿了：同一个位置不放第二个结点。` };
      const used = new Set(
        nodes
          .filter((node) => isJoint(node))
          .map((node) => (node.label ?? '').trim().toUpperCase())
          .filter((text) => /^[A-Z]$/.test(text)),
      );
      const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((one) => !used.has(one));
      const id = freeId(nodes, `n-${letter ? letter.toLowerCase() : `j-${nodes.length}`}`);
      next.nodes = [...nodes, { id, x, y, kind: 'dot', label: letter ?? id.replace(/^n-/, '').toUpperCase() }];
      rules.push(`在空白处放了一个结点 ${letter ?? id}（${x}, ${y}）—— 结点是自由度载体，支座 / 载荷可以挂在它上面`);
      return { graph: next, rules };
    }
    case 'splitMember': {
      // R3-4 U1：点杆中切段。原杆 A–B 在 t 处插结点 J，拆成 A–J、J–B；
      // kind 与 A/I/E 沿给（截面不会因为切一刀就变）。
      const victim = edges.find((edge) => edge.id === op.edgeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.edgeId}」这根杆。` };
      const a = nodes.find((node) => node.id === victim.from);
      const b = nodes.find((node) => node.id === victim.to);
      if (!a || !b) return { graph, rules, refused: '这根杆的端点不在画布上，切不了。' };
      const ratio = op.t;
      if (!(Number.isFinite(ratio) && ratio > 0 && ratio < 1)) {
        return { graph, rules, refused: '切点 t 要在 (0,1) 之间：切在端点上等于没切。' };
      }
      const px = a.x + ratio * (b.x - a.x);
      const py = a.y + ratio * (b.y - a.y);
      const used = new Set(
        nodes
          .filter((node) => isJoint(node))
          .map((node) => (node.label ?? '').trim().toUpperCase())
          .filter((text) => /^[A-Z]$/.test(text)),
      );
      const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((one) => !used.has(one));
      const jointId = freeId(nodes, `n-${letter ? letter.toLowerCase() : `j-${nodes.length}`}`);
      next.nodes = [...nodes, { id: jointId, x: px, y: py, kind: 'dot', label: letter ?? jointId.replace(/^n-/, '').toUpperCase() }];
      const own = { ...(victim.A !== undefined ? { A: victim.A } : {}), ...(victim.I !== undefined ? { I: victim.I } : {}), ...(victim.E !== undefined ? { E: victim.E } : {}) };
      // W22-A：切段 id 走单调 seq —— 切完再切同一段不许撞（-1/-2 由 index 变 seq）。
      const segA = nextId(graph, `${op.edgeId}-`);
      const segB = nextId(segA.graph, `${op.edgeId}-`);
      next.meta = segB.graph.meta;
      next.edges = [
        ...edges.filter((edge) => edge.id !== op.edgeId),
        { id: segA.id, from: victim.from, to: jointId, kind: victim.kind, ...own },
        { id: segB.id, from: jointId, to: victim.to, kind: victim.kind, ...own },
      ];
      rules.push(
        `在 ${memberLabel(victim.id)} 的 t=${ratio.toFixed(2)} 处切了一刀：插结点 ${letter ?? jointId}，拆成 ${memberLabel(segA.id)}、${memberLabel(segB.id)} 两段（截面属性沿给）`,
      );
      if (op.support) {
        const kind = SUPPORT_KIND_OF[op.support];
        const fresh = next.nodes.find((node) => node.id === jointId);
        if (fresh) {
          fresh.support = {
            type: op.support,
            id: freeId(next.nodes, `n-sup-${jointId.replace(/^n-/, '')}`),
            label: SUPPORT_LABEL[kind],
            labelSide: 'down',
          };
          rules.push(`并在这个新结点上挂了${SUPPORT_LABEL[kind]}（支座是结点属性：拖结点它跟着走）`);
        }
      }
      return { graph: next, rules };
    }
    case 'addSupport': {
      // R3-1 A1：支座写在结点上（不新造图元）。一个结点最多一个支座 —— 「这个点的
      // 约束是什么」有唯一答案；坐标也就只有一份，不存在「支座飘在结点旁边」。
      const at = nodes.find((node) => node.id === op.atNodeId);
      if (!at || !isJoint(at)) {
        return { graph, rules, refused: '先选中一个结点，再加支座。' };
      }
      const kind = SUPPORT_KIND_OF[op.type];
      if (at.support) {
        return {
          graph,
          rules,
          refused: `结点 ${jointName(at)} 已经有${SUPPORT_LABEL[SUPPORT_KIND_OF[at.support.type]]}了：一个结点只能有一个支座 —— 在选中条里改类型，或先删掉它。`,
        };
      }
      at.support = {
        type: op.type,
        id: freeId(nodes, `n-sup-${at.id.replace(/^n-/, '')}`),
        label: SUPPORT_LABEL[kind],
        labelSide: 'down',
      };
      rules.push(`已在结点 ${jointName(at)} 加${SUPPORT_LABEL[kind]}（支座是结点属性：拖结点它跟着走，删结点它一起消失）`);
      return { graph: next, rules };
    }
    case 'setSupport': {
      const at = nodes.find((node) => node.id === op.nodeId);
      if (!at || !isJoint(at)) return { graph, rules, refused: '只有结点能挂支座。' };
      if (op.type === null) {
        if (!at.support) return { graph, rules, refused: `结点 ${jointName(at)} 上没有支座。` };
        const before = SUPPORT_LABEL[SUPPORT_KIND_OF[at.support.type]];
        delete at.support;
        rules.push(`已从结点 ${jointName(at)} 摘掉${before}支座（这个点不再受约束）`);
        return { graph: next, rules };
      }
      const kind = SUPPORT_KIND_OF[op.type];
      const before = at.support ? SUPPORT_LABEL[SUPPORT_KIND_OF[at.support.type]] : '无';
      at.support = { ...(at.support ?? {}), type: op.type, id: at.support?.id ?? freeId(nodes, `n-sup-${at.id.replace(/^n-/, '')}`), label: SUPPORT_LABEL[kind], labelSide: at.support?.labelSide ?? 'down' };
      rules.push(`结点 ${jointName(at)} 的支座：${before} → ${SUPPORT_LABEL[kind]}`);
      return { graph: next, rules };
    }
    case 'addLoad': {
      // R3-1 A3：位置（结点 / 跨内 t）与方向（↓→↑←）都是真的；t 换算成坐标后
      // reduce 的 loadAt 得到 a = t·L —— 不是只画个箭头。
      const kind = op.type === 'udl' ? 'udl' : op.type === 'moment' ? 'momentArrow' : op.type === 'torque' ? 'torqueArrow' : 'arrow';
      const unit = op.type === 'udl' ? 'kN/m' : op.type === 'point' ? 'kN' : 'kN·m';
      const name = op.type === 'point' ? 'P' : op.type === 'udl' ? 'q' : op.type === 'moment' ? 'M' : 'T';
      let x = 0;
      let y = 0;
      let atJoint: string | undefined;
      let atJointName = '';
      let t: number | undefined;
      let atMemberId: string | undefined;
      if (op.atMember) {
        // R3-4 U1：认**任意一段**杆，不再只认 mainSpanOf（切段之后梁有两段，
        // 第二段加不上载荷就是白切）。t 沿这一段插值，edgeId 记在节点上。
        const edge = edges.find((one) => one.id === op.atMember!.edgeId);
        const endA = edge && nodes.find((node) => node.id === edge.from);
        const endB = edge && nodes.find((node) => node.id === edge.to);
        if (!edge || !endA || !endB) {
          return { graph, rules, refused: `画布上没有「${op.atMember.edgeId}」这段跨：载荷只能落在已有的杆 / 梁上。` };
        }
        const ratio = Number.isFinite(op.atMember.t) ? op.atMember.t : 0.5;
        if (!(ratio > 0 && ratio < 1)) {
          return { graph, rules, refused: '跨内载荷的 t 要在 (0,1) 之间：t=0 / 1 就是端点，请改用结点载荷。' };
        }
        const point = pointOnSpan({ a: endA, b: endB }, ratio);
        x = point.x;
        y = point.y;
        t = Math.min(1, Math.max(0, ratio));
        atMemberId = edge.id;
      } else if (op.atNodeId) {
        const at = nodes.find((node) => node.id === op.atNodeId);
        if (!at || !isJoint(at)) {
          return { graph, rules, refused: '先选中结点或构件，再加荷载。' };
        }
        x = at.x;
        y = at.y;
        atJoint = at.id;
        atJointName = jointName(at);
      } else {
        return { graph, rules, refused: '先选中结点或构件。' };
      }
      // 对外一律语义角（↓0/→90/↑180/←270），图元角只在落盘那一刻算；
      // 规则文案里也必须写语义角，否则选了「→」的人会看到「方向 270°」。
      const semanticDir = op.type === 'point' ? normalizeDir(op.dir ?? 0) : 0;
      const dir = op.type === 'point' ? glyphRotOf(semanticDir) : 0;
      const id = freeId(nodes, `n-load-${nodes.filter((node) => LOAD_NODE_KINDS.has(node.kind)).length}`);
      // 同一根杆上连着加好几个箭头时，标签会叠成一团（「P P 2020NN…」）：
      // 交替翻上/下，至少让每个标签都有自己的位置。
      const siblings = nodes.filter((node) => node.kind === kind).length;
      const alternateSide = kind === 'arrow' && siblings % 2 === 1 ? ('down' as const) : undefined;
      next.nodes = [
        ...nodes,
        {
          id,
          x,
          y,
          kind,
          rot: dir,
          ...(alternateSide ? { labelSide: alternateSide } : {}),
          // R-36：均布是「铺满整段」的整跨载荷（BeamModel 只有整跨 q），
          // 标签里再挂一个 t=0.47 会让人误以为是局部段 —— 命中点只用来选杆，不是区间起点。
          label: op.type === 'udl' && atMemberId
            ? `${loadLabelOf(name, op.value, unit, {})} · 整跨`
            : loadLabelOf(name, op.value, unit, atJoint ? { atJoint } : { t }),
          value: op.value,
          ...(atJoint ? { atJoint } : {}),
          ...(atMemberId ? { atMember: atMemberId } : {}),
        },
      ];
      const spot = atJoint ? `结点 ${atJointName}` : `跨内 t=${(t ?? 0).toFixed(2)}`;
      // R3-4 U1：跨内载荷把「落在哪一根杆」写进规则 —— 切段之后光看 t=0.50
      // 已经不能定位了（两段各有一个 0.50）。
      const where = atMemberId ? `${memberLabel(atMemberId)} t=${(t ?? 0).toFixed(2)}` : spot;
      // 均布不按 t 落：BeamModel 只有整跨 q，所以话要说成「铺满这一段」，
      // 不许写「落在 t=0.50 上」—— 那会让人以为局部也有 q。
      if (atMemberId && op.type === 'udl') {
        rules.push(
          `均布 q = ${op.value} ${unit} 铺满 ${memberLabel(atMemberId)}（整跨：本模型只有整跨均布，局部区间的 q0…q1 要改模板，这一批不做）`,
        );
        return { graph: next, rules };
      }
      rules.push(
        atMemberId
          ? `载荷落在 ${where} 上：${op.type === 'point' ? '集中力' : op.type === 'udl' ? '均布载荷' : '力偶'} ${op.value} ${unit}${op.type === 'point' ? `，方向 ${LOAD_DIR_LABEL[semanticDir]}（${semanticDir}°）` : ''}`
          : `已加${op.type === 'point' ? '集中力' : op.type === 'udl' ? '均布载荷' : '力偶'} ${op.value} ${unit}（${spot}${op.type === 'point' ? `，方向 ${LOAD_DIR_LABEL[semanticDir]}（${semanticDir}°）` : ''}）`,
      );
      return { graph: next, rules };
    }
    case 'setLoadDir': {
      const load = nodes.find((node) => node.id === op.nodeId);
      if (!load || !LOAD_NODE_KINDS.has(load.kind)) return { graph, rules, refused: '这条改动只对画布上的载荷生效。' };
      if (load.kind !== 'arrow') return { graph, rules, refused: '方向只对集中力（箭头）有意义：均布 / 力偶没有方向可选。' };
      const dir = normalizeDir(op.dir);
      // 落盘时才翻成图元角；对外一律语义角。
      load.rot = glyphRotOf(dir);
      const semantic = dir;
      rules.push(`载荷「${load.label ?? load.id}」方向改为 ${LOAD_DIR_LABEL[semantic]}（${semantic}°：↓0 / →90 / ↑180 / ←270）`);
      return { graph: next, rules };
    }
    case 'setLoadT': {
      const load = nodes.find((node) => node.id === op.nodeId);
      if (!load || !LOAD_NODE_KINDS.has(load.kind)) return { graph, rules, refused: '这条改动只对画布上的载荷生效。' };
      // R-36：均布铺满整段，没有「跨内位置 t」。给它设 t 只会把标签写回
      // 「t=0.47」并和规则里的「整跨」打架 —— 直接拒答，说清本模型的边界。
      if (load.kind === 'udl') {
        return { graph, rules, refused: '均布载荷是整跨的（q 铺满这一整段），没有跨内位置 t：本模型暂不支持局部区间均布。' };
      }
      // R3-4 U1：载荷落过哪一段就以那一段为准（切段之后 mainSpanOf 只是第一段）。
      const ownEdge = load.atMember ? edges.find((edge) => edge.id === load.atMember) : undefined;
      const ownA = ownEdge && nodes.find((node) => node.id === ownEdge.from);
      const ownB = ownEdge && nodes.find((node) => node.id === ownEdge.to);
      const span = ownA && ownB ? { id: ownEdge!.id, a: ownA, b: ownB } : mainSpanOf(graph);
      if (!span) return { graph, rules, refused: '画布上没有主跨（梁 / 轴）：载荷没地方按 t 放。' };
      const ratio = op.t;
      if (!(Number.isFinite(ratio) && ratio >= 0 && ratio <= 1)) {
        return { graph, rules, refused: 't 要在 [0,1] 里：0 / 1 表示落在两端结点上。' };
      }
      const unit = load.kind === 'udl' ? 'kN/m' : load.kind === 'arrow' ? 'kN' : 'kN·m';
      const value = load.value ?? valueFromLabel(load.label) ?? 0;
      const baseLabel = (load.label ?? '').split('·')[0].trim();
      const head = baseLabel.includes('=') ? baseLabel.split('=')[0].trim() : (load.kind === 'arrow' ? 'P' : load.kind === 'udl' ? 'q' : 'M');
      if (ratio === 0 || ratio === 1) {
        const joint = ratio === 0 ? span.a : span.b;
        load.x = joint.x;
        load.y = joint.y;
        load.atJoint = joint.id;
        delete load.atMember;
        load.label = loadLabelOf(head, value, unit, { atJoint: joint.id });
        rules.push(`载荷「${head}」挪到结点 ${jointName(joint)}（不再是跨内载荷）`);
        return { graph: next, rules };
      }
      const point = pointOnSpan(span, ratio);
      load.x = point.x;
      load.y = point.y;
      delete load.atJoint;
      load.atMember = span.id;
      load.label = loadLabelOf(head, value, unit, { t: tOnSpan(span, point.x) ?? ratio });
      rules.push(`载荷「${head}」挪到跨内 t=${ratio.toFixed(2)}（a = t·L = ${ratio.toFixed(2)}·L）`);
      return { graph: next, rules };
    }
    case 'changeKind': {
      // R3-1 A1：支座不再是图元，种类变更必须走 setSupport —— 否则会凭空造出一个
      // 独立支座节点（H-01/H-02 的老病），这里如实拒并把路指过去。
      if (SUPPORT_LABEL[op.kind]) {
        return { graph, rules, refused: '支座不能靠「改器件种类」改：它是结点属性 —— 先选中那个结点，在选中条里改支座类型（setSupport）。' };
      }
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.nodeId}」。` };
      if (victim.support) {
        return { graph, rules, refused: `「${jointName(victim)}」上挂着支座：结点不能改成器件种类 —— 要换约束类型请用 setSupport。` };
      }
      const before = victim.label ?? victim.kind;
      const wasCircuit = CIRCUIT_KINDS.includes(victim.kind);
      const isCircuit = CIRCUIT_KINDS.includes(op.kind);
      victim.kind = op.kind;
      if (wasCircuit && isCircuit && victim.params) {
        // 种类变了，原器件的 params（Vf / beta / gm…）不兼容：只保留数值 value
        delete victim.params;
      }
      rules.push(`「${before}」改为 ${KIND_LABEL[op.kind] ?? op.kind}${wasCircuit && isCircuit ? '（保留数值、丢掉不兼容参数）' : ''}`);
      return { graph: next, rules };
    }
    case 'setSemantic': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.nodeId}」。` };
      victim.semantic = op.semantic;
      return { graph: next, rules };
    }
    case 'applyParams': {
      return { graph: applyParams(templateId, graph, op.values as Record<string, ParamValue>), rules: ['参数表改动已写回图（位置挪载荷、数值改器件）'] };
    }
    /**
     * W20：右栏「截面」。写成一个整体对象，清空时整个键删掉 ——
     * 不留扁平的 b/h/E 残值，否则清空后 sectionOf 仍能从骨架回退里读到数。
     * 只服务梁族：电路图没有截面可填。
     */
    case 'setSection': {
      if (graph.family !== 'beam') return { graph, rules, refused: '截面只对梁族装配图有意义。' };
      const meta = { ...graph.meta };
      if (op.section === null) delete meta.section;
      else {
        const { b, h, E } = op.section;
        if (![b, h, E].every((one) => typeof one === 'number' && Number.isFinite(one) && one > 0)) {
          return { graph, rules, refused: 'b / h / E 都要是正数：截面清空请按「清空」。' };
        }
        meta.section = { b, h, E };
      }
      return {
        graph: { ...graph, meta },
        rules: [op.section === null ? '已清空截面：应力与挠度回到「缺什么」' : `已填截面 b=${op.section.b} mm · h=${op.section.h} mm · E=${op.section.E} GPa`],
      };
    }
    /* ── W13 复合器件：封装 / 摊开 / 收拢 / 拆开 ─────────────────── */
    case 'wrapComposite': {
      if (graph.family === 'beam') return { graph, rules, refused: '力学图暂不支持封装复合器件（复合器件只服务电路）。' };
      const ids = new Set(op.nodeIds);
      const members = nodes.filter((node) => ids.has(node.id) && node.kind !== 'text');
      if (members.length < 2) return { graph, rules, refused: '至少选两个器件才能封装成复合器件。' };
      const portNodes = op.ports.filter((port) => ids.has(port.nodeId));
      if (new Set(portNodes.map((port) => port.nodeId)).size !== portNodes.length) {
        return { graph, rules, refused: '一个节点只能是一个端口。' };
      }
      const memberAnchors = members.flatMap((node) => anchorsOfNode(node, graph.family));
      const onMember = (x: number, y: number) => memberAnchors.some((anchor) => Math.hypot(anchor.x - x, anchor.y - y) <= 0.6);
      const nodeByIdAll = new Map(nodes.map((node) => [node.id, node]));
      // 有外部连线的节点必须保留端口，否则封装会留悬空导线。
      // 横穿画法的线（端点不落引脚、只是从引脚上划过，如 A3 的 VCC 横杠）
      // 没法在封装里语义保持 —— 如实拒绝，不悄悄丢连接。
      const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      };
      for (const member of members) {
        const anchors = anchorsOfNode(member, graph.family);
        const crossesOnly = edges.some((edge) => {
          const ends = edgeEndPoints(edge, nodeByIdAll);
          if (ends.some(([x, y]) => anchors.some((anchor) => Math.hypot(anchor.x - x, anchor.y - y) <= 0.6))) return false;
          const poly = edge.points ?? [];
          if (poly.length < 2) return false;
          const crosses = anchors.some((anchor) => {
            for (let i = 0; i < poly.length - 1; i += 1) {
              if (segDist(anchor.x, anchor.y, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]) <= 0.6) return true;
            }
            return false;
          });
          return crosses && !ends.every(([x, y]) => onMember(x, y));
        });
        if (crossesOnly) {
          return {
            graph,
            rules,
            refused: `「${member.label ?? member.id}」的对外连线是横穿引脚的汇流条画法（端点不落引脚），封装暂不支持这种画法 —— 先删那条线或恢复骨架。`,
          };
        }
        const isPort = portNodes.some((port) => port.nodeId === member.id);
        const hasExternal = edges.some((edge) => {
          const ends = edgeEndPoints(edge, nodeByIdAll);
          return ends.some(([x, y], index) => {
            const anchor = memberAnchors.find((one) => Math.hypot(one.x - x, one.y - y) <= 0.6);
            if (!anchor || anchor.nodeId !== member.id) return false;
            const other = ends[1 - index];
            return Boolean(other) && !onMember(other[0], other[1]);
          });
        });
        if (hasExternal && !isPort) {
          return { graph, rules, refused: `「${member.label ?? member.id}」有外部连线但没勾端口 —— 保留它的端口，或先删那条线。` };
        }
      }
      // 内层局部坐标：以包围盒中心为原点（摊开时精确回到原位）。
      const xs = members.map((node) => node.x);
      const ys = members.map((node) => node.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const slug = op.title.replace(/[^\w\u4e00-\u9fa5]+/g, '') || 'mod';
      const existing = new Set([...Object.keys(allComposites()), ...loadStoredComposites().map((one) => one.id)]);
      let defId = `cmp-u-${slug}`;
      for (let i = 2; existing.has(defId); i += 1) defId = `cmp-u-${slug}-${i}`;
      const def: CompositeDef = {
        id: defId,
        title: op.title,
        ...(op.note ? { note: op.note } : {}),
        ports: portNodes.map((port, index) => ({ id: `p${index}`, nodeId: port.nodeId, label: port.label })),
        inner: { nodes: members.map((node) => ({ ...node, x: node.x - cx, y: node.y - cy, owner: undefined })), edges: [] },
        modelSpec: op.modelSpec ?? {
          // 封装面板在保存前跑 expand+reduce 校验；方程 / 适用范围由封装者在面板里补，
          // 这里给诚实缺省 —— 没补就按 missingModelSpec 判 U，不假装已建模。
          equations: [`${op.title} 的端口关系（封装者在端口面板补方程）`],
          applicableRange: '由封装者在端口面板确认后填写',
          units: {},
        },
        goldenRefs: op.goldenRefs ?? [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const pins = portPins(def);
      const portPosOf = new Map(
        def.ports.map((port, index) => [port.nodeId, [cx + pins[index].x, cy + pins[index].y] as [number, number]]),
      );
      // 边分类：两端都在选中集合 → 进定义；一端在内 → 端点改接到块端口引脚。
      const internalIds = new Set<string>();
      const boundary = new Map<string, { innerEnd: 0 | 1; target: [number, number] }>();
      for (const edge of edges) {
        const ends = edgeEndPoints(edge, nodeByIdAll);
        const aIn = onMember(ends[0][0], ends[0][1]);
        const bIn = onMember(ends[1][0], ends[1][1]);
        if (!aIn && !bIn) continue;
        if (aIn && bIn) {
          internalIds.add(edge.id);
          continue;
        }
        const innerEnd: 0 | 1 = aIn ? 0 : 1;
        const anchor = memberAnchors.find((one) => Math.hypot(one.x - ends[innerEnd][0], one.y - ends[innerEnd][1]) <= 0.6);
        const target = anchor ? portPosOf.get(anchor.nodeId) : undefined;
        if (target) boundary.set(edge.id, { innerEnd, target });
      }
      for (const edge of edges) {
        if (!internalIds.has(edge.id)) continue;
        // W22-A：内层 id 走单调 seq —— 同一段封装两次不许撞 in-<edgeId>。
        const inner = nextId(graph, `in-${edge.id}`);
        graph = inner.graph;
        def.inner.edges.push({
          ...edge,
          id: inner.id,
          ...(edge.points ? { points: edge.points.map(([px, py]) => [px - cx, py - cy] as [number, number]) } : {}),
        });
      }
      // 存定义：会话立刻可用 + localStorage 持久（同 id 覆盖旧版）。
      registerComposites([def]);
      storeComposites([...loadStoredComposites().filter((one) => one.id !== def.id), def]);
      // W22-A：块 id 走单调 seq —— 封装两个模块 / 收拢再封装不许撞。
      const block = nextId(graph, 'n-cmp');
      const blockNode: CanvasNode = {
        id: block.id,
        x: cx,
        y: cy,
        kind: 'block',
        label: op.title,
        compositeId: def.id,
      };
      next.meta = block.graph.meta;
      next.nodes = [...nodes.filter((node) => !ids.has(node.id)), blockNode];
      next.edges = edges.flatMap((edge) => {
        if (internalIds.has(edge.id)) return [];
        const hit = boundary.get(edge.id);
        if (!hit || !edge.points || edge.points.length < 2) return [edge];
        const last = edge.points.length - 1;
        const points = edge.points.map((p, index) =>
          (index === 0 && hit.innerEnd === 0) || (index === last && hit.innerEnd === 1) ? hit.target : p,
        );
        return [{ ...edge, points }];
      });
      return {
        graph: next,
        rules: [`已封装「${op.title}」：${members.length} 个器件 → 1 个复合器件（${portNodes.length} 个端口）`],
      };
    }
    case 'expandComposite': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim?.compositeId) return { graph, rules, refused: '这不是复合器件，摊不开。' };
      const def = allComposites()[victim.compositeId];
      const out = expandComposites(graph);
      return {
        graph: out.graph,
        rules: [...rules, ...out.rules, ...(def ? [`已摊开「${def.title}」——再点「收拢」可合回去`] : [])],
      };
    }
    case 'collapseComposite': {
      const m = /^cmp\/([^/]+)\//.exec(op.nodeId);
      const def = m ? allComposites()[m[1]] : undefined;
      if (!m || !def) return { graph, rules, refused: '找不到这个复合器件的定义（先封装一次才会有前缀）。' };
      const prefix = m[0];
      const groupNodes = nodes.filter((node) => node.id.startsWith(prefix));
      if (groupNodes.length === 0) return { graph, rules, refused: '画布上没有这一组内层器件。' };
      // 块放回内层包围盒中心；端口目标坐标 = 内层引脚位置。
      const gx = groupNodes.map((node) => node.x);
      const gy = groupNodes.map((node) => node.y);
      const cx = (Math.min(...gx) + Math.max(...gx)) / 2;
      const cy = (Math.min(...gy) + Math.max(...gy)) / 2;
      const pins = portPins(def);
      const targetOf = new Map<string, [number, number]>();
      for (const port of def.ports) {
        const inner = groupNodes.find((node) => node.id === `${prefix}${port.nodeId}`);
        if (!inner) continue;
        targetOf.set(port.id, [inner.x, inner.y]);
      }
      // W22-A：收拢回来的块 id 走单调 seq（摊开 → 收拢 → 再摊开不撞）。
      const block = nextId(graph, 'n-cmp');
      const blockNode: CanvasNode = { id: block.id, x: cx, y: cy, kind: 'block', label: def.title, compositeId: def.id };
      next.meta = block.graph.meta;
      next.nodes = [...nodes.filter((node) => !node.id.startsWith(prefix)), blockNode];
      next.edges = edges.flatMap((edge) => {
        if (edge.id.startsWith(prefix)) return [];
        if (edge.points && edge.points.length >= 2) {
          const first = edge.points[0];
          const last = edge.points[edge.points.length - 1];
          let a: [number, number] | null = null;
          let b: [number, number] | null = null;
          for (const [index, port] of def.ports.entries()) {
            const target = targetOf.get(port.id);
            if (!target) continue;
            const pin = [cx + pins[index].x, cy + pins[index].y] as [number, number];
            if (Math.hypot(first[0] - target[0], first[1] - target[1]) <= 0.6) a = pin;
            if (Math.hypot(last[0] - target[0], last[1] - target[1]) <= 0.6) b = pin;
          }
          if (!a && !b) return [edge];
          const lastIdx = edge.points.length - 1;
          return [{ ...edge, points: edge.points.map((p, index) => ((index === 0 && a) || (index === lastIdx && b) ? ((index === 0 ? a : b) as [number, number]) : p)) }];
        }
        return [edge];
      });
      return { graph: next, rules: [...rules, `已收拢「${def.title}」成复合块`] };
    }
    case 'ungroupComposite': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim?.compositeId) return { graph, rules, refused: '这不是复合器件，拆不开。' };
      const def = allComposites()[victim.compositeId];
      const out = expandComposites(graph);
      // 永久解散：去掉 cmp/<id>/ 前缀（撞名就带序号），定义保留。
      const strip = (id: string) => id.replace(/^cmp\/[^/]+\//, '');
      const used = new Set(nodes.filter((node) => !node.id.startsWith('cmp/')).map((node) => node.id));
      const renameMap = new Map<string, string>();
      for (const node of out.graph.nodes) {
        if (!node.id.startsWith('cmp/')) continue;
        let fresh = strip(node.id);
        for (let i = 2; used.has(fresh); i += 1) fresh = `${strip(node.id)}-${i}`;
        used.add(fresh);
        renameMap.set(node.id, fresh);
      }
      const stripped: CanvasGraph = {
        ...out.graph,
        nodes: out.graph.nodes.map((node) => (renameMap.has(node.id) ? { ...node, id: renameMap.get(node.id) as string } : node)),
        edges: out.graph.edges.map((edge) => ({
          ...edge,
          id: renameMap.has(edge.id) ? (renameMap.get(edge.id) as string) : edge.id.replace(/^cmp\/[^/]+\//, ''),
          ...(renameMap.has(edge.from) ? { from: renameMap.get(edge.from) as string } : {}),
          ...(renameMap.has(edge.to) ? { to: renameMap.get(edge.to) as string } : {}),
        })),
      };
      return {
        graph: stripped,
        rules: [...rules, `已拆开「${def?.title ?? victim.compositeId}」（实例解散，定义保留在组件定义区里）`],
      };
    }
    case 'editCompositePorts': {
      const block = nodes.find((node) => node.id === op.nodeId);
      if (!block?.compositeId) return { graph, rules, refused: '这不是复合器件，编辑不了端口。' };
      const old = allComposites()[block.compositeId];
      if (!old) return { graph, rules, refused: '找不到这个复合器件的定义。' };
      const oldPins = portPins(old);
      const portWires = (portId: string): string[] =>
        edges
          .filter((edge) => {
            if (!edge.points || edge.points.length < 2) return false;
            const [wx, wy] = [block.x + oldPins.find((pin) => pin.id === portId)!.x, block.y + oldPins.find((pin) => pin.id === portId)!.y];
            const first = edge.points[0];
            const last = edge.points[edge.points.length - 1];
            return Math.hypot(first[0] - wx, first[1] - wy) <= 0.6 || Math.hypot(last[0] - wx, last[1] - wy) <= 0.6;
          })
          .map((edge) => edge.id);
      // 删端口：还接着线的端口不许删（会留悬空导线），如实拒绝。
      for (const port of old.ports) {
        if (op.ports.some((one) => one.id === port.id)) continue;
        const wires = portWires(port.id);
        if (wires.length > 0) {
          return { graph, rules, refused: `端口「${port.label}」还接着 ${wires.length} 条导线 —— 先删线再删端口。` };
        }
      }
      const nextDef: CompositeDef = {
        ...old,
        title: op.title,
        ...(op.note !== undefined ? { note: op.note } : {}),
        ports: op.ports.map((port) => ({ id: port.id, nodeId: port.nodeId, label: port.label })),
        ...(op.modelSpec ? { modelSpec: op.modelSpec } : {}),
        ...(op.goldenRefs ? { goldenRefs: op.goldenRefs } : {}),
      };
      const newPins = portPins(nextDef);
      // 幸存端口的引脚位置可能因增删而平移：把导线端点从旧位置搬到新位置。
      next.edges = edges.map((edge) => {
        if (!edge.points || edge.points.length < 2) return edge;
        let points = edge.points;
        for (const oldPort of old.ports) {
          const survivor = nextDef.ports.find((one) => one.id === oldPort.id);
          if (!survivor) continue;
          const oldPin = oldPins.find((pin) => pin.id === oldPort.id);
          const newPin = newPins.find((pin) => pin.id === oldPort.id);
          if (!oldPin || !newPin) continue;
          const from = [block.x + oldPin.x, block.y + oldPin.y] as [number, number];
          const to = [block.x + newPin.x, block.y + newPin.y] as [number, number];
          if (from[0] === to[0] && from[1] === to[1]) continue;
          const last = points.length - 1;
          points = points.map((p, index) =>
            (index === 0 && Math.hypot(p[0] - from[0], p[1] - from[1]) <= 0.6) ||
            (index === last && Math.hypot(p[0] - from[0], p[1] - from[1]) <= 0.6)
              ? to
              : p,
          );
        }
        return points === edge.points ? edge : { ...edge, points };
      });
      registerComposites([nextDef]);
      storeComposites([...loadStoredComposites().filter((one) => one.id !== nextDef.id), nextDef]);
      return { graph: { ...graph, nodes, edges: next.edges }, rules: [`已更新复合器件「${nextDef.title}」（${nextDef.ports.length} 个端口）`] };
    }
    /* ── W16 三个缺失的操作：设参数 / 旋转 / 删线 ────────────────── */
    case 'setDeviceValue': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.nodeId}」这个器件。` };
      if (victim.kind === 'text' || victim.kind === 'dot') {
        return { graph, rules, refused: '标注 / 结点没有数值可改。' };
      }
      if (victim.compositeId) {
        return { graph, rules, refused: '复合器件的数值在内层器件上 —— 先摊开再改。' };
      }
      if (!valueInRange(victim.kind, op.value)) {
        return { graph, rules, refused: valueRangeNote(victim.kind) };
      }
      if (!UNIT_OF[victim.kind]) {
        return {
          graph,
          rules,
          refused: `「${victim.label ?? victim.kind}」的数值带物理单位语义（不是裸数），暂不支持直接改 —— 用参数表或恢复骨架。`,
        };
      }
      victim.value = op.value;
      victim.label = rewriteLabel(victim.kind, victim.label, op.value);
      // 不是结构改动：appliedRules 不新增，人话走 note（页面 toast 用）。
      return { graph: next, rules: [], note: `已把「${deviceName(victim.label, victim.kind)}」设为 ${formatValue(victim.kind, op.value)}${UNIT_OF[victim.kind]}` };
    }
    /* ── W24：器件模型参数（gm / ro / β / VA / Vf…）的可编辑入口 ────────
       netSolve 的 npn / nmos 分支直接读 node.params，以前这张表只能由
       applyParams 从骨架默认值写回；用户拿着一张没有 params 的管子时，
       拒答说「缺 gm / ro」，界面却没有任何输入框能补。一条 op 写多个器件，
       避免逐字段 mutate 基于同一份 ui 闭包互相覆盖。 */
    case 'setDeviceParams': {
      if (op.entries.length === 0) return { graph, rules, refused: '没有要写入的模型参数。' };
      const targets = op.entries.map((entry) => ({ entry, node: nodes.find((one) => one.id === entry.nodeId) }));
      for (const { entry, node } of targets) {
        if (!node) return { graph, rules, refused: `画布上没有「${entry.nodeId}」这个器件。` };
        if (node.compositeId) return { graph, rules, refused: '复合器件的模型参数在内层器件上 —— 先摊开再改。' };
        const allowed = new Set(deviceParamFields(node).map((field) => field.key));
        for (const [key, value] of Object.entries(entry.params ?? {})) {
          if (!allowed.has(key)) return { graph, rules, refused: `「${key}」不是「${node.label ?? node.kind}」的模型参数。` };
          if (!(Number.isFinite(value) && value > 0 && value <= 1e12)) {
            return { graph, rules, refused: `${key} 要在 (0, 1e12] 里：负数 / 0 / 空都不收。` };
          }
        }
        if (entry.value !== undefined && !(Number.isFinite(entry.value) && entry.value > 0 && entry.value <= 1e12)) {
          return { graph, rules, refused: '器件数值要在 (0, 1e12] 里：负数 / 0 / 空都不收。' };
        }
      }
      const written: string[] = [];
      for (const { entry, node } of targets) {
        if (!node) continue;
        node.params = { ...(node.params ?? {}), ...(entry.params ?? {}) };
        if (entry.value !== undefined) {
          node.value = entry.value;
          node.label = rewriteLabel(node.kind, node.label, entry.value);
          written.push(`Ic=${formatValue(node.kind, entry.value)}`);
        }
        for (const [key, value] of Object.entries(entry.params ?? {})) written.push(`${key}=${value}`);
      }
      return { graph: next, rules: [], note: `已给 ${targets.length} 个器件补上模型参数：${written.join(' / ')}` };
    }
    case 'rotateDevice': {
      const victim = nodes.find((node) => node.id === op.nodeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.nodeId}」这个器件。` };
      if (victim.kind === 'text' || victim.kind === 'dot') {
        return { graph, rules, refused: '标注 / 结点不转。' };
      }
      if (victim.compositeId || victim.kind === 'block') {
        return { graph, rules, refused: '复合 / 功能块的端口由定义给出，不跟着旋转 —— 要转就先摊开。' };
      }
      const delta = op.delta ?? 90;
      const before = graph;
      victim.rot = ((((victim.rot ?? 0) + delta) % 360) + 360) % 360;
      // 旋转改了引脚世界坐标：导线端点跟着引脚走（relayout 按 anchor key 把
      // 旧端点搬到新引脚位置，中间折点插值），自由端（Vo 输出头等）不动。
      if (ROTATE_CONFIG.resnap) next.edges = relayout(before, next);
      rules.push(`已把「${victim.label ?? victim.kind}」旋转 ${delta}°${ROTATE_CONFIG.resnap ? '，导线端点重新吸附到新引脚' : ''}`);
      return { graph: next, rules };
    }
    case 'deleteEdge': {
      const victim = edges.find((edge) => edge.id === op.edgeId);
      if (!victim) return { graph, rules, refused: `画布上没有「${op.edgeId}」这条线。` };
      if (graph.family === 'beam') {
        return { graph, rules, refused: '构件 / 构件请用「构件 / 构件」列表的删按钮（同 deleteMember）。' };
      }
      next.edges = edges.filter((edge) => edge.id !== op.edgeId);
      const details: string[] = [];
      if (DELETE_EDGE_CONFIG.prune) {
        // 删线 = 这里断开了：被删线的全部顶点是「这次失连」的位置，
        // 触碰到它们的空头端点回缩到最后附着点，随后复查孤立 dot。
        const lostXys: [number, number][] =
          victim.points && victim.points.length >= 2 ? victim.points.map((p) => [p[0], p[1]] as [number, number]) : edgeEndPoints(victim, new Map(nodes.map((node) => [node.id, node])));
        const retract = retractFreeEnds(next.nodes, next.edges, graph.family, lostXys);
        next.edges = retract.edges;
        const deviceAnchors = next.nodes
          .filter((node) => node.kind !== 'text' && node.kind !== 'dot')
          .flatMap((node) => anchorsOfNode(node, graph.family).map((anchor) => [anchor.x, anchor.y] as [number, number]));
        const beforeDots = next.nodes.filter((node) => node.kind === 'dot').length;
        next.nodes = next.nodes.filter((node) => {
          if (node.kind !== 'dot') return true;
          const touched = next.edges.some((edge) => edge.points && edge.points.length >= 2 && polylineTouches(edge.points, node.x, node.y, 0.6));
          const pinned = deviceAnchors.some(([px, py]) => Math.hypot(px - node.x, py - node.y) <= 1.0);
          return touched || pinned;
        });
        const removedDots = beforeDots - next.nodes.filter((node) => node.kind === 'dot').length;
        if (removedDots > 0) details.push(`清理 ${removedDots} 个失效结点`);
        if (retract.retracted > 0) details.push(`回缩 ${retract.retracted} 处空头端点`);
        if (retract.dropped > 0) details.push(`裁掉 ${retract.dropped} 条失连短线`);
      }
      rules.push(`已删除导线 ${victim.id}${details.length > 0 ? `；${details.join('、')}` : ''}（断开的连接由归约判据说话）`);
      return { graph: next, rules };
    }
    default:
      return { graph, rules, refused: '不认识的操作。' };
  }
}
