/**
 * W21-B B5 · 数值只准有一种写法。
 *
 * 体验报告 5.9：同一个 100000 Ω 在左栏写 `100000 Ω`、画布写 `100k`、
 * 右栏写 `100000`，学生要自己换算三遍。这里把「数怎么显示」收成一个函数：
 *   - `formatCompact`：画布标签里的数字部分（`100k`、`2`、`30`）；
 *   - `formatScalar`：带单位的完整写法（`100kΩ`、`2.00 m`、`30.0 MPa`）。
 *
 * 只管显示，不参与任何计算 / 归约 / 求解；输入编辑框仍保留原始数字方便改。
 */

import { forceUnitText, getUnitMode, type UnitMode } from './units.ts';

/** SI 紧凑前缀，画布标签与电气类数值共用这一个数字写法。 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${Number((value / 1e6).toPrecision(3))}M`;
  if (abs >= 1e3) return `${Number((value / 1e3).toPrecision(3))}k`;
  return `${Number(value.toPrecision(4))}`;
}

const ELECTRICAL_UNITS = new Set(['Ω', 'A', 'S', 'V', 'F']);

/**
 * P0：归约用 `1e12` 表示「这个元件等于不存在」（`picks.ts` 里 Rc / Rl 的
 * `missing: 1e12`，规则文案就是「Rc→∞ / 按空载处理」）。它是个合法数值，
 * 但摆到界面上就是 `1000000000000` 外加一个假的越界红条 —— 这里统一认成 ∞。
 */
export const INFINITE_VALUE = 1e12;

/** 这个参数值是不是「等于不存在」的哨兵。 */
export function isInfiniteValue(value: unknown): boolean {
  return typeof value === 'number' && Math.abs(value) >= INFINITE_VALUE;
}

/** 带单位的统一写法：左栏器件值、右栏参数实验场、结论卡都调它。 */
export function formatScalar(value: number | string, unit?: string, mode: UnitMode = getUnitMode()): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (isInfiniteValue(value)) return '∞';
  const u = unit ?? '';
  // R-37：默认档 auto 完全走原逻辑（门禁断言的读数逐字不变）；
  // 切换档只改写显示文本，不进任何求解 / 归约。
  if (mode !== 'auto') {
    const forced = forceUnitText(value, u, mode);
    if (forced !== null) return forced;
  }
  if (ELECTRICAL_UNITS.has(u)) {
    const abs = Math.abs(value);
    // 小信号：0.001 A → 1mA、1.9e-5 A → 19.2μA、0.000001 F → 1μF；不给「0.00 A」这种假零。
    // R-36：A 加 μA 档 —— 基极偏置 1.9e-5 A 原来会显示成 0.0192mA，还得再换算一次。
    if (u === 'A' && abs > 0 && abs < 1e-3) return `${Number((value * 1e6).toPrecision(3))}μ${u}`;
    if (u === 'A' && abs >= 1e-3 && abs < 1) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    if (u === 'S' && abs > 0 && abs < 1) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    if (u === 'F' && abs > 0 && abs < 1e-6) return `${Number((value * 1e6).toPrecision(3))}μ${u}`;
    if (u === 'V' && abs > 0 && abs < 1) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    return `${formatCompact(value)}${u}`;
  }
  if (u === 'm') return `${value.toFixed(2)} m`;
  if (u === 'MPa') return `${value.toFixed(1)} MPa`;
  // 角度不空格：`36.9°`，不是 `36.9 °`。
  if (u === '°') return `${Number(value.toPrecision(3))}°`;
  // 力学 / 结构：kN·m、mm⁴、mm³ 这类量给 4→5 位有效数字。
  // 3 位会把 12566 mm³ 印成 12600（差 0.5%），表里看着像算错了。
  if (u) return `${Number(value.toPrecision(5))} ${u}`;
  return `${Number(value.toPrecision(3))}`;
}
