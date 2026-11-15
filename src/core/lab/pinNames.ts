/**
 * W12：画布上的「点」要有名字。
 *
 * `symbols.ts` 的 PIN_LABEL 是引脚中文名的唯一真相；这里把锚点（器件脚 /
 * 结点 / 汇流条端点）翻译成人话，供 hover、选中态、两次点击下拉和门禁共用。
 * UI 不自己拼 `${nodeId}:${pinId}` 这种内部 id 给用户看。
 */

import { pinLabel } from '../../render/symbols.ts';
import { allComposites } from './composite.ts';
import { anchorsOf, anchorsOfNode, type Anchor } from './pins.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';

const RAIL_NAMES: readonly [RegExp, string][] = [
  [/vcc/i, 'VCC 汇流条（交流地）'],
  [/vdd/i, 'VDD 汇流条（交流地）'],
  [/gnd|ground/i, '地轨'],
  [/out|vo/i, '输出端 Vo'],
];

/** 汇流条端点按所属边的 id 取名；认不出来就老实写「汇流条端点」。 */
export function railName(edgeId: string): string {
  return RAIL_NAMES.find(([pattern]) => pattern.test(edgeId))?.[1] ?? '汇流条端点';
}

/** 'Rc 3.3k' → 'Rc'；'Q' → 'Q'；空标签回落到图元种类。 */
export function deviceName(node: CanvasNode): string {
  const first = (node.label ?? '').trim().split(/[\s　=]/)[0];
  return first || node.kind.toUpperCase();
}

function pinIdOf(anchor: Anchor): string {
  return anchor.key.slice(anchor.key.indexOf(':') + 1);
}

/** 汇流条的归属：几何最近节点的**最近那个引脚**的中文名（如「发射极 e」）。 */
function ownerText(graph: CanvasGraph, anchor: Anchor): string {
  const owner = graph.nodes.find((node) => node.id === anchor.ownerNodeId);
  if (!owner) return '';
  const pins = anchorsOfNode(owner, 'circuit').filter((one) => one.kind === 'pin');
  let nearest: Anchor | undefined;
  let best = Infinity;
  for (const pin of pins) {
    const d = Math.hypot(pin.x - anchor.x, pin.y - anchor.y);
    if (d < best) {
      best = d;
      nearest = pin;
    }
  }
  if (nearest) return `${deviceName(owner)} · ${pinLabel(owner.kind, pinIdOf(nearest))}`;
  return deviceName(owner);
}

export interface AnchorDisplay {
  key: string;
  /** hover / 选中态：`Q · 基极 b`、`VCC 汇流条（交流地） · 所属：…` */
  text: string;
  /** 下拉用短名：`Rc 端 A`。 */
  short: string;
  /** rail 的归属描述（没有则空）。 */
  owner: string;
  kind: Anchor['kind'];
}

/** 复合器件端口的中文名：先查实例定义的端口 label，查不到回落「端口」。 */
function compositePortLabel(node: CanvasNode, pinId: string): string {
  const def = node.compositeId ? allComposites()[node.compositeId] : undefined;
  return def?.ports.find((port) => port.id === pinId)?.label ?? '端口';
}

export function anchorDisplay(graph: CanvasGraph, anchor: Anchor): AnchorDisplay {
  if (anchor.kind === 'rail') {
    const edge = graph.edges.find((one) => anchor.key.startsWith(`${one.id}:`));
    const name = railName(edge?.id ?? anchor.key);
    const owner = ownerText(graph, anchor);
    return {
      key: anchor.key,
      text: owner ? `${name} · 所属：${owner}` : name,
      short: name,
      owner,
      kind: anchor.kind,
    };
  }
  const node = graph.nodes.find((one) => one.id === anchor.nodeId);
  const device = node ? deviceName(node) : anchor.nodeId;
  // W13：复合器件引脚名先查端口定义，再回落到 kind 的通用表。
  const pin =
    anchor.kind === 'pin' && node
      ? node.compositeId
        ? compositePortLabel(node, pinIdOf(anchor))
        : pinLabel(node.kind, pinIdOf(anchor))
      : '结点';
  return {
    key: anchor.key,
    text: `${device} · ${pin}`,
    short: `${device} ${pin}`,
    owner: '',
    kind: anchor.kind,
  };
}

/** 边端点 → 人话短名。
 *  `from`/`to` 有三种写法，全都要认：
 *  ① 引脚 key（`n-vs:p`）—— 用户连的线；
 *  ② 节点 id（`n-vs`）—— 旧的「点两个节点」路径；
 *  ③ `'160,336'` 坐标 —— 骨架布局函数 `wire()` 存的，三分之二的导线是这样。
 *  第三种以前原样印出来就是「e-in 160,336 → 206,270」，比统一写「导线」还难读；
 *  这里按坐标找回最近的锚点 / 器件，取它的显示名。 */
/** 点到线段的距离（2D，够用就行）。 */
function segmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 这个点在不在某条「汇流条 / 地轨 / 输出端」上 —— 导线的端点常常落在这些长横线上，
 *  那里没有任何节点，纯按「最近器件」认会认成「空点」。 */
function railAt(graph: CanvasGraph, x: number, y: number, skipEdgeId?: string): string | null {
  for (const edge of graph.edges) {
    if (edge.id === skipEdgeId || !edge.points || edge.points.length < 2) continue;
    const name = railName(edge.id);
    if (name === '汇流条端点') continue;
    for (let i = 1; i < edge.points.length; i += 1) {
      const [x1, y1] = edge.points[i - 1];
      const [x2, y2] = edge.points[i];
      if (segmentDistance(x, y, x1, y1, x2, y2) <= 2.5) return name.split('（')[0];
    }
  }
  return null;
}

export function endpointText(graph: CanvasGraph, key: string, skipEdgeId?: string): string {
  const anchor = anchorsOf(graph).find((one) => one.key === key);
  if (anchor) return anchorDisplay(graph, anchor).short;
  const node = graph.nodes.find((one) => one.id === key);
  if (node) return deviceName(node);
  const coord = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(key);
  if (coord) {
    const x = Number(coord[1]);
    const y = Number(coord[2]);
    const pins = anchorsOf(graph).filter((one) => one.kind !== 'rail');
    let best: Anchor | undefined;
    let bestDist = Infinity;
    for (const pin of pins) {
      const d = Math.hypot(pin.x - x, pin.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = pin;
      }
    }
    if (best && bestDist <= 2) return anchorDisplay(graph, best).short;
    const rail = railAt(graph, x, y, skipEdgeId);
    if (rail) return rail;
    // 坐标没落在引脚上（导线拐点 / 汇流条端点）→ 最近的器件。
    let nearest: CanvasNode | undefined;
    let nearestDist = Infinity;
    for (const node of graph.nodes) {
      if (node.kind === 'text') continue;
      const d = Math.hypot(node.x - x, node.y - y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = node;
      }
    }
    if (nearest && nearestDist <= 60) return deviceName(nearest);
    return '空点';
  }
  return key;
}

/** 导线列表一行的文案：`Rs 端 B → Q 基极 b`；这条线本身就是地轨 / 汇流条时直接写它。
 *  「本身是汇流条」只认 `-bar` / `-rail` 结尾的母线 —— `e-vs-gnd` 这种「接到地」的短线
 *  也含 gnd，但它不是母线，写「地轨」就把两端的信息抹掉了。 */
export function wireLabel(graph: CanvasGraph, edge: CanvasEdge): string {
  if (/-(bar|rail)$/i.test(edge.id)) return railName(edge.id).split('（')[0];
  const from = endpointText(graph, edge.from, edge.id);
  const to = endpointText(graph, edge.to, edge.id);
  // 两端都认不出来（悬空短线 / 纯输出端）：宁可用这条线自己的语义名，也不印「空点 → 空点」。
  if (from === '空点' && to === '空点') {
    const self = railName(edge.id);
    return self !== '汇流条端点' ? self.split('（')[0] : '导线';
  }
  return `${from} → ${to}`;
}

/** 下拉 / 按钮上的可读选项：`A3 · Rc 端 A`，绝不以 `n-` 开头。 */
export function anchorOptionText(graph: CanvasGraph, templateId: string, key: string): string {
  const anchor = anchorsOf(graph).find((one) => one.key === key);
  if (!anchor) return `${templateId} · 未知端点`;
  /** 自建图元不该再挂题型前缀：画布上明明是自己加的 R / 结点 A，
   *  下拉里写「A3 · R 端 A」会让人以为是原题骨架留下的。骨架图元口径不变。 */
  const owner = graph.nodes.find((node) => node.id === key.split(':')[0]);
  const selfBuilt =
    owner &&
    (owner.id.startsWith('n-add-') || (owner.kind === 'dot' && /^[A-Z]$/.test((owner.label ?? '').trim())));
  const prefix = selfBuilt && owner ? deviceName(owner) : templateId;
  return `${prefix} · ${anchorDisplay(graph, anchor).short}`;
}

/** 选中态一行：`已选：Q · 基极 b` / `Q · 基极 b → Rc · 端 A`。 */
export function selectionText(
  graph: CanvasGraph,
  first: string | null,
  lastLink: { from: string; to: string } | null,
): string {
  const textOf = (key: string) => {
    const anchor = anchorsOf(graph).find((one) => one.key === key);
    return anchor ? anchorDisplay(graph, anchor).text : key;
  };
  if (first) return `已选：${textOf(first)}`;
  if (lastLink) return `${textOf(lastLink.from)} → ${textOf(lastLink.to)}`;
  return '';
}
