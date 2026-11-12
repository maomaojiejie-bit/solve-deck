/**
 * check:framesolve —— W15-S2 力学通用求解。六条验收 + 一条变异。
 *
 *  ① 简支 L=4, P=20@2 → RA=RB=10、Mmax=20@x=2（与 M3 快照 result ≤1e-12 对账）
 *  ② 悬臂 L=2, P=10@1 → RA=10、|M_A|=10、M(0)=-10（与 M3-cantilever 快照 ≤1e-12 对账）
 *  ③ 超静定一：两端固定梁 L=4、全跨 q=10 → R=20、M_A=-13.3333、跨中 M=+6.6667、Q(0)=+20、Q(2)=0
 *  ④ 超静定二：两跨连续（每跨 4m，q=10）→ RA=RC=15、RB=50、M_B=-20
 *  ⑤ 三角桁架 → N_AC=N_BC=-7.071、N_AB=+5；
 *     超纲例：补一根 A–B 杆（m=4 > 2j-3）+ C 点水平 H=5 → 杆内力全非零、ΣF/ΣM 残差 <1e-9
 *  ⑥ 变异：关掉 releaseMoment（桁架当刚架）→ ⑤ 的桁架断言红
 *  ⑦ 红线：frameSolve 不 import 任何 src/core/templates/**（内存变异验红）
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameSolve, FRAME_SOLVE_CONFIG } from '../src/core/lab/frameSolve.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const example = (id) => JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));

/** 合成一张力学画布：坐标 = 物理单位（m / kN）。 */
function frameGraph({ joints, members, supports, loads, meta = {} }) {
  const nodes = [
    ...joints.map(([id, x, y]) => ({ id, x, y, kind: 'pin', label: '' })),
    ...supports.map(([id, x, y, kind]) => ({ id, x, y, kind, label: kind === 'fixedSupport' ? '固定端' : kind === 'pinSupport' ? '固定铰' : '可动铰' })),
    ...loads.map((load) => ({ id: load.id, x: load.x, y: load.y, kind: load.kind, rot: load.rot ?? 0, value: load.value, label: load.label ?? '' })),
  ];
  const edges = members.map((member) => ({
    id: member.id,
    from: member.from,
    to: member.to,
    kind: member.kind ?? 'beam',
  }));
  return { templateId: 'frame-solve-check', family: 'beam', nodes, edges, meta };
}

const solve = (graph) => {
  try {
    return frameSolve(graph);
  } catch (error) {
    problems.push(`求解抛错 / ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};
const reactionOf = (solution, nodeId) => solution.reactions.find((r) => r.nodeId === nodeId);
const memberOf = (solution, edgeId) => solution.memberEndForces.find((m) => m.edgeId === edgeId);
const curveAt = (solution, edgeId, x) => {
  const curve = solution.memberCurves.find((c) => c.edgeId === edgeId);
  const sample = curve?.samples.find((s) => Math.abs(s.x - x) < 1e-9);
  if (!sample) problems.push(`曲线采样 / ${edgeId} 在 x=${x} 没有采样点`);
  return sample;
};

/* ── ① 简支梁：与 M3 快照对账 ────────────────────────────────────── */
{
  const graph = frameGraph({
    joints: [['n-j0', 0, 0], ['n-j1', 4, 0]],
    members: [{ id: 'e-beam', from: 'n-j0', to: 'n-j1' }],
    supports: [['n-sup-0', 0, 0, 'pinSupport'], ['n-sup-1', 4, 0, 'rollerSupport']],
    loads: [{ id: 'n-load', x: 2, y: 0, kind: 'arrow', rot: 0, value: 20 }],
    meta: { L: 4 },
  });
  const s = solve(graph);
  if (s) {
    const ra = reactionOf(s, 'n-sup-0');
    const rb = reactionOf(s, 'n-sup-1');
    ok('①', ra && near(ra.fy, 10, 1e-12), `① RA=${ra?.fy} ≠ 10`);
    ok('①', rb && near(rb.fy, 10, 1e-12), `① RB=${rb?.fy} ≠ 10`);
    const beam = memberOf(s, 'e-beam');
    ok('①', beam && near(beam.Q[0], 10, 1e-12) && near(beam.Q[1], -10, 1e-12), `① Q 端值 ${beam?.Q.join(',')} ≠ 10 / -10`);
    ok('①', beam && near(beam.M[0], 0, 1e-12) && near(beam.M[1], 0, 1e-12), '① 简支端 M 应为 0');
    ok('①', near(s.extremes.Mmax, 20, 1e-12), `① Mmax=${s.extremes.Mmax} ≠ 20`);
    ok('①', near(s.extremes.atX, 2, 1e-12), `① Mmax 位置 ${s.extremes.atX} ≠ x=2`);
    ok('①', near(s.extremes.Qmax, 10, 1e-12), `① Qmax=${s.extremes.Qmax} ≠ 10`);
    const mid = curveAt(s, 'e-beam', 2);
    ok('①', mid && near(mid.M, 20, 1e-12), `① 跨中 M=${mid?.M} ≠ 20`);
    // 与 M3 快照 result 逐位对账（只读 JSON，不 import 模板）
    const golden = example('M3').result;
    ok('①', near(ra?.fy ?? NaN, golden.RA, 1e-12) && near(rb?.fy ?? NaN, golden.RB, 1e-12), '① 反力与 M3 快照不一致');
    ok('①', near(s.extremes.Mmax, golden.Mmax, 1e-12) && near(s.extremes.atX, golden.MmaxX, 1e-12) && near(s.extremes.Qmax, golden.Qmax, 1e-12), '① 极值与 M3 快照不一致');
    const qMin = Math.min(...s.memberCurves[0].samples.map((sample) => sample.Q));
    ok('①', near(qMin, golden.Qmin, 1e-12), `① Qmin=${qMin} 与 M3 快照 ${golden.Qmin} 不一致`);
    ok('①', Math.abs(s.residual.sumFx) < 1e-9 && Math.abs(s.residual.sumFy) < 1e-9 && Math.abs(s.residual.sumM) < 1e-9, `① ΣF/ΣM 残差超差：${JSON.stringify(s.residual)}`);
    console.log(`①  简支 L=4, P=20@2：RA=RB=${ra.fy}，|M|max=${s.extremes.Mmax} @x=${s.extremes.atX}（与 M3 快照 ≤1e-12 逐位一致），ΣF=${s.residual.sumFy.toExponential(2)}`);
  }
}

/* ── ② 悬臂梁：与 M3-cantilever 快照对账 ─────────────────────────── */
{
  const graph = frameGraph({
    joints: [['n-j0', 0, 0], ['n-j1', 2, 0]],
    members: [{ id: 'e-beam', from: 'n-j0', to: 'n-j1' }],
    supports: [['n-sup-0', 0, 0, 'fixedSupport']],
    loads: [{ id: 'n-load', x: 1, y: 0, kind: 'arrow', rot: 0, value: 10 }],
    meta: { L: 2 },
  });
  const s = solve(graph);
  if (s) {
    const ra = reactionOf(s, 'n-sup-0');
    ok('②', ra && near(ra.fy, 10, 1e-12), `② RA=${ra?.fy} ≠ 10`);
    ok('②', ra && near(ra.mz, 10, 1e-12), `② 反力偶 M_A=${ra?.mz} ≠ +10（逆时针）`);
    const beam = memberOf(s, 'e-beam');
    ok('②', beam && near(beam.M[0], -10, 1e-12), `② M(0)=${beam?.M[0]} ≠ -10（下侧受拉为正，固定端上侧受拉）`);
    ok('②', beam && near(beam.M[1], 0, 1e-12) && near(beam.Q[1], 0, 1e-12), '② 自由端 Q、M 应为 0');
    ok('②', beam && near(beam.Q[0], 10, 1e-12), `② Q(0)=${beam?.Q[0]} ≠ 10`);
    ok('②', near(s.extremes.Mmax, 10, 1e-12) && near(s.extremes.atX, 0, 1e-12), `② |M|max=${s.extremes.Mmax}@${s.extremes.atX} ≠ 10@0`);
    const golden = example('M3-cantilever').result;
    ok('②', near(ra?.fy ?? NaN, golden.RA, 1e-12) && near(Math.abs(ra?.mz ?? NaN), golden.MA, 1e-12), '② 反力与 M3-cantilever 快照不一致');
    ok('②', near(s.extremes.Mmax, golden.Mmax, 1e-12) && near(s.extremes.atX, golden.MmaxX, 1e-12) && near(s.extremes.Qmax, golden.Qmax, 1e-12), '② 极值与 M3-cantilever 快照不一致');
    console.log(`②  悬臂 L=2, P=10@1：RA=${ra.fy}，M_A=${ra.mz}（反力偶）/ 内力 M(0)=${beam.M[0]}（与 M3-cantilever 快照 ≤1e-12 一致）`);
  }
}

/* ── ③ 超静定一：两端固定梁，全跨均布 ────────────────────────────── */
{
  const graph = frameGraph({
    joints: [['n-j0', 0, 0], ['n-j1', 4, 0]],
    members: [{ id: 'e-beam', from: 'n-j0', to: 'n-j1' }],
    supports: [['n-sup-0', 0, 0, 'fixedSupport'], ['n-sup-1', 4, 0, 'fixedSupport']],
    loads: [{ id: 'n-udl', x: 2, y: 0.5, kind: 'udl', value: 10 }],
    meta: { L: 4 },
  });
  const s = solve(graph);
  if (s) {
    const ra = reactionOf(s, 'n-sup-0');
    const rb = reactionOf(s, 'n-sup-1');
    ok('③', ra && rb && near(ra.fy, 20, 1e-9) && near(rb.fy, 20, 1e-9), `③ 反力 ${ra?.fy}/${rb?.fy} ≠ 20/20`);
    const beam = memberOf(s, 'e-beam');
    ok('③', beam && near(beam.M[0], -40 / 3, 1e-9) && near(beam.M[1], -40 / 3, 1e-9), `③ 固端弯矩 ${beam?.M.join(',')} ≠ -13.3333/-13.3333`);
    const mid = curveAt(s, 'e-beam', 2);
    ok('③', mid && near(mid.M, 20 / 3, 1e-9), `③ 跨中 M=${mid?.M} ≠ +6.6667`);
    ok('③', beam && near(beam.Q[0], 20, 1e-9), `③ Q(0)=${beam?.Q[0]} ≠ +20`);
    const qMid = curveAt(s, 'e-beam', 2);
    ok('③', qMid && near(qMid.Q, 0, 1e-9), `③ Q(2)=${qMid?.Q} ≠ 0`);
    ok('③', Math.abs(s.residual.sumFy) < 1e-9 && Math.abs(s.residual.sumM) < 1e-9, `③ ΣF/ΣM 残差超差：${JSON.stringify(s.residual)}`);
    console.log(`③  两端固定梁 L=4, q=10：R=${ra.fy}/${rb.fy}，M_A=${beam.M[0]}，跨中 M=${mid.M}，Q(0)=${beam.Q[0]}，Q(2)=${qMid.Q}，ΣM=${s.residual.sumM.toExponential(2)}`);
  }
}

/* ── ④ 超静定二：两跨连续梁 ──────────────────────────────────────── */
{
  const graph = frameGraph({
    joints: [['n-j0', 0, 0], ['n-j1', 4, 0], ['n-j2', 8, 0]],
    members: [
      { id: 'e-m1', from: 'n-j0', to: 'n-j1' },
      { id: 'e-m2', from: 'n-j1', to: 'n-j2' },
    ],
    supports: [['n-sup-a', 0, 0, 'pinSupport'], ['n-sup-b', 4, 0, 'rollerSupport'], ['n-sup-c', 8, 0, 'rollerSupport']],
    loads: [
      { id: 'n-udl-1', x: 2, y: 0.5, kind: 'udl', value: 10 },
      { id: 'n-udl-2', x: 6, y: 0.5, kind: 'udl', value: 10 },
    ],
    meta: { L: 8 },
  });
  const s = solve(graph);
  if (s) {
    const ra = reactionOf(s, 'n-sup-a');
    const rb = reactionOf(s, 'n-sup-b');
    const rc = reactionOf(s, 'n-sup-c');
    ok('④', ra && near(ra.fy, 15, 1e-9), `④ RA=${ra?.fy} ≠ 15`);
    ok('④', rb && near(rb.fy, 50, 1e-9), `④ RB=${rb?.fy} ≠ 50`);
    ok('④', rc && near(rc.fy, 15, 1e-9), `④ RC=${rc?.fy} ≠ 15`);
    const m1 = memberOf(s, 'e-m1');
    const m2 = memberOf(s, 'e-m2');
    ok('④', m1 && near(m1.M[1], -20, 1e-9), `④ M_B（e-m1 末端）=${m1?.M[1]} ≠ -20`);
    ok('④', m2 && near(m2.M[0], -20, 1e-9), `④ M_B（e-m2 始端）=${m2?.M[0]} ≠ -20（两侧应连续）`);
    ok('④', m1 && near(m1.Q[0], 15, 1e-9) && near(m1.Q[1], -25, 1e-9), `④ e-m1 Q 端值 ${m1?.Q.join(',')} ≠ 15 / -25`);
    const midSpan = curveAt(s, 'e-m1', 2);
    ok('④', midSpan && near(midSpan.M, 10, 1e-9), `④ 第一跨跨中 M=${midSpan?.M} ≠ 10`);
    ok('④', near(s.extremes.Mmax, 20, 1e-9) && near(s.extremes.atX, 4, 1e-9), `④ |M|max=${s.extremes.Mmax}@${s.extremes.atX} ≠ 20@4（中支座）`);
    ok('④', Math.abs(s.residual.sumFy) < 1e-9 && Math.abs(s.residual.sumM) < 1e-9, `④ ΣF/ΣM 残差超差：${JSON.stringify(s.residual)}`);
    if (midSpan) console.log(`④  两跨连续 2×4m, q=10：RA=${ra.fy}，RB=${rb.fy}，RC=${rc.fy}，M_B=${m1.M[1]}，跨中 M=${midSpan.M}，ΣFy=${s.residual.sumFy.toExponential(2)}`);
  }
}

/* ── ⑤ 三角桁架 + 超纲超静定桁架 ─────────────────────────────────── */
const trussGraph = (withExtraBar, horizontalLoad) =>
  frameGraph({
    // 画布 y 向下：顶点 C 在上方 → 画布 y = -1（物理 +1）
    joints: [['n-a', 0, 0], ['n-b', 2, 0], ['n-c', 1, -1]],
    members: [
      { id: 'e-ac', from: 'n-a', to: 'n-c', kind: 'trussMember' },
      { id: 'e-bc', from: 'n-b', to: 'n-c', kind: 'trussMember' },
      { id: 'e-ab', from: 'n-a', to: 'n-b', kind: 'trussMember' },
      ...(withExtraBar ? [{ id: 'e-ab2', from: 'n-a', to: 'n-b', kind: 'trussMember' }] : []),
    ],
    supports: [['n-sup-a', 0, 0, 'pinSupport'], ['n-sup-b', 2, 0, 'rollerSupport']],
    // R3-1：横向载荷用 rot=270 = 画布朝右（SVG rotate 顺时针，同 M1 快照），
    // 即「H 推 C 向 B」；原来的 rot=90 画出来是朝左，与断言里的"推 C 向 B"不符。
    loads: [horizontalLoad ? { id: 'n-h', x: 1, y: -1, kind: 'arrow', rot: 270, value: 5 } : { id: 'n-p', x: 1, y: -1, kind: 'arrow', rot: 0, value: 10 }],
  });
{
  // ⑤a 静定三角桁架：顶点竖直载荷 10
  const s = solve(trussGraph(false, false));
  if (s) {
    const nAC = memberOf(s, 'e-ac');
    const nBC = memberOf(s, 'e-bc');
    const nAB = memberOf(s, 'e-ab');
    ok('⑤', nAC && near(nAC.N[0], -5 * Math.SQRT2, 1e-9), `⑤ N_AC=${nAC?.N[0]} ≠ -7.0711`);
    ok('⑤', nBC && near(nBC.N[0], -5 * Math.SQRT2, 1e-9), `⑤ N_BC=${nBC?.N[0]} ≠ -7.0711`);
    ok('⑤', nAB && near(nAB.N[0], 5, 1e-9), `⑤ N_AB=${nAB?.N[0]} ≠ +5`);
    ok('⑤', nAC && nBC && nAB && near(nAC.Q[0], 0, 1e-12) && near(nAC.M[0], 0, 1e-12), '⑤ 桁架杆的 Q、M 应为 0（转动已释放）');
    ok('⑤', Math.abs(s.residual.sumFx) < 1e-9 && Math.abs(s.residual.sumFy) < 1e-9 && Math.abs(s.residual.sumM) < 1e-9, `⑤ ΣF/ΣM 残差超差：${JSON.stringify(s.residual)}`);
    console.log(`⑤  三角桁架 P=10@C：N_AC=${nAC.N[0].toFixed(6)}，N_BC=${nBC.N[0].toFixed(6)}，N_AB=${nAB.N[0].toFixed(6)}，ΣM=${s.residual.sumM.toExponential(2)}`);
  }
  // ⑤b 超纲例：补一根 A–B 杆（m=4 > 2j-3=3，超静定）+ C 点水平 H=5 → 全部杆力非零
  const s2 = solve(trussGraph(true, true));
  if (s2) {
    const forces = ['e-ac', 'e-bc', 'e-ab', 'e-ab2'].map((id) => ({ id, n: memberOf(s2, id)?.N[0] ?? NaN }));
    ok('⑤', forces.every((f) => Number.isFinite(f.n) && Math.abs(f.n) > 1e-6), `⑤ 超静定桁架有杆力为零或缺失：${forces.map((f) => `${f.id}=${f.n}`).join(', ')}`);
    const nAC = forces.find((f) => f.id === 'e-ac').n;
    const nAB1 = forces.find((f) => f.id === 'e-ab').n;
    const nAB2 = forces.find((f) => f.id === 'e-ab2').n;
    ok('⑤', near(nAC, 2.5 * Math.SQRT2, 1e-9), `⑤ N_AC=${nAC} ≠ +3.5355（H 推 C 向 B，AC 被拉）`);
    ok('⑤', near(nAB1, 1.25, 1e-9) && near(nAB2, 1.25, 1e-9), `⑤ 两根平行 AB 杆各分一半：${nAB1}/${nAB2} ≠ 1.25/1.25`);
    const r = s2.residual;
    ok('⑤', Math.abs(r.sumFx) < 1e-9 && Math.abs(r.sumFy) < 1e-9 && Math.abs(r.sumM) < 1e-9, `⑤ 超纲例 ΣF/ΣM 残差 <1e-9 不满足：${JSON.stringify(r)}`);
    console.log(`⑤  超纲例 m=4 + H=5@C：N_AC=${nAC.toFixed(6)}，N_BC=${forces.find((f) => f.id === 'e-bc').n.toFixed(6)}，N_AB=${nAB1.toFixed(6)}/${nAB2.toFixed(6)}（全非零），残差 max=${Math.max(Math.abs(r.sumFx), Math.abs(r.sumFy), Math.abs(r.sumM)).toExponential(2)}`);
  }
}

/* ── ⑥ 变异：关掉 releaseMoment（桁架当刚架）→ ⑤ 红 ─────────────── */
{
  FRAME_SOLVE_CONFIG.releaseMoment = false;
  const mutated = solve(trussGraph(false, false));
  FRAME_SOLVE_CONFIG.releaseMoment = true;
  const restored = solve(trussGraph(false, false));
  const nAC = mutated ? memberOf(mutated, 'e-ac')?.N[0] : NaN;
  ok('⑥', !mutated || !near(nAC, -5 * Math.SQRT2, 1e-6), `⑥ 变异（releaseMoment=false）后 N_AC=${nAC} 仍等于桁架值（门禁空转，变异没验出差别）`);
  ok('⑥', restored && near(memberOf(restored, 'e-ac')?.N[0] ?? NaN, -5 * Math.SQRT2, 1e-9), '⑥ 还原 releaseMoment 后没回绿');
  console.log(`⑥  变异：releaseMoment=false（桁架当刚架）→ N_AC=${nAC?.toFixed(6)} ≠ -7.0711（⑤ 红）；还原回绿`);
}

/* ── ⑦ 红线：frameSolve 不得 import 模板文件 ────────────────────── */
{
  const source = readFileSync(join(root, 'src', 'core', 'lab', 'frameSolve.ts'), 'utf8');
  const badImports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]).filter((path) => path.includes('templates'));
  ok('⑦', badImports.length === 0, `⑦ frameSolve 拖进了模板文件：${badImports.join(', ')}`);
  const mutatedSrc = `${source}\nimport { solveM3 } from '../templates/mechanics/M3.ts';\n`;
  const stillBad = [...mutatedSrc.matchAll(/from '([^']+)'/g)].map((match) => match[1]).filter((path) => path.includes('templates'));
  ok('⑦', stillBad.length > 0, '⑦ import 变异没被拦下（门禁空转）');
  console.log('⑦  红线：frameSolve 零模板 import；变异（import M3.ts）验红（内存中，不碰源文件）');
}

/* ── 汇总 ───────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（通用力学求解：简支/悬臂对账快照 / 两端固定 / 两跨连续 / 静定+超静定桁架 / releaseMoment 变异 / 模板红线）`);
