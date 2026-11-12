/**
 * `#/scope` 的六问（任务单 §1）。
 *
 * 每个「否」都对应一个明确的缺口。缺口分两类：
 *  - **硬缺口**：要换一套理论（力法 / 位移法 / 有限元 / 振型分解），本工具没有 —— 不覆盖；
 *  - **软缺口**：把题改写成理想化模型就能算，但**结论与原题不等价** —— 要先简化，且必须留痕。
 *
 * 这张表是页面和门禁共用的唯一来源：页面照它渲染六问，check:scope 照它生成 64 组合。
 */

export interface ScopeQuestion {
  id: string;
  text: string;
  /** 答「否」时报出的缺口名（也是题面里那句「否 →」的右半边）。 */
  gap: string;
  kind: 'hard' | 'soft';
  /** 硬缺口：该用什么方法（不覆盖页要写出来）。 */
  method: string;
  /** 软缺口：对应的简化 id（见 simplifications.ts）。 */
  simplification?: string;
  /** 软缺口：要改成什么才算得动。 */
  change?: string;
}

export const SCOPE_QUESTIONS: readonly ScopeQuestion[] = [
  {
    id: 'q1',
    text: '支座反力能只靠静力平衡求出吗？',
    gap: '超静定',
    kind: 'hard',
    method: '力法 / 位移法：补变形协调方程才能解出多余约束',
  },
  {
    id: 'q2',
    text: '变形是线弹性小变形吗？',
    gap: '大变形 / 塑性',
    kind: 'hard',
    method: '几何非线性 / 弹塑性本构，通常要有限元',
  },
  {
    id: 'q3',
    text: '是平面问题吗？',
    gap: '空间力系',
    kind: 'hard',
    method: '空间矢量平衡（6 个方程）或三维有限元',
  },
  {
    id: 'q4',
    text: '构件截面沿长度不变吗？',
    gap: '变截面',
    kind: 'soft',
    method: '',
    simplification: 'equal-section',
    change: '把变截面梁按控制截面的惯性矩 I 当作全梁常值（等截面梁）',
  },
  {
    id: 'q5',
    text: '只有静力作用（无惯性、无冲击）吗？',
    gap: '动力 / 冲击',
    kind: 'hard',
    method: '达朗贝尔原理 / 振型分解 / 瞬态动力学',
  },
  {
    id: 'q6',
    text: '材料与几何都是线性的吗？',
    gap: '非线性',
    kind: 'soft',
    method: '',
    simplification: 'linear',
    change: '按线性材料（胡克定律）与小变形几何重算',
  },
];

export const SCOPE_TIERS = ['ok', 'simplify', 'reject'] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

export const TIER_LABEL: Record<ScopeTier, string> = {
  ok: '能直接算',
  simplify: '要先简化',
  reject: '不覆盖',
};
