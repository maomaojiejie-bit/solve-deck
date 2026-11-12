/**
 * 由 M(x) 求 v(x)：EI·v''=M 的双重积分（M5 的路径 A 用）。
 *
 * 为什么能对齐到 1e-9：库的 M 图在每个载荷不连续点都有采样点，段内 M 是线性的。
 * 段内 M 线性 ⇒ θ=∫M/EI 是二次、v=∫θ 是三次，Simpson 对三次以下多项式**精确**，
 * 所以这不是「加密到看起来收敛」，而是没有离散误差（只剩浮点舍入）。
 * 不用梯形：θ 是二次，梯形会系统性偏小 h²·M'/12 量级，绝不可能到 1e-9。
 *
 * 极值点也不靠「采样点里挑最小」——那会带 O(h²) 采样误差（实测 4e-6，过不了 1e-9）。
 * 段内 θ 是二次曲线，直接解 θ=0 得极值位置，再用三次积分式取 v，精确到浮点。
 */

export interface DeflectionSample {
  x: number;
  /** 转角，rad。 */
  theta: number;
  /** 挠度，向下为负（与 EI·v''=M、v(0)=v(L)=0 的符号一致）。 */
  v: number;
}

export interface DeflectionCurve {
  samples: DeflectionSample[];
  /** 最大挠度（含极值精细化结果），单位 m，**带符号**。 */
  vMax: number;
  vMaxX: number;
}

/** 段内 M 视为线性：θ 用梯形（对线性精确），v 用 Simpson（对二次精确）。 */
export function deflectionFromMoment(
  points: readonly [number, number][],
  EI: number,
  perSegment = 200,
): DeflectionCurve {
  if (points.length < 2) throw new Error('弯矩图至少要有两个采样点');
  if (!(EI > 0)) throw new Error('EI 必须 > 0');
  const n = perSegment % 2 === 0 ? perSegment : perSegment + 1;

  const xs: number[] = [points[0][0]];
  const ms: number[] = [points[0][1]];
  const thetas: number[] = [0];
  const vs: number[] = [0];

  let theta = 0;
  let v = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, m0] = points[i];
    const [x1, m1] = points[i + 1];
    if (!(x1 > x0)) continue;
    const h = (x1 - x0) / n;
    const mAt = (k: number) => m0 + ((m1 - m0) * k) / n;

    for (let k = 0; k < n; k += 2) {
      const mk = mAt(k);
      const mk1 = mAt(k + 1);
      const mk2 = mAt(k + 2);
      const thetaMid = theta + (h / 2) * ((mk + mk1) / EI); // 梯形对线性 M 精确
      const thetaNext = theta + (h / 3) * ((mk + 4 * mk1 + mk2) / EI);
      v += (h / 3) * (theta + 4 * thetaMid + thetaNext); // Simpson 对二次 θ 精确
      theta = thetaNext;
      xs.push(x0 + (k + 2) * h);
      ms.push(mk2);
      thetas.push(theta);
      vs.push(v);
    }
  }

  // v(0)=0 已满足；用线性刚体位移把 v(L)=0 压回去（挠曲线可差一个 C·x）。
  const last = points[points.length - 1][0];
  if (Math.abs(xs[xs.length - 1] - last) > 1e-12) throw new Error('积分终点与弯矩图终点不一致');
  const c = vs[vs.length - 1] / last;
  for (let i = 0; i < vs.length; i += 1) {
    vs[i] -= c * xs[i];
    thetas[i] -= c; // 同一个刚体位移也要从转角减掉，否则 θ(0) 停在 0 而不是 −C
  }

  const samples: DeflectionSample[] = xs.map((x, i) => ({ x, theta: thetas[i], v: vs[i] }));
  let vMax = 0;
  let vMaxX = xs[0];
  for (const item of samples) {
    if (Math.abs(item.v) > Math.abs(vMax)) {
      vMax = item.v;
      vMaxX = item.x;
    }
  }

  // 极值精细化：θ 在段内是二次，直接解 θ=0，再用三次式取该点的 v。
  for (let i = 0; i < xs.length - 1; i += 1) {
    const t0 = thetas[i];
    const t1 = thetas[i + 1];
    if (t0 === 0 || t1 === 0 || t0 * t1 > 0) continue;
    const span = xs[i + 1] - xs[i];
    const slope = (ms[i + 1] - ms[i]) / Math.max(span, 1e-18); // M 的斜率（N·m/m）
    const a = ms[i] / EI; // θ'(0)
    const b = slope / EI / 2; // θ''(0)/2
    let root: number | null = null;
    if (Math.abs(b) < 1e-30) {
      if (Math.abs(a) > 0) root = -t0 / a;
    } else {
      const disc = a * a - 4 * b * t0;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const candidate of [(-a + sq) / (2 * b), (-a - sq) / (2 * b)]) {
          if (candidate >= 0 && candidate <= span) {
            root = candidate;
            break;
          }
        }
      }
    }
    if (root === null) continue;
    const vRefined = vs[i] + t0 * root + (a * root * root) / 2 + (b * root * root * root) / 3;
    if (Math.abs(vRefined) > Math.abs(vMax)) {
      vMax = vRefined;
      vMaxX = xs[i] + root;
    }
  }

  return { samples, vMax, vMaxX };
}

/**
 * 单位载荷法（虚功）：δ(x0)=∫ M·M̄/(EI) dx。
 * M̄ 是 x0 处单位向下力产生的弯矩，与 M 同为分段线性，乘积分段二次 ⇒ Simpson 精确。
 */
export function deflectionByVirtualWork(
  momentOf: (x: number) => number,
  L: number,
  x0: number,
  EI: number,
  kinks: readonly number[] = [],
): number {
  // 分段点：0、所有载荷不连续点、x0、L（M̄ 在 x0 折角）
  const cuts = [...new Set([0, L, x0, ...kinks])]
    .filter((x) => x >= 0 && x <= L)
    .sort((a, b) => a - b);
  const bar = (x: number) => (x <= x0 ? (x * (L - x0)) / L : (x0 * (L - x)) / L);
  let total = 0;
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (!(b > a)) continue;
    const mid = (a + b) / 2;
    const fa = (momentOf(a) * bar(a)) / EI;
    const fm = (momentOf(mid) * bar(mid)) / EI;
    const fb = (momentOf(b) * bar(b)) / EI;
    total += ((b - a) / 6) * (fa + 4 * fm + fb);
  }
  return total;
}
