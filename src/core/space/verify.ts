import { memberGeom, type ElementSolved } from "./stiffness.ts";
import { interpShape, GAUSS, vecToGlobal } from "./beam.ts";
import type { Dof, TrussModel } from "./types";

// 校核层：结果只认一条路由，但必须过独立对账才能盖「已验证」。

/** 结点平衡残差：每结点 Σ(杆拉力向量) + 反力 + 外载 = 0，返回全分量最大绝对值。 */
export function equilibriumResidual(
  model: TrussModel,
  memberForces: Map<string, number>,
  reactions: Map<string, [number, number, number]>,
): number {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  const acc: [number, number, number][] = model.nodes.map(() => [0, 0, 0]);
  for (const l of model.loads) {
    const a = acc[index.get(l.node)!];
    a[0] += l.fx ?? 0;
    a[1] += l.fy ?? 0;
    a[2] += l.fz ?? 0;
  }
  for (const nd of model.nodes) {
    const a = acc[index.get(nd.id)!];
    const r = reactions.get(nd.id);
    if (r) {
      a[0] += r[0];
      a[1] += r[1];
      a[2] += r[2];
    }
  }
  for (const mb of model.members) {
    const g = memberGeom(model.nodes[index.get(mb.a)!], model.nodes[index.get(mb.b)!], mb.id, mb.a, mb.b, mb.E * mb.A);
    if (!g) continue;
    const N = memberForces.get(mb.id) ?? 0;
    const fa = acc[index.get(mb.a)!];
    const fb = acc[index.get(mb.b)!];
    fa[0] += N * g.ux; fa[1] += N * g.uy; fa[2] += N * g.uz; // 张力把 a 拉向 b
    fb[0] -= N * g.ux; fb[1] -= N * g.uy; fb[2] -= N * g.uz;
  }
  let max = 0;
  for (const a of acc) for (const v of a) max = Math.max(max, Math.abs(v));
  return max;
}

/** 弹性支座应变能 ½Σk·u²（桁架/梁两套能量校核共用；评审 P0-6）。 */
export function springStrainEnergy(model: TrussModel, u6: number[]): number {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  let e = 0;
  for (const s of model.supports) {
    if (!s.springs?.length) continue;
    const i = index.get(s.node)!;
    for (const sp of s.springs) {
      const u = u6[i * 6 + DOF_IDX[sp.dof]] ?? 0;
      e += 0.5 * sp.k * u * u;
    }
  }
  return e;
}

/** 能量校核：外力功 W = ½ΣF·u，应变能 U = ½ΣN²L/(EA) + ¼…弹簧 ½k·u²，相对偏差。
 *  评审 P0-6：桁架版原来漏了弹簧应变能——用了弹性支座的正确模型会被判「能量校核 ✗」。 */
export function energyResidual(
  model: TrussModel,
  u: number[],
  geoms: { id: string; a: string; b: string; L: number; EA: number }[],
  memberForces: Map<string, number>,
  springEnergy = 0,
): number {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  let work = 0;
  for (const l of model.loads) {
    const i = index.get(l.node)!;
    work += (l.fx ?? 0) * u[i * 3] + (l.fy ?? 0) * u[i * 3 + 1] + (l.fz ?? 0) * u[i * 3 + 2];
  }
  work *= 0.5;
  let strain = springEnergy;
  for (const g of geoms) {
    const N = memberForces.get(g.id) ?? 0;
    strain += (N * N * g.L) / (2 * g.EA);
  }
  const denom = Math.max(Math.abs(work), 1e-12);
  return Math.abs(work - strain) / denom;
}

// ---------- Q1 梁/刚架独立校核 ----------

const DOF_IDX: Record<Dof, number> = { x: 0, y: 1, z: 2, rx: 3, ry: 4, rz: 5 };

/** 结点 6 分量平衡残差：Σ(单元端力反作用) + 外载(含力偶) + 反力(含反力矩) + 弹簧力 = 0。 */
export function frameEquilibriumResidual(
  model: TrussModel,
  elements: ElementSolved[],
  reactions: Map<string, [number, number, number]>,
  reactionMoments: Map<string, [number, number, number]>,
  u: number[],
): number {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  const acc: number[][] = model.nodes.map(() => new Array(6).fill(0));
  for (const l of model.loads) {
    const a = acc[index.get(l.node)!];
    a[0] += l.fx ?? 0;
    a[1] += l.fy ?? 0;
    a[2] += l.fz ?? 0;
    a[3] += l.mx ?? 0;
    a[4] += l.my ?? 0;
    a[5] += l.mz ?? 0;
  }
  for (const nd of model.nodes) {
    const a = acc[index.get(nd.id)!];
    const r = reactions.get(nd.id);
    const m = reactionMoments.get(nd.id);
    if (r) for (let j = 0; j < 3; j++) a[j] += r[j];
    if (m) for (let j = 0; j < 3; j++) a[j + 3] += m[j];
  }
  for (const s of model.supports) {
    if (!s.springs?.length) continue;
    const a = acc[index.get(s.node)!];
    const i = index.get(s.node)!;
    for (const sp of s.springs) a[DOF_IDX[sp.dof]] -= sp.k * u[i * 6 + DOF_IDX[sp.dof]];
  }
  for (const el of elements) {
    const fg = vecToGlobal(el.R, el.fLocal);
    const fa = acc[index.get(el.a)!];
    const fb = acc[index.get(el.b)!];
    for (let j = 0; j < 6; j++) {
      fa[j] -= fg[j]; // 端力是「结点作用在单元上」→ 反作用取负
      fb[j] -= fg[j + 6];
    }
  }
  let max = 0;
  for (const a of acc) for (const v of a) max = Math.max(max, Math.abs(v));
  return max;
}

/** 能量校核（梁）：½(ΣF·u + Σ∫q·v dx) vs ½Σ dᵀk d，相对偏差。 */
export function frameEnergyResidual(model: TrussModel, elements: ElementSolved[], u: number[]): number {
  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  let work = 0;
  for (const l of model.loads) {
    const i = index.get(l.node)!;
    work += (l.fx ?? 0) * u[i * 6] + (l.fy ?? 0) * u[i * 6 + 1] + (l.fz ?? 0) * u[i * 6 + 2];
    work += (l.mx ?? 0) * u[i * 6 + 3] + (l.my ?? 0) * u[i * 6 + 4] + (l.mz ?? 0) * u[i * 6 + 5];
  }
  // 弹性支座储能 ½k·θ²/δ²（外力功口径不含弹簧反力，但应变能含弹簧应变能 → 两边都加 ½k u²）
  let springE = 0;
  for (const s of model.supports) {
    if (!s.springs?.length) continue;
    const i = index.get(s.node)!;
    for (const sp of s.springs) springE += 0.5 * sp.k * u[i * 6 + DOF_IDX[sp.dof]] ** 2;
  }
  for (const el of elements) {
    if (el.kind !== "beam") continue;
    const { points, distA, distB } = el.lm;
    for (const p of points) {
      const S = interpShape(el.L, p.s);
      for (let axis = 0; axis < 3; axis++) work += p.P[axis] * S[axis].reduce((sum, v, j) => sum + v * el.dLocal[j], 0);
    }
    if (distA[0] || distA[1] || distA[2] || distB[0] || distB[1] || distB[2]) {
      for (const [s, w] of GAUSS) {
        const S = interpShape(el.L, s);
        const q = [distA[0] + (distB[0] - distA[0]) * s, distA[1] + (distB[1] - distA[1]) * s, distA[2] + (distB[2] - distA[2]) * s];
        for (let axis = 0; axis < 3; axis++) work += w * q[axis] * S[axis].reduce((sum, v, j) => sum + v * el.dLocal[j], 0) * el.L;
      }
    }
  }
  work *= 0.5;
  let strain = springE;
  for (const el of elements) {
    let e = 0;
    for (let p = 0; p < 12; p++) e += el.kLoc[p].reduce((s, v, j) => s + v * el.dLocal[j], 0) * el.dLocal[p];
    strain += 0.5 * e;
  }
  const denom = Math.max(Math.abs(work), 1e-12);
  return Math.abs(work - strain) / denom;
}
