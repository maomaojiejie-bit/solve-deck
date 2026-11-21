// P3 门禁：snapshots-space/*.json == 实时 solveTruss 结果逐字段一致（防漂移，仿 solve-deck check:p3）。
// 运行：node scripts/check-space-solve.mjs —— 不一致 exit 1。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXAMPLES } from "../src/core/space/examples.ts";
import { EXAMPLES_MECH } from "../src/core/space/examples-mech.ts";
import { solveTruss } from "../src/core/space/solve.ts";
import { solveMech } from "../src/core/space/mech.ts";
import { deepDiff, deserialize, normalizeSolution } from "./space-snapshot-lib.mjs";

const snapDir = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshots-space");

let fails = 0;
for (const model of EXAMPLES) {
  const file = join(snapDir, `${model.id}.json`);
  if (!existsSync(file)) {
    console.error(`FAIL ${model.id}: 缺快照 ${file}（先跑 npm run snapshot）`);
    fails++;
    continue;
  }
  const body = deserialize(readFileSync(file, "utf8"));
  const expected = body.solution;
  const actual = normalizeSolution(solveTruss(model));
  const diffs = deepDiff(expected, actual);
  if (diffs.length) {
    console.error(`FAIL ${model.id}: 快照与实时解不一致（${diffs.length} 处）`);
    for (const d of diffs.slice(0, 10)) console.error(`     ${d}`);
    fails++;
  } else {
    console.log(`ok   ${model.id}: 快照 == 实时解`);
  }
}
// Q4 E3 机构快照对账（solveMech 确定性积分/解析，逐字段一致）
for (const model of EXAMPLES_MECH) {
  const file = join(snapDir, `${model.id}.json`);
  if (!existsSync(file)) {
    console.error(`FAIL ${model.id}: 缺快照 ${file}（先跑 npm run snapshot）`);
    fails++;
    continue;
  }
  const body = deserialize(readFileSync(file, "utf8"));
  const expected = body.solution;
  const actual = normalizeSolution(solveMech(model));
  const diffs = deepDiff(expected, actual);
  if (diffs.length) {
    console.error(`FAIL ${model.id}: 快照与实时解不一致（${diffs.length} 处）`);
    for (const d of diffs.slice(0, 10)) console.error(`     ${d}`);
    fails++;
  } else {
    console.log(`ok   ${model.id}: 快照 == 实时解（E3/${model.type}）`);
  }
}

// 孤儿快照（算例已删/改名但快照残留）同样视为漂移
const known = new Set([...EXAMPLES, ...EXAMPLES_MECH].map((m) => `${m.id}.json`));
for (const f of readdirSync(snapDir)) {
  if (f.endsWith(".json") && !known.has(f)) {
    console.error(`FAIL 孤儿快照 ${f}：无对应算例，请删除或补算例`);
    fails++;
  }
}

console.log(fails === 0 ? "\ncheck-solve: ALL PASS" : `\ncheck-solve: ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
