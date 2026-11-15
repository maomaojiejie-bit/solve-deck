/**
 * W11「不适用」账本：28 道母题里有 13 型**没有可装配的几何**，拼接台不假装全能。
 *
 * 每型一句专属原因（不是通用话糊 13 张）+ 三个去向按钮，页面与装配门禁共用
 * 同一份数据。`token` 是逐型写死的特征词：门禁靠它防止"复制粘贴一句通用话"。
 *
 * 计数澄清：项目里 28 道母题（D1–D6 / A1–A7 / M1–M8 / S1–S7）+ M3 悬臂
 * 这一个组态变体 = 29 个装配入口，其中 **16 可装 / 13 不适用**。
 */

import { isLabSupported } from './ids.ts';

export interface NotApplicableEntry {
  id: string;
  title: string;
  /** 该型专属原因，页面上完整显示。 */
  reason: string;
  /** about 明细表用的短原因。 */
  short: string;
  /** 这一型到底算什么（卡上的第二句，给去向做解释）。 */
  what: string;
  /** 逐型写死的特征词，门禁用它验"没互相抄"。 */
  token: string;
}

export const NOT_APPLICABLE: Record<string, NotApplicableEntry> = {
  D1: {
    id: 'D1', title: 'D1 逻辑代数',
    reason: 'D1 的输入是一组最小项 / 无关项编号（bits），化简发生在卡诺图的方格合并上；这里没有引脚、导线或器件可装配。',
    short: '最小项编号在卡诺图上合并，没有引脚与导线',
    what: '能算的是摩根律、卡诺图化简、最小项与无关项。',
    token: '最小项',
  },
  D2: {
    id: 'D2', title: 'D2 组合逻辑分析',
    reason: 'D2 的输入是门级逻辑的二进制位串，分析顺序是「门 → 表达式 → 真值表」；题面不提供可增删的门电路网表。',
    short: '门级位串 → 真值表，没有器件网表',
    what: '能算的是门级表达式、真值表与逻辑功能反推。',
    token: '门级逻辑的二进制位串',
  },
  D3: {
    id: 'D3', title: 'D3 组合逻辑设计',
    reason: 'D3 的输入是译码器 / MUX / 加法器的功能位串，输出是布尔函数而不是一张连线图；装配台白名单只收电阻、电源与晶体管，装不了组合逻辑模块。',
    short: '译码器 / MUX 功能位串，输出是布尔函数',
    what: '能算的是译码、数据选择、加法与奇偶校验的逻辑设计。',
    token: '译码器 / MUX / 加法器的功能位串',
  },
  D4: {
    id: 'D4', title: 'D4 触发器',
    reason: 'D4 的输入是 SR / D / JK / T 的激励位序列与边沿时刻，输出是特性表和激励表；状态沿时钟跳变，没有一张静态装配图可摆。',
    short: 'J/K 位序列与时钟边沿，需要时序仿真',
    what: '能算的是四种触发器的特性表、激励表与次态。',
    token: '边沿时刻',
  },
  D5: {
    id: 'D5', title: 'D5 时序逻辑',
    reason: 'D5 的输入是寄存器 / 计数器的状态位流与 FSM 转移表，装配台不仿真时钟沿；这里没有可增删的器件，只有状态序列。',
    short: '寄存器状态位流 / FSM 转移表，不仿真时钟沿',
    what: '能算的是寄存器、同步异步计数器与状态机分析设计。',
    token: '状态位流与 FSM 转移表',
  },
  D6: {
    id: 'D6', title: 'D6 数制码制',
    reason: 'D6 的输入就是一个二进制数值，运算是进制 / BCD / 补码 / 格雷码之间的数位变换；数的表示法不涉及任何几何结构。',
    short: '一个二进制数值的进制 / BCD / 补码 / 格雷码变换',
    what: '能算的是数制互转、BCD、补码与格雷码。',
    token: '数的表示法不涉及任何几何结构',
  },
  M6: {
    id: 'M6', title: 'M6 莫尔圆',
    reason: 'M6 的输入是一个应力元（σx、σy、τxy），没有可以装配的梁或杆；主应力与莫尔圆是同一点的坐标变换，不是结构。',
    short: '输入是一个应力元（σx / σy / τxy），没有梁也没有杆',
    what: '能算的是主应力、莫尔圆与四大强度理论。',
    token: '一个应力元',
  },
  M8: {
    id: 'M8', title: 'M8 组合变形',
    reason: 'M8 的输入是同一截面上的内力分量（N / M / T）与直径 d，力偶位置固定在 x = 0.5；求的是该点的合成应力，没有可增删的构件拓扑。',
    short: '同一点的 N / M / T 叠加，力偶固定 x=0.5，无可增删拓扑',
    what: '能算的是拉弯、弯扭合成与 σr4 强度校核。',
    token: '力偶位置固定在 x = 0.5',
  },
  S1: {
    id: 'S1', title: 'S1 约束与受力图',
    reason: 'S1 的输出是约束矩阵的秩判据（静定 / 静不定 / 机构），题面里的支座是判据示意而非可装配白名单；改一个支座立刻落进拒绝态，中间没有可解结构。',
    short: '约束秩判据（静定 / 静不定 / 机构），改支座即拒绝态',
    what: '能算的是六类约束的反力性质与静定 / 机构判别。',
    token: '约束矩阵的秩判据',
  },
  S2: {
    id: 'S2', title: 'S2 平面汇交力系',
    reason: 'S2 的输入是四个量（F1、θ1、F2、θ2）描述的汇交力矢量，合成靠矢量投影；力是自由矢量，没有梁、杆或结点可装。',
    short: 'F1 / θ1 / F2 / θ2 四个自由矢量，没有梁杆结点',
    what: '能算的是汇交力系与力偶系的合成、平衡与力偶矩。',
    token: '力是自由矢量',
  },
  S4: {
    id: 'S4', title: 'S4 摩擦',
    reason: 'S4 的输入是摩擦系数、物重与两个角度（α、β），判据是摩擦角与自锁不等式；滑块与斜面是接触条件，不在构件白名单里。',
    short: 'μ / W / α / β 的摩擦角与自锁不等式，接触面不是构件',
    what: '能算的是摩擦角、自锁条件与临界平衡。',
    token: '摩擦角与自锁不等式',
  },
  S6: {
    id: 'S6', title: 'S6 重心与形心',
    reason: 'S6 的输入是组合截面的四个尺寸（bf、tf、bw、hw），求的是面积一阶矩与形心坐标；这是面积积分，没有节点也没有杆。',
    short: 'bf / tf / bw / hw 的面积一阶矩积分，无节点无杆',
    what: '能算的是组合体与组合截面的形心、重心。',
    token: '面积一阶矩',
  },
  S7: {
    id: 'S7', title: 'S7 虚位移原理',
    reason: 'S7 的输入是杠杆的 a、b、W 与一条虚功方程，求的是平衡关系；理想杠杆的虚位移不是可装配的构件网络，本型不画机构图。',
    short: 'a / b / W 的虚功方程，理想杠杆不画机构图',
    what: '能算的是虚位移、虚功方程与理想机构平衡。',
    token: '虚功方程',
  },
};

/** 门禁用的原始文案快照：mutated 后 notApplicableLedgerCheck 必须变红。 */
const BASE_REASONS: Record<string, string> = Object.fromEntries(
  Object.entries(NOT_APPLICABLE).map(([id, entry]) => [id, entry.reason]),
);
const BASE_REASONS_COUNT = Object.keys(BASE_REASONS).length;

export const NOT_APPLICABLE_IDS: readonly string[] = Object.keys(NOT_APPLICABLE);

export interface NotApplicableButton {
  label: string;
  hash: string;
  testId: string;
}

export interface NotApplicableView {
  id: string;
  title: string;
  reason: string;
  what: string;
  buttons: readonly NotApplicableButton[];
}

/** 页面与门禁同源：卡片上的每一个字、每一个去向都由这里给。 */
export function notApplicableView(templateId: string): NotApplicableView | null {
  const entry = NOT_APPLICABLE[templateId];
  if (!entry) return null;
  return {
    id: entry.id,
    title: entry.title,
    reason: entry.reason,
    what: entry.what,
    buttons: [
      { label: `去 ${entry.id} 看结果 →`, hash: `#/t/${entry.id}`, testId: 'na-result' },
      { label: '这一型能算什么？→ #/scope', hash: '#/scope', testId: 'na-scope' },
      { label: '回装配台选题型 → #/lab', hash: '#/lab', testId: 'na-lab' },
    ],
  };
}

/** 13 张卡的整体账：数量、不重叠、逐型原文、特征词、去向按钮。 */
export function notApplicableLedgerCheck(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const ids = Object.keys(NOT_APPLICABLE);
  if (ids.length !== BASE_REASONS_COUNT) problems.push(`不适用型应为 ${BASE_REASONS_COUNT} 型，实际 ${ids.length}`);
  const reasons = new Set<string>();
  const tokens = new Set<string>();
  for (const id of ids) {
    const entry = NOT_APPLICABLE[id];
    const view = notApplicableView(id);
    if (!view) problems.push(`${id} 生成不了卡片`);
    if (isLabSupported(id)) problems.push(`${id} 已经可装配，不该还挂在「不适用」表里`);
    if (entry.id !== id) problems.push(`${id} 的条目 id 与键不一致`);
    if (entry.reason !== BASE_REASONS[id]) problems.push(`${id} 的专属原因被改成了通用句 / 抄来的句子`);
    if (reasons.has(entry.reason)) problems.push(`${id} 的原因与别的型重复`);
    reasons.add(entry.reason);
    if (!entry.reason.includes(entry.token)) problems.push(`${id} 的原因没有自己的特征词「${entry.token}」`);
    if (tokens.has(entry.token)) problems.push(`${id} 的特征词与别的型重复`);
    tokens.add(entry.token);
    if (view && (view.buttons.length < 2 || view.buttons.some((button) => !button.hash.startsWith('#/')))) {
      problems.push(`${id} 缺去向按钮`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ── about 的逐型账本 ───────────────────────────────────────────── */

export type Subject = '数字电路' | '模拟电路' | '材料力学' | '理论力学';

export interface CoverageRow {
  id: string;
  subject: Subject;
  status: 'assemblable' | 'na';
  note: string;
}

/** 可装配的 16 个入口，各写清装的是什么结构。 */
const ASSEMBLE_NOTE: Record<string, string> = {
  A1: '二极管串联回路：Vs / R / D / GND',
  A2: 'NPN 分压偏置：R1 / R2 / Rc / Re / Vcc',
  A3: 'BJT 小信号 CE/CB：Rc / Rl / Rs / Re / Q',
  A4: 'NMOS 偏置：Rg1 / Rg2 / Rd / Rs / Vdd',
  A5: 'MOS 小信号 CS/CG：Rd / Rl / Rs / Rss / M',
  A6: '单运放反相：R1 / R2 / Vin / OPAMP',
  A7: '反馈框图：Rin / Rout / Rl 三个器件，A 与 β 是骨架级参数',
  M1: '轴向拉杆：主跨 + 两端支座 + 轴向力 P，A / E 在确认已知量表',
  M2: '圆轴扭转：轴段 + 固定端，T 取自扭矩标注，d / G 为骨架级参数',
  M3: '简支梁：pin@0 + roller@L + 跨内集中力 / 均布载荷',
  'M3-cantilever': '悬臂梁变体：固定端 + 跨中集中力（独立归约表）',
  M4: '简支梁 + 矩形截面：L / a / P 来自图，b / h 为骨架级参数',
  M5: '简支梁挠度：同 M4 骨架，E / b / h 为骨架级参数',
  M7: '两端铰压杆：按题面参数化生成一根构件（快照主图是 λ–σcr 曲线）',
  S3: '简支梁两集中力：x1 / P1 / x2 / P2 都从载荷位置取，只到反力',
  S5: '静定三角桁架：三节点三杆，m = 2j−3',
};

const ORDER = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'M1', 'M2', 'M3', 'M3-cantilever', 'M4', 'M5', 'M6', 'M7', 'M8',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
];

function subjectOf(id: string): Subject {
  if (id.startsWith('D')) return '数字电路';
  if (id.startsWith('A')) return '模拟电路';
  if (id.startsWith('M')) return '材料力学';
  return '理论力学';
}

export const LAB_LEDGER: readonly CoverageRow[] = ORDER.map((id) => {
  const status = isLabSupported(id) ? 'assemblable' : 'na';
  const note = status === 'assemblable' ? ASSEMBLE_NOTE[id] : NOT_APPLICABLE[id]?.short;
  return { id, subject: subjectOf(id), status, note: note ?? '（缺说明）' };
});

export const LAB_LEDGER_COUNTS = {
  total: LAB_LEDGER.length,
  assemblable: LAB_LEDGER.filter((row) => row.status === 'assemblable').length,
  notApplicable: LAB_LEDGER.filter((row) => row.status === 'na').length,
};
