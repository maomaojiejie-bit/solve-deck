/**
 * MOSFET 放大器的「器件级」电路（等效前的原电路）。
 *
 * 与 `analogLayouts.ts` 的 `mosLayout`（小信号等效电路）共用外部网络坐标：
 * 漏极母线 y=164、VDD 交流地横杠 y=76、地轨 y=470、Rd 列 560、Rl 列 700。
 *
 * - CS：G 在左（输入）、S 向下接地、D 向上到母线（输出）；
 * - CG：管子旋转 90°，S 在左（输入）、G 向上交流接地、D 在右（输出）；
 * - CD：G 在左（输入）、D 向上交流接地、S 在右/下（输出，源极跟随）。
 */

import type { Layout } from './types';
import { board, type Board } from './schematicBoard.ts';

const GND_Y = 470;
const BUS_Y = 164;
const VDD_Y = 76;

type Lb = (id: string, fallback: string) => string;

export interface MosAmpLabels {
  [id: string]: string;
}

function makeLb(labels: MosAmpLabels): Lb {
  return (id, fallback) => labels[id] ?? fallback;
}

function groundRail(b: Board, x0: number, x1: number, gndAt: number) {
  b.wire('e-gnd-rail', [
    [x0, GND_Y],
    [x1, GND_Y],
  ], { weight: 2 });
  b.part('n-gnd', 'gnd', [gndAt, GND_Y], { labelSide: 'down' });
}

function acBar(
  b: Board,
  id: string,
  x: number,
  y: number,
  text: string,
  side: 'right' | 'left' = 'right',
) {
  b.wire(`e-${id}-bar`, [
    [x - 26, y],
    [x + 26, y],
  ], { weight: 2 });
  b.text(`t-${id}`, [side === 'left' ? x - 34 : x + 34, y], text, side);
}

/* ------------------------------------------------------------------ 共源 CS */

function ampCS(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  const m = b.part('n-q', 'nmos', [480, 270], { label: 'M', labelSide: 'right' });
  b.part('n-rd', 'res', [560, 120], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'right' });
  const rl = b.part('n-rl', 'res', [700, 290], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-g', [rs.pin('b'), m.pin('g')]);
  b.wire('e-dbus', [
    [490, BUS_Y],
    [700, BUS_Y],
  ], { weight: 2 });
  b.wire('e-d-bus', [m.pin('d'), [490, BUS_Y]]);
  acBar(b, 'vdd', 560, VDD_Y, 'VDD（交流地）');
  b.wire('e-s-gnd', [m.pin('s'), [490, GND_Y]]);
  b.wire('e-rl-bus', [
    [700, BUS_Y],
    rl.pin('a'),
  ]);
  b.wire('e-rl-gnd', [rl.pin('b'), [700, GND_Y]]);
  b.wire('e-out', [
    [700, BUS_Y],
    [762, BUS_Y],
  ], { tag: 'Vo' });

  b.dot('d-dbus', [490, BUS_Y]);
  b.dot('d-rd-bus', [560, BUS_Y]);
  b.dot('d-s-gnd', [490, GND_Y]);
  groundRail(b, 160, 700, 340);
  b.text('t-note', [520, 516], 'S 经旁路电容交流接地；Rd 由 VDD 侧改挂到交流地', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

/* ------------------------------------------------------------------ 共栅 CG */

function ampCG(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 390], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 320], { label: 'Rs', labelSide: 'up' });
  // 专用横置画法：g 朝上、d 朝右、s 朝左（避免把竖版符号整体转 90° 后引线绞在一起）
  const m = b.part('n-q', 'nmos-r90', [480, 310], { label: 'M', labelSide: 'right' });
  b.part('n-rd', 'res', [560, 120], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'right' });
  const rl = b.part('n-rl', 'res', [700, 290], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 320], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-s', [rs.pin('b'), m.pin('s')]);
  b.wire('e-g-ac', [m.pin('g'), [480, 120]]);
  acBar(b, 'g-ac', 480, 120, 'G 交流地', 'left');
  b.dot('d-g-ac', [480, 120]);
  b.wire('e-dbus', [
    [560, BUS_Y],
    [700, BUS_Y],
  ], { weight: 2 });
  b.wire('e-d-bus', [
    m.pin('d'),
    [600, 320],
    [600, BUS_Y],
  ]);
  acBar(b, 'vdd', 560, VDD_Y, 'VDD（交流地）');
  b.wire('e-rl-bus', [
    [700, BUS_Y],
    rl.pin('a'),
  ]);
  b.wire('e-rl-gnd', [rl.pin('b'), [700, GND_Y]]);
  b.wire('e-out', [
    [700, BUS_Y],
    [762, BUS_Y],
  ], { tag: 'Vo' });

  b.dot('d-dbus', [600, BUS_Y]);
  b.dot('d-rd-bus', [560, BUS_Y]);
  groundRail(b, 160, 700, 340);
  b.text('t-note', [520, 516], '输入改接到 S，G 交流接地，输出仍取 D', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

/* ------------------------------------------------------------------ 共漏 CD */

function ampCD(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  const m = b.part('n-q', 'nmos', [480, 270], { label: 'M', labelSide: 'up' });
  const rss = b.part('n-rl', 'res', [620, 390], { rot: 90, label: lb('n-rl', 'Rss'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-g', [rs.pin('b'), m.pin('g')]);
  // D 经 Rd 接到 VDD（交流地），Rd 不能省：它与 ro 并联影响输出电阻
  b.part('n-rd', 'res', [560, 120], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'left' });
  b.wire('e-dbus', [
    [490, BUS_Y],
    [560, BUS_Y],
  ], { weight: 2 });
  b.wire('e-d-bus', [m.pin('d'), [490, BUS_Y]]);
  acBar(b, 'vdd', 560, VDD_Y, 'VDD（交流地）');
  b.wire('e-s-out', [
    m.pin('s'),
    [620, 320],
    [620, 346],
  ], { tag: 'Vo' });
  b.wire('e-rss-gnd', [rss.pin('b'), [620, GND_Y]]);
  b.dot('d-rss-gnd', [620, GND_Y]);

  groundRail(b, 160, 700, 340);
  b.text('t-note', [360, 516], '输入 G，输出 S（源极跟随）；Rd 与 ro 并联决定 Ro', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

export type MosAmpConfig = 'CS' | 'CG' | 'CD';

export function mosAmpLayout(config: MosAmpConfig, labels: MosAmpLabels = {}): Layout {
  const lb = makeLb(labels);
  if (config === 'CG') return ampCG(lb);
  if (config === 'CD') return ampCD(lb);
  return ampCS(lb);
}
