/**
 * draft 校验（W6 §2 的六条）。**这里是唯一能让 draft 作废的地方**，
 * 页面只信 `checkDraft` 的结论，不自己再判一遍。
 *
 * 1. templateId 存在且 ready
 * 2. params 的 key ⊆ 该模板 ParamSpec[].key
 * 3. 数值落在 [min,max]：越界**不夹取**，原样保留 + 记进 outOfRange
 * 4. 单位：题面里出现识别不了的单位 → 要求人填
 * 5. 禁止裸结果：AI 的 reason 里出现「答案 / Av= / σ= / Pcr=」这类字样 → 整份作废
 * 6. unsure 原样透传（页面对这些 key 一律标「待确认」）
 */

import { getTemplateRoute } from '../templates/registry.ts';
import type { AIDraft, AIRawDraft, OutOfRange } from './types.ts';
import { unknownUnits } from './rule.ts';

/**
 * 裸结果：AI 只准报参数与题型。命中就整份作废、重写一次。
 * 注意只查 **AI 回来/规则写出的文字**（reason），不查用户题面 ——
 * 题面里写「求主应力」是正常的，那不是 AI 给的结论。
 */
const BARE_RESULT =
  /(答案|结果为|解得|故得|Av\s*[=＝]|Au\s*[=＝]|Ri\s*[=＝]|Ro\s*[=＝]|σ\s*max|σ\s*[=＝]|τ\s*[=＝]|Pcr\s*[=＝]|P_cr|临界力为|主应力为|增益为|应力为|[=＝]\s*-?\d+(?:\.\d+)?\s*(?:dB|MPa|kN|N·m|kN·m|V|mA|A|倍|%))/;

export function hasBareResult(text: string): boolean {
  return BARE_RESULT.test(text);
}

export interface DraftCheck {
  draft: AIDraft | null;
  issues: string[];
  outOfRange: OutOfRange[];
  /** true = 可以跳转（无硬错误、无越界）。 */
  jumpable: boolean;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * 把一份「AI 回来的 JSON / 规则解析出来的东西」验成 draft。
 * 返回 `draft: null` 就是「不许用，让人手填」。
 */
export function checkDraft(raw: unknown, given: string, source: 'ai' | 'rule'): DraftCheck {
  const issues: string[] = [];
  const outOfRange: OutOfRange[] = [];
  const payload = (raw ?? {}) as AIRawDraft;

  const templateId = typeof payload.templateId === 'string' ? payload.templateId.trim() : '';
  const route = templateId ? getTemplateRoute(templateId) : undefined;
  if (!route) {
    issues.push(`题型「${templateId || '空'}」不在题库里，请先在上面手动选一个。`);
    return { draft: null, issues, outOfRange, jumpable: false };
  }
  if (route.entry.status !== 'ready') {
    issues.push(`题型 ${templateId} 还没就绪（${route.entry.status}），换一个。`);
    return { draft: null, issues, outOfRange, jumpable: false };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (reason.length > 40) issues.push('匹配理由超过 40 字，已截断。');
  if (hasBareResult(reason)) {
    issues.push('解析结果里出现了数值结论（答案 / Av= / σ= 之类），按规矩整份作废 —— 请手填参数。');
    return { draft: null, issues, outOfRange, jumpable: false };
  }

  const specs = route.entry.params ?? [];
  const specByKey = new Map(specs.map((param) => [param.key, param]));
  const params: Record<string, number | string> = {};
  const unknownRaw = payload.params;
  if (unknownRaw !== undefined) {
    if (typeof unknownRaw !== 'object' || unknownRaw === null || Array.isArray(unknownRaw)) {
      issues.push('params 必须是对象。');
      return { draft: null, issues, outOfRange, jumpable: false };
    }
    for (const [key, value] of Object.entries(unknownRaw as Record<string, unknown>)) {
      const spec = specByKey.get(key);
      if (!spec) {
        issues.push(`参数 ${key} 不属于 ${templateId}，已忽略。`);
        continue;
      }
      if (spec.kind === 'bits') {
        issues.push(`参数 ${key} 是位串，AI 不抽位串，请在表单里点。`);
        continue;
      }
      const number = asNumber(value);
      if (number === null) {
        issues.push(`参数 ${key} 不是数字，已忽略。`);
        continue;
      }
      // 越界**不夹取**：原样留下，标红 + 给区间，跳转按钮禁用
      if (spec.min !== undefined && number < spec.min) {
        outOfRange.push({ key, label: spec.label, value: number, min: spec.min, max: spec.max, unit: spec.unit });
      } else if (spec.max !== undefined && number > spec.max) {
        outOfRange.push({ key, label: spec.label, value: number, min: spec.min, max: spec.max, unit: spec.unit });
      }
      params[key] = number;
    }
  }

  const unsureRaw = payload.unsure;
  const unsure = Array.isArray(unsureRaw)
    ? unsureRaw.filter((key): key is string => typeof key === 'string' && specByKey.has(key))
    : [];

  // 单位：题面里出现识别不了的单位就要求人填（不猜是 m 还是 mm）
  const badUnits = unknownUnits(given);
  if (badUnits.length > 0) {
    issues.push(`题面里的单位「${badUnits.join('/')}」认不出来，请手动填参数。`);
  }

  if (outOfRange.length > 0) {
    for (const item of outOfRange) {
      const range = `${item.min ?? '−∞'} ~ ${item.max ?? '+∞'}${item.unit ?? ''}`;
      issues.push(`${item.label} = ${item.value}${item.unit ?? ''} 超出范围（合法区间 ${range}）。`);
    }
  }

  const draft: AIDraft = {
    templateId,
    params,
    reason: reason || (source === 'rule' ? '按题面关键词命中' : '模型未给理由'),
    given,
    source,
    unsure,
  };
  const jumpable = outOfRange.length === 0 && badUnits.length === 0;
  return { draft, issues, outOfRange, jumpable };
}
