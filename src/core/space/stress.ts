// Q2 应力后处理：逐控制截面把内力（N/Vy/Vz/T/My/Mz）换算成危险点应力状态，
// 再求主应力与第三/第四强度理论相当应力，进强度校核。
// 口径（教学简化，写进 checks.note）：
//   σ = N/A + |My|/Wy + |Mz|/Wz（弯曲拉压叠加取外缘最大，偏保守）；
//   τ = √((T/Wt)² + (ks·|V|/A)²)；平面应力 σ3=0；默认第四强度理论（Mises）校核。

import type { Check, MemberInternal, MemberStress, StressPoint, TrussModel } from "./types";

/** 模型是否触发应力后处理：任一杆件给了许用应力。 */
export function stressRequested(model: TrussModel): boolean {
  return model.members.some((mb) => mb.sigmaAllow !== undefined || mb.tauAllow !== undefined);
}

/** 危险点应力状态：σ/τ → 主应力（降序）→ Tresca/Mises。 */
export function stressState(sigma: number, tau: number): Omit<StressPoint, "x" | "side"> {
  const c = sigma / 2;
  const R = Math.hypot(c, tau);
  const raw = [c + R, c - R, 0].sort((a, b) => b - a);
  const [s1, s2, s3] = raw;
  const tresca = Math.max(Math.abs(s1 - s2), Math.abs(s2 - s3), Math.abs(s3 - s1));
  const mises = Math.sqrt(0.5 * ((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2));
  return { sigma, tauT: 0, tauV: 0, tau, s1, s2, s3, tresca, mises };
}

/** 逐杆应力表 + 警告。internals 为逐杆控制截面内力。
 *  评审 P0-5：缺 Wy/Wz/Wt 时不再把弯曲/扭转应力按 0 算（原来 `?? Infinity` 等于「没有应力」，
 *  强度校核还会判通过）——该杆缺哪一项就跳过并列出，结果卡会给一条失败校核。 */
export function computeStress(
  model: TrussModel,
  internals: MemberInternal[],
): { stress: MemberStress[]; warnings: string[]; missing: { id: string; items: string[] }[] } {
  const stress: MemberStress[] = [];
  const warnings: string[] = [];
  const missing: { id: string; items: string[] }[] = [];
  const intById = new Map(internals.map((it) => [it.id, it]));
  for (const mb of model.members) {
    if (mb.sigmaAllow === undefined && mb.tauAllow === undefined) continue;
    const it = intById.get(mb.id);
    if (!it) continue;
    if (!(mb.A > 0)) {
      warnings.push(`构件 ${mb.id} 设置了许用应力但缺截面积 A，应力校核跳过`);
      continue;
    }
    if (mb.kind === "beam") {
      let myMax = 0;
      let mzMax = 0;
      let tMax = 0;
      for (const sec of it.sections) {
        myMax = Math.max(myMax, Math.abs(sec.My));
        mzMax = Math.max(mzMax, Math.abs(sec.Mz));
        tMax = Math.max(tMax, Math.abs(sec.T));
      }
      const need: string[] = [];
      if (myMax > 1e-6 && !(mb.Wy! > 0)) need.push("Wy");
      if (mzMax > 1e-6 && !(mb.Wz! > 0)) need.push("Wz");
      if (tMax > 1e-6 && !(mb.Wt! > 0)) need.push("Wt");
      if (need.length) {
        missing.push({ id: mb.id, items: need });
        warnings.push(`构件 ${mb.id} 缺截面模量 ${need.join("/")}：弯曲/扭转应力无法计算，已跳过该构件（请改用截面库，或补全 Wy/Wz/Wt）`);
        continue;
      }
    }
    const points: StressPoint[] = it.sections.map((sec) => {
      const sigma = sec.N / mb.A + Math.abs(sec.My) / (mb.Wy ?? Infinity) + Math.abs(sec.Mz) / (mb.Wz ?? Infinity);
      const tauT = Math.abs(sec.T) / (mb.Wt ?? Infinity);
      const tauV = (mb.ks ?? 0) * Math.hypot(sec.Vy, sec.Vz) / mb.A;
      const p = stressState(sigma, Math.hypot(tauT, tauV));
      return sec.side ? { ...p, tauT, tauV, x: sec.x, side: sec.side } : { ...p, tauT, tauV, x: sec.x };
    });
    let worst = 0;
    let sigmaMax = -Infinity;
    let tauMax = 0;
    let ratio = 0;
    let tauRatio = 0;
    points.forEach((p, i) => {
      if (p.mises > points[worst].mises) worst = i;
      sigmaMax = Math.max(sigmaMax, p.sigma);
      tauMax = Math.max(tauMax, p.tau);
      if (mb.sigmaAllow) ratio = Math.max(ratio, p.mises / mb.sigmaAllow);
      if (mb.tauAllow) tauRatio = Math.max(tauRatio, p.tau / mb.tauAllow);
    });
    stress.push({ id: mb.id, points, worst, sigmaMax, tauMax, ratio, tauRatio, pass: ratio <= 1 && tauRatio <= 1 });
  }
  return { stress, warnings, missing };
}

/** 强度校核条目：residual = max(σr/σallow, τ/τallow) − 1 ≤ 0 通过。 */
export function strengthCheck(stress: MemberStress[]): Check {
  let worst = stress[0];
  for (const s of stress) if (Math.max(s.ratio, s.tauRatio) > Math.max(worst.ratio, worst.tauRatio)) worst = s;
  const r = Math.max(worst.ratio, worst.tauRatio) - 1;
  return {
    name: "强度校核（第四理论）",
    pass: stress.every((s) => s.pass),
    residual: r,
    note: `最不利杆 ${worst.id}：σr=${worst.points[worst.worst].mises.toExponential(3)} Pa，利用率 ${(r + 1).toFixed(3)}（≤1 通过）`,
  };
}
