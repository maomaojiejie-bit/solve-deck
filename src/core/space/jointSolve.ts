import { classify, fixedAxesByNode } from "./determinacy.ts";
import { memberGeom, loadVector, type MemberGeom } from "./stiffness.ts";
import { solveSquare } from "./linalg.ts";
import type { TrussModel } from "./types";

// 节点法：仅适用静定结构，作为刚度法的互校基线（D1 决策的双解之一）。
// 未知量 x = [各杆轴力 N（拉正）…, 各约束分量反力 R…]，
// 每结点 3 个平衡方程：Σ N·û + R + F外 = 0。

export type JointOutcome =
  | { ok: true; memberForces: Map<string, number>; reactions: Map<string, [number, number, number]>; geoms: MemberGeom[] }
  | { ok: false; reason: string };

export function solveJoint(model: TrussModel): JointOutcome {
  const det = classify(model);
  const fixedAxes = fixedAxesByNode(model);
  // 评审 P0-7：节点法只有 3 个平动未知量/结点，必须用「平动约束数」判定适用性；
  // 原来拿 det.r（含 rx/ry/rz）比较 → 桁架结点勾了「固定端 6」就报「约束计数不一致（内部错误）」。
  let rTrans = 0;
  for (const set of fixedAxes.values()) for (const a of set) if (a === "x" || a === "y" || a === "z") rTrans++;
  if (det.m + rTrans !== 3 * det.n) {
    return { ok: false, reason: `节点法只适用静定结构，当前 m+平动约束=${det.m + rTrans} vs 3n=${3 * det.n}` };
  }

  const index = new Map(model.nodes.map((nd, i) => [nd.id, i]));
  const geoms: MemberGeom[] = [];
  for (const mb of model.members) {
    const g = memberGeom(model.nodes[index.get(mb.a)!], model.nodes[index.get(mb.b)!], mb.id, mb.a, mb.b, mb.E * mb.A);
    if (!g) return { ok: false, reason: `杆件 ${mb.id} 几何退化` };
    geoms.push(g);
  }

  // 反力未知量：按结点顺序 × 轴顺序枚举约束 DOF（只取平动）
  const reactionDofs: number[] = [];
  for (let d = 0; d < model.nodes.length * 3; d++) {
    const nd = model.nodes[Math.floor(d / 3)];
    const axis = (["x", "y", "z"] as const)[d % 3];
    if (fixedAxes.get(nd.id)?.has(axis)) reactionDofs.push(d);
  }
  if (reactionDofs.length !== rTrans) return { ok: false, reason: "约束计数不一致（内部错误）" };

  const rows = model.nodes.length * 3;
  const cols = geoms.length + reactionDofs.length;
  if (cols !== rows) return { ok: false, reason: "未知量数与方程数不等（计数误判）" };

  const A: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  geoms.forEach((g, j) => {
    const ia = index.get(g.a)!;
    const ib = index.get(g.b)!;
    const u = [g.ux, g.uy, g.uz];
    for (let c = 0; c < 3; c++) {
      A[ia * 3 + c][j] += u[c]; // 张力把 a 拉向 b
      A[ib * 3 + c][j] -= u[c];
    }
  });
  reactionDofs.forEach((d, k) => {
    A[d][geoms.length + k] = 1;
  });

  const F = loadVector(model, index);
  const b = F.map((v) => -v);

  const res = solveSquare(A, b);
  if (!res.ok) {
    return { ok: false, reason: `平衡方程组奇异（pivotCol=${res.pivotCol}）——几何可变` };
  }

  const memberForces = new Map<string, number>();
  geoms.forEach((g, j) => memberForces.set(g.id, res.x[j]));
  const reactions = new Map<string, [number, number, number]>();
  for (const nd of model.nodes) reactions.set(nd.id, [0, 0, 0]);
  reactionDofs.forEach((d, k) => {
    reactions.get(model.nodes[Math.floor(d / 3)].id)![d % 3] += res.x[geoms.length + k];
  });

  return { ok: true, memberForces, reactions, geoms };
}
