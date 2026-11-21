import { solveSquare } from "./linalg.ts";
import { fixedAxesByNode } from "./determinacy.ts";
import { beamFrame, beamLocalStiff, condenseReleases, memberLoadModel, recoverLocal, transform12, vecToGlobal, type Condensed, type LoadModel, type Mat3 } from "./beam.ts";
import type { Dof, MemberLoad, Node3, TrussModel } from "./types";
import { DOFS } from "./types.ts";

const DOF_IDX: Record<Dof, number> = { x: 0, y: 1, z: 2, rx: 3, ry: 4, rz: 5 };

export interface MemberGeom {
  id: string;
  a: string;
  b: string;
  L: number;
  ux: number; // a→b 单位向量
  uy: number;
  uz: number;
  EA: number;
}

/** 单元求解态：局部坐标下的位移/端力/荷载模型（内力表与校核共用，Q1）。 */
export interface ElementSolved {
  id: string;
  kind: "truss" | "beam";
  a: string;
  b: string;
  L: number;
  R: Mat3;
  kLoc: number[][];
  feq: number[]; // 局部 12 维等效结点荷载
  lm: LoadModel;
  dLocal: number[]; // 完整 12 维局部位移（铰端内部转角已回代）
  fLocal: number[]; // 真实端力 k·d − f_eq（局部 12 维）
  cd: Condensed;
}

export interface StiffnessSolved {
  ok: true;
  u: number[]; // 6n 全局位移（含被约束/凝聚 DOF 的 0）
  geoms: MemberGeom[];
  elements: ElementSolved[];
  memberForces: Map<string, number>; // N，拉为正
  reactions: Map<string, [number, number, number]>;
  reactionMoments: Map<string, [number, number, number]>;
  freeCount: number;
  hasBeam: boolean;
  /** 评审 P0-2：零刚度平动自由度（按 0 位移凝聚），需在结果里显式标注 */
  condensed: { node: string; dof: Dof }[];
  /** Q2 稳定分析复用：凝聚后自由 DOF 表与 Kff（内部字段，不进输出契约） */
  free: number[];
  Kff: number[][];
}

export interface StiffnessRefused {
  ok: false;
  kind: "mechanism" | "invalid";
  reason: string;
  hints: string[];
  node?: string;
  dof?: Dof;
}

export type StiffnessOutcome = StiffnessSolved | StiffnessRefused;

export function memberGeom(nodeA: Node3, nodeB: Node3, id: string, a: string, b: string, EA: number): MemberGeom | null {
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const dz = nodeB.z - nodeA.z;
  const L = Math.hypot(dx, dy, dz);
  if (L <= 0) return null;
  return { id, a, b, L, ux: dx / L, uy: dy / L, uz: dz / L, EA };
}

/** 一期口径 3-DOF 荷载向量（节点法互校专用，保持不动）。 */
export function loadVector(model: TrussModel, index: Map<string, number>): number[] {
  const F = new Array<number>(model.nodes.length * 3).fill(0);
  for (const l of model.loads) {
    const i = index.get(l.node)!;
    F[i * 3] += l.fx ?? 0;
    F[i * 3 + 1] += l.fy ?? 0;
    F[i * 3 + 2] += l.fz ?? 0;
  }
  return F;
}

/** 直接刚度法主解（Q1 升级版）：6-DOF 装配 → 零刚度凝聚 → 消元 → 端力/反力。
 *  纯桁架模型的凝聚系统、消元顺序与一期 3-DOF 实现逐算子一致（快照逐字节红线）。 */
export function solveStiffness(model: TrussModel): StiffnessOutcome {
  // ---- 模型合法性 ----
  const index = new Map<string, number>();
  for (const nd of model.nodes) {
    if (index.has(nd.id)) {
      return { ok: false, kind: "invalid", reason: `结点 id 重复：${nd.id}`, hints: ["给每个结点唯一 id"] };
    }
    index.set(nd.id, index.size);
  }
  for (const s of model.supports) {
    if (!index.has(s.node)) {
      return { ok: false, kind: "invalid", reason: `支座引用了不存在的结点 ${s.node}`, hints: ["先放结点再设支座"] };
    }
  }
  for (const l of model.loads) {
    if (!index.has(l.node)) {
      return { ok: false, kind: "invalid", reason: `荷载引用了不存在的结点 ${l.node}`, hints: ["先放结点再加荷载"] };
    }
  }
  const memberById = new Map(model.members.map((mb) => [mb.id, mb]));
  // 评审 P0-2：只有结点、没有构件 → 不是结构，直接拒答（不再用零刚度凝聚算出「已解出」）
  if (model.nodes.length > 0 && model.members.length === 0) {
    return {
      ok: false,
      kind: "mechanism",
      node: model.nodes[0].id,
      dof: "x",
      reason: `模型里只有 ${model.nodes.length} 个结点、还没有构件——结点不能组成受力结构，无法求解。`,
      hints: ["用「+构件」依次点两个结点把它们连起来", "或用「+实体」一次放下一个空间框架", "也可以给结点加支座后再连构件"],
    };
  }
  const loadsByMember = new Map<string, MemberLoad[]>();
  for (const ml of model.memberLoads ?? []) {
    const mb = memberById.get(ml.member);
    if (!mb) {
      return { ok: false, kind: "invalid", reason: `杆上荷载引用了不存在的杆件 ${ml.member}`, hints: ["先连杆件再加杆上荷载"] };
    }
    if (mb.kind !== "beam") {
      return { ok: false, kind: "invalid", reason: `杆上荷载只能作用于梁单元（杆件 ${mb.id} 是桁架杆）`, hints: ["把该杆切换为梁单元，或改用结点荷载"] };
    }
    const arr = loadsByMember.get(ml.member) ?? [];
    arr.push(ml);
    loadsByMember.set(ml.member, arr);
  }

  const hasBeam = model.members.some((mb) => mb.kind === "beam");
  const geoms: MemberGeom[] = [];
  for (const mb of model.members) {
    const ia = index.get(mb.a);
    const ib = index.get(mb.b);
    if (ia === undefined || ib === undefined) {
      return { ok: false, kind: "invalid", reason: `杆件 ${mb.id} 引用了不存在的结点`, hints: ["检查杆件端点"] };
    }
    if (mb.a === mb.b) {
      return { ok: false, kind: "invalid", reason: `杆件 ${mb.id} 两端是同一结点`, hints: ["删除零长度杆"] };
    }
    if (!(mb.E > 0) || !(mb.A > 0)) {
      return { ok: false, kind: "invalid", reason: `杆件 ${mb.id} 的 E/A 不是正数`, hints: ["刚度法必须给材料参数"] };
    }
    if (mb.kind === "beam" && (!(mb.Iy! > 0) || !(mb.Iz! > 0) || !(mb.J! > 0))) {
      return { ok: false, kind: "invalid", reason: `梁单元 ${mb.id} 缺少正的截面属性 Iy/Iz/J`, hints: ["在杆件面板补全截面惯性矩与扭转常数"] };
    }
    const g = memberGeom(model.nodes[ia], model.nodes[ib], mb.id, mb.a, mb.b, mb.E * mb.A);
    if (!g) {
      return { ok: false, kind: "invalid", reason: `杆件 ${mb.id} 两端点重合`, hints: ["拉开结点再连"] };
    }
    geoms.push(g);
  }

  // ---- 装配全局刚度矩阵（6 DOF/结点：0-2 平动，3-5 转动） ----
  const nDof = model.nodes.length * 6;
  const K: number[][] = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const F = new Array<number>(nDof).fill(0);
  for (const l of model.loads) {
    const i = index.get(l.node)!;
    F[i * 6] += l.fx ?? 0;
    F[i * 6 + 1] += l.fy ?? 0;
    F[i * 6 + 2] += l.fz ?? 0;
    F[i * 6 + 3] += l.mx ?? 0;
    F[i * 6 + 4] += l.my ?? 0;
    F[i * 6 + 5] += l.mz ?? 0;
  }

  const elements: ElementSolved[] = [];
  for (let e = 0; e < model.members.length; e++) {
    const mb = model.members[e];
    const g = geoms[e];
    const ia = index.get(mb.a)!;
    const ib = index.get(mb.b)!;
    const dofs = [ia * 6, ia * 6 + 1, ia * 6 + 2, ib * 6, ib * 6 + 1, ib * 6 + 2];
    if (mb.kind !== "beam") {
      // 桁架：与一期逐算子一致的外积装配（转动自由度零贡献 → 后续零刚度凝聚）
      const t = [g.ux, g.uy, g.uz, -g.ux, -g.uy, -g.uz];
      const k = g.EA / g.L;
      for (let p = 0; p < 6; p++) {
        for (let q = 0; q < 6; q++) K[dofs[p]][dofs[q]] += k * t[p] * t[q];
      }
      const R = beamFrame(g.ux, g.uy, g.uz);
      const kLoc = beamLocalStiff(g.L, g.EA, 0, 0, 0);
      const lm: LoadModel = { feq: new Array(12).fill(0), points: [], distA: [0, 0, 0], distB: [0, 0, 0] };
      const cd = condenseReleases(kLoc, lm.feq, []);
      elements.push({ id: mb.id, kind: "truss", a: mb.a, b: mb.b, L: g.L, R, kLoc, feq: lm.feq, lm, dLocal: new Array(12).fill(0), fLocal: new Array(12).fill(0), cd });
      continue;
    }
    // 梁：12×12 局部刚度 → 铰释放凝聚 → 变换装配 + 等效结点荷载
    const gdofs = [ia * 6, ia * 6 + 1, ia * 6 + 2, ia * 6 + 3, ia * 6 + 4, ia * 6 + 5, ib * 6, ib * 6 + 1, ib * 6 + 2, ib * 6 + 3, ib * 6 + 4, ib * 6 + 5];
    const R = beamFrame(g.ux, g.uy, g.uz);
    const EIy = mb.E * mb.Iy!;
    const EIz = mb.E * mb.Iz!;
    const GJ = (mb.G ?? mb.E / 2.6) * mb.J!;
    const kLoc = beamLocalStiff(g.L, g.EA, EIy, EIz, GJ);
    const lm = memberLoadModel(g.L, R, loadsByMember.get(mb.id) ?? []);
    const released = [...(mb.releaseA ? [4, 5] : []), ...(mb.releaseB ? [10, 11] : [])];
    const cd = condenseReleases(kLoc, lm.feq, released);
    const T = transform12(R);
    // K_glob += P̂ᵀ k̂ P̂（P̂ = T 的保留行）；F_glob += Tᵀ·f̂eq（嵌入 12 维）
    const feqFull = new Array<number>(12).fill(0);
    cd.retained.forEach((d, i) => (feqFull[d] = cd.feqHat[i]));
    const embed = vecToGlobal(R, feqFull);
    for (let p = 0; p < 12; p++) {
      for (let q = 0; q < 12; q++) {
        let s = 0;
        for (let m = 0; m < cd.retained.length; m++) {
          if (T[cd.retained[m]][p] === 0) continue;
          for (let n = 0; n < cd.retained.length; n++) s += T[cd.retained[m]][p] * cd.kHat[m][n] * T[cd.retained[n]][q];
        }
        K[gdofs[p]][gdofs[q]] += s;
      }
    }
    for (let p = 0; p < 12; p++) F[gdofs[p]] += embed[p];
    elements.push({ id: mb.id, kind: "beam", a: mb.a, b: mb.b, L: g.L, R, kLoc, feq: lm.feq, lm, dLocal: new Array(12).fill(0), fLocal: new Array(12).fill(0), cd });
  }

  // ---- 弹性支座（弹簧刚度进对角） ----
  for (const s of model.supports) {
    if (!s.springs) continue;
    const i = index.get(s.node)!;
    for (const sp of s.springs) K[i * 6 + DOF_IDX[sp.dof]][i * 6 + DOF_IDX[sp.dof]] += sp.k;
  }

  // ---- 边界条件 ----
  const fixedAxes = fixedAxesByNode(model);
  const isFixed = (dof: number): boolean => {
    const nd = model.nodes[Math.floor(dof / 6)];
    return fixedAxes.get(nd.id)?.has(DOFS[dof % 6]) ?? false;
  };

  // ---- 零刚度自由度自动凝聚（一期桁架红线的机制所在） ----
  const free: number[] = [];
  const condensed: { node: string; dof: Dof }[] = [];
  for (let d = 0; d < nDof; d++) {
    if (isFixed(d)) continue;
    let zero = true;
    for (let c = 0; c < nDof; c++) {
      if (K[d][c] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) {
      const j = d % 6;
      const nd = model.nodes[Math.floor(d / 6)];
      // 评审 P0-2：平动零刚度 = 该方向可自由移动。
      // ① 整个模型一根构件都没有（只有悬空结点）→ 直接拒答，不能再给出「已解出」的假解；
      // ② 结点自身没有任何构件 → 只可能是散点，记录并在结果里显式标注「已按 0 凝聚」；
      // ③ 结点有构件但该方向无刚度（单根二力杆的横向、铰接吊杆的摆动方向）→
      //    位移本身不定（任意横向平移都是解），按 0 取一个特解，同时显式标注，不能静默。
      const hasMemberAtNode = model.members.some((mb) => mb.a === nd.id || mb.b === nd.id);
      if (!hasMemberAtNode && model.members.length === 0) {
        return {
          ok: false,
          kind: "mechanism",
          node: nd.id,
          dof: DOFS[j],
          reason: `结点 ${nd.id} 的 ${DOFS[j]} 自由度没有任何刚度（模型里还没有构件）——只有结点、没有结构，不能按静力平衡求解。`,
          hints: [`先用「+构件」把结点连起来，或`, `给 ${nd.id} 增加 ${DOFS[j]} 方向的约束（支座）`, `若该结点是多余的点，可用删除工具移除`],
        };
      }
      if (j < 3) condensed.push({ node: nd.id, dof: DOFS[j] });
      continue; // 无刚度自由度按 0 凝聚（转动自由度本来就不是未知量）
    }
    free.push(d);
  }

  // ---- 凝聚 + 消元 ----
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const Ff = free.map((d) => F[d]);
  const res = solveSquare(Kff.map((row) => [...row]), Ff);

  if (!res.ok) {
    const dof = free[res.pivotCol];
    const nd = model.nodes[Math.floor(dof / 6)];
    const axis = DOFS[dof % 6];
    return {
      ok: false,
      kind: "mechanism",
      node: nd.id,
      dof: axis,
      reason: `刚度矩阵奇异：消元到结点 ${nd.id} 的 ${axis} 自由度时主元为零——结构是几何可变体系（机构）或约束不足。`,
      hints: [
        `给结点 ${nd.id} 增加 ${axis} 方向的约束，或`,
        `检查与 ${nd.id} 相连的杆件是否共面/共线（无法抵抗该方向位移）`,
      ],
    };
  }

  const u = new Array<number>(nDof).fill(0);
  free.forEach((d, k) => {
    u[d] = res.x[k];
  });

  // ---- 单元回代：局部位移/端力 ----
  const memberForces = new Map<string, number>();
  for (let e = 0; e < elements.length; e++) {
    const el = elements[e];
    const ia = index.get(el.a)!;
    const ib = index.get(el.b)!;
    const u6 = [u[ia * 6], u[ia * 6 + 1], u[ia * 6 + 2], u[ia * 6 + 3], u[ia * 6 + 4], u[ia * 6 + 5], u[ib * 6], u[ib * 6 + 1], u[ib * 6 + 2], u[ib * 6 + 3], u[ib * 6 + 4], u[ib * 6 + 5]];
    const T = transform12(el.R);
    const dRet = el.cd.retained.map((d) => T[d].reduce((s, v, g) => s + v * u6[g], 0));
    const { dFull, fFull } = recoverLocal(el.cd, el.kLoc, el.feq, dRet);
    el.dLocal = dFull;
    el.fLocal = fFull;
    if (el.kind === "truss") {
      // 一期口径轴力公式（逐算子一致，快照红线）
      const g = geoms[e];
      const du = [u[ib * 6] - u[ia * 6], u[ib * 6 + 1] - u[ia * 6 + 1], u[ib * 6 + 2] - u[ia * 6 + 2]];
      const N = (g.EA / g.L) * (g.ux * du[0] + g.uy * du[1] + g.uz * du[2]);
      memberForces.set(g.id, N);
      el.fLocal = [-N, 0, 0, 0, 0, 0, N, 0, 0, 0, 0, 0];
    } else {
      memberForces.set(el.id, -fFull[0]);
    }
  }

  // ---- 反力：R_d = (K·u)_d − F_d（仅约束 DOF） ----
  const reactions = new Map<string, [number, number, number]>();
  const reactionMoments = new Map<string, [number, number, number]>();
  for (const nd of model.nodes) {
    reactions.set(nd.id, [0, 0, 0]);
    reactionMoments.set(nd.id, [0, 0, 0]);
  }
  for (let d = 0; d < nDof; d++) {
    if (!isFixed(d)) continue;
    let Ku = 0;
    for (let c = 0; c < nDof; c++) Ku += K[d][c] * u[c];
    const r = Ku - F[d];
    const id = model.nodes[Math.floor(d / 6)].id;
    const j = d % 6;
    if (j < 3) reactions.get(id)![j] += r;
    else reactionMoments.get(id)![j - 3] += r;
  }

  return { ok: true, u, geoms, elements, memberForces, reactions, reactionMoments, freeCount: free.length, hasBeam, condensed, free, Kff };
}
