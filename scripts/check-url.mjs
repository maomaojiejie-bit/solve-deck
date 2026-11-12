/**
 * URL 门禁：13 模板 + 4 变体各拼一条带非默认参数的查询串。
 * 断言「解析出的参数 === 期望值」且「解出的结果与直接传参一致」（数字 1e-12）。
 * 另测非法值回落默认、未知 key 被纠正。
 */
import {
  getTemplate,
  getTemplateRoute,
  VARIANT_BY_ID,
} from '../src/core/templates/registry.ts';
import {
  buildParamQuery,
  buildSolverInput,
  defaultParamValues,
  parseParamQuery,
} from '../src/core/params/query.ts';
import { D2_NETLIST } from '../src/core/templates/digital/D2.ts';
import { homeSolveTarget } from '../src/core/ai/homeRoute.ts';
import { readFileSync } from 'node:fs';

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

function close(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return String(a) === String(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return String(a) === String(b);
  if (a === b) return true;
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b)) <= 1e-12;
}

function sameValues(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!close(a[key], b[key])) return false;
  }
  return true;
}

function sameResult(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!close(a[key], b[key])) return false;
  }
  return true;
}

const CASES = [
  ...[
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
    'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
    'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
  ].map((id) => ({ id, variant: undefined, overrides: {} })),
  ...[
    'A3-CB', 'A3-CC', 'A5-CG', 'A5-CD', 'M3-cantilever', 'S1-indeterminate', 'S1-mechanism',
  ].map((id) => ({ id, variant: id, overrides: {} })),
];

const NON_DEFAULT = {
  A1: { Vs: 6 },
  A2: { Vcc: 15 },
  A3: { Rc: 5_000 },
  A4: { Vdd: 15 },
  A5: { Rd: 5_000 },
  A6: { Aol: 1e5 },
  A7: { beta: 0.02 },
  D1: { bits: [1, 0, 1, 0] },
  D2: { bits: [1, 0, 1] },
  D3: { bits: [1, 0, 0] },
  D4: { jBits: [0, 0, 1, 1] },
  D5: { inputBits: [0, 1, 0, 1, 0, 1, 1] },
  D6: { bits: [1, 0, 1, 0, 1, 1, 0, 1] },
  'A3-CB': { Rc: 5_000 },
  'A3-CC': { Rc: 5_000 },
  'A5-CG': { Rd: 5_000 },
  'A5-CD': { Rd: 5_000 },
  M1: { A: 300 },
  M2: { d: 50 },
  M3: { P: 30 },
  M4: { h: 240 },
  M5: { P: 30 },
  M6: { txy: 50 },
  M7: { P: 200 },
  M8: { Pt: 12.5 },
  'M3-cantilever': { P: 15 },
  S1: { P: 12 },
  S2: { th1: 25 },
  S3: { P2: 25 },
  S4: { alpha: 35 },
  S5: { P: 12 },
  S6: { tf: 25 },
  S7: { a: 0.5 },
  'S1-indeterminate': { P: 12 },
  'S1-mechanism': { P: 12 },
};

for (const item of CASES) {
  await checkAsync(`URL：${item.id} 非默认参数解析与直传一致`, async () => {
    const route = getTemplateRoute(item.id);
    must(route, `找不到路由 ${item.id}`);
    const entry = route.entry;
    const variant = route.variant;
    const params = entry.params ?? [];
    // 变体（M3 悬臂）有自己的默认参数，URL 的「默认」基线要跟着变
    const baseline = variant?.params;
    const values = defaultParamValues(params, baseline);
    Object.assign(values, NON_DEFAULT[item.id] ?? item.overrides);
    must(buildParamQuery(params, values, baseline).length > 0, `${item.id} 没有非默认参数`);
    const query = buildParamQuery(params, values, baseline);
    const parsed = parseParamQuery(params, query, baseline);
    must(!parsed.corrected, `${item.id} 合法查询被标成 corrected：${query}`);
    must(sameValues(parsed.values, values), `${item.id} 解析值不等于期望值`);

    const directInput =
      entry.id === 'D2' ? D2_NETLIST : buildSolverInput(entry, variant?.config, values);
    const parsedInput =
      entry.id === 'D2'
        ? D2_NETLIST
        : buildSolverInput(entry, variant?.config, parsed.values);
    const module = await entry.solver();
    const direct = module.default(directInput);
    const fromUrl = module.default(parsedInput);
    must(sameResult(direct.result, fromUrl.result), `${item.id} 直传与 URL 解析结果不一致`);

    if (entry.id === 'A3' || entry.id === 'A5') {
      for (const key of ['Av', 'Ri', 'Ro']) {
        must(close(direct.result[key], fromUrl.result[key]), `${item.id}.${key} 不一致`);
      }
    }
  });
}

check('URL：非法/越界值回落到默认值并纠正', () => {
  const params = getTemplate('A3').params;
  const parsed = parseParamQuery(params, 'Rc=abc&beta=-5&VA=999&unknown=1');
  const defaults = defaultParamValues(params);
  must(parsed.corrected, '非法查询没有标记 corrected');
  must(sameValues(parsed.values, defaults), '非法查询没有回落到默认值');
  must(parsed.normalized === '', `非法查询没有清空：${parsed.normalized}`);
});

check('URL：bits 长度/字符非法时回落默认', () => {
  const params = getTemplate('D1').params;
  for (const bad of ['bits=10', 'bits=10x0', 'bits=1111111111111111']) {
    const parsed = parseParamQuery(params, bad);
    const defaults = defaultParamValues(params);
    must(parsed.corrected, `${bad} 没有标记 corrected`);
    must(JSON.stringify(parsed.values) === JSON.stringify(defaults), `${bad} 没有回落默认`);
  }
});

/* ════════════ W18-B：遍历式端到端 + 真题三条 + 反例 ════════════
 *
 * 每个入口 × 每个 ParamSpec key：
 *   values → buildParamQuery（URL 串）→ parseParamQuery → buildSolverInput
 *   → 断言 input 终点拿到覆盖值（「URL 一路走到 solver input」的端点判据）
 *   → 断言 result 至少一个字段变化（JSON.stringify 前后不等；比较对象是
 *     result 本体，validatedAt 根本不在比较范围内 —— 快照回退的指纹进不来）。
 *
 * 惰性键白名单（模型属性，不是链路问题；只断言 input 传播并注明原因）：
 *   A1:Vz        默认 series 模态（Vout≈0.74 < Vz∈[3,10]）永远不出稳压管
 *   A2:VCEsat    默认 active 区，饱和压降不进结果
 *   A3/A3-CB:Re  Re 被旁路（直流工作点由 Ic 直接给定），小信号结果不含它
 *   A3-CC:Rc     射随器的小信号不含集电极电阻
 *   A5:Rs/Rss、A5-CG:Rss、A5-CD:Rd  该组态的小信号模型不含这些端电阻
 *   M3-cantilever:L  q=0 时悬臂的反力/内力只依赖 a 与 P（M_A=P·a）
 *
 * D1/D2/D3 是快照管线（页面本就不 live 重解，W18 不改这个设计）：
 *   bits 只断言「URL 串 → values」解析正确，不强求 result 变化。
 */

const RESULT_INERT = new Set([
  'A1:Vz', 'A2:VCEsat', 'A3:Re', 'A3-CB:Re', 'A3-CC:Rc',
  'A5:Rs', 'A5:Rss', 'A5-CG:Rss', 'A5-CD:Rd', 'M3-cantilever:L',
]);

/** 区间约束 key 的显式取值（自动 far() 会越界或撞守卫）。 */
const EXPLICIT_FAR = {
  'S3:x2': 2.8, // x2 < L=3，且与默认 2 拉开
  'M3-cantilever:a': 1.5,
};

function farValue(param) {
  const d = param.defaultValue;
  if (param.kind === 'bits') {
    const bits = Array.isArray(d) ? d : [];
    return bits.map((bit) => (bit ? 0 : 1));
  }
  const span = (param.max ?? d * 2) - (param.min ?? 0);
  const cand = d + (span > 0 ? Math.min(span * 0.4, Math.abs(d) * 0.5 + span * 0.1) : d * 0.5 + 1);
  let value = Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, cand));
  if (value === d) {
    const lo = param.min ?? d * 0.5;
    value = lo !== d ? lo : d + 1;
  }
  return value;
}

const TRAVERSAL_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6',
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
  'A3-CB', 'A3-CC', 'A5-CG', 'A5-CD', 'M3-cantilever',
];

const solverCache = new Map();
async function solverOf(id) {
  if (!solverCache.has(id)) {
    const route = getTemplateRoute(id);
    solverCache.set(id, (await route.entry.solver()).default);
  }
  return solverCache.get(id);
}

for (const id of TRAVERSAL_IDS) {
  const route = getTemplateRoute(id);
  must(route, `遍历：找不到路由 ${id}`);
  const entry = route.entry;
  const variant = route.variant;
  const params = entry.params ?? [];
  const baseline = variant?.params;
  const defaults = defaultParamValues(params, baseline);
  const solve = await solverOf(id);
  const inputOf = (values) => (entry.id === 'D2' ? D2_NETLIST : buildSolverInput(entry, variant?.config, values));
  const baseResult = JSON.stringify(solve(inputOf(defaults)).result);
  for (const param of params) {
    const tag = `${id}:${param.key}`;
    await checkAsync(`遍历 ${tag}：URL 覆盖值走到 solver input 且 result 变化`, async () => {
      const far = EXPLICIT_FAR[tag] ?? farValue(param);
      const values = { ...defaults, [param.key]: far };
      // ① URL 串往返：值不丢、不被纠正
      const query = buildParamQuery(params, values, baseline);
      must(query.includes(`${param.key}=`), `${tag} 没进 URL 串：${query}`);
      const parsed = parseParamQuery(params, query, baseline);
      must(!parsed.corrected, `${tag} 合法覆盖值被标 corrected：${query}`);
      must(close(Number(parsed.values[param.key]), Number(far)), `${tag} URL 解析回读不一致`);
      // ② 链路终点：solver input 拿到覆盖值
      const input = inputOf(parsed.values);
      if (param.kind === 'bits' && ['D4', 'D5', 'D6'].includes(entry.id)) {
        // D4/D5/D6 的 bits 会转成 j/k/input/value 进 input；D1/D2/D3 是快照管线，
        // 页面本就不 live 重解 —— bits 只验 ① 的 URL 解析，不强求进 input。
        must(JSON.stringify(input) !== JSON.stringify(inputOf(defaults)), `${tag} bits 没走到 solver input（j/k/input/value）`);
      } else if (param.kind === 'number') {
        // URL 串按 12 位有效数字往返（toPrecision(12)），input 里是回读值 —— 按容差比
        must(close(Number(input[param.key]), Number(far)), `${tag} 覆盖值没走到 solver input（${JSON.stringify(input[param.key])} ≠ ${far}）——这就是 W18 要抓的断链`);
      }
      // ③ result 变化（快照管线三口除外；惰性键只验 ②，原因见白名单注释）
      if (!['D1', 'D2', 'D3'].includes(entry.id) && !RESULT_INERT.has(tag)) {
        const result = solve(inputOf(parsed.values)).result;
        must(JSON.stringify(result) !== baseResult, `${tag} 改了参数 result 纹丝不动 —— 要么链路断了，要么该键是惰性键但没进白名单`);
      }
    });
  }
}

/* S1 两个变体：无参数 —— 拒绝态不许被参数污染 */
for (const id of ['S1-indeterminate', 'S1-mechanism']) {
  await checkAsync(`遍历 ${id}：拒绝态不被参数污染`, async () => {
    const route = getTemplateRoute(id);
    const entry = route.entry;
    const solve = await solverOf(id);
    const base = solve(buildSolverInput(entry, route.variant?.config, defaultParamValues(entry.params ?? []))).result;
    const dirty = solve(buildSolverInput(entry, route.variant?.config, { ...defaultParamValues(entry.params ?? []), P: 30, L: 6 })).result;
    must(base.status === dirty.status && base.conclusion === dirty.conclusion, `${id} 拒绝态被参数污染了`);
  });
}

/* 真题三条：真实题目 → 真实数字（逐位 / 闭式全精度） */
await checkAsync('真题① M3-cantilever L=3 a=3 P=12 → RA=12 / MA=36 / |M|max=36@0 / M(0)=-36 / Qmin=12', async () => {
  const route = getTemplateRoute('M3-cantilever');
  const parsed = parseParamQuery(route.entry.params ?? [], 'L=3&a=3&P=12', route.variant?.params);
  must(!parsed.corrected, `真题① 查询被纠正：${parsed.normalized}`);
  const solve = await solverOf('M3-cantilever');
  const sol = solve(buildSolverInput(route.entry, route.variant?.config, parsed.values));
  must(sol.result.RA === 12, `真题① RA=${sol.result.RA} ≠ 12`);
  must(sol.result.MA === 36, `真题① MA=${sol.result.MA} ≠ 36`);
  must(sol.result.Mmax === 36, `真题① |M|max=${sol.result.Mmax} ≠ 36`);
  must(sol.result.MmaxX === 0, `真题① |M|max 位置 x=${sol.result.MmaxX} ≠ 0`);
  must(sol.result.Qmin === 12, `真题① Qmin=${sol.result.Qmin} ≠ 12`);
  // M(0)：弯矩图最左点（修复前这里显示的是快照默认算例的 -10）
  const mPanel = (sol.render_specs ?? []).flatMap((spec) => spec.chart?.panels ?? []).find((panel) => panel.id === 'm');
  const m0 = mPanel?.series?.[0]?.points?.[0]?.[1];
  must(m0 === -36, `真题① M(0)=${m0} ≠ -36`);
});

await checkAsync('真题② M3 简支 L=6 a=3 P=20 → RA=RB=10 / Mmax=30@x=3', async () => {
  const route = getTemplateRoute('M3');
  const parsed = parseParamQuery(route.entry.params ?? [], 'L=6&a=3&P=20');
  const solve = await solverOf('M3');
  const sol = solve(buildSolverInput(route.entry, undefined, parsed.values));
  must(sol.result.RA === 10 && sol.result.RB === 10, `真题② RA/RB=${sol.result.RA}/${sol.result.RB} ≠ 10/10`);
  must(sol.result.Mmax === 30, `真题② Mmax=${sol.result.Mmax} ≠ 30`);
  must(sol.result.MmaxX === 3, `真题② Mmax 位置 x=${sol.result.MmaxX} ≠ 3`);
});

await checkAsync('真题③ S5 L=3 H=1.5 P=20 → RA=RB=10 / N_AB=10 / N_AC=N_BC=-14.142136（闭式 -20·√4.5/3 全精度对账）', async () => {
  const route = getTemplateRoute('S5');
  const parsed = parseParamQuery(route.entry.params ?? [], 'L=3&H=1.5&P=20');
  const solve = await solverOf('S5');
  const sol = solve(buildSolverInput(route.entry, undefined, parsed.values));
  must(sol.result.RA === 10 && sol.result.RB === 10, `真题③ RA/RB=${sol.result.RA}/${sol.result.RB} ≠ 10/10`);
  must(sol.result.N_AB === 10, `真题③ N_AB=${sol.result.N_AB} ≠ 10`);
  // 面值 6 位舍入 = -14.142136；全精度对闭式 -P·√((L/2)²+H²)/(2H) = -20·√4.5/3 = -14.142135623730951
  must(sol.result.N_AC === -14.142136, `真题③ N_AC=${sol.result.N_AC} ≠ -14.142136`);
  must(Math.abs(sol.result.N_AC - (-20 * Math.sqrt(4.5)) / 3) <= 5.01e-7, `真题③ N_AC 偏离闭式 ${Math.abs(sol.result.N_AC - (-20 * Math.sqrt(4.5)) / 3)}（面值 6 位舍入的半 ulp=5e-7）`);
  must(sol.result.N_BC === sol.result.N_AC, `真题③ N_BC=${sol.result.N_BC} ≠ N_AC`);
});

/* 反例（内存变异，不碰源文件）：把变体路由指到「不吃参数」的状态 ——
 * 模拟 Result.tsx 里 parseParamQuery 的 params 被换成空数组：覆盖值全丢、
 * solver 拿到默认值、悬臂给出 RA=10 而不是 12。上面的真题①必须能抓到它。 */
await checkAsync('反例：params 换成空数组（模拟链路断裂）→ 覆盖值全丢，给的不是真题的数，真题① 必然变红', async () => {
  const route = getTemplateRoute('M3-cantilever');
  // parseParamQuery 的契约：baseline 只往「已声明 key」上叠 —— params 为空数组时
  // values 为空，solver 端 num() 回落到 M3_DEFAULTS，不是 URL 里的 L=3/P=12。
  const mutated = parseParamQuery([], 'L=3&a=3&P=12', route.variant?.params);
  must(Object.keys(mutated.values).length === 0, `反例前置：空 params 应解析出空 values，实际 ${JSON.stringify(mutated.values)}`);
  const solve = await solverOf('M3-cantilever');
  let mutantShape = '';
  try {
    const sol = solve(buildSolverInput(route.entry, route.variant?.config, mutated.values));
    mutantShape = `RA=${sol.result.RA} MA=${sol.result.MA}`;
    must(sol.result.RA !== 12 || sol.result.MA !== 36, '反例：不吃参数的链路竟给出真题的数，无区分度，门禁验不红');
  } catch (error) {
    // 页面层的真实形状：solver 抛错 → Result.tsx catch → 回退快照 + 旧 validatedAt
    // （W18 修复前用户看到的正是这个：默认算例的 RA=10/MA=10 配「已校验」徽章）
    mutantShape = `THREW: ${error.message}`;
  }
  must(!mutantShape.includes('RA=12') && !mutantShape.includes('MA=36'), '反例：变异态与真题① 无区分度');
  console.log(`       （变异态：${mutantShape} —— 真题① 的断言在这种状态下必红）`);
});

/* ── W21-B B3：首页「贴一道题」直达（体验报告 5.8） ───────────────── */

check('首页贴题直达 / 唯一命中 → #/solve?t=M3&q=…（往返一致）', () => {
  const text = '简支梁 AB，跨度 L=6 m，跨中受集中力 P=30 kN，求支座反力与最大弯矩';
  const target = homeSolveTarget(text);
  must(target.kind === 'unique' && target.templateId === 'M3', `应唯一命中 M3，实际 ${target.kind}`);
  const [hash, query] = target.hash.split('?');
  must(hash === '#/solve', `hash 应是 #/solve，实际 ${hash}`);
  const parsed = new URLSearchParams(query);
  must(parsed.get('t') === 'M3', 'URL 没带 t=M3');
  must(parsed.get('q') === text, '题面没有原样带回');
  must(getTemplateRoute(parsed.get('t')) !== undefined, 't 不是真题型');
  // Solve 页 boot 的读法：同一个 t / q 必须能还原
  const boot = { t: new URLSearchParams(query).get('t'), q: new URLSearchParams(query).get('q') };
  must(boot.t === target.templateId && boot.q === text, '往返后 t / q 不一致');
});

check('首页贴题直达 / 同分多命中 → 候选卡，每张自带 ?t= 直达', () => {
  const text = '二极管 稳压管 分压式 偏置电路 理想运放 反相放大';
  const target = homeSolveTarget(text);
  must(target.kind === 'multiple' && target.candidates.length >= 2, `应给候选卡，实际 ${target.kind}`);
  for (const candidate of target.candidates) {
    must(new URLSearchParams(candidate.hash.split('?')[1]).get('t') === candidate.id, `${candidate.id} 的卡没带 t`);
    must(getTemplateRoute(candidate.id) !== undefined, `${candidate.id} 不是真题型`);
  }
});

check('首页贴题直达 / 零命中与空题面 → 才退回手动选题型', () => {
  const none = homeSolveTarget('随便一句话，没有题型');
  must(none.kind === 'none' && none.hash.startsWith('#/solve?q='), '零命中应带题面去 #/solve');
  const empty = homeSolveTarget('');
  must(empty.kind === 'none' && empty.hash === '#/solve', '空题面应进空的 #/solve');
});

check('首页贴题直达 / 页面真的接上（Home 用纯函数、Solve 认 ?t=）', () => {
  const home = readFileSync('src/pages/Home.tsx', 'utf8');
  const solve = readFileSync('src/pages/Solve.tsx', 'utf8');
  must(/homeSolveTarget\(text\)/.test(home), 'Home.tsx 没调 homeSolveTarget');
  must(/home-candidates/.test(home) && /home-candidate/.test(home), 'Home.tsx 没有候选卡');
  must(/new URLSearchParams\(query\)\.get\('t'\)/.test(solve), 'Solve.tsx 没读 ?t=');
  must(/if \(!boot\.t \|\| !getTemplateRoute\(boot\.t\)\) return;/.test(solve), 'Solve.tsx 没有 ?t= 预选');
  must(/void runParse\(\)/.test(solve), 'Solve.tsx 没有自动解析');
});

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项（URL 参数门禁 / B3 首页贴题直达）`);