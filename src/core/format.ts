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

/** SI 紧凑前缀，画布标签与电气类数值共用这一个数字写法。 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${Number((value / 1e6).toPrecision(3))}M`;
  if (abs >= 1e3) return `${Number((value / 1e3).toPrecision(3))}k`;
  return `${Number(value.toPrecision(4))}`;
}

const ELECTRICAL_UNITS = new Set(['Ω', 'A', 'S', 'V', 'F']);

/** 带单位的统一写法：左栏器件值、右栏参数实验场、结论卡都调它。 */
export function formatScalar(value: number | string, unit?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const u = unit ?? '';
  if (ELECTRICAL_UNITS.has(u)) {
    const abs = Math.abs(value);
    // 小信号：0.001 A → 1mA、0.000001 F → 1μF；不给「0.00 A」这种假零。
    if (u === 'A' && abs > 0 && abs < 0.01) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    if (u === 'S' && abs > 0 && abs < 1) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    if (u === 'F' && abs > 0 && abs < 1e-6) return `${Number((value * 1e6).toPrecision(3))}μ${u}`;
    if (u === 'V' && abs > 0 && abs < 1) return `${Number((value * 1e3).toPrecision(3))}m${u}`;
    return `${formatCompact(value)}${u}`;
  }
  if (u === 'm') return `${value.toFixed(2)} m`;
  if (u === 'MPa') return `${value.toFixed(1)} MPa`;
  if (u) return `${Number(value.toPrecision(3))} ${u}`;
  return `${Number(value.toPrecision(3))}`;
}
