/**
 * check:labresolve —— W15-S4 通用求解接入。六条验收 + 一条变异。
 *
 *  ① A3 默认骨架 → template 路由（五步讲解稿照旧，无 generic-solution）
 *  ② A3 删 Rs → generic-solution（不再拒答），nodeVoltages 与直接调 netSolve 逐位相等；
 *     A3 删 Rl → generic 且 |Vo| 非零（比「全 0」更有牙齿的等价断言）
 *  ③ M3 改两端固定梁 + q=10 → generic 力学：M_A=-13.3333、三条内力曲线、反力 20/20
 *  ④ A3 删 gnd → 仍 U 拒答（noGround），不给任何数值
 *  ⑤ 档位语义：骨架不符但拓扑合法 → N（无讲解稿，已用通用求解）；拓扑非法 → U
 *  ⑥ 变异：把「骨架不符也走模板（一律拒答）」写回去 → 第 ② 条红
 *  ⑦ A1 删 gnd → U 拒答 noGround（A1 归约表不含 gnd，以前走模板照常出数）
 *  ⑧ 变异：GROUND_GATE_CONFIG.enforce=false → ⑦ 回退成 template（判据空转即红）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';
import { labUiStep, createUiState } from '../src/core/lab/ui.ts';
import { resolveLabSolve, RESOLVE_CONFIG, GROUND_GATE_CONFIG, noGroundProblems, netSolveOptionsFor } from '../src/core/lab/resolve.ts';
import { netSolve } from '../src/core/lab/netSolve.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const example = (id) => JSON.parse(readFileSync(`${root}/src/examples/${id}.json`, 'utf8'));

const skeleton = (id) => freshSkeleton(id, example(id).render_specs[0]);
const step = (templateId, state, op) => labUiStep(templateId, state, { type: 'op', op });
const direct = (graph) => netSolve(graph, netSolveOptionsFor(graph).options);

/* ── ①② 电路：模板路由与通用路由 ───────────────────────────────── */
{
  const a3 = skeleton('A3');
  const r1 = resolveLabSolve('A3', a3);
  ok('①', r1.kind === 'template', `① A3 默认骨架应走模板五步，实际 ${r1.kind}`);
  ok('①', r1.kind !== 'generic' && !('circuit' in r1), '① 默认骨架不该出 generic-solution');

  const st = step('A3', createUiState('A3', a3), { op: 'deleteDevice', nodeId: 'n-rs' });
  const r2 = resolveLabSolve('A3', st.graph, st.rules);
  ok('②', r2.kind === 'generic' && Boolean(r2.circuit), `② 删 Rs 后应出 generic-solution，实际 ${r2.kind}${r2.kind === 'refused' ? `：${r2.reason}` : ''}`);
  if (r2.kind === 'generic' && r2.circuit) {
    const golden = direct(st.graph);
    ok('②', golden.ok, `② 直接调 netSolve 居然被拒：${golden.ok ? '' : golden.reason}`);
    if (golden.ok) {
      const same = JSON.stringify(r2.circuit.nodeVoltages) === JSON.stringify(golden.solution.nodeVoltages);
      ok('②', same, `② nodeVoltages 与直接调 netSolve 不逐位相等：${JSON.stringify(r2.circuit.nodeVoltages)} vs ${JSON.stringify(golden.solution.nodeVoltages)}`);
    }
    console.log(`②  A3 删 Rs → generic-solution：nodeVoltages 与直接调 netSolve 逐位相等（${JSON.stringify(r2.circuit.nodeVoltages)}）`);
  }
  // ② b：删 Rs 并把 Vs 直连基极（Rs 短接）→ 骨架不符但电学成立 → 非零强断言
  let stRl = step('A3', createUiState('A3', a3), { op: 'deleteDevice', nodeId: 'n-rs' });
  stRl = step('A3', stRl, { op: 'addEdge', from: 'n-vs:p', to: 'n-q:b' });
  const r2b = resolveLabSolve('A3', stRl.graph, stRl.rules);
  ok('②', r2b.kind === 'generic' && Boolean(r2b.circuit), `② Rs 短接后应出 generic-solution，实际 ${r2b.kind}${r2b.kind === 'refused' ? `：${r2b.reason}` : ''}`);
  if (r2b.kind === 'generic' && r2b.circuit) {
    const vo = r2b.circuit.nodeVoltages['n-vo'];
    const golden = direct(stRl.graph);
    ok('②', typeof vo === 'number' && Math.abs(vo) > 1, `② Rs 短接后 |Vo|=${vo} 应显著非零（输入直驱基极）`);
    ok('②', golden.ok && vo === golden.solution.nodeVoltages['n-vo'], '② Rs 短接的 Vo 与直接调 netSolve 不逐位相等');
    console.log(`②  A3 删 Rs 并短接 → generic-solution：Vo=${vo}（非零，与直接调用逐位相等）`);
  }
}

/* ── ③ 力学：M3 改两端固定梁 → 通用刚度法 ───────────────────────── */
{
  let st = createUiState('M3', skeleton('M3'));
  // R3-1 A1：支座是结点属性 —— 不再删支座图元，直接把两端改成固定端。
  for (const op of [
    { op: 'deleteDevice', nodeId: 'n-load-0' },
    { op: 'setSupport', nodeId: 'n-end-a', type: 'fixed' },
    { op: 'setSupport', nodeId: 'n-end-b', type: 'fixed' },
    { op: 'addLoad', atNodeId: 'n-end-a', type: 'udl', value: 10 },
  ]) {
    st = step('M3', st, op);
  }
  const r3 = resolveLabSolve('M3', st.graph, st.rules);
  ok('③', r3.kind === 'generic' && Boolean(r3.frame), `③ 两端固定梁应出 generic-solution，实际 ${r3.kind}${r3.kind === 'refused' ? `：${r3.reason}` : ''}`);
  if (r3.kind === 'generic' && r3.frame) {
    const member = r3.frame.memberEndForces[0];
    ok('③', Math.abs(member.M[0] - (-40 / 3)) <= 1e-9, `③ M_A=${member.M[0]} ≠ -13.3333`);
    const curve = r3.frame.memberCurves[0]?.samples ?? [];
    ok('③', curve.length >= 3 && curve.every((s) => ['N', 'Q', 'M'].every((k) => typeof s[k] === 'number')), `③ 三条内力曲线采样不完整（${curve.length} 点）`);
    const rA = r3.frame.reactions[0];
    ok('③', Math.abs(rA.fy - 20) <= 1e-9, `③ 反力 Fy=${rA.fy} ≠ 20`);
    console.log(`③  M3 改两端固定梁 q=10 → generic-solution：M_A=${member.M[0]}，反力 ${rA.fy}，内力曲线 ${curve.length} 点（N/Q/M 三条）`);
  }
}

/* ── ④ 拒答：拓扑非法仍是 U，不给数字 ───────────────────────────── */
{
  const st = step('A3', createUiState('A3', skeleton('A3')), { op: 'deleteDevice', nodeId: 'n-gnd' });
  const r4 = resolveLabSolve('A3', st.graph, st.rules);
  ok('④', r4.kind === 'refused' && r4.code === 'noGround', `④ 删 gnd 应仍拒 noGround，实际 ${r4.kind}${r4.kind === 'refused' ? r4.code : ''}`);
  ok('④', !('circuit' in r4) && !('frame' in r4), '④ 拒答还带了数值（页面会给数字）');
  ok('④', r4.kind === 'refused' && r4.reason.includes('接地'), '④ 拒答原因要给人话');
  console.log(`④  删 gnd → 仍 U 拒答 noGround：「${r4.kind === 'refused' ? r4.reason.slice(0, 36) : ''}…」，无数字`);
}

/* ── ⑤ 档位语义收口 ─────────────────────────────────────────────── */
{
  const a3 = skeleton('A3');
  const stRs = step('A3', createUiState('A3', a3), { op: 'deleteDevice', nodeId: 'n-rs' });
  const stBus = step('A3', createUiState('A3', a3), { op: 'deleteEdge', edgeId: 'e-c-bus' });
  ok('⑤', stRs.preview.tier === 'N', `⑤ 删 Rs（骨架不符、拓扑合法）应为 N，实际 ${stRs.preview.tier}`);
  ok('⑤', stBus.preview.tier === 'U', `⑤ 删 e-c-bus（纯断线，W16 阻断语义保留）应为 U，实际 ${stBus.preview.tier}`);
  const stBeam = (() => {
    let s = createUiState('M3', skeleton('M3'));
    for (const op of [
      { op: 'deleteDevice', nodeId: 'n-load-0' },
      { op: 'setSupport', nodeId: 'n-end-a', type: 'fixed' },
      { op: 'setSupport', nodeId: 'n-end-b', type: 'fixed' },
      { op: 'addLoad', atNodeId: 'n-end-a', type: 'udl', value: 10 },
    ]) s = step('M3', s, op);
    return s;
  })();
  ok('⑤', stBeam.preview.tier === 'N', `⑤ 两端固定梁应为 N，实际 ${stBeam.preview.tier}`);
  const stNoGnd = step('A3', createUiState('A3', a3), { op: 'deleteDevice', nodeId: 'n-gnd' });
  ok('⑤', stNoGnd.preview.tier === 'U', `⑤ 删 gnd 应为 U，实际 ${stNoGnd.preview.tier}`);
  console.log(`⑤  档位：删Rs=${stRs.preview.tier}（无讲解稿，已用通用求解）/ 删母线=${stBus.preview.tier}（断线阻断）/ 固定梁=${stBeam.preview.tier} / 删gnd=${stNoGnd.preview.tier}`);
}

/* ── ⑥ 变异：把「骨架不符也走模板」写回去 → ② 红 ────────────────── */
{
  RESOLVE_CONFIG.genericOnMismatch = false;
  const st = step('A3', createUiState('A3', skeleton('A3')), { op: 'deleteDevice', nodeId: 'n-rs' });
  const mutated = resolveLabSolve('A3', st.graph, st.rules);
  RESOLVE_CONFIG.genericOnMismatch = true;
  const restored = resolveLabSolve('A3', st.graph, st.rules);
  ok('⑥', mutated.kind === 'refused', `⑥ 变异（写回一律拒答）后删 Rs 应不再出 generic-solution，实际 ${mutated.kind}（门禁空转）`);
  ok('⑥', restored.kind === 'generic', '⑥ 还原后没回绿');
  console.log('⑥  变异：genericOnMismatch=false（骨架不符一律拒答）→ ② 红；还原回绿');
}

/* ── ⑦⑧ 接地判据先于模板早退：A1 的归约表不读 gnd ─────────────────── */
{
  const a1 = skeleton('A1');
  const stNoGnd = step('A1', createUiState('A1', a1), { op: 'deleteDevice', nodeId: 'n-gnd' });
  const problemsA1 = noGroundProblems(stNoGnd.graph);
  ok('⑦', problemsA1.length === 1 && problemsA1[0].includes('接地'), `⑦ A1 删 gnd 应报「没有接地符号」，实际 ${JSON.stringify(problemsA1)}`);
  const r7 = resolveLabSolve('A1', stNoGnd.graph, stNoGnd.rules);
  ok('⑦', r7.kind === 'refused' && r7.code === 'noGround', `⑦ A1 删 gnd 应拒 noGround，实际 ${r7.kind}${r7.kind === 'refused' ? r7.code : ''}`);
  ok('⑦', !('circuit' in r7) && !('result' in r7), '⑦ 拒答还带了数值（页面会给数字）');
  ok('⑦', stNoGnd.preview.tier === 'U', `⑦ 删 gnd 的档位应 U，实际 ${stNoGnd.preview.tier}`);
  // 有地时不许误伤：A1 原骨架仍走模板
  ok('⑦', resolveLabSolve('A1', a1, []).kind === 'template', '⑦ A1 原骨架被接地判据误伤（应为 template）');
  // 力学族不受这条判据管
  const m3 = skeleton('M3');
  ok('⑦', noGroundProblems(m3).length === 0, '⑦ 力学骨架不该被判「没有接地」');

  // ⑧ 变异：关掉判据 → 回到「模板照常出数」的旧行为，证明这条门禁真有牙齿
  GROUND_GATE_CONFIG.enforce = false;
  const mutated = resolveLabSolve('A1', stNoGnd.graph, stNoGnd.rules);
  GROUND_GATE_CONFIG.enforce = true;
  const restored = resolveLabSolve('A1', stNoGnd.graph, stNoGnd.rules);
  ok('⑧', mutated.kind === 'template', `⑧ 变异（enforce=false）后删 gnd 应回退成 template，实际 ${mutated.kind}（判据空转）`);
  ok('⑧', restored.kind === 'refused' && restored.code === 'noGround', '⑧ 还原后没回绿');
  console.log(`⑦  A1 删 gnd → U noGround「${r7.kind === 'refused' ? r7.reason.slice(0, 30) : ''}…」（以前走模板照常出数）；⑧ 变异回退成 template 再还原回绿`);
}

/* ── 汇总 ───────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（通用求解接入：A3 模板路由 / 删Rs 与 Rs 短接通用等价 / 两端固定梁通用刚度法 / noGround 仍拒 / 档位语义收口 / 变异）`);
