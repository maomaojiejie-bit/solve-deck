/**
 * 拆解台 · SolveDeck —— 符号与校验约定（设计稿第 8.1 节）
 *
 * 本文件保持零 import、只导出纯谓词/常量，可进浏览器。
 * 六项 ConfidenceReport 的组装在 confidence/index.ts；
 * digitaljs/QMC 只在 confidence/buildtime/。
 */

export type SupportKind = 'pin' | 'roller' | 'fixed' | 'cable' | 'smooth';

/** 支座反力：未知量个数与方向定义。 */
export const SUPPORT_REACTIONS: Record<
  SupportKind,
  { unknowns: number; components: readonly string[]; rule: string }
> = {
  pin: { unknowns: 2, components: ['Fx', 'Fy'], rule: '固定铰：两个正交反力' },
  roller: { unknowns: 1, components: ['N'], rule: '可动铰：仅接触面法向反力' },
  fixed: { unknowns: 3, components: ['Fx', 'Fy', 'M'], rule: '固定端：两力 + 一反力偶' },
  cable: { unknowns: 1, components: ['T'], rule: '柔索：沿索方向拉力' },
  smooth: { unknowns: 1, components: ['N'], rule: '光滑面：法向反力' },
} as const;

export function reactionUnknownCount(kind: SupportKind): number {
  return SUPPORT_REACTIONS[kind].unknowns;
}

/** 内力正负号：全项目唯一来源。 */
export const INTERNAL_FORCE_SIGNS = {
  shear: 'V 取左截面向上为正',
  moment: 'M 取下侧受拉（sagging）为正',
  axial: 'N 取拉为正、压为负',
} as const;

/** 杆端弯矩边界：自由端 / 铰 / 滚支为 0，固定端等于作用弯矩。 */
export type EndCondition = 'free' | 'pin' | 'roller' | 'fixed';

export function boundaryMoment(end: EndCondition, appliedMoment = 0): number {
  return end === 'fixed' ? appliedMoment : 0;
}

/** 载荷 → 内力图：一阶/二阶变化规律，双路径判据都引用这里。 */
export const LOAD_DIAGRAM_RULES = {
  udl: 'UDL w → V 线性、M 抛物线',
  pointLoad: '集中力 P → V 台阶、M 折点',
  couple: '集中力偶 M0 → V 不变、M 台阶',
} as const;

export const EQUILIBRIUM_CONVENTIONS = {
  planar: 'ΣFx = ΣFy = ΣM = 0',
  trussNode: '桁架节点 ΣF = 0；杆力拉为正、压为负',
  bendingRelation: 'V = dM/dx',
  simpleSupportEnd: '简支端 M = 0',
} as const;

/** 器件约定：BJT / MOS / PNP / PMOS。 */
export const DEVICE_CONVENTIONS = {
  bjt: {
    vbeOn: 0.7,
    icFromIb: 'I_C = β·I_B',
    ieFromIb: 'I_E = (β+1)·I_B',
  },
  mos: {
    saturationInequalities: 'V_GS>Vth 且 V_DS≥V_GS−Vth',
  },
  polarity: 'PNP / PMOS 的全部电压、电流符号相对 NPN / NMOS 反转',
} as const;

export const BJT_VBE_ON = DEVICE_CONVENTIONS.bjt.vbeOn;

/** 由 β、I_B 求 I_C（A）。 */
export function collectorCurrent(beta: number, baseCurrent: number): number {
  return beta * baseCurrent;
}

/** PNP / PMOS 的符号反转：同一读数取反，单独测。 */
export function flipDeviceSigns(
  readings: Readonly<Record<string, number>>,
): Record<string, number> {
  const flipped: Record<string, number> = {};
  for (const [name, value] of Object.entries(readings)) flipped[name] = -value;
  return flipped;
}

export type MosChannel = 'n' | 'p';
export type MosRegion = 'cutoff' | 'triode' | 'saturation';

/**
 * MOS 工作区判定（§2.2 判定循环的单次求解）。
 * PMOS 不另写一套不等式：先把 Vgs / Vds / Vth 翻到 N 沟道等效符号再判。
 * 边界取饱和（Vds ≥ Vov），与 §8.2 mosSat 一致。
 */
export function mosRegion(
  vgs: number,
  vds: number,
  vth: number,
  channel: MosChannel,
): MosRegion {
  const polarity = channel === 'n' ? 1 : -1;
  const vgsEff = polarity * vgs;
  const vdsEff = polarity * vds;
  const vthEff = polarity * vth;

  if (vgsEff <= vthEff) return 'cutoff';
  if (vdsEff < vgsEff - vthEff) return 'triode';
  return 'saturation';
}

/** 工作区不等式回代：A2/A4 双路径的最后一道门。 */
export function mosInequalitiesHold(
  region: MosRegion,
  vgs: number,
  vds: number,
  vth: number,
  channel: MosChannel,
): boolean {
  return mosRegion(vgs, vds, vth, channel) === region;
}

/** 简支 / 悬臂梁自由端边界（双路径判据引用）。 */
export function endMomentIsZero(condition: EndCondition): boolean {
  return boundaryMoment(condition) === 0;
}
