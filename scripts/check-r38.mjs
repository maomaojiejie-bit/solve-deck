/**
 * check:r38 — 用户反馈五问的防回归门禁。
 *
 * ① 双标题 / 重复参数面板：嵌入讲解稿降级成小条、不再挂第二份面板
 * ② 理想运放模型前提：A6 明确写清「供电轨无限 / 不判断饱和」，逼近摆幅要点名
 * ③ 杆折角 / 载荷丢 t：沿构件方向投影（水平杆逐字兼容）、非水平构件如实提示
 * ④ 滑杆节流：连续拖动不再逐次触发归约
 * ⑤ 参数来源：确认栏注明题面参数不随画布载荷变化
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadT } from '../src/core/lab/picks.ts';
import { slantedMembers, slantedMemberNote } from '../src/core/lab/geometry.ts';
import { modelCaveatFor, OPAMP_RAIL_HINT } from '../src/core/modelCaveats.ts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
let checks = 0;
const problems = [];
function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} ${detail}`);
}

const beamGraph = (bx, by, lx, ly) => ({
  family: 'beam',
  nodes: [
    { id: 'a', x: 0, y: 0, kind: 'dot' },
    { id: 'b', x: bx, y: by, kind: 'dot' },
    { id: 'L', x: lx, y: ly, kind: 'arrow', atMember: 'e', value: 20 },
  ],
  edges: [{ id: 'e', from: 'a', to: 'b', kind: 'beam' }],
  meta: {},
});

/* ③ 载荷 t 沿构件方向 ─────────────────────────────────────────── */
const flat = beamGraph(100, 0, 25, 0);
ok('③', loadT(flat, flat.nodes[2]) === 0.25, '水平杆 t=0.25（与改动前逐字一致）');
const upright = beamGraph(0, 100, 0, 25);
ok('③', loadT(upright, upright.nodes[2]) === 0.25, '竖直杆也能求出 t=0.25（原来返回 null）');
const diagonal = beamGraph(100, 100, 50, 50);
ok('③', Math.abs((loadT(diagonal, diagonal.nodes[2]) ?? -1) - 0.5) < 1e-9, '斜杆投影 t=0.5');
const zeroLength = beamGraph(0, 0, 0, 0);
ok('③', loadT(zeroLength, zeroLength.nodes[2]) === null, '零长杆不编 t');
const beyond = beamGraph(100, 0, 200, 0);
ok('③', loadT(beyond, beyond.nodes[2]) === 1, '越界夹到 1');

/* ③ 非水平构件提示 ─────────────────────────────────────────────── */
ok('③', slantedMembers(flat).length === 0, '水平梁不算斜杆');
ok('③', slantedMemberNote(flat) === null, '水平梁不提示');
const uprightNote = slantedMemberNote(upright);
ok('③', Boolean(uprightNote) && uprightNote.includes('水平梁') && uprightNote.includes('e'), '竖直杆点名并说明模型边界');
ok('③', slantedMembers(beamGraph(100, 100, 0, 0)).length === 1, '斜杆被识别');
const circuit = { ...upright, family: 'circuit' };
ok('③', slantedMemberNote(circuit) === null, '电路族不误报');

/* ② 模型前提 ───────────────────────────────────────────────────── */
const small = modelCaveatFor('A6', { Vout: -1 });
ok('②', small && small.title.includes('理想运放') && small.body.includes('供电轨'), 'A6 写明模型前提');
ok('②', small && small.body.includes('不判断饱和'), 'A6 写明不判断饱和');
ok('②', small && small.warning === undefined, '小输出不误报削波');
const large = modelCaveatFor('A6', { Vout: 20 });
ok('②', Boolean(large?.warning) && large.warning.includes('饱和'), `|Vout| > ${OPAMP_RAIL_HINT} 时点名饱和`);
ok('②', modelCaveatFor('A1', { Vout: 20 }) === null, '非运放题不挂这条说明');
ok('②', modelCaveatFor('A6')?.warning === undefined, '无结果时不编数值警告');

/* ①④⑤ 源码哨兵 ───────────────────────────────────────────────── */
const result = read('src/pages/Result.tsx');
const lab = read('src/pages/Lab.tsx');
const panel = read('src/ui/ParamPanel.tsx');
const reduce = read('src/core/lab/reduce.ts');
const model = read('src/core/lab/graphToModel.ts');
ok('①', result.includes('const embedded = Boolean(override)'), '嵌入态有显式标志');
ok('①', result.includes("embedded ? 'sticky") === false && result.includes("embedded ? 'border-t border-line' : 'sticky top-0'"), '嵌入态不再 sticky');
ok('①', result.includes("embedded ? '分步推导与讲解' : displayTitle"), '嵌入态标题不重复题型全名');
ok('①', result.includes('embedded-param-note'), '嵌入态不再挂第二份参数面板');
ok('①', result.includes('canLab && !embedded'), '嵌入态不重复「改结构」入口');
ok('②', result.includes('model-caveat') && result.includes('modelCaveatFor'), '模型前提接在结果页');
ok('③', lab.includes('slanted-member-note') && lab.includes('slantedMemberNote'), '非水平构件提示接在装配台');
ok('③', reduce.includes('a.y + load.t * (b.y - a.y)'), 'y 沿杆插值');
ok('③', model.includes('const len2 = dx * dx + dy * dy'), 'graphToModel 也用投影');
ok('④', panel.includes('throttledChange') && panel.includes('120'), '滑杆 120ms 节流');
ok('④', panel.includes('throttledChange(param.key, valueOf'), 'range 走节流通道');
ok('⑤', lab.includes('known-source-note') && lab.includes('不会自动写回'), '确认栏注明题面参数来源');

if (problems.length > 0) {
  console.log(`FAIL：${problems.length} / ${checks} 项`);
  for (const problem of problems) console.log('  ✗', problem);
  process.exit(1);
}
console.log(`PASS：${checks} 项（R-38：双标题 / 模型前提 / 构件几何 / 滑杆节流 / 参数来源）`);
