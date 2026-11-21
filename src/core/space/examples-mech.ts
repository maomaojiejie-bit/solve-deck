// Q4 E3 黄金算例：K1–K4R 运动学 + D1–D5 动力学（金色值以 g=9.8 口径手算对账）。
// 与 EXAMPLES（E1/E2 静力）并列的独立列表示例；快照门禁逐 id 生成。
import type { MechModel } from "./types";

const PI = Math.PI;

export const EXAMPLES_MECH: MechModel[] = [
  // ---------- K1 质点运动学：螺旋线（自然法对账 v=√45、a_n=18、ρ=2.5） ----------
  {
    id: "K1",
    name: "质点螺旋运动（自然法）",
    type: "K1",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "P", x: 0, y: 2, z: 0 },
    ],
    p: { x_A: 2, x_w: 3, x_ph: PI / 2, y_A: 2, y_w: 3, z_c1: 3, tKey: 1 },
    duration: 2,
  },
  // ---------- K2 定轴转动：φ=2t+0.5t²，tKey=2 → ω=4、v=6、a_n=24、a_t=1.5 ----------
  {
    id: "K2",
    name: "刚体定轴转动",
    type: "K2",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "N1", x: 1.5, y: 0, z: 0 },
      { id: "N2", x: 0, y: 0, z: 2 },
    ],
    members: [{ id: "m1", a: "O", b: "N1" }],
    p: { dz: 1, ph_c1: 2, ph_c2: 0.5, kn: 1, tKey: 2 },
    duration: 3,
  },
  // ---------- K3 合成运动：杆转 0.5t、滑点沿杆 2t，tKey=2 → v_a=2√2、a_c=2、|a_a|=√5 ----------
  {
    id: "K3",
    name: "转动杆上滑点（科氏加速度）",
    type: "K3",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "A", x: 4.5, y: 0, z: 0 },
      { id: "P", x: 1, y: 0, z: 0 },
    ],
    members: [{ id: "m1", a: "O", b: "A" }],
    p: { psi_c1: 0.5, s_c1: 2, L: 4.5, tKey: 2 },
    duration: 4,
  },
  // ---------- K4 滑块曲柄：r=0.4、l=1、ω=10，tKey=π/20(θ=90°) → v_B=−4、ω_AB=0（瞬时平动） ----------
  {
    id: "K4",
    name: "曲柄滑块平面运动（基点法/瞬心）",
    type: "K4",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "A", x: 0.4, y: 0, z: 0 },
      { id: "B", x: 1.4, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", a: "O", b: "A" },
      { id: "m2", a: "A", b: "B" },
    ],
    p: { r: 0.4, l: 1, w: 10, tKey: PI / 20 },
    duration: (4 * PI) / 10,
  },
  // ---------- K4R 圆盘纯滚：R=0.5、v_C=2 → ω=4、|a_P|=v²/R=8、接触点速度 0 ----------
  {
    id: "K4R",
    name: "圆盘沿地面纯滚动",
    type: "K4R",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "C", x: 0, y: 0.5, z: 0 },
      { id: "P", x: 0.5, y: 1, z: 0 },
      { id: "G", x: 0, y: 0, z: 0 },
    ],
    members: [{ id: "m1", a: "C", b: "P" }],
    p: { R: 0.5, v0: 2, tKey: 1 },
    duration: 2,
  },
  // ---------- K4M 拒答：r≥l 无法装配 ----------
  {
    id: "K4M",
    name: "曲柄滑块（r≥l 装配失败）",
    type: "K4",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "A", x: 1.2, y: 0, z: 0 },
      { id: "B", x: 2.2, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", a: "O", b: "A" },
      { id: "m2", a: "A", b: "B" },
    ],
    p: { r: 1.2, l: 1 },
    duration: 1,
  },
  // ---------- D1 质点动力学：m=2、v₀=(3,4,0)、F=(10,0,0)、重力 → t=1: v=(8,−5.8)、x=5.5、y=−0.9 ----------
  {
    id: "D1",
    name: "斜抛质点（恒力+重力）",
    type: "D1",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "P", x: 0, y: 0, z: 0 },
    ],
    p: { m: 2, vx0: 3, vy0: 4, Fx: 10, tKey: 1 },
    duration: 1,
  },
  // ---------- D2 阿特伍德机：1kg/2kg → a=g/3、T₁=T₂=13.0667 ----------
  {
    id: "D2",
    name: "阿特伍德机（动量/动能定理）",
    type: "D2",
    nodes: [{ id: "O", x: 0, y: 4, z: 0 }],
    members: [
      { id: "m1", a: "O", b: "B1" },
      { id: "m2", a: "O", b: "B2" },
    ],
    p: { m1: 1, m2: 2, R: 0.3, rope0: 3, tKey: 1 },
    duration: 2,
  },
  // ---------- D3 单摆（大摆角数值解）：L=1、θ₀=0.1 → 能量守恒 + 小角线性双解 ----------
  {
    id: "D3",
    name: "单摆非线性数值解",
    type: "D3",
    nodes: [
      { id: "O", x: 0, y: 3, z: 0 },
      { id: "B", x: 0.1, y: 2, z: 0 },
    ],
    members: [{ id: "m1", a: "O", b: "B" }],
    p: { mode: 0, L: 1, th0: 0.1, tKey: 1.5707963267948966 / Math.sqrt(9.8) },
    duration: 4,
  },
  // ---------- D3I 斜面纯滚圆柱：β=30°、k=0.5 → a=(2/3)g·sinβ=3.2667 ----------
  {
    id: "D3I",
    name: "圆柱沿斜面纯滚（平面运动微分方程）",
    type: "D3",
    nodes: [
      { id: "S", x: 0, y: 3, z: 0 },
      { id: "C", x: 0.5, y: 2.7, z: 0 },
    ],
    members: [{ id: "m1", a: "C", b: "P" }],
    p: { mode: 2, beta: PI / 6, k: 0.5, m: 2, R: 0.3, tKey: 1 },
    duration: 2,
  },
  // ---------- D4 升降加速（动静法）：y=2t² → a=4、T=13800 N ----------
  {
    id: "D4",
    name: "提升重物（达朗贝尔动静法）",
    type: "D4",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "B", x: 0, y: 0, z: 0 },
    ],
    members: [{ id: "m1", a: "O", b: "B" }],
    p: { mode: 0, m: 1000, y_c2: 2, tKey: 1 },
    duration: 2,
  },
  // ---------- D4U 偏心转子动反力：F=m_r·e·ω²=200 N ----------
  {
    id: "D4U",
    name: "偏心转子动反力",
    type: "D4",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "E", x: 0.1, y: 0, z: 0 },
    ],
    members: [{ id: "m1", a: "O", b: "E" }],
    p: { mode: 1, mr: 5, e: 0.1, w: 20, tKey: 0.5 },
    duration: 1,
  },
  // ---------- D5 虚位移原理：θ=90° 需 M=F·r=400 N·m（二法互校） ----------
  {
    id: "D5",
    name: "曲柄滑块持荷（虚位移原理）",
    type: "D5",
    nodes: [
      { id: "O", x: 0, y: 0, z: 0 },
      { id: "A", x: 0.4, y: 0, z: 0 },
      { id: "B", x: 1.4, y: 0, z: 0 },
    ],
    members: [
      { id: "m1", a: "O", b: "A" },
      { id: "m2", a: "A", b: "B" },
    ],
    p: { r: 0.4, l: 1, th0: 0, th1: PI / 2, Fx: 1000, tKey: 1 },
    duration: 1,
  },
];
