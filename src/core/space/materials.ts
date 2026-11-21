// Q2 材料库：E、G、屈服极限 σs（脆性材料取强度极限 σb）。
// 强度校核口径：许用应力 σ_allow = σs / n（n 为安全因数，编辑器给入）。

export interface MaterialDef {
  id: string;
  name: string;
  E: number; // 弹性模量 Pa
  G: number; // 剪切模量 Pa
  sigmaS: number; // 屈服极限（脆性材料为强度极限）Pa
  ductile: boolean; // 塑性材料 → 第四强度理论默认适用
}

export const MATERIALS: MaterialDef[] = [
  { id: "q235", name: "Q235 钢", E: 2.0e11, G: 8.0e10, sigmaS: 235e6, ductile: true },
  { id: "q345", name: "Q345 钢", E: 2.0e11, G: 8.0e10, sigmaS: 345e6, ductile: true },
  { id: "s45", name: "45 钢", E: 2.0e11, G: 8.0e10, sigmaS: 355e6, ductile: true },
  { id: "al6061", name: "铝 6061-T6", E: 6.9e10, G: 2.6e10, sigmaS: 240e6, ductile: true },
  { id: "ht200", name: "铸铁 HT200", E: 1.0e11, G: 4.0e10, sigmaS: 200e6, ductile: false },
];

export function materialById(id: string): MaterialDef | undefined {
  return MATERIALS.find((m) => m.id === id);
}
