/**
 * check:undo —— W14 撤销 / 重做。全部走 labUiStep（页面按钮与门禁同一套状态机）。
 *
 *  ① 删器件 → 撤销 → 图 / appliedRules / params 逐字段回到删前
 *  ② 撤销后重做 → 回到删后
 *  ③ 栈深 30：35 次操作只能撤 30 次，第 31 次无变化（页面按钮 disabled 由栈空推出）
 *  ④ 换题型（reset / loadCandidate）→ 栈清空，Ctrl+Z 不动新图
 *  ⑤ 拖动不产生独立历史：撤一次 → 位置回到拖动前
 *  ⑥ Delete 键与 🗑 等价：两条路都派发同一个 deleteDevice op（同一图结果）+ 页面源码同路
 *
 *  变异：①撤销不回退 appliedRules → ① 红；②栈无上限 → ③ 红。验红再还原。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUiState, labUiStep, UNDO_CONFIG, UNDO_LIMIT } from '../src/core/lab/ui.ts';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};

const a3Spec = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8')).render_specs[0];
const skeleton = () => freshSkeleton('A3', a3Spec);
const graphJson = (state) => JSON.stringify({ nodes: state.graph.nodes, edges: state.graph.edges });

/* ── ① 删 → 撤：图 / rules / params 逐字段回删前 ─────────────────── */
let baseline;
{
  const base = createUiState('A3', skeleton());
  baseline = { graph: graphJson(base), rules: JSON.stringify(base.rules), params: JSON.stringify(base.preview.params) };
  let state = labUiStep('A3', base, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('①', !state.graph.nodes.some((node) => node.id === 'n-rc'), '① 删除没生效，后面全白测');
  state = labUiStep('A3', state, { type: 'undo' });
  ok('①', graphJson(state) === baseline.graph, '① 撤销后图没回到删前（逐字段）');
  ok('①', JSON.stringify(state.rules) === baseline.rules, `① 撤销后 appliedRules 没回退：${state.rules.join(' / ')}`);
  ok('①', JSON.stringify(state.preview.params) === baseline.params, '① 撤销后 params 没回到删前');
  ok('①', state.note === '已撤销：回到上一步结构', `① 撤销提示不对：${state.note}`);

  // 变异一：撤销不回退 appliedRules → ① 红
  UNDO_CONFIG.restoreRules = false;
  let mutated = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  mutated = labUiStep('A3', mutated, { type: 'undo' });
  ok('①', JSON.stringify(mutated.rules) !== baseline.rules, '① 变异（rules 不回退）没被拦下（门禁空转）');
  UNDO_CONFIG.restoreRules = true;
  const restored = labUiStep('A3', labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } }), { type: 'undo' });
  ok('①', JSON.stringify(restored.rules) === baseline.rules, '① 还原后没回绿');
  console.log('①  删 → 撤：图 / appliedRules / params 逐字段回删前；变异一（rules 不回退）验红还原');
}

/* ── ② 重做回删后 ────────────────────────────────────────────────── */
{
  let state = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  const afterDelete = { graph: graphJson(state), params: JSON.stringify(state.preview.params) };
  state = labUiStep('A3', state, { type: 'undo' });
  state = labUiStep('A3', state, { type: 'redo' });
  ok('②', graphJson(state) === afterDelete.graph, '② 重做后图不等于删后');
  ok('②', JSON.stringify(state.preview.params) === afterDelete.params, '② 重做后 params 不等于删后');
  ok('②', state.note === '已重做', `② 重做提示不对：${state.note}`);
  console.log('②  撤 → 重做：图与 params 逐字段回删后');
}

/* ── ③ 栈深 30 ───────────────────────────────────────────────────── */
{
  let state = createUiState('A3', skeleton());
  for (let i = 0; i < 35; i += 1) {
    state = labUiStep('A3', state, { type: 'op', op: { op: 'addDevice', kind: 'res', label: `Rz${i}`, value: 1000, x: 100 + (i % 10) * 60, y: 560 + Math.floor(i / 10) * 60 } });
  }
  ok('③', state.undoStack.length === UNDO_LIMIT, `③ 35 次操作后栈深 ${state.undoStack.length} ≠ ${UNDO_LIMIT}`);
  let undone = 0;
  while (state.undoStack.length > 0) {
    state = labUiStep('A3', state, { type: 'undo' });
    undone += 1;
  }
  ok('③', undone === UNDO_LIMIT, `③ 只能撤 ${undone} 次 ≠ ${UNDO_LIMIT}`);
  const stuck = labUiStep('A3', state, { type: 'undo' });
  ok('③', graphJson(stuck) === graphJson(state) && stuck.note === '没有可撤销的操作', `③ 第 ${UNDO_LIMIT + 1} 次撤销居然动了：${stuck.note}`);
  console.log(`③  栈深 ${UNDO_LIMIT}：35 次操作只撤 30 次，第 31 次无变化（按钮置灰 = 栈空）`);

  // 变异二：栈无上限 → ③ 红
  UNDO_CONFIG.respectLimit = false;
  let mutated = createUiState('A3', skeleton());
  for (let i = 0; i < 35; i += 1) {
    mutated = labUiStep('A3', mutated, { type: 'op', op: { op: 'addDevice', kind: 'res', label: `Ry${i}`, value: 1000, x: 100 + (i % 10) * 60, y: 560 + Math.floor(i / 10) * 60 } });
  }
  ok('③', mutated.undoStack.length !== UNDO_LIMIT, '③ 变异（栈无上限）没被拦下（门禁空转）');
  UNDO_CONFIG.respectLimit = true;
  console.log('③  变异二：栈无上限 → ③ 红；还原回绿');
}

/* ── ④ 换题型 / 恢复骨架 → 栈清空 ────────────────────────────────── */
{
  let state = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('④', state.undoStack.length === 1, '④ 前置：删一次应有一帧可撤');
  state = labUiStep('A3', state, { type: 'reset', templateId: 'A3', spec: a3Spec });
  ok('④', state.undoStack.length === 0 && state.redoStack.length === 0, '④ 恢复骨架后栈没清空');
  const after = labUiStep('A3', state, { type: 'undo' });
  ok('④', graphJson(after) === graphJson(state) && after.note === '没有可撤销的操作', '④ 恢复骨架后 Ctrl+Z 居然动了图');
  console.log('④  换题型 / 恢复骨架：栈清空，撤销不动新图');
}

/* ── ⑤ 拖动不产生独立历史 ────────────────────────────────────────── */
{
  let state = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  const stackAfterOp = state.undoStack.length;
  for (let i = 1; i <= 5; i += 1) {
    state = labUiStep('A3', state, { type: 'moveNode', nodeId: 'n-rs', x: 250 + i * 12, y: 270 });
    state = labUiStep('A3', state, { type: 'moveNodeEnd', before: skeleton() });
  }
  ok('⑤', state.undoStack.length === stackAfterOp, `⑤ 拖动产生了独立历史：栈 ${stackAfterOp} → ${state.undoStack.length}`);
  ok('⑤', state.graph.nodes.find((node) => node.id === 'n-rs').x !== 250, '⑤ 前置：最后一次拖动应已挪动位置');
  state = labUiStep('A3', state, { type: 'undo' });
  ok('⑤', state.graph.nodes.find((node) => node.id === 'n-rs').x === 250, '⑤ 撤一次没回到拖动前（撤成了多次或没撤）');
  ok('⑤', state.graph.nodes.some((node) => node.id === 'n-rc'), '⑤ 撤销没把删 Rc 回退掉（快照在删前，n-rc 应回来）');
  ok('⑤', state.undoStack.length === stackAfterOp - 1, `⑤ 撤销次数不对：栈 ${state.undoStack.length} ≠ ${stackAfterOp - 1}`);
  console.log('⑤  拖 5 次 + 撤 1 次：位置回到拖动前，栈里只有那一次结构操作');
}

/* ── ⑥ Delete 键与 🗑 等价 ───────────────────────────────────────── */
{
  // 两条路最终都派发同一个 deleteDevice op：核心级等价 = 同一图结果。
  const viaButton = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  const viaKey = labUiStep('A3', createUiState('A3', skeleton()), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rc' } });
  ok('⑥', graphJson(viaButton) === graphJson(viaKey), '⑥ 两条删除路的图结果不一致');
  ok('⑥', JSON.stringify(viaKey.preview.params) === JSON.stringify(viaButton.preview.params), '⑥ 两条删除路的 params 不一致');
  // 页面源码：Delete 键与 🗑 按钮都走 requestDeleteDevice（同一条路），并带撤销提示。
  const labSrc = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('⑥', /event\.key === 'Delete' \|\| event\.key === 'Backspace'/.test(labSrc) && /requestDeleteDevice\(selectedIds\[0\]\)/.test(labSrc), '⑥ Delete/Backspace 没走 requestDeleteDevice');
  ok('⑥', /onClick=\{\(\) => requestDeleteDevice\(device\.id\)\}/.test(labSrc), '⑥ 🗑 按钮没走 requestDeleteDevice（两条路分叉了）');
  ok('⑥', /已删除，可 Ctrl\+Z 撤销/.test(labSrc), '⑥ 删除后没给撤销提示');
  console.log('⑥  Delete 键 = 🗑：同一 requestDeleteDevice，同一图结果 + 撤销提示');
}

/* ── ⑦ W16 三个新 op 都进撤销栈 ──────────────────────────────────── */
{
  const skeletonA3 = skeleton();
  // ① setDeviceValue：改值 → 撤销 → value / label / params 逐字段回去
  let state = labUiStep('A3', createUiState('A3', skeletonA3), { type: 'op', op: { op: 'setDeviceValue', nodeId: 'n-rc', value: 4700 } });
  ok('⑦', state.undoStack.length === 1, '⑦ setDeviceValue 没进栈');
  state = labUiStep('A3', state, { type: 'undo' });
  const rc0 = state.graph.nodes.find((node) => node.id === 'n-rc');
  ok('⑦', rc0.value === 2000 && rc0.label === 'Rc 2.0k', `⑦ 撤销改值后没还原：value=${rc0.value} label=${rc0.label}`);
  ok('⑦', state.preview.params.Rc === 2000, '⑦ 撤销改值后 params.Rc 没回去');
  // ② rotateDevice：转 90° → 撤销 → rot 与导线端点逐字段回去
  const beforeRot = graphJson(createUiState('A3', skeletonA3));
  state = labUiStep('A3', createUiState('A3', skeletonA3), { type: 'op', op: { op: 'rotateDevice', nodeId: 'n-q', delta: 90 } });
  ok('⑦', state.undoStack.length === 1 && state.graph.nodes.find((node) => node.id === 'n-q').rot === 90, '⑦ rotateDevice 没进栈 / 没转');
  state = labUiStep('A3', state, { type: 'undo' });
  ok('⑦', graphJson(state) === beforeRot, '⑦ 撤销旋转后图没逐字段回去（rot 或导线端点留了残迹）');
  // ③ deleteEdge：删线 → 撤销 → 边回来（与 ㉕② 同源，这里查逐字段）
  state = labUiStep('A3', createUiState('A3', skeletonA3), { type: 'op', op: { op: 'deleteEdge', edgeId: 'e-c-bus' } });
  ok('⑦', state.undoStack.length === 1, '⑦ deleteEdge 没进栈');
  state = labUiStep('A3', state, { type: 'undo' });
  ok('⑦', graphJson(state) === beforeRot, '⑦ 撤销删线后图没逐字段回去（d-cbus / 回缩残迹）');
  console.log('⑦  改值 / 旋转 / 删线三 op：入栈、撤销逐字段还原');
}

/* ── ⑧ W17-A：删即合并的撤销 —— 快照含合并后的图，撤销回到删之前 ── */
{
  const base = createUiState('A3', skeleton());
  const before = { graph: graphJson(base), rules: JSON.stringify(base.rules), params: JSON.stringify(base.preview.params) };
  // ① 删 Rs（合并）→ 撤销 → 逐字段回到「删之前」的连通状态（不是「删了没合并」）
  let state = labUiStep('A3', base, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });
  ok('⑧', state.graph.edges.some((edge) => edge.id.startsWith('e-heal')) && state.preview.params.Rs === 0, '⑧ 删 Rs 没触发合并（前置失败）');
  ok('⑧', state.graph.meta.healedSeries !== undefined, '⑧ 合并标记（meta.healedSeries）没写进图');
  state = labUiStep('A3', state, { type: 'undo' });
  ok('⑧', graphJson(state) === before.graph, '⑧ 撤销合并删除后图没逐字段回到删前（合并导线或 meta 残留）');
  ok('⑧', JSON.stringify(state.rules) === before.rules && JSON.stringify(state.preview.params) === before.params, '⑧ 撤销后 rules / params 没逐字段回去');
  ok('⑧', !('healedSeries' in state.graph.meta), '⑧ 撤销后 meta.healedSeries 还在（回的是「删了没合并」的中间态）');
  console.log('⑧  删 Rs（合并）→ 撤销：图 / rules / params / meta.healedSeries 逐字段回删前');

  // ② 混合：删 Rs（合并）→ 删 Rl → 连撤两次 → 逐字段还原；再重做两次 → 合并态回来
  const st2 = labUiStep('A3', base, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });
  const st3 = labUiStep('A3', st2, { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rl' } });
  ok('⑧', st3.graph.edges.some((edge) => edge.id.startsWith('e-heal')) && !st3.graph.nodes.some((node) => node.id === 'n-rl'), '⑧ 混合序列前置失败');
  let back = labUiStep('A3', st3, { type: 'undo' });
  back = labUiStep('A3', back, { type: 'undo' });
  ok('⑧', graphJson(back) === before.graph && JSON.stringify(back.rules) === before.rules, '⑧ 混合撤销两次后没逐字段还原');
  ok('⑧', !('healedSeries' in back.graph.meta), '⑧ 混合撤销后 meta 残留');
  let redo = labUiStep('A3', back, { type: 'redo' });
  redo = labUiStep('A3', redo, { type: 'redo' });
  ok('⑧', redo.graph.edges.some((edge) => edge.id.startsWith('e-heal')) && redo.preview.params.Rs === 0 && !redo.graph.nodes.some((node) => node.id === 'n-rl'), '⑧ 重做两次没回到合并态');
  console.log('⑧  删 Rs（合并）+ 删 Rl 混合：连撤两次逐字段还原，重做两次回到合并态');
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（撤销重做：删/撤/重做逐字段 / 栈深 30 / 换题型清空 / 拖动不产生历史 / Delete 等价 / W16 三 op 撤销 / W17 合并撤销 / 两条变异）`);
