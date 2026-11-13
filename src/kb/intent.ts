/**
 * K1 · 意图分流 —— 只分「做题」还是「查概念」，**不做识别、不做错字容错**
 * （那是后面批次的事；判错就改用例，这里不兜）。
 */

export type Intent = 'problem' | 'concept';

/** 祈使动词（出现即算题面）：求 / 计算 / 校核 / 画出 / 确定。 */
const IMPERATIVE = /(求|计算|校核|画出|确定)/;

/**
 * 「数值+单位」：数字紧跟字母/Ω/%（`12kN` `2m` `100Ω` `1mS` `20kN/m`）。
 * 两个及两个以上 → 题面（概念句通常不带数字单位，或只带一个）。
 */
const VALUE_WITH_UNIT = /\d+(?:\.\d+)?\s*(?:[kKmMnNμu]?(?:N|Ω|S|V|A|W|Hz|Pa|MPa|GPa|mol)|mm|cm|km|m(?![a-zA-Z])|Ω|%)/g;

export function detectIntent(text: string): Intent {
  if (IMPERATIVE.test(text)) return 'problem';
  const unitValues = text.match(VALUE_WITH_UNIT)?.length ?? 0;
  return unitValues >= 2 ? 'problem' : 'concept';
}

/** 门禁 ① 的 20 条用例：10 题面 / 10 术语。 */
export const INTENT_CASES: { text: string; want: Intent }[] = [
  // ── 题面（problem）10 条 ──
  { text: '求简支梁在 q=10kN/m 作用下的跨中弯矩', want: 'problem' },
  { text: '计算 12kN 集中力作用下 L=4m 悬臂梁的固定端反力', want: 'problem' },
  { text: '校核这根压杆 P=200kN、L=3m 的稳定性', want: 'problem' },
  { text: '画出 M=2kN·m 与 F=5kN 一起作用时的弯矩图', want: 'problem' },
  { text: '确定 Rc=4.7kΩ、β=100 时的工作点', want: 'problem' },
  { text: '100Ω 和 200Ω 并联后等效电阻是多少', want: 'problem' },
  { text: 'VCC=12V、Rb=470kΩ 的偏置电路，IC 是多少', want: 'problem' },
  { text: '求 F=AB+C 的真值表并化简', want: 'problem' },
  { text: 'σ=80MPa、τ=30MPa，求主应力和最大切应力', want: 'problem' },
  { text: '一个 2kN 的力按 30° 斜拉，求水平分量', want: 'problem' },
  // ── 术语（concept）10 条 ──
  { text: '虚短虚断是什么', want: 'concept' },
  { text: '弯矩图怎么画', want: 'concept' },
  { text: '什么是零杆', want: 'concept' },
  { text: '莫尔圆的用途', want: 'concept' },
  { text: '卡诺图化简的步骤', want: 'concept' },
  { text: '深度负反馈的意义', want: 'concept' },
  { text: '自锁条件', want: 'concept' },
  { text: '什么是压杆稳定', want: 'concept' },
  { text: '补码的运算规则', want: 'concept' },
  { text: '交越失真', want: 'concept' },
];
