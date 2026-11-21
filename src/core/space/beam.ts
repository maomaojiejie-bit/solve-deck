// Q1 空间梁单元数学：12×12 局部刚度、随动坐标系、Hermite 形函数等效结点荷载、
// 端部铰静力凝聚、端力恢复与任意截面内力（材料力学六分量 N/Vy/Vz/T/My/Mz）。
// 局部自由度口径：[u1,v1,w1,θx1,θy1,θz1, u2,v2,w2,θx2,θy2,θz2]，v 沿局部 ŷ、w 沿局部 ẑ。
// 局部 DOF i 的力方向 = i % 3（0→x̂，1→ŷ，2→ẑ），形函数按此配对。

import { solveSquare } from "./linalg.ts";
import type { MemberLoad } from "./types";

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // 行向量：[x̂; ŷ; ẑ]

/** 随动坐标系：x̂=a→b；参考轴取全局 Y（近竖直时切换全局 Z），ŷ=投影，ẑ=x̂×ŷ（右手系）。 */
export function beamFrame(ux: number, uy: number, uz: number): Mat3 {
  const r: Vec3 = Math.abs(uy) < 0.99 ? [0, 1, 0] : [0, 0, 1];
  const dot = r[0] * ux + r[1] * uy + r[2] * uz;
  let y = [r[0] - dot * ux, r[1] - dot * uy, r[2] - dot * uz];
  const n = Math.hypot(y[0], y[1], y[2]);
  y = [y[0] / n, y[1] / n, y[2] / n];
  const z: Vec3 = [uy * y[2] - uz * y[1], uz * y[0] - ux * y[2], ux * y[1] - uy * y[0]];
  return [[ux, uy, uz], [y[0], y[1], y[2]], z];
}

/** 12×12 局部刚度：拉压 EA/L + 扭转 GJ/L + 双向弯曲（θz/v 平面用 EIz、θy/w 平面用 EIy，符号经刚体位移检验）。 */
export function beamLocalStiff(L: number, EA: number, EIy: number, EIz: number, GJ: number): number[][] {
  const k: number[][] = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const put = (idx: number[], blk: number[][]) => {
    for (let p = 0; p < idx.length; p++) for (let q = 0; q < idx.length; q++) k[idx[p]][idx[q]] += blk[p][q];
  };
  const c = EA / L;
  put([0, 6], [[c, -c], [-c, c]]);
  const ct = GJ / L;
  put([3, 9], [[ct, -ct], [-ct, ct]]);
  const b3z = EIz / (L * L * L);
  put([1, 5, 7, 11], [
    [12 * b3z, 6 * L * b3z, -12 * b3z, 6 * L * b3z],
    [6 * L * b3z, 4 * L * L * b3z, -6 * L * b3z, 2 * L * L * b3z],
    [-12 * b3z, -6 * L * b3z, 12 * b3z, -6 * L * b3z],
    [6 * L * b3z, 2 * L * L * b3z, -6 * L * b3z, 4 * L * L * b3z],
  ]);
  const b3y = EIy / (L * L * L);
  put([2, 4, 8, 10], [
    [12 * b3y, -6 * L * b3y, -12 * b3y, -6 * L * b3y],
    [-6 * L * b3y, 4 * L * L * b3y, 6 * L * b3y, 2 * L * L * b3y],
    [-12 * b3y, 6 * L * b3y, 12 * b3y, 6 * L * b3y],
    [-6 * L * b3y, 2 * L * L * b3y, 6 * L * b3y, 4 * L * L * b3y],
  ]);
  return k;
}

/** 分块对角 12×12 变换 T（R 重复 4 次），d_local = T·d_global。 */
export function transform12(R: Mat3): number[][] {
  const T: number[][] = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let b = 0; b < 4; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[b * 3 + i][b * 3 + j] = R[i][j];
  return T;
}

/** K_glob = Tᵀ·K_loc·T。 */
export function toGlobal12(R: Mat3, kLoc: number[][]): number[][] {
  const T = transform12(R);
  const out: number[][] = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let p = 0; p < 12; p++) {
    for (let q = 0; q < 12; q++) {
      let s = 0;
      for (let m = 0; m < 12; m++) {
        if (T[m][p] === 0) continue;
        for (let n = 0; n < 12; n++) s += T[m][p] * kLoc[m][n] * T[n][q];
      }
      out[p][q] = s;
    }
  }
  return out;
}

/** 局部 12 维向量 → 全局（Tᵀ·f_local）。 */
export function vecToGlobal(R: Mat3, fl: number[]): number[] {
  const out = new Array<number>(12).fill(0);
  for (let b = 0; b < 4; b++) for (let j = 0; j < 3; j++) out[b * 3 + j] = R[0][j] * fl[b * 3] + R[1][j] * fl[b * 3 + 1] + R[2][j] * fl[b * 3 + 2];
  return out;
}

// ---------- 杆上荷载：形函数积分 → 局部等效结点荷载 ----------

/** Hermite（横弯）/线性（轴拉）形函数按局部 DOF 0..11 展开；θx 无荷载通道恒 0。 */
function shapeFunctions(L: number, s: number): number[] {
  const s2 = s * s;
  const s3 = s2 * s;
  const N1 = 1 - 3 * s2 + 2 * s3;
  const N2 = 3 * s2 - 2 * s3;
  const H1 = L * (s - 2 * s2 + s3);
  const H2 = L * (-s2 + s3);
  const N = new Array<number>(12).fill(0);
  N[0] = 1 - s;
  N[6] = s;
  N[1] = N1;
  N[7] = N2;
  N[5] = H1;
  N[11] = H2;
  N[2] = N1;
  N[8] = N2;
  N[4] = -H1;
  N[10] = -H2;
  return N;
}

/** 5 点 Gauss-Legendre（[0,1]，权重和=1），对 ≤9 次多项式精确（三次形函数 × 一次集度足够）。 */
export const GAUSS: [number, number][] = [
  [0.04691007703066803, 0.11846344252809454],
  [0.2307653449471585, 0.23931433524968323],
  [0.5, 0.28444444444444444],
  [0.7692346550528415, 0.23931433524968323],
  [0.953089922969332, 0.11846344252809454],
];

export interface LoadModel {
  feq: number[]; // 局部 12 维等效结点荷载
  points: { s: number; P: Vec3 }[]; // 集中力（局部分量，s=pos/L）
  distA: Vec3; // 分布集度 q(s)=distA+(distB−distA)·s，N/m
  distB: Vec3;
}

/** 局部 DOF → 广义力配对方向：θz(5/11) 与 ŷ 荷载（v 平面弯曲）配对、θy(4/10) 与 ẑ 荷载配对。 */
const COMP = [0, 1, 2, 0, 2, 1, 0, 1, 2, 0, 2, 1];

/** 杆上荷载 → 等效结点荷载 + 截面内力积分所需的荷载模型。 */
export function memberLoadModel(L: number, R: Mat3, loads: MemberLoad[]): LoadModel {
  const feq = new Array<number>(12).fill(0);
  const points: { s: number; P: Vec3 }[] = [];
  const distA: Vec3 = [0, 0, 0];
  const distB: Vec3 = [0, 0, 0];
  const local = (g: Vec3): Vec3 => [R[0][0] * g[0] + R[0][1] * g[1] + R[0][2] * g[2], R[1][0] * g[0] + R[1][1] * g[1] + R[1][2] * g[2], R[2][0] * g[0] + R[2][1] * g[1] + R[2][2] * g[2]];
  for (const ml of loads) {
    if (ml.kind === "point") {
      const s0 = Math.min(1, Math.max(0, (ml.pos ?? 0) / L));
      const P = local([ml.fx ?? 0, ml.fy ?? 0, ml.fz ?? 0]);
      points.push({ s: s0, P });
      const N = shapeFunctions(L, s0);
      for (let i = 0; i < 12; i++) feq[i] += N[i] * P[COMP[i]];
    } else {
      const a = local([ml.fx ?? 0, ml.fy ?? 0, ml.fz ?? 0]);
      const b = local([ml.fx2 ?? ml.fx ?? 0, ml.fy2 ?? ml.fy ?? 0, ml.fz2 ?? ml.fz ?? 0]);
      for (let j = 0; j < 3; j++) {
        distA[j] += a[j];
        distB[j] += b[j];
      }
      for (const [s, w] of GAUSS) {
        const q: Vec3 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
        const N = shapeFunctions(L, s);
        for (let i = 0; i < 12; i++) feq[i] += w * N[i] * q[COMP[i]] * L;
      }
    }
  }
  return { feq, points, distA, distB };
}

/** 6×12 插值矩阵：局部位移场 [u,v,w,θx,θy,θz](s) = S·dLocal（能量校核外力功积分用）。 */
export function interpShape(L: number, s: number): number[][] {
  const N = shapeFunctions(L, s);
  const S: number[][] = Array.from({ length: 6 }, () => new Array<number>(12).fill(0));
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < 12; i++) if (COMP[i] === axis) S[axis][i] = N[i];
  }
  S[3][3] = 1 - s;
  S[3][9] = s;
  S[4][4] = 1 - s;
  S[4][10] = s;
  S[5][5] = 1 - s;
  S[5][11] = s;
  return S;
}

// ---------- 端部铰静力凝聚 ----------
export interface Condensed {
  retained: number[];
  released: number[];
  kHat: number[][];
  feqHat: number[];
  gInv: number[][]; // k_rr⁻¹
}

/** 释放指定局部 DOF：k̂ = k_cc − k_cr·k_rr⁻¹·k_rc，f̂eq = f_eq_c − k_cr·k_rr⁻¹·f_eq_r。 */
export function condenseReleases(kLoc: number[][], feq: number[], released: number[]): Condensed {
  const retained = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((d) => !released.includes(d));
  if (released.length === 0) {
    return { retained, released, kHat: retained.map((i) => retained.map((j) => kLoc[i][j])), feqHat: retained.map((i) => feq[i]), gInv: [] };
  }
  const krr = released.map((i) => released.map((j) => kLoc[i][j]));
  const inv = invertSmall(krr);
  const M = retained.map((ci) => released.map((_, r) => released.reduce((s, ri, c) => s + kLoc[ci][ri] * inv[c][r], 0)));
  const kHat = retained.map((ci, p) => retained.map((cj) => kLoc[ci][cj] - released.reduce((s, _, r) => s + M[p][r] * kLoc[released[r]][cj], 0)));
  const feqHat = retained.map((ci, p) => feq[ci] - released.reduce((s, _, r) => s + M[p][r] * feq[released[r]], 0));
  return { retained, released, kHat, feqHat, gInv: inv };
}

function invertSmall(a: number[][]): number[][] {
  const n = a.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let c = 0; c < n; c++) {
    const e = new Array<number>(n).fill(0);
    e[c] = 1;
    const res = solveSquare(a.map((row) => [...row]), e);
    if (!res.ok) throw new Error("铰释放凝聚失败：释放子块奇异");
    for (let r = 0; r < n; r++) out[r][c] = res.x[r];
  }
  return out;
}

/** 由保留 DOF 局部位移恢复完整 12 维位移与真实端力 f = k·d − f_eq（释放 DOF 端力恒 0）。 */
export function recoverLocal(cd: Condensed, kLoc: number[][], feq: number[], dRetained: number[]): { dFull: number[]; fFull: number[] } {
  const dFull = new Array<number>(12).fill(0);
  cd.retained.forEach((d, i) => (dFull[d] = dRetained[i]));
  if (cd.released.length) {
    const rhs = cd.released.map((ri) => feq[ri] - cd.retained.reduce((s, cj, j) => s + kLoc[ri][cj] * dRetained[j], 0));
    cd.released.forEach((ri, p) => {
      dFull[ri] = cd.released.reduce((s, _, c) => s + cd.gInv[p][c] * rhs[c], 0);
    });
  }
  const fFull = kLoc.map((row, i) => row.reduce((s, v, j) => s + v * dFull[j], 0) - feq[i]);
  return { dFull, fFull };
}

// ---------- 截面内力（左段平衡，材料力学口径） ----------

/** 距 A 端 x 处截面内力：Fc = −(左段全部作用力)，Mc = −(左段全部力对截面取矩)。
 *  tol：集中力在截面上的取舍（+1e-12 取左侧值，−1e-12 取右侧值）。 */
export function sectionForces(L: number, fFull: number[], lm: LoadModel, x: number, tol = 1e-12): { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number } {
  const s0 = x / L;
  const F: Vec3 = [fFull[0], fFull[1], fFull[2]];
  // A 端力对截面的矩：(0−x)·x̂ × fA = (0, x·fAz, −x·fAy)
  const M: Vec3 = [fFull[3], fFull[4] + x * fFull[2], fFull[5] - x * fFull[1]];
  for (const p of lm.points) {
    if (p.s >= s0 - tol) continue;
    const arm = p.s * L - x; // (p−c) = arm·x̂；x̂×P = (0, −Pz, Py)
    F[0] += p.P[0];
    F[1] += p.P[1];
    F[2] += p.P[2];
    M[1] += arm * -p.P[2];
    M[2] += arm * p.P[1];
  }
  const a = lm.distA;
  const b: Vec3 = [lm.distB[0] - a[0], lm.distB[1] - a[1], lm.distB[2] - a[2]];
  // ∫₀ˢ⁰ q·L ds = L(a s0 + b s0²/2)
  for (let j = 0; j < 3; j++) F[j] += L * (a[j] * s0 + (b[j] * s0 * s0) / 2);
  // ∫₀ˢ⁰ (s−s0)L·(x̂×q)·L ds，x̂×q=(0,−qz,qy)；J(j)=∫₀ˢ⁰(s−s0)(a_j+b_j s)ds = −(a_j s0²/2 + b_j s0³/6)
  const J = (j: number) => -(a[j] * (s0 * s0) / 2 + (b[j] * s0 * s0 * s0) / 6);
  M[1] += -L * L * J(2); // x̂×q 的 ŷ 分量为 −qz → My
  M[2] += L * L * J(1); // ẑ 分量为 qy → Mz
  return { N: -F[0], Vy: -F[1], Vz: -F[2], T: -M[0], My: -M[1], Mz: -M[2] };
}
