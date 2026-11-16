/**
 * check:measures（W19）—— 「装配图必须答得出这张图问的量」。
 *
 * 八条（前六条是断言的牙齿，后两条是变异，跑完还原）：
 *  ① **与入口无关**：同一张图把 templateId 改掉 → `interpretQuestion` 的 measures 逐位相同
 *    （防「按题型决定问什么」——那正是这套东西要根治的病）。
 *  ② **M5 加一个力**：仍给出 δmax（2.568 mm，与叠加解一致 <0.2%），反力 12/18、|M|max=24
 *     —— 顺带钉住「载荷不再被吸附到支座」（旧行为是 10/20、20）。
 *  ③ **M7 加一个力**：给出 Pcr（532.96 kN = π²EI/L²）与 λ；原样 M7 骨架（无横向载荷）
 *     不出空内力图，只出稳定。
 *  ④ **A3 / A5 的 gain**：A3 骨架的 gain 与模板 Av 逐位一致（1e-6）；
 *     A3 并联 100Ω（归约表不认识的元件）→ 走 generic(unmodeled)，gain 变成 −252.5；
 *     A5 的 measures 与 A3 不同（这条直接锁住「两张图不能给同一份答案」）。
 *  ⑤ **拓扑非法仍拒答**：A3 删 gnd → refused，不出 measures。
 *  ⑥ **载荷位置**：M3 两个力（20@2m + 5@0.8m）→ 反力 14/11、|M|max=22（解析值）。
 *  ⑦ 变异 A：`MEASURE_CONFIG.readTemplateId=true` → ① 必红。
 *  ⑧ 变异 B：`FRAME_SOLVE_CONFIG.loadSnapPx=1e6 + fraction=0.35`（一切载荷都吸到结点＝旧行为）→ ②⑥ 必红。
 *
 * W20 追加四条（⑨–⑫，`check:section` 也会再验一遍 UI 层）：
 *  ⑨ 给截面后 M3 出 stress，σmax 与 W=bh²/6 手算一致（100×200、M=20kN·m → 30 MPa）；
 *  ⑩ 给截面后出 deflection，δmax = PL³/(48EI) = 2.000 mm；
 *  ⑪ **清空截面**后 stress / deflection 都退回 missing，不留上次的数；
 *  ⑫ A7 的拒答文案点名 sum 与位置 id，且不含裸的 unsupported 字样。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}

import { freshSkeleton, labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { resolveLabSolve, netSolveOptionsFor, unmodeledDevices } from '../src/core/lab/resolve.ts';
import { interpretQuestion, MEASURE_CONFIG, beamCapabilities, filterWarningsByCapability } from '../src/core/lab/measures.ts';
import { frameSolve, FRAME_SOLVE_CONFIG } from '../src/core/lab/frameSolve.ts';
import { netSolve } from '../src/core/lab/netSolve.ts';
import { unknownDeviceNote } from '../src/core/lab/deviceNames.ts';
import { getTemplateRoute } from '../src/core/templates/registry.ts';

let checks = 0;
const problems = [];
const ok = (rule, pass, detail) => {
  checks += 1;
  if (!pass) problems.push(`${rule} / ${detail}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const specOf = (id) =>
  labSkeletonSpec(id, JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8')).render_specs[0]);
const skeleton = (id) => freshSkeleton(id, specOf(id));
const memberOf = (graph) => graph.edges.find((edge) => ['beam', 'shaft'].includes(edge.kind));
const withExtraLoad = (id, t, value) => {
  const graph = skeleton(id);
  return applyOp(id, graph, { op: 'addLoad', atMember: { edgeId: memberOf(graph).id, t }, type: 'point', value, dir: 0 }).graph;
};
const solveCircuit = (graph) => {
  const outcome = netSolve(graph, netSolveOptionsFor(graph).options);
  return outcome.ok ? outcome.solution : null;
};
const measureOf = (measures, id) => measures.find((measure) => measure.id === id);
/** 从 headline 里抠出第一个数（断言用，别在门禁里再算一遍物理）。 */
const numberOf = (text) => {
  const match = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(String(text ?? ''));
  return match ? Number(match[0]) : Number.NaN;
};

/* ── ① 与入口无关 ─────────────────────────────────────────────── */

const m5Graph = withExtraLoad('M5', 0.8, 10);
const m5Frame = frameSolve(m5Graph);
const measuresM5 = interpretQuestion(m5Graph, 'beam', { frame: m5Frame });
const renamed = { ...m5Graph, templateId: 'ZZZ-unknown' };
const measuresRenamed = interpretQuestion(renamed, 'beam', { frame: m5Frame });
ok('①', JSON.stringify(measuresM5) === JSON.stringify(measuresRenamed), '同一张图改 templateId 后 measures 变了（按题型决定问什么）');
ok('①', measuresM5.length >= 3, `M5 加力只产出 ${measuresM5.length} 项 measures`);
console.log(`①  M5 加一个力 → measures: ${measuresM5.map((m) => m.id).join(' / ')}（换 templateId 逐位相同）`);

/* ── ② M5：δmax 必须还在，且数值对 ─────────────────────────────── */

const deflection = measureOf(measuresM5, 'deflection');
ok('②', Boolean(deflection), '② M5 加一个力后没有 deflection（δmax 又丢了）');
if (deflection) {
  const delta = Math.abs(numberOf(deflection.headline));
  ok('②', near(delta, 2.568, 2.568 * 0.002), `② δmax=${delta}，叠加解应为 2.568 mm`);
  console.log(`②  ${deflection.headline}`);
}
const m5Route = resolveLabSolve('M5', m5Graph);
ok('②', m5Route.kind === 'generic', `② M5 加力应走 generic，实际 ${m5Route.kind}`);
if (m5Route.kind === 'generic') {
  const reactions = m5Route.frame.reactions.map((reaction) => reaction.fy);
  ok('②', reactions.every((value, index) => near(value, [12, 18][index] ?? value, 1e-6)), `② 反力 ${reactions.join('/')}，应为 12/18（载荷没被吸到支座）`);
  ok('②', near(m5Route.frame.extremes.Mmax, 24, 1e-6), `② |M|max=${m5Route.frame.extremes.Mmax}，应为 24（10kN 在 t=0.8 处）`);
  console.log(`②  反力 ${reactions.join(' / ')} kN · |M|max = ${m5Route.frame.extremes.Mmax} kN·m（旧行为 10/20、20）`);
  ok('②', !measureOf(m5Route.measures, 'stability'), '② M5 不该产 stability（图上没有 μ）');
}

/* ── ③ M7：Pcr 必须出现；原样骨架不出空内力图 ──────────────────── */

const m7Graph = withExtraLoad('M7', 0.75, 50);
const m7Route = resolveLabSolve('M7', m7Graph);
ok('③', m7Route.kind === 'generic', `③ M7 加力应走 generic，实际 ${m7Route.kind}`);
if (m7Route.kind === 'generic') {
  const stability = measureOf(m7Route.measures, 'stability');
  ok('③', Boolean(stability), '③ M7 加力后没有 stability（Pcr 丢了）');
  if (stability) {
    const pcr = numberOf(stability.headline);
    const inertia = (60 * 60 ** 3) / 12; // mm⁴
    const expect = (Math.PI ** 2 * 200e9 * inertia * 1e-12) / 4 / 1000; // kN
    ok('③', near(pcr, expect, expect * 0.005), `③ Pcr=${pcr}，π²EI/L² = ${expect.toFixed(3)} kN`);
    console.log(`③  ${stability.headline}（π²EI/L² = ${expect.toFixed(3)} kN）`);
  }
}
const m7Base = skeleton('M7');
const m7BaseMeasures = interpretQuestion(m7Base, 'beam', { frame: frameSolve(m7Base) });
ok('③', Boolean(measureOf(m7BaseMeasures, 'stability')), '③ 原样 M7 骨架没有 stability');
ok('③', !measureOf(m7BaseMeasures, 'internal'), '③ 原样 M7（纯压杆）不该出内力图');

/* ── ④ A3 / A5：gain 与模板对账；未建模元件走 generic ───────────── */

const a3Base = skeleton('A3');
const a3Circuit = solveCircuit(a3Base);
ok('④', Boolean(a3Circuit), '④ A3 骨架 netSolve 解不开');
const a3Measures = interpretQuestion(a3Base, 'circuit', { circuit: a3Circuit });
const a3Gain = measureOf(a3Measures, 'gain');
ok('④', Boolean(a3Gain), '④ A3 骨架没有 gain');
const routeA3 = getTemplateRoute('A3');
const templateSolution = routeA3.entry.solver ? (await routeA3.entry.solver()).default({ config: 'CE', beta: 100, Ic: 0.001, Rc: 2000, Rl: 10000, Rs: 1000, Re: 1000, Vt: 0.026, VA: 100 }) : null;
if (a3Gain && templateSolution) {
  const gain = Number(a3Gain.rows.find((row) => row.label === 'Av')?.value ?? NaN);
  ok('④', near(gain, templateSolution.result.Av, Math.abs(templateSolution.result.Av) * 1e-6), `④ A3 gain=${gain}，模板 Av=${templateSolution.result.Av}`);
  console.log(`④  A3 gain=${gain} · 模板 Av=${templateSolution.result.Av}（1e-6 内一致）`);
}

// A3 + 并联 100Ω：归约表不认识的元件 → generic(unmodeled)
const rc = a3Base.nodes.find((node) => node.kind === 'res' && /RC/i.test(node.id));
let a3Parallel = applyOp('A3', a3Base, { op: 'addDevice', kind: 'res', label: 'Rx', value: 100, x: 700, y: 560 }).graph;
// W22-A：新器件 id 走单调 seq（不再含 label）—— 按 label 找。
const rx = a3Parallel.nodes.find((node) => node.label === 'Rx');
a3Parallel = applyOp('A3', a3Parallel, { op: 'addEdge', from: `${rx.id}:a`, to: `${rc.id}:a` }).graph;
a3Parallel = applyOp('A3', a3Parallel, { op: 'addEdge', from: `${rx.id}:b`, to: `${rc.id}:b` }).graph;
ok('④', unmodeledDevices(a3Parallel, 'A3').length === 1, `④ 并联电阻没被判成未建模：${JSON.stringify(unmodeledDevices(a3Parallel, 'A3'))}`);
ok('④', unmodeledDevices(a3Base, 'A3').length === 0, '④ 骨架被误判成有未建模元件（模板路径会被整片打掉）');
const parallelRoute = resolveLabSolve('A3', a3Parallel);
ok('④', parallelRoute.kind === 'generic' && parallelRoute.reason === 'unmodeled', `④ 并联电阻应走 generic(unmodeled)，实际 ${parallelRoute.kind}/${parallelRoute.reason ?? ''}`);
if (parallelRoute.kind === 'generic') {
  const parallelGain = measureOf(parallelRoute.measures, 'gain');
  const gain = numberOf(parallelGain?.headline?.split('=').pop());
  ok('④', Number.isFinite(gain) && Math.abs(gain - -252.5253) < 0.51, `④ 并联后 gain=${gain}，按图应为 −252.53（黑盒 #23 起标题只留 3 位有效数字，容差 0.51）`);
  console.log(`④  A3 并联 100Ω → generic(${parallelRoute.reason})，gain=${gain}（模板 Av 仍是 −45.54：图变了答案就得变）`);
}

const a5 = skeleton('A5');
const a5Measures = interpretQuestion(a5, 'circuit', { circuit: solveCircuit(a5) });
const a5Gain = numberOf(measureOf(a5Measures, 'gain')?.headline?.split('=').pop());
const a3GainValue = Number(a3Gain?.rows.find((row) => row.label === 'Av')?.value ?? NaN);
ok('④', Number.isFinite(a5Gain) && Math.abs(a5Gain - a3GainValue) > 1e-6, `④ A5 的 gain 与 A3 相同（${a5Gain}）——两张图不能给同一份答案`);
console.log(`④  A5 gain=${a5Gain} ≠ A3 gain=${a3GainValue}`);

/* ── ⑤ 拓扑非法仍拒答 ─────────────────────────────────────────── */

const noGnd = applyOp('A3', a3Base, { op: 'deleteDevice', nodeId: a3Base.nodes.find((node) => node.kind === 'gnd').id }).graph;
const noGndRoute = resolveLabSolve('A3', noGnd);
ok('⑤', noGndRoute.kind === 'refused', `⑤ 删 gnd 应拒答，实际 ${noGndRoute.kind}`);
console.log(`⑤  删 gnd → ${noGndRoute.kind}（${noGndRoute.code ?? ''}）`);

/* ── ⑥ 载荷位置（M3 两个力，解析值） ───────────────────────────── */

const m3Graph = skeleton('M3');
const m3Two = applyOp('M3', m3Graph, { op: 'addLoad', atMember: { edgeId: memberOf(m3Graph).id, t: 0.2 }, type: 'point', value: 5, dir: 0 }).graph;
const m3Route = resolveLabSolve('M3', m3Two);
ok('⑥', m3Route.kind === 'generic', `⑥ M3 两个力应走 generic，实际 ${m3Route.kind}`);
if (m3Route.kind === 'generic') {
  const reactions = m3Route.frame.reactions.map((reaction) => reaction.fy);
  ok('⑥', reactions.every((value, index) => near(value, [14, 11][index] ?? value, 1e-6)), `⑥ 反力 ${reactions.join('/')}，应为 14/11`);
  ok('⑥', near(m3Route.frame.extremes.Mmax, 22, 1e-6), `⑥ |M|max=${m3Route.frame.extremes.Mmax}，应为 22`);
  console.log(`⑥  M3 20@2m + 5@0.8m → 反力 ${reactions.join(' / ')} kN · |M|max = ${m3Route.frame.extremes.Mmax} kN·m（解析 14/11、22）`);
}

/* ⑥b 方案 §5 第 6 条的字面用例：单载荷挪到 t=0.7。
 * 注意这图归约仍成功（M3 模板认 loadT），会走 template，故直接验引擎本身 ——
 * 旧吸附容差下这例是「反力 0/20、|M|max=0」，是最硬的一条给错数证据。 */
const m3Load = m3Graph.nodes.find((node) => node.kind === 'arrow');
const m3Moved = applyOp('M3', m3Graph, { op: 'setLoadT', nodeId: m3Load.id, t: 0.7 }).graph;
const m3MovedFrame = frameSolve(m3Moved);
const movedReactions = m3MovedFrame.reactions.map((reaction) => reaction.fy);
ok('⑥', movedReactions.every((value, index) => near(value, [6, 14][index] ?? value, 1e-6)), `⑥b 单载荷 t=0.7 反力 ${movedReactions.join('/')}，应为 6/14`);
ok('⑥', near(m3MovedFrame.extremes.Mmax, 16.8, 1e-6), `⑥b 单载荷 t=0.7 |M|max=${m3MovedFrame.extremes.Mmax}，应为 16.8`);
console.log(`⑥  M3 单个 20kN 挪到 t=0.7 → 反力 ${movedReactions.join(' / ')} kN · |M|max = ${m3MovedFrame.extremes.Mmax} kN·m（解析 6/14、16.8；旧吸附是 0/20、0）`);

/* ── ⑦ 变异 A：按题型决定问什么 → ① 红 ───────────────────────── */

const before7 = problems.length;
MEASURE_CONFIG.readTemplateId = true;
const mutated = interpretQuestion(m5Graph, 'beam', { frame: m5Frame });
const mutatedRenamed = interpretQuestion(renamed, 'beam', { frame: m5Frame });
MEASURE_CONFIG.readTemplateId = false;
ok('⑦', JSON.stringify(mutated) !== JSON.stringify(mutatedRenamed), '⑦ 变异（readTemplateId=true）没让 ① 变红');
ok('⑦', problems.length === before7, '⑦ 变异把别的断言也弄红了（变异不够定点）');
console.log(`⑦  变异 readTemplateId=true → M5 只留 ${mutated.map((m) => m.id).join('/')}，换 id 后 ${mutatedRenamed.map((m) => m.id).join('/')}（① 会红）`);

/* ── ⑧ 变异 B：旧的载荷吸附 → ②⑥ 红 ──────────────────────────── */

FRAME_SOLVE_CONFIG.loadSnapPx = 1e6;
FRAME_SOLVE_CONFIG.loadSnapFraction = 0.35;
const oldM5 = resolveLabSolve('M5', m5Graph);
const oldM3 = resolveLabSolve('M3', m3Two);
FRAME_SOLVE_CONFIG.loadSnapPx = 12;
FRAME_SOLVE_CONFIG.loadSnapFraction = 0.05;
const oldM5Reactions = oldM5.kind === 'generic' ? oldM5.frame.reactions.map((reaction) => reaction.fy) : [];
const oldM3Reactions = oldM3.kind === 'generic' ? oldM3.frame.reactions.map((reaction) => reaction.fy) : [];
ok('⑧', !oldM5Reactions.every((value, index) => near(value, [12, 18][index] ?? value, 1e-6)), `⑧ 变异后 M5 反力仍是 ${oldM5Reactions.join('/')}（吸附没生效？）`);
ok('⑧', !oldM3Reactions.every((value, index) => near(value, [14, 11][index] ?? value, 1e-6)), `⑧ 变异后 M3 反力仍是 ${oldM3Reactions.join('/')}`);
console.log(`⑧  变异 loadSnapPx=1e6 → M5 反力 ${oldM5Reactions.join('/')}、M3 反力 ${oldM3Reactions.join('/')}（②⑥ 会红）`);

/* ── ⑨–⑪ W20 截面：给 → 出数；清空 → 退回 missing ─────────────── */

const sectionGraph = (section) => applyOp('M3', skeleton('M3'), { op: 'setSection', section }).graph;
const filled = sectionGraph({ b: 100, h: 200, E: 200 });
const filledMeasures = interpretQuestion(filled, 'beam', { frame: frameSolve(filled) });
const filledStress = measureOf(filledMeasures, 'stress');
const filledDeflection = measureOf(filledMeasures, 'deflection');
// W = bh²/6 = 100·200²/6 mm³；M=20 kN·m = 20e6 N·mm → σ = 30 MPa
const W = (100 * 200 ** 2) / 6;
const sigmaByHand = (20 * 1e6) / W;
ok('⑨', Boolean(filledStress) && !filledStress.missing && near(numberOf(filledStress?.headline), sigmaByHand, 1e-6) && near(numberOf(filledStress?.headline), 30, 1e-6),
  `⑨ 给截面后 stress 应为 ${sigmaByHand} MPa，实际「${filledStress?.headline ?? filledStress?.missing}」`);
console.log(`⑨  给截面后 σmax = ${numberOf(filledStress?.headline)} MPa（手算 M/W = 20e6 / ${W.toFixed(2)} = ${sigmaByHand}）`);

// δ = PL³/(48EI)：P=20kN, L=4m, E=200GPa=200e6 kN/m², I=bh³/12=6.6667e7 mm⁴=6.6667e-5 m⁴
const I = (100 * 200 ** 3) / 12 * 1e-12;
const deltaByHand = (20 * 4 ** 3) / (48 * 200e6 * I) * 1000;
ok('⑩', Boolean(filledDeflection) && !filledDeflection.missing && near(numberOf(filledDeflection?.headline), deltaByHand, 1e-6) && near(numberOf(filledDeflection?.headline), 2, 1e-6),
  `⑩ 给截面后 deflection 应为 ${deltaByHand} mm，实际「${filledDeflection?.headline ?? filledDeflection?.missing}」`);
console.log(`⑩  给截面后 δmax = ${numberOf(filledDeflection?.headline)} mm（手算 PL³/48EI = ${deltaByHand}）`);

// 必须是「先给、再清」：从干净骨架直接清空是打空断言，验不出残留。
const cleared = applyOp('M3', filled, { op: 'setSection', section: null }).graph;
const clearedMeasures = interpretQuestion(cleared, 'beam', { frame: frameSolve(cleared) });
ok('⑪', cleared.meta.section === undefined
  && Boolean(measureOf(clearedMeasures, 'stress')?.missing)
  && Boolean(measureOf(clearedMeasures, 'deflection')?.missing)
  && !measureOf(clearedMeasures, 'stress')?.headline
  && !measureOf(clearedMeasures, 'deflection')?.headline,
  `⑪ 清空截面后没退回 missing：stress「${measureOf(clearedMeasures, 'stress')?.headline ?? measureOf(clearedMeasures, 'stress')?.missing}」deflection「${measureOf(clearedMeasures, 'deflection')?.headline ?? measureOf(clearedMeasures, 'deflection')?.missing}」`);
console.log(`⑪  清空截面 → stress / deflection 都回 missing（meta.section=${cleared.meta.section}）`);

/* ── ⑫ W20 A7：点名到器件与位置，不许裸 unsupported ────────────── */

const a7 = skeleton('A7');
const a7Note = unknownDeviceNote(a7);
const a7Refused = resolveLabSolve('A7', applyOp('A7', a7, { op: 'deleteDevice', nodeId: 'n-rin' }).graph);
const a7Reason = a7Refused.kind === 'refused' ? a7Refused.reason : '';
ok('⑫', Boolean(a7Note)
  && a7Note.includes('求和圆') && a7Note.includes('sum') && a7Note.includes('n-sum')
  && a7Reason.includes('sum') && a7Reason.includes('n-sum')
  && !a7Reason.includes('unsupported') && !a7Note.includes('unsupported'),
  `⑫ A7 文案没点名或仍带裸 unsupported：note「${a7Note}」reason「${a7Reason}」`);
console.log(`⑫  A7 点名：「${a7Note.slice(0, 62)}…」不含裸 unsupported`);

/* ── ⑬ W21-A A3：文案按能力分支 ───────────────────────────────────
 * 模板 solver 的「本工具不计算变形」在 M5（已经算出 δmax + 挠曲线）上是
 * 自我否定。这里真跑能力判定与过滤函数；页面 DOM 扫描在 check:coherence ④。
 */
const NO_DEFORM = '本工具不计算变形（挠度/转角/变形协调均无）：静定反力、内力与应力不需要 section.E';
const capM5 = beamCapabilities(skeleton('M5'));
const capM3 = beamCapabilities(skeleton('M3'));
ok('⑬', capM5.includes('deflection'), `⑬ M5 明明算得出挠度，能力表里却没有 deflection：${capM5.join('/')}`);
ok('⑬', filterWarningsByCapability([NO_DEFORM], capM5).length === 0, '⑬ M5 的免责条没被过滤掉（同页会既给 δmax 又写不计算变形）');
ok('⑬', filterWarningsByCapability([NO_DEFORM], capM3).length === 1, '⑬ M3 没截面时反而把免责条删了（会承诺算不了的量）');
const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
ok('⑬', /filterWarningsByCapability\(base\.warnings, capabilities\)/.test(labSource), '⑬ Lab.tsx 没接上按能力过滤（断言会打空）');
console.log(`⑬  M5 能力 ${capM5.join('/')} → 免责条已过滤；M3 无截面 → 免责条保留`);

if (problems.length > 0) {
  console.error(`FAIL：${problems.length}/${checks} 项未通过`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（measures 与入口无关 / M5 有 δmax / M7 有 Pcr / A3·A5 gain 对账 / 拒答不变 / 载荷不被吸附 / 截面给与清 / A7 点名 / 文案按能力分支 / 两条变异）`);
