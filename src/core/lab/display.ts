/**
 * 内部 id → 人话（P0：结果区不许把 `n-sup-0` / `e-member` 摆给用户看）。
 *
 * 为什么单独一个文件：
 * - `labels.ts` 被 ops.ts / picks.ts 反过来 import，它不能再 import attach.ts（会成环）；
 * - 这张表要按「图上标签 + 支座类型」现算，必须读 attach.supportRefs（渲染 / 左栏 /
 *   证据同一份来源），所以放在 attach 之上的这一层，谁要给谁用。
 *
 * 拼不出来就退回 id：宁可难看，也不猜一个假名字（结果区的一致性比好看重要）。
 */

import type { CanvasGraph } from './types.ts';
import { supportRefs } from './attach.ts';

/**
 * 一张图的显示名表：结点 id → 图上标签；支座 id → 「结点 · 支座类型」。
 *
 * 支座有两种形态，id 规则不同，必须都覆盖：
 * - 结点属性（新）：support.id 缺省为 `${node.id}:support`；
 * - 支座图元（旧 / 骨架）：id 是图元自己的（如 `n-sup-0`），jointId 是就近结点。
 */
export function displayLabels(graph: CanvasGraph): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const node of graph.nodes) {
    // 与左栏 / 删除确认同一套回落：结点没有显式标签时用 id 去前缀大写（`n-end-a` → `END-A`），
    // 保证结果区的行名和画布上看到的名字是同一个。
    const text = (node.label ?? '').trim() || node.id.replace(/^n-/, '').toUpperCase();
    if (text) labels[node.id] = text;
  }
  for (const ref of supportRefs(graph)) {
    const joint = ref.jointId ? (labels[ref.jointId] ?? ref.jointId) : '';
    const support = ref.label.trim();
    if (!joint && !support) continue;
    labels[ref.id] = joint && support ? `${joint} · ${support}` : joint || support;
  }
  return labels;
}

/** 单选一个 id 的显示名（缺项退回 id 本身）。 */
export function shownId(labels: Record<string, string> | undefined, id: string): string {
  return (labels?.[id] ?? '').trim() || id;
}

/**
 * 构件显示名：两端结点都有名字时写「端点–端点」，多杆图里才分得清；
 * 否则退回 id（`e-member`），不拿空字符串糊过去。
 */
export function shownMember(
  labels: Record<string, string> | undefined,
  edgeId: string,
  ends?: { fromNodeId?: string; toNodeId?: string },
): string {
  const from = (labels?.[ends?.fromNodeId ?? ''] ?? '').trim();
  const to = (labels?.[ends?.toNodeId ?? ''] ?? '').trim();
  if (from && to) return `${from}–${to}`;
  const own = (labels?.[edgeId] ?? '').trim();
  if (own) return own;
  return shownId(labels, edgeId);
}
