/**
 * check:labimport（R2-T3）：题面结构草稿 → 装配台，两条路必须同一个数。
 *
 *  ① 同解：可装配 16 型各取一个带覆盖值的 draft，分别走
 *     - 模板路由   #/t/<id>?<key>=<value>…   （parseParamQuery → buildSolverInput → solver）
 *     - 装配台路由 #/lab/t/<id>?g=…          （labDraftFromAIDraft → draftToGraph → reduce → params → solver）
 *     两条路的 result 逐位相等（≤1e-12）；validatedAt 不参与比较（本门禁只比 result 本体）。
 *  ② 白名单：draft 塞白名单外器件 → draftToGraph 拒绝并给人话。
 *  ③ 不猜：fields 里 from:'默认' 的键，装配台结果区必须标琥珀（源码断言）。
 *  ④ 变异：draftToGraph 关掉 applyFields（丢参数）→ ① 红。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}

import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { buildSolverInput, parseParamQuery } from '../src/core/params/query.ts';
import { labDraftFromAIDraft } from '../src/core/ai/labDraft.ts';
import { draftToGraph, DRAFT_TO_GRAPH_CONFIG } from '../src/core/lab/draftToGraph.ts';
import { labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { reduce } from '../src/core/lab/reduce.ts';
import { SUPPORTED_IDS } from '../src/core/lab/ids.ts';

let checks = 0;
const errors = [];
const ok = (name, pass, extra = '') => {
  checks += 1;
  if (pass) console.log(`[ok]   ${name}`);
  else {
    errors.push(`${name}${extra ? ` — ${extra}` : ''}`);
    console.log(`[FAIL] ${name}${extra ? ` — ${extra}` : ''}`);
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const close = (a, b) => {
  if (typeof a !== 'number' || typeof b !== 'number') return String(a) === String(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return String(a) === String(b);
  if (a === b) return true;
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b)) <= 1e-12;
};
const sameResult = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!close(a[key], b[key])) return false;
  return true;
};

/** 16 型各取一个带覆盖值的 draft（覆盖值 = 旧 check:url 的 NON_DEFAULT 思想）。 */
const DRAFT_OVERRIDES = {
  A1: 'Vs:6',
  A2: 'Vcc:15',
  A3: 'Rc:5000,beta:150',
  A4: 'Vdd:15',
  A5: 'Rd:5000',
  A6: 'R1:50000',
  A7: 'beta:0.02',
  M1: 'A:300',
  M2: 'd:50',
  M3: 'L:6,a:3,P:20',
  'M3-cantilever': 'L:3,a:3,P:12',
  M4: 'h:240',
  M5: 'P:30',
  M7: 'P:200',
  S3: 'P2:25',
  S5: 'L:3,H:1.5,P:20',
};

const solverCache = new Map();
async function solverOf(id) {
  if (!solverCache.has(id)) {
    solverCache.set(id, (await getTemplateRoute(id).entry.solver()).default);
  }
  return solverCache.get(id);
}

for (const id of SUPPORTED_IDS) {
  await (async () => {
    const route = getTemplateRoute(id);
    const entry = route.entry;
    const variant = route.variant;
    const paramSpecs = entry.params ?? [];
    const raw = DRAFT_OVERRIDES[id];
    must(raw, `㊙ ${id} 没配覆盖值`);
    const givenParams = {};
    for (const piece of raw.split(',')) {
      const [key, value] = piece.split(':');
      givenParams[key] = Number(value);
    }

    // 路 A：模板路由（讲解页）—— parseParamQuery 消费查询串
    const search = raw.split(',').map((piece) => piece.replace(':', '=')).join('&');
    const parsed = parseParamQuery(paramSpecs, search, variant?.params);
    // 不断言 corrected：键序与默认值等值的省略都会标 corrected，但 values 本身是对的
    for (const [key, want] of Object.entries(givenParams)) {
      must(close(Number(parsed.values[key]), want), `${id} 模板路由解析丢值：${key}=${parsed.values[key]} ≠ ${want}`);
    }
    const solveA = await solverOf(id);
    const resultA = solveA(buildSolverInput(entry, variant?.config, parsed.values)).result;

    // 路 B：装配台路由 —— 结构草稿 → draftToGraph → reduce params → solver
    const aidDraft = {
      templateId: id,
      params: givenParams,
      reason: 'R2-T3 门禁',
      given: '',
      source: 'rule',
      unsure: [],
    };
    const lab = labDraftFromAIDraft(aidDraft);
    must(lab.ok, `${id} 结构草稿构造失败：${lab.ok ? '' : lab.reason}`);
    const ex = JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
    const spec = labSkeletonSpec(id, ex.render_specs[0]);
    const built = draftToGraph(lab.draft, spec);
    must(built.ok, `${id} draftToGraph 失败：${built.ok ? '' : built.reason}`);
    const paramsB = reduce(id, built.graph).params;
    const solveB = await solverOf(id);
    const resultB = solveB(buildSolverInput(entry, variant?.config, paramsB)).result;

    ok(
      `同解 ${id}：模板路由 ≡ 装配台路由（≤1e-12）`,
      sameResult(resultA, resultB),
      `params 路B=${JSON.stringify(paramsB)}`,
    );
    // 覆盖值确实进了归约（不许静默回落默认）
    for (const [key, want] of Object.entries(givenParams)) {
      ok(`同解 ${id}.${key} 覆盖值生效（=${want}）`, close(Number(paramsB[key]), want), `实际 ${paramsB[key]}`);
    }
  })().catch((error) => ok(`同解 ${id}`, false, error.message));
}

/* ② 白名单：非白名单器件拒绝并给人话 */
{
  const aid = { templateId: 'A3', params: {}, reason: '', given: '', source: 'rule', unsure: [] };
  const lab = labDraftFromAIDraft(aid);
  must(lab.ok, '白名单前置：A3 草稿应构造成功');
  const ex = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8'));
  const spec = labSkeletonSpec('A3', ex.render_specs[0]);
  // A3 的白名单本就含 vsrc（骨架自带电源）—— 塞一个力学族的器件才算越界
  const bad = { ...lab.draft, devices: [{ id: 'd1', kind: 'pinSupport', label: '固定铰' }] };
  const result = draftToGraph(bad, spec);
  ok('白名单：A3 塞 pinSupport（力学器件）→ 拒绝', !result.ok && result.reason.includes('白名单'), result.ok ? '没拒' : result.reason);
  ok('白名单：话术提到「不许造拓扑」', !result.ok && result.reason.includes('不许造拓扑'), result.ok ? '' : result.reason.slice(0, 60));
  const unknownPort = { ...lab.draft, edges: [{ from: 'n-vs:p', to: 'n-ghost:x' }] };
  const result2 = draftToGraph(unknownPort, spec);
  ok('端口：连线到不存在的端口 → 拒绝', !result2.ok && result2.reason.includes('不是骨架已声明的端口'), result2.ok ? '没拒' : result2.reason.slice(0, 60));
  console.log(`白名单拒绝话术：「${(!result.ok ? result.reason : '').slice(0, 44)}…」`);
}

/* ③ 不猜：默认来源标琥珀（源码断言） */
{
  const source = readFileSync(join(root, 'src', 'pages', 'Solve.tsx'), 'utf8');
  ok('不猜：结果区块存在（data-testid=lab-draft）', source.includes('data-testid="lab-draft"'));
  // N-02 合并成一张表后，判据从「整行琥珀」翻译成「来源列 === 默认 就琥珀」——
  // 同一个意图（默认值不许伪装成题面），换了个渲染形态而已。
  ok('不猜：来源=默认 → 琥珀', /source === '默认' \? 'text-amber'/.test(source));
  ok('不猜：固定文案「只描述结构，不出任何数值结论」', source.includes('LAB_DRAFT_DISCLAIMER') && readFileSync(join(root, 'src', 'core', 'ai', 'labDraft.ts'), 'utf8').includes('这一块只描述结构，不出任何数值结论'));
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  // N-03：两枚徽标合一 → 只剩 badge-source（题面来的写全，链接来的只写「已从链接载入」）
  ok('来源徽标：data-testid=badge-source', labSource.includes('data-testid="badge-source"') && labSource.includes('来自题面'));
  const draftSource = readFileSync(join(root, 'src', 'core', 'ai', 'labDraft.ts'), 'utf8');
  ok('铁律：labDraft.ts 三条铁律在文件里', draftSource.includes('只读，不算') && draftSource.includes('不许猜') && draftSource.includes('不许造拓扑'));
  console.log('默认值琥珀 + 固定文案 + 来自题面徽标 + 三条铁律，源码断言全过');
}

/* ④ 变异哨兵 */
ok('变异位：applyFields 应为 true', DRAFT_TO_GRAPH_CONFIG.applyFields === true, `实际 ${DRAFT_TO_GRAPH_CONFIG.applyFields}`);

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（题面→装配台：16 型同解 ≤1e-12 / 白名单拒绝 / 默认值琥珀 / 变异哨兵）`);
