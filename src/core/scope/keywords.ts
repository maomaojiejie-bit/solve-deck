/**
 * `#/solve` 的那道闸（任务单 §2）：16 个词一出，直接给「不覆盖」卡，不进参数表单。
 *
 * 拦的是**题面文字**，不是模板 id：从首页卡片手选模板的路径不经过 parseProblem，
 * 所以不会被拦 —— 这是刻意的，手选本来就是用户自己确认过范围。
 *
 * 每个词都带上「该用什么方法」，拦截卡不只说「不行」，还得说清楚去哪儿。
 */

export interface ScopeHit {
  term: string;
  method: string;
}

interface KeywordRule {
  terms: string[];
  method: string;
}

const RULES: readonly KeywordRule[] = [
  {
    terms: ['超静定', '刚架', '连续梁', '三弯矩', '位移法', '力法'],
    method: '力法 / 位移法（补变形协调方程），本工具只解静定体系',
  },
  { terms: ['空间力系'], method: '空间矢量平衡（6 个方程）或三维有限元' },
  { terms: ['大变形', '塑性'], method: '几何非线性 / 弹塑性分析' },
  { terms: ['变截面'], method: '分段积分或有限元；若按等截面近似，结论与原题不等价' },
  { terms: ['动力', '振动', '冲击'], method: '达朗贝尔原理 / 振型分解 / 瞬态动力学' },
  { terms: ['疲劳', '断裂'], method: '疲劳寿命曲线（S–N）或断裂力学 K 判据' },
  { terms: ['热应力'], method: '热弹性耦合分析（温度场 + 约束变形）' },
];

/** 任务单里那 16 个词，门禁逐条造题面验。 */
export const OUT_OF_SCOPE_TERMS: readonly string[] = RULES.flatMap((rule) => rule.terms);

export function findScopeKeyword(text: string): ScopeHit | null {
  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (text.includes(term)) return { term, method: rule.method };
    }
  }
  return null;
}

export function scopeBlockMessage(hit: ScopeHit): string {
  return `题面里出现「${hit.term}」—— 这属于本工具不覆盖的题：${hit.method}。没有给任何参数，也没有换模板去算。`;
}
