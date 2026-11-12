/**
 * 语义标签（W10-A 任务 1）：8 个标签 + 按题型声明的关键标签表。
 *
 * 判据只能变严：该题型声明的关键标签必须**全部被至少一个器件标上**才 pass；
 * 缺一项就 skipped（等效图不渲染，N 档）。没有关键标签的题型（数字 / 力学 / 未声明的模拟型）
 * 恒 skipped 但**不降档** —— 它们本来就没有等效电路这回事。
 */

import type { CanvasGraph } from './types.ts';

export const SEMANTIC_OPTIONS = [
  { value: 'unknown', label: '未标' },
  { value: 'bias', label: '偏置' },
  { value: 'coupling', label: '耦合' },
  { value: 'bypass', label: '旁路' },
  { value: 'supply', label: '供电' },
  { value: 'load', label: '负载' },
  { value: 'feedback', label: '反馈' },
  { value: 'stage_link', label: '级间' },
] as const;

export const SEMANTICS: readonly string[] = SEMANTIC_OPTIONS.map((option) => option.value);

export const SEMANTIC_LABEL: Record<string, string> = Object.fromEntries(
  SEMANTIC_OPTIONS.map((option) => [option.value, `${option.value} ${option.label}`]),
);

/** 按题型声明的关键标签（不是全局一刀切）。A7 目前未进 lab，表先声明，W11 覆盖时直接生效。 */
export const CRITICAL_SEMANTICS: Record<string, readonly string[]> = {
  A3: ['bias', 'coupling', 'load'],
  A5: ['bias', 'coupling', 'load'],
  A7: ['feedback', 'load'],
  A1: ['supply', 'load'],
};

export interface SemanticCheck {
  state: 'pass' | 'skipped' | 'fail';
  detail: string;
  skipReason?: string;
  /** 本型声明的关键标签；空 = 不涉及语义（不降档）。 */
  critical: readonly string[];
  /** 还没被标上的关键标签。 */
  missing: string[];
}

export function semanticCheck(templateId: string, graph: CanvasGraph): SemanticCheck {
  const critical = CRITICAL_SEMANTICS[templateId] ?? [];
  if (critical.length === 0) {
    return {
      state: 'skipped',
      detail: '本型不涉及语义标签',
      skipReason: '本型不涉及语义标签',
      critical,
      missing: [],
    };
  }
  const marked = new Set(
    graph.nodes
      // W13 硬闸门 4：复合器件不计入 semantic 正向分 —— 判据只看原生器件。
      .filter((node) => !node.compositeId)
      .map((node) => node.semantic ?? 'unknown')
      .filter((tag) => tag !== 'unknown'),
  );
  const missing = critical.filter((tag) => !marked.has(tag));
  if (missing.length > 0) {
    const names = missing.map((tag) => SEMANTIC_LABEL[tag] ?? tag).join(' / ');
    return {
      state: 'skipped',
      detail: `关键语义未确认：缺 ${names}。把这些标签标到对应器件上，等效图才会渲染。`,
      skipReason: '语义未确认，等效图不渲染',
      critical,
      missing,
    };
  }
  return {
    state: 'pass',
    detail: `关键语义全部确认：${critical.map((tag) => SEMANTIC_LABEL[tag] ?? tag).join(' / ')}。`,
    critical,
    missing: [],
  };
}

/** 力学 / 无关键标签题型的 skipped 不降档（没有等效图概念）。 */
export function effectiveSemantic(check: SemanticCheck): 'pass' | 'skipped' | 'fail' {
  return check.critical.length === 0 ? 'pass' : check.state;
}
