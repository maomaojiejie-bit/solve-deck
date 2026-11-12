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
import type { CanvasGraph, CanvasNode } from './types.ts';

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

/** 下拉 / 按钮上的可读选项：`A3 · Rc 端 A`，绝不以 `n-` 开头。 */
export function anchorOptionText(graph: CanvasGraph, templateId: string, key: string): string {
  const anchor = anchorsOf(graph).find((one) => one.key === key);
  if (!anchor) return `${templateId} · 未知端点`;
  return `${templateId} · ${anchorDisplay(graph, anchor).short}`;
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
