/**
 * P3 校验栈门禁：
 *  - D2 六项全 pass；
 *  - D2.json 与实时 solver + 校验栈逐字段一致（validatedAt 取快照值）；
 *  - D2 懒载 solver 可调用；
 *  - residualOk 只由 maxResidual 推导、MAX_SKIPPED=3 生效。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION } from '../src/core/types.ts';
import { D2_NETLIST, solveD2 } from '../src/core/templates/digital/D2.ts';
import {
  assertSolutionContract,
  getTemplate,
  SCOPE_WHITELIST,
  VARIANT_BY_ID,
} from '../src/core/templates/registry.ts';
import { runPaths } from '../src/confidence/buildtime/paths.ts';
import { validateSolution } from '../src/confidence/buildtime/validate.ts';
import { buildConfidenceReport } from '../src/confidence/confidence.ts';
import { goldenCasesFor } from '../src/confidence/goldenSet/index.ts';
import { runGoldenSet } from '../src/confidence/goldenSet/runner.ts';
import { scopeGate } from '../src/confidence/scopeGate.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`[ok]   ${name}`);
  } catch (error) {
    errors.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`[FAIL] ${name}`);
  }
}

async function checkAsync(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (error) {
    errors.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`[FAIL] ${name}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

const base = solveD2(D2_NETLIST);
const confidence = validateSolution(base, D2_NETLIST);
const existing = JSON.parse(
  readFileSync(join(root, 'src', 'examples', 'D2.json'), 'utf8'),
);
const fresh = {
  ...base,
  confidence,
  validatedAt: existing.validatedAt,
  contractVersion: CONTRACT_VERSION,
  warnings: [],
};

const d2Entry = getTemplate('D2');
let lazyModule = null;
if (typeof d2Entry.solver === 'function') {
  try {
    lazyModule = await d2Entry.solver();
  } catch {
    lazyModule = null;
  }
}

check('P3：D2 六项校验全 pass，allPassed=true', () => {
  const flags = ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk'];
  for (const flag of flags) must(confidence[flag] === 'pass', `${flag}=${confidence[flag]}`);
  must(confidence.failedCount === 0, `failedCount=${confidence.failedCount}`);
  must(confidence.skippedCount === 0, `skippedCount=${confidence.skippedCount}`);
  must(confidence.allPassed === true, 'allPassed 应为 true');
  must(confidence.maxResidual <= 1e-6, `maxResidual=${confidence.maxResidual}`);
});

check('P3：scopeGate 放行六型', () => {
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) {
    must(scopeGate(id).ok, scopeGate(id).detail);
    must(SCOPE_WHITELIST.includes(id), `SCOPE_WHITELIST 缺少 ${id}`);
  }
  must(SCOPE_WHITELIST.length === 28, `白名单应 28 型，实际 ${SCOPE_WHITELIST.length}`);
});

check('P3：D2 懒载 solver 可调用且结果一致', () => {
  must(typeof d2Entry.solver === 'function', 'D2 solver 不是懒载函数');
  must(lazyModule && typeof lazyModule.default === 'function', '懒载模块缺少 default solver');
  const lazySolution = lazyModule.default(D2_NETLIST);
  assert.deepStrictEqual(lazySolution.result, base.result);
});

check('P3：三路径中间量结构不同且全组合一致', () => {
  const result = runPaths(D2_NETLIST);
  must(result.ok, result.detail);
  must(result.maxResidual === 0, `maxResidual=${result.maxResidual}`);
  must(result.levels.length > 0, '路径 B 没有 node-levels');
  must(result.terms.length > 0, '路径 C 没有 sop-terms');
  must(
    new Set([result.pathAIntermediate, result.pathBIntermediate, result.pathCIntermediate]).size === 3,
    '三条 intermediate 不互异',
  );
});

check('P3：D2 三道黄金夹具通过', () => {
  const golden = runGoldenSet('D2');
  must(golden.ok, golden.detail);
  must(golden.cases === 3, `夹具数 ${golden.cases}`);
});

check('P3：D2.json 与实时 solver + 校验栈逐字段一致', () => {
  assertSolutionContract(fresh);
  assert.deepStrictEqual(fresh, existing, 'D2.json 已漂移，请运行 node scripts/build-example.mjs D2');
});

check('P3：skipped 无 skipReason 按 fail 计', () => {
  const bad = buildConfidenceReport(
    [
      { name: 'scopeOk', state: 'pass', detail: '' },
      { name: 'inputOk', state: 'pass', detail: '' },
      { name: 'pathsConsistent', state: 'pass', detail: '' },
      { name: 'residualOk', state: 'pass', detail: '外部塞的 pass 应被丢弃' },
      { name: 'boundaryOk', state: 'skipped', detail: '' },
      { name: 'goldenOk', state: 'pass', detail: '' },
    ],
    0,
  );
  must(bad.failedCount === 1, `failedCount=${bad.failedCount}`);
  must(bad.allPassed === false, '无理由 skipped 不得 allPassed');
  must(bad.residualOk === 'pass', `residualOk=${bad.residualOk}`);
});

check('P3：residualOk 由 maxResidual 推导，外部 pass 无效', () => {
  const report = buildConfidenceReport(
    [
      { name: 'scopeOk', state: 'pass', detail: '' },
      { name: 'inputOk', state: 'pass', detail: '' },
      { name: 'pathsConsistent', state: 'pass', detail: '' },
      { name: 'residualOk', state: 'pass', detail: '外部塞的 pass' },
      { name: 'boundaryOk', state: 'pass', detail: '' },
      { name: 'goldenOk', state: 'pass', detail: '' },
    ],
    1e-3,
  );
  must(report.residualOk === 'fail', `residualOk=${report.residualOk}`);
  must(report.allPassed === false, 'maxResidual=1e-3 不得 allPassed');
});

check('P3：MAX_SKIPPED=3，8 项 4 skipped 不得 allPassed', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    name: `check${index}`,
    state: index < 4 ? 'pass' : 'skipped',
    detail: '',
    skipReason: index < 4 ? undefined : '不适用',
  }));
  const report = buildConfidenceReport(items, 0);
  must(report.skippedCount === 4, `skippedCount=${report.skippedCount}`);
  must(report.allPassed === false, 'skipped=4 时 allPassed 必须 false');
});

const INPUTS = {
  A1: { mode: 'series', Vs: 5, R: 1000, Vf: 0.7, Rz: 10 },
  A2: {},
  A3: { config: 'CE' },
  A4: {},
  A5: { config: 'CS' },
  A6: {},
  A7: {},
  D1: { variables: 'ABCD', minterms: '0,1,2,3,4,6' },
  D2: D2_NETLIST,
  D3: { op: 'mux2' },
  D4: { ff: 'JK', q0: 0, j: '1011', k: '0101' },
  D5: { kind: 'seq-detector', pattern: '101', input: '1011010' },
  D6: { op: 'convert', value: 172, bits: 8 },
  M1: { L: 1, A: 200, P: 40, E: 200, allow: 160 },
  M2: { L: 1, d: 40, T: 1, G: 80, allow: 40 },
  M3: { L: 4, a: 2, P: 20, q: 0 },
  M4: { L: 4, a: 2, P: 20, b: 100, h: 200, allow: 160 },
  M5: { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 },
  M6: { sx: 100, sy: -20, txy: 40, allow: 160 },
  M7: { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 },
  M8: { L: 2, d: 140, Pn: 150, Pt: 8, T: 0.5, allow: 160 },
  S1: { L: 4, a: 2, P: 10, config: 'static' },
  S2: { F1: 100, th1: 30, F2: 100, th2: 150 },
  S3: { L: 3, x1: 1, P1: 10, x2: 2, P2: 20 },
  S4: { mu: 0.3, W: 200, alpha: 30, beta: 10 },
  S5: { L: 2, H: 1, P: 10 },
  S6: { bf: 100, tf: 20, bw: 20, hw: 100 },
  S7: { a: 0.4, b: 0.6, W: 100 },
};

const snapshots = Object.fromEntries(
  ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].map((id) => [
    id,
    JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8')),
  ]),
);

for (const id of ['D1', 'D3', 'D4', 'D5', 'D6', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
  await checkAsync(`P3：${id} 懒载 solver + 校验栈与快照逐字段一致`, async () => {
    const entry = getTemplate(id);
    must(typeof entry.solver === 'function', `${id} solver 不是懒载函数`);
    const module = await entry.solver();
    must(module && typeof module.default === 'function', `${id} 懒载模块缺少 default`);
    const base = module.default(INPUTS[id]);
    const confidence = validateSolution(base, INPUTS[id]);
    for (const flag of ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk']) {
      must(confidence[flag] === 'pass', `${id}.${flag}=${confidence[flag]}`);
    }
    must(confidence.allPassed === true, `${id} allPassed=false`);
    const snapshot = snapshots[id];
    const fresh = {
      ...base,
      confidence,
      validatedAt: snapshot.validatedAt,
      contractVersion: CONTRACT_VERSION,
      warnings: base.warnings,
    };
    assertSolutionContract(fresh);
    assert.deepStrictEqual(fresh, snapshot, `${id}.json 已漂移，请运行 node scripts/build-example.mjs ${id}`);
    const golden = runGoldenSet(id);
    must(golden.ok, `${id} 夹具失败：${golden.detail}`);
    must(golden.cases === entry.golden.length, `${id} 夹具数 ${golden.cases} ≠ 登记 ${entry.golden.length}`);
  });

  check(`P3：${id} 图种 / 无图理由`, () => {
    const entry = getTemplate(id);
    if (entry.renderType === null) {
      must(entry.figurelessReason?.trim().length > 0, `${id} 无 figurelessReason`);
    } else {
      must(entry.figurelessReason === undefined, `${id} 不应有 figurelessReason`);
    }
  });
}

const VARIANTS = [...VARIANT_BY_ID.entries()].map(([id, { entry, variant }]) => ({
  id,
  template: entry.id,
  config: variant.config,
  example: variant.example,
  params: variant.params,
}));

for (const variant of VARIANTS) {
  await checkAsync(`P3：${variant.id} 组态变体快照与实时 solver 一致`, async () => {
    const file = join(root, variant.example);
    must(existsSync(file), `${variant.id} 缺少快照 ${variant.example}`);
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    must(snapshot.templateId === variant.template, `${variant.id} templateId=${snapshot.templateId}`);
    must(
      snapshot.result.config === variant.config,
      `${variant.id} result.config=${snapshot.result.config}，登记 ${variant.config}`,
    );
    // S1 的「静不定 / 机构」变体是**拒绝态**：allPassed 必须是 false，否则就是在假装结论可用
    const refusal = variant.template === 'S1' && variant.config !== 'static';
    must(
      snapshot.confidence?.allPassed === !refusal,
      refusal ? `${variant.id} 拒绝态却 allPassed=true` : `${variant.id} allPassed 不是 true`,
    );

    const entry = getTemplate(variant.template);
    must(typeof entry.solver === 'function', `${variant.template} solver 不是懒载函数`);
    const module = await entry.solver();
    // 变体自带默认参数（悬臂梁与母题简支梁不是一组数），必须一并带上再复算
    const input = { config: variant.config, ...(variant.params ?? {}) };
    const base = module.default(input);
    const confidence = validateSolution(base, input);
    if (refusal) {
      // 拒绝态：判据相关三项必须如实 fail，其余（范围/输入/夹具）照旧 pass
      for (const flag of ['scopeOk', 'inputOk', 'goldenOk']) {
        must(confidence[flag] === 'pass', `${variant.id}.${flag}=${confidence[flag]}`);
      }
      for (const flag of ['pathsConsistent', 'boundaryOk']) {
        must(confidence[flag] === 'fail', `${variant.id}.${flag}=${confidence[flag]}（拒绝态应为 fail）`);
      }
      must(confidence.allPassed === false, `${variant.id} 拒绝态却 allPassed=true`);
    } else {
      for (const flag of ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk']) {
        must(confidence[flag] === 'pass', `${variant.id}.${flag}=${confidence[flag]}`);
      }
      must(confidence.allPassed === true, `${variant.id} allPassed=false`);
    }
    const fresh = {
      ...base,
      confidence,
      validatedAt: snapshot.validatedAt,
      contractVersion: CONTRACT_VERSION,
      warnings: base.warnings,
    };
    assertSolutionContract(fresh);
    assert.deepStrictEqual(
      fresh,
      snapshot,
      `${variant.id}.json 已漂移，请运行 node scripts/build-example.mjs ${variant.template} --config=${variant.config} --id=${variant.id}`,
    );
    must(
      snapshot.render_specs.some((spec) => spec.id === 'main'),
      `${variant.id} 缺少主图 main`,
    );
    // 等效图 pi 是模拟电路的约定，力学变体没有这张图（也不该硬塞一张）
    if (variant.template.startsWith('A')) {
      must(
        snapshot.render_specs.some((spec) => spec.id === 'pi'),
        `${variant.id} 缺少等效图 pi`,
      );
    }
  });
}

await checkAsync('P3：全部 ready 型的黄金夹具输入也通过构建期三路径', async () => {
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) {
    const module = await getTemplate(id).solver();
    for (const item of goldenCasesFor(id)) {
      const confidence = validateSolution(module.default(item.input), item.input);
      // S1 的拒绝态夹具（静不定 / 机构）三路径必须如实 fail，不许凑成 pass。
      // 注意 M7-02 是「超出欧拉适用范围」但三路径仍然照跑（曲线照样算），所以只对 S1 这样要求。
      const refusal =
        item.id.startsWith('S1-') && ['indeterminate', 'out-of-scope'].includes(String(item.expected.status));
      must(
        confidence.pathsConsistent === (refusal ? 'fail' : 'pass'),
        `${item.id}: ${confidence.checks.find((check) => check.name === 'pathsConsistent')?.detail}`,
      );
    }
  }
});

await checkAsync('P3：D6 其余三种 op 的三路径也全 pass', async () => {
  const entry = getTemplate('D6');
  const module = await entry.solver();
  for (const input of [
    { op: 'complement', value: -13, bits: 8 },
    { op: 'add', a: -5, b: 6, bits: 4 },
    { op: 'bcd-ascii', digit: 7 },
  ]) {
    const confidence = validateSolution(module.default(input), input);
    must(
      confidence.pathsConsistent === 'pass',
      `${input.op}: ${confidence.checks.find((item) => item.name === 'pathsConsistent')?.detail}`,
    );
    must(confidence.allPassed === true, `${input.op} allPassed=false`);
  }
});

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项（P3 校验栈）`);
