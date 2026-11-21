// Q2 截面库：矩形 / 圆 / 空心圆管 / 工字形 → A、Iy、Iz、J、Wy、Wz、Wt、剪应力形状系数 ks。
// 轴向口径（与 beam.ts 局部系一致，x̂ 沿杆轴）：
//   ŷ = 截面「高」方向（竖向荷载 fy 在 x̂–ŷ 平面弯曲 → 绕 ẑ 的 Mz，用 Iz/Wz）；
//   ẑ = 截面「宽」方向（fz 荷载绕 ŷ 弯曲 → Iy/Wy）。
// 因此矩形 b×h 定义 b 沿 ẑ（宽）、h 沿 ŷ（高），强轴为 Iz。
// 单位：m、m²、m⁴、m³；J 为非圆截面的扭转常数（开口薄壁按 (1/3)Σbt³ 近似）。

export type SectionDef =
  | { kind: "rect"; b: number; h: number }
  | { kind: "circle"; d: number }
  | { kind: "tube"; D: number; t: number }
  | { kind: "iweb"; H: number; B: number; tw: number; tf: number };

export interface SectionProps {
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  Wy: number; // 绕 ŷ 弯曲截面模量（ẑ 外缘）
  Wz: number; // 绕 ẑ 弯曲截面模量（ŷ 外缘，竖向荷载主用）
  Wt: number; // 抗扭截面模量：τ_max = T/Wt（圆截面精确；开口薄壁 τ=T·t_max/J 口径）
  ks: number; // 剪应力实用计算：τ_max = ks·|V|/A
  h: number; // 截面外廓「高」（ŷ 方向），渲染与参考用
}

export function sectionProps(def: SectionDef): SectionProps {
  switch (def.kind) {
    case "rect": {
      const { b, h } = def;
      const A = b * h;
      const Iz = (b * h ** 3) / 12;
      const Iy = (h * b ** 3) / 12;
      // 矩形扭转常数（Timoshenko 近似级数首项）
      const r = Math.min(b, h) / Math.max(b, h);
      const J = ((1 / 3 - 0.21 * r * (1 - r ** 4 / 12)) * Math.max(b, h) * Math.min(b, h) ** 3);
      // 评审 M10：矩形抗扭截面模量按「短边」——τ_max = T·t/J，Wt = J/t（t=min），
      // 原来用 max(b,h) 会把薄高矩形的扭转应力高估（b×h=100×200 约 2.1 倍）。
      return { A, Iy, Iz, J, Wy: Iy / (b / 2), Wz: Iz / (h / 2), Wt: J / Math.min(b, h), ks: 1.5, h };
    }
    case "circle": {
      const A = (Math.PI * def.d ** 2) / 4;
      const I = (Math.PI * def.d ** 4) / 64;
      const J = 2 * I;
      return { A, Iy: I, Iz: I, J, Wy: I / (def.d / 2), Wz: I / (def.d / 2), Wt: J / (def.d / 2), ks: 4 / 3, h: def.d };
    }
    case "tube": {
      const d = def.D - 2 * def.t;
      if (d <= 0) throw new Error("管截面壁厚过大：D−2t ≤ 0");
      const A = (Math.PI * (def.D ** 2 - d ** 2)) / 4;
      const I = (Math.PI * (def.D ** 4 - d ** 4)) / 64;
      const J = 2 * I;
      return { A, Iy: I, Iz: I, J, Wy: I / (def.D / 2), Wz: I / (def.D / 2), Wt: J / (def.D / 2), ks: 2, h: def.D };
    }
    case "iweb": {
      const { H, B, tw, tf } = def;
      const A = 2 * B * tf + (H - 2 * tf) * tw;
      const Iz = (B * H ** 3 - (B - tw) * (H - 2 * tf) ** 3) / 12;
      const Iy = (2 * tf * B ** 3 + (H - 2 * tf) * tw ** 3) / 12;
      const J = (2 * B * tf ** 3 + (H - 2 * tf) * tw ** 3) / 3; // 开口薄壁近似
      return { A, Iy, Iz, J, Wy: Iy / (B / 2), Wz: Iz / (H / 2), Wt: J / Math.max(tf, tw), ks: A / ((H - 2 * tf) * tw), h: H };
    }
  }
}

// ---------- 预置截面库（编辑器下拉口径，数值取自 GB 型钢表 / 常用教学截面） ----------

export interface SectionPreset {
  id: string;
  name: string;
  def: SectionDef;
}

export const SECTION_PRESETS: SectionPreset[] = [
  { id: "rect-100x200", name: "矩形 100×200", def: { kind: "rect", b: 0.1, h: 0.2 } },
  { id: "rect-120x120", name: "正方形 120×120", def: { kind: "rect", b: 0.12, h: 0.12 } },
  { id: "circle-80", name: "圆钢 ⌀80", def: { kind: "circle", d: 0.08 } },
  { id: "circle-100", name: "圆轴 ⌀100", def: { kind: "circle", d: 0.1 } },
  { id: "tube-89x4", name: "圆管 ⌀89×4", def: { kind: "tube", D: 0.089, t: 0.004 } },
  { id: "i16", name: "工字钢 I16", def: { kind: "iweb", H: 0.16, B: 0.1, tw: 0.0066, tf: 0.0099 } },
  { id: "i20a", name: "工字钢 I20a", def: { kind: "iweb", H: 0.2, B: 0.1, tw: 0.009, tf: 0.0114 } },
  { id: "i32a", name: "工字钢 I32a", def: { kind: "iweb", H: 0.32, B: 0.115, tw: 0.0075, tf: 0.015 } },
];

export function presetProps(id: string): SectionProps | null {
  const p = SECTION_PRESETS.find((s) => s.id === id);
  return p ? sectionProps(p.def) : null;
}
