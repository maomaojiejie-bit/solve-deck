/**
 * R-37 · 结果页 ↔ 知识库联动（纯函数，门禁可直接跑）。
 *
 * 映射不新造数据：优先用条目自带的 `solvable.templateId`（K1 就埋好的挂接），
 * 再用解题步骤里的「依据 / 定律名」命中 title / aliases，最后用同学科补位。
 * 三级各有不同 reason，学生一眼知道为什么推荐这条。
 * 不跨题型硬编一张映射表 —— 加新题型、加新知识点都不用改这里。
 */
import { KB } from './index.ts';
import type { KnowledgeEntry } from './types.ts';

export interface KbLink {
  id: string;
  title: string;
  oneLine: string;
  reason: string;
  href: string;
}

interface Candidate {
  entry: KnowledgeEntry;
  reason: string;
  score: number;
}

const normalize = (text: string): string => text.trim().toLowerCase();
/** registry 的题型学科与 KB 的学科命名不完全一致，补位前先归一。 */
const SUBJECT_ALIAS: Record<string, string> = { analog: 'circuit' };

export function kbLinksFor(args: {
  templateId: string;
  subject?: string;
  bases?: readonly string[];
  limit?: number;
}): KbLink[] {
  const { templateId, subject, bases = [], limit = 5 } = args;
  const picked = new Map<string, Candidate>();

  const add = (entry: KnowledgeEntry, reason: string, score: number) => {
    const previous = picked.get(entry.id);
    if (!previous || score > previous.score) picked.set(entry.id, { entry, reason, score });
  };

  // ① 直接挂接：这条知识点本来就写明「能用这道题解」。
  for (const entry of KB) {
    if (entry.solvable?.templateId === templateId) add(entry, '本题对应的知识点', 3);
  }

  // ② 步骤依据命中：basis 里的定律名出现在知识点标题或别名里。
  //    两边都要求 ≥2 字，避免「法」「律」这种单字把半个知识库捞出来。
  const names = bases.map(normalize).filter((name) => name.length >= 2);
  for (const entry of KB) {
    const aliases = [entry.title, ...entry.aliases].map(normalize).filter((alias) => alias.length >= 2);
    const hit = names.find((name) => aliases.some((alias) => alias.includes(name) || name.includes(alias)));
    if (hit) add(entry, `步骤依据：${hit}`, 2);
  }

  // ③ 同学科补位：直接挂接为空时也不至于什么都没有。
  const kbSubject = subject ? (SUBJECT_ALIAS[normalize(subject)] ?? normalize(subject)) : undefined;
  if (kbSubject) {
    for (const entry of KB) {
      if (entry.subject === kbSubject) add(entry, '同学科延伸阅读', 1);
    }
  }

  return Array.from(picked.values())
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Math.max(1, limit))
    .map(({ entry, reason }) => ({
      id: entry.id,
      title: entry.title,
      oneLine: entry.oneLine,
      reason,
      href: `#/kb/${entry.id}`,
    }));
}
