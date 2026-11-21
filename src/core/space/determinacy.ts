import type { Dof, TrussModel } from "./types";

export interface DeterminacyInfo {
  kind: "determinate" | "indeterminate" | "under-constrained";
  n: number; // 结点数
  m: number; // 杆件数
  r: number; // 约束分量数（含转动；同结点重复约束按并集去重）
  eq: number; // 纯桁架 3n；含梁为 6n − 平凡转动方程数
  surplus: number; // 未知数 − 方程数
  hasBeam: boolean;
}

/** 支座去重合并：同一结点多个支座的 fix 取并集。 */
export function fixedAxesByNode(model: TrussModel): Map<string, Set<Dof>> {
  const map = new Map<string, Set<Dof>>();
  for (const s of model.supports) {
    let set = map.get(s.node);
    if (!set) {
      set = new Set();
      map.set(s.node, set);
    }
    for (const a of s.fix) set.add(a);
  }
  return map;
}

/**
 * 计数预判（Q1 升级）：
 * - 纯桁架：维持一期口径 m + r vs 3n（快照红线）；
 * - 含梁：未知数 = 6·梁 + 1·桁架杆 + r + 弹簧 − 2·铰释放端；
 *   方程 = 6n − 平凡转动方程（该转动自由度无约束/弹簧、相连杆全部释放该弯矩）。
 * 注意这只是必要条件——几何可变（机构）要靠刚度矩阵主元检测（stiffness.ts）终判。
 */
export function classify(model: TrussModel): DeterminacyInfo {
  const n = model.nodes.length;
  const m = model.members.length;
  const fixed = fixedAxesByNode(model);
  let r = 0;
  let springs = 0;
  for (const s of model.supports) {
    springs += s.springs?.length ?? 0;
  }
  for (const set of fixed.values()) r += set.size;

  const hasBeam = model.members.some((mb) => mb.kind === "beam");
  if (!hasBeam) {
    const eq = 3 * n;
    const surplus = m + r - eq;
    const kind = surplus < 0 ? "under-constrained" : surplus === 0 ? "determinate" : "indeterminate";
    return { kind, n, m, r, eq, surplus, hasBeam };
  }

  let mBeam = 0;
  let releaseEnds = 0;
  for (const mb of model.members) {
    if (mb.kind === "beam") {
      mBeam++;
      if (mb.releaseA) releaseEnds++;
      if (mb.releaseB) releaseEnds++;
    }
  }
  const unknowns = 6 * mBeam + (m - mBeam) + r + springs - 2 * releaseEnds;

  // 平凡转动方程：结点该转动自由度既无约束也无弹簧，且所有相连杆在该端都释放对应弯矩
  const springDofs = new Map<string, Set<Dof>>();
  for (const s of model.supports) {
    if (!s.springs?.length) continue;
    const set = springDofs.get(s.node) ?? new Set<Dof>();
    for (const sp of s.springs) set.add(sp.dof);
    springDofs.set(s.node, set);
  }
  const rotAtNode = new Map<string, { ry: boolean; rz: boolean; rx: boolean }>();
  for (const nd of model.nodes) rotAtNode.set(nd.id, { rx: true, ry: true, rz: true });
  for (const mb of model.members) {
    const rec = rotAtNode.get(mb.a)!;
    const recB = rotAtNode.get(mb.b)!;
    if (mb.kind !== "beam") {
      rec.rx = rec.ry = rec.rz = false;
      recB.rx = recB.ry = recB.rz = false;
    } else {
      if (!mb.releaseA) {
        rec.ry = false;
        rec.rz = false;
      }
      if (!mb.releaseB) {
        recB.ry = false;
        recB.rz = false;
      }
      rec.rx = false;
      recB.rx = false; // 梁单元永远传递扭矩 → rx 方程非平凡
    }
  }
  let trivial = 0;
  for (const nd of model.nodes) {
    const f = fixed.get(nd.id) ?? new Set<Dof>();
    const sp = springDofs.get(nd.id) ?? new Set<Dof>();
    const rec = rotAtNode.get(nd.id)!;
    for (const d of ["rx", "ry", "rz"] as const) {
      if (rec[d] && !f.has(d) && !sp.has(d)) trivial++;
    }
  }

  const eq = 6 * n - trivial;
  const surplus = unknowns - eq;
  const kind = surplus < 0 ? "under-constrained" : surplus === 0 ? "determinate" : "indeterminate";
  return { kind, n, m, r, eq, surplus, hasBeam };
}
