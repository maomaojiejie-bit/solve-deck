/**
 * S1–S7 共用件：几何→画布的映射、图组装、以及从 mechanics/common 复用的
 * 步骤骨架 / 校验表 / 结论位（同一条规矩：图上每个数字都来自 solver）。
 *
 * 静力学的图形全部复用现有 schematic 渲染器（节点 + 折线边），
 * 不新写渲染器：桁架 = 直的折线边，截面 = 闭合折线，杠杆 = 一条边 + 支座图元。
 */

import type { RenderSpec, Step } from '../../types.ts';
import type { MechCheck } from '../../mechanics/solve.ts';

export {
  num,
  step,
  selfCheck,
  checksMatrix,
  pendingConfidence,
  framesFor,
  chartOf,
  chartPair,
} from '../mechanics/common.ts';
export type { ParamRecord } from '../mechanics/common.ts';

export type Pt2 = { x: number; y: number };

export interface FrameMap {
  sx: (x: number) => number;
  sy: (y: number) => number;
  w: number;
  h: number;
}

/**
 * 模型坐标（y 向上）→ 画布坐标（y 向下）。
 * 传进来的点决定包围盒，等比缩放（**横纵同一比例**，否则截面图和桁架会变形）。
 */
export function frameOf(
  points: Pt2[],
  options: { w?: number; h?: number; pad?: number } = {},
): FrameMap {
  const w = options.w ?? 760;
  const h = options.h ?? 300;
  const pad = options.pad ?? 64;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offsetX = (w - spanX * scale) / 2;
  const offsetY = (h - spanY * scale) / 2;
  return {
    w,
    h,
    sx: (x: number) => offsetX + (x - minX) * scale,
    sy: (y: number) => h - offsetY - (y - minY) * scale,
  };
}

export interface FigureOptions {
  id: string;
  nodes: RenderSpec['nodes'];
  edges: RenderSpec['edges'];
  type?: 'freebody' | 'truss';
  role?: 'primary' | 'secondary';
  /** 分步高亮帧；缺省空（全图不上色）。 */
  frames?: RenderSpec['frames'];
}

export function figureOf(options: FigureOptions): RenderSpec {
  return {
    id: options.id,
    role: options.role ?? 'primary',
    type: options.type ?? 'freebody',
    nodes: options.nodes,
    edges: options.edges,
    frames: options.frames ?? [],
  };
}

/** 一条直杆 / 轮廓折线。 */
export function memberEdge(
  id: string,
  from: [number, number],
  to: [number, number],
  extra: { weight?: 1 | 2; tag?: string; dashed?: boolean } = {},
): RenderSpec['edges'][number] {
  return {
    id,
    from: `${id}-a`,
    to: `${id}-b`,
    kind: 'line',
    weight: extra.weight ?? 2,
    points: [from, to],
    ...(extra.tag ? { tag: extra.tag } : {}),
    ...(extra.dashed ? { dashed: true } : {}),
  };
}

/** 把 mm 数排成好看的行内文本（校验表 / 结论位共用）。 */
export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/** 拉力为正 → 「拉/压」标注。 */
export function tensionLabel(force: number): string {
  if (Math.abs(force) < 1e-9) return '零杆';
  return force > 0 ? '拉' : '压';
}

export type { MechCheck, Step };
