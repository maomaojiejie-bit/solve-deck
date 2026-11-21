// Q3 刚体静力引擎（E2）：力系简化（主矢/主矩/最简形式）+ 刚体/物体系平衡 + 摩擦锥判别 + 重心形心。
// 口径：ΣF=0、ΣM=0 线性方程组（每刚体 6 方程，单结点刚体按质点取 3 方程）；
// 约束不足/超静定/奇异一律拒答不产数字（与一期拒答机制同构）。
import { solveSquare } from "./linalg.ts";
import { nodeMap } from "./types.ts";
import type {
  Check,
  CentroidReport,
  Dof,
  DeterminacyKind,
  FrictionContact,
  FrictionReport,
  HingeForce,
  ReactionLabel,
  RigidSpec,
  SimplifyResult,
  SolveStep,
  Solution3D,
  TrussModel,
} from "./types";

type V3 = [number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 1e-15 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};

const SUB = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TRANS: Dof[] = ["x", "y", "z"];
const ROT: Dof[] = ["rx", "ry", "rz"];

/** 约束反力教学命名：按 fix 自由度组合推断支座类型 */
function supportType(fix: Dof[]): string {
  const t = fix.filter((d) => (TRANS as Dof[]).includes(d)).length;
  const r = fix.filter((d) => (ROT as Dof[]).includes(d)).length;
  if (t === 3 && r === 3) return "固定端";
  if (t === 2 && r === 1) return "固定端（平面）";
  if (t === 3 && r === 0) return "球铰支座";
  if (t === 2 && r === 0) return "固定铰支座";
  if (t === 1 && r === 0) return "辊轴支座";
  if (t === 2 && r === 2) return "圆柱铰+定向";
  return `自定义约束（${t} 力/${r} 矩）`;
}

/** 切平面正交基：给定法向 n̂ 构造 (t1, t2) */
function tangentBasis(n: V3): [V3, V3] {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = unit(cross(n, a as V3));
  const t2 = cross(n, t1);
  return [t1, t2];
}

/** 力系简化：主矢 R、对 O 主矩 M、最简形式与合力作用线/力螺旋中心轴 */
export function simplifyForceSystem(forces: { r: V3; f: V3 }[], couples: V3[], O: V3): SimplifyResult {
  let R: V3 = [0, 0, 0];
  let M: V3 = [0, 0, 0];
  for (const { r, f } of forces) {
    R = add(R, f);
    M = add(M, cross(sub(r, O), f));
  }
  for (const c of couples) M = add(M, c);
  const rMag = norm(R);
  const mMag = norm(M);
  const fScale = Math.max(1e-9, ...forces.map((x) => norm(x.f)), ...couples.map(norm));
  const epsF = fScale * 1e-9;
  const epsM = fScale * 1e-9;
  let form: SimplifyResult["form"];
  let formCn: string;
  let axis: SimplifyResult["axis"] | undefined;
  if (rMag <= epsF && mMag <= epsM) {
    form = "equilibrium";
    formCn = "平衡力系（主矢主矩均为零）";
  } else if (rMag <= epsF) {
    form = "couple";
    formCn = "合力偶（主矢为零，力偶矩与基点无关）";
  } else {
    // R≠0：R·M≈0 → 可简化为单力（作用线 p+tR）；R·M≠0 → 力螺旋（中心轴 + 螺旋参数）
    const rm = dot(R, M);
    const p = mul(cross(R, M), 1 / (rMag * rMag));
    if (Math.abs(rm) <= epsF * Math.max(1, mMag)) {
      form = "force";
      formCn = "单力（主矢不为零，简化中心可移至合力作用线使主矩归零）";
      axis = { p, d: unit(R) };
    } else {
      form = "wrench";
      formCn = "力螺旋（主矢与主矩平行分量不可分离，中心轴 + 螺旋参数）";
      axis = { p, d: unit(R), pitch: rm / (rMag * rMag) };
    }
  }
  return { O, R, M, form, formCn, ...(axis ? { axis } : {}) };
}

/** 重心/形心（组合法）：c=Σw·r/Σw，负权重=挖空 */
export function computeCentroid(parts: { r: V3; w: number }[]): CentroidReport {
  let W = 0;
  let c: V3 = [0, 0, 0];
  for (const p of parts) {
    W += p.w;
    c = add(c, mul(p.r, p.w));
  }
  if (Math.abs(W) < 1e-12) return { c: [NaN, NaN, NaN], W };
  return { c: mul(c, 1 / W), W };
}

interface Unknown {
  /** 力向量列（全局分量）；矩列用 moment */
  vec?: V3;
  moment?: V3;
  body: number;
  node?: string;
  desc: string;
  /** support/friction 进反力表；hinge 只进铰力表（内力，不计入支座反力） */
  kind: "support" | "friction" | "hinge";
}

function refuse(model: TrussModel, t0: number, det: DeterminacyKind, reasons: string[], eqInfo: string): Solution3D {
  return {
    modelId: model.id,
    headline: `拒答：${reasons[0]}`,
    verified: false,
    determinacy: det,
    reactions: {},
    memberForces: [],
    displacements: {},
    steps: [
      { title: "认题", detail: eqInfo },
      { title: "建模", detail: "刚体静力口径：每刚体 ΣF=0（3）+ ΣM=0（3），单结点刚体按质点取 3 方程" },
      { title: "求解", detail: "拒答，不产出数字" },
    ],
    checks: [],
    warnings: [],
    refusals: reasons,
    solveMs: Date.now() - t0,
  };
}

/**
 * 刚体静力求解主路由（solveTruss 检测到 model.rigid 时调用）。
 * 模式：① 无约束 → 力系简化（S2/S3）；② 有约束 → 平衡求解（S1/S4/S5/S6）；gravity 独立出重心（S7）。
 */
export function solveRigid(model: TrussModel, t0: number): Solution3D {
  const spec = model.rigid as RigidSpec;
  const byId = nodeMap(model);
  const bodies = spec.bodies ?? [];
  const eqInfo = `${bodies.length} 刚体 ${model.nodes.length} 结点，支座 ${model.supports.length} 处${(spec.friction ?? []).length ? ` + 摩擦接触 ${(spec.friction ?? []).length} 处` : ""}`;

  // 结点 → 刚体归属
  const nodeBodies = new Map<string, number[]>();
  for (let bi = 0; bi < bodies.length; bi++) {
    for (const nid of bodies[bi].nodes) {
      if (!byId.has(nid)) return refuse(model, t0, "mechanism", [`刚体 ${bodies[bi].id} 引用了不存在的结点 ${nid}`, "请在编辑器中删除悬空引用"], eqInfo);
      nodeBodies.set(nid, [...(nodeBodies.get(nid) ?? []), bi]);
    }
  }

  // ---- 重心/形心（S7，可独立于平衡存在） ----
  let centroid: CentroidReport | undefined;
  if (spec.gravity?.length) {
    const parts = spec.gravity.map((g) => ({ r: [byId.get(g.node)?.x ?? 0, byId.get(g.node)?.y ?? 0, byId.get(g.node)?.z ?? 0] as V3, w: g.w }));
    centroid = computeCentroid(parts);
    if (!Number.isFinite(centroid.c[0])) {
      return refuse(model, t0, "mechanism", ["重心计算：部件权重之和为零（Σw=0），形心不存在", "请检查重力部件口径"], eqInfo);
    }
  }

  const hasEquilibrium = bodies.length > 0 && (model.supports.length > 0 || (spec.friction ?? []).length > 0);

  // ---- 主动力系简化（始终输出，受力图/对账口径） ----
  const forces: { r: V3; f: V3; body?: number }[] = [];
  const couples: { c: V3; body?: number }[] = [];
  for (const l of model.loads) {
    const nd = byId.get(l.node);
    if (!nd) return refuse(model, t0, "mechanism", [`荷载引用了不存在的结点 ${l.node}`], eqInfo);
    const owner = nodeBodies.get(l.node);
    const f: V3 = [l.fx ?? 0, l.fy ?? 0, l.fz ?? 0];
    const m: V3 = [l.mx ?? 0, l.my ?? 0, l.mz ?? 0];
    if (norm(f) > 0) forces.push({ r: [nd.x, nd.y, nd.z], f, ...(owner?.length === 1 ? { body: owner[0] } : {}) });
    if (norm(m) > 0) couples.push({ c: m, ...(owner?.length === 1 ? { body: owner[0] } : {}) });
    if (hasEquilibrium && owner && owner.length > 1) {
      return refuse(model, t0, "mechanism", [`荷载结点 ${l.node} 同时属于 ${owner.length} 个刚体（铰上荷载归属不明）`, "请把荷载移到只属于单个刚体的结点，或在铰两侧分列"], eqInfo);
    }
    if (hasEquilibrium && !owner?.length) {
      return refuse(model, t0, "mechanism", [`荷载结点 ${l.node} 未归入任何刚体`, "请在编辑器「刚体系」面板把结点指派给刚体"], eqInfo);
    }
  }
  const O: V3 = spec.simplifyAt ?? [0, 0, 0];
  const simplify = forces.length || couples.length ? simplifyForceSystem(forces, couples.map((x) => x.c), O) : undefined;

  // ---- 无约束模式：纯力系简化（S2/S3） ----
  if (!hasEquilibrium) {
    const checks: Check[] = [];
    const steps: SolveStep[] = [];
    if (simplify) {
      // 校核：力线平移定理 —— 换基点 O′ 重算主矩应满足 M′ = M + (O−O′)×R
      const Op = add(O, [1, 0, 0]);
      const s2 = simplifyForceSystem(forces, couples.map((x) => x.c), Op);
      const expect = add(simplify.M, cross(sub(O, Op), simplify.R));
      const res = norm(sub(s2.M, expect));
      const mScale = Math.max(1, norm(simplify.M), norm(simplify.R));
      checks.push({ name: "主矩变换一致性", pass: res < mScale * 1e-9 + 1e-6, residual: res, note: "换基点 O′ 重算：M′=M+(O−O′)×R（力线平移定理）" });
      if (simplify.axis) {
        // 校核：轴上点 p 处主矩应与 R 平行（垂直分量归零）
        const Mp = add(simplify.M, cross(sub(O, simplify.axis.p), simplify.R));
        const perp = norm(cross(Mp, unit(simplify.R)));
        checks.push({ name: "作用线验证", pass: perp < mScale * 1e-9 + 1e-6, residual: perp, note: "简化中心移至轴上点后主矩垂直分量归零" });
      }
      steps.push({
        title: "简化",
        detail: `主矢 |R|=${norm(simplify.R).toExponential(4)} N，对 O 主矩 |M|=${norm(simplify.M).toExponential(4)} N·m → ${simplify.formCn}${simplify.axis ? `；作用线过 (${simplify.axis.p.map((v) => v.toFixed(4)).join(", ")})，方向 (${simplify.axis.d.map((v) => v.toFixed(4)).join(", ")})${simplify.axis.pitch !== undefined ? `，螺旋参数 ${simplify.axis.pitch.toFixed(4)} m/rad` : ""}` : ""}`,
      });
    }
    if (centroid) {
      steps.push({ title: "重心", detail: `组合体形心 c=(${centroid.c.map((v) => v.toFixed(6)).join(", ")})，Σw=${centroid.W.toExponential(4)}` });
      const resid = spec.gravity!.reduce((s, g) => s + g.w, 0) === 0 ? Infinity : norm(spec.gravity!.reduce<V3>((acc, g) => add(acc, mul(sub([byId.get(g.node)!.x, byId.get(g.node)!.y, byId.get(g.node)!.z], centroid.c), g.w)), [0, 0, 0]));
      checks.push({ name: "形心矩归零", pass: resid < Math.abs(centroid.W) * 1e-9 + 1e-9, residual: resid, note: "Σw·(rᵢ−c)=0（对形心取矩）" });
    }
    if (!steps.length) steps.push({ title: "简化", detail: "无主动力亦无重心部件：空模型" });
    const verified = checks.every((c) => c.pass) && checks.length > 0;
    const headline = simplify
      ? `力系已简化为主矢 ${norm(simplify.R).toExponential(3)} N 的${simplify.form === "equilibrium" ? "平衡力系" : simplify.form === "couple" ? "合力偶" : simplify.form === "wrench" ? "力螺旋" : "合力"}`
      : centroid
        ? `组合体重心/形心已解出 c=(${centroid.c.map((v) => v.toFixed(4)).join(", ")})`
        : "空模型";
    return {
      modelId: model.id,
      headline,
      verified,
      determinacy: "determinate",
      reactions: {},
      memberForces: [],
      displacements: {},
      steps: [
        { title: "认题", detail: `${eqInfo}；无约束 → 力系简化口径（不判静定/机构）` },
        ...steps,
        ...(checks.length ? [{ title: "校核", detail: checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}（残差 ${c.residual.toExponential(2)}）`).join("；") }] : []),
      ],
      checks,
      warnings: [],
      solveMs: Date.now() - t0,
      ...(simplify ? { simplify } : {}),
      ...(centroid ? { centroid } : {}),
    };
  }

  // ---- 平衡模式：装配 6b 方程组 ----
  // 每刚体参考点取结点形心（数值条件更好）
  const refs: V3[] = bodies.map((b) => {
    const pts = b.nodes.map((id) => byId.get(id)!).filter(Boolean);
    if (!pts.length) return [0, 0, 0] as V3;
    const c: V3 = [0, 0, 0];
    for (const p of pts) {
      c[0] += p.x / pts.length;
      c[1] += p.y / pts.length;
      c[2] += p.z / pts.length;
    }
    return c;
  });
  const bodyEq = bodies.map((b) => (b.nodes.length < 2 ? 3 : 6));
  const rowBase: number[] = [];
  let rows = 0;
  for (const e of bodyEq) {
    rowBase.push(rows);
    rows += e;
  }

  const unknowns: Unknown[] = [];
  const colOf = (u: Omit<Unknown, "desc"> & { desc: string }) => {
    unknowns.push(u);
    return unknowns.length - 1;
  };
  const letter = (i: number) => SUB[i] ?? String(i);

  // 支座反力
  const reactionLabels: Record<string, ReactionLabel> = {};
  let labelIdx = 0;
  for (const s of model.supports) {
    const owner = nodeBodies.get(s.node);
    if (!owner?.length) return refuse(model, t0, "mechanism", [`支座 ${s.node} 未归入任何刚体`, "请在编辑器「刚体系」面板把支座结点指派给刚体"], eqInfo);
    if (owner.length > 1) return refuse(model, t0, "mechanism", [`支座 ${s.node} 位于 ${owner.length} 个刚体的铰点上，反力归属不明`, "请把支座移到只属于单个刚体的结点"], eqInfo);
    const bi = owner[0];
    const tag = letter(labelIdx++);
    const type = supportType(s.fix);
    const fl: [string, string, string] = ["", "", ""];
    const ml: [string, string, string] = ["", "", ""];
    for (const d of s.fix) {
      if (TRANS.includes(d)) {
        const k = TRANS.indexOf(d);
        fl[k] = `F${tag}${["x", "y", "z"][k]}`;
        const v: V3 = [0, 0, 0];
        v[k] = 1;
        colOf({ vec: v, body: bi, node: s.node, kind: "support", desc: `${fl[k]}（${type}@${s.node}）` });
      } else {
        const k = ROT.indexOf(d);
        ml[k] = `M${tag}${["x", "y", "z"][k]}`;
        const v: V3 = [0, 0, 0];
        v[k] = 1;
        colOf({ moment: v, body: bi, node: s.node, kind: "support", desc: `${ml[k]}（${type}@${s.node}）` });
      }
    }
    reactionLabels[s.node] = { type, force: fl, moment: ml };
  }
  // 摩擦接触（每处 3 未知：Fn 法向 + Ft1/Ft2 切向）
  const contacts: { c: FrictionContact; bi: number; cols: [number, number, number]; n: V3; t1: V3; t2: V3; tag: string }[] = [];
  for (const fc of spec.friction ?? []) {
    const owner = nodeBodies.get(fc.node);
    if (!owner || owner.length !== 1) return refuse(model, t0, "mechanism", [`摩擦接触 ${fc.node} 必须只属于一个刚体`, "请检查刚体结点指派"], eqInfo);
    const n = unit(fc.normal);
    if (!norm(n)) return refuse(model, t0, "mechanism", [`摩擦接触 ${fc.node} 法向为零向量`], eqInfo);
    const [t1, t2] = tangentBasis(n);
    const bi = owner[0];
    const tag = letter(labelIdx++);
    const cols: [number, number, number] = [
      colOf({ vec: n, body: bi, node: fc.node, kind: "friction", desc: `N${tag}（法向支承力@${fc.node}）` }),
      colOf({ vec: t1, body: bi, node: fc.node, kind: "friction", desc: `F${tag}τ₁（切向摩擦力@${fc.node}）` }),
      colOf({ vec: t2, body: bi, node: fc.node, kind: "friction", desc: `F${tag}τ₂（切向摩擦力@${fc.node}）` }),
    ];
    const prev = reactionLabels[fc.node];
    reactionLabels[fc.node] = { type: "摩擦接触", force: ["", "", ""], ...(prev?.moment ? { moment: prev.moment } : {}) };
    contacts.push({ c: fc, bi, cols, n, t1, t2, tag });
  }
  // 铰接内力：共享结点 k 个刚体 → 3(k−1) 未知（uᵢ 作用在 bᵢ 上，b₀ 受 −Σuᵢ）
  const hinges: { node: string; bodies: number[]; cols: number[][] }[] = [];
  const hingeSeen = new Set<string>();
  for (const [nid, bl] of nodeBodies) {
    if (bl.length < 2 || hingeSeen.has(nid)) continue;
    hingeSeen.add(nid);
    const sorted = [...bl].sort((a, b) => a - b);
    const cols: number[][] = [];
    for (let j = 1; j < sorted.length; j++) {
      const cc: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v: V3 = [0, 0, 0];
        v[k] = 1;
        cc.push(colOf({ vec: v, body: sorted[j], node: nid, kind: "hinge", desc: `铰 ${nid} 对 ${bodies[sorted[j]].id} 的力分量${["x", "y", "z"][k]}` }));
      }
      cols.push(cc);
    }
    hinges.push({ node: nid, bodies: sorted, cols });
  }

  const cols = unknowns.length;
  if (cols !== rows) {
    if (cols < rows) {
      return refuse(
        model,
        t0,
        "mechanism",
        [`约束不足：${rows} 个平衡方程 vs ${cols} 个未知约束力，刚体存在 ${rows - cols} 个自由度（机构）`, "补充约束：辊轴/球铰/固定端，或为单刚体加够 6 个独立约束"],
        `${eqInfo}；方程 ${rows} vs 未知 ${cols}`,
      );
    }
    return refuse(
      model,
      t0,
      "indeterminate",
      [`刚体系统静不定：${cols} 个未知约束力 vs ${rows} 个平衡方程（多余 ${cols - rows} 个）`, "刚体静力学无法求解超静定，需变形协调条件（转材料力学/刚度法口径）"],
      `${eqInfo}；方程 ${rows} vs 未知 ${cols}`,
    );
  }

  // 装配 A x = b
  const A: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const b = new Array<number>(rows).fill(0);
  const arm = (nid: string, bi: number): V3 => {
    const nd = byId.get(nid)!;
    return sub([nd.x, nd.y, nd.z], refs[bi]);
  };
  const applyForce = (bi: number, r: V3, f: V3, sign = 1) => {
    const base = rowBase[bi];
    for (let k = 0; k < 3; k++) b[base + k] -= sign * f[k];
    if (bodyEq[bi] === 6) {
      const m = cross(r, f);
      for (let k = 0; k < 3; k++) b[base + 3 + k] -= sign * m[k];
    }
  };
  // 主动力
  for (const l of model.loads) {
    const owner = nodeBodies.get(l.node);
    if (!owner?.length) continue;
    const bi = owner[0];
    const r = arm(l.node, bi);
    applyForce(bi, r, [l.fx ?? 0, l.fy ?? 0, l.fz ?? 0]);
    if (bodyEq[bi] === 6) {
      const base = rowBase[bi];
      const m: V3 = [l.mx ?? 0, l.my ?? 0, l.mz ?? 0];
      for (let k = 0; k < 3; k++) b[base + 3 + k] -= m[k];
    }
  }
  // 未知列
  for (let ci = 0; ci < cols; ci++) {
    const u = unknowns[ci];
    const base = rowBase[u.body];
    const vec = u.vec ?? u.moment;
    if (!vec) continue;
    for (let k = 0; k < 3; k++) {
      if (!vec[k]) continue;
      if (u.vec) A[base + k][ci] += vec[k];
      if (u.vec && bodyEq[u.body] === 6 && u.node) {
        const m = cross(arm(u.node, u.body), vec);
        for (let j = 0; j < 3; j++) A[base + 3 + j][ci] += m[j];
      } else if (u.moment && bodyEq[u.body] === 6) {
        for (let j = 0; j < 3; j++) A[base + 3 + j][ci] += vec[j];
      }
    }
  }
  // 铰力对 b₀ 的反向贡献：uᵢ 加在 bᵢ 上，同时 −uᵢ 加在 b₀ 上
  for (const h of hinges) {
    for (let j = 0; j < h.cols.length; j++) {
      for (let k = 0; k < 3; k++) {
        const ci = h.cols[j][k];
        const base0 = rowBase[h.bodies[0]];
        const v: V3 = [0, 0, 0];
        v[k] = -1;
        A[base0 + k][ci] += v[k];
        if (bodyEq[h.bodies[0]] === 6) {
          const m = cross(arm(h.node, h.bodies[0]), v);
          for (let q = 0; q < 3; q++) A[base0 + 3 + q][ci] += m[q];
        }
      }
    }
  }

  const res = solveSquare(A, b);
  if (!res.ok) {
    const u = unknowns[res.pivotCol];
    return refuse(
      model,
      t0,
      "mechanism",
      [`约束布置几何退化：方程组奇异（首个失效未知量 ${u.desc}）`, "常见原因：约束反力平行/共点，或某刚体未被独立约束完全限制"],
      `${eqInfo}；${rows}×${cols} 方程组奇异`,
    );
  }
  const x = res.x;

  // ---- 反力组装 ----
  const reactions: Record<string, V3> = {};
  const reactionMoments: Record<string, V3> = {};
  for (const nd of model.nodes) {
    reactions[nd.id] = [0, 0, 0];
    reactionMoments[nd.id] = [0, 0, 0];
  }
  for (let ci = 0; ci < cols; ci++) {
    const u = unknowns[ci];
    if (!u.node || u.kind === "hinge") continue;
    if (u.vec) reactions[u.node] = add(reactions[u.node], mul(u.vec, x[ci]));
    if (u.moment) reactionMoments[u.node] = add(reactionMoments[u.node], mul(u.moment, x[ci]));
  }

  // ---- 铰力表 ----
  const hingeForces: HingeForce[] = [];
  for (const h of hinges) {
    for (let j = 0; j < h.cols.length; j++) {
      const f: V3 = [x[h.cols[j][0]], x[h.cols[j][1]], x[h.cols[j][2]]];
      hingeForces.push({ node: h.node, bodies: [bodies[h.bodies[0]].id, bodies[h.bodies[j + 1]].id], f });
    }
  }

  // ---- 摩擦锥判别 ----
  const friction: FrictionReport[] = contacts.map(({ c, cols: cc, t1, t2 }) => {
    const Fn = x[cc[0]];
    const Ftv = add(mul(t1, x[cc[1]]), mul(t2, x[cc[2]]));
    const Ft = norm(Ftv);
    const Fmax = c.f * Math.max(0, Fn);
    let state: FrictionReport["state"];
    let note: string;
    const eps = Math.max(Fmax, Ft, 1) * 1e-6;
    if (Fn < -eps) {
      state = "separate";
      note = "法向力为负（接触面不能提供拉力）→ 脱离假设，需按脱离体重解";
    } else if (Math.abs(Ft - Fmax) <= eps) {
      state = "critical";
      note = `所需摩擦 ${Ft.toExponential(3)} N 恰达极限 f·Fn → 临界滑动状态`;
    } else if (Ft <= Fmax) {
      state = "stick";
      const phi = Math.atan(c.f);
      note = `|Ft|=${Ft.toExponential(3)} ≤ f·Fn=${Fmax.toExponential(3)} N → 静止（摩擦角 φ=atan f=${((phi * 180) / Math.PI).toFixed(2)}°，利用率 ${(Ft / Math.max(1e-12, Fmax)).toFixed(3)}）`;
    } else {
      state = "slip";
      note = `所需摩擦 ${Ft.toExponential(3)} N 超过极限 f·Fn=${Fmax.toExponential(3)} N → 静平衡假设不成立，物体滑动`;
    }
    return { node: c.node, Fn, Ft, Fmax, state, angle: Math.atan(c.f), note };
  });

  // ---- 校核 ----
  const loadScale = Math.max(1e-9, ...model.loads.flatMap((l) => [Math.abs(l.fx ?? 0), Math.abs(l.fy ?? 0), Math.abs(l.fz ?? 0), Math.abs(l.mx ?? 0), Math.abs(l.my ?? 0), Math.abs(l.mz ?? 0)]));
  let eqRes = 0;
  for (let r = 0; r < rows; r++) {
    let s = -b[r];
    for (let ci = 0; ci < cols; ci++) s += A[r][ci] * x[ci];
    eqRes = Math.max(eqRes, Math.abs(s));
  }
  // 全系统主矢主矩归零（荷载 + 支座/接触反力）
  const allForces = forces.map((f) => ({ r: f.r, f: f.f }));
  const allCouples = couples.map((f) => f.c);
  for (const nd of model.nodes) {
    const fv = reactions[nd.id];
    if (norm(fv) > 0) allForces.push({ r: [nd.x, nd.y, nd.z], f: fv });
    const mv = reactionMoments[nd.id];
    if (norm(mv) > 0) allCouples.push(mv);
  }
  const total = simplifyForceSystem(allForces, allCouples, O);
  const balRes = Math.max(norm(total.R), norm(total.M));
  const checks: Check[] = [
    { name: "逐刚体平衡残差", pass: eqRes < loadScale * 1e-6 + 1e-6, residual: eqRes, note: "每刚体 ΣF=0、ΣM=0 方程组残差（消元后回代）" },
    { name: "主矢主矩归零", pass: balRes < loadScale * 1e-6 + 1e-6, residual: balRes, note: "荷载+反力全系统简化：R=0 且 M=0" },
  ];
  for (const fr of friction) {
    checks.push({
      name: `摩擦锥判别@${fr.node}`,
      pass: fr.state === "stick" || fr.state === "critical",
      residual: fr.state === "stick" || fr.state === "critical" ? Math.max(0, fr.Ft - fr.Fmax) : fr.Ft - fr.Fmax,
      note: fr.note,
    });
  }
  if (centroid) {
    const resid = spec.gravity!.reduce<V3>((acc, g) => add(acc, mul(sub([byId.get(g.node)!.x, byId.get(g.node)!.y, byId.get(g.node)!.z], centroid.c), g.w)), [0, 0, 0]);
    checks.push({ name: "形心矩归零", pass: norm(resid) < Math.abs(centroid.W) * 1e-9 + 1e-9, residual: norm(resid), note: "Σw·(rᵢ−c)=0（对形心取矩）" });
  }

  const steps: SolveStep[] = [
    { title: "认题", detail: `${eqInfo}；${rows} 个平衡方程 = ${cols} 个未知约束力 → 静定` },
    {
      title: "建模",
      detail: `逐刚体列 ΣF=0/ΣM=0（${bodies.map((b, i) => `${b.id}:${bodyEq[i]}`).join("，")}）；铰 ${hinges.length} 处（内力 ${hinges.reduce((s, h) => s + 3 * h.cols.length, 0)} 分量）；摩擦接触 ${contacts.length} 处按全约束求解后判别摩擦锥`,
    },
    { title: "求解", detail: `列主元高斯消元 ${rows}×${cols}，耗时 ${Date.now() - t0} ms；拆体 ${bodies.length} 份` },
    ...(simplify
      ? [{ title: "简化", detail: `主动力系：|R|=${norm(simplify.R).toExponential(4)} N，对 O 主矩 |M|=${norm(simplify.M).toExponential(4)} N·m → ${simplify.formCn}` }]
      : []),
    ...friction.map((f) => ({ title: "摩擦", detail: `${f.node}：${f.note}` })),
    ...(centroid ? [{ title: "重心", detail: `形心 c=(${centroid.c.map((v) => v.toFixed(6)).join(", ")})，Σw=${centroid.W.toExponential(4)}` }] : []),
    { title: "校核", detail: checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}（残差 ${c.residual.toExponential(2)}）`).join("；") },
  ];

  const verified = checks.every((c) => c.pass);
  const warnings: string[] = [];
  if (model.memberLoads?.length) warnings.push("刚体模型忽略杆上分布荷载（memberLoads 为刚度法口径字段）");
  const slip = friction.filter((f) => f.state === "slip" || f.state === "separate");
  const headline = slip.length
    ? `${bodies.length} 刚体平衡已解出，但 ${slip.map((f) => f.node).join("、")} 处摩擦判别为${slip[0].state === "slip" ? "滑动" : "脱离"}（静假设不成立）`
    : `${bodies.length} 刚体 ${cols} 个约束力已解出（刚体静力·${hinges.length ? "物体系拆体" : "单一刚体"}${contacts.length ? "·摩擦锥判别" : ""}，静定)`;

  return {
    modelId: model.id,
    headline,
    verified,
    determinacy: "determinate",
    reactions,
    memberForces: [],
    displacements: Object.fromEntries(model.nodes.map((n) => [n.id, [0, 0, 0] as V3])),
    steps,
    checks,
    warnings,
    solveMs: Date.now() - t0,
    reactionMoments,
    reactionLabels,
    hingeForces,
    ...(simplify ? { simplify } : {}),
    ...(friction.length ? { friction } : {}),
    ...(centroid ? { centroid } : {}),
  };
}
