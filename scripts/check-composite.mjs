/**
 * check:composite —— W13 复合器件的 8 条门禁 + 3 条变异。
 *
 *  ① 展开幂等：展开一次与展开两次结果逐字段相等
 *  ② 参数不变：分压器摊开成 R1+R2 后 reduce().params 逐键相等（≤1e-12），
 *     且端口端点与内层引脚重合（合并节点，不是新建节点）
 *  ③ 缺 modelSpec → U + missingModelSpec
 *  ④ 缺夹具   → U + missingGoldenCase
 *  ⑤ 白名单外 → U + compositeOffWhitelist（A3 里塞 opamp）
 *  ⑥ 3 层嵌套 → problems 出现「超过 2 层」+ 整图 U
 *  ⑦ 分享携带：?g= 含 defs 且接收端能还原同一张图（深比较相等）
 *  ⑧ 悬空端口只警告不阻断：problems 有一条，tier 仍是 F
 *
 * 变异（每条必须 exit 1）：
 *  - 变异一：端口合并写成"新建节点"（mergePorts=false）→ ② 红；
 *  - 变异二：删掉 modelSpec 校验（enforceModelSpec=false）→ ③ 红；
 *  - 变异三：分享时去掉 defs（shareDefs=false）→ ⑦ 红。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';
import { createUiState, labUiStep } from '../src/core/lab/ui.ts';
import { reduce } from '../src/core/lab/reduce.ts';
import { buildNets, netSolve } from '../src/core/lab/netSolve.ts';
import { BUILTIN_COMPOSITES } from '../src/core/lab/compositeBuiltin.ts';
import {
  COMPOSITE_CONFIG,
  WARNING_PREFIX,
  countComposites,
  decodeSharePayload,
  encodeSharePayload,
  expandComposites,
  portPins,
  registerComposites,
  usedCompositeDefs,
} from '../src/core/lab/composite.ts';
import { forgetComposites } from '../src/core/lab/compositeStore.ts';

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

const a3Snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8'));
const a3Spec = a3Snap.render_specs[0];
const a3Skeleton = () => freshSkeleton('A3', a3Spec);

forgetComposites();

/* ── 复合图夹具：A3 骨架 + 一块分压器（Vin 接 Vs 正极，Vout / GND 悬空） ── */
const DEF_DIVIDER = BUILTIN_COMPOSITES['cmp-divider'];

function compositeGraph(blockId = 'n-cmp1', pos = [200, 150], wires = [['Vin', 'n-vs:p', [160, 336]]]) {
  const base = a3Skeleton();
  const block = { id: blockId, x: pos[0], y: pos[1], kind: 'block', label: DEF_DIVIDER.title, compositeId: DEF_DIVIDER.id };
  const pins = portPins(DEF_DIVIDER);
  const edges = wires.map(([portId, toKey, toXY], index) => {
    const pin = pins.find((one) => one.id === portId);
    return { id: `e-cmpw-${index}`, from: `${blockId}:${portId}`, to: toKey, kind: 'wire', points: [[pos[0] + pin.x, pos[1] + pin.y], toXY] };
  });
  return { ...base, nodes: [...base.nodes, block], edges: [...base.edges, ...edges] };
}

/* ── ① 展开幂等 ────────────────────────────────────────────────── */
{
  const g = compositeGraph();
  const once = expandComposites(g);
  const twice = expandComposites(once.graph);
  ok('①', JSON.stringify(once.graph) === JSON.stringify(twice.graph), '① 展开两次与展开一次不逐字段相等');
  ok('①', once.expanded.length === 1 && twice.expanded.length === 0, `① expanded 记录不对：${once.expanded.length}/${twice.expanded.length}`);
  console.log('①  展开幂等：摊开一次 = 摊开两次（逐字段相等），expanded 只记一次');
}

/* ── ② 参数不变 + 端口合并坐标 ─────────────────────────────────── */
{
  const g = compositeGraph();
  const blockParams = reduce('A3', g).params;
  const plainParams = reduce('A3', a3Skeleton()).params;
  const keys = Object.keys(plainParams);
  ok('②', Object.keys(blockParams).length === keys.length, `② 摊开后 params 键数变了：${Object.keys(blockParams).length} ≠ ${keys.length}`);
  for (const key of keys) {
    ok('②', typeof plainParams[key] === 'number' ? rel(blockParams[key], plainParams[key]) <= 1e-12 : blockParams[key] === plainParams[key], `② 摊开后 ${key}=${blockParams[key]} ≠ ${plainParams[key]}`);
  }
  // 端口合并：外层导线端点必须精确落在内层 R1 的 a 引脚上（0.6 内），不是新建节点。
  const out = expandComposites(g);
  const wire = out.graph.edges.find((edge) => edge.id === 'e-cmpw-0');
  const r1 = out.graph.nodes.find((node) => node.id === 'cmp/cmp-divider/R1');
  ok('②', Boolean(wire && r1), '② 摊开后找不到导线 / 内层 R1');
  if (wire && r1) {
    const pinA = [r1.x, r1.y - 44];
    const head = wire.points[0];
    ok('②', Math.hypot(head[0] - pinA[0], head[1] - pinA[1]) <= 0.6, `② 端口端点 (${head}) 没合并到内层 R1:a (${pinA}) —— 像是新建了节点`);
  }
  // 手工摊开对照：把块换成内层器件再归约，params 必须逐键相等
  const manual = a3Skeleton();
  const dx = 200;
  const dy = 150;
  manual.nodes = [
    ...manual.nodes,
    ...DEF_DIVIDER.inner.nodes.map((node) => ({ ...node, id: `cmp/cmp-divider/${node.id}`, x: node.x + dx, y: node.y + dy })),
  ];
  manual.edges = [
    ...manual.edges,
    ...DEF_DIVIDER.inner.edges.map((edge) => ({
      ...edge,
      id: `cmp/cmp-divider/${edge.id}`,
      from: `cmp/cmp-divider/${edge.from}`,
      to: `cmp/cmp-divider/${edge.to}`,
      ...(edge.points ? { points: edge.points.map(([px, py]) => [px + dx, py + dy]) } : {}),
    })),
  ];
  const manualParams = reduce('A3', manual).params;
  for (const key of keys) {
    ok('②', typeof manualParams[key] === 'number' ? rel(manualParams[key], blockParams[key]) <= 1e-12 : manualParams[key] === blockParams[key], `② 手工摊开与块归约的 ${key} 不一致`);
  }
  console.log('②  分压器摊开：params 逐键相等（≤1e-12），端口端点与内层引脚重合（合并节点）');
}

/* ── ③④⑤ 硬闸门：缺 modelSpec / 缺夹具 / 白名单外 ─────────────── */
const badSpecDef = {
  ...DEF_DIVIDER,
  id: 'cmp-test-nospec',
  title: '缺声明的模块',
  modelSpec: { equations: [], applicableRange: '', units: {} },
};
const noGoldenDef = {
  ...DEF_DIVIDER,
  id: 'cmp-test-nogolden',
  title: '没夹具的模块',
  goldenRefs: [],
};
const offWhitelistDef = {
  ...DEF_DIVIDER,
  id: 'cmp-test-offwl',
  title: '夹带运放的模块',
  inner: {
    ...DEF_DIVIDER.inner,
    nodes: [...DEF_DIVIDER.inner.nodes, { id: 'u1', x: 0, y: 120, kind: 'opamp', label: 'U1' }],
  },
};
registerComposites([badSpecDef, noGoldenDef, offWhitelistDef]);

function gateExpect(defId, code) {
  const g = compositeGraph('n-cmpx', [200, 150], []);
  const withDef = { ...g, nodes: g.nodes.map((node) => (node.kind === 'block' ? { ...node, compositeId: defId } : node)) };
  const result = reduce('A3', withDef);
  const joined = result.problems.join('；');
  return { result, hasCode: joined.includes(code) };
}
{
  const { result, hasCode } = gateExpect(badSpecDef.id, 'missingModelSpec');
  ok('③', result.outOfScope && hasCode, `③ 缺 modelSpec 没判 U / 没写原因码：outOfScope=${result.outOfScope} ${result.problems.join('；')}`);
  const { result: r4, hasCode: c4 } = gateExpect(noGoldenDef.id, 'missingGoldenCase');
  ok('④', r4.outOfScope && c4, `④ 缺夹具没判 U / 没写原因码：${r4.problems.join('；')}`);
  const { result: r5, hasCode: c5 } = gateExpect(offWhitelistDef.id, 'compositeOffWhitelist');
  ok('⑤', r5.outOfScope && c5, `⑤ 白名单外没判 U / 没写原因码：${r5.problems.join('；')}`);
  console.log('③④⑤  硬闸门：missingModelSpec / missingGoldenCase / compositeOffWhitelist 全部判 U');
}

/* ── ⑥ 嵌套深度 ────────────────────────────────────────────────── */
{
  const innermost = { ...DEF_DIVIDER, id: 'cmp-l3-leaf', title: '第三层' };
  const mid = {
    ...DEF_DIVIDER,
    id: 'cmp-l3-mid',
    title: '第二层',
    inner: { nodes: [...DEF_DIVIDER.inner.nodes, { id: 'sub', x: 0, y: 130, kind: 'res', label: 'R5', value: 1000, compositeId: innermost.id }], edges: DEF_DIVIDER.inner.edges },
  };
  const top = { ...DEF_DIVIDER, id: 'cmp-l3-top', title: '第一层', inner: { nodes: [...DEF_DIVIDER.inner.nodes, { id: 'sub', x: 0, y: 130, kind: 'res', label: 'R4', value: 1000, compositeId: mid.id }], edges: DEF_DIVIDER.inner.edges } };
  registerComposites([innermost, mid, top]);
  const { result, hasCode } = gateExpect(top.id, '超过 2 层');
  ok('⑥', result.outOfScope && hasCode, `⑥ 3 层嵌套没判 U / 没提示：${result.problems.join('；')}`);
  console.log('⑥  3 层嵌套：「复合器件嵌套超过 2 层」→ 整图 U');
}

/* ── ⑦ 分享携带 defs ───────────────────────────────────────────── */
{
  const custom = { ...DEF_DIVIDER, id: 'cmp-share-test', title: '要分享的模块' };
  registerComposites([custom]);
  const g = compositeGraph('n-cmp2', [240, 160], []);
  const withCustom = { ...g, nodes: g.nodes.map((node) => (node.kind === 'block' ? { ...node, compositeId: custom.id } : node)) };
  const payload = { graph: withCustom, defs: usedCompositeDefs(withCustom) };
  ok('⑦', payload.defs.length === 1 && payload.defs[0].id === custom.id, `⑦ 分享没带（或带错）defs：${JSON.stringify(payload.defs.map((d) => d.id))}`);
  const encoded = encodeSharePayload(payload);
  const decoded = decodeSharePayload(encoded);
  ok('⑦', Boolean(decoded?.graph), '⑦ 分享链接解不出来');
  ok('⑦', JSON.stringify(decoded.graph) === JSON.stringify(withCustom), '⑦ 接收端还原的图与原图不深比较相等');
  ok('⑦', decoded.defs?.length === 1 && decoded.defs[0].id === custom.id, '⑦ 解出的 defs 丢了');
  // 接收端注册 defs 后能展开（不是"少了一块"）
  registerComposites(decoded.defs ?? []);
  const out = expandComposites(withCustom);
  ok('⑦', out.expanded.length === 1 && out.problems.length === 0, `⑦ 接收端展开失败：${out.problems.join('；')}`);
  const bytes = Buffer.byteLength(JSON.stringify(decoded.defs ?? []), 'utf8');
  console.log(`⑦  分享携带：defs 随 ?g= 走（本次 ${bytes} 字节），接收端深比较还原并成功展开`);
}

/* ── ⑧ 悬空端口只警告不阻断，tier 仍 F ─────────────────────────── */
{
  let state = createUiState('A3', compositeGraph());
  // 关键语义标全（复合器件不计分，判据只看原生器件）
  for (const [nodeId, tag] of [['n-rl', 'load'], ['n-rc', 'bias'], ['n-rs', 'coupling']]) {
    state = labUiStep('A3', state, { type: 'op', op: { op: 'setSemantic', nodeId, semantic: tag } });
  }
  state = labUiStep('A3', state, { type: 'solve' });
  const warnings = state.preview.problems.filter((p) => p.startsWith(WARNING_PREFIX));
  ok('⑧', warnings.length === 2, `⑧ 悬空端口警告应有 2 条（Vout / GND），实际 ${warnings.length}`);
  ok('⑧', state.preview.problems.every((p) => p.startsWith(WARNING_PREFIX) || false) || state.preview.problems.every((p) => WARNING_PREFIX.length === 0 || p.startsWith(WARNING_PREFIX)), '⑧ 不该混进硬问题');
  ok('⑧', state.verdict?.tier === 'F', `⑧ 悬空端口不该降档：tier=${state.verdict?.tier}`);
  ok('⑧', (state.verdict?.headline ?? '').includes('自定义模块'), `⑧ F 档徽章没写复合器件说明：${state.verdict?.headline}`);
  ok('⑧', countComposites(state.graph) === 1, '⑧ 复合器件计数不对');
  console.log(`⑧  悬空端口：2 条警告进 problems 不阻断，tier=${state.verdict?.tier}（${state.verdict?.headline}）`);
}

/* ── ⑨ 加餐：封装 → 摊开 → 收拢 → params 不变、图规模还原 ───────── */
{
  let state = createUiState('A3', a3Skeleton());
  const baseParams = JSON.stringify(reduce('A3', a3Skeleton()).params);
  state = labUiStep('A3', state, {
    type: 'op',
    op: {
      op: 'wrapComposite',
      // n-rc 的对外连线是横穿引脚画法（e-vcc-bar / e-cbus 端点不落引脚），
      // 封装如实拒绝 —— 这里用端点连接的 Vs + Rs 演示闭环。
      nodeIds: ['n-vs', 'n-rs'],
      title: '输入源级',
      ports: [
        { nodeId: 'n-vs', label: '输入' },
        { nodeId: 'n-rs', label: '输出' },
      ],
      modelSpec: { equations: ['源 + 输入耦合'], applicableRange: '直流、线性', units: { R: 'Ω', V: 'V' } },
      goldenRefs: ['A3'],
    },
  });
  ok('⑨', !state.note.startsWith('画布上没有') && state.graph.nodes.some((node) => node.compositeId), `⑨ 封装没生效：${state.note}`);
  ok('⑨', JSON.stringify(state.preview.params) === baseParams, '⑨ 封装后 params 变了');
  // 收拢后的图规模应回到「封装后」的规模（封装是 2 器件 → 1 块，净 -1 节点）。
  const wrappedNodes = state.graph.nodes.length;
  const wrappedEdges = state.graph.edges.length;
  const blockId = state.graph.nodes.find((node) => node.compositeId)?.id ?? '';
  state = labUiStep('A3', state, { type: 'op', op: { op: 'expandComposite', nodeId: blockId } });
  ok('⑨', state.graph.nodes.some((node) => node.id.startsWith('cmp/')), '⑨ 摊开没有内层前缀节点');
  const innerId = state.graph.nodes.find((node) => node.id.startsWith('cmp/'))?.id ?? '';
  state = labUiStep('A3', state, { type: 'op', op: { op: 'collapseComposite', nodeId: innerId } });
  ok('⑨', state.graph.nodes.length === wrappedNodes && state.graph.edges.length === wrappedEdges, `⑨ 收拢后图规模没还原：${state.graph.nodes.length}/${state.graph.edges.length} ≠ ${wrappedNodes}/${wrappedEdges}`);
  ok('⑨', state.graph.nodes.filter((node) => node.compositeId).length === 1, '⑨ 收拢后复合块没了或多了');
  ok('⑨', JSON.stringify(state.preview.params) === baseParams, '⑨ 收拢后 params 变了');
  console.log('⑨  封装 → 摊开 → 收拢：图规模还原，params 逐键不变');
}

/* ── ⑩⑪ F6：并联模块真并联（端口网非单链 + Req 隔离实测） ──────── */
{
  const DEF_PAR = BUILTIN_COMPOSITES['cmp-parallel'];

  /** 块电路：1V 测试源跨在 A/B 端口上，gnd 接源负端。端口引脚 A=(210,y) B=(310,y)。 */
  const parCircuit = (pos = [260, 260]) => {
    const [bx, by] = pos;
    const graph = {
      templateId: 'A3',
      family: 'circuit',
      nodes: [
        { id: 'n-vs', kind: 'vsrc', label: 'Vs', value: 1, x: bx, y: by - 220 },
        { id: 'n-par', x: bx, y: by, kind: 'block', label: DEF_PAR.title, compositeId: DEF_PAR.id },
        { id: 'n-gnd', kind: 'gnd', label: 'GND', x: bx + 140, y: by + 100 },
      ],
      edges: [
        // 源正 → 端口 A（末点落在端口引脚 (bx-50, by)，摊开时重写到内层 R3:a）
        { id: 'e-vs-a', from: 'n-vs:p', to: 'n-par:A', kind: 'wire', points: [[bx, by - 264], [bx - 120, by - 264], [bx - 120, by - 22], [bx - 50, by]] },
        // 端口 B → 源负（首点落在 (bx+50, by)，重写到 R3:b）
        { id: 'e-b-vs', from: 'n-par:B', to: 'n-vs:n', kind: 'wire', points: [[bx + 50, by], [bx + 120, by - 22], [bx + 120, by - 176], [bx, by - 176]] },
        // 源负 → 地
        { id: 'e-vs-g', from: 'n-vs:n', to: 'n-gnd:t', kind: 'wire', points: [[bx, by - 176], [bx + 200, by - 176], [bx + 200, by + 100], [bx + 140, by + 100]] },
      ],
      meta: {},
    };
    return graph;
  };

  // ⑩ 端口网：a 并 a、b 并 b、两网不同（单链 = R3.b 与 R4.a 同网）且各恰含 2 个引脚。
  {
    const bare = { templateId: 'A3', family: 'circuit', nodes: [{ id: 'n-par', x: 260, y: 260, kind: 'block', label: DEF_PAR.title, compositeId: DEF_PAR.id }], edges: [], meta: {} };
    const expanded = expandComposites(bare).graph;
    const build = buildNets(expanded);
    const pinNet = (inner, pin) => build.pins.find((one) => one.deviceId === `cmp/cmp-parallel/${inner}` && one.pinId === pin)?.net;
    const netA = pinNet('R3', 'a');
    const netB = pinNet('R3', 'b');
    ok('⑩', Boolean(netA && netB), '⑩ 摊开后 R3 引脚没进网');
    ok('⑩', netA !== undefined && netA === pinNet('R4', 'a'), '⑩ R4:a 不在 A 端口网 —— 不是并联');
    ok('⑩', netB !== undefined && netB === pinNet('R4', 'b'), '⑩ R4:b 不在 B 端口网 —— 不是并联');
    ok('⑩', netA !== netB, '⑩ 端口 A/B 同网 —— 单链短路（串联病灶还在）');
    ok(
      '⑩',
      build.pins.filter((one) => one.net === netA).length === 2 && build.pins.filter((one) => one.net === netB).length === 2,
      '⑩ 端口网引脚数 ≠ 2（端口网不是干净的两端网络）',
    );
    console.log('⑩  并联模块端口网：A 网含 R3:a+R4:a、B 网含 R3:b+R4:b，各 2 引脚、非单链');
  }

  // ⑪ Req 隔离实测：1V 测试源 → I = 1/Req，Req 必须 = R3∥R4 = 10 kΩ（相对 1e-9）。
  {
    const expanded = expandComposites(parCircuit()).graph;
    const solved = netSolve(expanded, { mode: 'dc' });
    ok('⑪', solved.ok, `⑪ 并联模块电路没解出来：${solved.ok ? '' : (solved.code ?? '')} ${solved.reason ?? ''}`);
    if (solved.ok) {
      const i = Math.abs(solved.solution.branchCurrents['n-vs'] ?? 0);
      const req = i > 0 ? 1 / i : Infinity;
      ok('⑪', rel(req, 10000) <= 1e-9, `⑪ Req 实测 ${req} ≠ R3∥R4=10000（±1e-9 相对）`);
      const r3i = Math.abs(solved.solution.branchCurrents['cmp/cmp-parallel/R3'] ?? 0);
      const r4i = Math.abs(solved.solution.branchCurrents['cmp/cmp-parallel/R4'] ?? 0);
      ok('⑪', rel(r3i, r4i) <= 1e-9 && rel(r3i + r4i, i) <= 1e-9, `⑪ 两支路分流不对：R3=${r3i} R4=${r4i} Σ=${r3i + r4i} ≠ I=${i}`);
      console.log(`⑪  Req 隔离实测：1V / I=${i.toExponential(4)} A → Req=${req} Ω = R3∥R4，两支路均分电流`);
    }
  }
}

/* ── 变异三条 ───────────────────────────────────────────────────── */
{
  ok('变异①', true);
  COMPOSITE_CONFIG.mergePorts = false;
  const g = compositeGraph();
  const out = expandComposites(g);
  const wire = out.graph.edges.find((edge) => edge.id === 'e-cmpw-0');
  const r1 = out.graph.nodes.find((node) => node.id === 'cmp/cmp-divider/R1');
  const merged = wire && r1 ? Math.hypot(wire.points[0][0] - (r1.x), wire.points[0][1] - (r1.y - 44)) <= 0.6 : false;
  ok('变异①', merged === false, '变异一：新建节点居然还合并坐标（门禁空转）');
  COMPOSITE_CONFIG.mergePorts = true;
  const restored = expandComposites(compositeGraph());
  const wire2 = restored.graph.edges.find((edge) => edge.id === 'e-cmpw-0');
  const r1b = restored.graph.nodes.find((node) => node.id === 'cmp/cmp-divider/R1');
  ok('变异①', wire2 && r1b && Math.hypot(wire2.points[0][0] - r1b.x, wire2.points[0][1] - (r1b.y - 44)) <= 0.6, '变异一还原后没回绿');
  console.log('变异一：mergePorts=false（端口新建节点不合并）→ ② 红；还原回绿');
}
{
  COMPOSITE_CONFIG.enforceModelSpec = false;
  const { result } = gateExpect(badSpecDef.id, 'missingModelSpec');
  ok('变异②', !(result.outOfScope && result.problems.join('').includes('missingModelSpec')), '变异二：删掉 modelSpec 校验居然还判 U（门禁空转）');
  COMPOSITE_CONFIG.enforceModelSpec = true;
  const back = gateExpect(badSpecDef.id, 'missingModelSpec');
  ok('变异②', back.result.outOfScope && back.hasCode, '变异二还原后没回绿');
  console.log('变异二：enforceModelSpec=false → ③ 红；还原回绿');
}
{
  COMPOSITE_CONFIG.shareDefs = false;
  const custom = { ...DEF_DIVIDER, id: 'cmp-share-mut', title: '变异用模块' };
  registerComposites([custom]);
  const g = compositeGraph('n-cmp2', [240, 160], []);
  const withCustom = { ...g, nodes: g.nodes.map((node) => (node.kind === 'block' ? { ...node, compositeId: custom.id } : node)) };
  const payload = { graph: withCustom, defs: usedCompositeDefs(withCustom) };
  ok('变异③', payload.defs.length === 0, '变异三：关掉 shareDefs 居然还带 defs（门禁空转）');
  COMPOSITE_CONFIG.shareDefs = true;
  const back = usedCompositeDefs(withCustom);
  ok('变异③', back.length === 1 && back[0].id === custom.id, '变异三还原后没回绿');
  console.log('变异三：shareDefs=false → ⑦ 红；还原回绿');
}

forgetComposites();

/* ── 汇总 ─────────────────────────────────────────────────────── */
if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（复合器件门禁：幂等 / params ≤1e-12 与端口合并 / 三条硬闸门 / 嵌套深度 / 分享带 defs / 悬空端口 F 档 / 封装收拢闭环 / 三条变异）`);
