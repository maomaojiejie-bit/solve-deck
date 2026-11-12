/**
 * 积木式电路装配器。
 *
 * 用法：
 *   const b = board()
 *   const q = b.part('n-q', 'npn', [520, 270], { label: 'Q' })
 *   const rc = b.part('n-rc', 'res', [530, 170], { rot: 90, label: 'Rc 2.0k', labelSide: 'right' })
 *   b.wire('e-rc-c', [rc.pin('b'), q.pin('c')])
 *
 * 关键点：**导线端点只能来自 `part().pin()`**，因此不可能出现「导线接到器件中心」这种错。
 * 器件只摆中心点 + 旋转角，引脚坐标由符号表给出（GB/T 4728 形状）。
 */

import { pinAt } from '../../render/symbols.ts';
import type { LayoutEdge, LayoutNode } from './types.ts';

export type Pt = [number, number];

export interface Part {
  readonly id: string;
  readonly kind: string;
  readonly at: Pt;
  readonly rot: number;
  /** 引脚世界坐标。 */
  pin(name: string): Pt;
}

export interface WireOpts {
  dashed?: boolean;
  tag?: string;
  label?: string;
  weight?: 1 | 2;
}

export interface Board {
  readonly nodes: LayoutNode[];
  readonly edges: LayoutEdge[];
  part(
    id: string,
    kind: string,
    at: Pt,
    opts?: { rot?: number; label?: string; labelSide?: 'up' | 'down' | 'left' | 'right' },
  ): Part;
  /** 只出字不出图（端口名、极性、轨名）。 */
  text(id: string, at: Pt, label: string, side?: 'up' | 'down' | 'left' | 'right'): Pt;
  /** 实心连接点。 */
  dot(id: string, at: Pt, label?: string, side?: 'up' | 'down' | 'left' | 'right'): Pt;
  /** 一条导线（折线），端点应来自 pin()。 */
  wire(id: string, pts: Pt[], opts?: WireOpts): void;
  /** 两点直连：同轴一条线，否则单折（先沿 from 的主轴）。 */
  link(id: string, a: Pt, b: Pt, opts?: WireOpts & { bend?: 'h' | 'v' }): void;
}

export function board(): Board {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const used = new Set<string>();

  function claim(id: string) {
    if (used.has(id)) throw new Error(`积木 id 重复：${id}`);
    used.add(id);
  }

  const api: Board = {
    nodes,
    edges,
    part(id, kind, at, opts = {}) {
      claim(id);
      const rot = opts.rot ?? 0;
      nodes.push({
        id,
        x: at[0],
        y: at[1],
        kind,
        label: opts.label ?? '',
        ...(rot ? { rot } : {}),
        ...(opts.labelSide ? { labelSide: opts.labelSide } : {}),
      });
      return { id, kind, at, rot, pin: (name: string) => pinAt(kind, at, rot, name) };
    },
    text(id, at, label, side = 'up') {
      claim(id);
      nodes.push({ id, x: at[0], y: at[1], kind: 'text', label, labelSide: side });
      return at;
    },
    dot(id, at, label = '') {
      claim(id);
      nodes.push({ id, x: at[0], y: at[1], kind: 'dot', label });
      return at;
    },
    wire(id, pts, opts = {}) {
      claim(id);
      if (pts.length < 2) throw new Error(`导线 ${id} 至少两个点`);
      edges.push({
        id,
        from: pts[0].join(','),
        to: pts[pts.length - 1].join(','),
        kind: 'wire',
        points: pts,
        ...(opts.dashed ? { dashed: true } : {}),
        ...(opts.tag ? { tag: opts.tag } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.weight ? { weight: opts.weight } : {}),
      });
    },
    link(id, a, b, opts = {}) {
      const sameX = Math.abs(a[0] - b[0]) < 0.5;
      const sameY = Math.abs(a[1] - b[1]) < 0.5;
      if (sameX || sameY) {
        api.wire(id, [a, b], opts);
        return;
      }
      const bend = opts.bend ?? 'v';
      const mid: Pt = bend === 'v' ? [a[0], b[1]] : [b[0], a[1]];
      api.wire(id, [a, mid, b], opts);
    },
  };

  return api;
}

/** 常用导轨：一条水平线，返回两端点（方便端到端接线）。 */
export function rail(b: Board, id: string, x0: number, x1: number, y: number, opts?: WireOpts): Pt[] {
  b.wire(id, [[x0, y], [x1, y]], { weight: 2, ...opts });
  return [
    [x0, y],
    [x1, y],
  ];
}
