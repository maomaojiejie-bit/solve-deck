/**
 * check:assemble —— 六个「改一处」用例。每个都要么归约成功且结果与**独立手算**一致，
 * 要么给 problems（拒答）而不是崩。不许有第三种结局。
 *
 *  手算闭式（与 solver 输出 AvNoRo 逐位对上的教学公式，不抄 solver 内部）：
 *    A3: gm = Ic/Vt, rπ = β/gm, AvNoRo = -gm·(Rc∥Rl)·rπ/(Rs+rπ)
 *    A5: AvNoRo = -gm·(Rd∥Rl)
 *
 *  用例：
 *   ① 删 Rc（A3）        → Rc→1e12（输出短接）+ appliedRules 证据 → AvNoRo 与手算一致
 *   ② 加 Rl（A5 骨架未画）→ Rl 从器件取 → AvNoRo = -gm(Rd∥Rl) 与手算一致
 *   ③ Rd=5k（A5）        → 参数写回 → AvNoRo = -gm(Rd∥Rl) = -3.333 与手算一致
 *   ④ M3 支座 pin→fixed  → 结构判据拒（简支+固定端 = 静不定）→ problems 不崩
 *   ⑤ M3 加第二个集中力   → 结构判据拒（只支持一个 P）→ problems 不崩
 *   ⑥ S5 删一根杆        → m≠2j-3 → 拒 + 「加一根杆或改题型」
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { graphFromSpec, graphToSpec, OWNER_CONFIG } from '../src/core/lab/graphFromSpec.ts';
import { ATTACH_CONFIG, supportRefs } from '../src/core/lab/attach.ts';
import { connectedToAnyDevice, RESIDUE_CONFIG, ROTATE_CONFIG, DELETE_EDGE_CONFIG } from '../src/core/lab/ops.ts';
import { seedGraph, PICKS, skeletonOptions, findDevice, findLoads, applyParams } from '../src/core/lab/picks.ts';
import { P_OVERRIDE_CONFIG } from '../src/core/lab/params.ts';
import { reduce, REDUCE_CONFIG } from '../src/core/lab/reduce.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { netSolve } from '../src/core/lab/netSolve.ts';
import { pinAt } from '../src/render/symbols.ts';
import { createUiState, labUiClick, labUiStep, UNDO_CONFIG, SUPPORT_FOLLOW_CONFIG } from '../src/core/lab/ui.ts';
import { resolveLabSolve, SUPPORT_PIN_CONFIG } from '../src/core/lab/resolve.ts';
import { labDraftFromAIDraft } from '../src/core/ai/labDraft.ts';
import { defaultValues, freshSkeleton, labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import {
  NOT_APPLICABLE,
  NOT_APPLICABLE_IDS,
  notApplicableView,
  notApplicableLedgerCheck,
  LAB_LEDGER_COUNTS,
} from '../src/core/lab/coverage.ts';
import { findAnchor, snapAnchor, snapGrid, anchorsOfNode, anchorsOf } from '../src/core/lab/pins.ts';
import { validateWire, DUPLICATE_WIRE, SAME_POINT, SELF_LOOP, PIN_HINT } from '../src/core/lab/wiring.ts';
import { candidateDefaults, candidatesFor, CANDIDATES } from '../src/core/lab/candidates.ts';
import { mergeOverrides, parseParamOverrides } from '../src/core/lab/params.ts';
import { CRITICAL_SEMANTICS, SEMANTIC_OPTIONS } from '../src/core/lab/semantics.ts';
import { SUPPORTED_IDS } from '../src/core/lab/ids.ts';
import { HEAL_CONFIG } from '../src/core/lab/heal.ts';
import { netSolveOptionsFor } from '../src/core/lab/resolve.ts';
import {
  INSPECT_CONFIG,
  beamMemberRows,
  beamObjectRows,
  circuitDeviceRows,
  circuitWireRows,
  hitTest,
  selectTarget,
} from '../src/core/lab/inspect.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const rel = (a, b) => {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? diff : diff / scale;
};

const SOLVERS = {};
for (const id of ['A3', 'A5', 'M3', 'M3-cantilever', 'S5', 'A2', 'A4', 'A7', 'M1', 'M2', 'M4', 'M5', 'M7', 'S3']) {
  SOLVERS[id] = (await getTemplateRoute(id).entry.solver()).default;
}

/** W11 新增的 9 型：题面本身就是一个结构。 */
const W11_IDS = ['A2', 'A4', 'A7', 'M1', 'M2', 'M4', 'M5', 'M7', 'S3'];

function loadSkeleton(id, overrides = {}) {
  const snap = JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
  const route = getTemplateRoute(id);
  const baseline = route.variant?.params ?? {};
  const defaults = Object.fromEntries(
    (route.entry.params ?? []).map((p) => [p.key, overrides[p.key] ?? baseline[p.key] ?? p.defaultValue]),
  );
  const seeded = seedGraph(id, defaults);
  const graph = graphFromSpec(labSkeletonSpec(id, snap.render_specs[0]), id, PICKS[id].family, {
    ...(PICKS[id].family === 'beam' ? skeletonOptions(id) : {}),
    seeds: seeded.seeds,
    meta: seeded.meta,
  });
  return { snap, graph, defaults, solver: SOLVERS[id] };
}

/** 并联。 */
const par = (...values) => values.reduce((acc, value) => (acc * value) / (acc + value));

/* ── ① 删 Rc ───────────────────────────────────────────────────── */
{
  const { snap, graph, solverSync } = loadSkeleton('A3');
  const out = applyOp('A3', graph, { op: 'deleteDevice', nodeId: 'n-rc' });
  ok('①', !out.refused, `删 Rc 被拒：${out.refused}`);
  const result = reduce('A3', out.graph, out.rules);
  ok('①', !result.outOfScope, `删 Rc 却拒答：${result.problems.join('；')}`);
  ok('①', result.params.Rc === 1e12, `删 Rc 后 Rc=${result.params.Rc}，应为 1e12（输出短接）`);
  ok(
    '①',
    result.appliedRules.some((rule) => rule.includes('已删除集电极电阻')),
    `appliedRules 缺「已删除集电极电阻」：${result.appliedRules.join(' / ')}`,
  );
  // 手算：gm=Ic/Vt, rπ=β/gm, AvNoRo=-gm·(Rc∥Rl)·rπ/(Rs+rπ)
  const gm = result.params.Ic / 0.026;
  const rpi = result.params.beta / gm;
  const hand = -gm * par(result.params.Rc, result.params.Rl) * (rpi / (result.params.Rs + rpi));
  const solved = SOLVERS.A3(result.params);
  ok('①', typeof solved.result.AvNoRo === 'number' && rel(solved.result.AvNoRo, hand) < 1e-9, `① AvNoRo=${solved.result.AvNoRo} 与手算 ${hand} 不一致`);
  ok('①', solved.steps.length === snap.steps.length, `① 步骤数变了：${solved.steps.length} ≠ ${snap.steps.length}`);
  console.log(`①  删 Rc：输出短接（Rc→1e12），AvNoRo=${solved.result.AvNoRo.toPrecision(6)} = 手算`);
}

/* ── ② A5 骨架加 Rl ────────────────────────────────────────────── */
{
  const { graph, solverSync } = loadSkeleton('A5');
  const out = applyOp('A5', graph, {
    op: 'addDevice',
    kind: 'res',
    label: 'Rl 10.0k',
    value: 10000,
    x: 760,
    y: 290,
  });
  ok('②', !out.refused, `加 Rl 被拒：${out.refused}`);
  const result = reduce('A5', out.graph, out.rules);
  ok('②', !result.outOfScope, `加 Rl 却拒答：${result.problems.join('；')}`);
  ok('②', result.params.Rl === 10000, `加 Rl 后 Rl=${result.params.Rl}，应从新器件取 10000`);
  ok(
    '②',
    result.appliedRules.some((rule) => rule.includes('已加入器件')),
    `appliedRules 缺「已加入器件」：${result.appliedRules.join(' / ')}`,
  );
  const hand = -result.params.gm * par(result.params.Rd, result.params.Rl);
  const solved = SOLVERS.A5(result.params);
  ok('②', rel(solved.result.AvNoRo, hand) < 1e-9, `② AvNoRo=${solved.result.AvNoRo} 与手算 ${hand} 不一致`);
  console.log(`②  加 Rl：AvNoRo=${solved.result.AvNoRo.toPrecision(6)} = -gm·(Rd∥Rl)`);
}

/* ── ③ A5 Rd=5k ────────────────────────────────────────────────── */
{
  const { graph, solverSync } = loadSkeleton('A5');
  const rd = findDevice(graph, 'RD');
  ok('③', Boolean(rd), 'A5 骨架里找不到 Rd');
  const out = applyOp('A5', graph, { op: 'applyParams', values: { Rd: 5000 } });
  ok('③', !out.refused, `改 Rd 被拒：${out.refused}`);
  ok('③', findDevice(out.graph, 'RD')?.value === 5000, '改 Rd 后器件值没写回');
  const result = reduce('A5', out.graph);
  ok('③', !result.outOfScope && result.params.Rd === 5000, `③ 归约 Rd=${result.params.Rd}`);
  const hand = -result.params.gm * par(5000, result.params.Rl);
  const solved = SOLVERS.A5(result.params);
  ok('③', rel(solved.result.AvNoRo, hand) < 1e-9, `③ AvNoRo=${solved.result.AvNoRo} 与手算 ${hand} 不一致`);
  console.log(`③  Rd=5k：AvNoRo=${solved.result.AvNoRo.toPrecision(6)} = 手算`);
}

/* ── ④ M3 支座 pin→fixed ───────────────────────────────────────── */
{
  const { graph } = loadSkeleton('M3');
  // R3-1 A1：支座是结点属性 —— 找到挂可动铰的结点，用 setSupport 换类型。
  // 读 supportRefs 而不是 node.kind：两种存法都能定位（fold 变异时给结点形态的 jointId）。
  const rollerRef = supportRefs(graph).find((ref) => ref.type === 'roller');
  ok('④', Boolean(rollerRef?.jointId), '④ M3 骨架里找不到可动铰（结点属性）');
  const rollerJoint = graph.nodes.find((node) => node.id === rollerRef?.jointId);
  ok('④', Boolean(rollerJoint), `④ 找不到可动铰挂的结点：${rollerRef?.jointId}`);
  if (!rollerJoint) {
    console.log('④  找不到可动铰挂的结点：本条无法执行（上面的断言已红）');
  } else {
    const out = applyOp('M3', graph, { op: 'setSupport', nodeId: rollerJoint.id, type: 'fixed' });
    ok('④', !out.refused, `改支座被拒：${out.refused}`);
    const result = reduce('M3', out.graph, out.rules);
    ok('④', result.outOfScope && result.problems.length > 0, `④ 简支+固定端应被拒，实际 outOfScope=${result.outOfScope}`);
    ok('④', /固定铰|可动铰|支座/.test(result.problems[0]), `④ 拒答没说支座问题：${result.problems[0]}`);
    // 支座不许靠 changeKind 改：那会凭空造一个独立支座图元（R3-1 A1 的老病）
    const legacy = applyOp('M3', graph, { op: 'changeKind', nodeId: rollerJoint.id, kind: 'fixedSupport' });
    ok('④', Boolean(legacy.refused), '④ changeKind 改成支座 kind 应被拒（支座不是图元）');
    console.log(`④  支座 pin→fixed：拒答「${(result.problems[0] ?? '(没有被拒)').slice(0, 30)}…」；changeKind 造支座的旧路已封`);
  }
}

/* ── ⑤ M3 加第二个集中力 ───────────────────────────────────────── */
{
  const { graph } = loadSkeleton('M3');
  const beam = graph.edges.find((edge) => edge.kind === 'beam');
  const at = graph.nodes.find((node) => node.id === beam.to);
  const out = applyOp('M3', graph, { op: 'addLoad', atNodeId: at.id, type: 'point', value: 15 });
  ok('⑤', !out.refused, `加集中力被拒：${out.refused}`);
  const result = reduce('M3', out.graph, out.rules);
  ok('⑤', result.outOfScope, '⑤ 两个集中力应被拒');
  ok('⑤', /集中力/.test(result.problems.join('')), `⑤ 拒答没提集中力：${result.problems.join('；')}`);
  console.log(`⑤  加第二个集中力：拒答「${result.problems[0].slice(0, 30)}…」`);
}

/* ── ⑥ S5 删一根杆 ─────────────────────────────────────────────── */
{
  const { graph } = loadSkeleton('S5');
  ok('⑥', graph.edges.length === 3, `S5 骨架应有 3 根杆，实际 ${graph.edges.length}`);
  const out = applyOp('S5', graph, { op: 'deleteDevice', nodeId: graph.edges[0].from });
  // 删节点会连带删杆；这里直接删边更贴近「删一根杆」——用 addEdge 的反向：手工去边
  const g2 = { ...graph, edges: graph.edges.slice(1) };
  const result = reduce('S5', g2, ['已删除一根桁架杆']);
  ok('⑥', result.outOfScope, '⑥ 删杆后应拒答（m≠2j-3）');
  ok(
  '⑥',
  /m = 2j−3 = 3/.test(result.problems.join('')) && /恢复骨架|补一根/.test(result.problems.join('')),
  `⑥ 拒答没给可执行的静定建议：${result.problems.join('；')}`,
);
  ok('⑥', Boolean(out), '⑥ applyOp 不崩');
  console.log(`⑥  S5 删杆：拒答「${result.problems[0].slice(0, 32)}…」`);
}


/* ── ⑦⑧⑨⑩ W10-A：UI 动作序列（走页面同一套 labUiStep，不直接调 reduce） ── */

const s5Snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'S5.json'), 'utf8'));
const s5Spec = s5Snap.render_specs[0];
const a3Snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8'));
const a3Spec = a3Snap.render_specs[0];

/* ⑦ 点掉一根杆 → 判据卡给可执行建议 → 点恢复骨架 → 回到可解；再加杆 → 数值与快照逐位一致 */
{
  let state = createUiState('S5', freshSkeleton('S5', s5Spec));
  ok('⑦', state.preview.problems.length === 0 && !state.dirty, '⑦ 骨架初始态应可解且未改动');
  const edgeId = state.graph.edges[0].id;
  const from = state.graph.edges[0].from;
  const to = state.graph.edges[0].to;
  state = labUiStep('S5', state, { type: 'op', op: { op: 'deleteMember', edgeId } });
  ok('⑦', state.dirty === true && state.graph.edges.length === 2, `⑦ 删杆没生效：dirty=${state.dirty} edges=${state.graph.edges.length}`);
  const advice = state.preview.problems.join(' ');
  ok('⑦', advice.includes('m = 2j−3 = 3'), `⑦ 判据卡缺「m = 2j−3 = 3」：${advice}`);
  ok('⑦', advice.includes('恢复骨架') && advice.includes('补一根'), `⑦ 判据卡缺可执行建议：${advice}`);
  ok('⑦', state.preview.tier === 'U', `⑦ 删杆后档位应为 U，实际 ${state.preview.tier}`);

  // 加杆：两次点击的两个节点 → addMember → m=3 立刻可解
  state = labUiStep('S5', state, { type: 'op', op: { op: 'addMember', from, to, kind: 'truss' } });
  ok('⑦', state.graph.edges.length === 3 && state.preview.problems.length === 0, `⑦ 加杆后应回到静定：${state.preview.problems.join('；')}`);
  for (const [key, want] of Object.entries(s5Snap.parsed_given)) {
    ok('⑦', rel(state.preview.params[key], want) < 1e-12, `⑦ 加杆后 ${key}=${state.preview.params[key]} ≠ 快照 ${want}`);
  }
  const solved = SOLVERS.S5(state.preview.params);
  for (const [key, want] of Object.entries(s5Snap.result)) {
    if (typeof want === 'number') {
      ok('⑦', rel(solved.result[key], want) < 1e-9, `⑦ 加杆后 result.${key}=${solved.result[key]} ≠ 快照 ${want}`);
    } else {
      ok('⑦', solved.result[key] === want, `⑦ 加杆后 result.${key} 与快照不一致`);
    }
  }

  // 恢复骨架：清空 dirty / rules / problems，回到打开时的图
  state = labUiStep('S5', state, { type: 'reset', templateId: 'S5', spec: s5Spec });
  ok('⑦', state.preview.problems.length === 0 && !state.dirty, '⑦ 恢复骨架后应可解');
  ok('⑦', state.rules.length === 0 && state.graph.edges.length === 3, '⑦ 恢复骨架没清掉 appliedRules / 杆件');
  console.log('⑦  UI 删杆 →「m = 2j−3 = 3」建议 → 加杆逐位同解 → 恢复骨架');
}

/* ⑧ A3 标全三个关键标签 → semantic pass 且 tier = F */
{
  ok('⑧', SEMANTIC_OPTIONS.length === 8, `⑧ 语义标签应 8 个，实际 ${SEMANTIC_OPTIONS.length}`);
  ok('⑧', ['load', 'feedback', 'stage_link'].every((tag) => SEMANTIC_OPTIONS.some((o) => o.value === tag)), '⑧ 缺 load/feedback/stage_link');
  ok(
    '⑧',
    CRITICAL_SEMANTICS.A3.length === 3 && ['bias', 'coupling', 'load'].every((tag) => CRITICAL_SEMANTICS.A3.includes(tag)),
    `⑧ A3 关键标签表不对：${JSON.stringify(CRITICAL_SEMANTICS.A3)}`,
  );
  ok('⑧', CRITICAL_SEMANTICS.A5.includes('load') && CRITICAL_SEMANTICS.A7.includes('feedback') && CRITICAL_SEMANTICS.A1.includes('supply'), '⑧ 其他题型的关键标签表没声明');
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  ok('⑧', state.preview.tier === 'N', `⑧ 未标语义应落 N，实际 ${state.preview.tier}`);
  for (const [nodeId, tag] of [['n-rl', 'load'], ['n-rc', 'bias'], ['n-rs', 'coupling']]) {
    state = labUiStep('A3', state, { type: 'op', op: { op: 'setSemantic', nodeId, semantic: tag } });
  }
  state = labUiStep('A3', state, { type: 'solve' });
  ok('⑧', state.preview.semantic.state === 'pass', `⑧ 标全后 semantic 没过：${state.preview.semantic.detail}`);
  ok('⑧', state.verdict?.tier === 'F', `⑧ tier 没升到 F：${state.verdict?.tier}`);
  ok('⑧', state.preview.problems.length === 0, `⑧ 标语义不该引入结构问题：${state.preview.problems.join('；')}`);
  console.log('⑧  A3：Rl=load / Rc=bias / Rs=coupling → semantic pass，tier F');
}

/* ⑨ 负例：只标 Rl → 仍然 N（判据没放水） */
{
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  state = labUiStep('A3', state, { type: 'op', op: { op: 'setSemantic', nodeId: 'n-rl', semantic: 'load' } });
  state = labUiStep('A3', state, { type: 'solve' });
  ok('⑨', state.preview.semantic.state === 'skipped', '⑨ 只标一个标签 semantic 不该 pass');
  ok('⑨', state.preview.semantic.missing.includes('bias') && state.preview.semantic.missing.includes('coupling'), `⑨ 缺的标签没列出来：${state.preview.semantic.missing.join(',')}`);
  ok('⑨', state.verdict?.tier === 'N', `⑨ 只标一个标签应仍为 N，实际 ${state.verdict?.tier}`);
  console.log('⑨  只标 Rl=load → 仍 N 档（bias / coupling 未标）');
}

/* ⑩ 恢复骨架逐字段相等 + 改器件种类保留 value、丢 params + 仅 7 型显示入口 */
{
  const fresh = freshSkeleton('A3', a3Spec);
  let state = createUiState('A3', fresh);
  // 改种类：res → cap，value 保留、params 丢
  state = labUiStep('A3', state, { type: 'op', op: { op: 'changeKind', nodeId: 'n-rs', kind: 'cap' } });
  const rs = state.graph.nodes.find((node) => node.id === 'n-rs');
  ok('⑩', rs?.kind === 'cap' && rs.value === 1000, `⑩ 改种类后数值丢了：${JSON.stringify(rs)}`);
  ok('⑩', rs?.params === undefined, `⑩ 改种类后不兼容 params 没丢：${JSON.stringify(rs?.params)}`);
  state = labUiStep('A3', state, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  state = labUiStep('A3', state, { type: 'op', op: { op: 'applyParams', values: { Rc: 3300 } } });
  ok('⑩', state.dirty && state.rules.length >= 3, '⑩ 改动后应记录 dirty 与 appliedRules');
  state = labUiStep('A3', state, { type: 'reset', templateId: 'A3', spec: a3Spec });
  ok('⑩', !state.dirty, '⑩ 恢复后 dirty 仍为 true');
  ok('⑩', state.rules.length === 0 && state.preview.problems.length === 0, '⑩ 恢复后没清干净 rules / problems');
  // W22-A：meta.resetAt 是有意的骨架级字段（恢复 / 载入候选自增，驱动画布 remount），
  // 逐字段比较时豁免它 —— 其余字段仍须逐键相等。
  const stripVolatile = (g) => JSON.stringify({ ...g, meta: Object.fromEntries(Object.entries(g.meta).filter(([key]) => key !== 'resetAt' && key !== 'seq')) });
  ok('⑩', stripVolatile(state.graph) === stripVolatile(freshSkeleton('A3', a3Spec)), '⑩ 恢复后的 graph 与 seedGraph 骨架不逐字段相等');
  ok('⑩', state.graph.nodes.find((node) => node.id === 'n-rs')?.value === 1000, '⑩ 恢复后 Rs 值不对');

  const resultSource = readFileSync(join(root, 'src', 'pages', 'Result.tsx'), 'utf8');
  const solveSource = readFileSync(join(root, 'src', 'pages', 'Solve.tsx'), 'utf8');
  ok('⑩', /isLabSupported\(templateId\)/.test(resultSource) && /#\/lab\/t\/\$\{templateId\}/.test(resultSource), '⑩ 结果页没有「改结构 →」条件入口');
  // N-01 收敛成「看结构 / 看讲解」两个出口后，判据换成：读题页唯一的装配台出口是
  // go-lab-structure，且不可装配的型（M6 这类）在结构草稿这一层就被挡住 —— 落到 #/lab 的
  // 「不适用」卡，而不是硬塞一张假图。
  ok('⑩', /data-testid="go-lab-structure"/.test(solveSource) && /#\/lab\/t\//.test(solveSource), '⑩ 读题页没有进装配台的出口');
  ok('⑩', labDraftFromAIDraft({ templateId: 'M6', params: {}, reason: '', given: '', source: 'rule', unsure: [] }).ok === false, '⑩ 不可装配的型居然也生成了结构草稿');
  ok('⑩', SUPPORTED_IDS.length === 16 && SUPPORTED_IDS.includes('A2') && SUPPORTED_IDS.includes('S3'), `⑩ 支持题型表不对：${SUPPORTED_IDS.join(',')}`);
  console.log('⑩  恢复骨架逐字段相等 + 改种类保 value 丢 params + 16 型入口');
}


/* ── ⑪⑫⑬⑭⑮⑯ W10-B：点击连线 / 拖动 / 三候选 / ?p= 覆盖 ───────────── */

/* ⑪ 真点击序列：#/lab/t/A3 依次 pointerdown 到 n-vs:p、n-rl:b */
{
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  const baseParams = JSON.stringify(state.preview.params);
  const baseEdges = state.graph.edges.length;
  state = labUiClick('A3', state, { kind: 'pin', key: 'n-vs:p' });
  ok('⑪', state.wire.first === 'n-vs:p', `⑪ 第一次点击没选中引脚：${state.wire.first}`);
  ok('⑪', !state.dirty && state.graph.edges.length === baseEdges, '⑪ 第一次点击不该改图 / dirty');
  state = labUiClick('A3', state, { kind: 'pin', key: 'n-rl:b' });
  ok('⑪', state.wire.first === null && state.dirty, '⑪ 第二次点击后应清选中并标 dirty');
  ok('⑪', state.graph.edges.length === baseEdges + 1, `⑪ 图里应多一条导线，实际 ${state.graph.edges.length}`);
  const added = state.graph.edges[state.graph.edges.length - 1];
  ok('⑪', Array.isArray(added.points) && added.points.length >= 2, '⑪ 新导线没有世界坐标 points');
  const a = findAnchor(state.graph, 'n-vs:p');
  const b = findAnchor(state.graph, 'n-rl:b');
  if (a && b && added.points) {
    const head = added.points[0];
    const tail = added.points[added.points.length - 1];
    ok('⑪', Math.hypot(head[0] - a.x, head[1] - a.y) < 0.6, `⑪ 导线起点没落在 n-vs:p：${head}`);
    ok('⑪', Math.hypot(tail[0] - b.x, tail[1] - b.y) < 0.6, `⑪ 导线终点没落在 n-rl:b：${tail}`);
  } else {
    ok('⑪', false, '⑪ 找不到两个引脚的世界坐标');
  }
  ok('⑪', added.kind === 'wire', `⑪ 新导线 kind 应为 wire，实际 ${added.kind}`);
  ok('⑪', JSON.stringify(state.preview.params) === baseParams, '⑪ 新增导线不该改动归约 params');
  console.log('⑪  画布点两下连线 → 端点落引脚（误差 0）→ params 逐键不变');
}

/* ⑫ 非法三类 + 空白处取消 + 器件本体只提示一次，全部不改图 / dirty */
{
  const cases = [
    { name: '同点两下', keys: ['n-vs:p', 'n-vs:p'], reason: SAME_POINT },
    { name: '重复连线', keys: ['n-vs:p', 'n-rs:a'], reason: DUPLICATE_WIRE },
    { name: '自环', keys: ['n-vs:p', 'n-vs:n'], reason: SELF_LOOP },
  ];
  for (const item of cases) {
    const start = createUiState('A3', freshSkeleton('A3', a3Spec));
    let state = labUiClick('A3', start, { kind: 'pin', key: item.keys[0] });
    const graphBefore = state.graph;
    state = labUiClick('A3', state, { kind: 'pin', key: item.keys[1] });
    ok('⑫', state.note === item.reason, `⑫ ${item.name} 提示不对：${state.note}`);
    ok('⑫', state.graph === graphBefore, `⑫ ${item.name} 竟然改了图`);
    ok('⑫', !state.dirty, `⑫ ${item.name} 竟然标了 dirty`);
    ok('⑫', state.rules.length === 0, `⑫ ${item.name} 写进了 appliedRules`);
  }
  ok('⑫', validateWire(freshSkeleton('A3', a3Spec), 'n-vs:p', 'n-vs:p').ok === false, '⑫ validateWire 同点没拒');
  // 点空白 → 取消；点器件本体 → 提示一次（第二次不再弹）
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  state = labUiClick('A3', state, { kind: 'pin', key: 'n-vs:p' });
  state = labUiClick('A3', state, { kind: 'blank' });
  ok('⑫', state.wire.first === null && !state.dirty, '⑫ 点空白没取消连线');
  state = labUiClick('A3', state, { kind: 'pin', key: 'n-vs:p' });
  const firstBody = labUiClick('A3', state, { kind: 'body' });
  ok('⑫', firstBody.note === PIN_HINT && firstBody.wire.first === 'n-vs:p', '⑫ 器件本体没提示「请点引脚」/ 误清了选中');
  const secondBody = labUiClick('A3', firstBody, { kind: 'body' });
  ok('⑫', secondBody.note === firstBody.note && secondBody.wire.hinted === true, '⑫ 器件本体提示重复弹了');
  console.log('⑫  同点 / 重复 / 自环 → 拒且图与 dirty 不变；空白取消；本体提示一次');
}

/* ⑬ 力学：删 AB 杆 → 点 n-A → n-B 补回 → m=3 可解且与 S5 快照逐位一致 */
{
  let state = createUiState('S5', freshSkeleton('S5', s5Spec));
  state = labUiStep('S5', state, { type: 'op', op: { op: 'deleteMember', edgeId: 'e-AB' } });
  ok('⑬', state.graph.edges.length === 2 && state.preview.problems.length > 0, '⑬ 删杆后应拒答');
  state = labUiClick('S5', state, { kind: 'node', key: 'n-A:center' });
  ok('⑬', state.wire.first === 'n-A:center', '⑬ 力学第一次点击没选中节点');
  state = labUiClick('S5', state, { kind: 'node', key: 'n-B:center' });
  ok('⑬', state.graph.edges.length === 3, `⑬ 补杆后应有 3 根杆，实际 ${state.graph.edges.length}`);
  ok('⑬', state.preview.problems.length === 0, `⑬ 补杆后仍拒答：${state.preview.problems.join('；')}`);
  for (const [key, want] of Object.entries(s5Snap.parsed_given)) {
    ok('⑬', rel(state.preview.params[key], want) < 1e-12, `⑬ ${key}=${state.preview.params[key]} ≠ 快照 ${want}`);
  }
  const solved = SOLVERS.S5(state.preview.params);
  for (const [key, want] of Object.entries(s5Snap.result)) {
    if (typeof want === 'number') ok('⑬', rel(solved.result[key], want) < 1e-9, `⑬ result.${key} 与快照不一致`);
    else ok('⑬', solved.result[key] === want, `⑬ result.${key} 与快照不一致`);
  }
  console.log('⑬  S5 点两下补杆 → m=3 可解，params / result 与快照逐位一致');
}

/* ⑭ 拖动 n-rc 40px：拖动中不重算导线；pointerup 后端点重新吸附 */
{
  const before = freshSkeleton('A3', a3Spec);
  const baseParams = JSON.stringify(reduce('A3', before).params);
  let state = createUiState('A3', before);
  const targetX = snapGrid(600);
  state = labUiStep('A3', state, { type: 'moveNode', nodeId: 'n-rc', x: targetX, y: 120 });
  ok('⑭', state.graph.nodes.find((node) => node.id === 'n-rc')?.x === targetX, '⑭ 拖动没改节点坐标');
  ok('⑭', JSON.stringify(state.graph.edges) === JSON.stringify(before.edges), '⑭ 拖动过程中竟然重算了导线');
  state = labUiStep('A3', state, { type: 'moveNodeEnd', before });
  ok('⑭', JSON.stringify(reduce('A3', state.graph).params) === baseParams, '⑭ 拖动后归约 params 变了（坐标不是模型）');
  ok('⑭', state.preview.problems.length === 0, `⑭ 拖动后不该有结构判据：${state.preview.problems.join('；')}`);
  let offPin = 0;
  let changed = 0;
  state.graph.edges.forEach((edge, index) => {
    const old = before.edges[index];
    if (JSON.stringify(edge.points) !== JSON.stringify(old?.points)) changed += 1;
    if (!edge.points || edge.points.length < 2) return;
    const head = edge.points[0];
    const tail = edge.points[edge.points.length - 1];
    if (!snapAnchor(state.graph, head[0], head[1]) || !snapAnchor(state.graph, tail[0], tail[1])) offPin += 1;
  });
  ok('⑭', offPin === 0, `⑭ ${offPin} 条导线的端点没落在锚点上`);
  ok('⑭', changed > 0, '⑭ 拖动后一条导线都没跟着重算（relayout 没生效）');
  const rcPin = findAnchor(state.graph, 'n-rc:a');
  ok('⑭', Math.abs((rcPin?.x ?? 0) - targetX) < 0.6, '⑭ n-rc 引脚没跟着节点移动');
  // Esc 取消：回到 start
  const canceled = labUiStep('A3', state, { type: 'moveNode', nodeId: 'n-rc', x: 560, y: 120 });
  ok('⑭', canceled.graph.nodes.find((node) => node.id === 'n-rc')?.x === 560, '⑭ Esc 取消没回到起点');
  // 双击自动整理：端点仍落锚点
  const auto = labUiStep('A3', state, { type: 'autoLayout' });
  let autoOff = 0;
  for (const edge of auto.graph.edges) {
    if (!edge.points || edge.points.length < 2) continue;
    if (!snapAnchor(auto.graph, edge.points[0][0], edge.points[0][1])) autoOff += 1;
  }
  ok('⑭', autoOff === 0, `⑭ 自动整理后 ${autoOff} 个端点脱离锚点`);
  console.log('⑭  拖 40px → 过程中不重算 / 落点重算且端点全落锚点 / params 不变 / Esc 与双击');
}

/* ⑮ 三候选：有快照逐位同解、baseTemplateId、只看看不动 dirty、参数继承 */
{
  let snapshotCandidates = 0;
  let disabledCandidates = 0;
  for (const [templateId, list] of Object.entries(CANDIDATES)) {
    ok('⑮', list.length === 3, `⑮ ${templateId} 候选不是 3 张`);
    for (const candidate of list) {
      ok('⑮', candidate.title !== '' && candidate.why !== '' && candidate.thumb !== '', `⑮ ${candidate.id} 缺标题 / why / 缩略文字`);
      if (candidate.source.kind === 'none') {
        disabledCandidates += 1;
        ok('⑮', candidate.source.reason.trim() !== '', `⑮ 禁用候选 ${candidate.id} 没写原因`);
        if (['A3-CC', 'A5-CD'].includes(candidate.id)) {
          ok('⑮', /误判成空载|不硬载入/.test(candidate.source.reason), `⑮ ${candidate.id} 没写清「归约表会算错」的原因`);
        }
        ok('⑮', candidateDefaults(candidate, { Rc: 3300 }).Rc === 3300, `⑮ 禁用候选 ${candidate.id} 居然改了参数`);
        continue;
      }
      snapshotCandidates += 1;
      const snapFile = join(root, 'src', 'examples', `${candidate.source.exampleId}.json`);
      ok('⑮', existsSync(snapFile), `⑮ 候选 ${candidate.id} 指向的快照不存在：${snapFile}`);
      if (!existsSync(snapFile)) continue;
      const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
      const spec = snap.render_specs[0];
      ok('⑮', SUPPORTED_IDS.includes(candidate.source.baseTemplateId), `⑮ ${candidate.id} 的 baseTemplateId 不在归约表里`);
      const defaults = candidateDefaults(candidate, defaultValues(candidate.source.baseTemplateId), {});
      let state = createUiState(candidate.source.baseTemplateId, freshSkeleton(candidate.source.baseTemplateId, spec, defaults));
      // 页面里的载入动作（同一套 UI 层），只针对归约表不变的候选；换表的那张走路由跳转
      if (candidate.source.baseTemplateId === templateId) {
        state = labUiStep(templateId, state, {
          type: 'loadCandidate',
          candidateId: candidate.id,
          baseTemplateId: candidate.source.baseTemplateId,
          spec,
          defaults,
        });
        ok('⑮', state.dirty === true, `⑮ 载入候选 ${candidate.id} 没标 dirty`);
      }
      for (const [key, want] of Object.entries(snap.parsed_given)) {
        const got = state.preview.params[key];
        ok('⑮', typeof want === 'number' ? rel(got, want) < 1e-12 : got === want, `⑮ ${candidate.id} 的 ${key}=${got} ≠ 快照 ${want}`);
      }
    }
  }
  ok('⑮', snapshotCandidates === 9 && disabledCandidates === 9, `⑮ 候选分布不对：可载入 ${snapshotCandidates} / 禁用 ${disabledCandidates}`);
  // 「只看看」：state 原样返回
  const peekBase = createUiState('A3', freshSkeleton('A3', a3Spec));
  const peekedState = labUiStep('A3', peekBase, { type: 'peekCandidate', candidateId: 'A3-CB' });
  ok('⑮', peekedState === peekBase && !peekedState.dirty, '⑮ 「只看看」改了 state 或 dirty');
  // 共享参数继承：Rc=3300 → 载入 CB 后仍是 3300
  const cb = candidatesFor('A3')[1];
  const cbSnap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3-CB.json'), 'utf8'));
  const inherited = candidateDefaults(cb, defaultValues('A3'), { Rc: 3300 });
  ok('⑮', inherited.Rc === 3300 && inherited.config === 'CB', `⑮ 参数继承 / 组态不对：${JSON.stringify(inherited)}`);
  const inheritedState = createUiState('A3', freshSkeleton('A3', cbSnap.render_specs[0], inherited));
  ok('⑮', inheritedState.preview.params.Rc === 3300 && inheritedState.preview.params.config === 'CB', '⑮ 继承后的归约值不对');
  console.log(`⑮  18 张候选（${snapshotCandidates} 可载入逐位同解 / ${disabledCandidates} 禁用）+ 只看看不动 dirty + Rc 继承`);
}

/* ⑯ ?p= 参数覆盖：生效与手改一致；坏值不生效 */
{
  const paramSpecs = getTemplateRoute('A3').entry.params ?? [];
  const good = parseParamOverrides('Rc:3300,beta:150', paramSpecs);
  ok('⑯', good.values.Rc === 3300 && good.values.beta === 150, `⑯ ?p= 解析错：${JSON.stringify(good.values)}`);
  ok('⑯', good.keys.length === 2 && good.ignored.length === 0, '⑯ ?p= 把合法值误判为非法');
  const bad = parseParamOverrides('bogus:9,Rc:-1,Rc:abc', paramSpecs);
  ok('⑯', Object.keys(bad.values).length === 0 && bad.ignored.length === 3, `⑯ 坏值没被忽略：${JSON.stringify(bad)}`);
  const merged = mergeOverrides(defaultValues('A3'), good.values);
  const fromUrl = freshSkeleton('A3', a3Spec, merged);
  const handEdited = applyOp('A3', freshSkeleton('A3', a3Spec), { op: 'applyParams', values: good.values }).graph;
  const pUrl = reduce('A3', fromUrl).params;
  const pHand = reduce('A3', handEdited).params;
  for (const [key, want] of Object.entries(pHand)) {
    ok('⑯', typeof want === 'number' ? rel(pUrl[key], want) < 1e-12 : pUrl[key] === want, `⑯ ?p= 与手改的 ${key} 不一致`);
  }
  ok('⑯', pUrl.Rc === 3300 && pUrl.beta === 150, `⑯ ?p= 没生效：${JSON.stringify(pUrl)}`);
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('⑯', /parseParamOverrides\(/.test(labSource) && /p-source/.test(labSource), '⑯ 页面没解析 ?p= / 没标「题面」来源角标');
  ok('⑯', /仍需|逐个|确认/.test(labSource), '⑯ 页面没说明覆盖后仍需逐个确认');
  console.log('⑯  ?p=Rc:3300,beta:150 与手改逐键相等；坏值忽略并 toast');
}

/* ── ⑰⑱⑲⑳ W11：9 型往返 / 9 型装配证据 / 13 张不适用卡 / 两条变异 ── */

function w11Snapshot(id) {
  return JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
}

/** 页面同一条装载路径：freshSkeleton（含 M7 的参数化骨架）。 */
function w11Fresh(id) {
  const snap = w11Snapshot(id);
  const route = getTemplateRoute(id);
  const defaults = Object.fromEntries(
    (route.entry.params ?? []).map((p) => [p.key, route.variant?.params?.[p.key] ?? p.defaultValue]),
  );
  const spec = labSkeletonSpec(id, snap.render_specs[0]);
  return { snap, spec, graph: freshSkeleton(id, spec, defaults), defaults };
}

/** ① 条：骨架不改 → params 与快照 parsed_given 逐键相等（含"不多不少"）。 */
function w11RoundtripOk(id) {
  const { snap, graph } = w11Fresh(id);
  const result = reduce(id, graph);
  if (result.outOfScope) return false;
  const given = snap.parsed_given;
  const keys = Object.keys(given);
  if (Object.keys(result.params).length !== keys.length) return false;
  return keys.every((key) => {
    const want = given[key];
    const got = result.params[key];
    return typeof want === 'number'
      ? typeof got === 'number' && rel(got, want) <= 1e-12
      : got === want;
  });
}

/* ⑰ 9 型往返：每型一条 */
for (const id of W11_IDS) {
  ok('⑰', w11RoundtripOk(id), `${id} 骨架不改却没归约出与快照逐键相同的 params`);
}
ok('⑰', W11_IDS.length === 9, `⑰ 新增题型应为 9 型，实际 ${W11_IDS.length}`);
console.log(`⑰  W11 往返：${W11_IDS.join(' / ')} 骨架不改逐键等于快照`);

/* ⑱ 9 型装配证据：电路删负载器件 → 判据拒答带建议；力学删主跨 → structure fail，
   补回 → 判据恢复 + 结果与快照逐位一致。每型一条主断言。 */
const W11_VICTIM = { A2: 'n-rc', A4: 'n-rd', A7: 'n-rl' };
for (const id of W11_IDS) {
  const { snap, graph } = w11Fresh(id);
  let evidence = false;
  if (PICKS[id].family === 'circuit') {
    const out = applyOp(id, graph, { op: 'deleteDevice', nodeId: W11_VICTIM[id] });
    ok('⑱', !out.refused, `${id} 删${W11_VICTIM[id]}被拒：${out.refused ?? ''}`);
    const result = reduce(id, out.graph, out.rules);
    const advice = result.problems.join('；');
    ok('⑱', result.outOfScope, `${id} 删掉负载器件后应明确拒答`);
    ok('⑱', /加回|恢复骨架|换/.test(advice), `${id} 拒答没给可执行建议：${advice}`);
    ok('⑱', Object.keys(result.params).length > 0, `${id} 拒答时不该把能拿到的参数也丢掉`);
    evidence = result.outOfScope && /加回|恢复骨架|换/.test(advice);
  } else {
    const member = graph.edges.find((edge) => ['beam', 'shaft'].includes(edge.kind));
    ok('⑱', Boolean(member), `${id} 骨架里找不到主跨`);
    const broken = applyOp(id, graph, { op: 'deleteMember', edgeId: member.id });
    const bad = reduce(id, broken.graph, broken.rules);
    const advice = bad.problems.join('；');
    ok('⑱', bad.outOfScope, `${id} 删掉主跨后应 structure fail`);
    ok('⑱', /梁|杆|轴|主跨|结构/.test(advice), `${id} 删主跨的拒答没说结构：${advice}`);
    // 补回：addEdge 走页面同一套 op，恢复的杆件种类与原骨架一致
    const restored = applyOp(id, broken.graph, { op: 'addEdge', from: member.from, to: member.to, kind: member.kind });
    ok('⑱', !restored.refused, `${id} 补回主跨被拒：${restored.refused ?? ''}`);
    const good = reduce(id, restored.graph, restored.rules);
    ok('⑱', !good.outOfScope, `${id} 补回主跨后仍拒答：${good.problems.join('；')}`);
    for (const [key, want] of Object.entries(snap.parsed_given)) {
      ok('⑱', typeof want === 'number' ? rel(good.params[key], want) <= 1e-12 : good.params[key] === want, `${id} 补回后 ${key} 与快照不一致`);
    }
    const solved = SOLVERS[id](good.params);
    for (const [key, want] of Object.entries(snap.result)) {
      ok('⑱', typeof want === 'number' ? rel(solved.result[key], want) <= 1e-9 : solved.result[key] === want, `${id} 补回后 result.${key}=${solved.result[key]} ≠ 快照 ${want}`);
    }
    evidence = bad.outOfScope && !good.outOfScope;
  }
  ok('⑱', evidence, `${id} 没有可装配证据`);
}
console.log('⑱  W11 装配证据：电路删负载器件拒答带建议 / 力学删主跨→补回→判据与结果逐位恢复');

/* ⑲ 13 张不适用卡：字符串逐型写死（门禁自己再钉一遍，不跟页面共用 token） */
const NA_TOKENS = {
  D1: '最小项',
  D2: '门级逻辑的二进制位串',
  D3: '译码器 / MUX / 加法器的功能位串',
  D4: '边沿时刻',
  D5: '状态位流与 FSM 转移表',
  D6: '数的表示法不涉及任何几何结构',
  M6: '一个应力元',
  M8: '力偶位置固定在 x = 0.5',
  S1: '约束矩阵的秩判据',
  S2: '力是自由矢量',
  S4: '摩擦角与自锁不等式',
  S6: '面积一阶矩',
  S7: '虚功方程',
};
const w11LabSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
const w11AboutSource = readFileSync(join(root, 'src', 'pages', 'About.tsx'), 'utf8');
ok('⑲', /notApplicableView\(templateId\)/.test(w11LabSource) && /NotApplicableCard/.test(w11LabSource), '⑲ 页面没有渲染不适用卡');
ok('⑲', /na-card/.test(w11LabSource) && /na-reason/.test(w11LabSource) && /na-button/.test(w11LabSource), '⑲ 不适用卡缺可核验的 testid');
ok('⑲', /coverage-ledger/.test(w11AboutSource) && /拼接台：可装配/.test(w11AboutSource), '⑲ about 覆盖表缺新列 / 逐型账本');
ok('⑲', LAB_LEDGER_COUNTS.total === 29 && LAB_LEDGER_COUNTS.assemblable === 16 && LAB_LEDGER_COUNTS.notApplicable === 13, `⑲ 账本数量不对：${JSON.stringify(LAB_LEDGER_COUNTS)}`);
ok('⑲', notApplicableLedgerCheck().ok, `⑲ 账本自检没过：${notApplicableLedgerCheck().problems.join('；')}`);
for (const id of NOT_APPLICABLE_IDS) {
  const view = notApplicableView(id);
  const reason = view?.reason ?? '';
  const others = Object.entries(NA_TOKENS).filter(([key]) => key !== id).map(([, token]) => token);
  ok(
    '⑲',
    Boolean(view) &&
      reason === NOT_APPLICABLE[id].reason &&
      reason.includes(NA_TOKENS[id]) &&
      reason.length >= 30 &&
      !others.some((token) => reason.includes(token)) &&
      (view?.buttons.length ?? 0) >= 2 &&
      (view?.buttons ?? []).every((button) => button.hash.startsWith('#/')) &&
      /NotApplicableCard/.test(w11LabSource),
    `${id} 卡缺专属原因 / 用了通用句 / 抄了别型 / 没有去向按钮`,
  );
}
ok('⑲', NOT_APPLICABLE_IDS.length === 13 && Object.keys(NA_TOKENS).length === 13, '⑲ 不适用型清单与门禁写死的字符串数不一致');
console.log(`⑲  不适用卡：${NOT_APPLICABLE_IDS.length} 型逐型专属原因 + 三个去向 + about 覆盖列`);

/* ⑳ 变异一：A2 的 Rc 映射改成 R2 → ⑰ 必须红；还原后回绿 */
{
  const pick = PICKS.A2.picks.find((entry) => entry.key === 'Rc');
  const original = pick.sources;
  ok('⑳', w11RoundtripOk('A2'), '⑳ 变异前 A2 往返就该是绿的');
  pick.sources = [{ src: 'device', device: 'R2' }];
  ok('⑳', w11RoundtripOk('A2') === false, '⑳ A2 的 Rc→R2 变异没被 ⑰ 拦下（门禁空转）');
  pick.sources = original;
  ok('⑳', w11RoundtripOk('A2'), '⑳ 还原后 A2 没回绿');
  console.log('⑳  变异一：A2 Rc 映射 → R2，第 1 条（往返）变红；还原回绿');
}

/* ⑳ 变异二：把「不适用」卡文案换成通用句 / 抄别型 / 给已可装的 M1 造通用卡
   —— 第 3 条（13 张卡）必须红。文档写「M1 的卡」，M1 现在是可装配型，
   所以三种写法各钉一次，覆盖"通用句"和"互相抄"两种抄法。 */
{
  const original = NOT_APPLICABLE.M6.reason;
  NOT_APPLICABLE.M6.reason = '本题不适用，不求解，请换题型';
  ok('⑳', notApplicableLedgerCheck().ok === false, '⑳ 通用句没被第 3 条拦下');
  ok('⑳', !notApplicableView('M6').reason.includes(NA_TOKENS.M6), '⑳ 通用句竟没让 ⑲ 的逐型字符串断言失效');
  NOT_APPLICABLE.M6.reason = NOT_APPLICABLE.D1.reason;
  ok('⑳', notApplicableLedgerCheck().ok === false, '⑳ 抄别型的文案没被第 3 条拦下');
  ok('⑳', notApplicableView('M6').reason.includes(NA_TOKENS.D1), '⑳ 抄来的文案没带出别型的特征词');
  NOT_APPLICABLE.M6.reason = original;
  NOT_APPLICABLE.M1 = { ...NOT_APPLICABLE.D1, id: 'M1', title: 'M1 轴向拉压', reason: '本题不适用，不求解', token: '通用' };
  ok('⑳', notApplicableLedgerCheck().ok === false, '⑳ 给已可装配的 M1 造通用不适用卡没被第 3 条拦下');
  delete NOT_APPLICABLE.M1;
  ok('⑳', notApplicableLedgerCheck().ok, '⑳ 还原后第 3 条没回绿');
  console.log('⑳  变异二：通用句 / 抄别型 / M1 假卡 → 第 3 条变红；还原回绿');
}

/* ── ㉑ W13 P0：删器件必须连带删掉它的导线（owner 归属，走 UI 动作序列） ── */

/** 点到线段距离（验收第 1 条的「端点落在 / 穿越」判定）。 */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 边是否触碰 (x,y) 附近 tol 单位（端点或折线穿越）。 */
function edgeTouches(edge, x, y, tol = 1.0) {
  const pts = edge.points ?? [];
  if (pts.length < 2) return false;
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= tol) return true;
  }
  return false;
}

/** P0 五条验收，返回失败清单（空 = 全过）。deleteId 换成 n-rl 即对照组。 */
function runP0(deleteId, deletedPinXys) {
  const failures = [];
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  state = labUiStep('A3', state, { type: 'op', op: { op: 'deleteDevice', nodeId: deleteId } });
  if (state.graph.nodes.some((node) => node.id === deleteId)) {
    failures.push(`${deleteId} 删除被拒：${state.note}`);
    return failures;
  }
  // 1. 不存在任何触碰已删引脚坐标、且不连任何剩余器件的边
  const bad = state.graph.edges.filter(
    (edge) => deletedPinXys.some(([x, y]) => edgeTouches(edge, x, y)) && !connectedToAnyDevice(state.graph, edge),
  );
  if (bad.length > 0) failures.push(`残留孤线：${bad.map((edge) => edge.id).join(', ')}`);
  // 2. 器件专属导线消失（Rc → e-vcc-bar；Rl → e-rl-bus / e-rl-gnd）
  const ownedIds = { 'n-rc': ['e-vcc-bar'], 'n-rl': ['e-rl-bus', 'e-rl-gnd'] };
  for (const id of ownedIds[deleteId] ?? []) {
    if (state.graph.edges.some((edge) => edge.id === id)) failures.push(`专属导线 ${id} 没删`);
  }
  // 3. 不残留孤立 dot（与已删引脚同坐标、且没有边穿过它）
  for (const [x, y] of deletedPinXys) {
    const orphan = state.graph.nodes.filter(
      (node) => node.kind === 'dot' && Math.hypot(node.x - x, node.y - y) <= 1.0 && !state.graph.edges.some((edge) => edgeTouches(edge, x, y)),
    );
    if (orphan.length > 0) failures.push(`孤立 dot：${orphan.map((dot) => dot.id).join(', ')}`);
  }
  // 4. reduce 的 params 与修前完全一致 —— 删的是线，不是语义
  const params = state.preview.params;
  const expectRc = deleteId === 'n-rc' ? 1e12 : a3Snap.parsed_given.Rc;
  const expectRl = deleteId === 'n-rl' ? 1e12 : a3Snap.parsed_given.Rl;
  if (params.Rc !== expectRc) failures.push(`params.Rc=${params.Rc} ≠ ${expectRc}`);
  if (params.Rl !== expectRl) failures.push(`params.Rl=${params.Rl} ≠ ${expectRl}`);
  for (const [key, want] of Object.entries(a3Snap.parsed_given)) {
    if (key === 'Rc' || key === 'Rl') continue;
    const got = params[key];
    if (typeof want === 'number' ? rel(got, want) > 1e-12 : got !== want) failures.push(`params.${key}=${got} ≠ 快照 ${want}`);
  }
  // 5. shared 汇流条/输出端不陪葬
  for (const id of ['e-cbus', 'e-out', 'e-gnd-rail']) {
    if (!state.graph.edges.some((edge) => edge.id === id)) failures.push(`shared 边 ${id} 不该被删`);
  }
  return failures;
}

{
  const p0 = runP0('n-rc', [[560, 76], [560, 164]]);
  ok('㉑', p0.length === 0, `P0 删 Rc 验收失败：${p0.join('；')}`);
  const p0rl = runP0('n-rl', [[700, 246], [700, 334]]);
  ok('㉑', p0rl.length === 0, `P0 对照删 Rl 验收失败：${p0rl.join('；')}`);
  // 对照组：删 shared 汇流条（deleteMember）不删任何器件
  const sharedDel = applyOp('A3', freshSkeleton('A3', a3Spec), { op: 'deleteMember', edgeId: 'e-cbus' });
  const devicesBefore = freshSkeleton('A3', a3Spec).nodes.filter((node) => !['text', 'dot'].includes(node.kind)).length;
  const devicesAfter = sharedDel.graph.nodes.filter((node) => !['text', 'dot'].includes(node.kind)).length;
  ok('㉑', !sharedDel.refused && devicesAfter === devicesBefore, `㉑ 删 shared 汇流条竟删了器件：${devicesBefore}→${devicesAfter}`);
  console.log('㉑  P0 删 Rc（连带 e-vcc-bar + 孤儿 dot）/ 删 Rl 对照 / shared 汇流条不删器件 / params 逐键一致');

  // 变异：owner 判定永远 undefined → 删器件一条线都删不掉 → 第 1/2 条必须红
  ok('㉑', runP0('n-rc', [[560, 76], [560, 164]]).length === 0, '㉑ 变异前就该是绿的');
  OWNER_CONFIG.enabled = false;
  const mutated = runP0('n-rc', [[560, 76], [560, 164]]);
  ok('㉑', mutated.length > 0, '㉑ owner 变异没被拦下（门禁空转）');
  OWNER_CONFIG.enabled = true;
  ok('㉑', runP0('n-rc', [[560, 76], [560, 164]]).length === 0, '㉑ 还原后没回绿');
  console.log('㉑  变异三：owner → 永远 undefined，残留孤线 / 专属导线没删变红；还原回绿');
}

/* ── ㉒ W14：删后三处残留一次清掉（失效文字 / 孤立 dot / 空头回缩） ── */

/** 端点沿「边端点 → dot → 其他边」能否触到某个器件引脚（母线端点附着判定）。 */
function endpointReachesDevice(graph, x, y, tol = 0.6) {
  const anchors = graph.nodes
    .filter((node) => !['text', 'dot'].includes(node.kind))
    .flatMap((node) => anchorsOfNode(node, graph.family).map((a) => [a.x, a.y]));
  const dots = graph.nodes.filter((node) => node.kind === 'dot');
  const seenEdge = new Set();
  const seenPt = new Set();
  const queue = [[x, y]];
  while (queue.length > 0) {
    const [cx, cy] = queue.pop();
    const key = `${Math.round(cx * 10)},${Math.round(cy * 10)}`;
    if (seenPt.has(key)) continue;
    seenPt.add(key);
    if (anchors.some(([ax, ay]) => Math.hypot(ax - cx, ay - cy) <= tol)) return true;
    for (const dot of dots) {
      if (Math.hypot(dot.x - cx, dot.y - cy) <= tol) queue.push([dot.x, dot.y]);
    }
    for (const edge of graph.edges) {
      if (seenEdge.has(edge.id) || !edge.points || edge.points.length < 2) continue;
      const ends = [edge.points[0], edge.points[edge.points.length - 1]];
      if (ends.some(([ex, ey]) => Math.hypot(ex - cx, ey - cy) <= tol)) {
        seenEdge.add(edge.id);
        queue.push(...ends);
      }
    }
  }
  return false;
}

{
  // ① 删 n-rc 后：纯说明文字「VCC（交流地）」随横杠一起消失；t-note（无归属）保留
  let state = createUiState('A3', freshSkeleton('A3', a3Spec));
  state = labUiStep('A3', state, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('㉒', !state.graph.nodes.some((node) => node.kind === 'text' && (node.label ?? '').includes('VCC（交流地）')), '㉒① 失效文字 VCC（交流地）还在半空');
  ok('㉒', state.graph.nodes.some((node) => node.id === 't-note'), '㉒① 无归属的说明文字 t-note 被误删');

  // ② 删 n-rc 后：母线两端各自仍连器件（左端经 e-c-bus→npn C，右端经 e-rl-bus→Rl 顶），中间无孤立 dot
  const cbus = state.graph.edges.find((edge) => edge.id === 'e-cbus');
  ok('㉒', Boolean(cbus) && endpointReachesDevice(state.graph, cbus.points[0][0], cbus.points[0][1]) && endpointReachesDevice(state.graph, cbus.points[cbus.points.length - 1][0], cbus.points[cbus.points.length - 1][1]), '㉒② 母线端点不再附着任何器件');
  for (const dot of state.graph.nodes.filter((node) => node.kind === 'dot' && Math.abs(node.y - 164) < 0.6 && node.x > 488 && node.x < 701)) {
    const hasEdge = state.graph.edges.some((edge) => edgeTouches(edge, dot.x, dot.y, 0.6));
    const hasPin = state.graph.nodes.some(
      (node) => !['text', 'dot'].includes(node.kind) && anchorsOfNode(node, 'circuit').some((a) => Math.hypot(a.x - dot.x, a.y - dot.y) <= 1.0),
    );
    ok('㉒', hasEdge || hasPin, `㉒② 母线上孤立 dot：${dot.id}`);
  }

  // ③ 删 n-rl 后：地轨右端不再停在原 Rl 的 x=700 —— 回缩到最后附着点（e-e-gnd 结点 488.8）
  let stateRl = createUiState('A3', freshSkeleton('A3', a3Spec));
  stateRl = labUiStep('A3', stateRl, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  const rail = stateRl.graph.edges.find((edge) => edge.id === 'e-gnd-rail');
  const railEnd = rail?.points?.[rail.points.length - 1];
  ok('㉒', Boolean(railEnd) && railEnd[0] < 699 && Math.abs(railEnd[0] - 488.8) <= 0.6 && Math.abs(railEnd[1] - 470) <= 0.6, `㉒③ 地轨右端没有回缩：${JSON.stringify(railEnd ?? null)}`);

  // ④ 对照组不变：删 shared 汇流条 → 器件一个不少
  const sharedDel = applyOp('A3', freshSkeleton('A3', a3Spec), { op: 'deleteMember', edgeId: 'e-cbus' });
  const devicesBefore = freshSkeleton('A3', a3Spec).nodes.filter((node) => !['text', 'dot'].includes(node.kind)).length;
  const devicesAfter = sharedDel.graph.nodes.filter((node) => !['text', 'dot'].includes(node.kind)).length;
  ok('㉒', !sharedDel.refused && devicesAfter === devicesBefore, `㉒④ 删 shared 汇流条竟删了器件：${devicesBefore}→${devicesAfter}`);
  console.log('㉒  失效文字随 owner 删 / 母线端点仍附着无孤立 dot / 地轨右端回缩到 488.8 / shared 对照不变');

  // 变异：关掉「text 随 owner 删」→ ① 必须红
  ok('㉒', (() => {
    const fresh = createUiState('A3', freshSkeleton('A3', a3Spec));
    return !labUiStep('A3', fresh, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } }).graph.nodes.some((node) => node.kind === 'text' && (node.label ?? '').includes('VCC（交流地）'));
  })(), '㉒ 变异前就该是绿的');
  RESIDUE_CONFIG.textWithOwner = false;
  const mutatedState = createUiState('A3', freshSkeleton('A3', a3Spec));
  const mutated = labUiStep('A3', mutatedState, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('㉒', mutated.graph.nodes.some((node) => node.kind === 'text' && (node.label ?? '').includes('VCC（交流地）')), '㉒ text 变异没被拦下（门禁空转）');
  RESIDUE_CONFIG.textWithOwner = true;
  const restored = createUiState('A3', freshSkeleton('A3', a3Spec));
  const restoredState = labUiStep('A3', restored, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('㉒', !restoredState.graph.nodes.some((node) => node.kind === 'text' && (node.label ?? '').includes('VCC（交流地）')), '㉒ 还原后没回绿');
  console.log('㉒  变异：textWithOwner=false → 失效文字残留变红；还原回绿');
}

/* ── ㉓ W16：setDeviceValue —— node.value 是唯一真相 ─────────────── */
{
  // ① 手加 RSS（A5 骨架没画 RSS，pick 表 {device:'RSS'} 只认标签前缀）：
  //    先给个误导性占位（value=999、label 'RSS 999'），再设 3.3k ——
  //    value 优先时 params.Rss===3300；只认 label 时 valueFromLabel('… 3.3k')=3.3。
  const a5 = loadSkeleton('A5');
  let state = createUiState('A5', a5.graph);
  state = labUiStep('A5', state, { type: 'op', op: { op: 'addDevice', kind: 'res', label: 'RSS', value: 999, x: 120, y: 560 } });
  // W22-A：新器件 id 走单调 seq（n-add-N），不再由 label 生成 —— 动态取。
  const rssId = state.graph.nodes.find((node) => node.label === 'RSS')?.id;
  state = labUiStep('A5', state, { type: 'op', op: { op: 'setDeviceValue', nodeId: rssId, value: 3300 } });
  const rz = state.graph.nodes.find((node) => node.id === rssId);
  ok('㉓', rz && rz.value === 3300, `㉓① 手加器件 node.value=${rz?.value}，应为 3300`);
  ok('㉓', (rz?.label ?? '').includes('3.3k'), `㉓① label 没按 kind 重写成 3.3k：${rz?.label}`);
  const r1 = reduce('A5', state.graph, state.rules);
  ok('㉓', r1.params.Rss === 3300, `㉓① params.Rss=${r1.params.Rss}，应为 3300（不在 pick 表命名里的新器件也能改值）`);
  ok('㉓', !r1.outOfScope, `㉓① 未接线的 RSS 只该提醒不该拒：${r1.problems.filter((p) => !p.startsWith('悬空端口')).join('；')}`);
  ok('㉓', r1.problems.some((p) => p.startsWith('悬空端口') && p.includes('RSS')), '㉓① 未接线提醒没出现');
  // ② 题库骨架 Rc 2.0k → 4.7k：params 变、Av 与手算一致
  const a3 = loadSkeleton('A3');
  let state2 = createUiState('A3', a3.graph);
  state2 = labUiStep('A3', state2, { type: 'op', op: { op: 'setDeviceValue', nodeId: 'n-rc', value: 4700 } });
  ok('㉓', state2.preview.params.Rc === 4700, `㉓② params.Rc=${state2.preview.params.Rc}，应为 4700`);
  ok('㉓', state2.graph.nodes.find((node) => node.id === 'n-rc').label === 'Rc 4.7k', `㉓② label=${state2.graph.nodes.find((node) => node.id === 'n-rc').label}`);
  const p2 = state2.preview.params;
  const gm2 = p2.Ic / 0.026;
  const rpi2 = p2.beta / gm2;
  const hand2 = -gm2 * par(p2.Rc, p2.Rl) * (rpi2 / (p2.Rs + rpi2));
  const solved2 = SOLVERS.A3(p2);
  ok('㉓', rel(solved2.result.AvNoRo, hand2) < 1e-9, `㉓② AvNoRo=${solved2.result.AvNoRo} 与手算 ${hand2} 不一致`);
  // ③ 非法值：op 拒绝、图不动
  const before3 = state2.graph;
  const bad = labUiStep('A3', state2, { type: 'op', op: { op: 'setDeviceValue', nodeId: 'n-rc', value: -1 } });
  ok('㉓', bad.graph === before3 && bad.note.includes('(0, 1e12]'), `㉓③ 非法值 -1 没被拒：${bad.note}`);
  const bad2 = labUiStep('A3', state2, { type: 'op', op: { op: 'setDeviceValue', nodeId: 'n-rc', value: Number.NaN } });
  ok('㉓', bad2.graph === before3, '㉓③ NaN 没被拒');
  console.log(`㉓  手加器件设 3.3k（value 真相）/ Rc→4.7k AvNoRo=${solved2.result.AvNoRo.toPrecision(6)}=手算 / 非法值拒`);
  // ④ 变异：preferNodeValue=false（只认 label）→ ① 的 params.Rl 读成 3.3 → 红
  ok('㉓', REDUCE_CONFIG.preferNodeValue === true, '㉓ 变异前就该是绿的');
  REDUCE_CONFIG.preferNodeValue = false;
  const mutated = reduce('A5', state.graph, state.rules);
  ok('㉓', mutated.params.Rss !== 3300, '㉓ 变异（只认 label）后 params.Rss 还是 3300（门禁空转）');
  REDUCE_CONFIG.preferNodeValue = true;
  ok('㉓', reduce('A5', state.graph, state.rules).params.Rss === 3300, '㉓ 变异还原后没回绿');
  console.log('㉓  变异：preferNodeValue=false → ① 红（3.3k 被读成 3.3）；还原回绿');
}

/* ── ㉔ W16：rotateDevice —— 旋转 + 导线重吸附 ───────────────────── */
{
  const { graph } = loadSkeleton('A3');
  let state = createUiState('A3', graph);
  state = labUiStep('A3', state, { type: 'op', op: { op: 'rotateDevice', nodeId: 'n-q', delta: 90 } });
  const q = state.graph.nodes.find((node) => node.id === 'n-q');
  ok('㉔', q.rot === 90, `㉔① rot=${q.rot}，应为 90`);
  // ① 三个引脚的世界坐标与 pinAt 逐位相等（渲染器与装配台共用同一份旋转数学）
  for (const pinId of ['b', 'c', 'e']) {
    const [px, py] = pinAt('npn', [q.x, q.y], 90, pinId);
    const anchor = anchorsOfNode(q, 'circuit').find((one) => one.key === `n-q:${pinId}`);
    ok('㉔', anchor && anchor.x === px && anchor.y === py, `㉔① 引脚 ${pinId} 与 pinAt 不等：${anchor?.x},${anchor?.y} ≠ ${px},${py}`);
  }
  // ② reduce 不崩、params 无 NaN（problems 有话说话或照常出数值，二选一都合法）
  ok('㉔', !state.preview.outOfScope || state.preview.problems.length > 0, '㉔② 判 U 却没给原因');
  ok(
    '㉔',
    Object.values(state.preview.params).every((value) => typeof value !== 'number' || Number.isFinite(value)),
    '㉔② params 里出了 NaN',
  );
  // ③ A1 二极管转 180°：netSolve 解出反偏（电流变号 + notes 里点破方向）
  const a1snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A1.json'), 'utf8'));
  let a1 = createUiState('A1', freshSkeleton('A1', a1snap.render_specs[0]));
  const forward = netSolve(a1.graph, {});
  ok('㉔', forward.ok && forward.solution.branchCurrents['n-d'] > 0, '㉔③ A1 原朝向的二极管电流应为正（导通）');
  a1 = labUiStep('A1', a1, { type: 'op', op: { op: 'rotateDevice', nodeId: 'n-d', delta: 180 } });
  const reversed = netSolve(a1.graph, {});
  ok('㉔', reversed.ok && reversed.solution.branchCurrents['n-d'] < 0, `㉔③ 转 180° 后电流=${reversed.ok ? reversed.solution.branchCurrents['n-d'] : 'refused'}，应为负（反偏）`);
  ok('㉔', reversed.ok && reversed.solution.notes.some((note) => note.includes('方向')), '㉔③ notes 没点破方向');
  console.log(`㉔  npn 转 90° 引脚=pinAt / A1 二极管转 180° 电流 ${forward.solution.branchCurrents['n-d'].toPrecision(3)} → ${reversed.solution.branchCurrents['n-d'].toPrecision(3)} A（反偏被点破）`);
  // ④ 变异：旋转后不重新吸附导线端点 → 集电极竖线端点留在旧引脚位置 → 红
  const collectorEnd = (graph2) => {
    const q2 = graph2.nodes.find((node) => node.id === 'n-q');
    const pin = anchorsOfNode(q2, 'circuit').find((one) => one.key === 'n-q:c');
    const bus = graph2.edges.find((edge) => edge.id === 'e-c-bus');
    return { pin, busEnd: bus?.points?.[0] };
  };
  const good = collectorEnd(state.graph);
  ok('㉔', good.pin && good.busEnd && Math.hypot(good.busEnd[0] - good.pin.x, good.busEnd[1] - good.pin.y) <= 0.6, '㉔④ 集电极竖线端点没吸到新引脚（没变异却红了）');
  ROTATE_CONFIG.resnap = false;
  const noSnap = labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'rotateDevice', nodeId: 'n-q', delta: 90 } });
  const badSnap = collectorEnd(noSnap.graph);
  ok('㉔', badSnap.pin && badSnap.busEnd && Math.hypot(badSnap.busEnd[0] - badSnap.pin.x, badSnap.busEnd[1] - badSnap.pin.y) > 0.6, '㉔ 变异（不重吸附）后端点仍在新引脚上（门禁空转）');
  ROTATE_CONFIG.resnap = true;
  const reSnap = collectorEnd(labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'rotateDevice', nodeId: 'n-q', delta: 90 } }).graph);
  ok('㉔', reSnap.pin && reSnap.busEnd && Math.hypot(reSnap.busEnd[0] - reSnap.pin.x, reSnap.busEnd[1] - reSnap.pin.y) <= 0.6, '㉔ 变异还原后没回绿');
  console.log('㉔  变异：resnap=false → ④ 端点-引脚距离断言红；还原回绿');
}

/* ── ㉕ W16：deleteEdge —— 删线 = 开路被认出 + 收尾清理 ───────────── */
{
  const { graph } = loadSkeleton('A3');
  // ① 删 e-c-bus（Q 集电极到母线的竖线）：edges -1、开路被认出、档位 U
  let state = createUiState('A3', graph);
  const edgesBefore = state.graph.edges.length;
  state = labUiStep('A3', state, { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-c-bus' } });
  ok('㉕', state.graph.edges.length === edgesBefore - 1, `㉕① edges=${state.graph.edges.length}，应 ${edgesBefore - 1}`);
  ok('㉕', state.preview.problems.some((p) => p.startsWith('开路') && p.includes('集电极')), `㉕① 开路没被认出：${state.preview.problems.join('；')}`);
  ok('㉕', state.preview.tier === 'U', `㉕① 档位=${state.preview.tier}，应为 U（页面不渲染数值结果）`);
  ok('㉕', !state.graph.nodes.some((node) => node.kind === 'dot' && Math.hypot(node.x - 488.8, node.y - 164) <= 1.0), '㉕① (488.8,164) 的孤立 dot d-cbus 没清掉');
  // ② Ctrl+Z：边回来、problems 清空、params/tier 逐字段恢复
  const baseline2 = createUiState('A3', graph);
  const snapshotBefore = { params: JSON.stringify(baseline2.preview.params), tier: baseline2.preview.tier };
  state = labUiStep('A3', state, { type: 'undo' });
  ok('㉕', state.graph.edges.some((edge) => edge.id === 'e-c-bus'), '㉕② 撤销后导线没回来');
  ok('㉕', state.preview.problems.every((p) => !p.startsWith('开路')), `㉕② 撤销后开路还在：${state.preview.problems.join('；')}`);
  ok('㉕', JSON.stringify(state.preview.params) === snapshotBefore.params && state.preview.tier === snapshotBefore.tier, `㉕② 撤销后 params/tier 没逐字段恢复：${JSON.stringify(state.preview.params)} vs ${snapshotBefore.params} / ${state.preview.tier} vs ${snapshotBefore.tier}`);
  // ③ 删 e-rl-gnd（shared）：地轨右端回缩到最后附着点 488.8
  let state3 = createUiState('A3', graph);
  state3 = labUiStep('A3', state3, { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-rl-gnd' } });
  const rail = state3.graph.edges.find((edge) => edge.id === 'e-gnd-rail');
  const railEnd = rail?.points?.[rail.points.length - 1];
  ok('㉕', Boolean(railEnd) && railEnd[0] <= 488.8 + 0.6 && Math.abs(railEnd[0] - 488.8) <= 0.6, `㉕③ 地轨右端没回缩到 488.8：${JSON.stringify(railEnd ?? null)}`);
  ok('㉕', state3.preview.problems.some((p) => p.startsWith('开路')), '㉕③ 删 Rl 接地线后开路没被认出');
  console.log(`㉕  删 e-c-bus → 开路 U 档 + 孤立 dot 清理 / Ctrl+Z 逐字段恢复 / 删 e-rl-gnd → 地轨右端回缩 ${railEnd?.[0]}`);
  // ④ 变异：删边后不跑 prune → 孤立 dot d-cbus 留在 (488.8,164) → 红
  ok('㉕', DELETE_EDGE_CONFIG.prune === true, '㉕ 变异前就该是绿的');
  DELETE_EDGE_CONFIG.prune = false;
  const noPrune = labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-c-bus' } });
  ok('㉕', noPrune.graph.nodes.some((node) => node.kind === 'dot' && Math.hypot(node.x - 488.8, node.y - 164) <= 1.0), '㉕ 变异（不 prune）后孤立 dot 还是没了（门禁空转）');
  DELETE_EDGE_CONFIG.prune = true;
  const restored = labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-c-bus' } });
  ok('㉕', !restored.graph.nodes.some((node) => node.kind === 'dot' && Math.hypot(node.x - 488.8, node.y - 164) <= 1.0), '㉕ 变异还原后没回绿');
  console.log('㉕  变异：prune=false → ① 孤立 dot 断言红；还原回绿');
}

/* ── ㉖ W16：拖动确认 —— 40px 后 params 不变、端点仍吸附 ─────────── */
{
  const { graph } = loadSkeleton('A3');
  const baseline = createUiState('A3', graph);
  let state = labUiStep('A3', baseline, { type: 'moveNode', nodeId: 'n-rs', x: baseline.graph.nodes.find((n) => n.id === 'n-rs').x + 40, y: baseline.graph.nodes.find((n) => n.id === 'n-rs').y });
  state = labUiStep('A3', state, { type: 'moveNodeEnd', before: baseline.graph });
  ok('㉖', JSON.stringify(state.preview.params) === JSON.stringify(baseline.preview.params), '㉖ 拖动 40px 后 params 变了');
  const anchors = anchorsOf(state.graph);
  const loose = state.graph.edges.filter((edge) => {
    if (!edge.points || edge.points.length < 2) return false;
    return [edge.points[0], edge.points[edge.points.length - 1]].some(([x, y]) => !anchors.some((a) => Math.hypot(a.x - x, a.y - y) <= 0.6));
  });
  ok('㉖', loose.length === 0, `㉖ 拖动后有 ${loose.length} 条边端点脱附：${loose.map((e) => e.id).join(',')}`);
  ok('㉖', state.undoStack.length === 0, '㉖ 拖动不该进撤销栈');
  console.log('㉖  拖动 Rs 40px：params 逐键不变、端点全吸附 ≤0.6、不产生历史');
  // 变异：dragSnapshots=true（拖动也入栈）→ ㉖「不产生历史」红
  ok('㉖', UNDO_CONFIG.dragSnapshots === false, '㉖ 变异前就该是绿的');
  UNDO_CONFIG.dragSnapshots = true;
  const snapDrag = labUiStep('A3', baseline, { type: 'moveNode', nodeId: 'n-rs', x: baseline.graph.nodes.find((n) => n.id === 'n-rs').x + 40, y: baseline.graph.nodes.find((n) => n.id === 'n-rs').y });
  const snapDragEnd = labUiStep('A3', snapDrag, { type: 'moveNodeEnd', before: baseline.graph });
  ok('㉖', snapDragEnd.undoStack.length > 0, '㉖ 变异（拖动入栈）后栈还是空的（门禁空转）');
  UNDO_CONFIG.dragSnapshots = false;
  const restoredDrag = labUiStep('A3', baseline, { type: 'moveNode', nodeId: 'n-rs', x: baseline.graph.nodes.find((n) => n.id === 'n-rs').x + 40, y: baseline.graph.nodes.find((n) => n.id === 'n-rs').y });
  ok('㉖', labUiStep('A3', restoredDrag, { type: 'moveNodeEnd', before: baseline.graph }).undoStack.length === 0, '㉖ 变异还原后没回绿');
  console.log('㉖  变异：dragSnapshots=true → 「不产生历史」断言红；还原回绿');
}

/* ── ㉗ W17-A：删除即合并（走 UI 动作序列；上表四条 + 三条硬规则） ── */
{
  const { graph } = loadSkeleton('A3');
  const baseline = createUiState('A3', graph);

  // ① 串联器件：删 Rs → 两端合并（Vs 直连 Q），params.Rs=0，Av 与等价图逐位一致
  let state = labUiStep('A3', baseline, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });
  ok('㉗', state.preview.params.Rs === 0, `㉗① params.Rs=${state.preview.params.Rs} ≠ 0（删即合并没生效）`);
  ok(
    '㉗',
    state.rules.some((rule) => rule.includes('Rs') && rule.includes('串联在信号链上，两端合并')),
    `㉗① appliedRules 没记合并：${state.rules.at(-1)}`,
  );
  const healWire = state.graph.edges.find((edge) => edge.id.startsWith('e-heal'));
  ok('㉗', Boolean(healWire), '㉗① 合并导线没补上');
  const gm = 0.001 / 0.026;
  const par = 1 / (1 / 2000 + 1 / 10000 + 1 / 100000);
  const avExpected = -gm * par;
  const healed = netSolve(state.graph, netSolveOptionsFor(state.graph).options);
  ok('㉗', healed.ok && Math.abs((healed.solution.nodeVoltages['n-vo'] ?? NaN) - avExpected) <= 1e-9, `㉗① 合并后 Av=${healed.ok ? healed.solution.nodeVoltages['n-vo'] : healed.code} ≠ ${avExpected}`);
  // 等价图：Rs 换成一根直连导线 → 逐位一致（≤1e-12）。等价图用同一条
  // freshSkeleton 路径造（Q 的工作点 params / value 必须在，netSolve 才收）。
  const spec0 = labSkeletonSpec('A3', JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8')).render_specs[0]);
  const equivBase = freshSkeleton('A3', spec0);
  const equiv = {
    ...equivBase,
    meta: { ...equivBase.meta },
    nodes: equivBase.nodes.filter((node) => node.id !== 'n-rs'),
    edges: equivBase.edges.filter((edge) => edge.id !== 'e-rs-q').concat([{ id: 'e-equiv', from: 'n-vs:p', to: 'n-q:b', kind: 'wire' }]),
  };
  const eqSol = netSolve(equiv, { vsrcValues: { 'n-vs': 1 } });
  const healedSol = netSolve(state.graph, { vsrcValues: { 'n-vs': 1 } });
  let maxDiff = Infinity;
  if (eqSol.ok && healedSol.ok) {
    // 网名是几何派生的（heal 线 id ≠ 等价线 id），按键对比会错位 ——
    // 按【器件引脚】对齐：两只图幸存器件的引脚集合相同，逐引脚比电位。
    maxDiff = 0;
    const pins = new Set([...Object.keys(healedSol.solution.netOfPin ?? {})]);
    for (const pin of pins) {
      const netA = healedSol.solution.netOfPin[pin];
      const netB = eqSol.solution.netOfPin[pin];
      if (!netA || !netB) continue;
      maxDiff = Math.max(maxDiff, Math.abs((healedSol.solution.nodeVoltages[netA] ?? 0) - (eqSol.solution.nodeVoltages[netB] ?? 0)));
    }
  }
  ok('㉗', maxDiff <= 1e-12, `㉗① 合并图与 Rs=0 等价图节点电位差 ${maxDiff} > 1e-12`);
  console.log(`㉗① 删 Rs（串联）→ 合并（Vs 直连 Q）：params.Rs=0、Av=${healed.ok ? healed.solution.nodeVoltages['n-vo'] : healed.code}（手算 ${avExpected}）、与等价图 maxDiff=${maxDiff.toExponential(1)}`);

  // ② 负载型（硬规则 2）：删 Rl → 不合并，负载支路开路，Av 仍按 Rc∥ro
  const stRl = labUiStep('A3', baseline, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  ok('㉗', !stRl.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉗② 删 Rl 不该合并（gnd 硬规则）');
  ok(
    '㉗',
    stRl.rules.some((rule) => rule.includes('已删除负载 Rl') && rule.includes('开路')),
    `㉗② appliedRules 没记负载开路：${stRl.rules.at(-1)}`,
  );
  ok('㉗', stRl.preview.params.Rl === 1e12, `㉗② params.Rl=${stRl.preview.params.Rl} ≠ 1e12（空载）`);
  // 「Av 仍按 Rc∥ro 算」的对照：把 Rl 留着但设为 1e12（开路等价），两图 vo 应一致
  const stRef = labUiStep('A3', baseline, { type: 'op', op: { op: 'setDeviceValue', nodeId: 'n-rl', value: 1e12 } });
  const refSol = netSolve(stRef.graph, netSolveOptionsFor(stRef.graph).options);
  const rlSol = netSolve(stRl.graph, netSolveOptionsFor(stRl.graph).options);
  ok(
    '㉗',
    rlSol.ok && refSol.ok && Math.abs((rlSol.solution.nodeVoltages['n-vo'] ?? NaN) - (refSol.solution.nodeVoltages['n-vo'] ?? NaN)) <= 1e-6,
    `㉗② 删 Rl 的 Av=${rlSol.ok ? rlSol.solution.nodeVoltages['n-vo'] : rlSol.code} 与 Rl=1e12 的 ${refSol.ok ? refSol.solution.nodeVoltages['n-vo'] : refSol.code} 不一致`,
  );
  // 注：Rl=1e12 仍在 MNA 里留 1e-12 的电导，条件数把它放大到 ~1e-7 绝对差
  // —— 语义等价（开路），数值容差 1e-6 是对「大数惩罚污染」的诚实让步。
  console.log(`㉗② 删 Rl（负载型）→ 不合并、支路开路：Av=${rlSol.ok ? rlSol.solution.nodeVoltages['n-vo'] : rlSol.code} = Rl→1e12 对照图的 ${refSol.ok ? refSol.solution.nodeVoltages['n-vo'] : refSol.code}`);

  // ③ 并联器件（硬规则 1 侧）：删 Rc → 现状不变（Rc→∞ 挂交流地），无合并
  const stRc = labUiStep('A3', baseline, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('㉗', !stRc.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉗③ 删 Rc 不该产生合并导线');
  ok(
    '㉗',
    stRc.preview.appliedRules.some((rule) => rule.includes('Rc→∞')),
    `㉗③ Rc→∞ 既有规则被覆盖了：${stRc.preview.appliedRules.join('；')}`,
  );
  ok('㉗', stRc.preview.params.Rc === 1e12, `㉗③ params.Rc=${stRc.preview.params.Rc} ≠ 1e12`);
  console.log('㉗③ 删 Rc（并联 / 无可合并侧）→ 现状不变：Rc→∞ 挂交流地，params.Rc=1e12');

  // ④ 硬规则 3：两只源 —— 加 V2 跨在 vs:p 与 q:b 之间再删 Rs → 合并会短路 → 拒绝
  let st3 = createUiState('A3', graph);
  st3 = labUiStep('A3', st3, { type: 'op', op: { op: 'addDevice', kind: 'vsrc', label: 'V2', value: 5, x: 250, y: 400 } });
  // W22-A：新器件 id 走单调 seq —— 动态取 V2 的 id 再连线。
  const v2Id = st3.graph.nodes.find((node) => node.label === 'V2')?.id;
  st3 = labUiStep('A3', st3, { type: 'op', op: { op: 'addEdge', from: 'n-vs:p', to: `${v2Id}:p` } });
  st3 = labUiStep('A3', st3, { type: 'op', op: { op: 'addEdge', from: 'n-q:b', to: `${v2Id}:n` } });
  ok(
    '㉗',
    st3.graph.edges.some((edge) => edge.from === 'n-vs:p' && edge.to === `${v2Id}:p`) &&
      st3.graph.edges.some((edge) => edge.from === 'n-q:b' && edge.to === `${v2Id}:n`),
    '㉗④ V2 两根连线没连上（前置失败）',
  );
  st3 = labUiStep('A3', st3, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });
  ok('㉗', !st3.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉗④ 会短路源时还合并了（硬规则 3 失守）');
  ok(
    '㉗',
    st3.rules.some((rule) => rule.includes('短路') || rule.includes('成环')),
    `㉗④ 硬规则 3 没给人话：${st3.rules.at(-1)}`,
  );
  console.log(`㉗④ 两只源跨接后删 Rs → 硬规则 3 拒合并：「${st3.rules.at(-1).slice(0, 42)}…」`);

  // ⑤ 杆件：S5 删 AC → 节点不合并，判据 m = 2 < 2j−3 = 3
  const s5Spec = labSkeletonSpec('S5', JSON.parse(readFileSync(join(root, 'src', 'examples', 'S5.json'), 'utf8')).render_specs[0]);
  const st5 = labUiStep('S5', createUiState('S5', freshSkeleton('S5', s5Spec)), { type: 'op', op: { op: 'deleteMember', edgeId: 'e-AC' } });
  // R3-1 A1：支座折成结点属性后不再占节点位置 —— 判据改成「结点数不变」
  //（自由度载体不许被合并），物件总数（结点 + 支座 + 载荷）仍是 6。
  const st5Joints = st5.graph.nodes.filter((node) => node.kind === 'dot' || node.kind === 'pin').length;
  ok('㉗', st5Joints === 3, `㉗⑤ 删杆后结点数变了：${st5Joints} ≠ 3（结点是自由度载体，不合并）`);
  ok(
    '㉗',
    st5.graph.nodes.length + supportRefs(st5.graph).length === 6,
    `㉗⑤ 删杆后物件数变了：${st5.graph.nodes.length}+${supportRefs(st5.graph).length} ≠ 6（结点 / 支座 / 载荷都还在）`,
  );
  ok('㉗', st5.graph.edges.length === 2, `㉗⑤ 删杆后杆数 ${st5.graph.edges.length} ≠ 2`);
  ok(
    '㉗',
    st5.rules.some((rule) => rule.includes('2j−3 = 3') && rule.includes('少一根')),
    `㉗⑤ 判据没出：${st5.rules.at(-1)}`,
  );
  console.log(`㉗⑤ S5 删 AC → 节点不合并：「${st5.rules.at(-1).slice(0, 48)}…」`);

  // ⑥ 变异（in-gate）：protectGround=false → gnd 参与合并 → ② 红的内容翻转
  ok('㉗', HEAL_CONFIG.protectGround === true && HEAL_CONFIG.mergeSeries === true, '㉗ 变异前就该是绿的');
  HEAL_CONFIG.protectGround = false;
  const stRlBad = labUiStep('A3', baseline, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  ok('㉗', stRlBad.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉗⑥ 变异（允许 gnd 合并）后负载还是没合并（门禁空转）');
  HEAL_CONFIG.protectGround = true;
  const stRlGood = labUiStep('A3', baseline, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  ok('㉗', !stRlGood.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉗⑥ 变异还原后没回绿');
  console.log('㉗⑥ 变异：protectGround=false → 删 Rl 会把信号网并进地网（② 红）；还原回绿');
}

/* ── ㉘ W17-C：两组分离与选中互斥（S5 与 A3 各 2 条） ─────────────── */
{
  // ① S5：物件 6（A/B/C + 两个支座 + 一个载荷）与杆 3（AB/AC/BC）两组
  const s5Spec = labSkeletonSpec('S5', JSON.parse(readFileSync(join(root, 'src', 'examples', 'S5.json'), 'utf8')).render_specs[0]);
  const s5Graph = freshSkeleton('S5', s5Spec);
  const objects = beamObjectRows(s5Graph);
  const members = beamMemberRows(s5Graph);
  ok('㉘', objects.length === 6 && objects.filter((row) => row.kindLabel === '节点').length === 3, `㉘① S5 物件组 ${objects.length} 行（应 6：A/B/C + 两支座 + 一载荷）：${objects.map((r) => r.name).join(',')}`);
  ok('㉘', members.length === 3 && members.every((row) => ['AB', 'AC', 'BC'].includes(row.name)), `㉘① S5 杆组 ${members.length} 行（应 3：AB/AC/BC）：${members.map((r) => r.name).join(',')}`);
  console.log(`㉘① S5 两组：物件 ${objects.length} 行 / 杆 ${members.map((row) => row.name).join('/')} ${members.length} 行`);

  // ② S5：画布命中 —— AC 中点命中杆、C 点命中物件；选中互斥
  const a = s5Graph.nodes.find((node) => node.id === 'n-A');
  const c = s5Graph.nodes.find((node) => node.id === 'n-C');
  const hitMember = hitTest(s5Graph, (a.x + c.x) / 2, (a.y + c.y) / 2);
  const hitNode = hitTest(s5Graph, c.x, c.y);
  ok('㉘', hitMember.kind === 'member' && hitMember.id === 'e-AC', `㉘② AC 中点命中 ${hitMember.kind}:${hitMember.id}（应 member e-AC）`);
  ok('㉘', hitNode.kind === 'node' && hitNode.id === 'n-C', `㉘② C 点命中 ${hitNode.kind}:${hitNode.id}（应 node n-C）`);
  const sel1 = selectTarget(null, { kind: 'member', id: 'e-AC' });
  const sel2 = selectTarget(sel1, { kind: 'node', id: 'n-C' });
  const sel3 = selectTarget(sel2, { kind: 'node', id: 'n-C' });
  ok('㉘', sel1?.kind === 'member' && sel2?.kind === 'node' && sel3 === null, '㉘② 选中互斥失守（换选 / 再点取消）');
  console.log('㉘② 画布命中：AC 中点 → 杆 e-AC、C 点 → 物件 n-C；选中互斥（换选覆盖 / 再点取消）');

  // ③ A3：器件 / 导线两组行数；点导线 Delete 只删这条线（现状不回退）
  const { graph } = loadSkeleton('A3');
  const devices = circuitDeviceRows(graph);
  const wires = circuitWireRows(graph);
  ok('㉘', devices.length === 6, `㉘③ A3 器件组 ${devices.length} 行（应 6）`);
  ok('㉘', wires.length === 11, `㉘③ A3 导线组 ${wires.length} 行（应 11）`);
  const stWire = labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-rs-q' } });
  ok('㉘', !stWire.graph.edges.some((edge) => edge.id.startsWith('e-heal')), '㉘③ 删导线触发了合并（现状被回退）');
  ok('㉘', stWire.preview.problems.some((p) => p.startsWith('开路')), '㉘③ 删导线后开路提示没了（W16 语义被回退）');
  console.log('㉘③ A3 两组：器件 6 / 导线 11；删导线不合并、开路提示仍在（现状不回退）');

  // ④ 选中条文案与删除分派（核心契约同源）
  const selText = selectTarget(null, { kind: 'wire', id: 'e-cbus' });
  ok('㉘', selText?.kind === 'wire', '㉘④ 导线选中失守');
  const st4 = labUiStep('A3', createUiState('A3', graph), { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-cbus' } });
  ok('㉘', !st4.graph.edges.some((edge) => edge.id === 'e-cbus'), '㉘④ Delete 删导线没删掉');
  console.log('㉘④ 选中 → Delete 分派：e-cbus 删除（回缩 / 孤立 dot 清理沿 W16 语义，见 ㉕①）');

/* ── ㉙ R3-1 支座是结点属性：不可能悬空（W18-E 判据的翻译版） ────── */
{
  const exS5 = JSON.parse(readFileSync(join(root, 'src', 'examples', 'S5.json'), 'utf8'));
  const s5 = freshSkeleton('S5', exS5.render_specs[0]);
  // ① 折叠：S5 的快照里 n-sup-A/B 是独立图元 → 读入后变成 n-A / n-B 的 support 属性，
  //    图里不再有 kind=pinSupport 的节点（同一个「点」只有一个对象）。
  const jointA = s5.nodes.find((node) => node.id === 'n-A');
  ok('㉙', jointA?.support?.type === 'pin', `㉙① n-A 应挂固定铰，实际 ${JSON.stringify(jointA?.support)}`);
  ok('㉙', !s5.nodes.some((node) => node.kind === 'pinSupport' || node.kind === 'rollerSupport'), '㉙① 折叠后仍有独立支座图元');
  ok('㉙', s5.nodes.filter((node) => node.support).length === 2, `㉙① S5 应有 2 个支座属性，实际 ${s5.nodes.filter((n) => n.support).length}`);
  console.log('㉙① S5 两个支座折成 n-A / n-B 的属性：图里只剩一个「点」');

  // ② 拖结点 → 支座的渲染坐标就是结点坐标（跟随是结构性的，不靠同步）
  const stDrag = labUiStep('S5', createUiState('S5', s5), { type: 'moveNode', nodeId: 'n-A', x: jointA.x + 30, y: jointA.y });
  const dotA2 = stDrag.graph.nodes.find((node) => node.id === 'n-A');
  const glyphA = graphToSpec(stDrag.graph, 'freebody').nodes.find((node) => node.id === 'n-sup-A');
  ok('㉙', Boolean(glyphA), '㉙② 拖完 n-A 后渲染里找不到支座图元 n-sup-A');
  ok('㉙', glyphA.x === dotA2.x && glyphA.y === dotA2.y, `㉙② 支座没跟着走（渲染 (${glyphA.x},${glyphA.y}) ≠ 结点 (${dotA2.x},${dotA2.y})）`);
  ok('㉙', Math.abs(dotA2.x - (jointA.x + 30)) <= 1e-9, `㉙② 结点没到目标点（${dotA2.x}）`);
  console.log('㉙② 拖 n-A +30 → 支座图元同坐标（一处存坐标，不会再飘）');

  // ③ 旧形态孤儿支座（旧分享链接 / 手改数据）→ 仍拒 supportOffJoint，不静默吸附
  const gOff = { ...s5, nodes: [...s5.nodes, { id: 'n-sup-legacy', x: jointA.x + 20, y: jointA.y, kind: 'pinSupport', label: '固定铰', labelSide: 'down' }] };
  const routeOff = resolveLabSolve('S5', gOff);
  ok('㉙', routeOff.kind === 'refused' && routeOff.code === 'supportOffJoint', `㉙③ 孤儿支座应拒 supportOffJoint，实际 ${routeOff.kind}/${routeOff.code ?? '-'}`);
  ok('㉙', (routeOff.reason ?? '').includes('没有落在结点上'), `㉙③ 拒答话术没有「没有落在结点上」：${(routeOff.reason ?? '').slice(0, 60)}`);
  const stOff = labUiStep('S5', createUiState('S5', gOff), { type: 'solve' });
  ok('㉙', stOff.verdict?.tier === 'U', `㉙③ solve 档位应 U，实际 ${stOff.verdict?.tier}`);
  ok('㉙', stOff.preview.tier === 'U', `㉙③ preview 档位应 U，实际 ${stOff.preview.tier}`);
  console.log(`㉙③ 孤儿支座 → ${routeOff.code}：「${(routeOff.reason ?? '').slice(0, 30)}…」，不出数`);

  // ④ 正常骨架不受影响
  const routeOk = resolveLabSolve('S5', s5);
  ok('㉙', routeOk.kind === 'template', `㉙④ 正常 S5 应走模板，实际 ${routeOk.kind}`);
  console.log('㉙④ 折叠后的 S5 照常走模板五步（判据不误伤）');

  // ⑤ 变异哨兵：fold=false → ① 红（独立支座图元回来）；enforce=false → ③ 红。
  //    follow 只对旧形态图元支座有意义（属性形态的跟随是结构性的），保留断言只为
  //    确认开关没被删掉 —— 不再声称它能翻红某条。
  ok('㉙', ATTACH_CONFIG.fold === true, `㉙⑤ fold 应为 true（sed 变异位），实际 ${ATTACH_CONFIG.fold}`);
  ok('㉙', SUPPORT_FOLLOW_CONFIG.follow === true, `㉙⑤ 跟随开关应为 true（sed 变异位），实际 ${SUPPORT_FOLLOW_CONFIG.follow}`);
  ok('㉙', SUPPORT_PIN_CONFIG.enforce === true, `㉙⑤ 判据开关应为 true（sed 变异位），实际 ${SUPPORT_PIN_CONFIG.enforce}`);
  console.log(`㉙⑤ 变异位就绪：fold=${ATTACH_CONFIG.fold} follow=${SUPPORT_FOLLOW_CONFIG.follow} enforce=${SUPPORT_PIN_CONFIG.enforce}（fold→① 红 / enforce→③ 红）`);
}

/* ── ㉚ R1-F 力学族 ?p= 覆盖必须生效；不生效必须提示 ───────────── */
{
  // 页面同款管线：freshSkeleton(merged) → applyParams(merged)（applyToGraph 开时）
  const probe = (id, raw) => {
    const ex = JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
    const spec = labSkeletonSpec(id, ex.render_specs[0]);
    const ov = parseParamOverrides(raw, getTemplateRoute(id).entry.params ?? []);
    ok('㉚', ov.ignored.length === 0 && ov.keys.length > 0, `㉚ ${id} 覆盖解析失败：${JSON.stringify(ov)}`);
    const merged = mergeOverrides(defaultValues(id), ov.values);
    let graph = freshSkeleton(id, spec, merged);
    if (P_OVERRIDE_CONFIG.applyToGraph) graph = applyParams(id, graph, merged);
    return reduce(id, graph).params;
  };

  const p1 = probe('M3', 'L:6,a:1,P:55');
  ok('㉚', rel(p1.L, 6) < 1e-12 && rel(p1.a, 1) < 1e-12 && rel(p1.P, 55) < 1e-12, `㉚① M3 ?p= 静默失效：${JSON.stringify(p1)}`);
  ok('㉚', p1.q === 0, `㉚① q 被污染：${p1.q}`);
  console.log(`㉚① M3 ?p=L:6,a:1,P:55 → L=${p1.L} a=${p1.a} P=${p1.P}（载荷挪位/改值、跨度文字刷新）`);

  const p2 = probe('S5', 'L:3,H:1.5,P:22');
  ok('㉚', rel(p2.L, 3) < 1e-12 && rel(p2.H, 1.5) < 1e-12 && rel(p2.P, 22) < 1e-12, `㉚② S5 ?p= 静默失效：${JSON.stringify(p2)}`);
  console.log(`㉚② S5 ?p=L:3,H:1.5,P:22 → L=${p2.L} H=${p2.H} P=${p2.P}`);

  // ③ 没生效必须提示：页面有兜底对照 + 话术（不许静默）
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('㉚', labSource.includes('没生效'), '㉚③ ?p= 覆盖没生效时页面没有提示话术');
  ok('㉚', /P_OVERRIDE_CONFIG\.applyToGraph/.test(labSource) && /applyParams\(/.test(labSource), '㉚③ 页面没把覆盖值落到图元（applyParams 通道没接）');
  console.log('㉚③ 页面兜底：覆盖键逐一对照归约结果，对不上 toast「?p= 的 … 没生效」');

  // ④ 变异哨兵：sed 把 applyToGraph 翻成 false → ①② 必红（静默失效回归）
  ok('㉚', P_OVERRIDE_CONFIG.applyToGraph === true, `㉚④ applyToGraph 变异位应为 true，实际 ${P_OVERRIDE_CONFIG.applyToGraph}`);
  console.log(`㉚④ 变异位就绪：applyToGraph=${P_OVERRIDE_CONFIG.applyToGraph}（sed 翻转后 ①② 必红）`);
}
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(
  `PASS：${checks} 项（装配门禁：六个改一处用例 / W10-A UI 动作序列 / W10-B 点击连线与拖动 / 三候选 / ?p= 覆盖 / W11 九型往返与装配证据 / 13 张不适用卡 / W14 删后清理 / W16 设值·旋转·删线·拖动确认 / W17 删即合并·两组分离 / 六条变异）`,
);
