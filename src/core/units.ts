/**
 * R-37 · 读数单位制（全局偏好，localStorage 持久化）。
 *
 * 关键约束：`auto` 档必须让 `formatScalar` 的输出与改动前**逐字相同** ——
 * 几十条门禁直接断言读数文本，一点偏差都会红。所以切换只作用于显示层，
 * 不参与任何计算 / 归约 / 求解；Node 门禁环境没有 localStorage，天然回落 auto。
 *
 * 三档语义：
 *   auto —— 原写法（电气量自动前缀、力学量按题面单位）
 *   si   —— 基本单位，无前缀（100000 Ω、2000 N、30 MPa → 3e7 Pa），适合代公式
 *   eng  —— 工程单位（0.002 m → 2.0 mm、2000 N → 2 kN、1e7 Pa → 10 MPa），适合读表
 */

export type UnitMode = 'auto' | 'si' | 'eng';
const MODES: UnitMode[] = ['auto', 'si', 'eng'];

export const UNIT_MODE_KEY = 'sd.units.v1';
const UNIT_EVENT = 'sd:units';

export const UNIT_MODE_LABEL: Record<UnitMode, string> = {
  auto: '自动',
  si: '基本单位 SI',
  eng: '工程单位',
};

function readInitial(): UnitMode {
  try {
    const raw = globalThis.localStorage?.getItem(UNIT_MODE_KEY) as UnitMode | null;
    return raw && MODES.includes(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

let current: UnitMode = readInitial();

export function getUnitMode(): UnitMode {
  return current;
}

export function setUnitMode(mode: UnitMode): void {
  if (!MODES.includes(mode)) return;
  current = mode;
  try {
    globalThis.localStorage?.setItem(UNIT_MODE_KEY, mode);
  } catch {
    /* 隐私模式下只在本会话有效 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(UNIT_EVENT, { detail: mode }));
  }
}

/** 给 useSyncExternalStore 用：切换后所有显示 formatScalar 的组件一起重渲染。 */
export function subscribeUnitMode(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UNIT_EVENT, listener);
  return () => window.removeEventListener(UNIT_EVENT, listener);
}

const num = (value: number): string => String(Number(value.toPrecision(4)));

/** 带前缀单位 → 基本单位（factor 是「乘多少变成 SI」）。 */
const TO_SI: Record<string, [number, string]> = {
  kN: [1e3, 'N'], MN: [1e6, 'N'],
  kPa: [1e3, 'Pa'], MPa: [1e6, 'Pa'], GPa: [1e9, 'Pa'],
  'kΩ': [1e3, 'Ω'], 'MΩ': [1e6, 'Ω'],
  kV: [1e3, 'V'], mV: [1e-3, 'V'],
  mA: [1e-3, 'A'], 'μA': [1e-6, 'A'],
  mF: [1e-3, 'F'], 'μF': [1e-6, 'F'], nF: [1e-9, 'F'], pF: [1e-12, 'F'],
  mS: [1e-3, 'S'],
  'kN/m': [1e3, 'N/m'], 'kN·m': [1e3, 'N·m'],
};

/** 基本单位 → 工程常用单位。Ω / V / A / F / S 交回 auto 的前缀逻辑，避免 0.1 kΩ 这种怪读数。 */
const TO_ENG: Record<string, [number, string]> = {
  N: [1e-3, 'kN'],
  Pa: [1e-6, 'MPa'],
  'N/m': [1e-3, 'kN/m'],
  'N·m': [1e-3, 'kN·m'],
};

const ELECTRICAL = new Set(['Ω', 'A', 'S', 'V', 'F']);

/**
 * 返回该档位下的显示文本；null = 这一档不改变写法（交回原 auto 逻辑）。
 * 纯函数，门禁可直接断言换算结果。
 */
export function forceUnitText(value: number, unit: string, mode: UnitMode): string | null {
  if (mode === 'auto') return null;
  if (mode === 'si') {
    const scaled = TO_SI[unit];
    if (scaled) return `${num(value * scaled[0])} ${scaled[1]}`;
    if (ELECTRICAL.has(unit)) return `${num(value)} ${unit}`;
    if (unit === 'MPa') return `${num(value * 1e6)} Pa`;
    return null;
  }
  // eng：电气量沿用 auto（已有自适应前缀），力学量换成工程单位，小长度换 mm
  const scaled = TO_ENG[unit];
  if (scaled) return `${num(value * scaled[0])} ${scaled[1]}`;
  if (unit === 'm' && value !== 0 && Math.abs(value) < 1) {
    return `${Number((value * 1e3).toPrecision(3)).toFixed(1)} mm`;
  }
  return null;
}
