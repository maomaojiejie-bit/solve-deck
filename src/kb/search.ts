/**
 * K4 · 知识库搜索 —— 纯函数、零依赖、离线。
 *
 * 加权（设计稿 §7）：title ×5 / aliases ×3 / points ×2 / oneLine ×2 / approach ×2 / chapter ×1。
 * term 命中：完整相等 = 权重、前缀命中 = 权重 + 2、编辑距离容错 = 权重 × 0.7
 *（容差按长度分档：term ≥5 字容 2，否则容 1 —— 两字词容 2 会全场命中，等于没容错）。
 * 查询分词与索引同源（tokenize：CJK 二/三字滑窗 + 拉丁 [a-z0-9]+）。
 */
import { KB, KB_BY_ID, tokenize } from './index.ts';
import type { KnowledgeEntry } from './types.ts';

interface Field {
  text: string;
  weight: number;
}

function fieldsOf(entry: KnowledgeEntry): Field[] {
  return [
    { text: entry.title, weight: 5 },
    { text: entry.aliases.join(' '), weight: 3 },
    { text: (entry.points ?? []).join(' '), weight: 2 },
    { text: entry.oneLine, weight: 2 },
    { text: (entry.approach ?? []).join(' '), weight: 2 },
    { text: entry.chapter, weight: 1 },
  ];
}

/** 编辑距离（上限截断版）。 */
function editDistanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...curr) > limit) return false;
    prev = curr;
  }
  return prev[b.length] <= limit;
}

export interface KbSearchHit {
  entry: KnowledgeEntry;
  score: number;
}

/** 搜索：返回按得分降序的条目列表。空查询返回空。 */
export function searchKb(query: string): KbSearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const scores = new Map<string, number>();
  for (const entry of KB) {
    let score = 0;
    for (const field of fieldsOf(entry)) {
      const tokens = tokenize(field.text);
      for (const term of terms) {
        let best = 0;
        const fuzzyLimit = term.length >= 5 ? 2 : 1;
        for (const token of tokens) {
          if (token === term) best = Math.max(best, field.weight);
          else if (token.startsWith(term) || term.startsWith(token)) best = Math.max(best, field.weight + 2);
          else if (editDistanceWithin(token, term, fuzzyLimit)) best = Math.max(best, field.weight * 0.7);
        }
        score += best;
      }
    }
    if (score > 0) scores.set(entry.id, score);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 12)
    .map(([id, score]) => ({ entry: KB_BY_ID[id], score }));
}

/** 编辑距离容错的别名建议（无结果三件套的「换个说法」）。 */
export function suggestAlias(query: string): string[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const out = new Set<string>();
  for (const entry of KB) {
    for (const alias of [...entry.aliases, entry.title]) {
      const aliasTerms = tokenize(alias);
      for (const term of terms) {
        const limit = term.length >= 5 ? 2 : 1;
        if (aliasTerms.some((token) => editDistanceWithin(token, term, limit))) {
          out.add(alias);
          break;
        }
      }
    }
  }
  return [...out].slice(0, 5);
}
