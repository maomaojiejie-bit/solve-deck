/**
 * 生成预置示例：node scripts/build-example.mjs <ID> [--config=<组态>] [--id=<输出 id>]
 * 每个 ready 题型一个 builder；validatedAt 由本次构建写入。
 * --id 用于把同一模板的某个组态写成常驻变体快照（如 A3-CB）。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION } from '../src/core/types.ts';
import { validateSolution } from '../src/confidence/buildtime/validate.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const id = process.argv[2] ?? 'D2';
const outputArg = process.argv.find((arg) => arg.startsWith('--id='))?.split('=')[1];
const outputId = outputArg ?? id;
// 允许小写：变体 id 要能直接当路由用（如 M3-cantilever），A3-CB 那种全大写也照旧支持
if (!/^[A-Z][0-9A-Za-z-]*$/.test(outputId)) {
  console.error(`--id 非法：${outputId}（必须以大写字母开头，只允许字母/数字/连字符）`);
  process.exit(1);
}
const configArg = process.argv.find((arg) => arg.startsWith('--config='))?.split('=')[1];
const LEGAL_CONFIG = {
  A3: ['CE', 'CB', 'CC'],
  A5: ['CS', 'CG', 'CD'],
  M3: ['cantilever'],
  // S1 的三个组态是「静定 / 静不定 / 机构」，只能靠变体切换（滑杆造不出机构）
  S1: ['static', 'indeterminate', 'mechanism'],
};
if (configArg && (!LEGAL_CONFIG[id] || !LEGAL_CONFIG[id].includes(configArg))) {
  console.error(`${id} 不支持 config=${configArg}；可用：${(LEGAL_CONFIG[id] ?? []).join(', ') || '无'}`);
  process.exit(1);
}

const builders = {
  D1: async () => {
    const { solveD1 } = await import('../src/core/templates/digital/D1.ts');
    const input = { variables: 'ABCD', minterms: '0,1,2,3,4,6' };
    return { base: solveD1(input), input };
  },
  D2: async () => {
    const { D2_NETLIST, solveD2 } = await import('../src/core/templates/digital/D2.ts');
    return { base: solveD2(D2_NETLIST), input: D2_NETLIST };
  },
  D3: async () => {
    const { solveD3 } = await import('../src/core/templates/digital/D3.ts');
    const input = { op: 'mux2' };
    return { base: solveD3(input), input };
  },
  D4: async () => {
    const { solveD4 } = await import('../src/core/templates/digital/D4.ts');
    const input = { ff: 'JK', q0: 0, j: '1011', k: '0101' };
    return { base: solveD4(input), input };
  },
  D5: async () => {
    const { solveD5 } = await import('../src/core/templates/digital/D5.ts');
    const input = { kind: 'seq-detector', pattern: '101', input: '1011010' };
    return { base: solveD5(input), input };
  },
  A1: async () => {
    const { solveA1 } = await import('../src/core/templates/analog/A1.ts');
    const input = { mode: 'series', Vs: 5, R: 1000, Vf: 0.7, Rz: 10 };
    return { base: solveA1(input), input };
  },
  A2: async () => {
    const { solveA2 } = await import('../src/core/templates/analog/A2.ts');
    const input = {};
    return { base: solveA2(input), input };
  },
  A3: async () => {
    const { solveA3 } = await import('../src/core/templates/analog/A3.ts');
    const input = { config: configArg ?? 'CE' };
    return { base: solveA3(input), input };
  },
  A4: async () => {
    const { solveA4 } = await import('../src/core/templates/analog/A4.ts');
    const input = {};
    return { base: solveA4(input), input };
  },
  A5: async () => {
    const { solveA5 } = await import('../src/core/templates/analog/A5.ts');
    const input = { config: configArg ?? 'CS' };
    return { base: solveA5(input), input };
  },
  A6: async () => {
    const { solveA6 } = await import('../src/core/templates/analog/A6.ts');
    const input = {};
    return { base: solveA6(input), input };
  },
  A7: async () => {
    const { solveA7 } = await import('../src/core/templates/analog/A7.ts');
    const input = {};
    return { base: solveA7(input), input };
  },
  M1: async () => {
    const { solveM1 } = await import('../src/core/templates/mechanics/M1.ts');
    const input = { L: 1, A: 200, P: 40, E: 200, allow: 160 };
    return { base: solveM1(input), input };
  },
  M2: async () => {
    const { solveM2 } = await import('../src/core/templates/mechanics/M2.ts');
    const input = { L: 1, d: 40, T: 1, G: 80, allow: 40 };
    return { base: solveM2(input), input };
  },
  M3: async () => {
    const { solveM3 } = await import('../src/core/templates/mechanics/M3.ts');
    // 变体的参数与 registry 里 variant.params 保持一致（p3 会用同一份输入复算）
    const input =
      configArg === 'cantilever'
        ? { config: 'cantilever', L: 2, a: 1, P: 10, q: 0 }
        : { L: 4, a: 2, P: 20, q: 0 };
    return { base: solveM3(input), input };
  },
  M4: async () => {
    const { solveM4 } = await import('../src/core/templates/mechanics/M4.ts');
    const input = { L: 4, a: 2, P: 20, b: 100, h: 200, allow: 160 };
    return { base: solveM4(input), input };
  },
  M5: async () => {
    const { solveM5 } = await import('../src/core/templates/mechanics/M5.ts');
    const input = { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 };
    return { base: solveM5(input), input };
  },
  M6: async () => {
    const { solveM6 } = await import('../src/core/templates/mechanics/M6.ts');
    const input = { sx: 100, sy: -20, txy: 40, allow: 160 };
    return { base: solveM6(input), input };
  },
  M7: async () => {
    const { solveM7 } = await import('../src/core/templates/mechanics/M7.ts');
    const input = { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 };
    return { base: solveM7(input), input };
  },
  M8: async () => {
    const { solveM8 } = await import('../src/core/templates/mechanics/M8.ts');
    const input = { L: 2, d: 140, Pn: 150, Pt: 8, T: 0.5, allow: 160 };
    return { base: solveM8(input), input };
  },
  S1: async () => {
    const { solveS1 } = await import('../src/core/templates/statics/S1.ts');
    const input = { L: 4, a: 2, P: 10, config: configArg ?? 'static' };
    return { base: solveS1(input), input };
  },
  S2: async () => {
    const { solveS2 } = await import('../src/core/templates/statics/S2.ts');
    const input = { F1: 100, th1: 30, F2: 100, th2: 150 };
    return { base: solveS2(input), input };
  },
  S3: async () => {
    const { solveS3 } = await import('../src/core/templates/statics/S3.ts');
    const input = { L: 3, x1: 1, P1: 10, x2: 2, P2: 20 };
    return { base: solveS3(input), input };
  },
  S4: async () => {
    const { solveS4 } = await import('../src/core/templates/statics/S4.ts');
    const input = { mu: 0.3, W: 200, alpha: 30, beta: 10 };
    return { base: solveS4(input), input };
  },
  S5: async () => {
    const { solveS5 } = await import('../src/core/templates/statics/S5.ts');
    const input = { L: 2, H: 1, P: 10 };
    return { base: solveS5(input), input };
  },
  S6: async () => {
    const { solveS6 } = await import('../src/core/templates/statics/S6.ts');
    const input = { bf: 100, tf: 20, bw: 20, hw: 100 };
    return { base: solveS6(input), input };
  },
  S7: async () => {
    const { solveS7 } = await import('../src/core/templates/statics/S7.ts');
    const input = { a: 0.4, b: 0.6, W: 100 };
    return { base: solveS7(input), input };
  },
  D6: async () => {
    const { solveD6 } = await import('../src/core/templates/digital/D6.ts');
    const input = { op: 'convert', value: 172, bits: 8 };
    return { base: solveD6(input), input };
  },
};

const builder = builders[id];
if (!builder) {
  console.error(`未知示例 ${id}；可用：${Object.keys(builders).join(', ')}`);
  process.exit(1);
}

const { base, input } = await builder();
const confidence = validateSolution(base, input);
if (!confidence.allPassed) {
  // 「拒绝态」快照（S1 静不定 / 机构）本来就该 allPassed=false：判据不过 ⇒ 三路径与边界如实 fail。
  // 但范围 / 输入 / 夹具三项必须仍然 pass，否则说明不是「拒绝」而是「算错」，不许写。
  const refused = ['indeterminate', 'out-of-scope'].includes(String(base.result.status));
  const clean =
    refused && confidence.scopeOk === 'pass' && confidence.inputOk === 'pass' && confidence.goldenOk === 'pass';
  if (clean) {
    console.warn(
      `${id} 拒绝态快照（status=${base.result.status}）：判据不过，三路径 / 边界如实记为 fail，仍写入`,
    );
  } else {
    console.error(
      `${id} 校验未通过：failed=${confidence.failedCount} skipped=${confidence.skippedCount}`,
    );
    for (const item of confidence.checks) {
      if (item.state !== 'pass') console.error(`- ${item.name}: ${item.state} ${item.detail}`);
    }
    process.exit(1);
  }
}
const solution = {
  ...base,
  confidence,
  validatedAt: new Date().toISOString(),
  contractVersion: CONTRACT_VERSION,
  warnings: base.warnings,
};
writeFileSync(
  join(root, 'src', 'examples', `${outputId}.json`),
  `${JSON.stringify(solution, null, 2)}\n`,
  'utf8',
);
console.log(
  `${outputId}.json written${configArg ? ` (config=${configArg})` : ''}: allPassed=${confidence.allPassed} failed=${confidence.failedCount} skipped=${confidence.skippedCount}`,
);