/**
 * 莫尔圆的几何（纯函数）。
 *
 * 渲染器与 check:chart 的 ⑤⑥ 两条**共用这一个函数**，所以门禁查的不是
 * 「另一套描述」，而是屏幕上真正用的那几个数：圆心的像素位置、横纵半径。
 *
 * 圆度怎么保证：两个绘图域的跨度在 spec 里就必须相等（M6 构造时按同一 span 生成），
 * 绘图区是正方形，于是 scaleX === scaleY，rx === ry。跨度被谁改成不等，
 * scaleX/scaleY 立刻偏离 1，门禁就响。
 */

import type { MohrSpec } from '../core/types';

export const MOHR_SIZE = 340;
export const MOHR_PAD = 46;

export interface MohrLayout {
  size: number;
  pad: number;
  /** σ 轴每 MPa 的像素数。 */
  scaleX: number;
  /** τ 轴每 MPa 的像素数。 */
  scaleY: number;
  /** σ=0 / τ=0 那条轴的像素位置（不是圆心，圆心在 px(spec.center)）。 */
  axisX: number;
  axisY: number;
  /** 半径在横 / 纵方向上的像素长度（相等 ⇒ 圆）。 */
  rx: number;
  ry: number;
  /** 同时作用于两轴的绘制比例（取两者较小值，保证都装得下）。 */
  scale: number;
  px: (sigma: number) => number;
  py: (tau: number) => number;
}

export function mohrLayout(spec: MohrSpec): MohrLayout {
  const size = MOHR_SIZE;
  const pad = MOHR_PAD;
  const inner = size - 2 * pad;
  const [s0, s1] = spec.sigmaDomain;
  const [t0, t1] = spec.tauDomain;
  const spanS = s1 - s0 || 1e-9;
  const spanT = t1 - t0 || 1e-9;
  const scaleX = inner / spanS;
  const scaleY = inner / spanT;
  const scale = Math.min(scaleX, scaleY);

  // 两域跨度相等时，两个方向都正好铺满；不等时取小的那个并居中，仍然是同一个比例。
  const axisX = pad + (0 - s0) * scale + (inner - spanS * scale) / 2;
  const axisY = pad + (t1 - 0) * scale + (inner - spanT * scale) / 2;

  return {
    size,
    pad,
    scaleX,
    scaleY,
    axisX,
    axisY,
    rx: spec.radius * scaleX,
    ry: spec.radius * scaleY,
    scale,
    px: (sigma: number) => axisX + sigma * scale,
    py: (tau: number) => axisY - tau * scale,
  };
}
