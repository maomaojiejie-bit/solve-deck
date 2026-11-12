/**
 * check:attach（R3-1）—— 「点在哪儿」有唯一答案。
 *
 *  ① 加支座只认选中（A2）：选中 B → 落在 B；没选中 → 拒绝并给人话，不猜「第一个 dot」；
 *     加完图里没有第二个「点」（支座是结点属性）。
 *  ② 一个结点只有一个锚点：anchorsOf / clickableAnchors 在 B 处都只有 n-B:center，
 *     画布命中 B 得到的是结点而不是支座。
 *  ③ 删结点连带删（H-06）：支座随结点消失；挂在该结点上的载荷一并删（不留孤儿）。
 *  ④ t 真的进归约（A3）：setLoadT 0.5 → a=2 / Mmax=20@2；0.25 → a=1 / Mmax=15@1；
 *     addLoad atMember 也落在跨上（删掉原载荷后加 t=0.75 → a=3）。
 *  ⑤ 方向进轴力分量（A3）：悬臂自由端加 → 的 10kN（先删原竖向载荷）→ N=-10、Q=0；
 *     同一点加 ↓ 的 10kN → N=0、Q=10。同大小换方向，内力分量跟着换。
 *  ⑥ 没选中时按钮 disabled（源码断言）+ ops 拒绝（不许静默落到第一个点）。
 *  ⑦ 变异哨兵：ATTACH_CONFIG.preferSelection 关掉 → ① 红（回到「猜第一个 dot」）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}

import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { buildSolverInput } from '../src/core/params/query.ts';
import { labSkeletonSpec, defaultValues, freshSkeleton } from '../src/core/lab/skeleton.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { reduce } from '../src/core/lab/reduce.ts';
import { graphToSpec } from '../src/core/lab/graphFromSpec.ts';
import { anchorsOf, clickableAnchors } from '../src/core/lab/pins.ts';
import { hitTest } from '../src/core/lab/inspect.ts';
import { frameSolve } from '../src/core/lab/frameSolve.ts';
import { ATTACH_CONFIG, addTargetOf, rotToDir, normalizeDir, supportRefs } from '../src/core/lab/attach.ts';
import { pinAt } from '../src/render/symbols.ts';

/** W20：语义角 → 「出图箭头朝哪」。载荷箭头 tip 在原点、tail 在局部 (0,-42)：
 *  rot 是 SVG 顺时针角，用渲染层的 pinAt 算出 tail 的世界坐标，
 *  tail 在左 (−x) 就是箭头朝右。断言只说语义与出图方向，不再锁死 rot=270。 */
const faces = (rot) => {
  const [tx, ty] = pinAt('arrow', [0, 0], rot, 'tail');
  return tx < -1 ? '→' : tx > 1 ? '←' : ty > 1 ? '↑' : '↓';
};

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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const specOf = (id) => labSkeletonSpec(id, JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8')).render_specs[0]);
const skeleton = (id) => freshSkeleton(id, specOf(id));

async function solveWith(id, params) {
  const route = getTemplateRoute(id);
  const solver = (await route.entry.solver()).default;
  return solver(buildSolverInput(route.entry, route.variant?.config, params)).result;
}

/* ── ① A2：加支座只认选中 ─────────────────────────────────────── */
{
  const s5 = skeleton('S5');
  const target = addTargetOf(s5, 'n-B');
  ok('①', target.nodeId === 'n-B', `① 选中 n-B 却要落到 ${target.nodeId}`);
  const noSelect = addTargetOf(s5, null);
  ok('①', noSelect.nodeId === null && noSelect.reason.includes('选中'), `① 没选中不该给目标：${JSON.stringify(noSelect)}`);
  const notJoint = addTargetOf(s5, 'n-load');
  ok('①', notJoint.nodeId === null, `① 选中载荷（不是结点）不该给目标，实际 ${notJoint.nodeId}`);

  const before = supportRefs(s5).length;
  // S5 里 A、B 本来就各有一个支座；C 是自由的 —— 就在 C 上加（这正是 H-01 的场景）
  const out = applyOp('S5', s5, { op: 'addSupport', atNodeId: 'n-C', type: 'pin' });
  ok('①', !out.refused, `① 在 n-C 加固定铰被拒：${out.refused}`);
  const jointC = out.graph.nodes.find((node) => node.id === 'n-C');
  ok('①', jointC?.support?.type === 'pin', `① n-C 上没有固定铰属性：${JSON.stringify(jointC?.support)}`);
  ok('①', supportRefs(out.graph).length === before + 1, `① 支座数没 +1：${supportRefs(out.graph).length} vs ${before}`);
  ok('①', !out.graph.nodes.some((node) => node.kind === 'pinSupport' && node.id !== 'n-sup-A'), '① 又造了一个独立支座图元（H-01 的老病）');
  const glyph = graphToSpec(out.graph, 'freebody').nodes.filter((node) => node.kind === 'pinSupport' && node.id !== 'n-sup-A');
  ok('①', glyph.length === 1 && glyph[0].x === jointC.x && glyph[0].y === jointC.y, `① 渲染的支座没落在 n-C：${JSON.stringify(glyph)}`);

  // 一个结点只能有一个支座：再要一个就如实拒
  const twice = applyOp('S5', out.graph, { op: 'addSupport', atNodeId: 'n-C', type: 'roller' });
  ok('①', Boolean(twice.refused) && twice.refused.includes('只能有一个支座'), `① 同一结点加第二个支座应拒：${twice.refused ?? '没拒'}`);
  console.log(`① 选中 n-C → 支座落在 n-C（结点属性，图里没有第二个点）；重复加被拒：「${(twice.refused ?? '').slice(0, 24)}…」`);
}

/* ── ② 一个结点只有一个锚点 ───────────────────────────────────── */
{
  const s5 = skeleton('S5');
  const b = s5.nodes.find((node) => node.id === 'n-B');
  const atB = anchorsOf(s5).filter((anchor) => Math.hypot(anchor.x - b.x, anchor.y - b.y) <= 0.6);
  ok('②', atB.length === 1 && atB[0].key === 'n-B:center', `② B 处锚点 ${atB.length} 个（${atB.map((a) => a.key).join(',')}），应只有 n-B:center`);
  const clickAtB = clickableAnchors(s5).filter((anchor) => Math.hypot(anchor.x - b.x, anchor.y - b.y) <= 0.6);
  ok('②', clickAtB.length === 1 && clickAtB[0].key === 'n-B:center', `② B 处可点锚点 ${clickAtB.length} 个`);
  const hit = hitTest(s5, b.x, b.y);
  ok('②', hit.kind === 'node' && hit.id === 'n-B', `② 点 B 命中 ${hit.kind}:${hit.id}（应是 node n-B）`);
  // 加了支座之后 B 处仍然只有一个锚点、仍然能连杆（H-01 的症状是「点不到结点、连不了杆」）
  const withSupport = applyOp('S5', s5, { op: 'addSupport', atNodeId: 'n-B', type: 'roller' });
  ok('②', Boolean(withSupport.refused), '② B 上已有可动铰，再加应被拒（前置）');
  const withSupport2 = applyOp('S5', s5, { op: 'addSupport', atNodeId: 'n-C', type: 'pin' }).graph;
  const afterB = anchorsOf(withSupport2).filter((anchor) => Math.hypot(anchor.x - b.x, anchor.y - b.y) <= 0.6);
  ok('②', afterB.length === 1, `② 加支座后 B 处锚点 ${afterB.length} 个（应 1）`);
  const hit2 = hitTest(withSupport2, b.x, b.y);
  ok('②', hit2.kind === 'node' && hit2.id === 'n-B', `② 加支座后点 B 命中 ${hit2.kind}:${hit2.id}`);
  const cut = applyOp('S5', withSupport2, { op: 'deleteMember', edgeId: 'e-AC' });
  const remade = applyOp('S5', cut.graph, { op: 'addMember', from: 'n-A', to: 'n-C', kind: 'truss' });
  ok('②', !remade.refused, `② 加支座后 A–C 重连被拒：${remade.refused}`);
  console.log('② B 处锚点恒为 1 个（n-B:center），加支座后点 B 仍是结点、A–C 仍能重连');
}

/* ── ③ 删结点连带删 ───────────────────────────────────────────── */
{
  const s5 = skeleton('S5');
  const added = applyOp('S5', s5, { op: 'addLoad', atNodeId: 'n-C', type: 'point', value: 5 });
  ok('③', !added.refused, `③ 在 n-C 加载荷被拒：${added.refused}`);
  const loadNode = added.graph.nodes.find((node) => node.atJoint === 'n-C');
  ok('③', Boolean(loadNode), '③ 加载荷后没有 atJoint=n-C 的载荷节点');
  const del = applyOp('S5', added.graph, { op: 'deleteDevice', nodeId: 'n-C' });
  ok('③', !del.refused, `③ 删 n-C 被拒：${del.refused}`);
  ok('③', !del.graph.nodes.some((node) => node.id === 'n-C'), '③ n-C 没删掉');
  ok('③', !del.graph.nodes.some((node) => node.atJoint === 'n-C'), '③ 挂在该结点上的载荷留成了孤儿');
  ok('③', !del.graph.nodes.some((node) => node.id === loadNode.id), '③ 载荷节点还在图里');
  ok('③', del.rules.some((rule) => rule.includes('载荷')), `③ 规则没交代连带删了什么：${del.rules.at(-1)}`);
  // 支座随结点消失：M3 的 n-end-b 上挂着可动铰
  const m3 = skeleton('M3');
  const endB = m3.nodes.find((node) => node.id === 'n-end-b');
  ok('③', endB?.support?.type === 'roller', `③ M3 的 n-end-b 应挂可动铰，实际 ${JSON.stringify(endB?.support)}`);
  const delM3 = applyOp('M3', m3, { op: 'deleteDevice', nodeId: 'n-end-b' });
  ok('③', !supportRefs(delM3.graph).some((ref) => ref.type === 'roller'), '③ 删结点后可动铰还在（支座没随结点消失）');
  ok('③', delM3.rules.some((rule) => rule.includes('支座')), `③ 规则没提支座：${delM3.rules.at(-1)}`);
  console.log(`③ 删 n-C → 载荷一并删（${del.rules.at(-1).slice(0, 30)}…）；删 n-end-b → 可动铰随结点消失`);
}

/* ── ④ t 真的进归约（a = t·L）────────────────────────────────── */
{
  const m3 = skeleton('M3');
  const L = 4;
  const at05 = applyOp('M3', m3, { op: 'setLoadT', nodeId: 'n-load-0', t: 0.5 });
  ok('④', !at05.refused, `④ 挪到 t=0.5 被拒：${at05.refused}`);
  const p05 = reduce('M3', at05.graph).params;
  ok('④', near(p05.a, 2), `④ t=0.5 归约 a=${p05.a}（应 2 = 0.5·L）`);
  const r05 = await solveWith('M3', p05);
  ok('④', near(r05.Mmax, 20, 1e-9) && near(r05.MmaxX, 2, 1e-9), `④ t=0.5 → Mmax=${r05.Mmax}@${r05.MmaxX}（应 20@2）`);

  const at025 = applyOp('M3', m3, { op: 'setLoadT', nodeId: 'n-load-0', t: 0.25 });
  const p025 = reduce('M3', at025.graph).params;
  ok('④', near(p025.a, 1), `④ t=0.25 归约 a=${p025.a}（应 1 = 0.25·L）`);
  const r025 = await solveWith('M3', p025);
  ok('④', near(r025.Mmax, 15, 1e-9) && near(r025.MmaxX, 1, 1e-9), `④ t=0.25 → Mmax=${r025.Mmax}@${r025.MmaxX}（手算 P·a·(L−a)/L = 15@1）`);
  ok('④', at025.rules.some((rule) => rule.includes('t=0.25')), `④ 规则没写清 t：${at025.rules.at(-1)}`);
  const label = at025.graph.nodes.find((node) => node.id === 'n-load-0')?.label ?? '';
  ok('④', label.includes('t=0.25'), `④ 画布标签没显示 t：${label}`);

  // addLoad 的跨内通道：删掉原载荷，自己加一个落在 t=0.75
  const m5 = skeleton('M5');
  const cleared = applyOp('M5', m5, { op: 'deleteDevice', nodeId: 'n-load-0' });
  ok('④', !cleared.refused, `④ 删 M5 原载荷被拒：${cleared.refused}`);
  const span = cleared.graph.edges.find((edge) => edge.kind === 'beam');
  const added = applyOp('M5', cleared.graph, { op: 'addLoad', atMember: { edgeId: span.id, t: 0.75 }, type: 'point', value: 12 });
  ok('④', !added.refused, `④ 跨内加载荷被拒：${added.refused}`);
  const pM5 = reduce('M5', added.graph).params;
  ok('④', near(pM5.a, 0.75 * Number(pM5.L)), `④ 跨内 t=0.75 归约 a=${pM5.a}（应 0.75·L=${0.75 * Number(pM5.L)}）`);
  ok('④', near(pM5.P, 12), `④ 跨内载荷的 P=${pM5.P}（应 12）`);
  console.log(`④ t=0.5→a=2/Mmax=20@2；t=0.25→a=1/Mmax=15@1；跨内加载荷 t=0.75→a=${pM5.a}（L=${pM5.L}）`);
}

/* ── ⑤ 方向进内力分量 ─────────────────────────────────────────── */
{
  // 悬臂：固定端在 n-end-a，自由端 n-end-b。先删原竖向载荷，只留一个自己加的。
  const cant = skeleton('M3-cantilever');
  const cleared = applyOp('M3-cantilever', cant, { op: 'deleteDevice', nodeId: 'n-load-0' });
  ok('⑤', !cleared.refused, `⑤ 删悬臂原载荷被拒：${cleared.refused}`);
  const axial = applyOp('M3-cantilever', cleared.graph, { op: 'addLoad', atNodeId: 'n-end-b', type: 'point', value: 10, dir: 90 });
  ok('⑤', !axial.refused, `⑤ 加 → 载荷被拒：${axial.refused}`);
  const loadNode = axial.graph.nodes.find((node) => node.atJoint === 'n-end-b');
  // W20：GraphOp 传语义角 90(→)，断言「出图箭头朝右」，不再锁死图元 rot=270。
  ok('⑤', rotToDir(loadNode?.rot) === 90, `⑤ → 载荷读回语义角应为 90，实际 ${rotToDir(loadNode?.rot)}`);
  ok('⑤', faces(loadNode?.rot) === '→', `⑤ 语义角 90 的出图箭头应朝右，实际 ${faces(loadNode?.rot)}`);
  const solAxial = frameSolve(axial.graph);
  const endAxial = solAxial.memberEndForces[0];
  // 固定端在左、自由端受 +x 力 → 杆被拉长（拉为正），N = +10；换 ↓ 则轴力为 0。
  ok('⑤', near(endAxial.N[1], 10, 1e-9), `⑤ → 载荷的轴力 N(${endAxial.N[1]})（应 +10，拉）`);
  ok('⑤', Math.abs(endAxial.Q[0]) < 1e-9, `⑤ → 载荷不该出剪力：Q=${endAxial.Q[0]}`);

  const vertical = applyOp('M3-cantilever', cleared.graph, { op: 'addLoad', atNodeId: 'n-end-b', type: 'point', value: 10, dir: 0 });
  const solV = frameSolve(vertical.graph);
  const endV = solV.memberEndForces[0];
  ok('⑤', Math.abs(endV.N[0]) < 1e-9, `⑤ ↓ 载荷不该出轴力：N=${endV.N[0]}`);
  ok('⑤', near(Math.abs(endV.Q[1]), 10, 1e-9), `⑤ ↓ 载荷剪力 Q=${endV.Q[1]}（应 ±10）`);
  // 方向是枚举，不是自由角：450° 也要收成语义 90°（→）
  const normalized = applyOp('M3-cantilever', cleared.graph, { op: 'addLoad', atNodeId: 'n-end-b', type: 'point', value: 10, dir: 450 });
  const node450 = normalized.graph.nodes.find((node) => node.atJoint === 'n-end-b');
  ok('⑤', rotToDir(node450?.rot) === 90, `⑤ dir=450 应归一到语义 90°，实际 ${rotToDir(node450?.rot)}`);
  ok('⑤', faces(node450?.rot) === '→', `⑤ dir=450 的出图箭头应朝右，实际 ${faces(node450?.rot)}`);
  ok('⑤', normalizeDir(450) === 90, `⑤ normalizeDir(450) 应为 90，实际 ${normalizeDir(450)}`);
  console.log(`⑤ 同一位置换方向：→ 给 N=${endAxial.N[1]} / Q=0；↓ 给 N=0 / Q=${endV.Q[1]}（内力分量真的跟方向走）`);}

/* ── ⑥ 没选中：按钮 disabled + ops 拒绝 ────────────────────────── */
{
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('⑥', labSource.includes('disabled={!addTarget.nodeId}'), '⑥ 加支座按钮没有按「有没有选中」disabled');
  ok('⑥', /data-testid=\{`add-support-/.test(labSource) && /data-testid=\{`add-load-/.test(labSource), '⑥ 加支座 / 加载荷按钮缺 testid');
  ok('⑥', labSource.includes('data-testid="load-t"') && labSource.includes('selection-dir-'), '⑥ 选中条缺 t 输入 / 方向按钮');
  const s5 = skeleton('S5');
  const bad = applyOp('S5', s5, { op: 'addSupport', atNodeId: 'n-load', type: 'pin' });
  ok('⑥', Boolean(bad.refused) && bad.refused.includes('结点'), `⑥ 落在载荷上应拒并说清：${bad.refused ?? '没拒'}`);
  ok('⑥', bad.graph === s5, '⑥ 被拒的操作不许改图');
  console.log(`⑥ 未选中 disabled（tooltip=「${addTargetOf(s5, null).reason.slice(0, 20)}…」）；ops 对非结点目标如实拒`);
}

/* ── ⑦ 变异哨兵 ───────────────────────────────────────────────── */
ok('⑦', ATTACH_CONFIG.preferSelection === true, `⑦ preferSelection 应为 true（sed 变异位），实际 ${ATTACH_CONFIG.preferSelection}`);
ok('⑦', ATTACH_CONFIG.fold === true, `⑦ fold 应为 true，实际 ${ATTACH_CONFIG.fold}`);
ok('⑦', ATTACH_CONFIG.cascade === true, `⑦ cascade 应为 true，实际 ${ATTACH_CONFIG.cascade}`);

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（挂接与位置：只认选中 / 一结点一锚点 / 删结点连带删 / t 进归约 / 方向进轴力 / 未选中 disabled / 变异哨兵）`);
