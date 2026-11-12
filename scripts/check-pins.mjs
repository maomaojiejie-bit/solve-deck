/**
 * check:pins —— W12「点哪里、填什么」门禁（新，接进 build / check / verify）。
 *
 *  ① 27 个 electronics SVG 对应的符号，每个引脚都有中文名；漏一个就列出来
 *  ② 三类点错文案逐字钉死；「静默取消」只对空白生效；汇流条锚点真能连成导线
 *  ③ 快填双向换算（Ic=1mA / β=100 / VA=100 / Vt=26mV）+ 往返 ≤1e-9 + Vt 随动
 *  ④ 手改不被覆盖（改 gm → Ic 变「推得」且值不跳回）+ 不自洽「相差 30%」提示
 *  ⑤ 下拉 / hover / 选中态不出现裸内部 id；check:assemble 447 项不许掉
 *
 * 变异两条在末尾真跑：删 npn 的 label → ① 红；关掉手改保护 → ④ 红。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIN_LABEL, SYMBOLS, pinLabel } from '../src/render/symbols.ts';
import { graphFromSpec } from '../src/core/lab/graphFromSpec.ts';
import { clickableAnchors, findAnchor } from '../src/core/lab/pins.ts';
import { anchorDisplay, anchorOptionText, selectionText } from '../src/core/lab/pinNames.ts';
import { wireClick } from '../src/core/lab/pointer.ts';
import { PIN_HINT, TEXT_HINT, bodyHint, validateWire } from '../src/core/lab/wiring.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { createUiState, labUiClick } from '../src/core/lab/ui.ts';
import {
  QUICKFILL_CONFIG,
  initialQuickValues,
  quickCommit,
  quickDerive,
} from '../src/ui/quickFill.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const rel = (a, b) => (Math.max(Math.abs(a), Math.abs(b)) === 0 ? Math.abs(a - b) : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

const snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'A3.json'), 'utf8'));
const graph = graphFromSpec(snap.render_specs[0], 'A3', 'circuit');

/* ── ① 引脚中文名 ──────────────────────────────────────────────── */

const DOCUMENTED = {
  'npn:b': '基极 b', 'npn:c': '集电极 c', 'npn:e': '发射极 e',
  'pnp:b': '基极 b', 'pnp:c': '集电极 c', 'pnp:e': '发射极 e',
  'nmos:g': '栅极 g', 'nmos:d': '漏极 d', 'nmos:s': '源极 s',
  'nmos-r90:g': '栅极 g', 'nmos-r90:d': '漏极 d', 'nmos-r90:s': '源极 s',
  'pmos:g': '栅极 g', 'pmos:d': '漏极 d', 'pmos:s': '源极 s',
  'pmos-r90:g': '栅极 g', 'pmos-r90:d': '漏极 d', 'pmos-r90:s': '源极 s',
  'opamp:inp': '同相输入 +', 'opamp:inn': '反相输入 −', 'opamp:out': '输出',
  'res:a': '端 A', 'res:b': '端 B', 'cap:a': '端 A', 'cap:b': '端 B',
  'vsrc:p': '正端 +', 'vsrc:n': '负端 −', 'isrc:p': '正端 +', 'isrc:n': '负端 −',
  'ctrlsrc:p': '受控端', 'ctrlsrc:n': '回程端',
  'diode:a': '阳极', 'diode:c': '阴极', 'zener:a': '阳极', 'zener:c': '阴极',
  'gnd:t': '地',
};

/** 变异①会再调一次：删掉一个 label 必须让这里返回 ok=false。 */
function pinLabelsCheck() {
  const issues = [];
  const svgs = readdirSync(join(root, 'public', 'symbols', 'electronics')).filter((file) => file.endsWith('.svg'));
  if (svgs.length !== 27) issues.push(`electronics SVG 应有 27 个，实际 ${svgs.length}`);
  for (const [kind, def] of Object.entries(SYMBOLS)) {
    for (const pin of def.pins) {
      if (!pin.label || !/[\u4e00-\u9fa5]/.test(pin.label)) issues.push(`${kind}:${pin.id} 没有中文名`);
      if (pinLabel(kind, pin.id) !== pin.label) issues.push(`${kind}:${pin.id} 的 SymPin.label 与 PIN_LABEL 漂移`);
    }
  }
  for (const [key, want] of Object.entries(DOCUMENTED)) {
    const [kind, pin] = key.split(':');
    if (PIN_LABEL[kind]?.[pin] !== want) issues.push(`文档表格 ${key} 应为「${want}」`);
  }
  return { ok: issues.length === 0, issues };
}

{
  const result = pinLabelsCheck();
  ok('①', result.ok, `引脚中文名有漏：${result.issues.join('；')}`);
  const grid = readFileSync(join(root, 'src', 'render', 'SpecGrid.tsx'), 'utf8');
  ok('①', /<title>\{pin\.label \?\? pin\.key\}<\/title>/.test(grid), 'hover 没有原生 <title> tooltip');
  ok('①', /data-testid="pin-hover"/.test(grid) && /data-testid="pin-status"/.test(grid), 'hover 浮标 / 选中态浮条缺一个');
  ok('①', /data-label=\{label\.id\}/.test(grid), '文字标注没有可点热区');
  ok('①', selectionText(graph, 'n-q:b', null) === '已选：Q · 基极 b', `选中态文案不对：${selectionText(graph, 'n-q:b', null)}`);
  ok(
    '①',
    selectionText(graph, null, { from: 'n-q:b', to: 'n-rc:a' }) === 'Q · 基极 b → Rc · 端 A',
    `连线态文案不对：${selectionText(graph, null, { from: 'n-q:b', to: 'n-rc:a' })}`,
  );
  const rails = clickableAnchors(graph).filter((anchor) => anchor.kind === 'rail');
  ok('①', rails.length > 0 && rails.some((anchor) => anchorDisplay(graph, anchor).text.includes('所属：')), '汇流条锚点没有中文名 / 归属');
  console.log(`①  27 个 SVG / ${Object.values(SYMBOLS).reduce((sum, def) => sum + def.pins.length, 0)} 个引脚全有中文名；hover / 选中 / rail 命名齐全`);
}

/* ── ② 点错位置要说话 + rail 真能连 ─────────────────────────────── */

{
  ok('②', PIN_HINT === '请点它的引脚（基极 / 集电极 / 发射极）', `本体提示文案被改：${PIN_HINT}`);
  ok('②', bodyHint('npn') === PIN_HINT, 'npn 本体没给基极/集电极/发射极提示');
  ok('②', bodyHint('res') === '请点它的引脚（电阻有端 A / 端 B）', '电阻本体没给端 A / 端 B 提示');
  ok('②', TEXT_HINT === '这是标注，不是电气点', `文字标注提示被改：${TEXT_HINT}`);

  const session = { first: 'n-vs:p', hinted: false };
  const blank = wireClick(graph, session, { kind: 'blank' });
  ok('②', blank.cancelled === true && blank.note === undefined, '点空白不该弹字（唯一静默分支）');
  const body = wireClick(graph, { first: null, hinted: false }, { kind: 'body', nodeKind: 'npn' });
  const label = wireClick(graph, { first: null, hinted: false }, { kind: 'label' });
  ok('②', body.note === PIN_HINT && label.note === TEXT_HINT, '本体 / 文字标注没有逐字给提示');
  ok('②', body.note !== undefined && label.note !== undefined, '静默取消被误用到本体或文字上');
  const state = createUiState('A3', graph);
  const bodyState = labUiClick('A3', state, { kind: 'body', nodeKind: 'npn' });
  const labelState = labUiClick('A3', state, { kind: 'label' });
  ok('②', bodyState.graph === state.graph && !bodyState.dirty, '点本体竟然改了图 / dirty');
  ok('②', labelState.graph === state.graph && !labelState.dirty, '点文字标注竟然改了图 / dirty');

  // 汇流条端点：validateWire 通过 → addEdge → 新导线首尾与两个锚点误差 < 0.6
  const rails = clickableAnchors(graph).filter((anchor) => anchor.kind === 'rail');
  let connected = false;
  for (const rail of rails) {
    const verdict = validateWire(graph, 'n-vs:p', rail.key);
    if (!verdict.ok) continue;
    const out = applyOp('A3', graph, { op: 'addEdge', from: 'n-vs:p', to: rail.key, kind: 'wire' });
    if (out.refused) continue;
    const edge = out.graph.edges[out.graph.edges.length - 1];
    const a = findAnchor(graph, 'n-vs:p');
    const b = findAnchor(graph, rail.key);
    if (!edge.points || !a || !b) continue;
    const head = edge.points[0];
    const tail = edge.points[edge.points.length - 1];
    connected =
      Math.hypot(head[0] - a.x, head[1] - a.y) < 0.6 && Math.hypot(tail[0] - b.x, tail[1] - b.y) < 0.6;
    if (connected) break;
  }
  ok('②', connected, '点汇流条锚点连不成导线 / 端点没落在该锚点上');
  console.log('②  本体 / 文字 / 空白三类文案逐字钉死；rail 锚点可点可连（端点误差 < 0.6）');
}

/* ── ③ 双向换算 ────────────────────────────────────────────────── */

{
  const base = { values: initialQuickValues({ Ic: 0.001, beta: 100, VA: 100, Vt: 0.026 }), manual: [] };
  const forward = quickDerive(base, 'fromQ');
  ok('③', rel(forward.values.gm, 0.001 / 0.026) <= 1e-12, `模式1 gm=${forward.values.gm} ≠ Ic/Vt`);
  ok('③', rel(forward.values.rpi, 2600) <= 1e-12, `模式1 rπ=${forward.values.rpi} ≠ 2600 Ω`);
  ok('③', rel(forward.values.ro, 100000) <= 1e-12, `模式1 ro=${forward.values.ro} ≠ 100000 Ω`);
  ok('③', forward.summary.includes('由 Ic=1 mA、β=100 推得'), `推得依据不对：${forward.summary}`);
  ok('③', forward.provenance.gm === '推得' && forward.provenance.rpi === '推得' && forward.provenance.ro === '推得', '推导项没标「推得」');
  ok(
    '③',
    forward.values.Ic === snap.parsed_given.Ic && forward.values.beta === snap.parsed_given.beta &&
      forward.values.VA === snap.parsed_given.VA && forward.values.Vt === snap.parsed_given.Vt,
    '模式1 的输入与 A3 快照 parsed_given 不一致',
  );
  const backward = quickDerive({ values: { ...forward.values }, manual: [] }, 'fromSmall');
  ok('③', rel(backward.values.Ic, 0.001) <= 1e-9 && rel(backward.values.VA, 100) <= 1e-9, `反向往返超差：Ic=${backward.values.Ic} VA=${backward.values.VA}`);
  const vt = quickDerive({ ...base, values: { ...base.values, Vt: 0.025 } }, 'fromQ');
  ok('③', rel(vt.values.rpi, 2500) <= 1e-12, `Vt 改成 25 mV 后 rπ=${vt.values.rpi} 没随动（被缓存住）`);
  console.log('③  双向换算 Ic/β/VA ↔ gm/rπ/ro 逐位；Vt 随动；推得依据写清');
}

/* ── ④ 手改保护 + 不自洽提示 ───────────────────────────────────── */

/** 变异②会再调一次：关掉 respectManual 必须让这里返回 ok=false。 */
function manualCheck() {
  const issues = [];
  const base = { values: initialQuickValues({ Ic: 0.001, beta: 100, VA: 100, Vt: 0.026 }), manual: [] };
  const forward = quickDerive(base, 'fromQ');
  // 第一次写入（正常），再手改 gm=0.05，Ic 仍是题面的 1 mA
  const manual = { values: { ...forward.values, gm: 0.05 }, manual: ['gm'] };
  const preview = quickDerive(manual, 'fromQ');
  if (preview.consistency.ok || Math.abs(preview.consistency.diff - 30) > 0.5 || !preview.consistency.text.includes('相差 30%')) {
    issues.push(`预览没报「相差 30%」：${preview.consistency.text}`);
  }
  const committed = quickCommit(manual, 'fromQ');
  if (committed.values.gm !== 0.05) issues.push(`写入把手改的 gm 覆盖了：${committed.values.gm}`);
  if (committed.provenance.gm !== '手改' || committed.provenance.Ic !== '推得') {
    issues.push(`写入后来源标记不对：gm=${committed.provenance.gm} Ic=${committed.provenance.Ic}`);
  }
  if (rel(committed.values.Ic, 0.0013) > 1e-12) issues.push(`反推 Ic=${committed.values.Ic} ≠ gm·Vt`);
  const again = quickCommit({ values: committed.values, manual: ['gm'] }, 'fromQ');
  if (again.values.gm !== 0.05 || again.values.Ic !== committed.values.Ic) {
    issues.push(`再点写入手改值跳回去了：gm=${again.values.gm} Ic=${again.values.Ic}`);
  }
  return { ok: issues.length === 0, issues };
}

{
  const result = manualCheck();
  ok('④', result.ok, `手改保护没生效：${result.issues.join('；')}`);
  const solveSrc = readFileSync(join(root, 'src', 'pages', 'Solve.tsx'), 'utf8');
  const labSrc = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('④', /<QuickFill/.test(solveSrc) && /quickfill-solve/.test(solveSrc), '#/solve 没挂同一个快填组件');
  ok('④', /<QuickFill/.test(labSrc) && /quickfill-lab/.test(labSrc), '#/lab 没挂快填组件');
  ok('④', /quickfill-solve/.test(solveSrc) && /QUICKFILL_TEMPLATES/.test(labSrc), '两页没共用 QUICKFILL_TEMPLATES');
  ok('④', /derived-source/.test(labSrc) && /derived-source/.test(solveSrc), '两页参数表都没有「推得」角标');
  console.log('④  改 gm → Ic 变「推得」且不跳回；不自洽 30% 提示；两页共用一个组件');
}

/* ── ⑤ 下拉不出现裸 id + 装配门禁不掉 ──────────────────────────── */

{
  const anchors = clickableAnchors(graph);
  const bad = [];
  for (const anchor of anchors) {
    const text = anchorOptionText(graph, 'A3', anchor.key);
    if (/^n-/.test(text) || !/[\u4e00-\u9fa5]/.test(text)) bad.push(`${anchor.key} → ${text}`);
  }
  ok('⑤', bad.length === 0, `下拉里还有裸内部 id：${bad.join('；')}`);
  const labSrc = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('⑤', /anchorOptionText\(graph, pickId, anchor\.key\)/.test(labSrc), '下拉没用同源的可读文案函数');
  ok('⑤', !/<option[^>]*>\s*\{node\.id\}/.test(labSrc), '下拉还在直接渲染 node.id');
  ok('⑤', /data-testid="anchor-option"/.test(labSrc), '下拉选项没有可核验的 testid');
  // 项数不许掉：真跑一遍装配门禁，读它的汇总行（子进程隔离，不污染本门禁的变异）。
  // W13 P0 441→447；W14 残留清理 ㉒ 再 +9。只锁下限（≥451），后续追加断言不用回头改这里。
  const assembleOut = execFileSync(process.execPath, [join(root, 'scripts', 'check-assemble.mjs')], { encoding: 'utf8' });
  const assembleCount = Number(/PASS：(\d+) 项/.exec(assembleOut)?.[1] ?? 0);
  ok('⑤', assembleCount >= 451, `check:assemble 掉到 ${assembleCount} 项（应 ≥451）：${assembleOut.trim().split('\n').pop()}`);
  console.log(`⑤  ${anchors.length} 个下拉选项全是可读中文；check:assemble 实测 ${assembleCount} 项不掉`);
}

/* ── 变异两条 ──────────────────────────────────────────────────── */

{
  const npnBase = SYMBOLS.npn.pins.find((pin) => pin.id === 'b');
  const original = npnBase.label;
  ok('变异①', pinLabelsCheck().ok, '变异前①就该是绿的');
  npnBase.label = undefined;
  ok('变异①', pinLabelsCheck().ok === false, '删掉 npn 的 label，① 竟然没红（门禁空转）');
  npnBase.label = original;
  ok('变异①', pinLabelsCheck().ok, '还原后①没回绿');
  console.log('变异①：删掉 npn:b 的中文名 → ① 红；还原回绿');
}
{
  ok('变异②', manualCheck().ok, '变异前④就该是绿的');
  QUICKFILL_CONFIG.respectManual = false;
  ok('变异②', manualCheck().ok === false, '关掉手改保护，④ 竟然没红（门禁空转）');
  QUICKFILL_CONFIG.respectManual = true;
  ok('变异②', manualCheck().ok, '还原后④没回绿');
  console.log('变异②：快填每次覆盖手改值 → ④ 红；还原回绿');
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（引脚中文名 / 点错文案 / rail 可连 / 快填双向换算 / 手改保护 / 下拉可读 / 装配门禁 ≥451 不掉 / 两条变异）`);
