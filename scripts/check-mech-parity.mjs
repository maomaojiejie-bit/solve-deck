/**
 * 力学一致性门禁：TS 侧 solveMech(spec) vs 库导出的 fixture，相对误差 1e-9。
 *
 * 用法：node scripts/check-mech-parity.mjs   （已接进 npm run build）
 *
 * 比对口径（为什么不是裸 |Δ|/|库值|）：
 *   库自己算相对误差时用的是 `abs(actual-expected)/max(|expected|, scale, 1e-12)`，
 *   其中 scale 是该量的量级。裸相对误差遇到「本该是 0 的数值残差」（例如悬臂
 *   自由端 M≈-1.8e-15）会因浮点噪声误报，所以这里沿用库的 scale 口径：
 *     - 内力 / 极值：scale = 该通道 |value| 的最大值
 *     - 反力：      scale = 全部反力分量的最大值
 *     - 应力：      scale = 该题全部应力值的最大值
 *     - 位置 / 坐标：scale = 构件长度 L
 *   容差仍是 1e-9，量级只有 1e-9×10=1e-8 的绝对余量——
 *   M_max 改 0.1%（10 → 10.01）这种变异照样会被拦下。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDETERMINATE_MESSAGE, solveMech } from '../src/core/mechanics/solve.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(root, 'fixtures', 'mech');
const REL_TOL = 1e-9;

/** 文档 §1.2 的 8 份；其余 9 型这波不许造 fixture，多一份也要报错。 */
const EXPECTED_NAMES = [
  'M1-axial-01',
  'M2-torsion-01',
  'M3-cantilever-01',
  'M3-simple-P-01',
  'M3-simple-q-01',
  'M4-rect-01',
  'M4-circle-01',
  'M8-combined-01',
];

const failures = [];
let fields = 0;

function fmt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : String(v);
  return JSON.stringify(v);
}

function cmp(fixture, field, actual, expected, scale) {
  fields += 1;
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      failures.push({ fixture, field, actual, expected, rel: Number.NaN });
      return;
    }
    const den = Math.max(Math.abs(expected), Math.abs(scale ?? 0), 1e-12);
    const rel = Math.abs(actual - expected) / den;
    if (!(rel <= REL_TOL)) failures.push({ fixture, field, actual, expected, rel });
    return;
  }
  // null（如 rect 的 Ip/Wp）、布尔、字符串：严格相等
  if (actual !== expected) failures.push({ fixture, field, actual, expected, rel: Number.NaN });
}

function maxAbs(values) {
  let m = 0;
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  return m;
}

const onDisk = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

const missing = EXPECTED_NAMES.filter((n) => !onDisk.includes(n));
const extra = onDisk.filter((n) => !EXPECTED_NAMES.includes(n));
if (missing.length > 0) failures.push({ fixture: '(目录)', field: '缺 fixture', actual: missing.join(', '), expected: EXPECTED_NAMES.length });
if (extra.length > 0) failures.push({ fixture: '(目录)', field: '多出 fixture（本波只许 8 份）', actual: extra.join(', '), expected: '—' });

const rows = [];
for (const name of EXPECTED_NAMES) {
  if (!onDisk.includes(name)) continue;
  const fixture = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
  const { spec, expected } = fixture;
  const L = spec.length;
  const actual = solveMech(spec);

  const before = fields;
  const failBefore = failures.length;

  cmp(name, 'determinate', actual.determinate, expected.determinate);

  const secE = expected.section ?? {};
  const secA = actual.section ?? {};
  for (const key of ['A', 'Iy', 'W', 'Sy', 'Ip', 'Wp', 'ymax', 'tau_max_coeff']) {
    const e = secE[key];
    cmp(name, `section.${key}`, secA[key], e, typeof e === 'number' ? Math.abs(e) : 0);
  }

  if (expected.determinate) {
    const rE = expected.reactions ?? [];
    const rA = actual.reactions ?? [];
    cmp(name, 'reactions.length', rA.length, rE.length);
    const rScale = maxAbs(rE.flatMap((r) => [r.Rx, r.Ry, r.Mz, r.Mx].filter((v) => typeof v === 'number')));
    rE.forEach((e, i) => {
      const a = rA[i] ?? {};
      cmp(name, `reactions[${i}].x`, a.x, e.x, L);
      cmp(name, `reactions[${i}].Rx`, a.Rx, e.Rx, rScale);
      cmp(name, `reactions[${i}].Ry`, a.Ry, e.Ry, rScale);
      cmp(name, `reactions[${i}].Mz`, a.Mz, e.Mz, rScale);
      if ('Mx' in e) cmp(name, `reactions[${i}].Mx`, a.Mx, e.Mx, rScale);
    });

    const dE = expected.diagrams ?? {};
    const dA = actual.diagrams ?? {};
    const chanE = Object.keys(dE).sort();
    const chanA = Object.keys(dA).sort();
    cmp(name, 'diagrams.channels', chanA.join(','), chanE.join(','));

    for (const ch of chanE) {
      const ptsE = dE[ch] ?? [];
      const ptsA = dA[ch] ?? [];
      const scale = maxAbs(ptsE.map((p) => p.value));
      cmp(name, `diagrams.${ch}.length`, ptsA.length, ptsE.length, ptsE.length);
      ptsE.forEach((p, i) => {
        const a = ptsA[i] ?? {};
        cmp(name, `diagrams.${ch}[${i}].x`, a.x, p.x, L);
        cmp(name, `diagrams.${ch}[${i}].value`, a.value, p.value, scale);
      });
    }

    const eE = expected.extrema ?? {};
    const eA = actual.extrema ?? {};
    const extChans = Object.keys(eE).sort();
    cmp(name, 'extrema.channels', Object.keys(eA).sort().join(','), extChans.join(','));
    for (const ch of extChans) {
      const e = eE[ch];
      const a = eA[ch] ?? {};
      const scale = maxAbs((dE[ch] ?? []).map((p) => p.value));
      cmp(name, `extrema.${ch}.max`, a.max, e.max, scale);
      cmp(name, `extrema.${ch}.max_x`, a.max_x, e.max_x, L);
      cmp(name, `extrema.${ch}.min`, a.min, e.min, scale);
      cmp(name, `extrema.${ch}.min_x`, a.min_x, e.min_x, L);
      if ('abs_max' in e) {
        cmp(name, `extrema.${ch}.abs_max`, a.abs_max, e.abs_max, scale);
        cmp(name, `extrema.${ch}.abs_max_x`, a.abs_max_x, e.abs_max_x, L);
      }
    }

    // 库的 checks[]：结果页「六项校验」面板就是吃这一份，所以也钉住。
    const cE = expected.checks ?? [];
    const cA = actual.checks ?? [];
    cmp(name, 'checks.length', cA.length, cE.length, cE.length);
    // 残差的量级只有 1e-14，两边的舍入噪声本来就不同；按题目受力量级换算绝对容差，
    // 与库自己 _rerr(actual, expected, scale) 的口径一致（不许用裸相对误差，否则
    // 「本该是 0 的残差」会被浮点噪声放大成假失败）。
    const problemScale = Math.max(
      1,
      maxAbs(rE.flatMap((r) => [r.Rx, r.Ry, r.Mz, r.Mx].filter((v) => typeof v === 'number'))),
      maxAbs((dE.M ?? []).map((p) => p.value)),
      maxAbs((dE.Q ?? []).map((p) => p.value)),
      maxAbs((dE.N ?? []).map((p) => p.value)),
    );
    cE.forEach((c, i) => {
      const a = cA[i] ?? {};
      cmp(name, `checks[${i}].name`, a.name, c.name);
      cmp(name, `checks[${i}].pass`, a.pass, c.pass);
      cmp(name, `checks[${i}].actual`, a.actual, c.actual, problemScale);
      cmp(name, `checks[${i}].rel_error`, a.rel_error, c.rel_error, 1e-2);
    });

    const stE = expected.stresses ?? {};
    const stA = actual.stresses ?? {};
    const stScale = maxAbs(Object.values(stE));
    for (const [key, value] of Object.entries(stE)) {
      cmp(name, `stresses.${key}`, stA[key], value, stScale);
    }
  } else {
    // 静不定：只钉「拒绝」+ 截面几何，且文案必须是文档钉死的那一句
    cmp(name, 'message', actual.message, INDETERMINATE_MESSAGE);
    cmp(name, 'reactions.length', (actual.reactions ?? []).length, 0);
    cmp(name, 'diagrams.channels', Object.keys(actual.diagrams ?? {}).length, 0);
    cmp(name, 'extrema.channels', Object.keys(actual.extrema ?? {}).length, 0);
  }

  rows.push({ name, det: expected.determinate, fields: fields - before, ok: failures.length === failBefore });
}

for (const r of rows) {
  console.log(`[${r.ok ? 'ok' : 'FAIL'}] ${r.name}${r.det ? '' : '（静不定 → 只钉拒绝）'}：${r.fields} 个字段`);
}

if (failures.length > 0) {
  console.error(`\nFAIL：${failures.length} 处不一致（容差 ${REL_TOL}）`);
  console.error('型 / 字段 / TS 值 / 库值 / 相对误差');
  for (const f of failures.slice(0, 40)) {
    console.error(
      `${f.fixture} / ${f.field} / ${fmt(f.actual)} / ${fmt(f.expected)} / ${
        Number.isNaN(f.rel) ? '不相等' : f.rel.toExponential(3)
      }`,
    );
  }
  if (failures.length > 40) console.error(`… 其余 ${failures.length - 40} 处省略`);
  process.exit(1);
}

const indeterminate = rows.filter((r) => !r.det).length;
console.log(
  `\nPASS：${rows.length} 份 fixture / ${fields} 个字段，相对误差均 < ${REL_TOL}（静不定拒绝 ${indeterminate} 份）`,
);
