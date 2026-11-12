/**
 * 模拟电路的积木布局：只摆位置，不画线。
 *
 * 每个函数产出一份 { nodes, edges }，节点是「器件 / 端子 / 连接点」，边是折线导线。
 * 三条硬规矩（改版前这版全违反了）：
 * 1. 导线端点只能来自 `part().pin()`，绝不接到器件中心；
 * 2. 每个电路必须是**闭合回路**：电源一端经元件回到另一端，地上有地符号；
 * 3. 竖放的电阻/电源一律 rot=90，不允许把横向符号画在竖直线上。
 *
 * 三种组态真的是三种拓扑，不是换标签：
 * - CE：输入 B，E 接地，输出 C；
 * - CB：输入 E，B 交流接地，输出 C；
 * - CC：输入 B，C 接交流地，输出 E。
 */

import type { Layout } from './types';
import { board, type Board } from './schematicBoard.ts';

type Lb = (id: string, fallback: string) => string;

export interface Labels {
  [id: string]: string;
}

function makeLb(labels: Labels): Lb {
  return (id, fallback) => labels[id] ?? fallback;
}

const GND_Y = 470;

/** 顶端交流地横杠（VCC / VDD 在小信号模型里就是交流地）。 */
function acRail(b: Board, id: string, x: number, y: number, text: string) {
  b.wire(`e-${id}-bar`, [
    [x - 26, y],
    [x + 26, y],
  ], { weight: 2 });
  b.text(`t-${id}`, [x + 34, y], text, 'right');
}

function groundRail(
  b: Board,
  x0: number,
  x1: number,
  gndAt: number,
  gndLabelSide: 'up' | 'down' | 'left' | 'right' = 'right',
  prefix = '',
) {
  b.wire(`${prefix}e-gnd-rail`, [
    [x0, GND_Y],
    [x1, GND_Y],
  ], { weight: 2 });
  b.part(`${prefix}n-gnd`, 'gnd', [gndAt, GND_Y], { labelSide: gndLabelSide });
}

/* ------------------------------------------------------------------ BJT π 模型 */

function bjtCE(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-b', [340, 270]);
  b.text('pi-t-b', [340, 244], 'B');
  b.part('pi-n-rpi', 'res', [340, 380], { rot: 90, label: 'rπ', labelSide: 'left' });
  b.part('pi-n-gm', 'ctrlsrc', [480, 290], { label: lb('n-gm', 'gm·vbe'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [660, 290], { rot: 90, label: lb('n-ro', 'ro'), labelSide: 'right' });
  b.part('pi-n-rc', 'res', [440, 120], { rot: 90, label: lb('n-rc', 'Rc'), labelSide: 'left' });
  b.part('pi-n-rl', 'res', [770, 290], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('pi-e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('pi-e-rs-b', [rs.pin('b'), [340, 270]]);
  b.wire('pi-e-b-rpi', [
    [340, 270],
    [340, 336],
  ]);
  b.wire('pi-e-rpi-gnd', [
    [340, 424],
    [340, GND_Y],
  ]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  // 集电极母线
  b.wire('pi-e-cbus', [
    [440, 164],
    [770, 164],
  ], { weight: 2 });
  acRail(b, 'pi-vcc', 440, 76, 'VCC（交流地）');
  b.wire('pi-e-gm-c', [
    [480, 164],
    [480, 246],
  ]);
  b.wire('pi-e-gm-e', [
    [480, 334],
    [480, GND_Y],
  ]);
  b.wire('pi-e-ro-c', [
    [660, 164],
    [660, 246],
  ]);
  b.wire('pi-e-ro-e', [
    [660, 334],
    [660, GND_Y],
  ]);
  b.wire('pi-e-rl-c', [
    [770, 164],
    [770, 246],
  ]);
  b.wire('pi-e-rl-e', [
    [770, 334],
    [770, GND_Y],
  ]);
  b.dot('pi-d-c480', [480, 164]);
  b.dot('pi-d-c580', [660, 164]);
  b.dot('pi-d-g480', [480, GND_Y]);
  b.dot('pi-d-g580', [660, GND_Y]);
  b.wire('pi-e-out', [
    [770, 164],
    [832, 164],
  ], { tag: 'Vo' });
  // 控制量：vbe 只是标注线，用虚线，不是导线
  b.wire('pi-e-vbe', [
    [340, 290],
    [454, 290],
  ], { dashed: true, label: 'vbe' });
  groundRail(b, 160, 770, 340, 'down', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

function bjtCB(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [160, 390], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [250, 310], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-e', [340, 310]);
  b.text('pi-t-e', [340, 286], 'E');
  b.part('pi-n-rpi', 'res', [340, 400], { rot: 90, label: 'rπ', labelSide: 'left' });
  b.part('pi-n-gm', 'ctrlsrc', [480, 230], { label: lb('n-gm', 'gm·vbe'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [660, 230], { rot: 90 });
  b.text('pi-t-ro', [600, 360], lb('n-ro', 'ro'), 'right');
  b.part('pi-n-rc', 'res', [440, 110], { rot: 90, label: lb('n-rc', 'Rc'), labelSide: 'left' });
  b.part('pi-n-rl', 'res', [680, 390], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('pi-e-in', [vs.pin('p'), [160, 310], rs.pin('a')]);
  b.wire('pi-e-rs-e', [rs.pin('b'), [340, 310]]);
  b.wire('pi-e-e-rpi', [
    [340, 310],
    [340, 356],
  ]);
  b.wire('pi-e-rpi-gnd', [
    [340, 444],
    [340, GND_Y],
  ]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  // 发射极母线（输入侧）
  b.wire('pi-e-eline', [
    [340, 310],
    [660, 310],
  ], { weight: 2 });
  b.wire('pi-e-cbus', [
    [440, 154],
    [680, 154],
  ], { weight: 2 });
  acRail(b, 'pi-vcc', 440, 66, 'VCC（交流地）');
  b.wire('pi-e-gm-c', [
    [480, 154],
    [480, 186],
  ]);
  b.wire('pi-e-gm-e', [
    [480, 274],
    [480, 310],
  ]);
  b.wire('pi-e-ro-c', [
    [660, 154],
    [660, 186],
  ]);
  b.wire('pi-e-ro-e', [
    [660, 274],
    [660, 310],
  ]);
  b.wire('pi-e-rl-c', [
    [680, 154],
    [680, 346],
  ]);
  b.wire('pi-e-rl-e', [
    [680, 434],
    [680, GND_Y],
  ]);
  b.dot('pi-d-c480', [480, 154]);
  b.dot('pi-d-c580', [660, 154]);
  b.dot('pi-d-c680', [680, 154]);
  b.dot('pi-d-e480', [480, 310]);
  b.dot('pi-d-e580', [660, 310]);
  b.wire('pi-e-out', [
    [680, 154],
    [742, 154],
  ], { tag: 'Vo' });
  b.text('pi-t-bgnd', [318, 446], 'B 交流接地', 'left');
  b.wire('pi-e-vbe', [
    [380, 310],
    [380, 230],
    [454, 230],
  ], { dashed: true, label: 'vbe' });
  groundRail(b, 160, 680, 340, 'right', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

function bjtCC(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [160, 390], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [250, 210], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-b', [340, 210]);
  b.text('pi-t-b', [340, 186], 'B');
  b.part('pi-n-rpi', 'res', [340, 296], { rot: 90, label: 'rπ', labelSide: 'left' });
  b.dot('pi-n-e', [340, 340]);
  b.text('pi-t-e', [316, 340], 'E', 'left');
  b.part('pi-n-gm', 'ctrlsrc', [480, 247], { label: lb('n-gm', 'gm·vbe'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [620, 247], { rot: 90, label: lb('n-ro', 'ro'), labelSide: 'right' });
  b.part('pi-n-rl', 'res', [340, 410], { rot: 90, label: lb('n-rl', 'Re'), labelSide: 'left' });

  b.wire('pi-e-in', [vs.pin('p'), [160, 210], rs.pin('a')]);
  b.wire('pi-e-rs-b', [rs.pin('b'), [340, 210]]);
  b.wire('pi-e-b-rpi', [
    [340, 210],
    [340, 252],
  ]);
  b.wire('pi-e-e-re', [
    [340, 340],
    [340, 366],
  ]);
  b.wire('pi-e-re-gnd', [
    [340, 454],
    [340, GND_Y],
  ]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  // 发射极母线（输出侧）
  b.wire('pi-e-eline', [
    [340, 340],
    [660, 340],
  ], { weight: 2 });
  // 集电极接交流地：CC 的 C 在交流通路里接地
  b.wire('pi-e-cbus', [
    [480, 154],
    [660, 154],
  ], { weight: 2 });
  b.wire('pi-e-c-ac', [
    [480, 96],
    [480, 154],
  ]);
  acRail(b, 'pi-vcc', 480, 96, 'C 交流地（CC）');
  b.dot('pi-d-c-ac', [480, 96]);
  b.dot('pi-d-c480', [480, 154]);
  b.dot('pi-d-c620', [620, 154]);
  b.wire('pi-e-gm-c', [
    [480, 154],
    [480, 203],
  ]);
  b.wire('pi-e-gm-e', [
    [480, 291],
    [480, 340],
  ]);
  b.wire('pi-e-ro-c', [
    [620, 154],
    [620, 203],
  ]);
  b.wire('pi-e-ro-e', [
    [620, 291],
    [620, 340],
  ]);
  b.dot('pi-d-e480', [480, 340]);
  b.dot('pi-d-e580', [620, 340]);
  b.dot('pi-d-e660', [660, 340]);
  b.wire('pi-e-out', [
    [660, 340],
    [722, 340],
  ], { tag: 'Vo' });
  b.wire('pi-e-vbe', [
    [400, 340],
    [400, 247],
    [454, 247],
  ], { dashed: true, label: 'vbe' });
  b.dot('pi-d-re-gnd', [340, GND_Y]);
  groundRail(b, 160, 660, 420, 'right', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

export function bjtPiLayout(config: 'CE' | 'CB' | 'CC', labels: Labels): Layout {
  const lb = makeLb(labels);
  if (config === 'CB') return bjtCB(lb);
  if (config === 'CC') return bjtCC(lb);
  return bjtCE(lb);
}

/* --------------------------------------------------------------- MOS π 模型 */

function mosCS(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [160, 380], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [250, 270], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-g', [340, 270]);
  b.text('pi-t-g', [340, 244], 'G');
  b.part('pi-n-gm', 'ctrlsrc', [480, 270], { label: lb('n-gm', 'gm·vgs'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [660, 270], { rot: 90, label: lb('n-ro', 'ro'), labelSide: 'right' });
  b.part('pi-n-rd', 'res', [440, 120], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'left' });
  b.part('pi-n-rl', 'res', [770, 270], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('pi-e-in', [vs.pin('p'), [160, 270], rs.pin('a')]);
  b.wire('pi-e-rs-g', [rs.pin('b'), [340, 270]]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.wire('pi-e-dbus', [
    [440, 164],
    [770, 164],
  ], { weight: 2 });
  acRail(b, 'pi-vdd', 440, 76, 'VDD（交流地）');
  b.wire('pi-e-gm-d', [
    [480, 164],
    [480, 226],
  ]);
  b.wire('pi-e-gm-s', [
    [480, 314],
    [480, GND_Y],
  ]);
  b.wire('pi-e-ro-d', [
    [660, 164],
    [660, 226],
  ]);
  b.wire('pi-e-ro-s', [
    [660, 314],
    [660, GND_Y],
  ]);
  b.wire('pi-e-rl-d', [
    [770, 164],
    [770, 226],
  ]);
  b.wire('pi-e-rl-s', [
    [770, 314],
    [770, GND_Y],
  ]);
  b.dot('pi-d-d480', [480, 164]);
  b.dot('pi-d-d580', [660, 164]);
  b.dot('pi-d-s480', [480, GND_Y]);
  b.dot('pi-d-s580', [660, GND_Y]);
  b.wire('pi-e-out', [
    [770, 164],
    [832, 164],
  ], { tag: 'Vo' });
  // 栅极在理想模型里不取电流：控制线是标注，用虚线
  b.wire('pi-e-vgs', [
    [340, 270],
    [454, 270],
  ], { dashed: true, label: 'vgs' });
  groundRail(b, 160, 770, 340, 'down', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

function mosCG(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [140, 390], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [230, 310], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-s', [380, 310]);
  b.text('pi-t-s', [380, 286], 'S');
  b.part('pi-n-gm', 'ctrlsrc', [480, 230], { label: lb('n-gm', 'gm·vgs'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [560, 230], { rot: 90 });
  b.text('pi-t-ro', [590, 320], lb('n-ro', 'ro'), 'right');
  b.part('pi-n-rd', 'res', [660, 110], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'right' });
  b.part('pi-n-rl', 'res', [660, 390], { rot: 90, label: lb('n-rl', 'Rl'), labelSide: 'right' });

  b.wire('pi-e-in', [vs.pin('p'), [140, 310], rs.pin('a')]);
  b.wire('pi-e-rs-s', [rs.pin('b'), [380, 310]]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [140, GND_Y]]);
  // 源极母线：gm 下端、ro 下端、S 都汇到这里
  b.wire('pi-e-sbus', [
    [380, 374],
    [580, 374],
  ], { weight: 2 });
  b.wire('pi-e-s-down', [
    [380, 310],
    [380, 374],
  ]);
  b.wire('pi-e-dbus', [
    [480, 154],
    [660, 154],
  ], { weight: 2 });
  b.wire('pi-e-gm-d', [
    [480, 154],
    [480, 186],
  ]);
  b.wire('pi-e-gm-s', [
    [480, 274],
    [480, 374],
  ]);
  b.wire('pi-e-ro-d', [
    [560, 154],
    [560, 186],
  ]);
  b.wire('pi-e-ro-s', [
    [560, 274],
    [560, 374],
  ]);
  b.dot('pi-d-d480', [480, 154]);
  b.dot('pi-d-d580', [560, 154]);
  b.dot('pi-d-d660', [660, 154]);
  b.dot('pi-d-s480', [480, 374]);
  b.dot('pi-d-s580', [560, 374]);
  // Rd：漏极母线上方接 VDD（交流地）
  acRail(b, 'pi-vdd', 660, 66, 'VDD（交流地）');
  // Rl：漏极母线下方到地
  b.wire('pi-e-rl-d', [
    [660, 154],
    [660, 346],
  ]);
  b.wire('pi-e-rl-s', [
    [660, 434],
    [660, GND_Y],
  ]);
  b.wire('pi-e-out', [
    [660, 154],
    [722, 154],
  ], { tag: 'Vo' });
  // 栅极交流接地：地从上方下来，末段用虚线接到受控源
  acRail(b, 'pi-g-ac', 300, 150, 'G 交流地');
  b.dot('pi-d-g-ac', [300, 150]);
  b.wire('pi-e-g-gnd', [
    [300, 150],
    [300, 230],
    [400, 230],
  ]);
  b.wire('pi-e-vgs', [
    [400, 230],
    [454, 230],
  ], { dashed: true, label: 'vgs' });
  groundRail(b, 140, 660, 240, 'right', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

function mosCD(lb: Lb): Layout {
  const b = board();
  const vs = b.part('pi-n-vs', 'vsrc', [160, 300], { label: lb('n-vs', 'vs'), labelSide: 'left' });
  const rs = b.part('pi-n-rs', 'res', [250, 240], { label: 'Rs', labelSide: 'up' });
  b.dot('pi-n-g', [340, 240]);
  b.text('pi-t-g', [340, 216], 'G');
  b.part('pi-n-gm', 'ctrlsrc', [480, 240], { label: lb('n-gm', 'gm·vgs'), labelSide: 'right' });
  b.part('pi-n-ro', 'res', [620, 240], { rot: 90, label: lb('n-ro', 'ro'), labelSide: 'right' });
  b.part('pi-n-rd', 'res', [660, 106], { rot: 90, label: lb('n-rd', 'Rd'), labelSide: 'right' });
  b.part('pi-n-rl', 'res', [660, 410], { rot: 90, label: lb('n-rl', 'Rss'), labelSide: 'right' });

  b.wire('pi-e-in', [vs.pin('p'), [160, 240], rs.pin('a')]);
  b.wire('pi-e-rs-g', [rs.pin('b'), [340, 240]]);
  b.wire('pi-e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  // 漏极母线：Rd 下端 + 受控源/ro 上端
  b.wire('pi-e-dbus', [
    [480, 150],
    [660, 150],
  ], { weight: 2 });
  acRail(b, 'pi-vdd', 660, 62, 'VDD（交流地）');
  b.wire('pi-e-gm-d', [
    [480, 150],
    [480, 196],
  ]);
  b.wire('pi-e-ro-d', [
    [620, 150],
    [620, 196],
  ]);
  b.dot('pi-d-d480', [480, 150]);
  b.dot('pi-d-d580', [620, 150]);
  b.dot('pi-d-d660', [660, 150]);
  // 源极母线 = 输出
  b.wire('pi-e-sbus', [
    [340, 340],
    [660, 340],
  ], { weight: 2 });
  b.wire('pi-e-gm-s', [
    [480, 284],
    [480, 340],
  ]);
  b.wire('pi-e-ro-s', [
    [620, 284],
    [620, 340],
  ]);
  b.dot('pi-d-s480', [480, 340]);
  b.dot('pi-d-s580', [620, 340]);
  b.dot('pi-d-s660', [660, 340]);
  b.wire('pi-e-rl-s', [
    [660, 340],
    [660, 366],
  ]);
  b.wire('pi-e-rl-gnd', [
    [660, 454],
    [660, GND_Y],
  ]);
  b.wire('pi-e-out', [
    [660, 340],
    [722, 340],
  ], { tag: 'Vo' });
  b.wire('pi-e-vgs', [
    [340, 240],
    [454, 240],
  ], { dashed: true, label: 'vgs' });
  groundRail(b, 160, 660, 380, 'right', 'pi-');
  return { nodes: b.nodes, edges: b.edges };
}

export function mosLayout(config: 'CS' | 'CG' | 'CD', labels: Labels): Layout {
  const lb = makeLb(labels);
  if (config === 'CG') return mosCG(lb);
  if (config === 'CD') return mosCD(lb);
  return mosCS(lb);
}

/* ------------------------------------------------------------------- 运放 */

export function opampLayout(topology: 'inverting' | 'noninverting', labels: Labels): Layout {
  const lb = makeLb(labels);
  const b = board();
  const inv = topology === 'inverting';
  const op = b.part('n-op', 'opamp', [560, 265], { label: lb('n-aol', 'A'), labelSide: 'up' });
  const r2 = b.part('n-r2', 'res', [530, 140], { label: lb('n-r2', 'R2'), labelSide: 'up' });

  if (inv) {
    const vin = b.part('n-vin', 'vsrc', [200, 368], { label: lb('n-vin', 'Vin'), labelSide: 'left' });
    const r1 = b.part('n-r1', 'res', [300, 248], { label: lb('n-r1', 'R1'), labelSide: 'up' });
    b.dot('n-vn', [400, 248]);
    b.text('t-vn', [396, 226], 'Vn', 'left');
    b.wire('e-in', [vin.pin('p'), [200, 248], r1.pin('a')]);
    b.wire('e-r1-vn', [r1.pin('b'), [400, 248]]);
    b.wire('e-n-op', [op.pin('inm'), [400, 248]], { });
    // 反馈：Vn 上绕，过 R2，回到输出
    b.wire('e-vn-up', [
      [400, 248],
      [400, 140],
      r2.pin('a'),
    ]);
    b.wire('e-r2-out', [
      r2.pin('b'),
      [660, 140],
      [660, 265],
      op.pin('out'),
    ]);
    b.wire('e-vs-gnd', [vin.pin('n'), [200, GND_Y]]);
    b.wire('e-gnd-op', [op.pin('inp'), [517.5, GND_Y]], { });
    b.wire('e-out', [
      [660, 265],
      [710, 265],
    ], { tag: 'Vo' });
    b.dot('n-out', [660, 265], lb('n-out', ''));
    groundRail(b, 200, 710, 517.5);
    b.dot('d-gnd-op', [517.5, GND_Y]);
  } else {
    const vin = b.part('n-vin', 'vsrc', [500, 410], { label: lb('n-vin', 'Vin'), labelSide: 'right' });
    const r1 = b.part('n-r1', 'res', [430, 360], { rot: 90, label: lb('n-r1', 'R1'), labelSide: 'left' });
    b.dot('n-vn', [430, 248]);
    b.text('t-vn', [426, 226], 'Vn', 'left');
    b.wire('e-n-op', [op.pin('inm'), [430, 248]], { });
    b.wire('e-vn-r1', [[430, 248], r1.pin('a')]);
    b.wire('e-r1-gnd', [r1.pin('b'), [430, GND_Y]]);
    b.wire('e-vn-up', [
      [430, 248],
      [430, 140],
      r2.pin('a'),
    ]);
    b.wire('e-r2-out', [
      r2.pin('b'),
      [660, 140],
      [660, 265],
      op.pin('out'),
    ]);
    b.wire('e-in', [vin.pin('p'), [500, 282], op.pin('inp')], { });
    b.wire('e-vs-gnd', [vin.pin('n'), [500, GND_Y]]);
    b.wire('e-out', [
      [660, 265],
      [710, 265],
    ], { tag: 'Vo' });
    b.dot('n-out', [660, 265], lb('n-out', ''));
    groundRail(b, 200, 710, 430);
    b.dot('d-gnd-r1', [430, GND_Y]);
  }
  return { nodes: b.nodes, edges: b.edges };
}

/* ------------------------------------------------------------------ 反馈框图 */

export function feedbackLayout(labels: Labels): Layout {
  const lb = makeLb(labels);
  const b = board();
  const vs = b.part('n-vs', 'vsrc', [160, 350], { label: 'Vs', labelSide: 'left' });
  const rin = b.part('n-rin', 'res', [270, 250], { label: lb('n-rin', 'Rin'), labelSide: 'up' });
  const sum = b.part('n-sum', 'sum', [400, 250], {});
  const amp = b.part('n-amp', 'block', [520, 250], { label: lb('n-amp', 'A') });
  const rout = b.part('n-rout', 'res', [630, 250], { label: lb('n-rout', 'Rout'), labelSide: 'up' });
  const fb = b.part('n-fb', 'block', [520, 400], { label: lb('n-fb', 'β') });
  const rl = b.part('n-rl', 'res', [880, 350], { rot: 90, label: 'Rl', labelSide: 'right' });

  b.wire('e-in', [vs.pin('p'), [160, 250], rin.pin('a')]);
  b.wire('e-rin-sum', [rin.pin('b'), sum.pin('in')]);
  b.wire('e-sum-amp', [sum.pin('out'), amp.pin('in')]);
  b.wire('e-amp-rout', [amp.pin('out'), rout.pin('a')]);
  b.wire('e-rout-out', [rout.pin('b'), [760, 250]]);
  b.dot('n-out', [760, 250], lb('n-out', ''));
  b.wire('e-out', [
    [760, 250],
    [880, 250],
    rl.pin('a'),
  ], { tag: 'Vo' });
  b.wire('e-rl-gnd', [
    rl.pin('b'),
    [880, GND_Y],
  ]);
  // 反馈支路：输出 → β → 求和点的 − 端
  b.wire('e-out-fb', [
    [760, 250],
    [760, 440],
    [620, 440],
    [620, 400],
    fb.pin('out'),
  ]);
  b.wire('e-fb-sum', [
    fb.pin('in'),
    [400, 400],
    [400, 294],
  ]);
  b.dot('d-fb', [400, 400]);
  b.wire('e-vs-gnd', [vs.pin('n'), [160, GND_Y]]);
  b.text('t-fb', [400, 440], '负反馈：β 取输出的一部分回到求和点', 'left');
  groundRail(b, 160, 880, 400);
  b.dot('d-gnd-880', [880, GND_Y]);
  return { nodes: b.nodes, edges: b.edges };
}
