/**
 * render_specs[0] → CanvasPreset：纯函数。
 *
 * 快照节点/边原样搬进 CanvasGraph（不丢 label / rot / labelSide / points），
 * 再把 pick 表算出的器件数值种上去。骨架不改 = 种子值就是模板默认值 =
 * 快照 parsed_given —— 这是 check:lab「逐键相等」的全部依据。
 */

import type { RenderSpec } from '../types.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';
import { anchorsOfNode } from './pins.ts';
import { foldSupports, supportSpecNodes } from './attach.ts';

/**
 * W13 P0 归属开关：变异测试把它关掉 = owner 永远 undefined，
 * deleteDevice 对快照边一条都删不掉 —— check:assemble ㉑ 必须变红。
 */
export const OWNER_CONFIG = { enabled: true };

/** 端点吸附容差：与 pins.ts 的 snapAnchor 同一档（0.6）。 */
const OWNER_TOL = 0.6;

/** 点到线段的距离（owner 的穿越判定用）。 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 边的折线：有 points 用 points；否则 from/to 解析节点 id 或 'x,y' 坐标串。 */
function edgePolyline(edge: CanvasEdge, nodeById: Map<string, CanvasNode>): [number, number][] {
  if (edge.points && edge.points.length >= 2) return edge.points;
  const end = (raw: string): [number, number] | null => {
    const node = nodeById.get(raw);
    if (node) return [node.x, node.y];
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = end(edge.from);
  const b = end(edge.to);
  return a && b ? [a, b] : [];
}

/**
 * W13 P0：给每条边、每个 dot 打 owner。
 *
 *  - 恰好落在一个器件上（端点吸附其引脚）→ owner = 该器件 id；
 *  - 跨器件 / 落在 dot 或汇流条上（VCC 母线、地轨、输出端）→ 'shared'；
 *  - 两端都悬空的装饰线（如 A3 的 AC 地横杠 e-vcc-bar，两端不接任何东西、
 *    只是横穿 n-rc:b 引脚）→ 按穿越归到它跨过的那个器件 —— 否则删器件时
 *    这类线永远没人认领；
 *  - 力学边（杆 / 梁，from/to 是节点 id）一律 'shared'：删支座不删杆。
 *  每条边、每个 dot 只属于一个器件或 shared，删除与连通性检查都靠它。
 */
function computeOwners(nodes: CanvasNode[], edges: CanvasEdge[], family: CanvasGraph['family']): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const devicePoints = nodes
    .filter((node) => node.kind !== 'text' && node.kind !== 'dot')
    .map((node) => ({
      id: node.id,
      pts: anchorsOfNode(node, family).map((anchor) => [anchor.x, anchor.y] as [number, number]),
    }));
  const dots = nodes.filter((node) => node.kind === 'dot');
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= OWNER_TOL;

  for (const edge of edges) {
    if (family === 'beam') {
      edge.owner = 'shared';
      continue;
    }
    const poly = edgePolyline(edge, nodeById);
    if (poly.length < 2) {
      edge.owner = 'shared';
      continue;
    }
    const ends: [number, number][] = [poly[0], poly[poly.length - 1]];
    const attach = new Set<string>();
    for (const [x, y] of ends) {
      for (const device of devicePoints) {
        if (device.pts.some(([px, py]) => near(px, py, x, y))) attach.add(device.id);
      }
    }
    const attachedSomewhere = ends.some(([x, y]) =>
      dots.some((dot) => near(dot.x, dot.y, x, y)) || devicePoints.some((d) => d.pts.some(([px, py]) => near(px, py, x, y))),
    );
    if (attach.size === 0 && !attachedSomewhere) {
      // 悬空装饰线：按穿越归到它跨过的器件（跨多个 → shared）。
      for (const device of devicePoints) {
        for (let i = 0; i < poly.length - 1; i += 1) {
          const [ax, ay] = poly[i];
          const [bx, by] = poly[i + 1];
          if (device.pts.some(([px, py]) => segDist(px, py, ax, ay, bx, by) <= OWNER_TOL)) {
            attach.add(device.id);
            break;
          }
        }
      }
    }
    edge.owner = attach.size === 1 ? [...attach][0] : 'shared';
  }

  for (const dot of dots) {
    const hit = devicePoints.filter((device) => device.pts.some(([px, py]) => near(px, py, dot.x, dot.y)));
    dot.owner = hit.length === 1 ? hit[0].id : 'shared';
  }

  // W14：文字标注跟随它最近的那条边 —— e-vcc-bar 归 n-rc，横杠删了
  // 「VCC（交流地）」这行字不该留在半空。容差放宽到 16（文字锚点离线头有距离）；
  // 找不到边 / 最近边是 shared → owner 不设，永不随器件删除（Vo 这类输出标注保留）。
  const TEXT_TOL = 16;
  for (const text of nodes.filter((node) => node.kind === 'text')) {
    let best: { dist: number; owner: string } | null = null;
    for (const edge of edges) {
      const poly = edgePolyline(edge, nodeById);
      for (let i = 0; i + 1 < poly.length; i += 1) {
        const dist = segDist(text.x, text.y, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
        if (dist <= TEXT_TOL && (!best || dist < best.dist)) best = { dist, owner: edge.owner ?? 'shared' };
      }
    }
    if (best && best.owner !== 'shared') text.owner = best.owner;
  }
}

export interface DeviceSeed {
  value?: number;
  params?: Record<string, number>;
  semantic?: string;
}

export interface FromSpecOptions {
  /** 归一化器件名 → 数值种子（由 picks.ts 的 seedGraph 给出）。 */
  seeds?: Record<string, DeviceSeed>;
  /** 骨架级参数（config / Vt / L / H…）。 */
  meta?: Record<string, number | string>;
  /** 骨架里要剥掉的节点 id 前缀（解出来的反力不是输入）。 */
  stripIdPrefixes?: string[];
  /** 要剥掉的节点 kind（同上，按图元种类剥）。 */
  stripKinds?: string[];
}

/** 'n-rc' → 'RC'；'n-q' → 'Q'；'n-load-0' → 'LOAD-0'。 */
export function normalizeDeviceId(id: string): string {
  return id.replace(/^n-/, '').replace(/-\d+$/, '').toUpperCase();
}

function stripSpec(spec: RenderSpec, options: FromSpecOptions): { nodes: RenderSpec['nodes']; edges: RenderSpec['edges'] } {
  const drop = (node: RenderSpec['nodes'][number]): boolean =>
    (options.stripIdPrefixes ?? []).some((prefix) => node.id.startsWith(prefix)) ||
    (options.stripKinds ?? []).includes(node.kind);
  const removed = new Set(spec.nodes.filter(drop).map((node) => node.id));
  return {
    nodes: spec.nodes.filter((node) => !removed.has(node.id)),
    edges: spec.edges.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to) && !(options.stripIdPrefixes ?? []).some((p) => edge.id.startsWith(p)),
    ),
  };
}

export function graphFromSpec(spec: RenderSpec, templateId: string, family: 'circuit' | 'beam', options: FromSpecOptions = {}): CanvasGraph {
  const { nodes: rawNodes, edges } = stripSpec(spec, options);
  const matchSeed = (node: RenderSpec['nodes'][number]): DeviceSeed | undefined => {
    for (const [key, seed] of Object.entries(options.seeds ?? {})) {
      const want = key.toUpperCase();
      if ((node.label ?? '').trim().toUpperCase().startsWith(want)) return seed;
      if (normalizeDeviceId(node.id) === want) return seed;
      if (node.kind.toUpperCase() === want) return seed;
    }
    return undefined;
  };
  const nodes: CanvasNode[] = rawNodes.map((node) => {
    const seed = matchSeed(node);
    return {
      ...node,
      ...(seed?.value !== undefined ? { value: seed.value } : {}),
      ...(seed?.params ? { params: { ...seed.params } } : {}),
      ...(seed?.semantic ? { semantic: seed.semantic } : {}),
    };
  });
  const canvasEdges: CanvasEdge[] = edges.map((edge) => ({ ...edge }));
  if (OWNER_CONFIG.enabled) computeOwners(nodes, canvasEdges, family);
  // R3-1 A1：快照里的独立支座图元在这里折成结点属性（35 份快照一个字都不改）。
  // 折不到结点上的 → 保留成图元，交给 resolve 的 supportOffJoint 判 U。
  const graph: CanvasGraph = {
    templateId,
    family,
    nodes,
    edges: canvasEdges,
    meta: { ...(options.meta ?? {}) },
  };
  return family === 'beam' ? foldSupports(graph) : graph;
}

/** CanvasGraph → RenderSpec：供 SpecGrid 照常渲染；器件数值不进 spec（数值只在标签里）。 */
export function graphToSpec(graph: CanvasGraph, type: string, role: 'primary' | 'secondary' = 'primary'): RenderSpec {
  const nodes: RenderSpec['nodes'] = graph.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    kind: node.kind,
    ...(node.label !== undefined ? { label: node.label } : {}),
    ...(node.rot !== undefined ? { rot: node.rot } : {}),
    ...(node.labelSide !== undefined ? { labelSide: node.labelSide } : {}),
    // W13：复合器件实例往返必须保留 compositeId（门禁会验）。
    ...(node.compositeId !== undefined ? { compositeId: node.compositeId } : {}),
  }));
  // R3-1：结点属性形态的支座按折叠前的位置插回图元数组 —— 画面（含图层顺序）
  // 与快照逐字一致，但图里没有第二个「点」可点、可拖、可删。
  const supports = supportSpecNodes(graph).sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  for (const support of supports) {
    const { order, ...glyph } = support;
    nodes.splice(Math.min(order ?? nodes.length, nodes.length), 0, glyph);
  }
  return {
    id: 'main',
    role,
    type: type as RenderSpec['type'],
    nodes,
    edges: graph.edges.map((edge) => ({ ...edge })) as CanvasEdge[] as RenderSpec['edges'],
    frames: [],
  };
}
