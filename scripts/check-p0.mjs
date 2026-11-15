/**
 * P0/P1 契约门禁（不是产品代码）。
 *
 * 只用真实产物做判断：
 *  - 注册表 / 图元表由 TS 模块直接导入，不复制第二份数据；
 *  - SVG 读取落盘文件，逐项核对 viewBox / 内部 id / 无文字 / 单色 2px；
 *  - D2 示例的真值表用独立布尔式 AB + !C 复算，不复用示例里的答案；
 *  - 题型清单是脚本内的独立列表（设计稿第 2 节），防止注册表少登记；
 *  - 契约不变量用合成坏数据自测，避免“当前没有 ready 就永远不咬”。
 *
 * 运行：npm run check:p0
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPLATES,
  SCOPE_WHITELIST,
  getTemplate,
  assertSolutionContract,
  assertTemplateEntry,
} from '../src/core/templates/registry.ts';
import { SYMBOL_REGISTRY } from '../src/core/symbols/symbolRegistry.ts';
import {
  BOOLEAN,
  ANALOG,
  MECHANICS,
  STATICS,
  FORMULA_CONDITIONS,
} from '../src/core/physicsConstants.ts';
import {
  reactionUnknownCount,
  boundaryMoment,
  mosRegion,
  collectorCurrent,
  flipDeviceSigns,
} from '../src/confidence/physicsValidator.ts';
import { goldenCount } from '../src/confidence/goldenSet/index.ts';
import { CONTRACT_VERSION } from '../src/core/types.ts';
import { solveD1 } from '../src/core/templates/digital/D1.ts';
import { solveD4 } from '../src/core/templates/digital/D4.ts';

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

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(actual, expected, label) {
  const a = [...actual].sort().join(',');
  const e = [...expected].sort().join(',');
  must(a === e, `${label} 不一致\n  实际: ${a}\n  期望: ${e}`);
}

function expectThrow(label, fn, fragment) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    must(message.includes(fragment), `${label}：错误信息不含“${fragment}”\n  实际: ${message}`);
    return;
  }
  throw new Error(`${label}：坏数据未被拒绝`);
}

/* ── 1. 题型注册表 ─────────────────────────────────────────────── */

const EXPECTED_TEMPLATE_IDS = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
];

check('注册表：28 个 templateId 与第 2 节逐项一致', () => {
  must(TEMPLATES.length === 28, `实际 ${TEMPLATES.length} 个`);
  sameSet(TEMPLATES.map((entry) => entry.id), EXPECTED_TEMPLATE_IDS, 'templateId');
});

check('注册表：状态 / 示例 / 28 型三路径 / 判据', () => {
  for (const entry of TEMPLATES) {
    must(entry.paths.length === 3, `${entry.id} paths 应 3 条，实际 ${entry.paths.length}`);
    must(new Set(entry.paths.map((path) => path.id)).size === 3, `${entry.id} path id 重复`);
    must(
      new Set(entry.paths.map((path) => path.principle)).size === 3,
      `${entry.id} path principle 未两两不同`,
    );
    must(
      entry.paths.every((path) => typeof path.intermediate === 'string' && path.intermediate.length > 0),
      `${entry.id} 存在空 intermediate`,
    );
    must(
      new Set(entry.paths.map((path) => path.intermediate)).size === 3,
      `${entry.id} path intermediate 未两两不同`,
    );
    must(entry.criterion.trim().length > 0, `${entry.id} 判据为空`);

    if (entry.status === 'planned') {
      must(!entry.solver && entry.golden.length === 0 && !entry.example, `${entry.id} planned 却带产物`);
    }
    if (entry.status === 'example-only') {
      must(entry.example, `${entry.id} example-only 无示例`);
    }
  }
  const d2Entry = getTemplate('D2');
  must(d2Entry.example === 'src/examples/D2.json', 'D2 示例路径不符');
  must(d2Entry.status === 'ready', `D2 status 应为 ready，实际 ${d2Entry.status}`);
  must(typeof d2Entry.solver === 'function', 'D2 solver 必须为真函数');
  must(d2Entry.golden.includes('D2-01'), 'D2 必须登记夹具 D2-01');
  must(d2Entry.golden.length === 3, `D2 T1 应有 3 道夹具，实际 ${d2Entry.golden.length}`);
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) {
    const entry = getTemplate(id);
    must(entry.status === 'ready', `${id} 应为 ready`);
    must(typeof entry.solver === 'function', `${id} solver 必须为懒载函数`);
    must(entry.example === `src/examples/${id}.json`, `${id} 示例路径不符`);
  }
  const d6 = getTemplate('D6');
  must(d6.renderType === null, 'D6 renderType 应为 null');
  must(typeof d6.figurelessReason === 'string' && d6.figurelessReason.length > 0, 'D6 缺少 figurelessReason');
  must(getTemplate('M7').renderType === 'beam', 'M7 renderType 应为 beam');
  must(getTemplate('S6').renderType === 'freebody', 'S6 renderType 应为 freebody');
  must(SCOPE_WHITELIST.length === 28, `scopeGate 应放行 28 型，实际 ${SCOPE_WHITELIST.length}`);
  must(goldenCount() === 60, `黄金夹具应为 60 道，实际 ${goldenCount()}`);
});

/* ── 2. 图元注册表与 SVG 落盘 ─────────────────────────────────── */

const EXPECTED_SYMBOL_COUNT = 44;

function listSvgFiles() {
  const base = join(root, 'public', 'symbols');
  const files = [];
  for (const family of ['electronics', 'mechanics']) {
    for (const name of readdirSync(join(base, family))) {
      if (name.endsWith('.svg')) files.push(`${family}/${name}`);
    }
  }
  return files;
}

check(`图元：${EXPECTED_SYMBOL_COUNT} 个 SymbolDef，文件全部落盘且无孤儿`, () => {
  must(SYMBOL_REGISTRY.length === EXPECTED_SYMBOL_COUNT, `实际 ${SYMBOL_REGISTRY.length} 个`);
  const declared = new Set(SYMBOL_REGISTRY.map((def) => def.file));
  const onDisk = new Set(listSvgFiles());
  sameSet(declared, onDisk, 'SymbolDef.file 与 public/symbols 落盘文件');
});

check('图元 SVG：viewBox / 无文字 / 单色 2px / 内部 id 完整 / 零外链', () => {
  for (const def of SYMBOL_REGISTRY) {
    const file = join(root, 'public', 'symbols', def.file);
    must(existsSync(file), `${def.id} 缺文件 ${def.file}`);
    const text = readFileSync(file, 'utf8');

    must(/^<svg\s/.test(text), `${def.id} 根元素不是 svg`);
    const rootTag = text.match(/^<svg\s([^>]*)>/)?.[1] ?? '';
    const viewBox = rootTag.match(/viewBox="([^"]+)"/)?.[1];
    must(viewBox === def.viewBox.join(' '), `${def.id} viewBox=${viewBox}，注册表=${def.viewBox.join(' ')}`);

    must(!/<text[\s>]/.test(text), `${def.id} 含 <text>`);
    must(!/<tspan[\s>]/.test(text), `${def.id} 含 <tspan>`);
    must(!/<image[\s>]/.test(text), `${def.id} 含 <image>`);
    must(!/<script[\s>]/.test(text), `${def.id} 含 <script>`);

    for (const match of text.matchAll(/\sfill="([^"]*)"/g)) {
      must(match[1] === 'none', `${def.id} 出现 fill="${match[1]}"`);
    }
    for (const match of text.matchAll(/\sstroke="([^"]*)"/g)) {
      must(match[1] === '#000', `${def.id} 出现 stroke="${match[1]}"`);
    }
    for (const match of text.matchAll(/\sstroke-width="([^"]*)"/g)) {
      must(match[1] === '2', `${def.id} 出现 stroke-width="${match[1]}"`);
    }

    const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    must(new Set(ids).size === ids.length, `${def.id} 内部 id 重复`);
    for (const id of def.highlightable) {
      must(ids.includes(id), `${def.id} highlightable 指向不存在的 id "${id}"`);
    }

    const withoutXmlns = text.replace('xmlns="http://www.w3.org/2000/svg"', '');
    must(!/https?:\/\//.test(withoutXmlns), `${def.id} 含外部 URL`);
    must(!/url\(/.test(withoutXmlns), `${def.id} 含 url(...) 引用`);
    must(!/<use[\s>]/.test(text), `${def.id} 含 <use>`);
  }
});

/* ── 3. 常量与符号约定 ───────────────────────────────────────── */

const REQUIRED_FORMULA_KEYS = {
  BOOLEAN: ['demorgan', 'absorption', 'consensus', 'shannon', 'gray', 'qmcMerge'],
  ANALOG: ['diode', 'gd', 'bjt', 'rpi', 'mosTriode', 'mosSat', 'gmMos', 'opamp', 'feedback'],
  MECHANICS: ['beam', 'bending', 'axial', 'torsion', 'mohr', 'tresca', 'vonMises', 'euler', 'section', 'hermiteKe'],
  STATICS: ['equilibrium', 'reactions', 'friction', 'centroid', 'virtualWork', 'trussLocalK'],
};

check('physicsConstants：8.2 公式键逐组齐全且非空', () => {
  const groups = { BOOLEAN, ANALOG, MECHANICS, STATICS };
  for (const [groupName, keys] of Object.entries(REQUIRED_FORMULA_KEYS)) {
    const group = groups[groupName];
    sameSet(Object.keys(group), keys, `${groupName} 键`);
    for (const key of keys) must(String(group[key]).length > 0, `${groupName}.${key} 为空`);
  }
  must(Object.keys(FORMULA_CONDITIONS).length >= 12, '适用条件少于 12 条');
});

check('physicsValidator：8.1 支座 / 边界 / MOS 判据可用', () => {
  must(reactionUnknownCount('pin') === 2, 'pin 未知量应为 2');
  must(reactionUnknownCount('roller') === 1, 'roller 未知量应为 1');
  must(reactionUnknownCount('fixed') === 3, 'fixed 未知量应为 3');
  must(reactionUnknownCount('cable') === 1, 'cable 未知量应为 1');
  must(reactionUnknownCount('smooth') === 1, 'smooth 未知量应为 1');
  must(boundaryMoment('free') === 0, '自由端 M 应为 0');
  must(boundaryMoment('pin') === 0, '铰端 M 应为 0');
  must(boundaryMoment('roller') === 0, '滚支端 M 应为 0');
  must(boundaryMoment('fixed', 7) === 7, '固定端 M 应等于作用弯矩');

  must(mosRegion(0.5, 5, 1, 'n') === 'cutoff', 'NMOS 截止判据错');
  must(mosRegion(3, 1, 1, 'n') === 'triode', 'NMOS 三极管区判据错');
  must(mosRegion(3, 5, 1, 'n') === 'saturation', 'NMOS 饱和区判据错');
  must(mosRegion(-3, -1, -1, 'p') === 'triode', 'PMOS 三极管区判据错');
  must(mosRegion(-3, -5, -1, 'p') === 'saturation', 'PMOS 饱和区判据错');

  must(Math.abs(collectorCurrent(100, 0.00002) - 0.002) < 1e-12, 'IC=βIB 计算错');
  const flipped = flipDeviceSigns({ IC: 1, VCE: 5 });
  must(flipped.IC === -1 && flipped.VCE === -5, 'PNP/PMOS 符号反转错');
});

/* ── 4. D2 预置示例（v2 契约） ───────────────────────────────── */

const d2 = JSON.parse(readFileSync(join(root, 'src', 'examples', 'D2.json'), 'utf8'));
const d2Entry = getTemplate('D2');

check('D2 示例：render_specs 数组 / role / table 图', () => {
  must(d2.templateId === 'D2' && d2.subject === 'digital', 'D2 标识不符');
  must(d2Entry.status === 'ready', 'D2 状态应为 ready');
  must(Array.isArray(d2.render_specs) && d2.render_specs.length === 2, 'D2 应有 2 张图');
  must(d2.render_specs[0].id === 'main', '第一张图 id 应为 main');
  must(d2.render_specs[0].role === 'primary', 'main 应为 primary');
  must(d2.render_specs[0].type === 'schematic', 'main 应为 schematic');
  must(d2.render_specs[1].id === 'truth', '第二张图 id 应为 truth');
  must(d2.render_specs[1].role === 'secondary', 'truth 应为 secondary');
  must(d2.render_specs[1].type === 'table', 'truth 应为 table');
  must(d2.render_specs[1].table?.rows?.length === 8, 'table 应有 8 行');

  must(Array.isArray(d2.steps) && d2.steps.length === 5, 'D2 应有 5 步');
  d2.steps.forEach((step, index) => {
    must(step.i === index, `step ${index} 的 i=${step.i}`);
    for (const field of ['title', 'formula_tex', 'substitution', 'value', 'basis']) {
      must(typeof step[field] === 'string' && step[field].length > 0, `step ${index} 缺 ${field}`);
    }
    must(step.highlight.length > 0, `step ${index} 无高亮`);
  });

  must(!('frames' in d2), 'Solution 顶层不得出现 frames 键');
  must(d2.render_specs[0].frames.length === 5, 'main.frames 应为 5 帧');
  must(d2.render_specs[1].frames.length === 5, 'truth.frames 应为 5 帧');
  for (const spec of d2.render_specs) {
    spec.frames.forEach((frame, index) => {
      must(frame.stepIndex === index, `${spec.id} frame ${index} stepIndex 错`);
    });
  }
});

check('D2 示例：跨图 id 唯一 / 高亮与帧引用存在', () => {
  assertSolutionContract(d2);
});

check('D2 示例：真值表由 AB + !C 独立复算', () => {
  const table = d2.render_specs.find((spec) => spec.type === 'table')?.table;
  must(table, '缺 table');
  must(table.inputs.length === 3 && table.outputs.length === 1, '真值表列数错');
  must(table.rows.length === 8, `真值表行数 ${table.rows.length}`);

  const minterms = [];
  table.rows.forEach((row, index) => {
    const bits = [(index >> 2) & 1, (index >> 1) & 1, index & 1];
    must(JSON.stringify(row.in) === JSON.stringify(bits), `第 ${index} 行输入不是二进制顺序`);
    const [a, b, c] = row.in.map(Boolean);
    const expected = Number((a && b) || !c);
    must(row.out[0] === expected, `第 ${index} 行 F 应为 ${expected}，实际 ${row.out[0]}`);
    if (expected === 1) minterms.push(index);
  });

  const ones = table.rows.filter((row) => row.out[0] === 1).length;
  must(d2.result.minterms === `Σm(${minterms.join(',')})`, `minterms 应为 Σm(${minterms.join(',')})`);
  must(d2.result.ones === ones, `result.ones 应为 ${ones}`);
  must(d2.result.zeros === 8 - ones, `result.zeros 应为 ${8 - ones}`);
  must(d2.result.expression === "F = A·B + C'", 'result.expression 不符');
  must(typeof d2.validatedAt === 'string' && !Number.isNaN(Date.parse(d2.validatedAt)), 'D2 validatedAt 非法');
  must(d2.contractVersion === CONTRACT_VERSION, `D2 contractVersion 应为 ${CONTRACT_VERSION}`);
});

check('D2 示例：置信度三态 / 六项 pass / allPassed', () => {
  const confidence = d2.confidence;
  const flagNames = ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk'];
  must(!('dualConsistent' in confidence), '旧字段 dualConsistent 不应存在');
  for (const flag of flagNames) must(confidence[flag] === 'pass', `${flag} 应为 pass`);
  must(confidence.checks.length === 6, 'confidence.checks 应有 6 项');
  for (const item of confidence.checks) {
    must(item.state === 'pass', `${item.name} 应为 pass`);
  }

  const failed = confidence.checks.filter(
    (item) => item.state === 'fail' || (item.state === 'skipped' && !item.skipReason),
  ).length;
  const skipped = confidence.checks.filter(
    (item) => item.state === 'skipped' && item.skipReason,
  ).length;
  const expectedAllPassed = failed === 0 && skipped <= Math.floor(6 / 2);
  must(confidence.failedCount === failed, `failedCount 应为 ${failed}`);
  must(confidence.skippedCount === skipped, `skippedCount 应为 ${skipped}`);
  must(confidence.allPassed === expectedAllPassed, `allPassed 应为 ${expectedAllPassed}`);
  must(confidence.allPassed === true, 'D2 已校验，allPassed 必须为 true');
  must(confidence.failedCount === 0, 'D2 failedCount 应为 0');
  must(confidence.skippedCount === 0, 'D2 skippedCount 应为 0');
});

/* ── 5. 契约不变量自测（合成坏数据） ─────────────────────────── */

const VALID_ENTRY = {
  id: 'D9',
  subject: 'digital',
  title: 'synthetic',
  tier: 'T2',
  renderType: 'schematic',
  paths: [
    { id: 'a', label: 'A', principle: 'p1', intermediate: 'i1' },
    { id: 'b', label: 'B', principle: 'p2', intermediate: 'i2' },
    { id: 'c', label: 'C', principle: 'p3', intermediate: 'i3' },
  ],
  criterion: 'c',
  status: 'ready',
  solver: () => ({}),
  golden: ['g1'],
  example: 'src/examples/D9.json',
  params: [{ key: 'bits', label: '输入', kind: 'bits', defaultValue: [0] }],
};

const emptySpec = (overrides) => ({
  id: 'main',
  role: 'primary',
  type: 'schematic',
  nodes: [],
  edges: [],
  frames: [],
  ...overrides,
});

const emptySolution = (specs) => ({
  templateId: 'D2',
  subject: 'digital',
  parsed_given: {},
  steps: [],
  result: {},
  render_specs: specs,
  confidence: {},
  validatedAt: new Date().toISOString(),
  contractVersion: CONTRACT_VERSION,
  warnings: [],
});

check('契约不变量：ready 三路径 / 跨图 id / table / renderType=null', () => {
  // 先证好数据能过，避免“断言永远抛”的假门禁。
  assertTemplateEntry(VALID_ENTRY);
  assertSolutionContract(emptySolution([emptySpec()]));

  const duplicatePrinciple = {
    ...VALID_ENTRY,
    paths: [
      { id: 'a', label: 'A', principle: 'same', intermediate: 'i1' },
      { id: 'b', label: 'B', principle: 'same', intermediate: 'i2' },
      { id: 'c', label: 'C', principle: 'p3', intermediate: 'i3' },
    ],
  };
  expectThrow('ready 路径原则', () => assertTemplateEntry(duplicatePrinciple), 'principle');

  expectThrow(
    'renderType=null 无理由',
    () => assertTemplateEntry({ ...VALID_ENTRY, renderType: null }),
    'figurelessReason',
  );
  assertTemplateEntry({ ...VALID_ENTRY, renderType: null, figurelessReason: '纯数值' });
  expectThrow(
    '非 null 却填 figurelessReason',
    () => assertTemplateEntry({ ...VALID_ENTRY, figurelessReason: '多余占位' }),
    '不得填 figurelessReason',
  );

  const withTolerance = (tolerance, approximation) => ({
    ...VALID_ENTRY,
    paths: VALID_ENTRY.paths.map((path, index) =>
      index === 2 ? { ...path, tolerance, approximation } : path,
    ),
  });
  assertTemplateEntry(withTolerance(1e-3, '忽略 ro'));
  expectThrow(
    'tolerance 放宽无 approximation',
    () => assertTemplateEntry(withTolerance(1e-3, undefined)),
    'approximation',
  );
  expectThrow(
    'tolerance 达到上限',
    () => assertTemplateEntry(withTolerance(1e-2, '等于关闭校验')),
    '达到上限',
  );

  const twoPathReady = { ...VALID_ENTRY, paths: VALID_ENTRY.paths.slice(0, 2) };
  expectThrow('ready 三路径', () => assertTemplateEntry(twoPathReady), '3 条');

  const duplicateIdSolution = emptySolution([
    emptySpec({ id: 'main', nodes: [{ id: 'dup', x: 0, y: 0, kind: 'input' }] }),
    emptySpec({
      id: 'aux',
      role: 'secondary',
      nodes: [{ id: 'dup', x: 1, y: 1, kind: 'input' }],
    }),
  ]);
  expectThrow('跨图 id', () => assertSolutionContract(duplicateIdSolution), '跨图 id 重复');

  const missingTable = emptySolution([emptySpec({ id: 'table', type: 'table' })]);
  expectThrow('table 必填', () => assertSolutionContract(missingTable), 'type=table 必须带 table');
});

check('x 只出现在允许位置：D1 无关项 / D4 SR 非法态', () => {
  const d1 = solveD1({ variables: 'ABCD', minterms: '1,3,5,7', dontCares: '9,11,13,15' });
  const d1Table = d1.render_specs.find((spec) => spec.type === 'table').table;
  const dc = new Set([9, 11, 13, 15]);
  d1Table.rows.forEach((row, index) => {
    must(!row.in.includes('x'), `D1 第 ${index} 行输入出现 x`);
    must(row.out.includes('x') === dc.has(index), `D1 第 ${index} 行 x 位置不符`);
  });

  const sr = solveD4({ ff: 'SR', q0: 0, s: '00', r: '00' });
  const srTable = sr.render_specs.find((spec) => spec.type === 'table').table;
  for (const row of srTable.rows) {
    must(!row.in.includes('x'), 'D4 输入位置出现 x');
    const invalid = row.in[0] === 1 && row.in[1] === 1; // S,R 在 Q 前
    must(row.out.includes('x') === invalid, `D4 SR 行 ${row.in.join('')} 的 x 标记不符`);
  }
});

/* ── 6. 零外部请求（源码层） ─────────────────────────────────── */

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css|html|json)$/.test(name.name)) out.push(full);
  }
  return out;
}

/**
 * 白名单只有一个文件（R3-2 §5）：`src/core/ai/config.ts`。
 *
 * 这条断言真正要守的是「打开页面绝不外连」，不是「源码里不许出现网址」——
 * 固定配置（地址 / 模型 / key）只在 config.ts 里出现一次，识图默认关，
 * 用户不打开开关、不点按钮，一个请求都不会发。
 * 所以白名单不是免死金牌：config.ts 必须**只是常量表**（零 import、零 fetch），
 * 想往里面塞请求逻辑，这里立刻红。
 */
check('源码层：零 http(s) 运行时请求（唯一白名单 ai/config.ts）', () => {
  const whitelist = 'src/core/ai/config.ts';
  const files = [join(root, 'index.html'), ...walk(join(root, 'src'))];
  /* XML 命名空间是标识符，不是请求：`createElementNS('http://www.w3.org/2000/svg')`
     不会发任何包。剥掉再判，否则导出 SVG 这条正当用法会被误伤。 */
  const XML_NAMESPACE = /https?:\/\/www\.w3\.org\/[\w./-]*/g;
  for (const file of files) {
    const name = relative(root, file).replace(/\\/g, '/');
    if (name === whitelist) continue;
    const text = readFileSync(file, 'utf8');
    must(!/https?:\/\//.test(text.replace(XML_NAMESPACE, '')), `${name} 含外部 URL（白名单只有 ${whitelist}）`);
  }
  must(existsSync(join(root, whitelist)), '白名单指向的 config.ts 不存在');
  const config = readFileSync(join(root, whitelist), 'utf8');
  const imports = [...config.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((hit) => hit[1]);
  must(imports.length === 0, `config.ts 不许 import 任何模块（出现了 ${imports.join(', ')}）`);
  must(!/\bfetch\s*\(|XMLHttpRequest|\baxios\b/.test(config), 'config.ts 里出现了请求代码 —— 它只能是常量表');
  must(/export const AI_CONFIG/.test(config), 'config.ts 里没有 AI_CONFIG，白名单给错文件了');
});

/* ── 汇总 ─────────────────────────────────────────────────────── */

console.log('');
console.log(
  `模板 ${TEMPLATES.length} / 图元 ${SYMBOL_REGISTRY.length} / 夹具 ${goldenCount()} / scope 放行 ${SCOPE_WHITELIST.length}`,
);
if (errors.length > 0) {
  console.error(`\nFAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项`);