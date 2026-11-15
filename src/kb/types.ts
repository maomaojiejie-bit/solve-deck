/**
 * K1 · 知识库地基 —— 条目类型（照抄 `docs/短令-K1-知识库地基.md` §1）。
 * 本批只有类型与空位：文案 K2 写、图 K3 出、页面 K4 建。
 */

export type Subject = 'circuit' | 'digital' | 'mechanics' | 'statics' | 'physics' | 'math' | 'programming';

export type KbFigure =
  | { kind: 'photo'; src: string; alt: string; caption: string; credit: string }
  | { kind: 'svg'; src: string; alt: string; caption: string }
  | { kind: 'live'; templateId: string; params?: Record<string, number>; caption: string };

export interface KnowledgeEntry {
  /** 形如 'mechanics.bending-moment'，全局唯一。 */
  id: string;
  subject: Subject;
  chapter: string;
  title: string;
  /** ≥2 个：搜索召回的别名。 */
  aliases: string[];
  /** ≤40 字的一句话定位。 */
  oneLine: string;
  /** 3–6 步，动词开头，每步 ≤48 字。空 = K2 还没写（门禁 ② 会报账）。 */
  approach: string[];
  formulas: { tex: string; note?: string }[];
  /** 3–6 条，每条 ≤48 字。空 = K2 还没写。 */
  points: string[];
  /** 0–3 条。 */
  pitfalls?: string[];
  /** 0–3 张。 */
  figures?: KbFigure[];
  /** 能算的条目挂对应模板（29 条）；只讲的条目不挂。 */
  solvable?: { templateId: string };
  related?: string[];
  /** 只写章节（教材章节名），不写 URL。 */
  source?: string;
}
