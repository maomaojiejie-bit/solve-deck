// P2 门禁：全部算例跑 solveTruss，断言手算值 / 拒答 / 校核字段。
// 运行：node scripts/check-space-verify.mjs（Node 24 原生剥离 TS 类型）
import { EXAMPLES } from "../src/core/space/examples.ts";
import { EXAMPLES_MECH } from "../src/core/space/examples-mech.ts";
import { solveTruss } from "../src/core/space/solve.ts";
import { solveMech } from "../src/core/space/mech.ts";

let fails = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    fails++;
  } else {
    console.log(`ok   ${msg}`);
  }
}

const N = (sol, id) => sol.memberForces.find((f) => f.id === id)?.N ?? NaN;

// ---- 手算基准 ----
const LEG_T2 = -10e3 * Math.sqrt(5) / 6; // -3726.780（三腿对称）
const LEG_T5 = -10e3 * Math.sqrt(6) / 8; // -3061.862（四腿对称）
const LEG_T1 = -10e3 / (3 * Math.sqrt(2 / 3)); // -4082.483（顶点平衡给出，与外部静不定无关）

// ---- Q1 梁金色基准（EI=2e6 N·m²，GJ=1.6e6 N·m²）----
const EI = 2e6;
const GJ = 1.6e6;
const RY = (sol, id) => sol.reactions[id]?.[1] ?? NaN;
const RX = (sol, id) => sol.reactions[id]?.[0] ?? NaN;
const DY = (sol, id) => sol.displacements[id]?.[1] ?? NaN;
const ROT = (sol, id, k) => sol.rotations?.[id]?.[k] ?? NaN;
const RM = (sol, id, k) => sol.reactionMoments?.[id]?.[k] ?? NaN;
const SEC = (sol, mid, x) => sol.internals?.find((i) => i.id === mid)?.sections.find((s) => Math.abs(s.x - x) < 1e-9 && !s.side);

for (const model of EXAMPLES) {
  const sol = solveTruss(model);
  console.log(`\n== ${model.id} ${model.name}`);
  console.log(`   ${sol.headline}`);
  for (const s of sol.steps) console.log(`   [${s.title}] ${s.detail}`);
  for (const f of sol.memberForces) {
    console.log(`   ${f.id} N=${f.N.toFixed(3)} N (${f.kind})`);
  }

  if (sol.refusals) {
    assert(model.id === "T4" || model.id === "B9", `${model.id} 不应拒答却拒答了：${sol.refusals[0]}`);
    assert(sol.determinacy === "mechanism", `${model.id} 应判为机构`);
    assert(sol.memberForces.length === 0, `${model.id} 拒答不得产出数字`);
    if (model.id === "T4") assert(sol.refusals.some((r) => r.includes("N4")), "T4 拒答应定位到缺约束结点 N4");
    continue;
  }

  assert(sol.verified, `${model.id} 校核未全过，不允许 verified`);

  if (model.id === "T1") {
    assert(sol.determinacy === "indeterminate", "T1 应为静不定");
    for (const id of ["M14", "M24", "M34"]) assert(near(N(sol, id), LEG_T1, 1e-6), `T1 腿 ${id} 手算对账 ${LEG_T1.toFixed(3)}`);
    assert(near(N(sol, "M12"), N(sol, "M23"), 1e-6) && near(N(sol, "M23"), N(sol, "M31"), 1e-6), "T1 底环杆力应对称相等");
  }
  if (model.id === "T2") {
    assert(sol.determinacy === "determinate", "T2 应为静定");
    for (const id of ["M14", "M24", "M34"]) assert(near(N(sol, id), LEG_T2, 1e-6), `T2 腿 ${id} 手算对账 ${LEG_T2.toFixed(3)}`);
    assert(sol.checks.some((c) => c.name === "节点法互校" && c.pass), "T2 节点法互校必须通过");
  }
  if (model.id === "T3") {
    assert(sol.determinacy === "determinate", "T3 应为静定");
    assert(sol.checks.some((c) => c.name === "节点法互校" && c.pass), "T3 节点法互校必须通过");
    // 支座不对称 → 腿力不相等，但顶点竖向平衡必须严格成立：ΣN_leg·(−2/√6) = 10kN
    const legSum = ["M15", "M25", "M35", "M45"].reduce((s, id) => s + N(sol, id), 0);
    assert(near(legSum, -10e3 * Math.sqrt(6) / 2, 1e-6), `T3 四腿竖向合力对账（ΣN=${legSum.toFixed(3)}）`);
  }
  if (model.id === "T5") {
    assert(sol.determinacy === "indeterminate", "T5 应为一次静不定");
    for (const id of ["M15", "M25", "M35", "M45"]) assert(near(N(sol, id), LEG_T5, 1e-6), `T5 腿 ${id} 手算对账 ${LEG_T5.toFixed(3)}`);
  }
  if (model.id === "T6") {
    // 参数化四方塔：生成器正确性 + 性能 + 顶部位移量级手算校核
    assert(model.nodes.length === 16 && model.members.length === 52, "T6 默认 3 层应为 16 结点 52 杆");
    assert(sol.determinacy === "indeterminate", "T6 应为静不定（多余约束 16）");
    assert(sol.solveMs < 50, `T6 求解性能 <50ms（实测 ${sol.solveMs}ms）`);
    // 对称几何 + 对称荷载 → 四顶角竖向位移必须严格相等
    const top = ["N13", "N14", "N15", "N16"].map((id) => sol.displacements[id][1]);
    assert(top.every((v) => near(v, top[0], 1e-12)), "T6 四顶角竖向位移应对称相等");
    // 量级校核：若仅腿杆受力 δ=P·H/(4EA)=1.5e-4 m；斜材分流后应更小，但不低于半量
    const D = 10e3 * 3 / 2e8; // 1.5e-4
    assert(top[0] < 0 && Math.abs(top[0]) <= D + 1e-12, `T6 顶部位移不超纯腿受力上限 ${D.toExponential(2)}`);
    assert(Math.abs(top[0]) >= D * 0.5, `T6 顶部位移量级合理（实测 ${top[0].toExponential(3)}）`);
  }

  // ---- Q1 B 系列金色对账 ----
  if (model.id === "B1") {
    assert(sol.determinacy === "determinate", "B1 悬臂梁应为静定");
    assert(near(DY(sol, "N2"), -(1e4 * 8) / (3 * EI), 1e-9), `B1 自由端挠度 δ=PL³/3EI（实测 ${DY(sol, "N2").toExponential(4)}）`);
    assert(near(ROT(sol, "N2", 2), -(1e4 * 4) / (2 * EI), 1e-9), `B1 自由端转角 θ=PL²/2EI（实测 ${ROT(sol, "N2", 2).toExponential(4)}）`);
    assert(near(RY(sol, "N1"), 1e4, 1e-6), "B1 竖向反力 = P");
    assert(near(Math.abs(RM(sol, "N1", 2)), 2e4, 1e-6), `B1 根部反力矩 = PL（实测 ${RM(sol, "N1", 2).toFixed(3)}）`);
    assert(near(Math.abs(SEC(sol, "M1", 0).Mz), 2e4, 1e-6), "B1 根部截面 |Mz| = PL");
    assert(near(SEC(sol, "M1", 2).Mz, 0, 1e-6), "B1 自由端截面 Mz = 0");
    assert(near(SEC(sol, "M1", 0).Vy, -1e4, 1e-6) || near(SEC(sol, "M1", 0).Vy, 1e4, 1e-6), "B1 根部剪力 |Vy| = P");
  }
  if (model.id === "B2") {
    assert(sol.determinacy === "determinate", "B2 简支梁应为静定");
    assert(near(RY(sol, "N1"), 3e4, 1e-5) && near(RY(sol, "N2"), 3e4, 1e-5), `B2 两端反力 = qL/2 = 3e4（实测 ${RY(sol, "N1").toFixed(3)} / ${RY(sol, "N2").toFixed(3)}）`);
    assert(near(Math.abs(ROT(sol, "N1", 2)), (1e4 * 216) / (24 * EI), 1e-9), `B2 端转角 θ=qL³/24EI=0.045（实测 ${ROT(sol, "N1", 2).toExponential(4)}）`);
    assert(near(Math.abs(SEC(sol, "M1", 3).Mz), 4.5e4, 1e-5), `B2 跨中 Mz=qL²/8=4.5e4（实测 ${SEC(sol, "M1", 3).Mz.toFixed(3)}）`);
    assert(near(SEC(sol, "M1", 0).Mz, 0, 1e-6) && near(SEC(sol, "M1", 6).Mz, 0, 1e-6), "B2 铰支端 Mz = 0");
  }
  if (model.id === "B3") {
    assert(sol.determinacy === "determinate", "B3 应为静定");
    assert(near(DY(sol, "N2"), -(2e4 * 216) / (48 * EI), 1e-9), `B3 跨中挠度 δ=PL³/48EI=-4.5e-2（实测 ${DY(sol, "N2").toExponential(4)}）`);
    assert(near(RY(sol, "N1"), 1e4, 1e-5) && near(RY(sol, "N3"), 1e4, 1e-5), "B3 两端反力 = P/2 = 1e4");
    assert(near(Math.abs(SEC(sol, "M1", 3).Mz), 3e4, 1e-5), `B3 跨中 Mz=PL/4=3e4（实测 ${SEC(sol, "M1", 3).Mz.toFixed(3)}）`);
  }
  if (model.id === "B4") {
    assert(sol.determinacy === "indeterminate", "B4 门式刚架应为静不定");
    assert(near(RX(sol, "N1") + RX(sol, "N3"), -2e4, 1e-5), `B4 基底水平反力之和 = −F（实测 ${(RX(sol, "N1") + RX(sol, "N3")).toFixed(3)}）`);
    assert(near(RY(sol, "N1") + RY(sol, "N3"), 0, 1e-5), "B4 竖向反力之和 = 0");
  }
  if (model.id === "B5") {
    assert(sol.determinacy === "determinate", "B5 铰接简支梁应为静定");
    assert(near(DY(sol, "N2"), -(5 * 1e4 * 6 ** 4) / (384 * EI), 1e-9), `B5 跨中挠度 δ=5qL⁴/384EI=-0.084375（实测 ${DY(sol, "N2").toExponential(4)}）`);
    assert(near(RY(sol, "N1"), 3e4, 1e-5) && near(RY(sol, "N3"), 3e4, 1e-5), "B5 两端反力 = qL/2 = 3e4");
    assert(near(Math.abs(SEC(sol, "M1", 3).Mz), 4.5e4, 1e-5), `B5 跨中 Mz=qL²/8（实测 ${SEC(sol, "M1", 3).Mz.toFixed(3)}）`);
    assert(near(SEC(sol, "M1", 0).Mz, 0, 1e-6), "B5 铰端 Mz = 0（释放生效）");
  }
  if (model.id === "B6") {
    assert(sol.determinacy === "determinate", "B6 组合结构应为静定");
    assert(near(N(sol, "T1"), 1e4, 1e-6), `B6 吊杆轴力 N=+1e4 拉力（实测 ${N(sol, "T1").toFixed(3)}）`);
    assert(near(RY(sol, "N1"), 5e3, 1e-5) && near(RY(sol, "N2"), 5e3, 1e-5), "B6 梁两端反力各 P/2 = 5e3");
    assert(near(Math.abs(SEC(sol, "M2", 0).Mz), 1e4, 1e-5), `B6 加载点 Mz=Pab/L=1e4（实测 ${SEC(sol, "M2", 0).Mz.toFixed(3)}）`);
  }
  if (model.id === "B7") {
    assert(sol.determinacy === "determinate", "B7 扭转轴应为静定");
    assert(near(ROT(sol, "N2", 0), (1e4 * 1.5) / GJ, 1e-12), `B7 扭转角 φ=TL/GJ=9.375e-3（实测 ${ROT(sol, "N2", 0).toExponential(4)}）`);
    assert(near(RM(sol, "N1", 0), -1e4, 1e-6), `B7 固定端反力矩 = −T（实测 ${RM(sol, "N1", 0).toFixed(3)}）`);
    assert(near(Math.abs(SEC(sol, "M1", 0.75).T), 1e4, 1e-6), `B7 任意截面扭矩 |T| = 1e4（实测 ${SEC(sol, "M1", 0.75).T.toFixed(3)}）`);
  }
  if (model.id === "B8") {
    assert(near(DY(sol, "N1"), -5e-3, 1e-9) && near(DY(sol, "N2"), -5e-3, 1e-9), `B8 对称弹簧变形 δ=R/k=5e-3（实测 ${DY(sol, "N1").toExponential(4)} / ${DY(sol, "N2").toExponential(4)}）`);
    assert(near(DY(sol, "N3"), -5e-3 - (1e4 * 64) / (48 * EI), 1e-9), `B8 跨中位移 = 弹簧变形 + 简支弯曲挠度 PL³/48EI（实测 ${DY(sol, "N3").toExponential(4)}）`);
  }

  // ---- Q2 C 系列：材料力学后处理金色对账（手算基准见 examples.ts 注释） ----
  const ST = (id) => sol.stress?.find((s) => s.id === id);
  const WORST = (s) => s.points[s.worst];
  if (model.id === "C1") {
    const s = ST("M1");
    assert(s, "C1 缺应力后处理输出（M1）");
    assert(near(WORST(s).sigma, -1e7, 1e-3), `C1 σ=N/A=−1e7 Pa（实测 ${WORST(s).sigma.toExponential(4)}）`);
    assert(near(s.ratio, 1e7 / (235e6 / 1.5), 1e-6), "C1 利用率 σ/σallow=0.0638");
    assert(s.pass && sol.checks.some((c) => c.name.startsWith("强度校核") && c.pass), "C1 强度校核应通过并进 checks");
  }
  if (model.id === "C2") {
    assert(near(Math.abs(DY(sol, "N3")), (1e4 * 2) / (6.9e10 * 1e-3), 1e-12), `C2 铝杆 δ=PL/EA=2.8986e-4（实测 ${DY(sol, "N3").toExponential(4)}）`);
    assert(near(ST("M1").ratio, 1e7 / 120e6, 1e-6), "C2 利用率（σs=240，n=2 → σallow=120MPa）");
  }
  if (model.id === "C3") {
    const s = ST("M1");
    assert(near(s.tauMax, (1.5 * 1e4) / 0.02, 1), `C3 剪压实用计算 τ=1.5V/A=7.5e5（实测 ${s.tauMax.toExponential(4)}）`);
    assert(near(WORST(s).sigma, (1e4 * 0.4) / ((0.1 * 0.04) / 6), 100), "C3 根部 σ=M/Wz=6e6");
    assert(s.pass, "C3 剪/强校核应通过");
  }
  if (model.id === "C4") {
    const Wt = (Math.PI * 0.001) / 16;
    const s = ST("M1");
    assert(near(s.tauMax, 1e4 / Wt, 10), `C4 扭转 τ=T/Wt=5.093e7（实测 ${s.tauMax.toExponential(4)}）`);
    const p = WORST(s);
    assert(near(p.tresca, (2 * 1e4) / Wt, 20), "C4 纯扭 Tresca=2τ");
    assert(near(p.mises, (Math.sqrt(3) * 1e4) / Wt, 20), "C4 纯扭 Mises=√3τ");
    assert(near(Math.abs(ROT(sol, "N2", 0)), (1e4 * 1.5) / (8e10 * ((Math.PI * 1e-4) / 32)), 1e-8), `C4 φ=TL/GJ=1.9099e-2（实测 ${ROT(sol, "N2", 0).toExponential(4)}）`);
  }
  if (model.id === "C5") {
    const s = ST("M1");
    assert(near(s.sigmaMax, (4.5e4) / ((0.1 * 0.04) / 6), 100), `C5 跨中 σ=(qL²/8)/Wz=6.75e7（实测 ${s.sigmaMax.toExponential(4)}）`);
    assert(near(s.tauMax, (1.5 * 3e4) / 0.02, 10), "C5 支座处 τ=1.5Vmax/A=2.25e6");
  }
  if (model.id === "C6") {
    const Iz = (0.1 * 0.008 - 0.091 * 0.1772 ** 3) / 12;
    assert(rel(WORST(ST("M1")).sigma, 2e4 / (Iz / 0.1), 1e-3), `C6 I20a σ=PL/Wz（实测 ${WORST(ST("M1")).sigma.toExponential(4)}）`);
  }
  if (model.id === "C7") {
    const Iz = (0.1 * 0.16 ** 3 - 0.0934 * 0.1402 ** 3) / 12;
    assert(rel(Math.abs(DY(sol, "N2")), (5 * 1e4 * 6 ** 4) / (384 * 2e11 * Iz), 1e-3), `C7 δ=5qL⁴/384EIz（实测 ${DY(sol, "N2").toExponential(4)}）`);
  }
  if (model.id === "C8") {
    const p = WORST(ST("M1"));
    assert(near(p.s1, 80e6, 10) && near(p.s2, 0, 10) && near(p.s3, -20e6, 10), `C8 主应力 (80,0,−20)MPa 降序（实测 ${[p.s1, p.s2, p.s3].map((v) => v.toExponential(3))}）`);
    assert(near(p.tresca, 100e6, 20), "C8 Tresca=100MPa");
    assert(near(p.mises, Math.sqrt(8400) * 1e6, 20), "C8 Mises=√8400 MPa=91.65MPa");
  }
  if (model.id === "C9") {
    assert(near(ST("M1").sigmaMax, 2e4 / 0.02 + 2e4 / ((0.1 * 0.04) / 6), 100), `C9 拉弯组合 σ=1+30=3.1e7（实测 ${ST("M1").sigmaMax.toExponential(4)}）`);
  }
  if (model.id === "C10") {
    assert(near(sol.energy, (1e8 * 8) / (6 * 2e6), 1e-6), `C10 应变能 U=P²L³/6EI=66.667J（实测 ${sol.energy}）`);
    assert(near(DY(sol, "N2"), -(1e4 * 8) / (3 * EI), 1e-12), "C10 δ=∂U/∂P=PL³/3EI 一致");
  }
  if (model.id === "C11") {
    assert(sol.determinacy === "indeterminate", "C11 两跨连续梁应为静不定");
    assert(near(RY(sol, "N2"), 1.25 * 1e4 * 3, 1e-3), `C11 中支座 R2=1.25qL=3.75e4（实测 ${RY(sol, "N2").toFixed(3)}）`);
    assert(near(RY(sol, "N1"), 0.375 * 1e4 * 3, 1e-3) && near(RY(sol, "N3"), 0.375 * 1e4 * 3, 1e-3), "C11 端支座 R=3qL/8=1.125e4");
  }
  if (model.id === "C12") {
    const b = sol.buckling;
    assert(b && b.ok, `C12 稳定分析应可解${b?.note ? "：" + b.note : ""}`);
    assert(rel(b.lambda, (Math.PI ** 2 * 2e6) / (4 * 1e4), 0.02), `C12 λ≈π²EI/(L²P)=493.48（实测 ${b.lambda.toFixed(3)}）`);
    assert(b.mode[0].d.every((v) => Math.abs(v) < 1e-12), "C12 模态底端位移为零（铰支）");
    assert(b.mode[4].d.every((v) => Math.abs(v) < 1e-12), "C12 模态顶端侧移为零");
    assert(Math.hypot(...b.mode[2].d) > 0.5, "C12 中高模态幅值最大（归一口径）");
  }

  // ---- Q3 S 系列：理论力学静力学金色对账（E2 刚体引擎，手算基准见 examples.ts 注释） ----
  if (model.id === "S1") {
    assert(sol.verified && sol.determinacy === "determinate", "S1 受力图应静定已验证");
    assert(near(RX(sol, "N1"), -2e4, 1e-6) && near(RY(sol, "N1"), -1.5e4, 1e-6), `S1 FA=(-2e4,−1.5e4)（实测 ${RX(sol, "N1").toFixed(1)},${RY(sol, "N1").toFixed(1)}）`);
    assert(near(RY(sol, "N2"), 2.5e4, 1e-6), `S1 FBy=ΣM_A→2.5e4（实测 ${RY(sol, "N2").toFixed(1)}）`);
    assert(near(RY(sol, "N3"), 0, 1e-12) && near(RX(sol, "N3"), 0, 1e-12), "S1 辊轴只约束 z");
    assert(sol.reactionLabels.N1.type === "球铰支座" && sol.reactionLabels.N1.force[0] === "FAx", "S1 反力教学命名 FAx@球铰");
    assert(sol.reactionLabels.N2.type === "固定铰支座" && sol.reactionLabels.N3.type === "辊轴支座", "S1 支座类型推断");
  }
  if (model.id === "S2") {
    assert(sol.verified, "S2 汇交力系简化应已验证");
    const q = sol.simplify;
    assert(q && near(Math.hypot(...q.R), 3e4, 1e-6), `S2 |R|=|(1,2,2)e4|=3e4（实测 ${Math.hypot(...q.R).toFixed(1)}）`);
    assert(near(Math.hypot(...q.M), 0, 1e-9), "S2 对汇交点主矩=0");
    assert(q.form === "force" && near(Math.hypot(...q.axis.p), 0, 1e-9), "S2 最简形式=过汇交点的合力");
  }
  if (model.id === "S3") {
    assert(sol.verified, "S3 力螺旋简化应已验证");
    const q = sol.simplify;
    assert(q.form === "wrench", `S3 R·M=−5e7≠0 → 力螺旋（实测 ${q.form}）`);
    assert(near(q.axis.p[0], 2, 1e-9) && near(q.axis.p[1], 0, 1e-9), `S3 中心轴过 (2,0,0)（实测 ${q.axis.p.map((v) => v.toFixed(4))}）`);
    assert(near(Math.abs(q.axis.d[2]), 1, 1e-9), "S3 中心轴 ∥ z");
    assert(near(q.axis.pitch, -0.5, 1e-9), `S3 螺旋参数=(R·M)/|R|²=−0.5（实测 ${q.axis.pitch}）`);
  }
  if (model.id === "S4") {
    assert(sol.verified, "S4 空间平衡应已验证");
    assert(near(RX(sol, "N1"), -2e3, 1e-6) && near(RY(sol, "N1"), -2e3, 1e-6), "S4 FA=(−2e3,−2e3)");
    assert(near(RY(sol, "N2"), -4e3, 1e-6), `S4 FBy=−4e3（实测 ${RY(sol, "N2").toFixed(1)}）`);
    assert(near(RY(sol, "N3"), 0, 1e-12) && near(sol.reactions.N3[2], 1e4, 1e-6), "S4 FCz=1e4");
  }
  if (model.id === "S5") {
    assert(sol.verified && sol.determinacy === "determinate", "S5 物体系应静定已验证");
    const h = sol.hingeForces;
    assert(h?.length === 1 && h[0].bodies.join() === "B1,B2", "S5 铰接表 B1-B2");
    assert(near(h[0].f[1], 1e4, 1e-6) && near(h[0].f[0], 0, 1e-12), `S5 铰力对 B2=1e4（右梁 ΣM_C=0）`);
    assert(near(RY(sol, "N1"), 1e4, 1e-6) && near(RM(sol, "N1", 2), 4e4, 1e-6), "S5 FAy=1e4、MAz=4e4（左梁悬臂）");
    assert(near(RY(sol, "N3"), 1e4, 1e-6), "S5 Cy=1e4");
    assert(sol.reactionLabels.N1.type === "固定端" && sol.reactionLabels.N1.moment[2] === "MAz", "S5 固定端命名 MAz");
  }
  if (model.id === "S6") {
    assert(sol.verified, "S6 摩擦判别应已验证");
    const f = sol.friction?.[0];
    assert(f, "S6 缺摩擦报告输出");
    assert(near(f.Fn, 1e4 * Math.cos(Math.PI / 6), 1e-6), `S6 Fn=Wcos30°=8660.25（实测 ${f.Fn.toFixed(3)}）`);
    assert(near(f.Ft, 5e3, 1e-6), `S6 Ft=Wsin30°=5000（实测 ${f.Ft.toFixed(3)}）`);
    assert(near(f.Fmax, 0.6 * 1e4 * Math.cos(Math.PI / 6), 1e-6), "S6 Fmax=f·Fn=5196.15");
    assert(f.state === "stick", `S6 摩擦锥内 → 静止（实测 ${f.state}）`);
    assert(near(f.angle, Math.atan(0.6), 1e-9), "S6 摩擦角 φ=atan0.6");
  }
  if (model.id === "S7") {
    assert(sol.verified, "S7 重心应已验证");
    const g = sol.centroid;
    assert(g && near(g.W, 3.5e3, 1e-9), "S7 Σw=3.5e3");
    assert(near(g.c[0], 3 / 7, 1e-9) && near(g.c[1], 3 / 14, 1e-9) && near(g.c[2], 0, 1e-12), `S7 c=(3/7,3/14,0)（实测 ${g.c.map((v) => v.toFixed(6))}）`);
  }
}

// ---- Q4 E3 机构金色对账（K1–K4R/D1–D5，g=9.8 口径） ----
const KV = (sol, name) => sol.keyValues.find((k) => k.name === name)?.value ?? NaN;
for (const model of EXAMPLES_MECH) {
  const sol = solveMech(model);
  console.log(`\n== ${model.id} ${model.name}`);
  console.log(`   ${sol.headline}`);
  if (model.id === "K4M") {
    assert(sol.refusals && sol.refusals.length >= 2, "K4M r≥l 应拒答");
    assert(sol.frames.length === 0 && sol.keyValues.length === 0 && sol.series.length === 0, "K4M 拒答不产数字");
    continue;
  }
  assert(sol.verified, `${model.id} 应已验证`);
  assert(sol.frames.length === (model.samples ?? 61), `${model.id} 帧数=61`);
  if (model.id === "K1") {
    assert(near(KV(sol, "|v(tKey)|"), Math.sqrt(45), 1e-9), `K1 v=√45=6.7082（实测 ${KV(sol, "|v(tKey)|").toFixed(9)}）`);
    assert(near(KV(sol, "a_n(tKey)"), 18, 1e-6), "K1 a_n=18");
    assert(near(KV(sol, "a_t(tKey)"), 0, 1e-9), "K1 a_t=0（匀速率螺旋）");
    assert(near(KV(sol, "ρ(tKey)"), 2.5, 1e-6), "K1 ρ=v²/a_n=2.5");
  }
  if (model.id === "K2") {
    assert(near(KV(sol, "ω(tKey)"), 4, 1e-9), "K2 ω(2)=2+t=4");
    assert(near(KV(sol, "α(tKey)"), 1, 1e-9), "K2 α=2·0.5=1");
    assert(near(KV(sol, "v(N1,tKey)"), 6, 1e-6), "K2 v=ωR=6");
    assert(near(KV(sol, "a_n(tKey)"), 24, 1e-6), "K2 a_n=ω²R=24");
    assert(near(KV(sol, "a_t(tKey)"), 1.5, 1e-6), "K2 a_t=αR=1.5");
  }
  if (model.id === "K3") {
    assert(near(KV(sol, "v_r(tKey)"), 2, 1e-9), "K3 v_r=ṡ=2");
    assert(near(KV(sol, "v_e(tKey)"), 2, 1e-9), "K3 v_e=ωs=2");
    assert(near(KV(sol, "v_a(tKey)"), 2 * Math.SQRT2, 1e-6), "K3 v_a=2√2");
    assert(near(KV(sol, "a_c(tKey)"), 2, 1e-9), "K3 a_c=2ωv_r=2");
    assert(near(KV(sol, "a_a(tKey)"), Math.sqrt(5), 1e-6), "K3 |a_a|=√5");
  }
  if (model.id === "K4") {
    assert(near(KV(sol, "x_B(tKey)"), Math.sqrt(1 - 0.16), 1e-9), "K4 x_B(90°)=√0.84");
    assert(near(KV(sol, "v_B(tKey)"), -4, 1e-6), "K4 v_B(90°)=−rω=−4");
    assert(Math.abs(KV(sol, "ω_AB(tKey)")) < 1e-9, "K4 ω_AB(90°)=0（瞬时平动，瞬心无穷远）");
  }
  if (model.id === "K4R") {
    assert(near(KV(sol, "v_C(tKey)"), 2, 1e-12), "K4R v_C=2");
    assert(near(KV(sol, "ω(tKey)"), 4, 1e-9), "K4R ω=v_C/R=4");
    assert(near(KV(sol, "|a_P(tKey)|"), 8, 1e-6), "K4R |a_P|=v_C²/R=8");
  }
  if (model.id === "D1") {
    assert(near(KV(sol, "v_x(tKey)"), 8, 1e-6), "D1 v_x=3+(10/2)·1=8");
    assert(near(KV(sol, "v_y(tKey)"), 4 - 9.8, 1e-6), "D1 v_y=4−9.8=−5.8");
    assert(near(KV(sol, "x(tKey)"), 5.5, 1e-5), "D1 x=3+2.5=5.5");
    assert(near(KV(sol, "y(tKey)"), -0.9, 1e-5), "D1 y=4−4.9=−0.9");
  }
  if (model.id === "D2") {
    assert(near(KV(sol, "a"), 9.8 / 3, 1e-9), "D2 a=g/3=3.2667");
    assert(near(KV(sol, "T₁"), 13.066666666666666, 1e-6), "D2 T₁=m₁(g+a)=13.0667");
    assert(near(KV(sol, "T₂"), 13.066666666666666, 1e-6), "D2 T₂=T₁（理想滑轮）");
    assert(near(KV(sol, "v(tKey)"), 9.8 / 3, 1e-9), "D2 v(1)=a·1");
  }
  if (model.id === "D3") {
    assert(Math.abs(KV(sol, "θ(tKey)")) < 1e-3, `D3 θ(¼周期)≈0（实测 ${KV(sol, "θ(tKey)").toExponential(2)}）`);
    assert(near(KV(sol, "T(小角)"), (2 * Math.PI) / Math.sqrt(9.8), 1e-9), "D3 T₀=2π√(L/g)=2.0106");
  }
  if (model.id === "D3I") {
    assert(near(KV(sol, "a"), (9.8 * Math.sin(Math.PI / 6)) / 1.5, 1e-12), "D3I a=g·sinβ/(1+k)=3.2667");
    assert(near(KV(sol, "v(tKey)"), (9.8 * Math.sin(Math.PI / 6)) / 1.5, 1e-6), "D3I v(1)=a");
    assert(near(KV(sol, "s(tKey)"), (9.8 * Math.sin(Math.PI / 6)) / 3, 1e-6), "D3I s(1)=a/2");
  }
  if (model.id === "D4") {
    assert(near(KV(sol, "a(tKey)"), 4, 1e-9), "D4 a=ÿ(2t²)=4");
    assert(near(KV(sol, "T(tKey)"), 13800, 1e-6), "D4 T=m(g+a)=13800 N");
    assert(near(KV(sol, "F_I(tKey)"), -4000, 1e-6), "D4 F_I=−ma=−4000 N");
  }
  if (model.id === "D4U") {
    assert(near(KV(sol, "F"), 200, 1e-9), "D4U F=m_r·e·ω²=200 N");
  }
  if (model.id === "D5") {
    assert(near(KV(sol, "M(tKey)"), 400, 1e-6), "D5 M(90°)=F·r=400 N·m（虚功）");
    assert(near(KV(sol, "M₂(tKey)"), 400, 1e-6), "D5 静力二法互校 M₂=400");
  }
}

console.log(fails === 0 ? "\ncheck-verify: ALL PASS" : `\ncheck-verify: ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
