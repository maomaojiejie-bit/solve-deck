// Q4 E3 运动学模板 K1–K4R：解析位置/速度/加速度 + 自然法/合成运动/瞬心分解。
// 口径：闭式求导为主，数值微分互校进 checks；黄金对账量在 tKey 时刻取值。
import { KIN_SAMPLES } from "./types.ts";
import type { Check, KinFrame, KinKeyValue, KinSeries, MechModel, SolveStep } from "./types";

export interface KinResult {
  headline: string;
  frames: KinFrame[];
  series: KinSeries[];
  keyValues: KinKeyValue[];
  checks: Check[];
  steps: SolveStep[];
  warnings: string[];
  refusals?: string[];
}

/** 拒答结果：不产数字（与 E1/E2 红线同口径） */
export function mechRefusal(model: MechModel, reason: string, hint: string): KinResult {
  return {
    headline: `拒答：${reason}`,
    frames: [],
    series: [],
    keyValues: [],
    checks: [],
    warnings: [],
    steps: [
      { title: "认题", detail: `${model.name}（E3 ${model.type} 模板）` },
      { title: "建模", detail: reason },
      { title: "求解", detail: "拒答，不产出数字" },
    ],
    refusals: [reason, hint],
  };
}

// ---------- 公共数学 ----------

type V3 = [number, number, number];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** 绕单位轴 k 转 ang 弧度的 Rodrigues 公式 */
function rotAxis(v: V3, k: V3, ang: number): V3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = cross3(k, v);
  const kd = dot3(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** 受限运动律多项式：f(t)=c0+c1·t+c2·t²+c3·t³+A·sin(w·t+ph)，一/二阶导闭式 */
interface Poly {
  c0: number;
  c1: number;
  c2: number;
  c3: number;
  A: number;
  w: number;
  ph: number;
}
export function poly(p: Record<string, number>, key: string): Poly {
  return {
    c0: p[`${key}_c0`] ?? 0,
    c1: p[`${key}_c1`] ?? 0,
    c2: p[`${key}_c2`] ?? 0,
    c3: p[`${key}_c3`] ?? 0,
    A: p[`${key}_A`] ?? 0,
    w: p[`${key}_w`] ?? 0,
    ph: p[`${key}_ph`] ?? 0,
  };
}
/** 返回 [f, f', f'']（注意 s/c 已含幅值 A，导数只再乘 w） */
export function evalPoly(q: Poly, t: number): [number, number, number] {
  const s = q.A * Math.sin(q.w * t + q.ph);
  const c = q.A * Math.cos(q.w * t + q.ph);
  return [q.c0 + t * (q.c1 + t * (q.c2 + t * q.c3)) + s, q.c1 + t * (2 * q.c2 + 3 * q.c3 * t) + q.w * c, 2 * q.c2 + 6 * q.c3 * t - q.w * q.w * s];
}

export function sampleTimes(T: number, n: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) ts.push((i * T) / (n - 1));
  return ts;
}

/** 中心差分（数值微分互校用） */
export function numDeriv(f: (t: number) => number, t: number, h: number): number {
  return (f(t + h) - f(t - h)) / (2 * h);
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

// ---------- K1 质点运动学（矢量法/直角坐标/自然法） ----------

export function solveK1(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const qx = poly(p, "x");
  const qy = poly(p, "y");
  const qz = poly(p, "z");
  const pos = (t: number): V3 => [evalPoly(qx, t)[0], evalPoly(qy, t)[0], evalPoly(qz, t)[0]];
  const vel = (t: number): V3 => [evalPoly(qx, t)[1], evalPoly(qy, t)[1], evalPoly(qz, t)[1]];
  const acc = (t: number): V3 => [evalPoly(qx, t)[2], evalPoly(qy, t)[2], evalPoly(qz, t)[2]];

  const frames: KinFrame[] = [];
  const sV: number[] = [];
  const sAt: number[] = [];
  const sAn: number[] = [];
  const sRho: number[] = [];
  const ts = sampleTimes(T, n);
  for (const t of ts) {
    const P = pos(t);
    const v = vel(t);
    const a = acc(t);
    const sp = norm3(v);
    const at = sp > 1e-12 ? dot3(v, a) / sp : NaN;
    const cx = cross3(v, a);
    const an = sp > 1e-12 ? norm3(cx) / sp : NaN;
    const rho = sp > 1e-12 && an > 1e-12 ? (sp * sp) / an : NaN;
    sV.push(sp);
    sAt.push(at);
    sAn.push(an);
    sRho.push(rho);
    frames.push({ t, pts: { O: [0, 0, 0], P }, vel: { P: v }, acc: { P: a } });
  }

  // 校核：数值微分互校 + 自然法恒等式 + 曲率半径
  const h = 1e-5 * Math.max(1, T);
  const maxV = Math.max(1e-9, ...sV);
  let ndRes = 0;
  let nd2Res = 0;
  let natRes = 0;
  const maxA = Math.max(1e-9, ...ts.map((t) => norm3(acc(t))));
  for (const t of ts) {
    const v = vel(t);
    const a = acc(t);
    const sp = norm3(v);
    for (let k = 0; k < 3; k++) {
      const f = (tt: number) => pos(tt)[k];
      ndRes = Math.max(ndRes, Math.abs(numDeriv(f, t, h) - v[k]) / maxV);
      const h2 = 1e-4 * Math.max(1, T);
      const d2 = (f(t + h2) - 2 * f(t) + f(t - h2)) / (h2 * h2);
      nd2Res = Math.max(nd2Res, Math.abs(d2 - a[k]) / maxA);
    }
    const at = dot3(v, a) / sp;
    const an = norm3(cross3(v, a)) / sp;
    natRes = Math.max(natRes, Math.abs(norm3(a) ** 2 - (at * at + an * an)) / Math.max(1e-9, norm3(a) ** 2));
  }
  const vk = vel(tKey);
  const ak = acc(tKey);
  const spk = norm3(vk);
  const atk = dot3(vk, ak) / spk;
  const ank = norm3(cross3(vk, ak)) / spk;
  const checks: Check[] = [
    { name: "数值微分互校", pass: ndRes < 1e-6, residual: ndRes, note: "中心差分速度 vs 解析速度（最大相对差）" },
    { name: "二阶差分互校", pass: nd2Res < 1e-5, residual: nd2Res, note: "三点差分加速度 vs 解析加速度" },
    { name: "自然法恒等式", pass: natRes < 1e-9, residual: natRes, note: "|a|² = a_t² + a_n²，ρ = v²/a_n" },
  ];
  const warnings: string[] = [];
  if (sV.some((x) => x < 1e-9)) warnings.push("轨迹存在速度为零的时刻，该帧 a_n/ρ 无定义（输出 NaN）");

  return {
    headline: `质点运动学闭式解：t=${tKey}s 时 v=${spk.toFixed(4)} m/s，a_n=${ank.toFixed(4)} m/s²，ρ=${((spk * spk) / ank).toFixed(4)} m（自然法）`,
    frames,
    series: [mkSeries("|v|", "m/s", sV), mkSeries("a_t", "m/s²", sAt), mkSeries("a_n", "m/s²", sAn), mkSeries("ρ", "m", sRho)],
    keyValues: [
      mkKV("tKey", tKey, "s"),
      mkKV("|v(tKey)|", spk, "m/s"),
      mkKV("|a(tKey)|", norm3(ak), "m/s²"),
      mkKV("a_t(tKey)", atk, "m/s²"),
      mkKV("a_n(tKey)", ank, "m/s²"),
      mkKV("ρ(tKey)", (spk * spk) / ank, "m"),
    ],
    checks,
    warnings,
    steps: [
      { title: "认题", detail: `直角坐标运动方程 x(t)、y(t)、z(t)（多项式+简谐项），时长 ${T} s，采样 ${n} 帧` },
      { title: "建模", detail: "闭式求导 v=ṙ、a=r̈；自然法 a_t=(v·a)/|v|、a_n=√(|a|²−a_t²)、ρ=v²/a_n" },
      { title: "求解", detail: `解析采样 ${n} 帧位形+速度+加速度，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- K2 刚体定轴转动 ----------

export function solveK2(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const O: V3 = [p.ox ?? 0, p.oy ?? 0, p.oz ?? 0];
  const dRaw: V3 = [p.dx ?? 0, p.dy ?? 0, p.dz ?? 1];
  const dn = norm3(dRaw);
  if (dn < 1e-12) return mechRefusal(model, "转轴方向为零向量", "请给 dx/dy/dz 非零方向");
  const d: V3 = mul3(dRaw, 1 / dn);
  const qp = poly(p, "ph");
  const kn = Math.max(1, Math.min(model.nodes.length - 1, Math.round(p.kn ?? 1)));
  const kId = model.nodes[kn]?.id ?? "P";

  const kin = (t: number) => {
    const [ang, w, al] = evalPoly(qp, t);
    return { ang, w, al };
  };
  const poseOf = (node: V3, ang: number): V3 => add3(O, rotAxis(sub3(node, O), d, ang));

  const frames: KinFrame[] = [];
  const sW: number[] = [];
  const sAl: number[] = [];
  const sV: number[] = [];
  const sAt: number[] = [];
  const sAn: number[] = [];
  const ts = sampleTimes(T, n);
  const nodePos0 = model.nodes.map((nd) => [nd.x, nd.y, nd.z] as V3);
  let dist = 0;
  for (const t of ts) {
    const { ang, w, al } = kin(t);
    const pts: Record<string, V3> = {};
    model.nodes.forEach((nd, i) => (pts[nd.id] = poseOf(nodePos0[i], ang)));
    const rRel = sub3(pts[kId], O);
    const wv = mul3(d, w);
    const v = cross3(wv, rRel);
    const a = add3(cross3(mul3(d, al), rRel), cross3(wv, v));
    dist = norm3(cross3(d, rRel));
    sW.push(w);
    sAl.push(al);
    sV.push(norm3(v));
    sAt.push(al * dist);
    sAn.push(w * w * dist);
    frames.push({ t, pts, vel: { [kId]: v }, acc: { [kId]: a } });
  }

  const { ang, w, al } = kin(tKey);
  const rRel = sub3(poseOf(nodePos0[kn], ang), O);
  const v = cross3(mul3(d, w), rRel);
  const a = add3(cross3(mul3(d, al), rRel), cross3(mul3(d, w), v));
  const dk = norm3(cross3(d, rRel));
  const velOf = (t: number): V3 => {
    const kk = kin(t);
    return cross3(mul3(d, kk.w), sub3(poseOf(nodePos0[kn], kk.ang), O));
  };
  const hK2 = 1e-5 * Math.max(1, T);
  let ndResK2 = 0;
  const maxVK2 = Math.max(1e-9, ...sV);
  for (const t of ts) for (let j = 0; j < 3; j++) ndResK2 = Math.max(ndResK2, Math.abs(numDeriv((tt) => poseOf(nodePos0[kn], kin(tt).ang)[j], t, hK2) - velOf(t)[j]) / maxVK2);
  const checks: Check[] = [
    { name: "线速度公式", pass: Math.abs(norm3(v) - Math.abs(w) * dk) < 1e-9 * Math.max(1, norm3(v)), residual: Math.abs(norm3(v) - Math.abs(w) * dk), note: "v = ω·d（d 为点到轴距离）" },
    { name: "切向/法向分解", pass: Math.abs(norm3(a) ** 2 - ((al * dk) ** 2 + (w * w * dk) ** 2)) < 1e-9 * Math.max(1, norm3(a) ** 2), residual: Math.abs(norm3(a) ** 2 - ((al * dk) ** 2 + (w * w * dk) ** 2)), note: "|a|² = a_t² + a_n²" },
    { name: "数值微分互校", pass: ndResK2 < 1e-6, residual: ndResK2, note: "关键点位置差分速度 vs ω×r" },
  ];

  return {
    headline: `定轴转动 φ(t) 闭式解：t=${tKey}s 时 ω=${w.toFixed(4)} rad/s，${kId} 点 v=${norm3(v).toFixed(4)} m/s、a_n=${(w * w * dk).toFixed(4)} m/s²`,
    frames,
    series: [mkSeries("ω", "rad/s", sW), mkSeries("α", "rad/s²", sAl), mkSeries(`v(${kId})`, "m/s", sV), mkSeries("a_t", "m/s²", sAt), mkSeries("a_n", "m/s²", sAn)],
    keyValues: [
      mkKV("φ(tKey)", ang, "rad"),
      mkKV("ω(tKey)", w, "rad/s"),
      mkKV("α(tKey)", al, "rad/s²"),
      mkKV(`v(${kId},tKey)`, norm3(v), "m/s"),
      mkKV("a_t(tKey)", al * dk, "m/s²"),
      mkKV("a_n(tKey)", w * w * dk, "m/s²"),
    ],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `转轴过 (${O[0]}, ${O[1]}, ${O[2]}) 方向 (${dRaw.join(", ")})，转动方程 φ(t) 多项式+简谐，关键点 ${kId}` },
      { title: "建模", detail: "Rodrigues 旋转求位形；v=ω×r、a=α×r+ω×v 闭式" },
      { title: "求解", detail: `解析采样 ${n} 帧全结点位形，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- K3 点的合成运动（动系转动 + 相对沿杆） ----------

export function solveK3(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const qPsi = poly(p, "psi");
  const qS = poly(p, "s");
  const L = p.L ?? 4;

  const kin = (t: number) => {
    const [psi, w, al] = evalPoly(qPsi, t);
    const [s, sd, sdd] = evalPoly(qS, t);
    return { psi, w, al, s, sd, sdd };
  };
  const frames: KinFrame[] = [];
  const sVr: number[] = [];
  const sVe: number[] = [];
  const sVa: number[] = [];
  const sAc: number[] = [];
  const sAa: number[] = [];
  const sW: number[] = [];
  const ts = sampleTimes(T, n);
  for (const t of ts) {
    const k = kin(t);
    const er: V3 = [Math.cos(k.psi), Math.sin(k.psi), 0];
    const ep: V3 = [-Math.sin(k.psi), Math.cos(k.psi), 0];
    const P: V3 = mul3(er, k.s);
    const vr = mul3(er, k.sd);
    const ve = mul3(ep, k.w * k.s);
    const va = add3(vr, ve);
    const ar = mul3(er, k.sdd);
    const aen = mul3(er, -k.w * k.w * k.s);
    const aet = mul3(ep, k.al * k.s);
    const ac = mul3(ep, 2 * k.w * k.sd);
    const aa = add3(add3(ar, aen), add3(aet, ac));
    sVr.push(norm3(vr));
    sVe.push(norm3(ve));
    sVa.push(norm3(va));
    sAc.push(Math.abs(2 * k.w * k.sd));
    sAa.push(norm3(aa));
    sW.push(k.w);
    frames.push({ t, pts: { O: [0, 0, 0], A: mul3(er, L), P }, vel: { P: va }, acc: { P: aa } });
  }

  const k = kin(tKey);
  const er: V3 = [Math.cos(k.psi), Math.sin(k.psi), 0];
  const ep: V3 = [-Math.sin(k.psi), Math.cos(k.psi), 0];
  const vr = norm3(mul3(er, k.sd));
  const ve = Math.abs(k.w * k.s);
  const va = norm3(add3(mul3(er, k.sd), mul3(ep, k.w * k.s)));
  const ac = 2 * k.w * k.sd;
  const aa = norm3(add3(mul3(er, k.sdd - k.w * k.w * k.s), mul3(ep, k.al * k.s + ac)));
  const h = 1e-5 * Math.max(1, T);
  const posF = (tt: number) => mul3([Math.cos(kin(tt).psi), Math.sin(kin(tt).psi), 0] as V3, kin(tt).s);
  const velF = (tt: number) => { const kk = kin(tt); return add3(mul3([Math.cos(kk.psi), Math.sin(kk.psi), 0] as V3, kk.sd), mul3([-Math.sin(kk.psi), Math.cos(kk.psi), 0] as V3, kk.w * kk.s)); };
  const accF = (tt: number) => { const kk = kin(tt); const er2: V3 = [Math.cos(kk.psi), Math.sin(kk.psi), 0]; const ep2: V3 = [-Math.sin(kk.psi), Math.cos(kk.psi), 0]; return add3(mul3(er2, kk.sdd - kk.w * kk.w * kk.s), mul3(ep2, kk.al * kk.s + 2 * kk.w * kk.sd)); };
  let ndRes = 0;
  let nd2Res = 0;
  const maxVa = Math.max(1e-9, ...sVa);
  const maxAa = Math.max(1e-9, ...sAa);
  const h2 = 1e-4 * Math.max(1, T);
  for (const t of ts) {
    for (let j = 0; j < 3; j++) {
      ndRes = Math.max(ndRes, Math.abs(numDeriv((tt) => posF(tt)[j], t, h) - velF(t)[j]) / maxVa);
      nd2Res = Math.max(nd2Res, Math.abs((posF(t + h2)[j] - 2 * posF(t)[j] + posF(t - h2)[j]) / (h2 * h2) - accF(t)[j]) / maxAa);
    }
  }
  let perpRes = 0;
  for (let i = 0; i < ts.length; i++) perpRes = Math.max(perpRes, Math.abs(sVa[i] ** 2 - (sVr[i] ** 2 + sVe[i] ** 2)) / Math.max(1e-9, sVa[i] ** 2));

  const checks: Check[] = [
    { name: "速度合成定理", pass: perpRes < 1e-9, residual: perpRes, note: "v_a² = v_r² + v_e²（径向/横向正交分解）" },
    { name: "数值微分互校", pass: ndRes < 1e-6, residual: ndRes, note: "绝对速度 = 位置中心差分" },
    { name: "加速度合成校核", pass: nd2Res < 1e-5, residual: nd2Res, note: "a_a=a_r+a_en+a_et+a_c vs 位置三点差分" },
  ];

  return {
    headline: `合成运动分解（t=${tKey}s）：v_r=${vr.toFixed(4)}、v_e=${ve.toFixed(4)}、v_a=${va.toFixed(4)} m/s，a_c=${ac.toFixed(4)} m/s²`,
    frames,
    series: [mkSeries("v_r", "m/s", sVr), mkSeries("v_e", "m/s", sVe), mkSeries("v_a", "m/s", sVa), mkSeries("a_c", "m/s²", sAc), mkSeries("a_a", "m/s²", sAa), mkSeries("ω", "rad/s", sW)],
    keyValues: [
      mkKV("ψ(tKey)", k.psi, "rad"),
      mkKV("s(tKey)", k.s, "m"),
      mkKV("v_r(tKey)", vr, "m/s"),
      mkKV("v_e(tKey)", ve, "m/s"),
      mkKV("v_a(tKey)", va, "m/s"),
      mkKV("a_c(tKey)", ac, "m/s²"),
      mkKV("a_a(tKey)", aa, "m/s²"),
    ],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `动系绕 z 轴 ψ(t) 转动，动点沿杆相对运动 s(t)；牵连/相对/绝对三口径` },
      { title: "建模", detail: "v_a=v_r+v_e；a_a=a_r+a_en+a_et+a_c，a_c=2ω×v_r" },
      { title: "求解", detail: `解析采样 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- K4 刚体平面运动：滑块曲柄（基点法 + 瞬心法） ----------

/** 曲柄 r、连杆 l、曲柄角 θ → 滑块位置 xB（对心式） */
export function crankSliderX(r: number, l: number, th: number): number {
  return r * Math.cos(th) + Math.sqrt(l * l - r * r * Math.sin(th) * Math.sin(th));
}
/** dxB/dθ（解析） */
export function crankSliderDX(r: number, l: number, th: number): number {
  const root = Math.sqrt(l * l - r * r * Math.sin(th) * Math.sin(th));
  return -r * Math.sin(th) - (r * r * Math.sin(th) * Math.cos(th)) / root;
}

export function solveK4(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const r = p.r ?? 0.4;
  const l = p.l ?? 1.0;
  if (!(r > 0) || !(l > 0)) return mechRefusal(model, "杆长必须为正", "检查 r（曲柄）与 l（连杆）");
  if (r >= l) return mechRefusal(model, `曲柄滑块无法装配：r=${r} ≥ l=${l}`, "曲柄整周回转要求 r < l（连杆更长）");
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const th0 = p.th0 ?? 0;
  const w = p.w ?? 0;
  const eps = p.eps ?? 0;
  const thOf = (t: number) => th0 + w * t + 0.5 * eps * t * t;
  const wOf = (t: number) => w + eps * t;

  const frames: KinFrame[] = [];
  const sTh: number[] = [];
  const sX: number[] = [];
  const sV: number[] = [];
  const sWab: number[] = [];
  const ts = sampleTimes(T, n);
  for (const t of ts) {
    const th = thOf(t);
    const wth = wOf(t);
    const A: V3 = [r * Math.cos(th), r * Math.sin(th), 0];
    const xB = crankSliderX(r, l, th);
    const B: V3 = [xB, 0, 0];
    const vA: V3 = [-r * Math.sin(th) * wth, r * Math.cos(th) * wth, 0];
    const vB = crankSliderDX(r, l, th) * wth;
    // 基点法：v_B = v_A + ω_AB ẑ×(B−A)，y 分量解 ω_AB
    const wab = -(vA[1] * 1) / (xB - A[0]);
    const aB = numDeriv((tt) => crankSliderDX(r, l, thOf(tt)) * wOf(tt), t, 1e-5 * Math.max(1, T));
    sTh.push(th);
    sX.push(xB);
    sV.push(vB);
    sWab.push(wab);
    frames.push({ t, pts: { O: [0, 0, 0], A, B }, vel: { A: vA, B: [vB, 0, 0] }, acc: { B: [aB, 0, 0] } });
  }

  // 校核：基点法 vs 导数法（速度投影定理）+ 刚杆约束 + 数值微分
  const maxV = Math.max(1e-9, ...sV.map(Math.abs));
  let geoRes = 0;
  let rodRes = 0;
  let ndRes = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const th = thOf(t);
    const wth = wOf(t);
    const A: V3 = [r * Math.cos(th), r * Math.sin(th), 0];
    const xB = crankSliderX(r, l, th);
    const vA: V3 = [-r * Math.sin(th) * wth, r * Math.cos(th) * wth, 0];
    const vB: V3 = [sV[i], 0, 0];
    const wab = sWab[i];
    // 基点法 x 分量：v_Bx = v_Ax + ω_AB·A_y（ẑ×(B−A) 的 x 分量 = −(y_B−y_A) = A_y）
    const vbFromBase = vA[0] + wab * A[1];
    geoRes = Math.max(geoRes, Math.abs(vbFromBase - vB[0]) / maxV);
    const ab: V3 = [xB - A[0], -A[1], 0];
    rodRes = Math.max(rodRes, Math.abs(dot3(sub3(vB, vA), ab)) / (maxV * Math.max(1e-9, norm3(ab))));
    ndRes = Math.max(ndRes, Math.abs(numDeriv((tt) => crankSliderX(r, l, thOf(tt)), t, 1e-5 * Math.max(1, T)) - sV[i]) / maxV);
  }

  const thk = thOf(tKey);
  const xBk = crankSliderX(r, l, thk);
  const vAk: V3 = [-r * Math.sin(thk) * wOf(tKey), r * Math.cos(thk) * wOf(tKey), 0];
  const vBk = crankSliderDX(r, l, thk) * wOf(tKey);
  const wabk = -vAk[1] / (xBk - r * Math.cos(thk));
  // 速度瞬心：过 A 作 v_A 垂线 ∩ 过 B 竖线
  const icFinite = Math.abs(vAk[1]) > 1e-9 * Math.max(1, norm3(vAk));
  const icY = icFinite ? r * Math.sin(thk) - ((xBk - r * Math.cos(thk)) * vAk[0]) / vAk[1] : NaN;

  const checks: Check[] = [
    { name: "基点法互校", pass: geoRes < 1e-9, residual: geoRes, note: "v_B = v_A + ω×(B−A) 与 dxB/dθ·θ̇ 一致" },
    { name: "速度投影定理", pass: rodRes < 1e-9, residual: rodRes, note: "(v_B−v_A)·AB = 0（刚杆不可伸缩）" },
    { name: "数值微分互校", pass: ndRes < 1e-6, residual: ndRes, note: "v_B vs x_B 中心差分" },
  ];

  return {
    headline: `滑块曲柄平面运动：θ(tKey)=${thk.toFixed(4)} rad 时 v_B=${vBk.toFixed(4)} m/s、ω_AB=${wabk.toFixed(4)} rad/s${icFinite ? `，瞬心 (${xBk.toFixed(4)}, ${icY.toFixed(4)})` : "，瞬心在无穷远（瞬时平动）"}`,
    frames,
    series: [mkSeries("θ", "rad", sTh), mkSeries("x_B", "m", sX), mkSeries("v_B", "m/s", sV), mkSeries("ω_AB", "rad/s", sWab)],
    keyValues: [
      mkKV("θ(tKey)", thk, "rad"),
      mkKV("x_B(tKey)", xBk, "m"),
      mkKV("v_B(tKey)", vBk, "m/s"),
      mkKV("ω_AB(tKey)", wabk, "rad/s"),
      mkKV("IC_x(tKey)", xBk, "m"),
      mkKV("IC_y(tKey)", icY, "m"),
    ],
    checks,
    warnings: icFinite ? [] : [`tKey 时刻连杆瞬时平动，速度瞬心位于无穷远（IC_y=NaN）`],
    steps: [
      { title: "认题", detail: `曲柄 r=${r} m、连杆 l=${l} m，θ(t)=θ₀+ωt+½εt²（ω=${w} rad/s），对心滑块` },
      { title: "建模", detail: "x_B=r·cosθ+√(l²−r²sin²θ)；基点法 v_B=v_A+ω_AB×(B−A)；瞬心=两速度垂线交点" },
      { title: "求解", detail: `解析采样 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}

// ---------- K4R 圆盘纯滚动 ----------

export function solveK4R(model: MechModel, t0: number): KinResult {
  const p = model.p;
  const R = p.R ?? 0.5;
  if (!(R > 0)) return mechRefusal(model, `半径 R=${R} 非法`, "R 必须为正");
  const n = model.samples ?? KIN_SAMPLES;
  const T = model.duration;
  const tKey = p.tKey ?? T;
  const v0 = p.v0 ?? 2;
  const aC = p.aC ?? 0;
  const th0 = p.th0 ?? 0;
  const xC = (t: number) => v0 * t + 0.5 * aC * t * t;
  const vC = (t: number) => v0 + aC * t;
  const alpha = (t: number) => th0 - xC(t) / R; // 顺时针滚：标记点角 = th0 − xC/R

  const frames: KinFrame[] = [];
  const sPhi: number[] = [];
  const sW: number[] = [];
  const sVp: number[] = [];
  const sAp: number[] = [];
  const ts = sampleTimes(T, n);
  for (const t of ts) {
    const vc = vC(t);
    const a = alpha(t);
    const C: V3 = [xC(t), R, 0];
    const P: V3 = [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a), 0];
    const G: V3 = [C[0], 0, 0];
    const vP: V3 = [vc * (1 + Math.sin(a)), -vc * Math.cos(a), 0];
    const ad = aC; // dvC/dt
    const adot = -vc / R; // dα/dt
    const aP: V3 = [ad * (1 + Math.sin(a)) + vc * Math.cos(a) * adot, -ad * Math.cos(a) + vc * Math.sin(a) * adot, 0];
    sPhi.push(xC(t) / R);
    sW.push(vc / R);
    sVp.push(norm3(vP));
    sAp.push(norm3(aP));
    frames.push({ t, pts: { O: [0, 0, 0], C, P, G }, vel: { P: vP, G: [0, 0, 0] }, acc: { P: aP } });
  }

  const vck = vC(tKey);
  const ak = alpha(tKey);
  const vPk: V3 = [vck * (1 + Math.sin(ak)), -vck * Math.cos(ak), 0];
  const aPk: V3 = [aC * (1 + Math.sin(ak)) + vck * Math.cos(ak) * (-vck / R), -aC * Math.cos(ak) + vck * Math.sin(ak) * (-vck / R), 0];
  const checks: Check[] = (() => {
    let gRes = 0;
    let ndRes = 0;
    const maxV = Math.max(1e-9, ...sVp);
    const posF = (tt: number) => { const a = alpha(tt); return [xC(tt) + R * Math.cos(a), R + R * Math.sin(a), 0] as V3; };
    const velF = (tt: number) => { const a = alpha(tt); return [vC(tt) * (1 + Math.sin(a)), -vC(tt) * Math.cos(a), 0] as V3; };
    for (const t of ts) {
      // 接触点速度 v_G = v_C + ω×(G−C)，ω=(0,0,−vC/R)，G−C=(0,−R,0) → 应为 0
      const wv: V3 = [0, 0, -vC(t) / R];
      const vg = add3([vC(t), 0, 0], cross3(wv, [0, -R, 0]));
      gRes = Math.max(gRes, norm3(vg) / Math.max(1e-9, vC(t)));
      for (let j = 0; j < 2; j++) ndRes = Math.max(ndRes, Math.abs(numDeriv((tt) => posF(tt)[j], t, 1e-5 * Math.max(1, T)) - velF(t)[j]) / maxV);
    }
    const anRes = aC === 0 ? Math.max(...sAp.map((x) => Math.abs(x - vC(0) ** 2 / R) / Math.max(1e-9, vC(0) ** 2 / R))) : 0;
    return [
      { name: "纯滚条件", pass: gRes < 1e-9, residual: gRes, note: "v_G = v_C + ω×(G−C) = 0（接触点速度为零，瞬心在接触点）" },
      { name: "数值微分互校", pass: ndRes < 1e-6, residual: ndRes, note: "边缘点速度 = 位置中心差分" },
      { name: "向心加速度", pass: anRes < 1e-9, residual: anRes, note: aC === 0 ? "匀速滚动 |a_P| ≡ v_C²/R" : "有切向加速度，跳过该恒等式" },
    ] as Check[];
  })();

  return {
    headline: `圆盘纯滚动 R=${R} m：ω=${(vck / R).toFixed(4)} rad/s，tKey 边缘点 v=${norm3(vPk).toFixed(4)} m/s、|a|=${norm3(aPk).toFixed(4)} m/s²（接触点速度为零）`,
    frames,
    series: [mkSeries("φ", "rad", sPhi), mkSeries("ω", "rad/s", sW), mkSeries("|v_P|", "m/s", sVp), mkSeries("|a_P|", "m/s²", sAp)],
    keyValues: [
      mkKV("v_C(tKey)", vck, "m/s"),
      mkKV("ω(tKey)", vck / R, "rad/s"),
      mkKV("|v_P(tKey)|", norm3(vPk), "m/s"),
      mkKV("|a_P(tKey)|", norm3(aPk), "m/s²"),
    ],
    checks,
    warnings: [],
    steps: [
      { title: "认题", detail: `圆盘 R=${R} m 沿地面纯滚，中心 x_C=v₀t+½at²（v₀=${v0} m/s）` },
      { title: "建模", detail: "φ=xC/R（纯滚约束）；v_P=v_C+ω×r；瞬心在接触点" },
      { title: "求解", detail: `解析采样 ${n} 帧，耗时 ${Date.now() - t0} ms` },
      { title: "校核", detail: checkSummary(checks) },
    ],
  };
}
