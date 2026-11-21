import { generateTower } from "./generator.ts";
import { sectionProps, type SectionProps } from "./sections.ts";
import type { Member, TrussModel } from "./types";

// 材料默认口径：Q235 钢 E=2.0e11 Pa，截面 A=1e-3 m²。
// 坐标 Y 轴向上，单位 m；荷载单位 N。
// 手算基准（用于 check-verify 对账）：
//   T2 三脚架：腿长 √5，腿轴力 = −P·√5/6 = −3726.780 N（静定）
//   T5 四方四腿：腿长 √6，腿轴力 = −P·√6/8 = −3061.862 N（静不定但对称可手算）
//   T1 四面体：结点 N4 平衡给出腿轴力 = −P/(3·√(2/3)) = −4082.483 N（与静不定无关）

const E = 2.0e11;
const A = 1e-3;
const P = -10e3; // 顶部竖向荷载

function leg(id: string, a: string, b: string) {
  return { id, a, b, A, E };
}

// 精确几何表达式，避免十进制截断引入 1e-3 级手算偏差
const R12 = 2 / Math.sqrt(3); // 正三角形边长 2 的外接圆半径
const H12 = 2 * Math.sqrt(2 / 3); // 正四面体高
const S32 = Math.sqrt(3) / 2;

export const T1: TrussModel = {
  id: "T1",
  name: "正四面体桁架（一顶三脚，三球铰 → 外部静不定）",
  nodes: [
    { id: "N1", x: R12, y: 0, z: 0 },
    { id: "N2", x: -R12 / 2, y: 0, z: 1.0 },
    { id: "N3", x: -R12 / 2, y: 0, z: -1.0 },
    { id: "N4", x: 0, y: H12, z: 0 },
  ],
  members: [leg("M12", "N1", "N2"), leg("M23", "N2", "N3"), leg("M31", "N3", "N1"), leg("M14", "N1", "N4"), leg("M24", "N2", "N4"), leg("M34", "N3", "N4")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "y", "z"] },
    { node: "N3", fix: ["x", "y", "z"] },
  ],
  loads: [{ node: "N4", fy: P }],
};

export const T2: TrussModel = {
  id: "T2",
  name: "三脚架（静定，节点法互校基线）",
  nodes: [
    { id: "N1", x: 1.0, y: 0, z: 0 },
    { id: "N2", x: -0.5, y: 0, z: S32 },
    { id: "N3", x: -0.5, y: 0, z: -S32 },
    { id: "N4", x: 0, y: 2.0, z: 0 },
  ],
  members: [leg("M14", "N1", "N4"), leg("M24", "N2", "N4"), leg("M34", "N3", "N4")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "y", "z"] },
    { node: "N3", fix: ["x", "y", "z"] },
  ],
  loads: [{ node: "N4", fy: P }],
};

export const T3: TrussModel = {
  id: "T3",
  name: "四方锥屋架（底加斜撑，锚固 xyz+yz+y → 静定）",
  nodes: [
    { id: "N1", x: 1.0, y: 0, z: 1.0 },
    { id: "N2", x: -1.0, y: 0, z: 1.0 },
    { id: "N3", x: -1.0, y: 0, z: -1.0 },
    { id: "N4", x: 1.0, y: 0, z: -1.0 },
    { id: "N5", x: 0, y: 2.0, z: 0 },
  ],
  members: [
    leg("M12", "N1", "N2"), leg("M23", "N2", "N3"), leg("M34", "N3", "N4"), leg("M41", "N4", "N1"),
    leg("M13", "N1", "N3"),
    leg("M15", "N1", "N5"), leg("M25", "N2", "N5"), leg("M35", "N3", "N5"), leg("M45", "N4", "N5"),
  ],
  // 注意：锚固取 N1(xyz) + N2(yz) + N3(z) 会被验出真实机构——顶点 z 位移
  // 可与底环 N3/N4 的 y 滑移通过腿杆协调抵消（共面环无面外刚度）。
  // 把 N3 的约束从 z 换成 y 后该零能模被阻断，结构才真正静定。
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["y", "z"] },
    { node: "N3", fix: ["y"] },
  ],
  loads: [{ node: "N5", fy: P }],
};

export const T4: TrussModel = {
  id: "T4",
  name: "两腿悬挑架（T2 拆掉一条腿 → 机构，必须拒答）",
  nodes: [
    { id: "N1", x: 1.0, y: 0, z: 0 },
    { id: "N2", x: -0.5, y: 0, z: 0.8660254 },
    { id: "N4", x: 0, y: 2.0, z: 0 },
  ],
  members: [leg("M14", "N1", "N4"), leg("M24", "N2", "N4")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "y", "z"] },
  ],
  loads: [{ node: "N4", fy: P }],
};

export const T5: TrussModel = {
  id: "T5",
  name: "四方四腿锥（四球铰 → 一次静不定，对称荷载可手算）",
  nodes: [
    { id: "N1", x: 1.0, y: 0, z: 1.0 },
    { id: "N2", x: -1.0, y: 0, z: 1.0 },
    { id: "N3", x: -1.0, y: 0, z: -1.0 },
    { id: "N4", x: 1.0, y: 0, z: -1.0 },
    { id: "N5", x: 0, y: 2.0, z: 0 },
  ],
  members: [leg("M15", "N1", "N5"), leg("M25", "N2", "N5"), leg("M35", "N3", "N5"), leg("M45", "N4", "N5")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "y", "z"] },
    { node: "N3", fix: ["x", "y", "z"] },
    { node: "N4", fix: ["x", "y", "z"] },
  ],
  loads: [{ node: "N5", fy: P }],
};

// T6 由参数化生成器产出（P5：真实工程结构走模板路线），默认 3 层四方塔。
export const T6: TrussModel = generateTower({ layers: 3 });

// ---------- Q1 B 系列：梁 / 刚架 / 组合结构 / 弹性支座 ----------
// 公共截面：A=1e-3 m²，Iy=Iz=1e-5 m⁴（EI=2e6 N·m²），J=2e-5 m⁴，G=8e10 Pa（GJ=1.6e6 N·m²）。
// 手算基准（用于 check-verify 对账）：
//   B1 悬臂端集中力：δ=PL³/3EI=1.3333e-2，θ=PL²/2EI=1e-2，根部 |Mz|=PL=2e4
//   B2 简支满跨均载：R=qL/2=3e4，θ=qL³/24EI=0.045，跨中 Mz=qL²/8=4.5e4
//   B3 简支跨中集中力：δ=PL³/48EI=4.5e-2，R=P/2=1e4，跨中 Mz=PL/4=3e4
//   B5 两端铰接简支梁：δ=5qL⁴/384EI=0.084375，铰端 Mz=0
//   B6 梁+吊杆组合：吊杆 N=+1e4（拉），R 各 5e3，加载点 Mz=Pa·b/L=1e4
//   B7 扭转轴：φ=TL/GJ=9.375e-3 rad，反力矩 −T
//   B8 弹性支座：对称 → 各弹簧受力 5e3，变形 5e-3 m

const I = 1e-5;
const J = 2e-5;
const G = 8e10;
const FIX6 = ["x", "y", "z", "rx", "ry", "rz"] as const;

function beam(id: string, a: string, b: string, extra: Partial<Member> = {}): Member {
  return { id, a, b, A, E, kind: "beam", Iy: I, Iz: I, J, G, ...extra };
}

export const B1: TrussModel = {
  id: "B1",
  name: "悬臂梁·自由端集中力（材料力学基本模型）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2")],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", fy: -1e4 }],
};

export const B2: TrussModel = {
  id: "B2",
  name: "简支梁·满跨均布荷载（单梁单元+固端力折算）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 6, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N2", fix: ["y", "z"] },
  ],
  loads: [],
  memberLoads: [{ member: "M1", kind: "uniform", fy: -1e4 }],
};

export const B3: TrussModel = {
  id: "B3",
  name: "简支梁·跨中集中力（两单元，结点荷载下 Hermite 精确）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 3, y: 0, z: 0 },
    { id: "N3", x: 6, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2"), beam("M2", "N2", "N3")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N3", fix: ["y", "z"] },
  ],
  loads: [{ node: "N2", fy: -2e4 }],
};

export const B4: TrussModel = {
  id: "B4",
  name: "门式刚架·柱顶水平力（两次超静定，理论力学+材力综合）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 0, y: 3, z: 0 },
    { id: "N3", x: 4, y: 0, z: 0 },
    { id: "N4", x: 4, y: 3, z: 0 },
  ],
  members: [beam("M1", "N1", "N2"), beam("M2", "N2", "N4"), beam("M3", "N3", "N4")],
  supports: [
    { node: "N1", fix: [...FIX6] },
    { node: "N3", fix: [...FIX6] },
  ],
  loads: [{ node: "N2", fx: 2e4 }],
};

export const B5: TrussModel = {
  id: "B5",
  name: "两端铰接简支梁·均布荷载（单元端铰释放=静定基本体系）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 3, y: 0, z: 0 },
    { id: "N3", x: 6, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2", { releaseA: true }), beam("M2", "N2", "N3", { releaseB: true })],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N3", fix: ["y", "z"] },
  ],
  loads: [],
  memberLoads: [
    { member: "M1", kind: "uniform", fy: -1e4 },
    { member: "M2", kind: "uniform", fy: -1e4 },
  ],
};

export const B6: TrussModel = {
  id: "B6",
  name: "梁+桁架吊杆组合结构（梁受弯、吊杆纯拉，静定）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N3", x: 2, y: 0, z: 0 },
    { id: "N2", x: 4, y: 0, z: 0 },
    { id: "N4", x: 2, y: -2, z: 0 },
  ],
  members: [beam("M1", "N1", "N3"), beam("M2", "N3", "N2"), leg("T1", "N3", "N4")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N2", fix: ["y", "z"] },
  ],
  loads: [{ node: "N4", fy: -1e4 }],
};

export const B7: TrussModel = {
  id: "B7",
  name: "圆轴扭转·端部力偶（φ=TL/GJ，材料力学扭转章）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 1.5, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2")],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", mx: 1e4 }],
};

export const B8: TrussModel = {
  id: "B8",
  name: "弹性支座梁·跨中集中力（弹簧反力=k·δ，静定）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N3", x: 2, y: 0, z: 0 },
    { id: "N2", x: 4, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N3"), beam("M2", "N3", "N2")],
  supports: [
    { node: "N1", fix: ["x", "z", "rx"], springs: [{ dof: "y", k: 1e6 }] },
    { node: "N2", fix: ["z"], springs: [{ dof: "y", k: 1e6 }] },
  ],
  loads: [{ node: "N3", fy: -1e4 }],
};

export const B9: TrussModel = {
  id: "B9",
  name: "梁两端仅球铰（绕杆轴自由转动 → 机构，必须拒答）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "y", "z"] },
  ],
  loads: [{ node: "N2", fy: -1e4 }],
};

// ---------- Q2 C 系列：材料力学后处理（M1–M12 每章 ≥1 题） ----------
// 截面库口径：RECT=矩形 100×200（ŷ 高 ẑ 宽，强轴 Iz=6.667e-5、Wz=6.667e-4、A=0.02、ks=1.5）；
// CIRC=圆轴 ⌀100（J=9.8175e-6、Wt=1.9635e-4）；I20A/I16 见 sections.ts 预设。
// 手算基准：
//   C1 拉压应力：N=−1e4，σ=N/A=−1e7 Pa，利用率 1e7/156.67e6=0.0638（M1/M2）
//   C2 铝杆安全因数：σallow=240e6/2=120e6，δ=PL/(EA)=2.8986e-4 m（M2）
//   C3 剪压实用计算：τ=1.5V/A=7.5e5 Pa（M3）
//   C4 扭转切应力：τ=T/Wt=5.093e7，Mises=√3τ=8.825e7（M4/M8）
//   C5 弯曲内力→应力：σ跨中=Mz/Wz=4.5e4/6.667e-4=6.75e7（M5/M6）
//   C6 工字钢弯曲：σ=PL/Wz≈8.17e7（M6）
//   C7 挠度：δ=5qL⁴/384EIz（M7）
//   C8 弯扭组合危险点：σ=60e6、τ=40e6 → s1=80e6、s2=−20e6、Tresca=100e6、Mises=91.65e6（M8）
//   C9 拉弯组合：σ=2e4/A+2e4/Wz=1e6+3e7=3.1e7（M9）
//   C10 能量法：U=½Pδ=P²L³/6EI=66.667 J（M10）
//   C11 两跨连续梁（一次超静定）：R2=1.25qL=3.75e4、R1=R3=0.375qL=1.125e4（M11）
//   C12 两端铰支压杆 4 单元：λ≈π²EI/(L²P)=493.48（FEM 4 单元高约 2%，容差 3%）（M12）

const RECT = sectionProps({ kind: "rect", b: 0.1, h: 0.2 });
const CIRC = sectionProps({ kind: "circle", d: 0.1 });
const I20A = sectionProps({ kind: "iweb", H: 0.2, B: 0.1, tw: 0.009, tf: 0.0114 });
const I16 = sectionProps({ kind: "iweb", H: 0.16, B: 0.1, tw: 0.0066, tf: 0.0099 });
const SIG_ALLOW = 235e6 / 1.5; // Q235，n=1.5

function secBeam(id: string, a: string, b: string, sp: SectionProps, extra: Partial<Member> = {}): Member {
  return { id, a, b, A: sp.A, E, kind: "beam", Iy: sp.Iy, Iz: sp.Iz, J: sp.J, G, Wy: sp.Wy, Wz: sp.Wz, Wt: sp.Wt, ks: sp.ks, ...extra };
}

export const C1: TrussModel = {
  id: "C1",
  name: "轴向拉压应力·两段杆（M1：σ=N/A + 强度校核）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 0, y: 1, z: 0 },
    { id: "N3", x: 0, y: 2, z: 0 },
  ],
  members: [
    { id: "M1", a: "N1", b: "N2", A, E, sigmaAllow: SIG_ALLOW, materialId: "q235", safetyN: 1.5 },
    { id: "M2", a: "N2", b: "N3", A, E },
  ],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["x", "z"] },
    { node: "N3", fix: ["x", "z"] },
  ],
  loads: [{ node: "N3", fy: -1e4 }],
};

export const C2: TrussModel = {
  id: "C2",
  name: "铝杆安全因数校核（M2：σallow=σs/n）",
  nodes: C1.nodes.map((n) => ({ ...n })),
  members: [
    { id: "M1", a: "N1", b: "N2", A, E: 6.9e10, sigmaAllow: 240e6 / 2, materialId: "al6061", safetyN: 2 },
    { id: "M2", a: "N2", b: "N3", A, E: 6.9e10 },
  ],
  supports: C1.supports.map((s) => ({ ...s, fix: [...s.fix] })),
  loads: [{ node: "N3", fy: -1e4 }],
};

export const C3: TrussModel = {
  id: "C3",
  name: "短梁剪压实用计算（M3：τ=1.5V/A）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 0.4, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", RECT, { sigmaAllow: SIG_ALLOW, tauAllow: 0.6 * 235e6 })],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", fy: -1e4 }],
};

export const C4: TrussModel = {
  id: "C4",
  name: "圆轴扭转切应力（M4：τ=T/Wt，第四理论）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 1.5, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", CIRC, { sigmaAllow: SIG_ALLOW, sectionId: "circle-100" })],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", mx: 1e4 }],
};

export const C5: TrussModel = {
  id: "C5",
  name: "简支矩形梁均载·内力到应力（M5+M6：σ=Mz/Wz）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 6, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", RECT, { sigmaAllow: SIG_ALLOW, tauAllow: 0.6 * 235e6, sectionId: "rect-100x200" })],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N2", fix: ["y", "z"] },
  ],
  loads: [],
  memberLoads: [{ member: "M1", kind: "uniform", fy: -1e4 }],
};

export const C6: TrussModel = {
  id: "C6",
  name: "悬臂 I20a 弯曲应力（M6：σ=PL/Wz 强度校核）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", I20A, { sigmaAllow: SIG_ALLOW, sectionId: "i20a" })],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", fy: -1e4 }],
};

export const C7: TrussModel = {
  id: "C7",
  name: "简支 I16 均载挠度（M7：δ=5qL⁴/384EIz）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 3, y: 0, z: 0 },
    { id: "N3", x: 6, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", I16, { sectionId: "i16" }), secBeam("M2", "N2", "N3", I16, { sectionId: "i16" })],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N3", fix: ["y", "z"] },
  ],
  loads: [],
  memberLoads: [
    { member: "M1", kind: "uniform", fy: -1e4 },
    { member: "M2", kind: "uniform", fy: -1e4 },
  ],
};

export const C8: TrussModel = {
  id: "C8",
  name: "弯扭组合危险点·莫尔圆（M8：σ=60、τ=40 MPa → 主应力）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [
    { id: "M1", a: "N1", b: "N2", A, E, kind: "beam", Iy: I, Iz: I, J, G, Wy: 2e4 / 60e6, Wt: 1e4 / 40e6, sigmaAllow: SIG_ALLOW },
  ],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [
    { node: "N2", fz: -1e4 },
    { node: "N2", mx: 1e4 },
  ],
};

export const C9: TrussModel = {
  id: "C9",
  name: "拉弯组合变形（M9：σ=N/A+Mz/Wz=1+30 MPa）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [secBeam("M1", "N1", "N2", RECT, { sigmaAllow: SIG_ALLOW, sectionId: "rect-100x200" })],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [
    { node: "N2", fx: 2e4 },
    { node: "N2", fy: -1e4 },
  ],
};

export const C10: TrussModel = {
  id: "C10",
  name: "能量法·悬臂梁应变能（M10：U=P²L³/6EI，δ=∂U/∂P）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2")],
  supports: [{ node: "N1", fix: [...FIX6] }],
  loads: [{ node: "N2", fy: -1e4 }],
  reportEnergy: true,
};

export const C11: TrussModel = {
  id: "C11",
  name: "两跨连续梁均载（M11：一次超静定，R2=1.25qL）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 3, y: 0, z: 0 },
    { id: "N3", x: 6, y: 0, z: 0 },
  ],
  members: [beam("M1", "N1", "N2"), beam("M2", "N2", "N3")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx"] },
    { node: "N2", fix: ["y", "z"] },
    { node: "N3", fix: ["y", "z"] },
  ],
  loads: [],
  memberLoads: [
    { member: "M1", kind: "uniform", fy: -1e4 },
    { member: "M2", kind: "uniform", fy: -1e4 },
  ],
};

export const C12: TrussModel = {
  id: "C12",
  name: "两端铰支压杆稳定·4 单元（M12：Pcr=λP≈π²EI/L²）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 0, y: 0.5, z: 0 },
    { id: "N3", x: 0, y: 1, z: 0 },
    { id: "N4", x: 0, y: 1.5, z: 0 },
    { id: "N5", x: 0, y: 2, z: 0 },
  ],
  members: [beam("M1", "N1", "N2"), beam("M2", "N2", "N3"), beam("M3", "N3", "N4"), beam("M4", "N4", "N5")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "ry"] }, // ry=绕杆轴（全局 Y）：阻断扭转刚体机构，弯曲转角仍自由（铰支）
    { node: "N5", fix: ["x", "z"] },
  ],
  loads: [{ node: "N5", fy: -1e4 }],
  buckling: true,
};

// ---------- Q3 S 系列：理论力学静力学（引擎 E2 刚体静力，S1–S7 每章 ≥1） ----------
// 手算基准（用于 check-verify 对账）：
//   S1 受力图：N3 载 (2e4,−1e4) → FA=(−2e4,−1.5e4,0)、FBy=2.5e4、Fz 全零
//   S2 汇交力系：(1,2,2)e4 → |R|=3e4，过汇交点（对 N1 主矩=0）
//   S3 一般力系简化：F=(0,0,−1e4)@(2,0,0) + m=(0,0,5e3) → 力螺旋，中心轴过 (2,0,0)∥z，pitch=−0.5
//   S4 空间平衡：N3 载 (2e3,6e3,−1e4) → FA=(−2e3,−2e3,0)、FBy=−4e3、FCz=1e4
//   S5 物体系：B2 中点载 −2e4 → 铰力 (0,1e4,0)、A=(0,1e4,0)+MAz=4e4、Cy=1e4
//   S6 摩擦：斜面 θ=30°、W=1e4、f=0.6 → Fn=Wcosθ=8660.25、Ft=Wsinθ=5000、Fmax=5196.15 → 静止
//   S7 重心：(3e3@0,0,0)+(1e3@2,1,0)+(−0.5e3@1,0.5,0) → W=3.5e3、c=(3/7,3/14,0)

export const S1: TrussModel = {
  id: "S1",
  name: "空间受力图与支座反力（S1：球铰+固定铰+辊轴，反力按教学命名）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 4, y: 0, z: 0 },
    { id: "N3", x: 4, y: 3, z: 0 },
  ],
  members: [leg("E12", "N1", "N2"), leg("E23", "N2", "N3")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["y", "z"] },
    { node: "N3", fix: ["z"] },
  ],
  loads: [{ node: "N3", fx: 2e4, fy: -1e4 }],
  rigid: { bodies: [{ id: "B1", name: "折杆", nodes: ["N1", "N2", "N3"] }] },
};

export const S2: TrussModel = {
  id: "S2",
  name: "空间汇交力系合成（S2：三力汇交 → 合力过汇交点）",
  nodes: [{ id: "N1", x: 0, y: 0, z: 0 }],
  members: [],
  supports: [],
  loads: [{ node: "N1", fx: 1e4, fy: 2e4, fz: 2e4 }],
  rigid: { bodies: [{ id: "B1", name: "结点", nodes: ["N1"] }] },
};

export const S3: TrussModel = {
  id: "S3",
  name: "空间一般力系简化·力螺旋（S3：主矢主矩 → 中心轴+螺旋参数）",
  nodes: [
    { id: "N1", x: 2, y: 0, z: 0 },
    { id: "N2", x: 0, y: 0, z: 0 },
  ],
  members: [leg("E12", "N1", "N2")],
  supports: [],
  loads: [
    { node: "N1", fz: -1e4 },
    { node: "N2", mz: 5e3 },
  ],
  rigid: { bodies: [{ id: "B1", name: "刚体", nodes: ["N1", "N2"] }] },
};

export const S4: TrussModel = {
  id: "S4",
  name: "空间一般力系平衡（S4：6 独立约束反力 + 主矢主矩归零校核）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 4, y: 0, z: 0 },
    { id: "N3", x: 4, y: 4, z: 0 },
  ],
  members: [leg("E12", "N1", "N2"), leg("E23", "N2", "N3")],
  supports: [
    { node: "N1", fix: ["x", "y", "z"] },
    { node: "N2", fix: ["y", "z"] },
    { node: "N3", fix: ["z"] },
  ],
  loads: [{ node: "N3", fx: 2e3, fy: 6e3, fz: -1e4 }],
  rigid: { bodies: [{ id: "B1", name: "三角板", nodes: ["N1", "N2", "N3"] }] },
};

export const S5: TrussModel = {
  id: "S5",
  name: "物体系统平衡·铰接拆体（S5：固定端+中间铰+滑移支承，逐体列方程）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 4, y: 0, z: 0 },
    { id: "N4", x: 6, y: 1, z: 0 },
    { id: "N3", x: 8, y: 2, z: 0 },
  ],
  members: [leg("E12", "N1", "N2"), leg("E23", "N2", "N3"), leg("E24", "N2", "N4")],
  supports: [
    { node: "N1", fix: ["x", "y", "z", "rx", "ry", "rz"] },
    { node: "N3", fix: ["y", "z", "ry"] },
  ],
  loads: [{ node: "N4", fy: -2e4 }],
  rigid: {
    bodies: [
      { id: "B1", name: "左梁 AB", nodes: ["N1", "N2"] },
      { id: "B2", name: "右梁 BC", nodes: ["N2", "N4", "N3"] },
    ],
  },
};

export const S6: TrussModel = {
  id: "S6",
  name: "空间摩擦·摩擦锥判别（S6：斜面滑块，静止/临界/滑动判定）",
  nodes: [{ id: "N1", x: 0, y: 0, z: 0 }],
  members: [],
  supports: [],
  loads: [{ node: "N1", fy: -1e4 }],
  rigid: {
    bodies: [{ id: "B1", name: "滑块（质点口径）", nodes: ["N1"] }],
    friction: [{ node: "N1", normal: [-0.5, Math.sqrt(3) / 2, 0], f: 0.6 }],
  },
};

export const S7: TrussModel = {
  id: "S7",
  name: "重心·形心组合体（S7：组合法+负权重挖空）",
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: 2, y: 1, z: 0 },
    { id: "N3", x: 1, y: 0.5, z: 0 },
  ],
  members: [],
  supports: [],
  loads: [],
  rigid: {
    bodies: [],
    gravity: [
      { node: "N1", w: 3e3 },
      { node: "N2", w: 1e3 },
      { node: "N3", w: -0.5e3 },
    ],
  },
};

export const EXAMPLES: TrussModel[] = [T1, T2, T3, T4, T5, T6, B1, B2, B3, B4, B5, B6, B7, B8, B9, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, S1, S2, S3, S4, S5, S6, S7];
