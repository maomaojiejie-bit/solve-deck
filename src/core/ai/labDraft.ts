/**
 * R2-T2 · AI 只读图：把题面读成「结构草稿」，交给装配台。
 *
 * 铁律（与 system prompt / 门禁同一套话，改一个字门禁就红）：
 *  - 只读，不算：不许出现任何反力 / 内力 / 倍率 / 结果；图上印的答案一律忽略；
 *  - 不许猜：缺的几何、缺的支座类型、缺的载荷方向 → 留空并标「待确认」，不许填默认值充数；
 *  - 不许造拓扑：结构只能落在「骨架族 + 白名单器件」里，超出就拒绝并说明原因。
 *
 * 与既有 AIDraft 的关系：AIDraft 是「模板 + 参数」（讲解页出口），LabDraft 是
 * 「结构草稿」（装配台出口）。`fields` 里没在题面出现的键必须显式 `from:'默认'`，
 * 装配台据此标琥珀 —— 不许把默认值伪装成题面读出来的。
 */

import { SUPPORTED_IDS } from '../lab/ids.ts';
import { getTemplateRoute } from '../templates/registry.ts';
import type { AIDraft } from './types.ts';

export const LAB_DRAFT_RULES = [
  '只读，不算：不许出现任何反力 / 内力 / 倍率 / 结果；图上印的答案一律忽略。',
  '不许猜：缺的几何、缺的支座类型、缺的载荷方向 → 留空并标「待确认」，不许填默认值充数。',
  '不许造拓扑：结构只能落在「骨架族 + 白名单器件」里，超出就拒绝并说明原因。',
] as const;

/** 结果区固定文案（装配台出口的诚实声明）。 */
export const LAB_DRAFT_DISCLAIMER = '这一块只描述结构，不出任何数值结论；数值由装配台的求解器算。';

export interface LabDraftField {
  value: number | string;
  unit?: string;
  /** 来源必须逐项标：题面读到的 / 图上量的 / 默认补的 / 用户改的。 */
  from: '题面' | '图' | '默认' | '用户';
}

export interface LabDraftDevice {
  id: string;
  kind: string;
  value?: number;
  label?: string;
}

export interface LabDraftEdge {
  from: string;
  to: string;
}

export interface LabDraft {
  /** 骨架族，必须 ∈ 可装配 16 型（SUPPORTED_IDS）。 */
  templateId: string;
  /** 组态：CE/CB/CC、cantilever、CS/CG/CD…（透传给确认卡，不改结构）。 */
  skeleton?: string;
  fields: Record<string, LabDraftField>;
  /** 只允许增删白名单内器件；空 = 只用骨架。 */
  devices?: LabDraftDevice[];
  /** 只允许骨架已声明端口之间的连接；空 = 不加线。 */
  edges?: LabDraftEdge[];
  /** 复述题面里读到了什么、哪些没读清。 */
  notes: string[];
}

export type LabDraftOutcome =
  | { ok: true; draft: LabDraft }
  | { ok: false; reason: string };

/**
 * 从既有 AI 解析产物（AIDraft：模板 + 参数）构造结构草稿。
 *  - 题面抽到的参数 → from:'题面'；
 *  - 该型 ParamSpec 里题面没给的 → from:'默认'（装配台标琥珀，不许伪装成题面）；
 *  - unsure 的键追加「待确认」note；
 *  - templateId 不在可装配 16 型 → 如实拒绝（讲解页按钮照旧可用）。
 */
export function labDraftFromAIDraft(draft: AIDraft): LabDraftOutcome {
  if (!(SUPPORTED_IDS as readonly string[]).includes(draft.templateId)) {
    return {
      ok: false,
      reason: `「${draft.templateId}」没有可装配骨架：这一型只能看讲解页，结构要在装配台上改请换可装配的 16 型之一。`,
    };
  }
  const route = getTemplateRoute(draft.templateId);
  const params = route?.entry.params ?? [];
  const fields: Record<string, LabDraftField> = {};
  for (const param of params) {
    if (param.kind !== 'number') continue;
    const given = draft.params[param.key];
    if (typeof given === 'number' && Number.isFinite(given)) {
      fields[param.key] = { value: given, unit: param.unit, from: '题面' };
    } else {
      fields[param.key] = { value: param.defaultValue as number, unit: param.unit, from: '默认' };
    }
  }
  const notes: string[] = [`骨架族：${draft.templateId}${draft.reason ? `（${draft.reason}）` : ''}`];
  if (draft.unsure.length > 0) {
    notes.push(`待确认：${draft.unsure.join('、')} —— 题面没写清，先留默认值，进装配台后逐个改`);
  }
  return {
    ok: true,
    draft: {
      templateId: draft.templateId,
      fields,
      devices: [],
      edges: [],
      notes,
    },
  };
}
