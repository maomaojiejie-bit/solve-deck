/**
 * 统一图元注册表 —— SymbolDef[] 单一注册源（设计稿第 4 / 6 / 7 节）。
 *
 * 坐标全部写死在这里，运行时不从 SVG 解析：
 *  - pins：电路连线端点；
 *  - anchors：力学吸附点；
 *  - highlightable：SVG 内部 path/group id，单步点亮用。
 *
 * 旋转：SVG 按 viewBox 中心做 90° 整数倍顺时针变换；实例旋转用 rotateSymbolPoint
 * 得到预计算坐标，与渲染层的 transform 使用同一矩阵。
 */

import type { Rotation, SymbolAnchor, SymbolDef, SymbolPin } from '../types';

const E = 'electronics/';
const M = 'mechanics/';

const twoTerminal = (id: string, file: string, label: string, params: string[]) => ({
  id,
  family: 'electronics' as const,
  file: `${E}${file}`,
  viewBox: [0, 0, 100, 40] as [number, number, number, number],
  pins: [
    { id: 'a', x: 0, y: 20 },
    { id: 'b', x: 100, y: 20 },
  ],
  rotation: 0 as Rotation,
  highlightable: [] as string[],
  path: ['a', 'b'],
  params,
  label,
});

export const SYMBOL_REGISTRY: readonly SymbolDef[] = [
  /* ── electronics 电子族 ─────────────────────────────────────── */
  {
    ...twoTerminal('R', 'resistor.svg', '电阻', ['R']),
    highlightable: ['body'],
  },
  {
    ...twoTerminal('C', 'capacitor.svg', '电容', ['C']),
    highlightable: ['plate-a', 'plate-b'],
  },
  {
    ...twoTerminal('L', 'inductor.svg', '电感', ['L']),
    highlightable: ['coil'],
  },
  {
    ...twoTerminal('D', 'diode.svg', '二极管', ['Is', 'n']),
    highlightable: ['triangle', 'bar'],
  },
  {
    ...twoTerminal('LED', 'led.svg', '发光二极管', ['Vf', 'If']),
    highlightable: ['triangle', 'bar', 'arrow-1', 'arrow-2'],
  },
  {
    ...twoTerminal('V', 'voltage-source.svg', '电压源', ['V']),
    highlightable: ['shell', 'plus', 'minus'],
  },
  {
    ...twoTerminal('I', 'current-source.svg', '电流源', ['I']),
    highlightable: ['shell', 'arrow'],
  },
  {
    ...twoTerminal('SW', 'switch.svg', '开关', ['closed']),
    highlightable: ['blade'],
  },
  {
    id: 'GND',
    family: 'electronics',
    file: `${E}ground.svg`,
    viewBox: [0, 0, 60, 100],
    pins: [{ id: 'gnd', x: 30, y: 0 }],
    rotation: 0,
    highlightable: ['bars'],
    params: [],
    label: '地',
  },
  {
    id: 'NPN',
    family: 'electronics',
    file: `${E}npn.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'b', x: 0, y: 50 },
      { id: 'c', x: 60, y: 0 },
      { id: 'e', x: 60, y: 100 },
    ],
    rotation: 0,
    highlightable: ['shell', 'base-bar', 'collector', 'emitter', 'arrow'],
    params: ['beta', 'VBE'],
    label: 'NPN 三极管',
  },
  {
    id: 'PNP',
    family: 'electronics',
    file: `${E}pnp.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'b', x: 0, y: 50 },
      { id: 'c', x: 60, y: 100 },
      { id: 'e', x: 60, y: 0 },
    ],
    rotation: 0,
    highlightable: ['shell', 'base-bar', 'collector', 'emitter', 'arrow'],
    params: ['beta', 'VBE'],
    label: 'PNP 三极管',
  },
  {
    id: 'NMOS',
    family: 'electronics',
    file: `${E}nmos.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'g', x: 0, y: 50 },
      { id: 'd', x: 60, y: 0 },
      { id: 's', x: 60, y: 100 },
      { id: 'b', x: 100, y: 50 },
    ],
    rotation: 0,
    highlightable: ['gate', 'channel', 'drain', 'source', 'bulk', 'arrow'],
    params: ['Vth', 'Kn', 'lambda'],
    label: 'NMOS',
  },
  {
    id: 'PMOS',
    family: 'electronics',
    file: `${E}pmos.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'g', x: 0, y: 50 },
      { id: 'd', x: 60, y: 100 },
      { id: 's', x: 60, y: 0 },
      { id: 'b', x: 100, y: 50 },
    ],
    rotation: 0,
    highlightable: ['gate', 'channel', 'drain', 'source', 'bulk', 'arrow'],
    params: ['Vth', 'Kn', 'lambda'],
    label: 'PMOS',
  },
  {
    id: 'OPAMP',
    family: 'electronics',
    file: `${E}opamp.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'inp', x: 0, y: 30 },
      { id: 'inn', x: 0, y: 70 },
      { id: 'out', x: 100, y: 50 },
    ],
    rotation: 0,
    highlightable: ['triangle', 'plus', 'minus'],
    params: ['Aol'],
    label: '理想运放',
  },
  {
    id: 'AND',
    family: 'electronics',
    file: `${E}and-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in1', x: 0, y: 13 },
      { id: 'in2', x: 0, y: 27 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['body'],
    params: [],
    label: '与门',
  },
  {
    id: 'OR',
    family: 'electronics',
    file: `${E}or-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in1', x: 0, y: 13 },
      { id: 'in2', x: 0, y: 27 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['body'],
    params: [],
    label: '或门',
  },
  {
    id: 'NOT',
    family: 'electronics',
    file: `${E}not-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in', x: 0, y: 20 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['triangle', 'bubble'],
    params: [],
    label: '非门',
  },
  {
    id: 'NAND',
    family: 'electronics',
    file: `${E}nand-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in1', x: 0, y: 13 },
      { id: 'in2', x: 0, y: 27 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['body', 'bubble'],
    params: [],
    label: '与非门',
  },
  {
    id: 'NOR',
    family: 'electronics',
    file: `${E}nor-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in1', x: 0, y: 13 },
      { id: 'in2', x: 0, y: 27 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['body', 'bubble'],
    params: [],
    label: '或非门',
  },
  {
    id: 'XOR',
    family: 'electronics',
    file: `${E}xor-gate.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [
      { id: 'in1', x: 0, y: 13 },
      { id: 'in2', x: 0, y: 27 },
      { id: 'out', x: 100, y: 20 },
    ],
    rotation: 0,
    highlightable: ['body', 'arc'],
    params: [],
    label: '异或门',
  },
  {
    id: 'MUX',
    family: 'electronics',
    file: `${E}mux.svg`,
    viewBox: [0, 0, 100, 60],
    pins: [
      { id: 'in1', x: 0, y: 18 },
      { id: 'in2', x: 0, y: 42 },
      { id: 'sel', x: 50, y: 60 },
      { id: 'out', x: 100, y: 30 },
    ],
    rotation: 0,
    highlightable: ['body'],
    params: [],
    label: '数据选择器',
  },
  {
    id: 'DEC',
    family: 'electronics',
    file: `${E}decoder.svg`,
    viewBox: [0, 0, 100, 80],
    pins: [
      { id: 'in1', x: 0, y: 30 },
      { id: 'in2', x: 0, y: 50 },
      { id: 'out1', x: 100, y: 10 },
      { id: 'out2', x: 100, y: 26 },
      { id: 'out3', x: 100, y: 42 },
      { id: 'out4', x: 100, y: 58 },
    ],
    rotation: 0,
    highlightable: ['body'],
    params: [],
    label: '译码器',
  },
  {
    id: 'FF',
    family: 'electronics',
    file: `${E}flipflop.svg`,
    viewBox: [0, 0, 100, 60],
    pins: [
      { id: 'd', x: 0, y: 20 },
      { id: 'clk', x: 0, y: 44 },
      { id: 'q', x: 100, y: 20 },
      { id: 'qn', x: 100, y: 44 },
    ],
    rotation: 0,
    highlightable: ['body', 'clock', 'bubble'],
    params: [],
    label: '触发器',
  },
  {
    id: 'IN',
    family: 'electronics',
    file: `${E}input-port.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [{ id: 'p', x: 0, y: 20 }],
    rotation: 0,
    highlightable: ['pad'],
    params: [],
    label: '输入端口',
  },
  {
    id: 'OUT',
    family: 'electronics',
    file: `${E}output-port.svg`,
    viewBox: [0, 0, 100, 40],
    pins: [{ id: 'p', x: 100, y: 20 }],
    rotation: 0,
    highlightable: ['pad'],
    params: [],
    label: '输出端口',
  },

  /* ── mechanics 力学族 ───────────────────────────────────────── */
  {
    id: 'beamSegment',
    family: 'mechanics',
    file: `${M}beam-segment.svg`,
    viewBox: [0, 0, 100, 20],
    anchors: [
      { id: 'n1', x: 0, y: 10, attachTo: 'node' },
      { id: 'n2', x: 100, y: 10, attachTo: 'node' },
      { id: 'm', x: 50, y: 10, attachTo: 'segment' },
    ],
    rotation: 0,
    highlightable: ['shaft'],
    path: ['n1', 'n2'],
    params: ['EI'],
    label: '梁段',
  },
  {
    id: 'shaftSegment',
    family: 'mechanics',
    file: `${M}shaft-segment.svg`,
    viewBox: [0, 0, 100, 20],
    anchors: [
      { id: 'n1', x: 0, y: 10, attachTo: 'node' },
      { id: 'n2', x: 100, y: 10, attachTo: 'node' },
    ],
    rotation: 0,
    highlightable: ['shaft', 'cap-1', 'cap-2'],
    path: ['n1', 'n2'],
    params: ['GJ'],
    label: '轴段',
  },
  {
    id: 'trussMember',
    family: 'mechanics',
    file: `${M}truss-member.svg`,
    viewBox: [0, 0, 100, 20],
    anchors: [
      { id: 'n1', x: 8, y: 10, attachTo: 'node' },
      { id: 'n2', x: 92, y: 10, attachTo: 'node' },
    ],
    rotation: 0,
    highlightable: ['member', 'node-1', 'node-2'],
    path: ['n1', 'n2'],
    params: ['EA'],
    label: '桁架杆',
  },
  {
    id: 'pin',
    family: 'mechanics',
    file: `${M}pin-support.svg`,
    viewBox: [0, 0, 100, 60],
    anchors: [{ id: 'mount', x: 50, y: 0, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['triangle', 'hatch'],
    params: [],
    label: '固定铰支座',
  },
  {
    id: 'roller',
    family: 'mechanics',
    file: `${M}roller-support.svg`,
    viewBox: [0, 0, 100, 60],
    anchors: [{ id: 'mount', x: 50, y: 0, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['triangle', 'wheels'],
    params: [],
    label: '可动铰支座',
  },
  {
    id: 'fixed',
    family: 'mechanics',
    file: `${M}fixed-support.svg`,
    viewBox: [0, 0, 80, 100],
    anchors: [{ id: 'mount', x: 30, y: 50, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['wall', 'hatch'],
    params: [],
    label: '固定端',
  },
  {
    id: 'cable',
    family: 'mechanics',
    file: `${M}cable.svg`,
    viewBox: [0, 0, 60, 100],
    anchors: [{ id: 'mount', x: 30, y: 0, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['cable', 'hook'],
    params: [],
    label: '柔索',
  },
  {
    id: 'smooth',
    family: 'mechanics',
    file: `${M}smooth-surface.svg`,
    viewBox: [0, 0, 100, 40],
    anchors: [{ id: 'mount', x: 50, y: 10, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['surface', 'hatch'],
    params: [],
    label: '光滑接触面',
  },
  {
    id: 'balljoint',
    family: 'mechanics',
    file: `${M}ball-joint.svg`,
    viewBox: [0, 0, 80, 80],
    anchors: [{ id: 'mount', x: 40, y: 28, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['ball', 'socket'],
    params: [],
    label: '球铰',
  },
  {
    id: 'twoForceLink',
    family: 'mechanics',
    file: `${M}two-force-link.svg`,
    viewBox: [0, 0, 100, 40],
    anchors: [
      { id: 'a', x: 10, y: 20, attachTo: 'node' },
      { id: 'b', x: 90, y: 20, attachTo: 'node' },
    ],
    rotation: 0,
    highlightable: ['link', 'pin-a', 'pin-b'],
    path: ['a', 'b'],
    params: [],
    label: '二力杆',
  },
  {
    id: 'pointLoad',
    family: 'mechanics',
    file: `${M}point-load.svg`,
    viewBox: [0, 0, 40, 100],
    anchors: [{ id: 'apply', x: 20, y: 80, attachTo: 'segment' }],
    rotation: 0,
    highlightable: ['shaft', 'head'],
    params: ['P'],
    label: '集中力',
  },
  {
    id: 'udlLoad',
    family: 'mechanics',
    file: `${M}udl-load.svg`,
    viewBox: [0, 0, 100, 60],
    anchors: [
      { id: 'start', x: 0, y: 10, attachTo: 'segment' },
      { id: 'mid', x: 50, y: 10, attachTo: 'segment' },
      { id: 'end', x: 100, y: 10, attachTo: 'segment' },
    ],
    rotation: 0,
    highlightable: ['rail', 'arrows'],
    params: ['q'],
    label: '均布载荷',
  },
  {
    id: 'momentLoad',
    family: 'mechanics',
    file: `${M}moment-load.svg`,
    viewBox: [0, 0, 80, 80],
    anchors: [{ id: 'apply', x: 40, y: 40, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['arc', 'head'],
    params: ['M'],
    label: '集中力偶',
  },
  {
    id: 'torqueLoad',
    family: 'mechanics',
    file: `${M}torque-load.svg`,
    viewBox: [0, 0, 80, 80],
    anchors: [{ id: 'apply', x: 40, y: 40, attachTo: 'node' }],
    rotation: 0,
    highlightable: ['arc-up', 'arc-down', 'head-up', 'head-down'],
    params: ['T'],
    label: '扭矩',
  },
  {
    id: 'sectionRect',
    family: 'mechanics',
    file: `${M}section-rect.svg`,
    viewBox: [0, 0, 100, 80],
    anchors: [{ id: 'centroid', x: 50, y: 40, attachTo: 'global' }],
    rotation: 0,
    highlightable: ['outline', 'axis-x', 'axis-y'],
    params: ['b', 'h'],
    label: '矩形截面',
  },
  {
    id: 'sectionCircle',
    family: 'mechanics',
    file: `${M}section-circle.svg`,
    viewBox: [0, 0, 100, 80],
    anchors: [{ id: 'centroid', x: 50, y: 40, attachTo: 'global' }],
    rotation: 0,
    highlightable: ['outline', 'axis-x', 'axis-y'],
    params: ['d'],
    label: '圆形截面',
  },
  {
    id: 'rigidBody',
    family: 'mechanics',
    file: `${M}rigid-body.svg`,
    viewBox: [0, 0, 100, 80],
    anchors: [{ id: 'centroid', x: 50, y: 40, attachTo: 'global' }],
    rotation: 0,
    highlightable: ['outline', 'hatch'],
    params: [],
    label: '刚体',
  },
  {
    id: 'CTRLSRC',
    family: 'electronics',
    file: `${E}ctrlsrc.svg`,
    viewBox: [0, 0, 100, 100],
    pins: [
      { id: 'a', x: 50, y: 0 },
      { id: 'b', x: 50, y: 100 },
      { id: 'c', x: 0, y: 50 },
    ],
    rotation: 0,
    highlightable: ['body', 'arrow'],
    params: ['kind', 'gain'],
    label: '受控源（params.kind: VCCS/CCCS/VCVS/CCVS）',
  },
  {
    id: 'SUPPLY',
    family: 'electronics',
    file: `${E}supply.svg`,
    viewBox: [0, 0, 80, 100],
    pins: [{ id: 'p', x: 40, y: 100 }],
    rotation: 0,
    highlightable: ['bar', 'polarity'],
    params: ['rail', 'V'],
    label: '电源（params.rail: VCC/VEE）',
  },
];

export const SYMBOL_BY_ID: ReadonlyMap<string, SymbolDef> = new Map(
  SYMBOL_REGISTRY.map((def) => [def.id, def]),
);

export function getSymbolDef(symbolId: string): SymbolDef {
  const def = SYMBOL_BY_ID.get(symbolId);
  if (!def) throw new Error(`未注册的 symbolId：${symbolId}`);
  return def;
}

/** 绕 viewBox 中心做 90° 整数倍顺时针旋转（屏幕坐标，y 向下）。 */
export function rotateSymbolPoint(
  x: number,
  y: number,
  viewBox: SymbolDef['viewBox'],
  rotation: Rotation,
): { x: number; y: number } {
  const [minX, minY, width, height] = viewBox;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const dx = x - cx;
  const dy = y - cy;
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: cx - dy, y: cy + dx };
    case 180:
      return { x: cx - dx, y: cy - dy };
    case 270:
      return { x: cx + dy, y: cy - dx };
  }
}

export function pinsAt(def: SymbolDef, rotation: Rotation): SymbolPin[] {
  return (def.pins ?? []).map((pin) => ({
    id: pin.id,
    ...rotateSymbolPoint(pin.x, pin.y, def.viewBox, rotation),
  }));
}

export function anchorsAt(def: SymbolDef, rotation: Rotation): SymbolAnchor[] {
  return (def.anchors ?? []).map((anchor) => ({
    ...anchor,
    ...rotateSymbolPoint(anchor.x, anchor.y, def.viewBox, rotation),
  }));
}

function insideViewBox(x: number, y: number, viewBox: SymbolDef['viewBox']): boolean {
  const [minX, minY, width, height] = viewBox;
  return x >= minX && x <= minX + width && y >= minY && y <= minY + height;
}

/** 注册表不变量：id/文件唯一、族与目录一致、点位在 viewBox 内、不混用 pins/anchors。 */
export function assertSymbolRegistry(): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const def of SYMBOL_REGISTRY) {
    if (ids.has(def.id)) throw new Error(`图元 id 重复：${def.id}`);
    ids.add(def.id);
    if (files.has(def.file)) throw new Error(`图元文件重复：${def.file}`);
    files.add(def.file);

    const expectedDir = def.family === 'electronics' ? E : M;
    if (!def.file.startsWith(expectedDir)) {
      throw new Error(`图元 ${def.id} 的 file 不在 ${expectedDir}`);
    }
    if (def.pins && def.anchors) {
      throw new Error(`图元 ${def.id} 同时声明 pins 与 anchors`);
    }
    if (def.highlightable.length === 0) {
      throw new Error(`图元 ${def.id} 没有可高亮内部元素`);
    }
    if (![0, 90, 180, 270].includes(def.rotation)) {
      throw new Error(`图元 ${def.id} 旋转角非法：${def.rotation}`);
    }
    for (const pin of def.pins ?? []) {
      if (!insideViewBox(pin.x, pin.y, def.viewBox)) {
        throw new Error(`图元 ${def.id} 的 pin ${pin.id} 超出 viewBox`);
      }
    }
    for (const anchor of def.anchors ?? []) {
      if (!insideViewBox(anchor.x, anchor.y, def.viewBox)) {
        throw new Error(`图元 ${def.id} 的 anchor ${anchor.id} 超出 viewBox`);
      }
    }
  }
}

assertSymbolRegistry();