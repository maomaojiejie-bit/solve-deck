/**
 * 复合器件（W13）：把一组器件封成带端口的模块。不写任何求解逻辑 ——
 * `expandComposites` 在 reduce() 的第一行把 composite 节点摊开成内层器件，
 * 之后一切照旧（既有 solver、既有六项校核、既有 F/N/U）。picks.ts 零改动。
 *
 * 关键语义：**端口就是内层某个节点**。外层接到 `块 · 端口` 的导线，展开后
 * 端点直接落到内层节点/引脚的同一坐标上 —— 内外两层是同一个电气节点
 * （graphToModel 按坐标合并结点）。不新建节点。
 *
 * 四条硬闸门（判 U，不进求解，原因码写进 problems）：
 *  missingModelSpec / missingGoldenCase / compositeOffWhitelist / 嵌套超 2 层。
 * 悬空端口只警告不阻断（悬空是合法电路状态），problems 里以「悬空端口：」
 * 开头，页面与 tierOf 识别它为非阻断警告。
 */

import { CIRCUIT_KINDS } from './ops.ts';
import { SYMBOLS } from '../../render/symbols.ts';
import { BUILTIN_COMPOSITES } from './compositeBuiltin.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';

export interface CompositePort {
  /** 对外端口 id（就是 composite 节点的引脚名）。 */
  id: string;
  /** 对应内层哪个节点（内层局部 id）。 */
  nodeId: string;
  /** 端口落在该内层节点的哪个引脚上；缺省 = 节点中心（dot / 结点）。 */
  pin?: string;
  /** 中文名，显示在引脚 tooltip 与端口标注面板。 */
  label: string;
}

export interface CompositeDef {
  id: string;
  title: string;
  note?: string;
  ports: CompositePort[];
  /** 局部坐标、局部 id。 */
  inner: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  modelSpec: {
    equations: string[];
    applicableRange: string;
    units: Record<string, string>;
  };
  /** 至少一条已校验夹具（check:lab 逐键校验过的快照 id）。 */
  goldenRefs: string[];
  createdAt: string;
}

export interface ExpandOutcome {
  graph: CanvasGraph;
  /** 逐个摊开的模块（写进 appliedRules 与 F 档徽章）。 */
  expanded: { compositeId: string; title: string; count: number }[];
  /** 硬闸门问题（判 U）。 */
  problems: string[];
  /** 非阻断警告（悬空端口），也进 problems 数组但以「悬空端口：」开头。 */
  warnings: string[];
  /** appliedRules 的人话证据。 */
  rules: string[];
  /** true → 整图判 U。 */
  fatal: boolean;
}

/** 变异开关（check:composite 三条变异用；默认全开 = 正式行为）。 */
export const COMPOSITE_CONFIG = {
  enforceModelSpec: true,
  enforceGoldenRefs: true,
  mergePorts: true,
  shareDefs: true,
};

/** 非阻断警告的统一前缀：页面拒答过滤与门禁断言都用它。 */
export const WARNING_PREFIX = '悬空端口：';

export function isBlockingProblem(problem: string): boolean {
  return !problem.startsWith(WARNING_PREFIX);
}

/** 图里复合器件实例的个数（F 档徽章文案与语义评分排除都用它）。 */
export function countComposites(graph: CanvasGraph): number {
  return graph.nodes.filter((node) => node.compositeId).length;
}

/* ── 定义来源：内置 + 会话注册（分享链接 / localStorage）──────────── */

import {
  COMPOSITE_STORAGE_KEY,
  allComposites as allRegistered,
  loadStoredComposites,
  registeredComposites,
  registerComposites as registerDefs,
  storeComposites as storeDefs,
} from './compositeStore.ts';

export { COMPOSITE_STORAGE_KEY, loadStoredComposites, registeredComposites };

/** 会话内可用的全部定义（内置 + 注册）。 */
export function allComposites(): Record<string, CompositeDef> {
  return allRegistered();
}

/** 分享链接载入 / localStorage 载入后注册进会话；同名内置定义不让覆盖。 */
export function registerComposites(defs: readonly CompositeDef[]): void {
  registerDefs(defs);
}

/** localStorage 读写（sd.lab.composite.v1 这个 key 名空间；SSR / 门禁环境静默跳过）。 */
export function storeComposites(defs: readonly CompositeDef[]): void {
  storeDefs(defs);
}

/* ── 端口几何：block 图元两侧引脚 ───────────────────────────────── */

/**
 * 端口引脚的局部坐标：左列（偶数序）x=-50、右列 x=50，按列纵向均分。
 * 与 SYMBOLS.block 的 in/out 引脚同一模数，展开与连线吸附共用这一份。
 */
export function portPins(def: CompositeDef): { id: string; x: number; y: number }[] {
  const perSide = Math.max(1, Math.ceil(def.ports.length / 2));
  return def.ports.map((port, index) => ({
    id: port.id,
    x: index % 2 === 0 ? -50 : 50,
    y: (Math.floor(index / 2) - (perSide - 1) / 2) * 40,
  }));
}

/* ── 白名单：复合器件不能当夹带通道 ─────────────────────────────── */

/**
 * 本图允许的内层器件种类 = 可加器件（CIRCUIT_KINDS）∪ 画布上原生器件的
 * 种类。opamp 不在 A3 的画布也不可加 → 白名单外；A7 画布原生有 opamp → 允许。
 * 力学图不设限（复合器件目前只服务电路）。
 */
export function compositeWhitelist(graph: CanvasGraph): Set<string> {
  const set = new Set<string>([...CIRCUIT_KINDS, 'dot', 'text', 'pin', 'gnd']);
  if (graph.family === 'beam') return new Set(['*']);
  for (const node of graph.nodes) {
    if (!node.compositeId && node.kind !== 'text' && node.kind !== 'dot') set.add(node.kind);
  }
  return set;
}

/* ── 展开 ───────────────────────────────────────────────────────── */

const PORT_TOL = 0.6;

function renameId(prefix: string, id: string): string {
  return `${prefix}${id}`;
}

/**
 * 内层节点某引脚的局部世界坐标（局部坐标系内）。与 pins.ts 的 rotateLocal
 * 同一规则（顺时针 90° 整数倍）；这里单独实现是为了避免 pins ↔ composite
 * 循环依赖（pins.ts 要 import 本模块的 portPins）。
 */
function innerPinPosition(node: CanvasNode, pinId: string): [number, number] {
  const pin = SYMBOLS[node.kind]?.pins.find((one) => one.id === pinId);
  if (!pin) return [node.x, node.y];
  const rot = ((node.rot ?? 0) % 360 + 360) % 360;
  const [dx, dy] =
    rot === 90 ? [-pin.y, pin.x] : rot === 180 ? [-pin.x, -pin.y] : rot === 270 ? [pin.y, -pin.x] : [pin.x, pin.y];
  return [node.x + dx, node.y + dy];
}

/** 内层包围盒中心（摊开时对到 composite 节点位置）。 */
function innerCenter(def: CompositeDef): [number, number] {
  const xs = def.inner.nodes.map((node) => node.x);
  const ys = def.inner.nodes.map((node) => node.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * 把一张图里的全部 composite 节点摊开。没有复合器件时**原样返回同一引用**
 * （reduce 的其余路径与既有门禁的 JSON 比较不受任何影响）。
 */
export function expandComposites(
  graph: CanvasGraph,
  defs: Record<string, CompositeDef> = allComposites(),
): ExpandOutcome {
  if (!graph.nodes.some((node) => node.compositeId)) {
    return { graph, expanded: [], problems: [], warnings: [], rules: [], fatal: false };
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  const rules: string[] = [];
  const expanded: { compositeId: string; title: string; count: number }[] = [];
  let fatal = false;

  /** 展开工作项：depth 0 = 原生节点，1 = 首层复合内层，2 = 第二层（到顶）。 */
  interface WorkItem {
    node: CanvasNode;
    depth: number;
    prefix: string;
    dx: number;
    dy: number;
  }
  const nodesOut: CanvasNode[] = [];
  const edgesOut: CanvasEdge[] = [];
  /** `${块节点id}:${portId}` → 块端口的世界坐标（探测外层端点落在哪个端口）。 */
  const portPos = new Map<string, [number, number]>();
  /** `${块节点id}:${portId}` → 合并目标（内层引脚/节点的世界坐标）。 */
  const portTarget = new Map<string, [number, number]>();
  /** `${块节点id}:${portId}` → 展开后的内层节点 id（无 points 的边改写 from/to 用）。 */
  const portNodeId = new Map<string, string>();
  /** 待检查悬空的端口：合并目标坐标 + 展示名。 */
  const portCheck: { x: number; y: number; display: string }[] = [];

  const queue: WorkItem[] = graph.nodes.map((node) => ({ node, depth: 0, prefix: '', dx: 0, dy: 0 }));
  while (queue.length > 0) {
    const item = queue.shift() as WorkItem;
    const { node } = item;
    if (!node.compositeId) {
      nodesOut.push(item.prefix ? { ...node, id: renameId(item.prefix, node.id), x: node.x + item.dx, y: node.y + item.dy } : node);
      continue;
    }
    const def = defs[node.compositeId];
    if (!def) {
      problems.push(`复合器件 ${node.compositeId} 没有定义（分享的图缺 defs？）——不进求解`);
      fatal = true;
      nodesOut.push(node);
      continue;
    }
    if (item.depth >= 2) {
      problems.push('复合器件嵌套超过 2 层 —— 整图判 U，不进求解');
      fatal = true;
      nodesOut.push(node);
      continue;
    }
    const ms = def.modelSpec;
    if (COMPOSITE_CONFIG.enforceModelSpec && (!ms?.equations?.length || !ms?.applicableRange?.trim() || !ms?.units || Object.keys(ms.units).length === 0)) {
      problems.push(`复合器件「${def.title}」缺 modelSpec（equations / applicableRange / units）——原因码 missingModelSpec，不进求解`);
      fatal = true;
      nodesOut.push(node);
      continue;
    }
    if (COMPOSITE_CONFIG.enforceGoldenRefs && (!def.goldenRefs || def.goldenRefs.length === 0)) {
      problems.push(`复合器件「${def.title}」没有已校验夹具（goldenRefs 为空）——原因码 missingGoldenCase，不进求解`);
      fatal = true;
      nodesOut.push(node);
      continue;
    }
    const whitelist = compositeWhitelist(graph);
    const off = def.inner.nodes.filter((inner) => !inner.compositeId && !whitelist.has(inner.kind));
    if (off.length > 0) {
      problems.push(
        `复合器件「${def.title}」内层含白名单外器件（${off.map((one) => one.kind).join('、')}）——原因码 compositeOffWhitelist，复合器件不能当夹带通道`,
      );
      fatal = true;
      nodesOut.push(node);
      continue;
    }

    // 摊开：内层包围盒中心对到 composite 节点位置。
    const [cx, cy] = innerCenter(def);
    const dx = node.x - cx + item.dx;
    const dy = node.y - cy + item.dy;
    const prefix = `${item.prefix}cmp/${def.id}/`;
    let count = 0;
    for (const inner of def.inner.nodes) {
      count += inner.kind !== 'text' ? 1 : 0;
      queue.push({ node: inner, depth: item.depth + 1, prefix, dx, dy });
    }
    for (const edge of def.inner.edges) {
      const points = edge.points?.map(([px, py]) => [px + dx, py + dy] as [number, number]);
      edgesOut.push({
        ...edge,
        id: renameId(prefix, edge.id),
        from: renameId(prefix, edge.from),
        to: renameId(prefix, edge.to),
        ...(points ? { points } : {}),
        owner: 'shared',
      });
    }
    for (const port of def.ports) {
      const pins = portPins(def);
      const pin = pins.find((one) => one.id === port.id);
      const wx = node.x + (pin?.x ?? 0);
      const wy = node.y + (pin?.y ?? 0);
      const target = def.inner.nodes.find((one) => one.id === port.nodeId);
      if (!target) continue;
      // 合并目标：port.pin 指定的内层引脚世界坐标；没指定 pin（dot / 结点）用节点中心。
      // mergePorts=false 的变异 = 新建节点（偏移 8px），params/坐标断言必须红。
      const local = port.pin ? innerPinPosition(target, port.pin) : [target.x, target.y];
      const tx = COMPOSITE_CONFIG.mergePorts ? local[0] + dx : wx + 8;
      const ty = COMPOSITE_CONFIG.mergePorts ? local[1] + dy : wy + 8;
      portPos.set(`${node.id}:${port.id}`, [wx, wy]);
      portTarget.set(`${node.id}:${port.id}`, [tx, ty]);
      portNodeId.set(`${node.id}:${port.id}`, renameId(prefix, port.nodeId));
      portCheck.push({ x: tx, y: ty, display: `复合器件「${def.title}」的端口 ${port.label}` });
    }
    expanded.push({ compositeId: def.id, title: def.title, count });
    rules.push(`展开复合器件「${def.title}」（${count} 器件）`);
  }

  // 外层边：端点若落在某个被摊开节点的端口上 → 重写到合并目标坐标。
  const portList = [...portPos.entries()].map(([key, [wx, wy]]) => ({ key, wx, wy }));
  for (const edge of graph.edges) {
    if (edge.points && edge.points.length >= 2) {
      const hit = (p: [number, number]): [number, number] | null => {
        for (const port of portList) {
          if (Math.hypot(port.wx - p[0], port.wy - p[1]) <= PORT_TOL) return portTarget.get(port.key) as [number, number];
        }
        return null;
      };
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];
      const a = hit(first);
      const b = hit(last);
      if (!a && !b) {
        edgesOut.push(edge);
        continue;
      }
      const points = edge.points.map((p, index) => {
        if (index === 0 && a) return a;
        if (index === edge.points!.length - 1 && b) return b;
        return p;
      });
      edgesOut.push({ ...edge, points });
      continue;
    }
    // 无 points 的边：from/to 可能是 `${块id}:${portId}` 引脚键 → 改指内层节点。
    const fromKey = portNodeId.get(edge.from);
    const toKey = portNodeId.get(edge.to);
    if (!fromKey && !toKey) {
      edgesOut.push(edge);
      continue;
    }
    edgesOut.push({
      ...edge,
      ...(fromKey ? { from: fromKey } : {}),
      ...(toKey ? { to: toKey } : {}),
    });
  }

  // 悬空端口：警告不阻断（悬空是合法电路状态）。
  for (const port of portCheck) {
    const attached = edgesOut.some((edge) => {
      if (edge.points && edge.points.length >= 2) {
        const first = edge.points[0];
        const last = edge.points[edge.points.length - 1];
        return Math.hypot(first[0] - port.x, first[1] - port.y) <= PORT_TOL || Math.hypot(last[0] - port.x, last[1] - port.y) <= PORT_TOL;
      }
      return false;
    });
    if (!attached) warnings.push(`${WARNING_PREFIX}${port.display}没有连接（悬空是合法电路状态，仅提醒）`);
  }

  return {
    graph: { ...graph, nodes: nodesOut, edges: edgesOut },
    expanded,
    problems,
    warnings,
    rules,
    fatal,
  };
}

/* ── 分享（§5）：图里引用的 CompositeDef 必须随链接一起走 ────────── */

export interface SharePayload {
  graph: CanvasGraph;
  /** 只带本次用到的，不带全部。 */
  defs?: CompositeDef[];
}

export function usedCompositeDefs(graph: CanvasGraph, defs: Record<string, CompositeDef> = allComposites()): CompositeDef[] {
  const usedIds = new Set(graph.nodes.filter((node) => node.compositeId).map((node) => node.compositeId as string));
  if (!COMPOSITE_CONFIG.shareDefs) return [];
  const builtin = new Set(Object.keys(BUILTIN_COMPOSITES));
  return [...usedIds]
    .filter((id) => defs[id] && !builtin.has(id)) // 内置定义人手一份，不进链接
    .map((id) => defs[id]);
}

function toBase64(value: string): string {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(value)));
  return Buffer.from(value, 'utf8').toString('base64');
}

function fromBase64(value: string): string {
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(value)));
  return Buffer.from(value, 'base64').toString('utf8');
}

export function encodeSharePayload(payload: SharePayload): string {
  return toBase64(JSON.stringify(payload));
}

/** 兼容两种历史格式：裸 CanvasGraph（W12 前）与 { graph, defs }。 */
export function decodeSharePayload(raw: string): SharePayload | null {
  try {
    const parsed = JSON.parse(fromBase64(raw)) as SharePayload | CanvasGraph;
    if ('nodes' in parsed && 'edges' in parsed) return { graph: parsed as CanvasGraph };
    if (parsed && 'graph' in parsed) return parsed as SharePayload;
    return null;
  } catch {
    return null;
  }
}
