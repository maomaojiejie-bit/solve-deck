/**
 * 导出力学 fixture：对文档 §1.2 列的 8 个 spec 各跑一次库脚本，
 * 把 { spec, expected } 写到 fixtures/mech/<name>.json。
 *
 * 用法：node scripts/export-fixtures.mjs
 *
 * 说明（踩过的坑，别改）：
 *  1. 库脚本在 `C:\Users\17897\.dsh\profiles\desktop\node_modules\dsh-mech-workbench\scripts\analyze.py`，
 *     可用环境变量 MECH_ANALYZE 覆盖。
 *  2. 本机默认的 `python`（WorkBuddy 自带 3.13）**没有 numpy**，库会直接崩。
 *     所以这里按顺序试 MECH_PYTHON / python / python3 / py -3.12 / py -3.10 / py -3.8，
 *     取第一个 `import numpy` 能过的解释器。
 *  3. expected 就是库的实跑输出（原样存，不裁剪），parity 只比对其中声明过的数值字段。
 *  4. 载荷方向：库约定 transverse **向上为正**。文档 §1.2 只给了大小，这里统一取
 *     「向下为负」，这样才能与 §2 的标准答案同号（悬臂 M(0)=-10、简支 Mmax=+20）。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const LIB =
  process.env.MECH_ANALYZE ??
  'C:/Users/17897/.dsh/profiles/desktop/node_modules/dsh-mech-workbench/scripts/analyze.py';
const OUT_DIR = join(root, 'fixtures', 'mech');
const TMP_DIR = join(root, '.tmp', 'mech-spec');

const RECT = { shape: 'rect', params: { b: 0.1, h: 0.2 }, E: 200e9 };
/** 只求弯曲内力的三种梁共用同一组支座/载荷，避免 M3/M4 之间多出一层变量。 */
const SIMPLE_P = {
  kind: 'beam',
  length: 4,
  supports: [
    { x: 0, type: 'pin' },
    { x: 4, type: 'roller' },
  ],
  loads: [{ type: 'point_force', x: 2, value: -20 }],
};

const FIXTURES = [
  {
    name: 'M1-axial-01',
    note: 'bar A=2.0e-4、P=40 kN 轴向、两端 pin',
    spec: {
      kind: 'bar',
      length: 1,
      supports: [
        { x: 0, type: 'pin' },
        { x: 1, type: 'pin' },
      ],
      loads: [{ type: 'point_force', x: 1, value: 40, dir: 'axial' }],
      section: { shape: 'rect', params: { b: 0.02, h: 0.01 }, E: 200e9 },
    },
  },
  {
    name: 'M2-torsion-01',
    note: 'shaft d=40 mm、T=1.0 kN·m、一端 fixed',
    spec: {
      kind: 'shaft',
      length: 1,
      supports: [{ x: 0, type: 'fixed' }],
      loads: [{ type: 'point_torque', x: 1, value: 1.0 }],
      section: { shape: 'circle', params: { d: 0.04 }, E: 200e9 },
    },
  },
  {
    name: 'M3-cantilever-01',
    note: 'beam L=2、P=10 kN↓ @x=1、fixed@0',
    spec: {
      kind: 'beam',
      length: 2,
      supports: [{ x: 0, type: 'fixed' }],
      loads: [{ type: 'point_force', x: 1, value: -10 }],
      section: RECT,
    },
  },
  {
    name: 'M3-simple-P-01',
    note: 'beam L=4、P=20 kN↓ @x=2、pin@0 roller@4',
    spec: { ...SIMPLE_P, section: RECT },
  },
  {
    name: 'M3-simple-q-01',
    note: 'beam L=4、q=5 kN/m↓ 全跨（q0=q1=-5）、pin@0 roller@4',
    spec: {
      kind: 'beam',
      length: 4,
      supports: [
        { x: 0, type: 'pin' },
        { x: 4, type: 'roller' },
      ],
      loads: [{ type: 'distributed', x0: 0, x1: 4, q0: -5, q1: -5 }],
      section: RECT,
    },
  },
  {
    name: 'M4-rect-01',
    note: '同 M3-simple-P-01 的受力，矩形截面 b=0.1 h=0.2',
    spec: { ...SIMPLE_P, section: { shape: 'rect', params: { b: 0.1, h: 0.2 }, E: 200e9 } },
  },
  {
    name: 'M4-circle-01',
    note: '同 M3-simple-P-01 的受力，圆截面 d=100 mm',
    spec: { ...SIMPLE_P, section: { shape: 'circle', params: { d: 0.1 }, E: 200e9 } },
  },
  {
    name: 'M8-combined-01',
    note: 'beam L=2、轴向 P=50 kN(+x) @x=2 + 集中力偶 50 kN·m(CCW) @x=0.5、pin@0 roller@2',
    spec: {
      kind: 'beam',
      length: 2,
      supports: [
        { x: 0, type: 'pin' },
        { x: 2, type: 'roller' },
      ],
      loads: [
        { type: 'point_force', x: 2, value: 50, dir: 'axial' },
        // 力偶放在 x=0.5 而不是跨中：跨中时 M(1⁻)=+25 与 M(1⁺)=-25 的 |M| 完全相等，
        // 库取哪根纤维取决于 numpy lstsq 的 1e-16 噪声（σ 会整号翻转）。
        // 偏置后 |M|max=37.5 唯一，极值纤维不再由浮点噪声决定。
        { type: 'point_moment', x: 0.5, value: 50 },
      ],
      section: { ...RECT },
    },
  },
];

function pickPython() {
  const candidates = [
    process.env.MECH_PYTHON ? [process.env.MECH_PYTHON] : null,
    ['python'],
    ['python3'],
    ['py', '-3.12'],
    ['py', '-3.10'],
    ['py', '-3.8'],
  ].filter(Boolean);
  for (const cmd of candidates) {
    try {
      execFileSync(cmd[0], [...cmd.slice(1), '-c', 'import numpy'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // 换下一个
    }
  }
  throw new Error('找不到带 numpy 的 Python；请设置 MECH_PYTHON 指向可用的解释器');
}

function runAnalyze(python, specPath) {
  const out = execFileSync(python[0], [...python.slice(1), LIB, '--spec', specPath], { encoding: 'utf8' });
  return JSON.parse(out);
}

const python = pickPython();
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
for (const item of FIXTURES) {
  const specPath = join(TMP_DIR, `${item.name}.json`);
  writeFileSync(specPath, JSON.stringify(item.spec, null, 2), 'utf8');
  const expected = runAnalyze(python, specPath);
  if (expected.ok !== true) {
    console.error(`FAIL ${item.name}：库拒绝了这个 spec —— ${expected.error} ${expected.detail ?? ''}`);
    process.exit(1);
  }
  const outPath = join(OUT_DIR, `${item.name}.json`);
  writeFileSync(outPath, `${JSON.stringify({ spec: item.spec, expected }, null, 2)}\n`, 'utf8');

  const ext = expected.extrema ?? {};
  const st = expected.stresses ?? {};
  rows.push({
    name: item.name,
    det: expected.determinate ? '静定' : '静不定',
    mext: ext.M?.abs_max,
    sigma: st.sigma_max,
    tau: st.tau_torsion_max,
    note: item.note,
  });
}

rmSync(TMP_DIR, { recursive: true, force: true });

const fmt = (v) => (v === undefined || v === null ? '—' : Number(v).toPrecision(6));
console.log(`库：${python.join(' ')} ${LIB}`);
console.log(`导出 ${FIXTURES.length} 份 → fixtures/mech/\n`);
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(18)} ${r.det.padEnd(4)} |M|max=${fmt(r.mext).padStart(10)}  σmax=${fmt(r.sigma).padStart(10)}  τmax=${fmt(r.tau).padStart(10)}  ${r.note}`,
  );
}
const indeterminate = rows.filter((r) => r.det !== '静定');
if (indeterminate.length > 0) {
  console.log(
    `\n注意：${indeterminate.map((r) => r.name).join(', ')} 被库判为静不定，fixture 只钉「拒绝」与截面几何。`,
  );
}
