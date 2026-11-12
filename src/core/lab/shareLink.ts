/**
 * R3-4 U2 · 「结构草稿 → 装配台链接」的唯一实现。
 *
 * 以前这段编码逻辑长在 `Solve.tsx` 的 `goStructure()` 里 —— 页面能跑，门禁够不着，
 * 于是「图片不进分享链接」只能靠肉眼。搬出来以后，页面与 `check:imgref` 跑的是**同一个函数**：
 * 同一份草稿 → 同一个 spec → 同一条链接（逐字符相等），图有没有都不影响。
 *
 * 纯同步、不碰 DOM、不读 JSON 文件：spec 由调用方给（页面用 `getExample`，门禁用 readFileSync）。
 */

import { encodeSharePayload, usedCompositeDefs } from './composite.ts';
import { draftToGraph } from './draftToGraph.ts';
import type { LabDraft } from '../ai/labDraft.ts';
import type { RenderSpec } from '../types.ts';

export interface StructureHref {
  /** 可直接 onStart 的 hash。 */
  href: string;
  /** true = 带 `?g=`（结构整份编码进链接）；false = 退回只带题型。 */
  shared: boolean;
  /** 失败原因（人话，只在 shared=false 时有值）。 */
  reason?: string;
}

/**
 * 草稿 → `#/lab/t/<id>?g=<base64>&from=题面`。
 * 失败不是异常：器件不在白名单、骨架缺 —— 退回 `#/lab/t/<id>`，不抛错、不编半条链接。
 */
export function structureHrefFromDraft(draft: LabDraft, spec: RenderSpec): StructureHref {
  const targetId = draft.templateId;
  const fallback = `#/lab/t/${targetId}`;
  const built = draftToGraph(draft, spec);
  if (!built.ok) return { href: fallback, shared: false, reason: built.reason };
  const encoded = encodeURIComponent(
    encodeSharePayload({ graph: built.graph, defs: usedCompositeDefs(built.graph) }),
  );
  return { href: `${fallback}?g=${encoded}&from=题面`, shared: true };
}
