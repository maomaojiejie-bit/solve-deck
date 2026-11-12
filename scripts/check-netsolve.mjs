/**
 * check:netsolve —— W15-S1 电路通用求解。六条验收 + 一条变异。
 *
 *  ① A3 默认骨架 → nodeVoltages['n-vo'] 与 Av = -45.53734061930782 一致（≤1e-12）
 *  ② A6 反相运放骨架 → -1.000000000 V（理想 nullor 两步法）
 *  ③ 分压（12V, R1=1k, R2=3k）→ Vout=9、I=3mA、功率守恒
 *  ④ 超纲例：电桥四臂各 1k + 中间 1k（题库没有这一型）→ 桥臂电流非零 + KCL <1e-12
 *  ⑤ 拒答例：删掉 gnd → noGround，且不给任何数字
 *  ⑥ 变异：把无地检查关掉 → ⑤ 红
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';
import { netSolve, buildNets, NETSOLVE_CONFIG, NET_AC_CONFIG } from '../src/core/lab/netSolve.ts';
import { OUTPUT_NET_CONFIG } from '../src/core/lab/measures.ts';
import { interpretQuestion } from '../src/core/lab/measures.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { anchorsOfNode } from '../src/core/lab/pins.ts';

/** gain measure 的数值行（没有 gain 卡 / 无 rows 返回 null）。 */
function measureOf(measures) {
  const gain = measures.find((measure) => measure.id === 'gain');
  if (!gain || gain.missing) return null;
  const value = gain.rows?.find((row) => row.label === 'Av')?.value;
  return typeof value === 'number' ? value : null;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const example = (id) => JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));

/* ── ① A3 骨架：Av 逐位一致 ─────────────────────────────────────── */
{
  const graph = freshSkeleton('A3', example('A3').render_specs[0]);
  const outcome = netSolve(graph, { vsrcValues: { 'n-vs': 1 } });
  ok('①', outcome.ok, `① A3 被拒：${outcome.ok ? '' : outcome.reason}`);
  if (outcome.ok) {
    const vo = outcome.solution.nodeVoltages['n-vo'];
    ok('①', Math.abs(vo - -45.53734061930782) <= 1e-12, `① nodeVoltages['n-vo']=${vo} ≠ -45.53734061930782`);
    // Av 与测试源取值无关：换 2V 源，比值不变
    const scaled = netSolve(graph, { vsrcValues: { 'n-vs': 2 } });
    ok('①', scaled.ok && Math.abs(scaled.solution.nodeVoltages['n-vo'] / 2 - vo) <= 1e-12, '① Av 不是比值不变的（线性坏了）');
    ok('①', outcome.solution.residual.kclMax < 1e-12, `① KCL 残差 ${outcome.solution.residual.kclMax} 超差`);
    console.log(`①  A3 骨架：nodeVoltages['n-vo'] = ${vo}（与手搭 MNA 和文档常数逐位一致），KCL ${outcome.solution.residual.kclMax.toExponential(2)}`);
  }
}

/* ── ② A6 反相运放：理想 nullor 两步法 ──────────────────────────── */
{
  const graph = freshSkeleton('A6', example('A6').render_specs[0]);
  const outcome = netSolve(graph, {});
  ok('②', outcome.ok, `② A6 被拒：${outcome.ok ? '' : outcome.reason}`);
  if (outcome.ok) {
    const vo = outcome.solution.nodeVoltages['n-vo'];
    ok('②', Math.abs(vo - -1) <= 1e-12, `② A6 输出 ${vo} ≠ -1.000000000`);
    ok('②', outcome.solution.residual.kclMax < 1e-12, `② KCL 残差 ${outcome.solution.residual.kclMax} 超差`);
    console.log(`②  A6 反相运放：Vout = ${vo}（理想 nullor 两步法精确），KCL ${outcome.solution.residual.kclMax.toExponential(2)}`);
  }
}

/* ── ③ 分压器：合成图 ───────────────────────────────────────────── */
/** 合成一张最小画布图：器件 pin 坐标 + 折线边（全部落点吸附）。 */
function dividerGraph() {
  const nodes = [
    { id: 'n-v', x: 0, y: 100, kind: 'vsrc', label: 'Vs 12V', value: 12 },
    { id: 'n-r1', x: 100, y: 56, kind: 'res', label: 'R1 1k', value: 1000 },
    { id: 'n-r2', x: 260, y: 56, kind: 'res', label: 'R2 3k', value: 3000 },
    { id: 'n-gnd', x: 180, y: 144, kind: 'gnd', label: '' },
  ];
  const edges = [
    { id: 'e1', from: '0,56', to: '56,56', kind: 'wire', points: [[0, 56], [56, 56]] },
    { id: 'e2', from: '144,56', to: '216,56', kind: 'wire', points: [[144, 56], [216, 56]], tag: 'Vout' },
    { id: 'e3', from: '304,56', to: '180,144', kind: 'wire', points: [[304, 56], [304, 144], [180, 144]] },
    { id: 'e4', from: '0,144', to: '180,144', kind: 'wire', points: [[0, 144], [180, 144]] },
  ];
  return { templateId: 'divider', family: 'circuit', nodes, edges, meta: {} };
}
{
  const outcome = netSolve(dividerGraph(), {});
  ok('③', outcome.ok, `③ 分压被拒：${outcome.ok ? '' : outcome.reason}`);
  if (outcome.ok) {
    const solution = outcome.solution;
    const vout = solution.nodeVoltages['n-vout'];
    ok('③', Math.abs(vout - 9) <= 1e-12, `③ Vout=${vout} ≠ 9`);
    const i1 = solution.branchCurrents['n-r1'];
    ok('③', Math.abs(i1 - 0.003) <= 1e-12, `③ I(R1)=${i1} ≠ 3mA`);
    const powerSum = Object.values(solution.powers).reduce((sum, value) => sum + value, 0);
    ok('③', Math.abs(powerSum) < 1e-12, `③ 功率不守恒：Σ=${powerSum}`);
    console.log(`③  分压 12V/1k/3k：Vout=${vout}，I=${(i1 * 1e3).toFixed(6)} mA，Σ|P|=${powerSum.toExponential(2)}（守恒）`);
  }
}

/* ── ④ 超纲例：平衡电桥（题库没有这一型） ───────────────────────── */
function bridgeGraph() {
  // 标准惠斯通电桥：A=top rail(12V)、B=bottom rail(GND)、C/D 左右中点、R5 跨 C–D。
  const nodes = [
    { id: 'n-v', x: 0, y: 100, kind: 'vsrc', label: 'Vs 12V', value: 12 },
    { id: 'n-r1', x: 100, y: 50, kind: 'res', rot: 90, label: 'R1 1k', value: 1000 },
    { id: 'n-r3', x: 100, y: 150, kind: 'res', rot: 90, label: 'R3 1k', value: 1000 },
    { id: 'n-r2', x: 300, y: 50, kind: 'res', rot: 90, label: 'R2 1k', value: 1000 },
    { id: 'n-r4', x: 300, y: 150, kind: 'res', rot: 90, label: 'R4 1k', value: 1000 },
    { id: 'n-r5', x: 200, y: 100, kind: 'res', label: 'R5 1k', value: 1000 },
    { id: 'n-gnd', x: 150, y: 240, kind: 'gnd', label: '' },
  ];
  const edges = [
    { id: 'e-top', from: '0,56', to: '344,0', kind: 'wire', points: [[0, 56], [0, 0], [344, 0]] },
    { id: 'e-bot', from: '0,144', to: '344,200', kind: 'wire', points: [[0, 144], [0, 200], [344, 200]] },
    { id: 'e-t1', from: '100,0', to: '100,6', kind: 'wire', points: [[100, 0], [100, 6]] },
    { id: 'e-t2', from: '300,0', to: '300,6', kind: 'wire', points: [[300, 0], [300, 6]] },
    { id: 'e-b3', from: '100,194', to: '100,200', kind: 'wire', points: [[100, 194], [100, 200]] },
    { id: 'e-b4', from: '300,194', to: '300,200', kind: 'wire', points: [[300, 194], [300, 200]] },
    { id: 'e-c', from: '100,94', to: '156,100', kind: 'wire', points: [[100, 94], [100, 106], [156, 100]] },
    { id: 'e-d', from: '300,94', to: '244,100', kind: 'wire', points: [[300, 94], [300, 106], [244, 100]] },
    { id: 'e-g', from: '150,240', to: '150,200', kind: 'wire', points: [[150, 240], [150, 200]] },
  ];
  return { templateId: 'bridge', family: 'circuit', nodes, edges, meta: {} };
}
{
  const outcome = netSolve(bridgeGraph(), {});
  ok('④', outcome.ok, `④ 电桥被拒（超纲例必须能解）：${outcome.ok ? '' : outcome.reason}`);
  if (outcome.ok) {
    const solution = outcome.solution;
    const arms = ['n-r1', 'n-r2', 'n-r3', 'n-r4'].map((id) => solution.branchCurrents[id]);
    ok('④', arms.every((current) => Math.abs(current) > 1e-6), `④ 桥臂电流有零：${arms.join(', ')}`);
    const mid = solution.branchCurrents['n-r5'];
    ok('④', Math.abs(mid) <= 1e-12, `④ 中间 1k 电流 ${mid}：四臂相等的平衡电桥应为 0`);
    ok('④', solution.residual.kclMax < 1e-12, `④ KCL 残差 ${solution.residual.kclMax} 超差`);
    console.log(`④  平衡电桥 12V：桥臂电流 ${arms.map((a) => (a * 1e3).toFixed(3)).join(' / ')} mA（全非零），中间 1k 电流 = ${mid}（平衡 → 0 是物理事实）`);
  }
}

/* ── ⑤ 拒答例：删掉 gnd → noGround，且不给数字 ──────────────────── */
{
  const graph = freshSkeleton('A3', example('A3').render_specs[0]);
  const noGround = { ...graph, nodes: graph.nodes.filter((node) => node.id !== 'n-gnd') };
  const outcome = netSolve(noGround, { vsrcValues: { 'n-vs': 1 } });
  ok('⑤', !outcome.ok && outcome.code === 'noGround', `⑤ 删 gnd 后应拒 noGround，实际：${outcome.ok ? '居然解了' : outcome.code}`);
  ok('⑤', !outcome.ok && outcome.reason.includes('接地'), `⑤ 拒答原因要给人话：${outcome.ok ? '' : outcome.reason}`);
  ok('⑤', !outcome.ok && !('solution' in outcome), '⑤ 拒答还带了解（页面会给数字）');
  console.log(`⑤  删 gnd → noGround：「${outcome.ok ? '' : outcome.reason.slice(0, 40)}…」，无数字`);

  // ⑥ 变异：关掉无地检查 → ⑤ 红
  NETSOLVE_CONFIG.checkGround = false;
  const mutated = netSolve(noGround, { vsrcValues: { 'n-vs': 1 } });
  ok('⑤', !(mutated.ok && mutated.code === 'noGround') && (mutated.ok || mutated.code !== 'noGround'), '⑤ 变异（关无地检查）没被拦下（门禁空转）');
  NETSOLVE_CONFIG.checkGround = true;
  const restored = netSolve(noGround, { vsrcValues: { 'n-vs': 1 } });
  ok('⑤', !restored.ok && restored.code === 'noGround', '⑤ 还原后没回绿');
  console.log('⑤  变异：checkGround=false → ⑤ 红（不再以 noGround 拒答）；还原回绿');
}

/* ── ⑦ 红线：netSolve 不得 import 模板文件（mna.ts 的 solveMNA 是唯一例外） ── */
{
  const netSolveSrc = readFileSync(join(root, 'src', 'core', 'lab', 'netSolve.ts'), 'utf8');
  const badImports = (source) =>
    [...source.matchAll(/from '([^']+)'/g)]
      .map((match) => match[1])
      .filter((path) => path.includes('templates') && !path.endsWith('mna.ts'));
  ok('⑦', badImports(netSolveSrc).length === 0, `⑦ netSolve 拖进了模板文件：${badImports(netSolveSrc).join(', ')}`);
  // 变异：假想有人 import A3.ts 复用公式 → 白名单必须报红（在内存里验，不碰源文件）
  const mutatedSrc = `${netSolveSrc}\nimport { solveA3 } from '../templates/analog/A3.ts';\n`;
  ok('⑦', badImports(mutatedSrc).length > 0, '⑦ import 变异没被拦下（门禁空转）');
  console.log('⑦  红线：netSolve 只 import mna.ts（solveMNA），零模板文件；变异（import A3.ts）验红（内存中，不碰源文件）');
}

/* ── ⑧ W22-B：同图 dc 与 ac 增益必须不同（ac 退回 dc = 变异红） ── */
{
  const graph = freshSkeleton('A5', example('A5').render_specs[0]);
  // 加 C1：输出网（Rd 上端）对地 —— ac 口径下 C 短路把输出并到地。
  const vs = graph.nodes.find((node) => node.kind === 'vsrc');
  const rd = graph.nodes.find((node) => (node.label ?? '').startsWith('Rd'));
  let wired = applyOp('A5', graph, { op: 'addDevice', kind: 'cap', label: 'C1', value: 1e-9, x: 620, y: 300 }).graph;
  const cap = wired.nodes.find((node) => node.kind === 'cap');
  const gndPin = buildNets(graph).pins.find((pin) => pin.deviceId === 'n-gnd')?.pinId;
  wired = applyOp('A5', wired, { op: 'addEdge', from: `${cap.id}:a`, to: `${rd.id}:b` }).graph;
  wired = applyOp('A5', wired, { op: 'addEdge', from: `${cap.id}:b`, to: `n-gnd:${gndPin}` }).graph;
  const opts = { mode: 'dc', vsrcValues: { [vs.id]: 12 } };
  const dc = netSolve(wired, opts);
  const ac = netSolve(wired, { ...opts, mode: 'ac' });
  ok('⑧', dc.ok && ac.ok, `⑧ dc / ac 有一边被拒：${dc.ok ? '' : dc.reason} ${ac.ok ? '' : ac.reason}`);
  if (dc.ok && ac.ok) {
    const dcGain = measureOf(interpretQuestion(wired, 'circuit', { circuit: dc.solution }));
    const acGain = measureOf(interpretQuestion(wired, 'circuit', { circuit: ac.solution }));
    ok('⑧', dcGain !== null && acGain !== null, '⑧ dc / ac 至少一边没有 gain measure');
    if (dcGain !== null && acGain !== null) {
      ok('⑧', Math.abs(dcGain - acGain) > 1e-9, `⑧ dc 增益 ${dcGain} 与 ac 增益 ${acGain} 竟相同（口径没生效）`);
      // 变异：honorMode 关掉 = ac 退回 dc → 两个增益必须相同 → 本条红。
      const saved = NET_AC_CONFIG.honorMode;
      NET_AC_CONFIG.honorMode = false;
      const regressed = netSolve(wired, { ...opts, mode: 'ac' });
      const regressedGain = regressed.ok ? measureOf(interpretQuestion(wired, 'circuit', { circuit: regressed.solution })) : null;
      ok('⑧', regressedGain !== null && Math.abs(dcGain - regressedGain) <= 1e-9, '⑧ honorMode 变异后 ac 竟没退回 dc（变异没生效）');
      NET_AC_CONFIG.honorMode = saved;
    }
    console.log(`⑧  同图两口径：dc Av=${dcGain?.toFixed(4)} vs ac Av=${acGain?.toFixed(4)}（C 短路把输出并到地）；变异 honorMode=false 验红还原`);
  }
}

/* ── ⑨ W22-B：命名网优先于 |v|max（preferNamedNet 变异红） ────── */
{
  // 手工图：12V 与 1V 两个源。1V 源是「信号源」（|V|≤1 触发 gain），它的分压中点
  // tag=Vo（0.75V）；10V 源直挂电阻造一个更大的非输入网（10V）——
  // preferNamedNet=true 时输出必须取 n-vo（0.75），退回 |v|max 会抓 10V 网。
  const gndT = 'n-g:t';
  const graph = {
    templateId: 'A5',
    family: 'circuit',
    nodes: [
      { id: 'n-vs', kind: 'vsrc', label: 'Vs', value: 1, x: 100, y: 100 },
      { id: 'n-r1', kind: 'res', label: 'R1', value: 1000, x: 250, y: 100 },
      { id: 'n-r2', kind: 'res', label: 'R2', value: 3000, x: 400, y: 100 },
      { id: 'n-v2', kind: 'vsrc', label: 'V2', value: 10, x: 100, y: 300 },
      { id: 'n-r3', kind: 'res', label: 'R3', value: 1000, x: 250, y: 300 },
      { id: 'n-g', kind: 'gnd', label: 'GND', x: 470, y: 470 },
    ],
    edges: [
      { id: 'e-vs-r1', from: 'n-vs:p', to: 'n-r1:a', kind: 'wire', points: [[144, 89], [206, 89]] },
      { id: 'e-vs-g', from: 'n-vs:n', to: gndT, kind: 'wire', points: [[100, 111], [100, 470], [470, 470]] },
      { id: 'e-r1-r2', from: 'n-r1:b', to: 'n-r2:a', kind: 'wire', tag: 'Vo', points: [[294, 89], [366, 89]] },
      { id: 'e-r2-g', from: 'n-r2:b', to: gndT, kind: 'wire', points: [[444, 89], [470, 89], [470, 470]] },
      { id: 'e-v2-r3', from: 'n-v2:p', to: 'n-r3:a', kind: 'wire', points: [[144, 289], [206, 289]] },
      { id: 'e-r3-g', from: 'n-r3:b', to: gndT, kind: 'wire', points: [[294, 289], [470, 289], [470, 470]] },
      { id: 'e-v2-g', from: 'n-v2:n', to: gndT, kind: 'wire', points: [[100, 111], [100, 470], [470, 470]] },
    ],
    meta: {},
  };
  // 引脚坐标从符号表取真值（导线端点必须精确落引脚，穿 body 检查才不误伤）。
  const anchorOf = (key) => {
    const cut = key.indexOf(':');
    const node = graph.nodes.find((item) => item.id === key.slice(0, cut));
    const pinId = key.slice(cut + 1);
    const anchors = anchorsOfNode(node, 'circuit');
    const hit = anchors.find((anchor) => anchor.key.split(':').pop() === pinId);
    return [hit.x, hit.y];
  };
  for (const edge of graph.edges) {
    edge.points = [anchorOf(edge.from), anchorOf(edge.to)];
  }
  const outcome = netSolve(graph, { mode: 'ac' });
  ok('⑨', outcome.ok, `⑨ 分压图被拒：${outcome.ok ? '' : outcome.reason}`);
  if (outcome.ok) {
    ok('⑨', Math.abs(outcome.solution.nodeVoltages['n-vo'] - 0.75) <= 1e-9, `⑨ n-vo=${outcome.solution.nodeVoltages['n-vo']} ≠ 0.75（1V × 3k/4k）`);
    const gain = measureOf(interpretQuestion(graph, 'circuit', { circuit: outcome.solution }));
    ok('⑨', gain !== null, '⑨ 1V 信号源没触发 gain measure');
    if (gain !== null) {
      ok('⑨', Math.abs(gain - 0.75) <= 1e-9, `⑨ gain=${gain} ≠ 0.75（命名网没优先）`);
      const saved = OUTPUT_NET_CONFIG.preferNamedNet;
      OUTPUT_NET_CONFIG.preferNamedNet = false;
      const regressed = measureOf(interpretQuestion(graph, 'circuit', { circuit: outcome.solution }));
      ok('⑨', regressed === null || Math.abs(regressed - gain) > 1e-9, '⑨ preferNamedNet 变异后输出网没变（变异没生效）');
      OUTPUT_NET_CONFIG.preferNamedNet = saved;
    }
    console.log(`⑨  命名网优先：tag=Vo → gain=${gain}（0.75，不是 10V 大网）；变异 preferNamedNet=false 验红还原`);
  }
}

/* ── ⑩ W22-B：导线穿过器件本体 → bodyCross 拒答 ──────────────── */
{
  const graph = freshSkeleton('A5', example('A5').render_specs[0]);
  const rd = graph.nodes.find((node) => (node.label ?? '').startsWith('Rd'));
  const crossed = {
    ...graph,
    edges: [
      ...graph.edges,
      { id: 'e-cross', from: 'x:p', to: 'y:n', kind: 'wire', points: [[rd.x - 80, rd.y], [rd.x + 80, rd.y]], owner: 'shared' },
    ],
  };
  const outcome = netSolve(crossed, { mode: 'ac' });
  ok('⑩', !outcome.ok && outcome.code === 'bodyCross', `⑩ 穿 body 竟没拒：${outcome.ok ? '解出来了' : outcome.code}`);
  ok('⑩', !outcome.ok && /穿/.test(outcome.reason), '⑩ 拒答文案没说「穿」');
  console.log(`⑩  穿 body 拒答：bodyCross「${outcome.ok ? '' : outcome.reason.slice(0, 36)}…」`);
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（通用电路求解：A3 逐位 / A6 理想运放 / 分压守恒 / 平衡电桥超纲例 / noGround 拒答 / 一条变异 / dc-ac 口径 / 命名网 / 穿 body）`);
