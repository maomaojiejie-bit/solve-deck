/**
 * 简化留痕（任务单 §3）：只要为了能算而改了题，三处必须同时出现 ——
 *  ① 结果页顶部 amber 条；② `assumptions` 段；③ 导出 PDF 时也印在纸上。
 *
 * 「不等价」这三个字是硬要求：不许用「近似」「估算」把它糊过去。
 * 这张表是唯一来源，结果页与 check:scope 都从这里取文案，避免两处写不一样。
 */

export interface Simplification {
  id: string;
  name: string;
  gap: string;
  /** 具体改了什么，逐条列，不写「等等」。 */
  changes: string[];
}

export const NOT_EQUIVALENT = '不等价';

export const SIMPLIFICATIONS: Record<string, Simplification> = {
  'equal-section': {
    id: 'equal-section',
    name: '等截面近似',
    gap: '变截面',
    changes: ['把变截面梁按控制截面的惯性矩 I 当作全梁常值', '忽略截面突变处的局部应力集中'],
  },
  linear: {
    id: 'linear',
    name: '线性化近似',
    gap: '非线性 / 材料或几何非线性',
    changes: ['按线性材料（胡克定律）重算', '按小变形几何重算，忽略二阶效应'],
  },
};

/** URL 里的 `simp=a,b` → 简化项（不认识的 id 直接丢掉，不猜）。 */
export function parseSimplifications(raw: string | null | undefined): Simplification[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => SIMPLIFICATIONS[id.trim()])
    .filter((item): item is Simplification => item !== undefined);
}

/** 一条 assumption：结果页 amber 条、assumptions 段、PDF 用的都是这同一句。 */
export function assumptionLine(item: Simplification): string {
  return `已按 ${item.name} 计算 —— 这与原题${NOT_EQUIVALENT}，改动：${item.changes.join('；')}。`;
}

export function assumptionLines(items: readonly Simplification[]): string[] {
  return items.map(assumptionLine);
}

/** 给 #/scope 的简化分支用的一句话：先说清「不等价」，再说留痕。 */
export function assumptionNoticeTitle(): string {
  return `这与原题${NOT_EQUIVALENT}（不是近似误差，是把题改成了另一道）`;
}

/** 给 #/solve 用的前提说明（还没进结果页，先让人知道自己在改什么题）。 */
export function simplificationNotice(items: readonly Simplification[]): string {
  if (items.length === 0) return '';
  return `你选择了按 ${items.map((item) => item.name).join(' + ')} 改写题目。改完之后能算，但与原题${NOT_EQUIVALENT}；结果页会把这条留痕并印进 PDF。`;
}
