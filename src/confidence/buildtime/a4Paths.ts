/**
 * A4 三路径：
 *  A MNA 数值解        → 'node-voltages'
 *  B 回路方程          → 'loop-currents'
 *  C 图解法 + 独立重判 → 'zone-residuals'
 */

import {
  a4Params,
  commitZone,
  solveZoneGraphical,
  solveZoneMNA,
  solveZoneScalar,
  type A4Point,
  type MosZone,
} from '../../core/templates/analog/A4.ts';

export interface A4PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'node-voltages';
  pathBIntermediate: 'loop-currents';
  pathCIntermediate: 'zone-residuals';
  zoneA: string;
  zoneB: string;
  zoneC: string;
  independentRecheck: boolean;
}

type Input = Record<string, number | string>;

function relative(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-9, Math.abs(a), Math.abs(b));
}

/** C 自己的不等式判据：不调用 A4.ts 的 zoneHolds。 */
function holdsIndependent(point: A4Point, params: ReturnType<typeof a4Params>): boolean {
  if (!Number.isFinite(point.id)) return false;
  const eps = 1e-9;
  const vov = point.vgs - params.Vth;
  if (point.zone === 'cutoff') return vov <= eps && Math.abs(point.id) <= eps;
  if (point.id < -eps) return false;
  if (point.zone === 'saturation') return vov > eps && point.vds >= vov - eps;
  return vov > eps && point.vds < vov;
}

function residual(a: A4Point, b: A4Point): number {
  return Math.max(relative(a.id, b.id), relative(a.vgs, b.vgs), relative(a.vds, b.vds));
}

export function runA4Paths(input: Input): A4PathsResult {
  const params = a4Params(input);
  const committed = commitZone(params);
  const zone = committed.zone;

  const mna = solveZoneMNA(params, zone);
  const loop = solveZoneScalar(params, zone);

  const candidates: A4Point[] = [];
  for (const candidateZone of ['cutoff', 'saturation', 'triode'] as MosZone[]) {
    const point = solveZoneGraphical(params, candidateZone);
    if (holdsIndependent(point, params)) candidates.push(point);
  }
  const independentRecheck = true;
  const zoneC = candidates.length === 1 ? candidates[0].zone : 'ambiguous';
  const cPoint = candidates.length === 1 ? candidates[0] : null;

  const numeric = cPoint
    ? Math.max(residual(mna, loop), residual(mna, cPoint))
    : Number.POSITIVE_INFINITY;
  const ok =
    independentRecheck &&
    candidates.length === 1 &&
    mna.zone === loop.zone &&
    mna.zone === zoneC &&
    numeric <= 1e-6;

  return {
    ok,
    maxResidual: ok ? numeric : Math.max(1, numeric),
    detail: ok
      ? `A/B/C 工作点一致（${zone}）；C 图解 + 独立重判恰好一组不等式成立`
      : candidates.length !== 1
        ? `C 独立重判得到 ${candidates.length} 个候选工作区（必须恰好 1 个）`
        : `A/B/C 工作点离散：A=${mna.zone} B=${loop.zone} C=${zoneC}，残差=${numeric}`,
    pathAIntermediate: 'node-voltages',
    pathBIntermediate: 'loop-currents',
    pathCIntermediate: 'zone-residuals',
    zoneA: mna.zone,
    zoneB: loop.zone,
    zoneC,
    independentRecheck,
  };
}