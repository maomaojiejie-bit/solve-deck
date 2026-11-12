/**
 * 规则解析（W6 §3-A）：不配 key 也要能把最常见的中文题面变成「模板 + 若干参数」。
 *
 * 只做三件事：命关键词定模板、抓 `key=数 单位`、把剩下的「裸数值 + 单位」按单位
 * 兼容性塞进该型的参数槽。**不做任何计算** —— 这里不出现 σ、Av、Pcr 之类的结果。
 *
 * 抓不到的参数就留在 `unsure` 里，交给页面的表单让人补（不猜）。
 */

import { getTemplateRoute, type ParamSpec } from '../templates/registry.ts';

export interface RuleOutcome {
  templateId: string;
  reason: string;
  params: Record<string, number>;
  unsure: string[];
  /** 命中的关键词，给「匹配理由」兜底用。 */
  matched: string[];
}

interface Rule {
  templateId: string;
  /** 命中即加分；分数低者优先（更具体的规则给低分）。 */
  score: number;
  keywords: RegExp;
  reason: string;
  /** 这些词出现时必须让位给别的型（例如「悬臂」只在没有「扭转」时算 M3）。 */
  veto?: RegExp;
}

/**
 * 关键词表：顺序 = 具体度。分低者胜（静不定 > 桁架 > 主应力 > 悬臂 > 简支）。
 * 只覆盖 ready 的 28 型 + 变体，够 W6 的「常见题」用。
 */
const RULES: Rule[] = [
  { templateId: 'S1-indeterminate', score: 8, keywords: /静不定|超静定|多余约束/, reason: '题面出现静不定 / 多余约束，按 S1 的静不定组态判据' },
  { templateId: 'S1-mechanism', score: 8, keywords: /机构|几何可变|自由度.{0,4}大于零/, reason: '题面出现机构 / 几何可变，按 S1 的机构组态判据' },
  { templateId: 'S7', score: 10, keywords: /虚功|虚位移/, reason: '题面出现虚功 / 虚位移，属于 S7' },
  { templateId: 'S4', score: 10, keywords: /摩擦|自锁|摩擦角|斜面/, reason: '题面出现摩擦 / 自锁，属于 S4' },
  { templateId: 'S6', score: 10, keywords: /形心|重心|截面形心/, reason: '题面要求形心 / 重心，属于 S6' },
  { templateId: 'S5', score: 12, keywords: /桁架|节点法|截面法/, reason: '题面出现桁架 / 节点法，属于 S5' },
  { templateId: 'S2', score: 14, keywords: /汇交|共点力/, reason: '题面出现汇交力系，属于 S2' },
  { templateId: 'M6', score: 16, keywords: /主应力|莫尔圆|应力状态|主平面|主单元体/, reason: '题面要求主应力 / 莫尔圆，属于 M6' },
  { templateId: 'M7', score: 16, keywords: /压杆|欧拉|临界力|稳定校核|柔度/, reason: '题面出现压杆 / 欧拉 / 临界力，属于 M7' },
  { templateId: 'M8', score: 16, keywords: /组合变形|弯扭|偏心压缩|拉弯|压弯/, reason: '题面出现组合变形 / 弯扭，属于 M8' },
  { templateId: 'M2', score: 18, keywords: /扭转|扭矩|圆轴/, reason: '题面出现扭转 / 圆轴，属于 M2' },
  { templateId: 'M1', score: 18, keywords: /轴向拉|拉压|拉杆|杆件伸长|轴向变形/, reason: '题面出现轴向拉压 / 伸长，属于 M1' },
  { templateId: 'M4', score: 20, keywords: /弯曲正应力|抗弯截面系数|正应力.{0,6}(梁|截面)|矩形截面梁/, reason: '题面要求弯曲正应力 / 截面系数，属于 M4' },
  { templateId: 'M5', score: 20, keywords: /挠度|挠曲线|转角.{0,4}挠度|弯曲变形/, reason: '题面要求挠度 / 挠曲线，属于 M5' },
  { templateId: 'M3-cantilever', score: 24, keywords: /悬臂|固定端.{0,6}梁|自由端/, reason: '题面是悬臂（固定端 + 自由端），走 M3 的悬臂组态' },
  { templateId: 'M3', score: 26, keywords: /简支|跨中|两支座.{0,6}梁|剪力图|弯矩图/, reason: '题面是简支梁 / 要求剪力弯矩图，属于 M3' },
  { templateId: 'S3', score: 28, keywords: /支座反力|平面任意力系|主矢|主矩|固定铰|可动铰/, reason: '题面要求支座反力 / 力系简化，属于 S3' },
  { templateId: 'S1', score: 30, keywords: /静定|约束|二力杆|受力图/, reason: '题面问静定判据 / 约束，属于 S1' },
  { templateId: 'A5-CG', score: 34, keywords: /共栅/, reason: '题面出现共栅，走 A5 的共栅组态' },
  { templateId: 'A5-CD', score: 34, keywords: /共漏|源极跟随/, reason: '题面出现共漏 / 源极跟随，走 A5 的共漏组态' },
  { templateId: 'A5', score: 36, keywords: /共源|MOS|场效应管/, reason: '题面出现共源 / MOS，属于 A5' },
  { templateId: 'A4', score: 38, keywords: /MOS 放大|MOSFET 偏置|VTN|Kn/, reason: '题面出现 MOS 管参数偏置，属于 A4' },
  { templateId: 'A2', score: 38, keywords: /分压式|偏置电路|静态工作点/, reason: '题面问分压偏置 / 静态工作点，属于 A2' },
  { templateId: 'A1', score: 38, keywords: /二极管|稳压管|整流/, reason: '题面出现二极管 / 稳压管，属于 A1' },
  { templateId: 'A6', score: 38, keywords: /理想运放|运算放大器|反相放大|同相放大/, reason: '题面出现理想运放，属于 A6' },
  { templateId: 'A7', score: 36, keywords: /负反馈|反馈深度|闭环增益/, reason: '题面出现负反馈，属于 A7' },
  { templateId: 'D1', score: 40, keywords: /卡诺图|最小项|逻辑函数化简/, reason: '题面问卡诺图 / 化简，属于 D1' },
  { templateId: 'D2', score: 40, keywords: /门电路|与或非|逻辑图/, reason: '题面出现门电路，属于 D2' },
  { templateId: 'D3', score: 40, keywords: /多路选择器|数据选择器|编码器/, reason: '题面出现多路选择器 / 编码器，属于 D3' },
  { templateId: 'D4', score: 40, keywords: /触发器|JK|状态表/, reason: '题面出现触发器，属于 D4' },
  { templateId: 'D5', score: 40, keywords: /序列检测|状态图|状态机/, reason: '题面出现序列检测 / 状态机，属于 D5' },
  { templateId: 'D6', score: 40, keywords: /进制|数制|二进制转换|原码|补码/, reason: '题面问数制 / 补码，属于 D6' },
];

/* ── 单位 ─────────────────────────────────────────────────────────── */

const UNIT_ALIAS: Record<string, string> = {
  'ω': 'Ω',
  'Ω': 'Ω',
  'kω': 'kΩ',
  'kΩ': 'kΩ',
  'MΩ': 'MΩ',
  'mv': 'mV',
  'mA': 'mA',
  'ma': 'mA',
  'mS': 'mS',
  'μS': 'μS',
  'uS': 'μS',
  'μa': 'μA',
  'μA': 'μA',
  'mm2': 'mm²',
  'mm²': 'mm²',
  'kN·m': 'kN·m',
  'kNm': 'kN·m',
  'kN/m': 'kN/m',
  'N/m': 'N/m',
  'N·m': 'N·m',
};

/** 数值换挡表：`从>到`。表里没有 = 换不了，只能留在 unsure。 */
const SCALE: Record<string, number> = {
  'kΩ>Ω': 1e3,
  'MΩ>Ω': 1e6,
  'mA>A': 1e-3,
  'μA>A': 1e-6,
  'mV>V': 1e-3,
  'mS>S': 1e-3,
  'μS>S': 1e-6,
  'mm>m': 1e-3,
  'cm>m': 1e-2,
  'cm>mm': 10,
  'm>mm': 1e3,
  'GPa>MPa': 1e3,
  'kPa>MPa': 1e-3,
  'MPa>GPa': 1e-3,
  'N>kN': 1e-3,
  'kN>N': 1e3,
  'N·m>kN·m': 1e-3,
  'kN·m>N·m': 1e3,
  'N/m>kN/m': 1e-3,
  'kN/m>N/m': 1e3,
  'cm²>mm²': 100,
  'm²>mm²': 1e6,
  'mm²>m²': 1e-6,
};

/** 题面里允许出现的单位（W6 §2-4）。 */
export const KNOWN_UNITS = new Set([
  'm', 'mm', 'cm', 'kN', 'N', 'MPa', 'GPa', 'kPa', 'Ω', 'kΩ', 'MΩ',
  'mA', 'A', 'μA', 'V', 'mV', 'kN·m', 'N·m', 'kN/m', 'N/m', 'mm²', 'cm²', 'm²', '°', 'rad', 'S', 'mS', 'μS',
]);

export function normalizeUnit(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  return UNIT_ALIAS[text] ?? UNIT_ALIAS[text.toLowerCase()] ?? text;
}

function convert(value: number, from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return value;
  if (from === to) return value;
  const scale = SCALE[`${from}>${to}`];
  if (scale === undefined) return null;
  return value * scale;
}

/* ── 抓数 ─────────────────────────────────────────────────────────── */

const NUMBER = '-?\\d+(?:\\.\\d+)?';
const UNIT = 'mm²|mm2|cm²|cm2|m²|m2|kN·m|kNm|kN/m|N/m|N·m|kΩ|MΩ|Ω|mA|μA|mV|kN|MPa|GPa|kPa|mm|cm|m|N|A|V|°|rad|S|ω';
const PAIR = new RegExp(`([A-Za-zα-ωΑ-Ω][A-Za-z0-9]{0,3})\\s*[=＝]\\s*(${NUMBER})\\s*(${UNIT})?`, 'g');
const BARE = new RegExp(`(${NUMBER})\\s*(${UNIT})`, 'g');

/** 题面里出现、但单位表里没有的「数 + 词」：要求人填，不猜。 */
export function unknownUnits(text: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`(${NUMBER})\\s*([A-Za-zΩμ°²·/]{1,4})`, 'g');
  for (const match of text.matchAll(re)) {
    const raw = normalizeUnit(match[2]);
    if (!raw) continue;
    if (KNOWN_UNITS.has(raw)) continue;
    // 「2m，」「10kN」之类不会被抓；只有真的像个单位才报（纯字母，且不是中文字）
    if (/^[A-Za-z]+$/.test(raw) && raw.length <= 4) out.add(match[2]);
  }
  return [...out];
}

/** 参数别名：题面里的写法 → ParamSpec.key。按目标模板的 key 再对一次，优先用巧合同名的。 */
const ALIAS: Record<string, string[]> = {
  sx: ['σx', 'σ_x', 'sigmax', 'σ1x'],
  sy: ['σy', 'σ_y', 'sigmay'],
  txy: ['τxy', 'τ', 'txy', 'taoxy', 'τxy'],
  beta: ['β', 'beta', 'β0', 'hfe', 'HFE'],
  gm: ['gm', 'g_m', '跨导'],
  mu: ['μ', 'mu', 'f'],
  alpha: ['α', 'alpha'],
  th1: ['θ1', 'theta1', 'θ_1'],
  th2: ['θ2', 'theta2', 'θ_2'],
  W: ['W', 'G', 'P', 'Q'],
  P: ['P', 'F', 'N'],
  L: ['L', 'l'],
  Ic: ['IC', 'Ic', 'IQ'],
  Vf: ['Vf', 'VD'],
  Vz: ['Vz'],
};

function keyAliases(key: string): string[] {
  const lower = key.toLowerCase();
  return [key, lower, ...(ALIAS[key] ?? []), ...(ALIAS[lower] ?? [])];
}

/** 该型「裸数值」的落位顺序 = ParamSpec 的声明顺序（L, a, P… 本来就是自然的填空题顺序）。 */
function slotParams(params: readonly ParamSpec[]): ParamSpec[] {
  return params.filter((param) => param.kind === 'number');
}

/**
 * 裸数值（没有 `key=` 前缀的那种）**只往载荷上落**。
 * 理由是题面习惯：「端部集中力 10kN」不会写成 `P=10kN`，但「L=2m / b=100mm」一定会带符号、
 * 带的符号还能对上参数表。反过来把 10kN 猜成 `a`、把 80GPa 猜成 `sx`，就是在猜（W6 第 2 条）。
 */
const LOAD_SLOTS: Record<string, string[]> = {
  M1: ['P'],
  M2: ['T'],
  M3: ['P', 'q'],
  'M3-cantilever': ['P', 'q'],
  M4: ['P'],
  M5: ['P'],
  M7: ['P'],
  M8: ['Pn', 'Pt', 'T'],
  S1: ['P'],
  'S1-indeterminate': ['P'],
  'S1-mechanism': ['P'],
  S2: ['F1', 'F2'],
  S3: ['P1', 'P2'],
  S4: ['W'],
  S5: ['P'],
  S7: ['W'],
};

/** 所有命中的规则（按分数从具体到宽泛）。W21-B B3 首页贴题要用它判「唯一 / 多条」。 */
export function ruleMatches(text: string): { templateId: string; reason: string; score: number; matched: string[] }[] {
  const hits: { templateId: string; reason: string; score: number; matched: string[] }[] = [];
  for (const rule of RULES) {
    if (rule.veto && rule.veto.test(text)) continue;
    const hit = rule.keywords.exec(text);
    if (!hit) continue;
    hits.push({ templateId: rule.templateId, reason: rule.reason, score: rule.score, matched: [hit[0]] });
  }
  return hits.sort((a, b) => a.score - b.score);
}

export function ruleMatch(text: string): { templateId: string; reason: string; score: number; matched: string[] } | null {
  return ruleMatches(text)[0] ?? null;
}

/**
 * 规则解析主入口：`params` 里只放**题面里明确抽到的**参数，其余留在 unsure。
 * 一个参数都抽不到也不算失败（模板命中就行，剩下的让人填）。
 */
export function parseByRule(text: string): RuleOutcome | null {
  const match = ruleMatch(text);
  if (!match) return null;
  const route = getTemplateRoute(match.templateId);
  if (!route) return null;
  const params = route.entry.params ?? [];
  const values: Record<string, number> = {};
  const unsure = new Set<string>();
  const specByKey = new Map(params.map((param) => [param.key, param]));
  const byAlias = new Map<string, ParamSpec>();
  for (const param of slotParams(params)) {
    for (const alias of keyAliases(param.key)) byAlias.set(alias, param);
  }

  // ① `key=数 单位`；同时把吃掉的片段从文本里抹掉，免得 ② 又抓一遍
  let rest = text;
  for (const hit of text.matchAll(PAIR)) {
    const [, rawKey, rawValue, rawUnit] = hit;
    const unit = normalizeUnit(rawUnit);
    const spec = specByKey.get(rawKey) ?? byAlias.get(rawKey) ?? byAlias.get(rawKey.toLowerCase());
    if (!spec) continue;
    rest = rest.replace(hit[0], ' ');
    const value = convert(Number(rawValue), unit, normalizeUnit(spec.unit));
    if (value === null) {
      unsure.add(spec.key);
      continue;
    }
    values[spec.key] = value;
  }

  // ② 剩下的「数 + 单位」只填载荷槽（L=2m 之外的「10kN」「5kN/m」靠这条）
  for (const hit of rest.matchAll(BARE)) {
    const [, rawValue, rawUnit] = hit;
    const unit = normalizeUnit(rawUnit);
    if (!unit) continue;
    for (const key of LOAD_SLOTS[match.templateId] ?? []) {
      const spec = specByKey.get(key);
      if (!spec || spec.kind !== 'number' || values[key] !== undefined) continue;
      const target = normalizeUnit(spec.unit);
      if (!target) continue;
      const value = convert(Number(rawValue), unit, target);
      if (value === null) continue;
      values[key] = value;
      break;
    }
  }

  // ③ 位置词 → 载荷位置（跨中 / 端部）
  const L = values.L;
  const aSpec = specByKey.get('a');
  if (aSpec && values.a === undefined && L !== undefined) {
    if (/跨中|中点/.test(text)) values.a = L / 2;
    else if (/端部|自由端/.test(text) && /悬臂|自由端/.test(text)) values.a = L;
  }

  // ④ 没抽到的数值型参数一律记成「待确认」
  for (const spec of slotParams(params)) {
    if (values[spec.key] === undefined) unsure.add(spec.key);
  }

  return { templateId: match.templateId, reason: match.reason, params: values, unsure: [...unsure], matched: match.matched };
}
