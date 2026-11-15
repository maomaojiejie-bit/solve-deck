/**
 * 整图微变等效门禁（ac-equivalent，单管最小版）。
 *
 * 这一层的风险不是「算错数」，而是「画出一张看起来像等效电路、实际接错线的图」。
 * 所以门禁盯的是**图**，不是数：
 *
 *   1. 锚点必须逐位重合：b/c/e 三条端子的坐标要出现在生成图的导线上。差 0.1px
 *      在界面上就是断线，而断线的等效图比没有等效图更坏。
 *   2. 一条都不许丢：原图的每个非器件图元（按标注认）都必须还在生成图里；
 *      直流供电、电容要换成导线而不是「消失」。
 *   3. 只许整体平移：所有保留图元必须满足 x' === x 或 x' === x + SHIFT，y 不变。
 *      出现其它位移，说明有人在偷偷重排版面 —— 那就不是「原位等效」了。
 *   4. 数值必须与求解器同源：gm = Ic/Vt、rπ = β/gm、ro = VA/Ic。
 *   5. 拒绝要具体：双管 / 无管 / Ic=0 / 含二极管，各自给不同的理由，且**不返回图**。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deriveAcEquivalent } from '../src/core/lab/acEquivalent.ts';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';
import { pinAt } from '../src/render/symbols.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SHIFT = 190;
const VT = 0.026;

let assertions = 0;
const failures = [];

function ok(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}

const snapshot = JSON.parse(readFileSync(`${root}src/examples/A3.json`, 'utf8'));
const base = freshSkeleton('A3', snapshot.render_specs[0]);

/* ── ① 基准图：结构、锚点、保真 ─────────────────────────────── */

const r1 = deriveAcEquivalent(base);
ok(r1.available, `A3 骨架应可展开：${r1.available ? '' : r1.reason}`);

if (r1.available) {
  const spec = r1.model.spec;
  const q = base.nodes.find((node) => node.kind === 'npn');
  const anchors = ['b', 'c', 'e'].map((pin) => pinAt('npn', [q.x, q.y], 0, pin));
  const points = new Set(spec.edges.flatMap((edge) => (edge.points ?? []).map((p) => `${p[0]},${p[1]}`)));
  for (const [i, pin] of ['b', 'c', 'e'].entries()) {
    ok(points.has(`${anchors[i][0]},${anchors[i][1]}`), `端子 ${pin} 的坐标没落在任何导线上（等效图会断线）`);
  }

  // 三件套：rπ / gm / ro 都在，且都是竖放（rot=90）或受控源。
  const parts = spec.nodes.filter((node) => !['text', 'dot', 'pin', 'gnd'].includes(node.kind));
  ok(parts.some((node) => node.kind === 'res' && node.x > q.x - 30 && node.x < q.x + 10), '缺 rπ');
  ok(parts.some((node) => node.kind === 'ctrlsrc'), '缺 gm 受控源');
  ok(
    parts.filter((node) => node.kind === 'res').length >= 3,
    'ro 与 rπ 之外还应有原图的 Rc / Rl / Rs（三件套不是把整张图替换掉）',
  );

  // 保真：原图每个带标注的非器件图元都还在。
  const keptLabels = new Set(spec.nodes.map((node) => node.label).filter(Boolean));
  for (const node of base.nodes) {
    if (node.kind === 'npn' || !node.label) continue;
    ok(keptLabels.has(node.label), `原图元「${node.label}」在等效图里丢了`);
  }

  // 只许整体平移：y 不变，x 要么不动，要么 +SHIFT。
  const shiftedIds = new Set();
  for (const node of base.nodes) {
    if (node.kind === 'npn') continue;
    const next = spec.nodes.find((item) => item.id === node.id);
    if (!next) {
      ok(node.kind === 'cap' || node.kind === 'vsrc', `图元 ${node.id}（${node.kind}）被静默删掉`);
      continue;
    }
    ok(next.y === node.y, `图元 ${node.id} 的 y 变了（${node.y} → ${next.y}）：不许重排，只许平移`);
    const moved = next.x !== node.x;
    ok(!moved || next.x === node.x + SHIFT, `图元 ${node.id} 的位移不是 ${SHIFT}px（${node.x} → ${next.x}）`);
    if (moved) shiftedIds.add(node.id);
  }
  for (const edge of base.edges) {
    const next = spec.edges.find((item) => item.id === edge.id);
    if (!next) continue;
    for (const [i, p] of edge.points.entries()) {
      const moved = next.points[i];
      ok(!!moved, `导线 ${edge.id} 的点数变了`);
      if (!moved) break;
      ok(moved[1] === p[1], `导线 ${edge.id} 第 ${i} 点的 y 变了：不许重排`);
      ok(moved[0] === p[0] || moved[0] === p[0] + SHIFT, `导线 ${edge.id} 第 ${i} 点的 x 位移非法（${p[0]} → ${moved[0]}）`);
    }
  }

  // 数值同源
  const gm = q.value / VT;
  const rpi = q.params.beta / gm;
  const ro = q.params.lambda / q.value;
  const rows = Object.fromEntries(r1.model.rows.map((row) => [row.label, row.value]));
  const expectRpi = rpi >= 1000 ? `${Number((rpi / 1000).toPrecision(5))} kΩ` : `${Number(rpi.toPrecision(5))} Ω`;
  const expectRo = ro >= 1000 ? `${Number((ro / 1000).toPrecision(5))} kΩ` : `${Number(ro.toPrecision(5))} Ω`;
  ok(rows['rπ（β/gm）'] === expectRpi, `rπ 不是 β/gm：${rows['rπ（β/gm）']} ≠ ${expectRpi}`);
  ok(rows.ro === expectRo, `ro 不是 VA/Ic：${rows.ro} ≠ ${expectRo}`);
  ok(rows.gm === `${Number((gm * 1e3).toPrecision(5))} mS`, `gm 不是 Ic/Vt：${rows.gm}`);

  // 形状健康：没有 NaN 坐标
  ok(
    spec.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    '生成图里有非有限坐标',
  );
  ok(
    spec.edges.every((edge) => (edge.points ?? []).every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))),
    '生成图里有非有限导线坐标',
  );
}

/* ── ② 供电与电容：换成导线，而不是消失 ─────────────────────── */

const withSupply = structuredClone(base);
withSupply.nodes.push(
  { id: 'n-vcc', x: 480, y: 40, kind: 'vsrc', label: 'Vcc', value: 12, semantic: 'supply' },
  { id: 'n-cin', x: 190, y: 270, kind: 'cap', label: 'Cin', value: 10e-6 },
);
const r2 = deriveAcEquivalent(withSupply);
ok(r2.available, `加供电与电容后仍应可展开：${r2.available ? '' : r2.reason}`);
if (r2.available) {
  const ids = new Set(r2.model.spec.edges.map((edge) => edge.id));
  ok(ids.has('ac-n-vcc-short'), '直流供电没有换成短路线');
  ok(ids.has('ac-n-cin-short'), '耦合电容没有换成短路线');
  ok(
    r2.model.spec.nodes.every((node) => node.id !== 'n-vcc' && node.id !== 'n-cin'),
    '供电 / 电容图元应被短路线替换，不该同时留在图上',
  );
  ok(
    r2.model.actions.some((action) => action.includes('交流置地')),
    '动作清单没说明供电置地',
  );
  ok(
    !r2.model.spec.nodes.some((node) => node.kind === 'vsrc' && node.label === 'Vs' && node.x !== 160),
    '信号源 Vs 被误当成供电置地了',
  );
}

/* ── ③ 拒绝要具体，且不给图 ─────────────────────────────────── */

const twoDevices = structuredClone(base);
twoDevices.nodes.push({ id: 'n-q2', x: 900, y: 270, kind: 'npn', label: 'Q2', value: 0.002, params: { beta: 100, lambda: 100 } });
const r3 = deriveAcEquivalent(twoDevices);
ok(!r3.available && /只展开单管/.test(r3.reason), `双管应拒绝并说明「只展开单管」，实际：${r3.available ? '可用' : r3.reason}`);

const noDevice = structuredClone(base);
noDevice.nodes = noDevice.nodes.filter((node) => node.kind !== 'npn');
const r4 = deriveAcEquivalent(noDevice);
ok(!r4.available && /没有晶体管/.test(r4.reason), `无管应拒绝：${r4.available ? '可用' : r4.reason}`);

const zeroIc = structuredClone(base);
zeroIc.nodes.find((node) => node.kind === 'npn').value = 0;
const r5 = deriveAcEquivalent(zeroIc);
ok(!r5.available && /Ic/.test(r5.reason), `Ic=0 应拒绝并点名 Ic：${r5.available ? '可用' : r5.reason}`);

const withDiode = structuredClone(base);
withDiode.nodes.push({ id: 'n-d1', x: 700, y: 420, kind: 'diode', label: 'D1' });
const r6 = deriveAcEquivalent(withDiode);
ok(!r6.available && /二极管/.test(r6.reason), `含二极管应拒绝：${r6.available ? '可用' : r6.reason}`);

/* ── ④ 纯读：不修改输入图 ───────────────────────────────────── */

const copy = structuredClone(base);
deriveAcEquivalent(copy);
ok(JSON.stringify(copy) === JSON.stringify(base), 'deriveAcEquivalent 修改了输入图（应为纯函数）');

/* ── 汇总 ───────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`✗ ac-equivalent 门禁失败 ${failures.length} / ${assertions} 项：`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`✓ ac-equivalent 门禁通过（${assertions} 项）`);
