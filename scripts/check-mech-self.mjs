/**
 * 自算 fixture 门禁（M5–M8）：solver vs 独立手算，fixtures/mech-self/*.json 为准。
 *
 * 为什么这四型要单开一道门禁：库不覆盖变形 / 应力状态 / 压杆稳定 / 组合变形，
 * 没有「库导出的真值」可比 —— 所以 oracle 换成 scripts/export-self-fixtures.mjs
 * 里按教科书公式重写的一遍实现（不 import 任何 solver）。
 *
 * 口径：oracle 只写到小数点后 6 位，所以容差是 max(5e-7 绝对, 1e-9 相对)。
 * 每份 fixture 必须带非空 derivation（公式 + 来源），否则直接判失败 ——
 * 「算得对」和「说得出为什么对」这两件事都得有。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { solveM5 } from '../src/core/templates/mechanics/M5.ts';
import { solveM6 } from '../src/core/templates/mechanics/M6.ts';
import { solveM7 } from '../src/core/templates/mechanics/M7.ts';
import { solveM8 } from '../src/core/templates/mechanics/M8.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(root, 'fixtures', 'mech-self');

const SOLVERS = { M5: solveM5, M6: solveM6, M7: solveM7, M8: solveM8 };
const EXPECTED_NAMES = [
  'M5-01', 'M5-02',
  'M6-01', 'M6-02',
  'M7-01', 'M7-02',
  'M8-01', 'M8-02',
];

const ABS_TOL = 5e-7;
const REL_TOL = 1e-9;
const failures = [];
let fields = 0;

const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));
const names = files.map((name) => name.replace(/\.json$/, '')).sort();
for (const name of EXPECTED_NAMES) {
  if (!names.includes(name)) failures.push({ fixture: name, field: '文件', detail: '缺少 fixture' });
}
for (const name of names) {
  if (!EXPECTED_NAMES.includes(name)) {
    failures.push({ fixture: name, field: '文件', detail: '多出的 fixture：M5–M8 只允许这 8 份' });
  }
}

for (const name of EXPECTED_NAMES) {
  if (!names.includes(name)) continue;
  const fixture = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
  const solver = SOLVERS[fixture.template];
  if (!solver) {
    failures.push({ fixture: name, field: 'template', detail: `未知模板 ${fixture.template}` });
    continue;
  }
  if (typeof fixture.derivation !== 'string' || fixture.derivation.trim().length < 20) {
    failures.push({ fixture: name, field: 'derivation', detail: '缺少公式推导说明（至少 20 字）' });
  }
  let solution;
  try {
    solution = solver(fixture.input);
  } catch (error) {
    failures.push({
      fixture: name,
      field: 'solve',
      detail: error instanceof Error ? error.message : String(error),
    });
    continue;
  }
  for (const [key, expected] of Object.entries(fixture.expected)) {
    fields += 1;
    const actual = solution.result[key];
    if (typeof expected === 'number') {
      if (typeof actual !== 'number' || !Number.isFinite(actual)) {
        failures.push({ fixture: name, field: key, actual, expected, rel: Number.NaN });
        continue;
      }
      const diff = Math.abs(actual - expected);
      const allowed = Math.max(ABS_TOL, REL_TOL * Math.abs(expected));
      if (diff > allowed) {
        failures.push({
          fixture: name,
          field: key,
          actual,
          expected,
          rel: diff / Math.max(Math.abs(expected), 1e-12),
        });
      }
      continue;
    }
    if (String(actual) !== String(expected)) {
      failures.push({ fixture: name, field: key, actual, expected, rel: Number.NaN });
    }
  }
}

if (failures.length > 0) {
  console.error(`FAIL：${failures.length} 处不一致（${fields} 个字段）`);
  for (const item of failures.slice(0, 20)) {
    if (item.detail) console.error(`- ${item.fixture} / ${item.field} / ${item.detail}`);
    else {
      console.error(
        `- ${item.fixture} / ${item.field} / 实际 ${item.actual} / 期望 ${item.expected} / 相对 ${
          Number.isFinite(item.rel) ? item.rel.toExponential(3) : item.rel
        }`,
      );
    }
  }
  process.exit(1);
}
console.log(
  `PASS：${EXPECTED_NAMES.length} 份自算 fixture / ${fields} 个字段，均落在 5e-7 绝对（或 1e-9 相对）内；每份都带 derivation`,
);
