/**
 * K1 · 知识库索引 —— 构建期生成，纯数据（无 IO、无第三方依赖）。
 *
 * 分词口径（短令 §3）：CJK 二/三字滑窗 + 拉丁 `[a-z0-9]+`，全部小写。
 * 52 条量级下索引体积 < 120 KB（check:kb × 有上限断言）。
 */
import { CIRCUIT } from './entries/circuit.ts';
import { DIGITAL } from './entries/digital.ts';
import { MECHANICS } from './entries/mechanics.ts';
import { STATICS } from './entries/statics.ts';
import { PHYSICS } from './entries/physics.ts';
import { MATH } from './entries/math.ts';
import { PROGRAMMING } from './entries/programming.ts';
import type { KnowledgeEntry } from './types.ts';

/** 全部条目：工科四科按账本顺序在前，基础扩展（大物/高数/C·C#）在后。 */
export const KB: KnowledgeEntry[] = [
  ...CIRCUIT,
  ...DIGITAL,
  ...MECHANICS,
  ...STATICS,
  ...PHYSICS,
  ...MATH,
  ...PROGRAMMING,
];

/** id → 条目。 */
export const KB_BY_ID: Record<string, KnowledgeEntry> = Object.fromEntries(KB.map((entry) => [entry.id, entry]));

/**
 * 对一段文本产出检索词：
 * - 拉丁/数字连串 → 一个 term（`100k`、`m3`）；
 * - CJK 连串 → 滑出全部二/三字窗（「弯矩图」→ 弯矩 / 矩图 / 弯矩图）。
 * 单个 CJK 字不进索引（噪音太大，召回靠二字窗兜）。
 */
export function tokenize(text: string): string[] {
  const terms = new Set<string>();
  const lowered = text.toLowerCase();
  for (const match of lowered.matchAll(/[a-z0-9]+/g)) terms.add(match[0]);
  // 只用二字滑窗：三字窗的召回增益很小（长词检索有编辑距离容错兜底），
  // 索引体积却要多出近三分之一——59 条时 121.9KB 会顶破 120KB 上限。
  for (const match of lowered.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0];
    for (let i = 0; i + 2 <= run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

/** id → 已小写拼接串（title + aliases + chapter + oneLine，检索原文）。 */
export const KB_HAYSTACK: Record<string, string> = Object.fromEntries(
  KB.map((entry) => [
    entry.id,
    [entry.title, entry.chapter, entry.oneLine, ...entry.aliases].join('\n').toLowerCase(),
  ]),
);

/**
 * 倒排索引：term → 出现该 term 的条目 id 列表（按 KB 顺序去重）。
 * HAYSTACK 的正文不进 term（体积），只进 alias/title/chapter/oneLine 的词。
 */
export const KB_INDEX: { term: string; ids: string[] }[] = (() => {
  const map = new Map<string, Set<string>>();
  for (const entry of KB) {
    const terms = new Set<string>([
      ...tokenize(entry.title),
      ...tokenize(entry.chapter),
      ...tokenize(entry.oneLine),
      ...entry.aliases.flatMap((alias) => tokenize(alias)),
    ]);
    for (const term of terms) {
      if (!map.has(term)) map.set(term, new Set());
      map.get(term)?.add(entry.id);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([term, ids]) => ({ term, ids: [...ids] }));
})();
