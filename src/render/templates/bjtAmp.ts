/**
 * BJT 放大器的「器件级」电路（等效前的原电路）。
 *
 * 和 π 模型（`analogLayouts.ts` 的 `bjtPiLayout`）**共用同一套外部网络的坐标**：
 * 集电极母线 y=164、VCC 交流地横杠 y=76、地轨 y=470、Rc 列 560、Rl 列 700。
 * 所以两张图上下摆在一起时，读者看到的是「同一张图，中间那块晶体管被换掉了」。
 *
 * 三种组态是真的三种朝向，不是换标签：
 * - CE：B 在左（输入）、E 向下接地、C 向上到母线（输出）；
 * - CB：晶体管旋转 90°，E 在左（输入）、B 向上交流接地、C 在右（输出）；
 * - CC：B 在左（输入）、C 向上交流接地、E 在右/下（输出）。
 */

import type { Layout } from './types';
import { board, type Board } from './schematicBoard.ts';

const GND_Y = 470;
const BUS_Y = 164;
const VCC_Y = 76;

type Lb = (id: string, fallback: string) => string;

export interface AmpLabels {
  [id: string]: string;
}

function makeLb(labels: AmpLabels): Lb {
  return (id, fallback) => labels[id] ?? fallback;
}

function groundRail(b: Board, x0: number, x1: number, gndAt: number) {
  b.wire('e-gnd-rail', [
    [x0, GND_Y],
    [x1, GND_Y],
  ], { weight: 2 });
  b.part('n-gnd', 'gnd', [gndAt, GND_Y], { labelSide: 'down' });
}

/** 顶端交流地横杠：小信号里 VCC 就是交流地。标签默认在横杠右侧。 */
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

/* ------------------------------------------------------------------ 共射 CE */

function ampCE(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  const q = b.part('n-q', 'npn', [480, 270], { label: 'Q', labelSide: 'right' });
  b.part('n-rc', 'res', [560, 120], { rot: 90, label: lb('n-rc', 'Rc'), labelSide: 'right' });
  const rl = b.part('n-rl', 'res', [700, 290], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-q', [rs.pin('b'), q.pin('b')]);
  // 集电极母线
  b.wire('e-cbus', [
    [488.8, BUS_Y],
    [700, BUS_Y],
  ], { weight: 2 });
  b.wire('e-c-bus', [q.pin('c'), [488.8, BUS_Y]]);
  acBar(b, 'vcc', 560, VCC_Y, 'VCC（交流地）');
  b.wire('e-e-gnd', [q.pin('e'), [488.8, GND_Y]]);
  b.wire('e-rl-bus', [
    [700, BUS_Y],
    rl.pin('a'),
  ]);
  b.wire('e-rl-gnd', [rl.pin('b'), [700, GND_Y]]);
  b.wire('e-out', [
    [700, BUS_Y],
    [762, BUS_Y],
  ], { tag: 'Vo' });

  b.dot('d-cbus', [488.8, BUS_Y]);
  b.dot('d-rc-bus', [560, BUS_Y]);
  b.dot('d-e-gnd', [488.8, GND_Y]);
  groundRail(b, 160, 700, 340);
  // E 是交流地：Re 已被 Ce 旁路
  b.text('t-note', [520, 516], 'E 经 Ce 旁路 → 交流接地；Rc 由 VCC 侧改挂到交流地', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

/* ------------------------------------------------------------------ 共基 CB */

function ampCB(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 390], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 318.8], { label: 'Rs', labelSide: 'up' });
  // 旋转 90°：b 朝上、c 朝右、e 朝左
  const q = b.part('n-q', 'npn', [480, 310], { rot: 90, label: 'Q', labelSide: 'right' });
  b.part('n-rc', 'res', [560, 120], { rot: 90, label: lb('n-rc', 'Rc'), labelSide: 'right' });
  const rl = b.part('n-rl', 'res', [700, 290], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 318.8], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-q', [rs.pin('b'), q.pin('e')]);
  // B 交流接地
  b.wire('e-b-ac', [q.pin('b'), [480, 120]]);
  acBar(b, 'b-ac', 480, 120, 'B 交流地', 'left');
  b.dot('d-b-ac', [480, 120]);
  // C → 母线 → 输出
  b.wire('e-cbus', [
    [560, BUS_Y],
    [700, BUS_Y],
  ], { weight: 2 });
  b.wire('e-c-bus', [
    q.pin('c'),
    [600, 318.8],
    [600, BUS_Y],
  ]);
  acBar(b, 'vcc', 560, VCC_Y, 'VCC（交流地）');
  b.wire('e-rl-bus', [
    [700, BUS_Y],
    rl.pin('a'),
  ]);
  b.wire('e-rl-gnd', [rl.pin('b'), [700, GND_Y]]);
  b.wire('e-out', [
    [700, BUS_Y],
    [762, BUS_Y],
  ], { tag: 'Vo' });

  b.dot('d-cbus', [600, BUS_Y]);
  b.dot('d-rc-bus', [560, BUS_Y]);
  groundRail(b, 160, 700, 340);
  b.text('t-note', [520, 516], '输入改接到 E，B 经大电容交流接地，输出仍取 C', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

/* ------------------------------------------------------------------ 共集 CC */

function ampCC(lb: Lb): Layout {
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'Vs'), labelSide: 'left' });
  const rs = b.part('n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  const q = b.part('n-q', 'npn', [480, 270], { label: 'Q', labelSide: 'up' });
  const re = b.part('n-rl', 'res', [620, 390], { rot: 90, label: lb('n-rl', 'Re'), labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('e-rs-q', [rs.pin('b'), q.pin('b')]);
  // C 交流接地
  b.wire('e-c-ac', [q.pin('c'), [488.8, 96]]);
  acBar(b, 'c-ac', 488.8, 96, 'C 交流地（CC）');
  b.dot('d-c-ac', [488.8, 96]);
  // E → 输出 → Re → 地
  b.wire('e-e-out', [
    q.pin('e'),
    [620, 314],
    [620, 346],
  ], { tag: 'Vo' });
  b.wire('e-re-gnd', [re.pin('b'), [620, GND_Y]]);
  b.dot('d-re-gnd', [620, GND_Y]);

  groundRail(b, 160, 700, 340);
  b.text('t-note', [520, 516], '输入 B，输出 E（射极跟随）；C 接交流地，无 Rc', 'right');
  return { nodes: b.nodes, edges: b.edges };
}

export type BjtAmpConfig = 'CE' | 'CB' | 'CC';

export function bjtAmpLayout(config: BjtAmpConfig, labels: AmpLabels = {}): Layout {
  const lb = makeLb(labels);
  if (config === 'CB') return ampCB(lb);
  if (config === 'CC') return ampCC(lb);
  return ampCE(lb);
}
