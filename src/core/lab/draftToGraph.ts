/**
 * R2-T3 · 结构草稿 → 装配台图。
 *
 * 只复用现成件，不新写求解路径：
 *   freshSkeleton(templateId, spec)  建骨架（与装配台打开时同一张图）
 *   → applyParams(templateId, …, values)  落参数（挪载荷 / 改器件 / 刷文字，W10 通道）
 *   → devices / edges 只做白名单内的增删（applyOp 的 addDevice / deleteDevice / addEdge）。
 *
 * 拒绝是常态不是异常：器件不在白名单、端口不存在、拓扑超纲 —— 一律给人话。
 * 红线：这里产生的图与模板路由是**同一个求解器**（R2-T3 门禁逐位对账）。
 */

import { SUPPORTED_IDS } from './ids.ts';
import { PICKS, applyParams } from './picks.ts';
import { applyOp } from './ops.ts';
import { freshSkeleton } from './skeleton.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';
import type { RenderSpec } from '../types.ts';
import type { LabDraft } from '../ai/labDraft.ts';

/** R2-T3 变异位：关掉 = 草稿的参数不落图（丢参数），check:labimport 的同解必红。 */
export const DRAFT_TO_GRAPH_CONFIG = { applyFields: true };

export type DraftToGraphResult =
  | { ok: true; graph: CanvasGraph }
  | { ok: false; reason: string };

/** 装配台白名单内的器件 kind（骨架族自己的白名单由 reduce 判，这里挡「非本族器件」）。 */
function deviceWhitelist(templateId: string): Set<string> {
  const picks = PICKS[templateId];
  if (!picks) return new Set();
  return new Set(picks.whitelist ?? []);
}

/**
 * 结构草稿 → 装配台图。`spec` 用该型骨架规格（页面 / 门禁都拿得到同一份）。
 * devices/edges 为空 = 只落骨架与参数 —— 这是 16 型同解门禁走的主路径。
 */
export function draftToGraph(draft: LabDraft, spec: RenderSpec): DraftToGraphResult {
  if (!(SUPPORTED_IDS as readonly string[]).includes(draft.templateId)) {
    return { ok: false, reason: `「${draft.templateId}」不在可装配 16 型里：没有骨架可建 —— 换题型，或去讲解页看这一型。` };
  }
  const picks = PICKS[draft.templateId];
  if (!picks) return { ok: false, reason: `「${draft.templateId}」没有装配骨架（PICKS 表缺）。` };

  // ① 参数槽：只收数值型 fields，字符串值（组态）如实拒 —— 装配台的参数表不收魔法字符串。
  const values: Record<string, number> = {};
  for (const [key, field] of Object.entries(draft.fields)) {
    if (typeof field.value === 'number' && Number.isFinite(field.value)) values[key] = field.value;
    else if (field.from === '题面') {
      return { ok: false, reason: `参数 ${key} 的值「${field.value}」不是数：题面给的必须是数字（带单位的先换算）。` };
    }
  }

  // ② 骨架 + 参数落图（applyParams 与 ?p= / 手改同一通道）
  let graph: CanvasGraph;
  try {
    graph = freshSkeleton(draft.templateId, spec, values);
    if (DRAFT_TO_GRAPH_CONFIG.applyFields && Object.keys(values).length > 0) {
      graph = applyParams(draft.templateId, graph, values);
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `骨架建不起来：${String(error)}` };
  }

  // ③ devices：白名单内的增删
  const whitelist = deviceWhitelist(draft.templateId);
  for (const device of draft.devices ?? []) {
    if (!whitelist.has(device.kind)) {
      return {
        ok: false,
        reason: `器件「${device.label ?? device.id}」（${device.kind}）不在「${draft.templateId}」的白名单里：装配台不许造拓扑 —— 可用的器件在左栏「加入器件」列表里。`,
      };
    }
    const op: { op: 'addDevice'; kind: string; label: string; value?: number; x: number; y: number } = {
      op: 'addDevice',
      kind: device.kind,
      label: device.label ?? device.id,
      x: 0,
      y: 0,
    };
    if (device.value !== undefined) op.value = device.value;
    const out = applyOp(draft.templateId, graph, op);
    if (out.refused) return { ok: false, reason: `加器件「${device.label ?? device.kind}」被拒：${out.refused}` };
    graph = out.graph;
  }

  // ④ edges：只允许骨架已声明端口之间的连接
  const knownPorts = portKeys(graph);
  for (const edge of draft.edges ?? []) {
    for (const port of [edge.from, edge.to]) {
      if (!knownPorts.has(port)) {
        return {
          ok: false,
          reason: `连线「${edge.from} → ${edge.to}」的端点 ${port} 不是骨架已声明的端口：不许连到不存在的引脚（引脚名可在画布上悬停查看）。`,
        };
      }
    }
    const out = applyOp(draft.templateId, graph, { op: 'addEdge', from: edge.from, to: edge.to });
    if (out.refused) return { ok: false, reason: `连线 ${edge.from} → ${edge.to} 被拒：${out.refused}` };
    graph = out.graph;
  }
  return { ok: true, graph };
}

/** 骨架上全部可用端口：器件引脚（nodeId:anchorKey）。 */
function portKeys(graph: CanvasGraph): Set<string> {
  const keys = new Set<string>();
  for (const node of graph.nodes as (CanvasNode & { anchors?: { key: string }[] })[]) {
    const anchors = (node as unknown as { anchors?: unknown }).anchors;
    if (Array.isArray(anchors)) {
      for (const anchor of anchors as { key: string }[]) keys.add(`${node.id}:${anchor.key}`);
    }
  }
  return keys;
}
