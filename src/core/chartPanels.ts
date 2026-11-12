/**
 * W21-B B1 · 「N(x)≡0 就别画那张图」；W21-C C0-3 把判据做全。
 *
 * 体验报告 5.6：弯曲题固定渲染一张轴力图，y 轴 −1..1、曲线恒为 0，一条
 * 零信息直线占掉半屏。同类还有 Q(x)≡0、M(x)≡0 与「只有一条水平线」的空图。
 * 判据放在 core（纯函数、node 门禁可直接真跑），由 `render/Chart.tsx` 与
 * `core/lab/measures.ts` 共用，避免两处各写一套。
 */

import type { ChartSpec } from './types.ts';

/**
 * 采样点是一条水平线且值为 0 → 这一整张 panel 没有信息：
 * max − min < 1e-9（平线）且 |值| < 1e-9（贴着零轴）。系列缺失时不擅自判零。
 * 恒非零的水平线（如纯压杆的 N 图）是有信息量的，照画。
 */
export function isFlatZeroPanel(panel: ChartSpec): boolean {
  if (!panel.series || panel.series.length === 0) return false;
  return panel.series.every((series) => {
    if (series.points.length === 0) return false;
    const ys = series.points.map((point) => point[1]);
    const spread = Math.max(...ys) - Math.min(...ys);
    return spread < 1e-9 && Math.abs(ys[0]) < 1e-9;
  });
}

/** 渲染层与结论卡共用的可见面板；全零时返回空数组（调用方给一句人话）。 */
export function visiblePanels(spec: ChartSpec): ChartSpec[] {
  const panels = spec.panels && spec.panels.length > 0 ? spec.panels : [spec];
  return panels.filter((panel) => !isFlatZeroPanel(panel));
}

/** 被判恒零、不给画轴的面板（渲染层据此出一行灰字）。 */
export function flatZeroPanels(spec: ChartSpec): ChartSpec[] {
  const panels = spec.panels && spec.panels.length > 0 ? spec.panels : [spec];
  return panels.filter((panel) => isFlatZeroPanel(panel));
}
