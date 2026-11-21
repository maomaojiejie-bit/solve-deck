// Q2 压杆稳定：切线刚度 K_T(α) = K + α·Kg(N_ref)，N_ref 为当前解轴力（拉为正）。
// K_T 奇异 ⟺ 广义特征值问题 K φ = λ·(−Kg) φ 的最小正 λ；Pcr = λ × 当前荷载（全部同乘）。
// 数值：幂迭代 K⁻¹(−Kg) 收敛到 1/λ_min，Rayleigh 商给出 λ；模态按最大分量归一。

import { solveSquare } from "./linalg.ts";
import { transform12 } from "./beam.ts";
import type { StiffnessSolved } from "./stiffness.ts";
import type { BucklingReport, TrussModel } from "./types";

/** 梁单元 12×12 一致几何刚度（局部序同 beamLocalStiff）：轴向 (0,6) + 双向弯曲，扭转无通道。 */
export function beamGeoStiff(L: number, N: number): number[][] {
  const k: number[][] = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const put = (idx: number[], blk: number[][]) => {
    for (let p = 0; p < idx.length; p++) for (let q = 0; q < idx.length; q++) k[idx[p]][idx[q]] += blk[p][q];
  };
  const c = N / L;
  put([0, 6], [[c, -c], [-c, c]]);
  const m = N / (30 * L);
  put([1, 5, 7, 11], [
    [36 * m, 3 * L * m, -36 * m, 3 * L * m],
    [3 * L * m, 4 * L * L * m, -3 * L * m, -L * L * m],
    [-36 * m, -3 * L * m, 36 * m, -3 * L * m],
    [3 * L * m, -L * L * m, -3 * L * m, 4 * L * L * m],
  ]);
  // ŵ 平面（θy 符号约定与 θz 相反 → 交叉项变号，对角不变）
  put([2, 4, 8, 10], [
    [36 * m, -3 * L * m, -36 * m, -3 * L * m],
    [-3 * L * m, 4 * L * L * m, 3 * L * m, -L * L * m],
    [-36 * m, 3 * L * m, 36 * m, -3 * L * m],
    [-3 * L * m, -L * L * m, 3 * L * m, 4 * L * L * m],
  ]);
  return k;
}

function matVec(a: number[][], x: number[]): number[] {
  return a.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

/** 铰释放端的几何刚度凝聚（与刚度矩阵同一 retained 口径；N=0 元素整体跳过，g_rr 不奇异）。 */
function condenseGeo(gLoc: number[][], retained: number[], released: number[]): number[][] {
  if (!released.length) return retained.map((i) => retained.map((j) => gLoc[i][j]));
  const grr = released.map((i) => released.map((j) => gLoc[i][j]));
  const inv: number[][] = Array.from({ length: released.length }, () => new Array<number>(released.length).fill(0));
  for (let c = 0; c < released.length; c++) {
    const e = new Array<number>(released.length).fill(0);
    e[c] = 1;
    const res = solveSquare(grr.map((r) => [...r]), e);
    if (!res.ok) throw new Error("几何刚度凝聚失败：释放子块奇异");
    for (let r = 0; r < released.length; r++) inv[r][c] = res.x[r];
  }
  return retained.map((ci) =>
    retained.map((cj) => {
      let s = gLoc[ci][cj];
      for (let p = 0; p < released.length; p++) {
        let row = 0;
        for (let q = 0; q < released.length; q++) row += inv[p][q] * gLoc[released[q]][cj];
        s -= gLoc[ci][released[p]] * row;
      }
      return s;
    }),
  );
}

/** 稳定求解：装配 Kg → 自由 DOF 广义特征值 → 荷载乘子 + 屈曲模态。 */
export function solveBuckling(model: TrussModel, st: StiffnessSolved): BucklingReport {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  const nDof = model.nodes.length * 6;
  const Kg: number[][] = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));

  for (const el of st.elements) {
    const N = st.memberForces.get(el.id) ?? 0;
    if (Math.abs(N) < 1e-9) continue; // 无轴力 → 无几何刚度贡献
    const ia = index.get(el.a)!;
    const ib = index.get(el.b)!;
    if (el.kind === "truss") {
      const [ux, uy, uz] = el.R[0];
      const q = [ux, uy, uz, -ux, -uy, -uz];
      const dofs = [ia * 6, ia * 6 + 1, ia * 6 + 2, ib * 6, ib * 6 + 1, ib * 6 + 2];
      const c = N / el.L;
      // 评审 P0-4：杆单元几何刚度是「横向」 N/L·(I − ûûᵀ)；
      // 原来写成 c·q qᵀ（纵向分量，已由 EA/L 提供），等于几何刚度≈0，Pcr 完全失真。
      for (let p = 0; p < 6; p++) {
        for (let r = 0; r < 6; r++) {
          const delta = p % 3 === r % 3 ? 1 : 0; // 同一方向分量才取 1（节点内/节点间都按 I）
          Kg[dofs[p]][dofs[r]] += c * (delta - q[p] * q[r]);
        }
      }
      continue;
    }
    const gdofs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((d) => (d < 6 ? ia * 6 + d : ib * 6 + d - 6));
    const gLoc = beamGeoStiff(el.L, N);
    const gh = condenseGeo(gLoc, el.cd.retained, el.cd.released);
    const T = transform12(el.R);
    for (let p = 0; p < 12; p++) {
      for (let r = 0; r < 12; r++) {
        let s = 0;
        for (let m = 0; m < el.cd.retained.length; m++) {
          if (T[el.cd.retained[m]][p] === 0) continue;
          for (let n = 0; n < el.cd.retained.length; n++) s += T[el.cd.retained[m]][p] * gh[m][n] * T[el.cd.retained[n]][r];
        }
        Kg[gdofs[p]][gdofs[r]] += s;
      }
    }
  }

  // B = −Kg（受压构件正定方向），限制到自由 DOF
  const free = st.free;
  const Bff = free.map((r) => free.map((c) => -Kg[r][c]));

  // 幂迭代 K⁻¹B → 最大 μ = 1/λ_min；Rayleigh λ = (v·Kv)/(v·Bv)
  let v = matVec(Bff, new Array<number>(free.length).fill(1));
  let nrm = Math.max(...v.map(Math.abs)) || 1;
  v = v.map((x) => x / nrm);
  let lambda = NaN;
  let converged = false;
  let stable = 0;
  for (let iter = 0; iter < 300; iter++) {
    const res = solveSquare(st.Kff.map((row) => [...row]), matVec(Bff, v));
    if (!res.ok) return { ok: false, lambda: NaN, loadRef: "", mode: [], note: "刚度矩阵奇异，稳定分析不可用" };
    const x = res.x;
    const Kx = matVec(st.Kff, x);
    const Bx = matVec(Bff, x);
    const num = x.reduce((s, xi, i) => s + xi * Kx[i], 0);
    const den = x.reduce((s, xi, i) => s + xi * Bx[i], 0);
    if (den === 0) break; // 几何刚度为 0（全受拉）→ 没有失稳方向，交给下面的 lambda 判断
    const next = num / den;
    // 幂迭代是线性收敛：密集中间特征值（如 4 单元压杆）时 λ 每步只差 ~2e-6，
    // 用「连续 5 步相对变化 <1e-5」判收敛（λ 精度约 0.2%，满足 ≤2% 的门禁）。
    const relChange = Number.isFinite(lambda) ? Math.abs(next - lambda) / Math.max(1e-30, Math.abs(next)) : Infinity;
    const m2 = Math.max(...x.map(Math.abs)) || 1;
    v = x.map((xi) => xi / m2);
    if (Number.isFinite(next) && next > 0 && relChange < 1e-5) {
      if (++stable >= 5) {
        lambda = next;
        converged = true;
        break;
      }
    } else stable = 0;
    lambda = next;
  }

  const loadRef = [
    ...model.loads.map((l) => `${l.node}: ${[["fx", l.fx], ["fy", l.fy], ["fz", l.fz], ["mx", l.mx], ["my", l.my], ["mz", l.mz]].filter(([, v]) => v).map(([a, val]) => `${a}=${(val as number).toExponential(2)}`).join(" ")}`),
    ...(model.memberLoads ?? []).map((ml) => `${ml.member}: ${ml.kind} qy=${(ml.fy ?? 0).toExponential(2)}`),
  ].filter(Boolean).join("；");

  if (!converged) {
    return { ok: false, lambda: NaN, loadRef, mode: [], note: "稳定特征值幂迭代未收敛（300 次）——结构可能接近奇异或荷载过弱，请检查模型" };
  }
  if (!Number.isFinite(lambda) || lambda <= 0) {
    return { ok: false, lambda: NaN, loadRef, mode: [], note: "当前轴力状态无受压失稳模态（拉应力占优或荷载过弱）" };
  }

  const posOf = new Map(free.map((d, i) => [d, i]));
  // 模态按「平动最大分量」归一（转动分量可能更大，渲染只看侧移）
  let tMax = 0;
  for (let i = 0; i < nDof; i += 6) for (let k = 0; k < 3; k++) tMax = Math.max(tMax, Math.abs(v[posOf.get(i + k)!] ?? 0));
  const scale = tMax > 0 ? 1 / tMax : 1;
  const mode = model.nodes.map((nd) => {
    const i = index.get(nd.id)!;
    const at = (d: number) => (v[posOf.get(d)!] ?? 0) * scale;
    return { node: nd.id, d: [at(i * 6), at(i * 6 + 1), at(i * 6 + 2)] as [number, number, number] };
  });
  return { ok: true, lambda, loadRef, mode, converged: true };
}
