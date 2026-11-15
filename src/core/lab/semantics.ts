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

/**
 * 「按拓扑标全」：给一键按钮用的建议表，只按器件 id / 标签里的电路名推断。
 *
 * 这是**建议**，不是自动判定：它不写图、不改 semanticCheck 的判据，也不放宽
 * gating —— 用户点一下才通过 setSemantic 逐个写进去，之后仍可手动改。
 * 骨架本身依旧不带标签（N 档起步），门禁 ⑧/⑨ 的「未标 → N」语义不变。
 */
export interface SemanticSuggestion {
  nodeId: string;
  semantic: string;
}

/**
 * 先按题型给精确 id（骨架节点名是稳定的），再用正则兜底。
 * 纯正则会把 A7 的 feedback 标到 Rin、load 标到 Rout —— 标签虽能升 F，含义却是错的。
 */
const SUGGEST_BY_TEMPLATE: Record<string, Record<string, string[]>> = {
  A3: { bias: ['n-rc'], coupling: ['n-rs'], load: ['n-rl'] },
  A5: { bias: ['n-rd'], coupling: ['n-rs'], load: ['n-rl'] },
  A7: { feedback: ['n-fb'], load: ['n-rl'] },
  A1: { supply: ['n-src'], load: ['n-r'] },
};

const SUGGEST_PATTERN: Record<string, RegExp> = {
  bias: /\b(rc|rd|rb|rbias|bias)\b|rc|rd|rb/i,
  coupling: /\b(cb|cin|cout|rs|rg|cg|couple|coupling)\b|cb|cin|rs/i,
  bypass: /\b(ce|re|bypass|css)\b|ce|re/i,
  supply: /\b(vs|vdd|vcc|vin|supply|vsrc)\b|vs|vdd|vcc/i,
  load: /\b(rl|load|rload)\b|rl|load/i,
  feedback: /\b(rf|fb|feedback|rfb)\b|rf|fb/i,
  stage_link: /\b(cstage|interstage|link|stage)\b|cstage|inter/i,
};

const RESISTOR_KINDS = ['res', 'resistor', 'r'];

/** 只挑原生器件，且一个器件只领一个角色；找不到匹配就退到同类的第一个 / 最后一个。 */
export function suggestSemantics(templateId: string, graph: CanvasGraph): SemanticSuggestion[] {
  const critical = CRITICAL_SEMANTICS[templateId] ?? [];
  if (critical.length === 0) return [];
  /* block 也参与：A7 的 β 反馈块 n-fb 就是 block，排除它会退到 Rin 上。 */
  const nodes = graph.nodes.filter(
    (node) => !node.compositeId && !['text', 'dot', 'gnd'].includes(node.kind),
  );
  const resistors = nodes.filter((node) => RESISTOR_KINDS.includes(node.kind));
  const sources = nodes.filter((node) => /vsrc|source|vdd|vcc/i.test(node.kind));
  const caps = nodes.filter((node) => /cap/i.test(node.kind));
  const used = new Set<string>();
  const out: SemanticSuggestion[] = [];
  for (const tag of critical) {
    const pattern = SUGGEST_PATTERN[tag];
    const exactIds = SUGGEST_BY_TEMPLATE[templateId]?.[tag] ?? [];
    const haystack = (node: { id: string; label?: string }) => `${node.id} ${node.label ?? ''}`;
    const fallback =
      tag === 'supply' ? sources[0]
        : tag === 'coupling' ? caps[0] ?? resistors[1] ?? resistors[0]
          : tag === 'load' ? resistors[resistors.length - 1]
            : resistors[0];
    const hit = nodes.find((node) => !used.has(node.id) && exactIds.includes(node.id))
      ?? nodes.find((node) => !used.has(node.id) && pattern && pattern.test(haystack(node)))
      ?? [fallback, ...nodes].find((node) => node && !used.has(node.id));
    if (!hit) continue;
    used.add(hit.id);
    out.push({ nodeId: hit.id, semantic: tag });
  }
  return out;
}
