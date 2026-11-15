/**
 * 读数体检门禁（readouts）。
 *
 * 盯的不是「界面有没有渲染出来」，而是三条实质约束：
 *   1. 覆盖：登记的题型必须与 EXPECTED_COVERAGE 完全一致 —— 少一型要改这个文件说明理由，
 *      不许悄悄退回「这块不显示了」。
 *   2. 必然成立的关系必须真的处处成立：strict 项在**全部快照**与**参数扫描**下都得 ok。
 *      它们是定义式（IE=IB+IC、VOV=VGS−Vth）或组态必然（共射必反相、跟随器必 <1），
 *      任何一处不成立，都是规则写错了 —— 库本身有 40 道门禁背书，不用怀疑数字。
 *   3. 近似代价必须被一阶预期解释：实测偏差 ≤ 预期 1.5 倍。解不掉就说明近似
 *      已经越界（例如 ro 与负载同量级），这时候不该再挂着「忽略 ro」这句话。
 *
 * 另外两条防腐：
 *   - 没登记规则的题型必须返回 null（不是返回空壳），否则界面会冒出一块空白卡；
 *   - buildReadouts 不得改动 solution（纯读），用 JSON 前后比对钉住。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildReadouts, READOUT_TEMPLATES } from '../src/core/readouts.ts';
import { TEMPLATES } from '../src/core/templates/registry.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXPECTED_COVERAGE = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
const UNCOVERED_SAMPLE = ['D1', 'D6', 'M1', 'S3'];

let assertions = 0;
const failures = [];

function ok(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}

function loadExample(relPath) {
  return JSON.parse(readFileSync(root + relPath, 'utf8'));
}

function checkString(field, label) {
  ok(typeof field === 'string' && field.trim().length > 0, `${label} 不得为空`);
}

function inspect(report, label) {
  ok(report !== null, `${label}：应产出体检报告，实际 null`);
  if (!report) return;
  ok(
    report.readings.length >= 2,
    `${label}：至少 2 项读数核对，实际 ${report.readings.length}`,
  );
  for (const item of report.readings) {
    checkString(item.label, `${label} reading.label`);
    checkString(item.value, `${label}/${item.label} value`);
    checkString(item.expect, `${label}/${item.label} expect`);
    checkString(item.note, `${label}/${item.label} note`);
    ok(item.kind === 'strict' || item.kind === 'typical', `${label}/${item.label}：kind 非法`);
    ok(
      !/NaN|Infinity|undefined|null/.test(item.value),
      `${label}/${item.label}：读数里出现了非法值「${item.value}」`,
    );
    if (item.kind === 'strict') {
      ok(item.ok, `${label}/${item.label}：strict 关系不成立（读数 ${item.value}，期望 ${item.expect}）`);
    }
  }
  for (const row of report.approximations) {
    checkString(row.label, `${label} approx.label`);
    checkString(row.note, `${label}/${row.label} note`);
    ok(Number.isFinite(row.errorPct), `${label}/${row.label}：errorPct 非有限`);
    ok(row.ok, `${label}/${row.label}：实测偏差 ${row.errorPct.toExponential(2)}% 超出可解释范围`);
    ok(
      !/NaN|Infinity|undefined|null/.test(row.exact) &&
        !/NaN|Infinity|undefined|null/.test(row.approx),
      `${label}/${row.label}：对照值里出现了非法值`,
    );
  }
}

/* ① 覆盖面对齐 */
ok(
  JSON.stringify([...READOUT_TEMPLATES].sort()) === JSON.stringify([...EXPECTED_COVERAGE].sort()),
  `覆盖题型应与 [${EXPECTED_COVERAGE.join(', ')}] 一致，实际 [${READOUT_TEMPLATES.join(', ')}]`,
);

/* ② 全部快照（含组态变体）*/
let snapshots = 0;
for (const entry of TEMPLATES) {
  if (!READOUT_TEMPLATES.includes(entry.id)) continue;
  const paths = [entry.example, ...(entry.variants ?? []).map((variant) => variant.example)].filter(Boolean);
  ok(paths.length > 0, `${entry.id}：没有可用的示例快照`);
  for (const path of paths) {
    const solution = loadExample(path);
    const before = JSON.stringify(solution);
    const report = buildReadouts(solution);
    inspect(report, `${path}`);
    ok(JSON.stringify(solution) === before, `${path}：buildReadouts 改动了 solution`);
    snapshots += 1;
  }
}

/* ③ 参数扫描：改一个参数就重算一遍，strict 关系必须在整片邻域内都成立 */
let sweeps = 0;
let skipped = 0;
for (const entry of TEMPLATES) {
  if (!READOUT_TEMPLATES.includes(entry.id) || !entry.example) continue;
  const base = loadExample(entry.example).parsed_given;
  const solverModule = await entry.solver();
  const numericKeys = Object.keys(base).filter((key) => typeof base[key] === 'number');
  for (const key of numericKeys) {
    for (const factor of [2, 0.5]) {
      const input = { ...base, [key]: base[key] * factor };
      let solution;
      try {
        solution = solverModule.default(input);
      } catch {
        // 参数落到该型不接受的区间（例如把 Re 除爆）属正常拒答，不计失败。
        skipped += 1;
        continue;
      }
      const report = buildReadouts(solution);
      if (!report) {
        failures.push(`${entry.id}: ${key}×${factor} 后体检报告消失`);
        continue;
      }
      for (const item of report.readings) {
        if (item.kind !== 'strict') continue;
        ok(
          item.ok,
          `${entry.id}（${key}×${factor}）：strict「${item.label}」不成立（${item.value} vs ${item.expect}）`,
        );
      }
      for (const row of report.approximations) {
        ok(
          row.ok,
          `${entry.id}（${key}×${factor}）：近似「${row.label}」偏差 ${row.errorPct.toExponential(2)}% 无法由预期解释`,
        );
      }
      sweeps += 1;
    }
  }
}

/* ④ 未登记题型必须整块缺席，而不是留一张空卡 */
for (const id of UNCOVERED_SAMPLE) {
  const entry = TEMPLATES.find((item) => item.id === id);
  if (!entry?.example) continue;
  ok(buildReadouts(loadExample(entry.example)) === null, `${id}：未登记规则却产出了体检报告`);
}

/* ⑤ 边界用例：近似域外不给近似行，近似失效时必须当场标出来 */
const solveWith = async (id, override) => {
  const entry = TEMPLATES.find((item) => item.id === id);
  const base = loadExample(entry.example).parsed_given;
  const solver = (await entry.solver()).default;
  return { report: buildReadouts(solver({ ...base, ...override })), base };
};

{
  // T ≈ 1：结果页本来就把 1/β 藏起来不给结论，体检也不能单独把它端出来。
  const { report } = await solveWith('A7', { A: 1000, beta: 0.001 });
  ok(report !== null, 'A7 超域：应仍有读数体检');
  ok(
    !report.approximations.some((row) => row.label.includes('深度负反馈')),
    'A7 超出近似域（T<100）时不得列出深度负反馈近似',
  );
  ok(
    report.readings.some((item) => !item.ok && item.label.includes('环路增益')),
    'A7 超出近似域时，环路增益一行必须标为偏离',
  );
}

{
  // Rc 大到与 ro 同量级：忽略 ro 的误差到 9%，必须从「可用」变成「偏离」。
  const { report } = await solveWith('A3', { Rc: 100_000, Re: 100_000 });
  const row = report.approximations.find((item) => item.label.includes('忽略 ro'));
  ok(Boolean(row), 'A3 大 Rc：应有「忽略 ro」的近似行');
  ok(row && !row.ok, 'A3 Rc=100k 时忽略 ro 的实测偏差已超 5%，必须标为偏离');
}

const total = assertions;
if (failures.length > 0) {
  console.error(`check:readouts 未通过 ${failures.length}/${total} 项：`);
  for (const failure of failures.slice(0, 20)) console.error(`  ✗ ${failure}`);
  if (failures.length > 20) console.error(`  … 另 ${failures.length - 20} 项`);
  process.exit(1);
}
console.log(
  `check:readouts 通过 ${total} 项：覆盖 ${READOUT_TEMPLATES.length} 型 · 快照 ${snapshots} 份 · 扫描 ${sweeps} 次${skipped ? ` · 拒答跳过 ${skipped} 次` : ''}`,
);
