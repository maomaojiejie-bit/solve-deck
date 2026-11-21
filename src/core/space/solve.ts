import { classify, fixedAxesByNode } from "./determinacy.ts";
import { solveRigid } from "./rigid.ts";
import { solveJoint } from "./jointSolve.ts";
import { solveStiffness, type StiffnessSolved } from "./stiffness.ts";
import { equilibriumResidual, energyResidual, frameEquilibriumResidual, frameEnergyResidual, springStrainEnergy } from "./verify.ts";
import { sectionForces } from "./beam.ts";
import { computeStress, strengthCheck, stressRequested } from "./stress.ts";
import { solveBuckling } from "./buckling.ts";
import type { BucklingReport, Check, DeterminacyKind, MemberForce, MemberInternal, MemberSection, MemberStress, SolveStep, Solution3D, TrussModel } from "./types";

const KIND_CN = { determinate: "静定", indeterminate: "静不定", mechanism: "机构" } as const;

/** 逐杆控制截面内力表：0/L4/L2/3L4/L + 集中荷载左右两侧 + 剪力为零的极值截面。
 *  评审 S2：原来只取 5 个固定截面，梯形/局部均布荷载的 |M|max 会低估 10%~30%；
 *  这里在每段内扫描 Vy/Vz 变号并用二分求根，补上真正的弯矩极值位置。 */
function buildInternals(st: StiffnessSolved): MemberInternal[] {
  const out: MemberInternal[] = [];
  for (const el of st.elements) {
    if (el.kind !== "beam") {
      const N = st.memberForces.get(el.id) ?? 0;
      out.push({ id: el.id, kind: "truss", L: el.L, sections: [{ x: 0, N, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0 }, { x: el.L, N, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0 }] });
      continue;
    }
    const pts = el.lm.points.map((p) => p.s * el.L).sort((a, b) => a - b);
    const raw: { x: number; side?: "left" | "right" }[] = [{ x: 0 }, { x: el.L / 4 }, { x: el.L / 2 }, { x: (3 * el.L) / 4 }, { x: el.L }];
    for (const xp of pts) {
      raw.push({ x: xp, side: "left" });
      raw.push({ x: xp, side: "right" });
    }
    // 剪力零点（弯矩极值）：按 100 段扫描符号变化，跳过分段里含集中荷载的跳变区间
    const fAt = (x: number) => sectionForces(el.L, el.fLocal, el.lm, x, 1e-12);
    const SEG = 100;
    let vScale = 0;
    for (let i = 0; i <= SEG; i++) {
      const f = fAt((el.L * i) / SEG);
      vScale = Math.max(vScale, Math.abs(f.Vy), Math.abs(f.Vz));
    }
    const vEps = Math.max(1e-9, vScale * 1e-9);
    if (vScale > 1e-9) {
      for (const comp of ["Vy", "Vz"] as const) {
        let prev = fAt(0)[comp];
        for (let i = 1; i <= SEG; i++) {
          const x0 = (el.L * (i - 1)) / SEG;
          const x1 = (el.L * i) / SEG;
          const cur = fAt(x1)[comp];
          const jump = pts.some((p) => p > x0 + 1e-12 && p <= x1 + 1e-12);
          const crosses = (prev < -vEps && cur > vEps) || (prev > vEps && cur < -vEps) || (Math.abs(cur) <= vEps && Math.abs(prev) > vEps);
          if (!jump && crosses) {
            let a = x0;
            let b = x1;
            let fa = prev;
            for (let k = 0; k < 60; k++) {
              const mid = (a + b) / 2;
              const fm = fAt(mid)[comp];
              if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) {
                a = mid;
                fa = fm;
              } else b = mid;
            }
            raw.push({ x: (a + b) / 2 });
          }
          prev = cur;
        }
      }
    }
    raw.sort((a, b) => a.x - b.x);
    // 去重（同 x 同 side），保留极值点多一次也无意义
    const seen = new Set<string>();
    const uniq = raw.filter((r) => {
      const k = `${r.x.toFixed(9)}:${r.side ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const sections: MemberSection[] = uniq.map(({ x, side }) => {
      const f = sectionForces(el.L, el.fLocal, el.lm, x, side === "right" ? -1e-12 : 1e-12);
      return side ? { x, ...f, side } : { x, ...f };
    });
    out.push({ id: el.id, kind: "beam", L: el.L, sections });
  }
  return out;
}

/** 总应变能（½Σdᵀkd，含桁架轴力分量），能量法口径输出用。 */
function strainEnergy(st: StiffnessSolved): number {
  let e = 0;
  for (const el of st.elements) for (let p = 0; p < 12; p++) e += el.kLoc[p].reduce((s, v, j) => s + v * el.dLocal[j], 0) * el.dLocal[p];
  return 0.5 * e;
}

/** Q2 后处理束：应力/稳定/能量（全部条件触发；未触发时返回空，T/B 快照逐字节不变）。 */
function q2Extras(model: TrussModel, st: StiffnessSolved, internals: MemberInternal[]) {
  const extraChecks: Check[] = [];
  const extraWarnings: string[] = [];
  const extraSteps: SolveStep[] = [];
  let stress: MemberStress[] | undefined;
  let buckling: BucklingReport | undefined;
  let energy: number | undefined;
  if (stressRequested(model)) {
    const r = computeStress(model, internals);
    if (r.stress.length) {
      stress = r.stress;
      extraChecks.push(strengthCheck(r.stress));
      extraSteps.push({ title: "应力", detail: `逐截面应力后处理 ${r.stress.length} 杆：σ=N/A+|My|/Wy+|Mz|/Wz，τ=√((T/Wt)²+(ks·V/A)²)；主应力→第四理论校核（莫尔圆见结果卡）` });
    }
    // 评审 P0-5：缺截面模量不再按 0 应力算，直接给一条失败校核（不让「已验证」蒙混过关）
    if (r.missing.length) {
      const ids = r.missing.slice(0, 4).map((x) => `${x.id}（缺 ${x.items.join("/")}）`).join("、");
      extraChecks.push({
        name: "截面模量完整性",
        pass: false,
        residual: Infinity,
        note: `构件 ${ids} 缺少计算弯曲/扭转应力所需的截面模量，应力校核无法完成；请改用截面库，或补全 Wy/Wz/Wt`,
      });
    }
    extraWarnings.push(...r.warnings);
  }
  if (model.buckling) {
    buckling = solveBuckling(model, st);
    extraSteps.push({
      title: "稳定",
      detail: buckling.ok
        ? `几何刚度广义特征值 λ=${buckling.lambda.toFixed(3)}：全部荷载同乘 λ 达临界（Pcr=λ×当前荷载），屈曲模态按最大分量归一`
        : `稳定分析：${buckling.note ?? "不可用"}`,
    });
  }
  if (model.reportEnergy) {
    energy = strainEnergy(st);
    extraSteps.push({ title: "能量", detail: `总应变能 U=${energy.toExponential(4)} J（卡氏定理口径：δᵢ=∂U/∂Pᵢ）` });
  }
  return { stress, buckling, energy, extraChecks, extraWarnings, extraSteps };
}

/** 评审 P0-2：零刚度平动自由度必须显式说明（不静默凝聚），避免把「悬空点」当成解出来的位移。 */
function condensedWarnings(st: StiffnessSolved): string[] {
  if (!st.condensed.length) return [];
  const list = st.condensed.slice(0, 3).map((c) => `${c.node}·${c.dof}`).join("、");
  return [
    `零刚度平动自由度 ${st.condensed.length} 个（${list}${st.condensed.length > 3 ? " 等" : ""}）：该方向没有构件刚度，位移按 0 凝聚——结构含机构方向，位移仅供参考`,
  ];
}

/** 评审 P0-3：位移/转角量级判据。max|u|/minL > 5e-2 或 |θ| > 1 rad 时，
 *  线性小变形假设已不成立（教材算例通常 <2%，病态解往往 >100%），不能盖「已验证」。
 *  阈值取 5%（而非报告示例的 1%）：B3/C7 这类「特意展示挠度」的梁算例本身约 1.5%，
 *  1% 会把正确结果也判掉；5% 仍能拦住 1e7 m 量级的病态解。 */
function magnitudeCheck(st: StiffnessSolved, nNodes: number): Check | null {
  let uMax = 0;
  let thetaMax = 0;
  for (let i = 0; i < nNodes; i++) {
    uMax = Math.max(uMax, Math.hypot(st.u[i * 6], st.u[i * 6 + 1], st.u[i * 6 + 2]));
    thetaMax = Math.max(thetaMax, Math.hypot(st.u[i * 6 + 3], st.u[i * 6 + 4], st.u[i * 6 + 5]));
  }
  let minL = Infinity;
  for (const g of st.geoms) minL = Math.min(minL, g.L);
  const ratio = Number.isFinite(minL) && minL > 0 ? uMax / minL : 0;
  if (!(ratio > 5e-2) && !(thetaMax > 1)) return null;
  return {
    name: "位移量级",
    pass: false,
    residual: Number.isFinite(ratio) ? ratio : Infinity,
    note: `max|u|=${uMax.toExponential(2)} m，minL=${Number.isFinite(minL) ? minL.toExponential(2) : "—"} m，max|u|/minL=${ratio.toExponential(2)}（判据 >5e-2）；max|θ|=${thetaMax.toExponential(2)} rad（判据 >1）——线性小变形假设不成立或模型病态，结果仅供参考`,
  };
}

/**
 * 一级路由：计数预判 → 直接刚度法（6-DOF）→ 独立校核 → 静定桁架节点法互校。
 * 纯桁架模型的输出文本/数值与一期逐字节一致（快照红线）；含梁模型走新文案分支。
 * 原则与 solve-deck 一致：图是输入，结果只认一条路由；校核不过不盖「已验证」。
 */
export function solveTruss(model: TrussModel): Solution3D {
  const t0 = Date.now();
  // Q3 刚体静力路由（E2）：model.rigid 存在即走刚体引擎，杆件不参与求解
  if (model.rigid) return solveRigid(model, t0);
  const det = classify(model);

  const st = solveStiffness(model);
  if (!st.ok) {
    const kind: DeterminacyKind = st.kind === "mechanism" ? "mechanism" : det.kind === "indeterminate" ? "indeterminate" : det.kind === "under-constrained" ? "mechanism" : "determinate";
    return {
      modelId: model.id,
      headline: `拒答：${st.reason}`,
      verified: false,
      determinacy: kind,
      reactions: {},
      memberForces: [],
      displacements: {},
      steps: [
        {
          title: "认题",
          detail: det.hasBeam
            ? `${det.n} 结点 ${det.m} 杆（含梁单元），约束 ${det.r} 分量；有效方程 ${det.eq} vs 未知数 ${det.eq + det.surplus}`
            : `${det.n} 结点 ${det.m} 杆，约束 ${det.r} 分量；m+r=${det.m + det.r} vs 3n=${det.eq}`,
        },
        { title: "建模", detail: st.kind === "mechanism" ? "装配刚度矩阵后主元检测失败" : "模型合法性检查失败" },
        { title: "求解", detail: "拒答，不产出数字" },
      ],
      checks: [],
      warnings: [],
      refusals: [st.reason, ...st.hints],
      solveMs: Date.now() - t0,
    };
  }

  // ---- 杆力表 ----
  const maxN = Math.max(1e-9, ...[...st.memberForces.values()].map(Math.abs));
  const memberForces: MemberForce[] = model.members.map((mb) => {
    const N = st.memberForces.get(mb.id) ?? 0;
    const kind: MemberForce["kind"] = Math.abs(N) < maxN * 1e-6 ? "zero" : N > 0 ? "tension" : "compression";
    return { id: mb.id, N, kind };
  });

  const displacements: Record<string, [number, number, number]> = {};
  const reactions: Record<string, [number, number, number]> = {};
  const rotations: Record<string, [number, number, number]> = {};
  const reactionMoments: Record<string, [number, number, number]> = {};
  model.nodes.forEach((nd, i) => {
    displacements[nd.id] = [st.u[i * 6], st.u[i * 6 + 1], st.u[i * 6 + 2]];
    reactions[nd.id] = st.reactions.get(nd.id) ?? [0, 0, 0];
    rotations[nd.id] = [st.u[i * 6 + 3], st.u[i * 6 + 4], st.u[i * 6 + 5]];
    reactionMoments[nd.id] = st.reactionMoments.get(nd.id) ?? [0, 0, 0];
  });

  // ---- 独立校核 ----
  const loadScale = Math.max(
    1e-9,
    ...model.loads.flatMap((l) => [Math.abs(l.fx ?? 0), Math.abs(l.fy ?? 0), Math.abs(l.fz ?? 0), Math.abs(l.mx ?? 0), Math.abs(l.my ?? 0), Math.abs(l.mz ?? 0)]),
    // 评审 M6：杆上梯形的第二端集度也要进尺度（beam.ts 实际用 fx2 ?? fx）
    ...(model.memberLoads ?? []).flatMap((ml) => [
      Math.abs(ml.fx ?? 0),
      Math.abs(ml.fy ?? 0),
      Math.abs(ml.fz ?? 0),
      Math.abs(ml.fx2 ?? ml.fx ?? 0),
      Math.abs(ml.fy2 ?? ml.fy ?? 0),
      Math.abs(ml.fz2 ?? ml.fz ?? 0),
    ]),
  );

  if (det.hasBeam) {
    // ---- 梁/刚架路由：6 分量平衡 + 能量 + 内力表 ----
    // 计数启发式对混合模型偏保守，成功求解后按多余约束数定级（奇异已由刚度法拒答）
    const determinacy: DeterminacyKind = det.surplus > 0 ? "indeterminate" : "determinate";
    const internals = buildInternals(st);
    const eqRes = frameEquilibriumResidual(model, st.elements, st.reactions, st.reactionMoments, st.u);
    const enRes = frameEnergyResidual(model, st.elements, st.u);
    const checks: Check[] = [
      { name: "结点平衡残差", pass: eqRes < loadScale * 1e-9 + 1e-6, residual: eqRes, note: "每结点 Σ(端力)+反力+外载=0（6 分量）" },
      { name: "能量校核", pass: enRes < 1e-6, residual: enRes, note: "外力功（含杆载积分）= 应变能（相对偏差）" },
    ];
    const q2 = q2Extras(model, st, internals);
    checks.push(...q2.extraChecks);
    const mag = magnitudeCheck(st, model.nodes.length);
    if (mag) checks.push(mag);
    const verified = checks.every((c) => c.pass);
    const warnings: string[] = [...condensedWarnings(st), ...q2.extraWarnings];
    if (det.kind === "indeterminate") {
      warnings.push(`多余约束 ${det.surplus} 个：内力分布依赖 E·A/E·I/G·J 取值，口径见模型数据`);
    }
    // 实体块内部的隐藏刚性连接不算「可读构件」，headline 只报可见数量
    const visibleMembers = model.members.filter((m) => !m.hidden).length;
    const headline = `${visibleMembers} 根杆件内力与 ${det.n} 个结点位移已解出（直接刚度法·空间梁单元，${KIND_CN[determinacy]}）`;
    return {
      modelId: model.id,
      headline,
      verified,
      determinacy,
      reactions,
      memberForces,
      displacements,
      steps: [
        {
          title: "认题",
          detail: `${det.n} 结点 ${det.m} 杆（含梁）${det.r} 约束分量；有效方程 ${det.eq} vs 未知数 ${det.eq + det.surplus} → ${KIND_CN[determinacy]}${det.surplus > 0 ? `（多余约束 ${det.surplus}）` : ""}`,
        },
        {
          title: "建模",
          detail: `装配 6-DOF 全局刚度矩阵（${model.nodes.length * 6}×${model.nodes.length * 6}），铰释放+零刚度凝聚后 ${st.freeCount} 个自由 DOF；杆上荷载已折等效结点荷载`,
        },
        { title: "求解", detail: `列主元高斯消元，耗时 ${Date.now() - t0} ms；逐杆内力表 ${internals.length} 杆` },
        ...q2.extraSteps,
        { title: "校核", detail: checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}（残差 ${c.residual.toExponential(2)}）`).join("；") },
      ],
      checks,
      warnings,
      solveMs: Date.now() - t0,
      reactionMoments,
      rotations,
      internals,
      ...(q2.stress ? { stress: q2.stress } : {}),
      ...(q2.buckling ? { buckling: q2.buckling } : {}),
      ...(q2.energy !== undefined ? { energy: q2.energy } : {}),
    };
  }

  // ---- 纯桁架路由（一期口径，快照逐字节红线） ----
  const determinacy: DeterminacyKind = det.kind === "under-constrained" ? "mechanism" : det.kind;
  const eqRes = equilibriumResidual(model, st.memberForces, st.reactions);
  const u3: number[] = [];
  model.nodes.forEach((_, i) => u3.push(st.u[i * 6], st.u[i * 6 + 1], st.u[i * 6 + 2]));
  // 评审 P0-6：桁架能量校核必须含弹簧应变能（否则用了弹性支座的正确模型恒判 ✗）
  const enRes = energyResidual(model, u3, st.geoms, st.memberForces, springStrainEnergy(model, st.u));

  const checks: Check[] = [
    {
      name: "结点平衡残差",
      pass: eqRes < loadScale * 1e-9 + 1e-6,
      residual: eqRes,
      note: "每结点 Σ(杆力)+反力+外载=0",
    },
    {
      name: "能量校核",
      pass: enRes < 1e-6,
      residual: enRes,
      note: "外力功 = 应变能（相对偏差）",
    },
  ];

  // ---- 静定：节点法互校（D1 双解） ----
  // 评审 P0-7：用「平动约束数」判断节点法是否适用（原来只看 det.kind，且 jointSolve 内部混用 6-DOF 约束数）
  let rTrans = 0;
  for (const set of fixedAxesByNode(model).values()) for (const a of set) if (a === "x" || a === "y" || a === "z") rTrans++;
  let crossNote = "节点法互校：不适用（非静定）";
  if (det.m + rTrans === 3 * det.n) {
    const jt = solveJoint(model);
    if (!jt.ok) {
      checks.push({ name: "节点法互校", pass: false, residual: Infinity, note: jt.reason });
    } else {
      let maxDiff = 0;
      for (const g of jt.geoms) {
        maxDiff = Math.max(maxDiff, Math.abs((jt.memberForces.get(g.id) ?? 0) - (st.memberForces.get(g.id) ?? 0)));
      }
      checks.push({
        name: "节点法互校",
        // 评审 M7：与结点平衡同口径，补 1e-6 绝对底，避免小荷载模型被浮点噪声判失败
        pass: maxDiff < loadScale * 1e-9 + 1e-6,
        residual: maxDiff,
        note: "静定杆力双解逐字段一致",
      });
      crossNote = `节点法互校：最大杆力差 ${maxDiff.toExponential(2)} N`;
    }
  }

  const q2 = q2Extras(model, st, stressRequested(model) ? buildInternals(st) : []);
  checks.push(...q2.extraChecks);
  const mag = magnitudeCheck(st, model.nodes.length);
  if (mag) checks.push(mag);

  const verified = checks.every((c) => c.pass);
  const warnings: string[] = [...condensedWarnings(st), ...q2.extraWarnings];
  if (det.kind === "indeterminate") {
    warnings.push(`一次或多次静不定（多余约束 ${det.surplus} 个）：结果依赖 E/A 取值，口径见模型数据`);
  }

  // 实体块内部的隐藏刚性连接不算「可读构件」，headline 只报可见数量
  const visibleMembers = model.members.filter((m) => !m.hidden).length;
  const headline = `${visibleMembers} 根杆件轴力与 ${det.n} 个结点位移已解出（直接刚度法，${KIND_CN[determinacy]}）`;

  return {
    modelId: model.id,
    headline,
    verified,
    determinacy,
    reactions,
    memberForces,
    displacements,
    steps: [
      {
        title: "认题",
        detail: `${det.n} 结点 ${det.m} 杆 ${det.r} 约束分量；m+r=${det.m + det.r} vs 3n=${det.eq} → ${KIND_CN[determinacy]}${det.surplus > 0 ? `（多余约束 ${det.surplus}）` : ""}`,
      },
      {
        title: "建模",
        detail: `装配全局刚度矩阵 K（${det.eq}×${det.eq}），凝聚 ${st.freeCount} 个自由 DOF`,
      },
      {
        title: "求解",
        detail: `列主元高斯消元，耗时 ${Date.now() - t0} ms；${crossNote}`,
      },
      ...q2.extraSteps,
      {
        title: "校核",
        detail: checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}（残差 ${c.residual.toExponential(2)}）`).join("；"),
      },
    ],
    checks,
    warnings,
    solveMs: Date.now() - t0,
    ...(q2.stress ? { stress: q2.stress } : {}),
    ...(q2.buckling ? { buckling: q2.buckling } : {}),
    ...(q2.energy !== undefined ? { energy: q2.energy } : {}),
  };
}
