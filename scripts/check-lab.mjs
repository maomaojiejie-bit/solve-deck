/**
 * 拼接台门禁（check:lab）。
 *
 *  前半（W8a）：全部快照 render_specs[0] → graphFromSpec → graphToSpec 往返无损
 *              （nodes / edges 逐条相等，含 rot / labelSide / points）。
 *  后半（W8b）：七张骨架不改 → reduce 出的 params 与 parsed_given **逐键相等**（≤1e-12）；
 *              严格模型入口（reduceNetlist / reduceBeam）同解；
 *              换题型清空重建不叠加（M3 骨架换到 M3-cantilever → 不残留简支支座）。
 *
 * 「参数相同 → 结果相同」由既有 check:p3 保证，两条拼起来是完整的同解证明。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { graphFromSpec, graphToSpec } from '../src/core/lab/graphFromSpec.ts';
import { supportRefs } from '../src/core/lab/attach.ts';
import { seedGraph, PICKS, PICK_IDS, skeletonOptions } from '../src/core/lab/picks.ts';
import { SUPPORTED_IDS } from '../src/core/lab/ids.ts';
import { labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { reduce, reduceNetlist, reduceBeam } from '../src/core/lab/reduce.ts';
import { graphToNetlist, graphToBeam } from '../src/core/lab/graphToModel.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;

function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
}

const rel = (a, b) => (Math.max(Math.abs(a), Math.abs(b)) === 0 ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

/* ── 前半：全部快照往返无损 ─────────────────────────────────────── */

const files = readdirSync(join(root, 'src', 'examples')).filter((name) => name.endsWith('.json'));
for (const name of files) {
  const snap = JSON.parse(readFileSync(join(root, 'src', 'examples', name), 'utf8'));
  const spec = snap.render_specs?.[0];
  if (!spec) {
    ok('①', false, `${name} 没有 render_specs[0]`);
    continue;
  }
  const templateId = name.replace(/\.json$/, '');
  const route = getTemplateRoute(templateId);
  const family = ['A1', 'A2', 'A3', 'A3-CB', 'A3-CC', 'A4', 'A5', 'A5-CD', 'A5-CG', 'A6', 'A7'].includes(templateId) ? 'circuit' : 'beam';
  const graph = graphFromSpec(spec, templateId, family);
  // R3-1 A1：支座折成结点属性（不再占图元位置），所以判据是「折叠掉的支座 + 剩下的
  // 节点 = 快照节点数」—— 少一个别的节点照样红。渲染回来见下面的 graphToSpec 断言。
  const foldedSupports = supportRefs(graph).filter((ref) => !ref.nodeForm).length;
  ok(
    '①',
    graph.nodes.length + foldedSupports === spec.nodes.length,
    `${templateId} graphFromSpec 丢节点：${graph.nodes.length}+${foldedSupports} ≠ ${spec.nodes.length}`,
  );
  const rebuilt = graphToSpec(graph, spec.type);
  const sameNodes =
    rebuilt.nodes.length === spec.nodes.length &&
    rebuilt.nodes.every((node, index) => {
      const origin = spec.nodes[index];
      return (
        node.id === origin.id &&
        node.x === origin.x &&
        node.y === origin.y &&
        node.kind === origin.kind &&
        (node.label ?? '') === (origin.label ?? '') &&
        (node.rot ?? 0) === (origin.rot ?? 0) &&
        (node.labelSide ?? 'up') === (origin.labelSide ?? 'up')
      );
    });
  ok('①', sameNodes, `${templateId} graphToSpec 往返节点不一致`);
  const sameEdges =
    rebuilt.edges.length === spec.edges.length &&
    rebuilt.edges.every((edge, index) => {
      const origin = spec.edges[index];
      const pts = (edge.points ?? []).flat();
      const pts0 = (origin.points ?? []).flat();
      return edge.id === origin.id && edge.from === origin.from && edge.to === origin.to && edge.kind === origin.kind && pts.length === pts0.length && pts.every((v, i) => v === pts0[i]);
    });
  ok('①', sameEdges, `${templateId} graphToSpec 往返边不一致`);
}
console.log(`①  往返无损：${files.length} 份快照 × 节点 / 边 / rot / points 全等`);

/* ── 后半：骨架不改 → params 逐键相等 ───────────────────────────── */

const IDS = Object.keys(PICKS);
for (const id of IDS) {
  const snap = JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
  const route = getTemplateRoute(id);
  const entry = route.entry;
  const baseline = route.variant?.params ?? {};
  const defaults = Object.fromEntries((entry.params ?? []).map((p) => [p.key, baseline[p.key] ?? p.defaultValue]));
  const seeded = seedGraph(id, defaults);
  const graph = graphFromSpec(labSkeletonSpec(id, snap.render_specs[0]), id, PICKS[id].family, {
    ...(PICKS[id].family === 'beam' ? skeletonOptions(id) : {}),
    seeds: seeded.seeds,
    meta: seeded.meta,
  });
  const result = reduce(id, graph);
  ok('②', !result.outOfScope, `${id} 骨架不改却拒答：${result.problems.join('；')}`);
  const given = snap.parsed_given;
  for (const [key, want] of Object.entries(given)) {
    const got = result.params[key];
    if (typeof want === 'number') {
      ok('②', typeof got === 'number' && rel(got, want) <= 1e-12, `${id}.${key}: 归约 ${got} ≠ parsed_given ${want}`);
    } else {
      ok('②', got === want, `${id}.${key}: 归约 ${got} ≠ parsed_given ${want}`);
    }
  }
  const extra = Object.keys(result.params).filter((key) => !(key in given));
  ok('②', extra.length === 0, `${id} 归约多出参数：${extra.join(', ')}`);

  // 严格模型入口同解
  if (PICKS[id].family === 'circuit') {
    const net = graphToNetlist(graph);
    ok('②', net.devices.length >= 4 && net.connectors.length >= 2, `${id} netlist 结构异常：devices=${net.devices.length} connectors=${net.connectors.length}`);
    const viaNet = reduceNetlist(id, net, seeded.meta);
    ok('②', JSON.stringify(viaNet.params) === JSON.stringify(result.params), `${id} reduceNetlist 与 reduce 不同解`);
  } else {
    const beam = graphToBeam(graph);
    const viaBeam = reduceBeam(id, beam, seeded.meta);
    const keys = Object.keys(given);
    for (const key of keys) {
      if (typeof given[key] === 'number') {
        ok('②', typeof viaBeam.params[key] === 'number' && rel(viaBeam.params[key], given[key]) <= 1e-9, `${id} reduceBeam.${key}: ${viaBeam.params[key]} ≠ ${given[key]}`);
      } else {
        ok('②', viaBeam.params[key] === given[key], `${id} reduceBeam.${key}: ${viaBeam.params[key]} ≠ ${given[key]}`);
      }
    }
  }
}
console.log(`②  逐键相等：${IDS.join(' / ')}（含严格模型入口同解）`);

/* ── 换题型清空重建，不叠加 ─────────────────────────────────────── */

{
  const m3 = JSON.parse(readFileSync(join(root, 'src', 'examples', 'M3.json'), 'utf8'));
  const cant = JSON.parse(readFileSync(join(root, 'src', 'examples', 'M3-cantilever.json'), 'utf8'));
  const routeC = getTemplateRoute('M3-cantilever');
  const defaultsC = Object.fromEntries((routeC.entry.params ?? []).map((p) => [p.key, routeC.variant?.params?.[p.key] ?? p.defaultValue]));
  const seededC = seedGraph('M3-cantilever', defaultsC);
  // 换题型 = 完全重建骨架（不是在旧图上改）
  const fresh = graphFromSpec(cant.render_specs[0], 'M3-cantilever', 'beam', {
    ...skeletonOptions('M3-cantilever'),
    seeds: seededC.seeds,
    meta: seededC.meta,
  });
  ok('③', !fresh.nodes.some((node) => node.kind === 'pinSupport'), '换题型后残留简支支座（叠加）');
  // R3-1 A1：支座是结点属性 —— 判据读 supportRefs（覆盖两种形态），不再看节点 kind。
  ok('③', supportRefs(fresh).some((ref) => ref.kind === 'fixedSupport'), '换题型后没有固定端');
  const result = reduce('M3-cantilever', fresh);
  ok('③', !result.outOfScope && rel(result.params.L, cant.parsed_given.L) <= 1e-12, `换题型归约错：L=${result.params.L} ≠ ${cant.parsed_given.L}`);
  // M3 骨架（简支）喂 M3-cantilever 的归约表必须被结构判据拒掉 —— 不许静默兼容
  const seededM3 = seedGraph('M3', { L: 4, a: 2, P: 20, q: 0 });
  const m3Graph = graphFromSpec(m3.render_specs[0], 'M3', 'beam', {
    ...skeletonOptions('M3'),
    seeds: seededM3.seeds,
    meta: seededM3.meta,
  });
  const cross = reduce('M3-cantilever', m3Graph);
  ok('③', cross.outOfScope && cross.problems.length > 0, '简支骨架喂悬臂归约表没有被拒');
  console.log('③  换题型不叠加：M3↔M3-cantilever 重建干净、跨表互拒');
}

ok('④', JSON.stringify([...PICK_IDS].sort()) === JSON.stringify([...SUPPORTED_IDS].sort()), '归约表与结果页/读题页的支持题型表漂移了');
ok('④', SUPPORTED_IDS.length === 16, `支持题型应为 16 个装配入口，实际 ${SUPPORTED_IDS.length}`);

/* ── W17-B：复位二次确认的 testid 存在且 aria 可见（bsk / 读屏都够得着） ── */
{
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('⑤', labSource.includes('data-testid="reset-skeleton-confirm"'), '⑤ 复位确认条没有 data-testid="reset-skeleton-confirm"');
  ok('⑤', labSource.includes('data-testid="reset-skeleton-yes"') && labSource.includes('data-testid="reset-skeleton-no"'), '⑤ 复位确认的 yes / no 按钮 testid 缺失');
  ok('⑤', labSource.includes('role="alertdialog"') && labSource.includes('aria-label="确认恢复骨架"'), '⑤ 复位确认条不是 aria 可见（缺 role / aria-label）');
  // N-03 徽标合一后，链接载入状态与「来自题面」共用 badge-source、按 data-source 区分
  ok(
    '⑤',
    labSource.includes('data-testid="badge-source"') && labSource.includes("'已从链接载入'") && labSource.includes("data-source={fromProblem ? 'problem' : 'link'}"),
    '⑤ 链接载入状态没标出来（W17-B 刷新语义 / N-03 合一）',
  );
  console.log('⑤  复位确认条 testid ×3 + role=alertdialog + 链接载入徽标：源码断言全过');
}

/* ── R-36 P2 防回归：均布整跨语义 / 支座判据文案 / 复位按钮可访问名 ── */
{
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  const opsSource = readFileSync(join(root, 'src', 'core', 'lab', 'ops.ts'), 'utf8');
  const picksSource = readFileSync(join(root, 'src', 'core', 'lab', 'picks.ts'), 'utf8');
  // ① 均布是整跨：标签不许再挂 t=，选中条不许给 t 输入框，setLoadT 要拒答
  ok('⑥', opsSource.includes('· 整跨'), '⑥ 均布载荷标签丢了「整跨」标注');
  ok('⑥', labSource.includes("selectedLoadNode.kind === 'udl'") && labSource.includes('整跨均布 · 铺满该段'), '⑥ 选中条没给均布换成整跨说明');
  ok('⑥', /if \(load\.kind === 'udl'\)[\s\S]{0,200}refused: '均布载荷是整跨的/.test(opsSource), '⑥ setLoadT 没拦住给整跨均布设 t');
  // ② 支座判据：类型组合错不能再说「数量不对」
  ok('⑥', !picksSource.includes('支座数量不对') && picksSource.includes('支座配置不对（类型或个数）'), '⑥ 支座判据文案又退回「数量不对」');
  // ③ 复位按钮 armed 态不与确认条里的「确认恢复」撞可访问名
  // 只查 JSX 表达式（注释里会引用旧文案做说明，不能用裸 includes 反向断言）
  ok('⑥', labSource.includes("resetArmed ? '恢复骨架 · 待确认'") && !labSource.includes("{resetArmed ? '确认恢复？'"), '⑥ 复位按钮 armed 态又和确认按钮撞名');
  // ④ 顺手补的两个 a11y 标签
  ok('⑥', labSource.includes('aria-label="支座类型"') && labSource.includes('aria-label="跨内相对位置 t"'), '⑥ 支座类型 / 跨内 t 输入缺 aria-label');
  console.log('⑥  R-36 P2 哨兵：整跨语义 ×3 / 支座判据文案 / 复位按钮不撞名 / a11y ×2');
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(
  `PASS：${checks} 项（拼接台门禁：${files.length} 份快照往返无损 / ${IDS.length} 型骨架不改逐键相等 / 换题型清空重建不叠加）`,
);
