// P3 快照生成：对全部算例跑 solveTruss/solveMech，把 Solution3D 序列化进 snapshots-space/*.json。
// 快照是生成物，禁止手改；求解器或算例变更后必须重跑本脚本再跑 check:space-solve。
// 运行：node scripts/build-space-snapshot.mjs
// 注意：NOTICE 与 generatedBy 字符串保持 lab3d 原文——再生快照必须与 lab3d 源快照逐字节一致。
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXAMPLES } from "../src/core/space/examples.ts";
import { EXAMPLES_MECH } from "../src/core/space/examples-mech.ts";
import { solveTruss } from "../src/core/space/solve.ts";
import { solveMech } from "../src/core/space/mech.ts";
import { normalizeSolution, serialize } from "./space-snapshot-lib.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshots-space");
mkdirSync(outDir, { recursive: true });

const NOTICE =
  "生成物，禁止手改。由 scripts/build-snapshot.mjs 产出；求解器/算例变更后重跑 npm run snapshot，并以 npm run check:solve 对账。";

for (const model of EXAMPLES) {
  const sol = normalizeSolution(solveTruss(model));
  const body = { _notice: NOTICE, generatedBy: "scripts/build-snapshot.mjs", solution: sol };
  const file = join(outDir, `${model.id}.json`);
  writeFileSync(file, serialize(body) + "\n", "utf8");
  const kind = sol.refusals ? "拒答" : sol.verified ? "已验证" : "校核未过";
  console.log(`write snapshots-space/${model.id}.json  ${kind}  ${sol.determinacy}`);
}
// Q4 E3 机构快照（新增文件，不动 T/B/C/S 旧快照）
for (const model of EXAMPLES_MECH) {
  const sol = normalizeSolution(solveMech(model));
  const body = { _notice: NOTICE, generatedBy: "scripts/build-snapshot.mjs", solution: sol };
  const file = join(outDir, `${model.id}.json`);
  writeFileSync(file, serialize(body) + "\n", "utf8");
  const kind = sol.refusals ? "拒答" : sol.verified ? "已验证" : "校核未过";
  console.log(`write snapshots-space/${model.id}.json  ${kind}  E3/${model.type}`);
}
console.log(`\nbuild-snapshot: ${EXAMPLES.length + EXAMPLES_MECH.length} 个快照已生成（静力 ${EXAMPLES.length} + 机构 ${EXAMPLES_MECH.length}）`);
