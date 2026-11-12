/**
 * 读题编排（R3-2 §5 收口后）：`#/solve` 只做**离线规则解析**。
 *
 * 为什么把 AI 摘出去：
 *  - AI 现在唯一的活是识图，而识图要读结构草稿、要落到装配台 —— 这件事在 `#/lab` 里做；
 *  - `#/solve` 的入口是「贴文字」，12 类常见题型规则就够，离线、免费、零请求；
 *  - 「不开开关就一次请求都不发」最硬的落实方式是：这个页面里根本没有请求代码。
 *
 * 图片仍然可以贴/拖进来，但只作参照（人对照着填参数），本页不读图。
 *
 * 越界不算硬失败：draft 还是要显示（标红 + 给区间），只是 `jumpable=false`。
 */

import { MAX_IMAGES } from './image.ts';
import { buildParamQuery, defaultParamValues } from '../params/query.ts';
import { getTemplateRoute } from '../templates/registry.ts';
import { findScopeKeyword, scopeBlockMessage } from '../scope/keywords.ts';
import { parseByRule, ruleMatch } from './rule.ts';
import { checkDraft } from './validate.ts';
import { applyImageParams } from './imgref.ts';
import type { AIDraft, AIParseOutcome } from './types.ts';

export interface ParseInput {
  text: string;
  /** 贴进来的图（只作参照，不送任何地方）。 */
  images?: string[];
}

/** 走了哪条路：必须写在屏幕上（不静默降级）。 */
export const NOTE_RULE_ONLY = '规则解析（离线、免费）：认出 12 类常见题型，不发任何请求。';
/** 有图但本页不读：把「图去哪了」说清楚，别让人以为图参与了解析。 */
export const NOTE_IMAGE_REFERENCE = '图片只作参照，本页不读图。要读图请到装配台的「高级」里开启 AI 识图。';

export function draftUrl(draft: AIDraft): string | null {
  const route = getTemplateRoute(draft.templateId);
  if (!route) return null;
  const params = route.entry.params ?? [];
  const baseline = route.variant?.params;
  const values = defaultParamValues(params, baseline);
  for (const [key, value] of Object.entries(draft.params)) {
    if (key in values) values[key] = value;
  }
  const query = buildParamQuery(params, values, baseline);
  return `#/t/${draft.templateId}${query ? `?${query}` : ''}`;
}

function rulePath(text: string, notes: string[], images: readonly string[]): AIParseOutcome {
  const rule = parseByRule(text);
  if (!rule) {
    return {
      draft: null,
      issues: [
        '没从题面里认出让哪一型 —— 请在上面手动选题型，或把题面写得更具体一点（含「悬臂梁 / 简支梁 / 主应力 / 共源」这类词）。',
      ],
      notes,
      outOfRange: [],
      jumpable: false,
      attempts: 0,
    };
  }
  const checked = checkDraft(
    // U2：图片 → 参数的唯一通道。正常配置下恒等（同一个引用），门禁的变异位翻 true 才动手。
    applyImageParams(
      { templateId: rule.templateId, params: rule.params, reason: rule.reason, unsure: rule.unsure },
      images,
    ),
    text,
    'rule',
  );
  if (checked.issues.length > 0) notes.push(...checked.issues);
  return {
    draft: checked.draft,
    issues: checked.draft ? [] : checked.issues,
    notes,
    outOfRange: checked.outOfRange,
    jumpable: checked.jumpable,
    attempts: 0,
  };
}

export async function parseProblem(input: ParseInput): Promise<AIParseOutcome> {
  const text = input.text.trim();
  const hasImages = (input.images ?? []).slice(0, MAX_IMAGES).length > 0;

  if (text === '' && !hasImages) {
    return {
      draft: null,
      issues: ['先把题面贴进来（或点下面三个例子之一）。'],
      notes: [],
      outOfRange: [],
      jumpable: false,
      attempts: 0,
    };
  }

  // 范围闸：在认题型 / 抽参数之前拦，一个参数都不给。
  // 手选模板走的是页面的 pick()，不经过这里 —— 用户自己确认过范围就照算。
  const hit = findScopeKeyword(text);
  if (hit) {
    const message = scopeBlockMessage(hit);
    const templateId = ruleMatch(text)?.templateId;
    return {
      draft: null,
      issues: [message],
      notes: ['已按能力边界拦截：不进参数表单，不换模板凑答案。'],
      outOfRange: [],
      jumpable: false,
      attempts: 0,
      blocked: { term: hit.term, method: hit.method, message, templateId },
    };
  }

  if (text === '') {
    return {
      draft: null,
      issues: ['只收到图片、没有题干文字 —— 请把题目文字补上，或在上面手动选题型。要读图请去装配台。'],
      notes: [NOTE_IMAGE_REFERENCE],
      outOfRange: [],
      jumpable: false,
      attempts: 0,
    };
  }

  const notes = [NOTE_RULE_ONLY];
  if (hasImages) notes.push(NOTE_IMAGE_REFERENCE);
  return rulePath(text, notes, input.images ?? []);
}
