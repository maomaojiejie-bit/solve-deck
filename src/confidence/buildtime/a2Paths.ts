/**
 * A2 三路径（构建期）：
 *  A MNA 数值解        → 'node-voltages'
 *  B 回路方程          → 'loop-currents'
 *  C 独立工作区重判    → 'zone-residuals'
 *
 * C 必须对三组不等式各解一次并独立判定，禁止沿用 A 的 zone。
 */

import {
  a2Params,
  commitZone,
  solveZoneMNA,
  solveZoneScalar,
  type A2Point,
  type BjtZone,
} from '../../core/templates/analog/A2.ts';

export interface A2PathsResult {
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

/** C 自己的不等式判据：不调用 A2.ts 的 zoneHolds，避免共享真值源。 */
function holdsIndependent(point: A2Point, params: ReturnType<typeof a2Params>): boolean {
  const eps = 1e-9;
  if (point.zone === 'cutoff') {
    return point.vbe <= params.VBE + eps && Math.abs(point.ic) <= eps;
  }
  if (point.zone === 'active') {
    return (
      point.ib > eps &&
      point.ic > 0 &&
      point.vce > params.VCEsat + eps &&
      point.ic <= params.beta * point.ib + eps
    );
  }
  return (
    point.ib > eps &&
    point.ic > 0 &&
    Math.abs(point.vce - params.VCEsat) <= 1e-6 &&
    point.ic <= params.beta * point.ib + eps
  );
}

function residual(a: A2Point, b: A2Point): number {
  return Math.max(
    relative(a.ib, b.ib),
    relative(a.ic, b.ic),
    relative(a.ie, b.ie),
    relative(a.vce, b.vce),
  );
}

export function runA2Paths(input: Input): A2PathsResult {
  const params = a2Params(input);
  const committed = commitZone(params);
  const zone = committed.zone;

  const mna = solveZoneMNA(params, zone);
  const loop = solveZoneScalar(params, zone);

  // C：对每个 zone 各解一次并回代不等式；不读 committed.zone。
  const candidates: A2Point[] = [];
  for (const candidateZone of ['cutoff', 'active', 'saturation'] as BjtZone[]) {
    const point = solveZoneScalar(params, candidateZone);
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
      ? `A/B/C 工作点一致（${zone}）；C 独立重判恰好一组不等式成立`
      : !independentRecheck
        ? 'C 未独立重判：沿用求解假设的 zone'
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