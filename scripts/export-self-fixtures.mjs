/**
 * M5–M8 的 fixture 导出器（这四型库不算，所以「真值」由本脚本按公式独立算）。
 *
 * 重要：本脚本**不 import src/ 下的任何求解器**，公式全部从上到下重写一遍
 * （材料力学教科书那几条），于是它和 solver 是两个独立实现。
 * check:mech-self 拿它当 oracle 比对 solver，1e-9。
 *
 * 每份 fixture 带 derivation 字段：写清公式与来源，方便人工复核。
 *
 * 运行：node scripts/export-self-fixtures.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// 放 mech-self/ 而不是 mech/：check:mech-parity 把 mech/ 的文件名写成白名单，多一份就报错
const outDir = join(root, 'fixtures', 'mech-self');
mkdirSync(outDir, { recursive: true });

const PI = Math.PI;

/* ── M5 弯曲变形：简支梁集中力 @a ─────────────────────────────────── */
function m5(input) {
  const { L, a, P, b, h, E } = input;
  const bb = L - a;
  const Iy = ((b / 1000) * (h / 1000) ** 3) / 12; // m⁴
  const EI = E * 1e9 * Iy;
  const load = P * 1e3;
  const longer = a >= bb ? bb : a;
  const deltaM = (load * longer * (L * L - longer * longer) ** 1.5) / (9 * Math.sqrt(3) * L * EI);
  const xMax = a >= bb ? Math.sqrt((L * L - bb * bb) / 3) : L - Math.sqrt((L * L - a * a) / 3);
  return {
    Iy: Math.round(Iy * 1e12 * 1000) / 1000,
    deltaMax: Math.round(deltaM * 1000 * 1e6) / 1e6,
    deltaMaxX: Math.round(xMax * 1e6) / 1e6,
    deltaAllow: Math.round((L * 1000) / 400 * 1e6) / 1e6,
  };
}

/* ── M6 应力状态 ────────────────────────────────────────────────── */
function m6({ sx, sy, txy }) {
  const center = (sx + sy) / 2;
  const radius = Math.sqrt(((sx - sy) / 2) ** 2 + txy * txy);
  const sigma1 = center + radius;
  const sigma2 = center - radius;
  const raw = (0.5 * Math.atan2(2 * txy, sx - sy) * 180) / PI;
  const thetaP = ((((raw + 90) % 180) + 180) % 180) - 90;
  const sigmaR4 = Math.sqrt(sigma1 * sigma1 + sigma2 * sigma2 - sigma1 * sigma2);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    center: r6(center),
    radius: r6(radius),
    sigma1: r6(sigma1),
    sigma2: r6(sigma2),
    tauMax: r6(radius),
    thetaP: r6(thetaP),
    sigmaR4: r6(sigmaR4),
  };
}

/* ── M7 压杆稳定：欧拉临界应力 ───────────────────────────────────── */
function m7({ L, b, h, E, mu, sp }) {
  const A = b * h;
  const Imin = Math.min((b * h ** 3) / 12, (h * b ** 3) / 12);
  const i = Math.sqrt(Imin / A);
  const lambda = (mu * L * 1000) / i;
  const eMpa = E * 1000;
  const lambdaP = PI * Math.sqrt(eMpa / sp);
  const sigmaCr = (PI * PI * eMpa) / (lambda * lambda);
  const r3 = (v) => Math.round(v * 1e3) / 1e3;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    A: r3(A),
    Imin: r3(Imin),
    i: r6(i),
    lambda: r6(lambda),
    lambdaP: r6(lambdaP),
    sigmaCr: r6(sigmaCr),
    pCr: r6((sigmaCr * A) / 1000),
  };
}

/* ── M8 组合变形：悬臂圆轴 ──────────────────────────────────────── */
function m8({ L, d, Pn, Pt, T }) {
  const R = d / 2000;
  const A = PI * R * R;
  const I = (PI * R ** 4) / 4;
  const W = I / R;
  const Wp = (PI * R ** 3) / 2;
  const N = -Pn;
  const M = -Pt * L;
  const sigmaN = (N / A) * 1e-3;
  const edge = (M / W) * 1e-3;
  const sigmaTop = sigmaN + edge;
  const sigmaBottom = sigmaN - edge;
  const sigmaMax = Math.max(Math.abs(sigmaTop), Math.abs(sigmaBottom));
  const tau = (T / Wp) * 1e-3;
  const sigmaR4 = T > 0 ? Math.sqrt(sigmaMax ** 2 + 3 * tau * tau) : sigmaMax;
  const naRaw = M === 0 ? null : (-(N / A) / (M / I)) * 1000;
  const neutralAxis = naRaw !== null && Math.abs(naRaw) <= d / 2 ? Math.round(naRaw * 1e6) / 1e6 : '截面外';
  const r3 = (v) => Math.round(v * 1e3) / 1e3;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return {
    A: r3(A * 1e6),
    W: r3(W * 1e9),
    Wp: r3(Wp * 1e9),
    N: r6(N),
    M: r6(Math.abs(M)),
    T: r6(T),
    sigmaN: r6(sigmaN),
    sigmaM: r6(Math.abs(edge)),
    sigmaMax: r6(sigmaMax),
    tau: r6(tau),
    sigmaR4: r6(sigmaR4),
    neutralAxis,
  };
}

const CASES = [
  {
    name: 'M5-01',
    template: 'M5',
    input: { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 },
    derivation:
      '简支梁集中力：δmax=P·c·(L²−c²)^{3/2}/(9√3·L·EI)，c 取较长一段；x*=√((L²−c²)/3)。' +
      'I=bh³/12；[δ]=L/400（常用挠度限值）。来源：材料力学挠曲线微分方程解（刘鸿文 §6）。',
    expected: () => m5({ L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 }),
  },
  {
    name: 'M5-02',
    template: 'M5',
    input: { L: 6.5, a: 1.7, P: 45, b: 60, h: 120, E: 210 },
    derivation:
      '同上，但 a<L/2，最大挠度落在长段：x*=L−√((L²−a²)/3)，c=a。用来验证极值位置不是永远在跨中。',
    expected: () => m5({ L: 6.5, a: 1.7, P: 45, b: 60, h: 120, E: 210 }),
  },
  {
    name: 'M6-01',
    template: 'M6',
    input: { sx: 100, sy: -20, txy: 40, allow: 160 },
    derivation:
      '平面应力：C=(σx+σy)/2，R=√(((σx−σy)/2)²+τxy²)，σ1,2=C±R，τmax=R，' +
      'θp=½atan2(2τxy, σx−σy)。σr4=√(σ1²+σ2²−σ1σ2)（第四强度理论，σ3=0）。',
    expected: () => m6({ sx: 100, sy: -20, txy: 40 }),
  },
  {
    name: 'M6-02',
    template: 'M6',
    input: { sx: -60, sy: -20, txy: 35, allow: 160 },
    derivation:
      '同上，但两个正应力都是压、且 σ2<σ1<0 —— 用来钉住「主平面角可能落在第二象限」与符号处理。',
    expected: () => m6({ sx: -60, sy: -20, txy: 35 }),
  },
  {
    name: 'M7-01',
    template: 'M7',
    input: { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 },
    derivation:
      'A=bh，Imin=min(bh³,hb³)/12，i=√(Imin/A)，λ=μL/i，λp=π√(E/σp)，σcr=π²E/λ²，Pcr=σcr·A。' +
      '本组 λ=115.5>λp=99.3，欧拉公式适用。',
    expected: () => m7({ L: 2, b: 60, h: 60, E: 200, mu: 1, sp: 200 }),
  },
  {
    name: 'M7-02',
    template: 'M7',
    input: { L: 1, b: 80, h: 80, E: 200, mu: 1, P: 150, sp: 200 },
    derivation:
      '同上，但杆短（λ=43.3 < λp=99.3）⇒ 欧拉公式不适用，本工具必须拒绝给 σcr / Pcr。' +
      '这份 fixture 的期望里 sigmaCr/pCr 就是字符串「—」，用来钉住「不许先给数再标黄」。',
    expected: () => {
      const geo = m7({ L: 1, b: 80, h: 80, E: 200, mu: 1, sp: 200 });
      return {
        A: geo.A,
        Imin: geo.Imin,
        i: geo.i,
        lambda: geo.lambda,
        lambdaP: geo.lambdaP,
        sigmaCr: '—',
        pCr: '—',
      };
    },
  },
  {
    name: 'M8-01',
    template: 'M8',
    input: { L: 2, d: 120, Pn: 50, Pt: 10, T: 0.5, allow: 160 },
    derivation:
      '悬臂圆轴：N=−Pn，M=−Pt·L，T 直接传入。A=πd²/4，W=πd³/32，Wp=πd³/16。' +
      'σ=N/A+M·y/I，中性轴 y=−(N/A)/(M/I)，σr4=√(σmax²+3τ²)，τ=T/Wp。',
    expected: () => m8({ L: 2, d: 120, Pn: 50, Pt: 10, T: 0.5 }),
  },
  {
    name: 'M8-02',
    template: 'M8',
    input: { L: 1.5, d: 60, Pn: 80, Pt: 20, T: 1.2, allow: 160 },
    derivation: '同上，但轴细、载荷大：σr4 远超许用（红字超限那条分支）。',
    expected: () => m8({ L: 1.5, d: 60, Pn: 80, Pt: 20, T: 1.2 }),
  },
];

for (const item of CASES) {
  const payload = {
    template: item.template,
    input: item.input,
    derivation: item.derivation,
    expected: item.expected(),
  };
  writeFileSync(join(outDir, `${item.name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`${item.name}.json`);
}
