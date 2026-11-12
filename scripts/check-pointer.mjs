/**
 * check:pointer（R3-4 U1）—— 「点哪儿就有哪儿，一个动作落一个条件」。
 *
 *  ① 老行为不变：连线 reducer（`wireClick`）对 blank / body / label 的三种回答逐字
 *     与以前一致；放置器关掉时 `placePlan` 一条 op 都不产出（画布回到选中 / 拖动）。
 *  ② 12 单位内「端点优先」：离结点 5 单位、同时压在杆上 → 必须命中结点；
 *     电路侧离引脚 5 单位、同时压在导线上 → 必须命中引脚（H-01 的病根）。
 *  ③ t 吸附：距 1/4 刻度 5 单位 → t 恰好 0.25；距 1/3 刻度 4 单位 → t 恰好 1/3。
 *  ④ 自由 t：两位小数、开区间（0.62 → 0.62；点最右端 → 0.98；最左端 → 0.02）。
 *  ⑤ 一步集中力：按下在杆上 + 松手偏 (0,+40) → 一条 addLoad（atMember + dir=0），
 *     appliedRules 里出现「载荷落在 <杆> t=…」；向左拖 (0,-40?) → 方向 ←（rot 跟着换）。
 *  ⑥ 电路本体不再是「一句提示」：pinsOfNode 给出 ≥3 个引脚名。
 *  ⑦ 点杆中切段加支座：一条 splitMember 落成 2 段 + 1 个带支座的新结点；
 *     切完还能在**第二段**上加载荷（atMember 记住哪一段，不会算成 t=1）。
 *  ⑧ 变异哨兵：PLACE_CONFIG.memberPriority / tSnap 的默认值就是门禁的变异位。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}

import { labSkeletonSpec, freshSkeleton } from '../src/core/lab/skeleton.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { anchorsOf } from '../src/core/lab/pins.ts';
import { wireClick, emptySession } from '../src/core/lab/pointer.ts';
import { bodyHint, TEXT_HINT } from '../src/core/lab/wiring.ts';
import { loadT } from '../src/core/lab/picks.ts';
import { normalizeDir, rotToDir, isJoint } from '../src/core/lab/attach.ts';
import { pinAt } from '../src/render/symbols.ts';

/** W20：出图方向由渲染几何判，不再断言图元 rot 数值。 */
const faces = (rot) => {
  const [tx, ty] = pinAt('arrow', [0, 0], rot, 'tail');
  return tx < -1 ? '→' : tx > 1 ? '←' : ty > 1 ? '↑' : '↓';
};
import {
  PLACE_CONFIG,
  dirFromDrag,
  hoverAt,
  pinsOfNode,
  placeHit,
  placePlan,
  snapT,
} from '../src/core/lab/place.ts';

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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const specOf = (id) =>
  labSkeletonSpec(id, JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8')).render_specs[0]);
const skeleton = (id) => freshSkeleton(id, specOf(id));

/** M3：单跨梁，A(140,250) — B(780,250)，长 640。 */
const m3 = skeleton('M3');
const span = m3.edges.find((edge) => edge.kind === 'beam');
const endA = m3.nodes.find((node) => node.id === span.from);
const endB = m3.nodes.find((node) => node.id === span.to);
const L = Math.hypot(endB.x - endA.x, endB.y - endA.y);
const at = (t) => ({ x: endA.x + (endB.x - endA.x) * t, y: endA.y + (endB.y - endA.y) * t });

/* ── ① 老行为不变 ─────────────────────────────────────────────── */
{
  const session = { ...emptySession(), first: 'n-end-a:center' };
  const blank = wireClick(m3, session, { kind: 'blank' });
  ok('①', blank.cancelled === true && blank.session.first === null, `① 点空白应取消连线，实际 cancelled=${blank.cancelled}`);

  const body1 = wireClick(m3, emptySession(), { kind: 'body', nodeKind: 'npn' });
  const body2 = wireClick(m3, body1.session, { kind: 'body', nodeKind: 'npn' });
  ok('①', body1.note === bodyHint('npn') && body2.note === undefined, `① 本体提示应只说一次，实际 ${JSON.stringify([body1.note, body2.note])}`);

  const label = wireClick(m3, emptySession(), { kind: 'label' });
  ok('①', label.note === TEXT_HINT, `① 点标注应提示「${TEXT_HINT}」，实际 ${label.note}`);

  // 放置器关掉（tool='off'）：一条 op 都不产出 —— 画布仍旧是「选中 / 拖动」
  const planOff = placePlan(m3, 'off', { kind: 'blank', x: 0, y: 0 }, { value: 20, dir: 0 });
  ok('①', planOff.ops.length === 0 && planOff.refused === undefined, `① 放置器关掉时不该产出 op，实际 ${planOff.ops.length} 条`);
  console.log('① 老 reducer 三种回答逐字不变；放置器关掉时一条 op 都不产出');
}

/* ── ② 端点优先（12 单位内不许被杆身抢） ───────────────────────── */
{
  const onMemberNearJoint = placeHit(m3, endA.x + 5, endA.y);
  ok('②', onMemberNearJoint.kind === 'joint' && onMemberNearJoint.id === endA.id, `② 离结点 5 单位应命中结点，实际 ${onMemberNearJoint.kind}:${onMemberNearJoint.id ?? ''}`);

  // 电路侧：找一条「端点正好是引脚」的导线，沿导线走 5 单位 → 必须还是引脚
  const a3 = skeleton('A3');
  const pins = anchorsOf(a3).filter((anchor) => anchor.kind === 'pin');
  let circuitCase = null;
  for (const wire of a3.edges) {
    const points = wire.points;
    if (!points || points.length < 2) continue;
    for (const anchor of pins) {
      for (const [index, sign] of [[0, 1], [points.length - 1, -1]]) {
        const p = points[index];
        if (Math.hypot(p[0] - anchor.x, p[1] - anchor.y) > 1) continue;
        const q = points[index === 0 ? 1 : points.length - 2];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len <= 8) continue;
        const x = p[0] + ((q[0] - p[0]) / len) * 5 * sign;
        const y = p[1] + ((q[1] - p[1]) / len) * 5 * sign;
        circuitCase = { anchor, hit: placeHit(a3, x, y) };
      }
      if (circuitCase) break;
    }
    if (circuitCase) break;
  }
  ok('②', circuitCase !== null, '② 前置：A3 里找不到「端点落在引脚上的导线」');
  if (circuitCase) {
    ok(
      '②',
      circuitCase.hit.kind === 'pin' && circuitCase.hit.key === circuitCase.anchor.key,
      `② 离引脚 5 单位应命中该引脚，实际 ${circuitCase.hit.kind}:${circuitCase.hit.key ?? circuitCase.hit.edgeId ?? ''}`,
    );
  }
  console.log(`② 离结点 5 单位仍命中结点（${onMemberNearJoint.kind}${circuitCase ? '；电路侧同理命中引脚' : ''}）—— 端点不被杆身抢走`);
}

/* ── ③ t 吸附 ─────────────────────────────────────────────────── */
{
  const quarter = at(0.25);
  const hitQuarter = placeHit(m3, quarter.x + 5, quarter.y);
  ok('③', hitQuarter.kind === 'member' && near(hitQuarter.t, 0.25), `③ 距 1/4 五单位应吸附成 0.25，实际 ${JSON.stringify(hitQuarter.kind === 'member' ? hitQuarter.t : hitQuarter.kind)}`);

  const third = at(1 / 3);
  const hitThird = placeHit(m3, third.x - 4, third.y);
  ok('③', hitThird.kind === 'member' && Math.abs(hitThird.t - 1 / 3) < 1e-9, `③ 距 1/3 四单位应吸附成 1/3，实际 ${hitThird.kind === 'member' ? hitThird.t : hitThird.kind}`);

  ok('③', near(snapT(m3, span.id, 0.25), 0.25), `③ snapT(0.25) ≠ 0.25`);
  console.log(`③ t 吸附：1/4±5u → ${hitQuarter.kind === 'member' ? hitQuarter.t : '?'}；1/3±4u → ${hitThird.kind === 'member' ? hitThird.t.toFixed(6) : '?'}`);
}

/* ── ④ 自由 t：两位小数、开区间 ───────────────────────────────── */
{
  const free = placeHit(m3, at(0.62).x, at(0.62).y);
  ok('④', free.kind === 'member' && near(free.t, 0.62), `④ 自由 t 应为 0.62，实际 ${free.kind === 'member' ? free.t : free.kind}`);

  const rightEdge = placeHit(m3, endB.x - 1, endB.y);
  ok(
    '④',
    rightEdge.kind === 'joint' || (rightEdge.kind === 'member' && near(rightEdge.t, 0.98)),
    `④ 点最右端应被推回开区间（0.98）或落成结点，实际 ${rightEdge.kind === 'member' ? rightEdge.t : rightEdge.kind}`,
  );
  const leftEdge = snapT(m3, span.id, 0);
  ok('④', near(leftEdge, 0.02), `④ snapT(0) 应推回 0.02，实际 ${leftEdge}`);
  ok('④', near(snapT(m3, span.id, 1), 0.98), `④ snapT(1) 应推回 0.98，实际 ${snapT(m3, span.id, 1)}`);

  const freeAlone = placePlan(m3, 'point', { kind: 'member', edgeId: span.id, t: 0.62, x: 0, y: 0, dist: 0 }, { value: 20, dir: 0 });
  const applied = applyOp('M3', m3, freeAlone.ops[0]);
  const load = applied.graph.nodes.find((node) => node.kind === 'arrow' && node.atMember === span.id);
  ok('④', load !== undefined && Math.abs(loadT(applied.graph, load) - 0.62) < 1e-9, `④ 自由 t 没落到图上（atMember=${load?.atMember}）`);
  console.log(`④ 自由 t 两位小数且在 (0,1)：0.62 原样保留；两端被推回 0.02 / 0.98`);
}

/* ── ⑤ 一步集中力（按下 + 拖出方向） ───────────────────────────── */
{
  const mid = at(0.5);
  const dirDown = dirFromDrag(0, 40);
  ok('⑤', dirDown === 0, `⑤ 向下拖应给 dir=0，实际 ${dirDown}`);
  ok('⑤', dirFromDrag(-40, 0) === 270 && dirFromDrag(0, -40) === 180 && dirFromDrag(40, 0) === 90, `⑤ 四向拖拽方向不对：左 ${dirFromDrag(-40, 0)} 上 ${dirFromDrag(0, -40)} 右 ${dirFromDrag(40, 0)}`);
  ok('⑤', dirFromDrag(0, 3) === 0, `⑤ 位移不到 8 单位应按垂直向下，实际 ${dirFromDrag(0, 3)}`);

  const hit = placeHit(m3, mid.x, mid.y);
  const plan = placePlan(m3, 'point', hit, { value: 20, dir: dirDown });
  ok('⑤', plan.ops.length === 1 && plan.ops[0].op === 'addLoad' && plan.ops[0].atMember?.edgeId === span.id, `⑤ 一步应产出 addLoad(atMember)，实际 ${JSON.stringify(plan.ops)}`);
  const out = applyOp('M3', m3, plan.ops[0]);
  const load = out.graph.nodes.find((node) => node.kind === 'arrow' && node.atMember === span.id);
  ok('⑤', load !== undefined && rotToDir(load?.rot) === 0 && faces(load?.rot) === '↓', `⑤ 向下拖的载荷出图应朝下，实际 ${faces(load?.rot)}（语义 ${rotToDir(load?.rot)}）`);
  ok('⑤', out.rules.some((rule) => /载荷落在 .+ t=0\.\d\d/.test(rule)), `⑤ appliedRules 里没有「载荷落在 <杆> t=…」：${JSON.stringify(out.rules)}`);

  // 换方向：向左拖 → 同一条链路，语义角与出图方向一起换（W20 不再断言图元 rot）
  const planLeft = placePlan(m3, 'point', hit, { value: 20, dir: dirFromDrag(-40, 0) });
  const outLeft = applyOp('M3', m3, planLeft.ops[0]);
  const loadLeft = outLeft.graph.nodes.find((node) => node.kind === 'arrow' && node.atMember === span.id);
  ok('⑤', loadLeft !== undefined && rotToDir(loadLeft?.rot) === 270 && faces(loadLeft?.rot) === '←' && normalizeDir(270) === 270, `⑤ 向左拖应得语义 270° 且出图朝左，实际 ${faces(loadLeft?.rot)}（语义 ${rotToDir(loadLeft?.rot)}）`);
  console.log(`⑤ 按下在杆中 + 松手偏 (0,+40) → dir=0，一条 addLoad 落成；规则「${out.rules[out.rules.length - 1]}」`);
}

/* ── ⑥ 电路本体：列出引脚名，而不是一句「不是端点」 ─────────────── */
{
  const a3 = skeleton('A3');
  const q = a3.nodes.find((node) => node.kind === 'npn' || node.kind === 'pnp');
  ok('⑥', q !== undefined, '⑥ 前置：A3 里找不到晶体管');
  if (q) {
    const pins = pinsOfNode(a3, q.id);
    ok('⑥', pins.length >= 3, `⑥ 本体应列出 ≥3 个引脚，实际 ${pins.length}`);
    ok('⑥', pins.every((pin) => pin.label && pin.label.length > 0 && !pin.label.startsWith('n-')), `⑥ 引脚名不该是内部 id：${JSON.stringify(pins.map((p) => p.label))}`);
    // 点名字要能起线：第一个引脚作为第一锚点，再用第二个引脚收线
    const first = wireClick(a3, emptySession(), { kind: 'pin', key: pins[0].key });
    ok('⑥', first.session.first === pins[0].key, `⑥ 点引脚名应成为橡皮筋起点，实际 ${first.session.first}`);
    console.log(`⑥ ${q.label ?? q.kind} 本体列出 ${pins.length} 个脚：${pins.map((pin) => pin.label).join(' / ')}`);
  }
}

/* ── ⑦ 点杆中切段加支座；切完第二段还能加载荷 ─────────────────── */
{
  const hit = placeHit(m3, at(0.5).x, at(0.5).y);
  const plan = placePlan(m3, 'support', hit, { value: 0, dir: 0 });
  ok('⑦', plan.ops.length === 1 && plan.ops[0].op === 'splitMember', `⑦ 点杆中加支座应产出 splitMember，实际 ${JSON.stringify(plan.ops)}`);
  const out = applyOp('M3', m3, plan.ops[0]);
  ok('⑦', out.graph.edges.length === m3.edges.length + 1, `⑦ 切一刀应多一段（${m3.edges.length} → ${out.graph.edges.length}）`);
  const joints = out.graph.nodes.filter(isJoint);
  const fresh = joints.find((node) => !m3.nodes.some((old) => old.id === node.id));
  ok('⑦', fresh !== undefined && fresh.support?.type === 'pin', `⑦ 新结点上应挂固定铰，实际 ${JSON.stringify(fresh?.support)}`);

  // W22-A：切段 id 走单调 seq（不再 -1/-2 固定式）—— 第二段 = 保留原杆「to」端的那段。
  const second = out.graph.edges.find((edge) => edge.to === span.to && edge.id !== span.id);
  ok('⑦', second !== undefined, `⑦ 找不到第二段（原 ${span.id} 的 to 端）`);
  if (second) {
    const loadPlan = placePlan(out.graph, 'point', { kind: 'member', edgeId: second.id, t: 0.5, x: 0, y: 0, dist: 0 }, { value: 5, dir: 0 });
    const loaded = applyOp('M3', out.graph, loadPlan.ops[0]);
    const load = loaded.graph.nodes.find((node) => node.kind === 'arrow' && node.atMember === second.id);
    const t = load ? loadT(loaded.graph, load) : null;
    ok('⑦', load !== undefined && t !== null && Math.abs(t - 0.5) < 1e-9, `⑦ 第二段上的载荷 t 应算成 0.5（不是 1），实际 ${t}`);
    console.log(`⑦ 切段：${m3.edges.length} → ${out.graph.edges.length} 段，新结点 ${fresh?.label} 挂固定铰；第二段加载荷 t=${t?.toFixed(2)}（不会算成 1）`);
  }
}

/* ── ⑧ 变异哨兵 ───────────────────────────────────────────────── */
{
  ok('⑧', PLACE_CONFIG.memberPriority === false, `⑧ memberPriority 应为 false（sed 变异位），实际 ${PLACE_CONFIG.memberPriority}`);
  ok('⑧', PLACE_CONFIG.tSnap === 6, `⑧ tSnap 应为 6（sed 变异位），实际 ${PLACE_CONFIG.tSnap}`);
  console.log(`⑧ 变异位就绪：memberPriority=${PLACE_CONFIG.memberPriority} tSnap=${PLACE_CONFIG.tSnap}（sed 翻转后 ②/③ 必红）`);
}

if (errors.length > 0) {
  console.error(`\nFAIL：${errors.length} 项没过`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}
console.log(`\nPASS：${checks} 项（智能选点：端点优先 / t 吸附 / 自由 t / 一步落力 / 切段加支座 / 引脚列表 / 老行为不变 / 变异哨兵）`);
