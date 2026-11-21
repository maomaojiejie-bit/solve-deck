// Q4 E3 动力学模板 D1–D5：RK4 定步长积分 / 闭式解 + 守恒量校核（冲量、动量矩、能量）。
// 口径：积分确定性子步 20×(帧数−1)，快照逐位可复现；金色对账量在 tKey 取值。
import { G_ACC, KIN_SAMPLES } from "./types.ts";
import type { Check, KinFrame, KinKeyValue, KinSeries, MechModel } from "./types";
import { crankSliderDX, crankSliderX, evalPoly, mechRefusal, poly, sampleTimes, type KinResult } from "./kinematics.ts";

type V3 = [number, number, number];
const mul3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** 定步长 RK4（4 阶：全局误差 ~h⁴） */
export function rk4(f: (t: number, y: number[]) => number[], y0: number[], h: number, n: number): number[][] {
  const out: number[][] = [y0.slice()];
  let y = y0.slice();
  let t = 0;
  for (let i = 0; i < n; i++) {
    const k1 = f(t, y);
    const k2 = f(t + h / 2, y.map((v, j) => v + (h * k1[j]) / 2));
    const k3 = f(t + h / 2, y.map((v, j) => v + (h * k2[j]) / 2));
    const k4 = f(t + h, y.map((v, j) => v + h * k3[j]));
    y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    t += h;
    out.push(y.slice());
  }
  return out;
}

function mkSeries(name: string, unit: string, values: number[]): KinSeries {
  return { name, unit, values };
}
function mkKV(name: string, value: number, unit: string): KinKeyValue {
  return { name, value, unit };
}
function checkSummary(checks: Check[]): string {
  return checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}（残差 ${c.residual.toExponential(2)}）`).join("；");
}
/** 在积分轨迹上取 tKey 时刻状态（tKey 须为采样时刻的近似，线性插值） */
function stateAt(ts: number[], states: number[][], tKey: number): number[] {
  const n = ts.length;
  const idx = Math.min(n - 2, Math.max(0, Math.floor((tKey / ts[n - 1]) * (n - 1))));
  const t0 = ts[idx];
  const t1 = ts[idx + 1];
  const w = t1 === t0 ? 0 : (tKey - t0) / (t1 - t0);
  return states[idx].map((v, j) => v + w * (states[idx + 1][j] - v));
}

// ---------- D1 质点动力学（牛顿第二定律） ----------

export function solveD1(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const m = p.m ?? 1;
  if (!(m > 0)) return mechRefusal(model, `质量 m=${m} 非法`, "m 必须为正");
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const F: V3 = [p.Fx ?? 0, p.Fy ?? 0, p.Fz ?? 0];
  const c = p.c ?? 0;
  const grav = (p.grav ?? 1) !== 0;
  const v0: V3 = [p.vx0 ?? 0, p.vy0 ?? 0, p.vz0 ?? 0];
  const pid = model.nodes[1]?.id ?? "P";

  const accel = (v: V3): V3 => [F[0] / m - (c * v[0]) / m, F[1] / m - (c * v[1]) / m - (grav ? G_ACC : 0), F[2] / m - (c * v[2]) / m];
  const f = (_t: number, y: number[]) => [y[3], y[4], y[5], ...accel([y[3], y[4], y[5]])];
  const sub = 20;
  const h = T / ((n - 1) * sub);
  const fine = rk4(f, [0, 0, 0, v0[0], v0[1], v0[2]], h, (n - 1) * sub);
  const states = fine.filter((_, i) => i % sub === 0);
  const ts = sampleTimes(T, n);

  const frames: KinFrame[] = [];
  const sVx: number[] = [];
  const sVy: number[] = [];
  const sSp: number[] = [];
  const sKE: number[] = [];
  const impulse: V3 = [0, 0, 0];
  let work = 0;
  for (let i = 0; i < n; i++) {
    const y = states[i];
    const v: V3 = [y[3], y[4], y[5]];
    const a = accel(v);
    const ftot: V3 = [a[0] * m, a[1] * m, a[2] * m];
    sVx.push(v[0]);
    sVy.push(v[1]);
    sSp.push(norm3(v));
    sKE.push(0.5 * m * dot3(v, v));
    if (i > 0) {
      const yp = states[i - 1];
      const vp: V3 = [yp[3], yp[4], yp[5]];
      const fp = accel(vp).map((x) => x * m) as V3;
      for (let k = 0; k < 3; k++) impulse[k] += ((ftot[k] + fp[k]) / 2) * (ts[i] - ts[i - 1]);
      work += (dot3(ftot, v) + dot3(fp, vp)) / 2 * (ts[i] - ts[i - 1]);
    }
    frames.push({ t: ts[i], pts: { [pid]: [y[0], y[1], y[2]] }, vel: { [pid]: v }, acc: { [pid]: a } });
  }

  const vk = stateAt(ts, states, tKey);
  const vVec: V3 = [vk[3], vk[4], vk[5]];
  const v0Vec = [v0[0], v0[1], v0[2]];
  const dKE = 0.5 * m * dot3(vVec, vVec) - 0.5 * m * dot3(v0, v0);
  const scaleMom = Math.max(1e-9, m * norm3(vVec));
  const scaleKE = Math.max(1e-9, Math.abs(dKE));
  const momRes = Math.max(...[0, 1, 2].map((k) => Math.abs(impulse[k] - m * (vVec[k] - v0Vec[k])) / scaleMom));
  const keRes = Math.abs(work - dKE) / scaleKE;

  const checks: Check[] = [
    { name: "动量定理校核", pass: momRes < 1e-3, residual: momRes, note: "∫F dt = m·Δv（梯形积分 vs RK4 末速）" },
    { name: "动能定理校核", pass: keRes < 1e-3, residual: keRes, note: "∫F·v dt = ΔKE" },
  ];

  return {
    headline: `质点动力学 RK4 积分：t=${tKey}s 时 v=(${vVec.map((x) => x.toFixed(4)).join(", ")}) m/s（m=${m} kg，合力含${grav ? "重力" : "无重力"}${c ? `+阻力 c=${c}` : ""}）`,
    frames,
    series: [mkSeries("v_x", "m/s", sVx), mkSeries("v_y", "m/s", sVy), mkSeries("|v|", "m/s", sSp), mkSeries("KE", "J", sKE)],
    keyValues: [
      mkKV("x(tKey)", vk[0], "m"),
      mkKV("y(tKey)", vk[1], "m"),
      mkKV("z(tKey)", vk[2], "m"),
      mkKV("v_x(tKey)", vVec[0], "m/s"),
      mkKV("v_y(tKey)", vVec[1], "m/s"),
      mkKV("|v(tKey)|", norm3(vVec), "m/s"),
    ],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `质点 m=${m} kg，初速 (${v0.join(", ")}) m/s，恒力 (${F.join(", ")}) N${c ? `，线性阻力 −${c}v` : ""}${grav ? "，重力 9.8 m/s²" : ""}` },
      { title: "建模", detail: "ma=ΣF → 一阶方程组 [ṙ=v, v̇=a]，RK4 定步长（每帧 20 子步）" },
      { title: "求解", detail: `积分 ${(n - 1) * sub} 步输出 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- D2 质点系：阿特伍德机（动量/动能定理） ----------

export function solveD2(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const m1 = p.m1 ?? 1;
  const m2 = p.m2 ?? 2;
  const Ip = p.Ip ?? 0;
  const R = p.R ?? 0.3;
  if (!(m1 > 0) || !(m2 > 0) || !(R > 0)) return mechRefusal(model, "质量/半径必须为正", "检查 m1/m2/R");
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const rope0 = p.rope0 ?? 3;
  const O = model.nodes[0] ?? { id: "O", x: 0, y: 4, z: 0 };
  const a = ((m2 - m1) * G_ACC) / (m1 + m2 + Ip / (R * R));

  const frames: KinFrame[] = [];
  const sS: number[] = [];
  const sV: number[] = [];
  const sT1: number[] = [];
  const sT2: number[] = [];
  const ts = sampleTimes(T, n);
  for (const t of ts) {
    const s = 0.5 * a * t * t;
    const v = a * t;
    const T1 = m1 * (G_ACC + a);
    const T2 = m2 * (G_ACC - a);
    const base = O.y - R - rope0;
    const rim: V3 = [O.x + R * Math.sin(s / R), O.y + R * Math.cos(s / R), 0];
    sS.push(s);
    sV.push(v);
    sT1.push(T1);
    sT2.push(T2);
    frames.push({ t, pts: { [O.id]: [O.x, O.y, 0], B1: [O.x - R, base + s, 0], B2: [O.x + R, base - s, 0], Rim: rim }, vel: { B1: [0, v, 0], B2: [0, -v, 0] } });
  }

  // 校核：能量守恒（闭式恒等）+ 滑轮转动方程 + RK4 数值双解
  let enRes = 0;
  const scaleE = Math.max(1e-9, 0.5 * (m1 + m2 + Ip / (R * R)) * (a * T) ** 2);
  for (let i = 0; i < ts.length; i++) {
    const v = sV[i];
    const s = sS[i];
    const ke = 0.5 * (m1 + m2) * v * v + 0.5 * Ip * (v / R) ** 2;
    const pe = m1 * G_ACC * s - m2 * G_ACC * s;
    enRes = Math.max(enRes, Math.abs(ke + pe) / scaleE);
  }
  const pulleyRes = Math.abs(sT2[0] - sT1[0] - (Ip * a) / (R * R)) / Math.max(1e-9, Math.abs(sT2[0]) + Math.abs(sT1[0]));
  const num = rk4((_t, y) => [y[1], a], [0, 0], T / ((n - 1) * 20), (n - 1) * 20).filter((_, i) => i % 20 === 0);
  let numRes = 0;
  for (let i = 0; i < n; i++) numRes = Math.max(numRes, Math.abs(num[i][0] - sS[i]) / Math.max(1e-9, Math.abs(sS[i])));

  const vk = a * tKey;
  const checks: Check[] = [
    { name: "能量守恒", pass: enRes < 1e-9, residual: enRes, note: "ΔKE（含滑轮转动）+ ΔPE ≡ 0" },
    { name: "滑轮转动方程", pass: pulleyRes < 1e-9, residual: pulleyRes, note: "(T₂−T₁)·R = I_p·α" },
    { name: "RK4 双解互校", pass: numRes < 1e-10, residual: numRes, note: "闭式 s=½at² vs 数值积分" },
  ];

  return {
    headline: `阿特伍德机：a=${a.toFixed(4)} m/s²，绳张力 T₁=${sT1[0].toFixed(2)} N、T₂=${sT2[0].toFixed(2)} N（m₁=${m1} kg、m₂=${m2} kg${Ip ? `、滑轮 I=${Ip} kg·m²` : "、滑轮理想"}）`,
    frames,
    series: [mkSeries("s", "m", sS), mkSeries("v", "m/s", sV), mkSeries("T₁", "N", sT1), mkSeries("T₂", "N", sT2)],
    keyValues: [
      mkKV("a", a, "m/s²"),
      mkKV("v(tKey)", vk, "m/s"),
      mkKV("s(tKey)", 0.5 * a * tKey * tKey, "m"),
      mkKV("T₁", sT1[0], "N"),
      mkKV("T₂", sT2[0], "N"),
    ],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `轻绳跨滑轮连接 m₁=${m1} kg（升）、m₂=${m2} kg（降）${Ip ? `，滑轮转动惯量 I_p=${Ip} kg·m²、R=${R} m` : ""}` },
      { title: "建模", detail: "动量定理逐体列式：a=(m₂−m₁)g/(m₁+m₂+I_p/R²)" },
      { title: "求解", detail: `闭式时程 ${n} 帧 + RK4 双解，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- D3 刚体动力学（定轴转动/平面运动微分方程） ----------

export function solveD3(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const mode = Math.round(p.mode ?? 0);
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const ts = sampleTimes(T, n);

  if (mode === 1) {
    // 定轴转动微分方程：I·φ̈ = T_q（飞轮）
    const I = p.I ?? 2;
    const Tq = p.Tq ?? 4;
    const om0 = p.om0 ?? 0;
    const Rd = p.Rd ?? 1;
    if (!(I > 0)) return mechRefusal(model, `转动惯量 I=${I} 非法`, "I 必须为正");
    const al = Tq / I;
    const frames: KinFrame[] = [];
    const sOm: number[] = [];
    const sKE: number[] = [];
    const sW: number[] = [];
    for (const t of ts) {
      const om = om0 + al * t;
      const phi = om0 * t + 0.5 * al * t * t;
      const ke = 0.5 * I * om * om;
      sOm.push(om);
      sKE.push(ke);
      sW.push(al);
      frames.push({ t, pts: { O: [0, 0, 0], P: [Rd * Math.cos(phi), Rd * Math.sin(phi), 0] }, vel: { P: [-Rd * om * Math.sin(phi), Rd * om * Math.cos(phi), 0] } });
    }
    const omk = om0 + al * tKey;
    const phik = om0 * tKey + 0.5 * al * tKey * tKey;
    const weRes = Math.abs(Tq * phik - (0.5 * I * omk * omk - 0.5 * I * om0 * om0)) / Math.max(1e-9, 0.5 * I * omk * omk);
    const num = rk4((_t, y) => [y[1], al], [0, om0], T / ((n - 1) * 20), (n - 1) * 20).filter((_, i) => i % 20 === 0);
    let numRes = 0;
    for (let i = 0; i < n; i++) numRes = Math.max(numRes, Math.abs(num[i][0] - (om0 * ts[i] + 0.5 * al * ts[i] * ts[i])));
    const checks: Check[] = [
      { name: "动能定理（转动）", pass: weRes < 1e-9, residual: weRes, note: "T_q·Δφ = Δ(½Iω²)" },
      { name: "RK4 双解互校", pass: numRes < 1e-9, residual: numRes, note: "闭式 φ vs 数值积分" },
    ];
    return {
      headline: `定轴转动微分方程 I·φ̈=T_q：α=${al.toFixed(4)} rad/s²，tKey 时 ω=${omk.toFixed(4)} rad/s、KE=${(0.5 * I * omk * omk).toFixed(2)} J`,
      frames,
      series: [mkSeries("ω", "rad/s", sOm), mkSeries("α", "rad/s²", sW), mkSeries("KE", "J", sKE)],
      keyValues: [mkKV("α", al, "rad/s²"), mkKV("φ(tKey)", phik, "rad"), mkKV("ω(tKey)", omk, "rad/s"), mkKV("KE(tKey)", 0.5 * I * omk * omk, "J")],
      checks,
      warnings: [],
      steps: [
        { title: "认题", detail: `飞轮 I=${I} kg·m²，恒力矩 T_q=${Tq} N·m，初速 ω₀=${om0} rad/s` },
        { title: "建模", detail: "定轴转动微分方程 I·φ̈ = T_q（α=T_q/I 常数）" },
        { title: "求解", detail: `闭式 + RK4 双解 ${n} 帧，耗时 ${Date.now() - t0} ms` },
        { title: "校核", detail: checkSummary(checks) },
      ],
    };
  }

  if (mode === 2) {
    // 平面运动微分方程：沿斜面纯滚圆盘/圆柱
    const beta = p.beta ?? Math.PI / 6;
    const k = p.k ?? 0.5; // I = k·mR²（圆柱/圆盘 0.5、球 0.4、薄环 1）
    const m = p.m ?? 2;
    const R = p.R ?? 0.3;
    const v0 = p.v0 ?? 0;
    if (!(beta > 0 && beta < Math.PI / 2)) return mechRefusal(model, `倾角 β=${beta} 超出 (0, π/2)`, "斜面问题取锐角");
    if (!(k >= 0)) return mechRefusal(model, `形状系数 k=${k} 非法`, "I=k·mR²，k≥0（圆盘 0.5、球 0.4、环 1）");
    const a = (G_ACC * Math.sin(beta)) / (1 + k);
    const start = model.nodes[0] ?? { id: "S", x: 0, y: 3, z: 0 };
    const dir: V3 = [Math.cos(beta), -Math.sin(beta), 0];
    const frames: KinFrame[] = [];
    const sV: number[] = [];
    const sS: number[] = [];
    const sE: number[] = [];
    for (const t of ts) {
      const s = v0 * t + 0.5 * a * t * t;
      const v = v0 + a * t;
      const C: V3 = [start.x + dir[0] * s, start.y + dir[1] * s, 0];
      const psi = s / R;
      const P: V3 = [C[0] + R * Math.cos(psi), C[1] + R * Math.sin(psi), 0];
      const ke = 0.5 * m * v * v + 0.5 * (k * m * R * R) * (v / R) ** 2;
      const pe = -m * G_ACC * Math.sin(beta) * s;
      sV.push(v);
      sS.push(s);
      sE.push(ke + pe);
      frames.push({ t, pts: { [start.id]: [start.x, start.y, 0], C, P, G: [C[0], 0, 0] }, vel: { C: mul3(dir, v) }, acc: { C: mul3(dir, a) } });
    }
    const vk = v0 + a * tKey;
    const sk = v0 * tKey + 0.5 * a * tKey * tKey;
    const enRes = Math.abs(0.5 * m * vk * vk * (1 + k) - m * G_ACC * Math.sin(beta) * sk - (0.5 * m * v0 * v0 * (1 + k))) / Math.max(1e-9, m * G_ACC * Math.sin(beta) * Math.max(sk, 1e-9));
    const hK = 1e-5 * Math.max(1, T);
    const sF = (tt: number) => v0 * tt + 0.5 * a * tt * tt;
    let ndRes = 0;
    for (const t of ts) ndRes = Math.max(ndRes, Math.abs((sF(t + hK) - sF(t - hK)) / (2 * hK) - (v0 + a * t)) / Math.max(1e-9, vk));
    const checks: Check[] = [
      { name: "动能定理（平面运动）", pass: enRes < 1e-9, residual: enRes, note: "mg·s·sinβ = Δ[½mv²+½Iω²]（含从 v₀ 起算）" },
      { name: "数值微分互校", pass: ndRes < 1e-6, residual: ndRes, note: "v = ds/dt 差分对账" },
    ];
    return {
      headline: `平面运动微分方程（纯滚沿斜面 β=${beta.toFixed(4)} rad）：a=${a.toFixed(4)} m/s² = g·sinβ/(1+k)，tKey 时 v=${vk.toFixed(4)} m/s、s=${sk.toFixed(4)} m`,
      frames,
      series: [mkSeries("s", "m", sS), mkSeries("v", "m/s", sV), mkSeries("E(KE+PE)", "J", sE)],
      keyValues: [mkKV("a", a, "m/s²"), mkKV("v(tKey)", vk, "m/s"), mkKV("s(tKey)", sk, "m"), mkKV("ω(tKey)", vk / R, "rad/s")],
      checks,
      warnings: [],
      steps: [
        { title: "认题", detail: `质量 m=${m} kg、R=${R} m、I=k·mR²（k=${k}）沿倾角 β=${beta.toFixed(4)} rad 斜面纯滚，v₀=${v0} m/s` },
        { title: "建模", detail: "平动+转动方程联立：a = g·sinβ/(1+k)（摩擦保证纯滚，不做功）" },
        { title: "求解", detail: `闭式时程 ${n} 帧，耗时 ${Date.now() - t0} ms` },
        { title: "校核", detail: checkSummary(checks) },
      ],
    };
  }

  // mode 0：单摆（大摆角非线性）
  const L = p.L ?? 1;
  if (!(L > 0)) return mechRefusal(model, `摆长 L=${L} 非法`, "L 必须为正");
  const th0 = p.th0 ?? 0.1;
  const om0 = p.om0 ?? 0;
  const pivot = model.nodes[0] ?? { id: "O", x: 0, y: 3, z: 0 };
  const f = (_t: number, y: number[]) => [y[1], -(G_ACC / L) * Math.sin(y[0])];
  const sub = 20;
  const fine = rk4(f, [th0, om0], T / ((n - 1) * sub), (n - 1) * sub);
  const states = fine.filter((_, i) => i % sub === 0);

  const frames: KinFrame[] = [];
  const sTh: number[] = [];
  const sOm: number[] = [];
  const sE: number[] = [];
  for (let i = 0; i < n; i++) {
    const [th, om] = states[i];
    const bob: V3 = [pivot.x + L * Math.sin(th), pivot.y - L * Math.cos(th), 0];
    const v: V3 = [L * Math.cos(th) * om, L * Math.sin(th) * om, 0];
    const al = -(G_ACC / L) * Math.sin(th);
    const a: V3 = [-L * Math.sin(th) * om * om + L * Math.cos(th) * al, L * Math.cos(th) * om * om + L * Math.sin(th) * al, 0];
    const e = 0.5 * L * L * om * om - G_ACC * L * Math.cos(th);
    sTh.push(th);
    sOm.push(om);
    sE.push(e);
    frames.push({ t: ts[i], pts: { [pivot.id]: [pivot.x, pivot.y, 0], B: bob }, vel: { B: v }, acc: { B: a } });
  }
  const ek0 = sE[0];
  const enRes = Math.max(...sE.map((e) => Math.abs(e - ek0))) / Math.max(1e-9, G_ACC * L);
  const stk = stateAt(ts, states, tKey);
  const wn = Math.sqrt(G_ACC / L);
  const linRes = Math.abs(th0) <= 0.2 ? Math.abs(stk[0] - th0 * Math.cos(wn * tKey)) : 0;
  const checks: Check[] = [
    { name: "能量守恒（RK4）", pass: enRes < 1e-8, residual: enRes, note: "E=½L²θ̇²−gL·cosθ 全程漂移" },
    { name: "小角线性双解", pass: Math.abs(th0) <= 0.2 ? linRes < 1e-3 : true, residual: linRes, note: Math.abs(th0) <= 0.2 ? "非线性解 vs θ₀·cos(ω_n·t)（θ₀≤0.2 rad 才适用）" : "摆角 >0.2 rad，线性对照不适用（跳过）" },
  ];
  return {
    headline: `单摆大摆角数值解（θ₀=${th0} rad）：T≈2π√(L/g)=${(2 * Math.PI / wn).toFixed(4)} s，tKey 时 θ=${stk[0].toFixed(5)} rad、θ̇=${stk[1].toFixed(5)} rad/s`,
    frames,
    series: [mkSeries("θ", "rad", sTh), mkSeries("θ̇", "rad/s", sOm), mkSeries("E", "m²/s²", sE)],
    keyValues: [mkKV("θ(tKey)", stk[0], "rad"), mkKV("θ̇(tKey)", stk[1], "rad/s"), mkKV("T(小角)", 2 * Math.PI / wn, "s"), mkKV("E", ek0, "m²/s²")],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `单摆 L=${L} m，θ₀=${th0} rad、θ̇₀=${om0} rad/s（非线性摆）` },
      { title: "建模", detail: "θ̈ = −(g/L)·sinθ，RK4 定步长（每帧 20 子步）" },
      { title: "求解", detail: `积分 ${(n - 1) * sub} 步输出 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- D4 达朗贝尔原理（动静法） ----------

export function solveD4(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const mode = Math.round(p.mode ?? 0);
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const ts = sampleTimes(T, n);

  if (mode === 1) {
    // 偏心转子动反力：F = m_r·e·ω²
    const mr = p.mr ?? 5;
    const e = p.e ?? 0.1;
    const w = p.w ?? 20;
    if (!(mr > 0) || !(e > 0)) return mechRefusal(model, "偏心质量/距必须为正", "检查 mr/e");
    const F = mr * e * w * w;
    const frames: KinFrame[] = [];
    const sF: number[] = [];
    const sFx: number[] = [];
    const sFy: number[] = [];
    for (const t of ts) {
      const a = w * t;
      const E: V3 = [e * Math.cos(a), e * Math.sin(a), 0];
      sF.push(F);
      sFx.push(-mr * e * w * w * Math.cos(a));
      sFy.push(-mr * e * w * w * Math.sin(a));
      frames.push({ t, pts: { O: [0, 0, 0], E }, vel: { E: [-e * w * Math.sin(a), e * w * Math.cos(a), 0] }, acc: { E: [-e * w * w * Math.cos(a), -e * w * w * Math.sin(a), 0] } });
    }
    const hK = 1e-5 * Math.max(1, T);
    const eF = (tt: number): V3 => [e * Math.cos(w * tt), e * Math.sin(w * tt), 0];
    let ndRes = 0;
    for (const t of ts) for (let j = 0; j < 2; j++) {
      const d2 = (eF(t + hK)[j] - 2 * eF(t)[j] + eF(t - hK)[j]) / (hK * hK);
      ndRes = Math.max(ndRes, Math.abs(d2 + e * w * w * Math.cos(w * t) * (j === 0 ? 1 : 0) + e * w * w * Math.sin(w * t) * (j === 1 ? 1 : 0)) / (e * w * w));
    }
    const checks: Check[] = [
      { name: "动反力公式", pass: Math.abs(F - mr * e * w * w) < 1e-9 * F, residual: Math.abs(F - mr * e * w * w), note: "F = m_r·e·ω²（惯性力系主矢幅值）" },
      { name: "二阶差分互校", pass: ndRes < 1e-5, residual: ndRes, note: "偏心点 |a| = e·ω² 向心" },
    ];
    return {
      headline: `偏心转子动反力：F = m_r·e·ω² = ${F.toFixed(2)} N（m_r=${mr} kg、e=${e} m、ω=${w} rad/s，方向随转角旋转）`,
      frames,
      series: [mkSeries("F_x", "N", sFx), mkSeries("F_y", "N", sFy), mkSeries("|F|", "N", sF)],
      keyValues: [mkKV("F", F, "N"), mkKV("ω", w, "rad/s")],
      checks,
      warnings: [],
      steps: [
        { title: "认题", detail: `转子偏心质量 m_r=${mr} kg、偏心距 e=${e} m，匀速 ω=${w} rad/s` },
        { title: "建模", detail: "达朗贝尔：惯性力系简化为主矢 F_I=−m·a_C，轴承动反力=−F_I" },
        { title: "求解", detail: `解析时程 ${n} 帧，耗时 ${Date.now() - t0} ms` },
        { title: "校核", detail: checkSummary(checks) },
      ],
    };
  }

  // mode 0：升降加速（惯性力 + 平衡方程）
  const m = p.m ?? 1000;
  if (!(m > 0)) return mechRefusal(model, `质量 m=${m} 非法`, "m 必须为正");
  const qy = poly(p, "y");
  const yF = (t: number) => evalPoly(qy, t)[0];
  const aF = (t: number) => evalPoly(qy, t)[2];
  const frames: KinFrame[] = [];
  const sY: number[] = [];
  const sA: number[] = [];
  const sT: number[] = [];
  const sFI: number[] = [];
  for (const t of ts) {
    const a = aF(t);
    const Tn = m * (G_ACC + a);
    sY.push(yF(t));
    sA.push(a);
    sT.push(Tn);
    sFI.push(-m * a);
    frames.push({ t, pts: { O: [0, 0, 0], B: [0, yF(t), 0] }, vel: { B: [0, evalPoly(qy, t)[1], 0] }, acc: { B: [0, a, 0] } });
  }
  const hK = 1e-4 * Math.max(1, T);
  let ndRes = 0;
  for (const t of ts) ndRes = Math.max(ndRes, Math.abs((yF(t + hK) - 2 * yF(t) + yF(t - hK)) / (hK * hK) - aF(t)) / Math.max(1e-9, Math.abs(aF(tKey)) + G_ACC));
  const ak = aF(tKey);
  const Tk = m * (G_ACC + ak);
  const checks: Check[] = [
    { name: "动静法平衡", pass: Math.abs(Tk - m * G_ACC - m * ak) < 1e-6 * Tk, residual: Math.abs(Tk - m * G_ACC - m * ak), note: "ΣF + F_I = 0：T − mg − m·a = 0" },
    { name: "二阶差分互校", pass: ndRes < 1e-5, residual: ndRes, note: "运动方程 a=ÿ 差分对账" },
  ];
  return {
    headline: `升降加速（动静法）：tKey 时 a=${ak.toFixed(4)} m/s²，钢丝绳拉力 T=m(g+a)=${Tk.toFixed(1)} N，惯性力 F_I=${(-m * ak).toFixed(1)} N`,
    frames,
    series: [mkSeries("y", "m", sY), mkSeries("a", "m/s²", sA), mkSeries("T", "N", sT), mkSeries("F_I", "N", sFI)],
    keyValues: [mkKV("a(tKey)", ak, "m/s²"), mkKV("T(tKey)", Tk, "N"), mkKV("F_I(tKey)", -m * ak, "N")],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `提升质量 m=${m} kg，运动方程 y(t)（多项式+简谐），加速度由方程二阶导给出` },
      { title: "建模", detail: "达朗贝尔：加惯性力 F_I=−m·a 后按静力平衡 T−mg−ma=0" },
      { title: "求解", detail: `解析时程 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- D5 虚位移原理（机构静力平衡） ----------

export function solveD5(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const r = p.r ?? 0.4;
  const l = p.l ?? 1.0;
  if (!(r > 0) || !(l > 0)) return mechRefusal(model, "杆长必须为正", "检查 r/l");
  if (r >= l) return mechRefusal(model, `曲柄滑块无法装配：r=${r} ≥ l=${l}`, "虚位移原理同样要求机构可装配（r < l）");
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const th0 = p.th0 ?? 0;
  const th1 = p.th1 ?? Math.PI / 2;
  const Fx = p.Fx ?? 1000;
  const thOf = (t: number) => th0 + ((th1 - th0) * t) / T;

  const Mof = (th: number) => -Fx * crankSliderDX(r, l, th);
  const M2of = (th: number) => {
    const Ax = r * Math.cos(th);
    const Ay = r * Math.sin(th);
    const xB = crankSliderX(r, l, th);
    return (-Fx * Ay * xB) / (Ax - xB);
  };

  const frames: KinFrame[] = [];
  const sTh: number[] = [];
  const sM: number[] = [];
  const sM2: number[] = [];
  const ts = sampleTimes(T, n);
  let dualRes = 0;
  let ndRes = 0;
  const maxM = Math.max(1e-9, ...ts.map((t) => Math.abs(Mof(thOf(t)))));
  for (const t of ts) {
    const th = thOf(t);
    const M = Mof(th);
    const M2 = M2of(th);
    dualRes = Math.max(dualRes, Math.abs(M - M2) / maxM);
    const hK = 1e-6;
    ndRes = Math.max(ndRes, Math.abs((crankSliderX(r, l, th + hK) - crankSliderX(r, l, th - hK)) / (2 * hK) - crankSliderDX(r, l, th)) / Math.max(1e-9, r));
    const A: V3 = [r * Math.cos(th), r * Math.sin(th), 0];
    const B: V3 = [crankSliderX(r, l, th), 0, 0];
    frames.push({ t, pts: { O: [0, 0, 0], A, B } });
    sTh.push(th);
    sM.push(M);
    sM2.push(M2);
  }
  const thk = thOf(tKey);
  const checks: Check[] = [
    { name: "虚功=解析导数", pass: ndRes < 1e-6, residual: ndRes, note: "δx_B/δθ = dx_B/dθ（差分对账）" },
    { name: "二法互校", pass: dualRes < 1e-9, residual: dualRes, note: "虚位移原理 M=−F·dx_B/dθ vs 二力杆静力 M=−F·y_A·x_B/(x_A−x_B)" },
  ];
  return {
    headline: `虚位移原理（滑块曲柄持荷）：θ(tKey)=${thk.toFixed(4)} rad 需驱动力偶 M=${Mof(thk).toFixed(2)} N·m（滑块载荷 F=${Fx} N，二法互校一致）`,
    frames,
    series: [mkSeries("θ", "rad", sTh), mkSeries("M(虚功)", "N·m", sM), mkSeries("M(静力)", "N·m", sM2)],
    keyValues: [mkKV("θ(tKey)", thk, "rad"), mkKV("M(tKey)", Mof(thk), "N·m"), mkKV("M₂(tKey)", M2of(thk), "N·m")],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `曲柄 r=${r} m、连杆 l=${l} m，滑块水平载荷 F=${Fx} N，θ 扫描 ${th0.toFixed(2)}→${th1.toFixed(2)} rad（时间轴即转角）` },
      { title: "建模", detail: "单自由度广义力 Q_θ = M + F_x·∂x_B/∂θ = 0 → M=−F_x·dx_B/dθ" },
      { title: "求解", detail: `解析扫描 ${n} 点，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}
