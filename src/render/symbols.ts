/**
 * 电路符号积木表：每个符号 = 引脚 + 尺寸（局部坐标，y 向下）。
 *
 * 图形不在这里画了 —— 图形来自 `public/symbols/electronics/*.svg`（27 个 GB/T 4728 画法的
 * 资产），由 `scripts/gen-symbol-art.mjs` 编译成 `symbolArt.generated.ts`，渲染器内联。
 * 这里只保留**几何契约**：引脚位置必须与 svg 引脚端点严格重合，否则导线接不上。
 * 每个符号的缩放/对齐参数写在生成器的 MAP 表里（改图形改 svg，改接法改 MAP）。
 *
 * 积木约定：
 * - 每个符号以自身「中心」为原点，引脚坐标是**局部**坐标；布局只摆中心点 + 旋转角，
 *   接线时由 `pin()` 把局部引脚换算成世界坐标，绝不手写导线坐标。
 * - 库中没有的符号（求和圆、方框、连接点、纯文字、隐形端子）仍在这里手绘。
 * - 线宽、颜色由渲染器统一给，符号本身不带 stroke。
 */

export interface SymPin {
  id: string;
  x: number;
  y: number;
  /** 中文引脚名（W12）：由 PIN_LABEL 注入，hover / 选中 / 下拉都读它。 */
  label?: string;
}

export interface SymDef {
  /** 手绘笔画（仅用于库中没有的符号）。有 svg 资产的符号留空。 */
  paths?: string[];
  /** 实心块（箭头等）。 */
  fills?: string[];
  circles?: { cx: number; cy: number; r: number; fill?: boolean }[];
  /** 符号内的固定小字（运放的 − / +）。 */
  marks?: { x: number; y: number; text: string; size?: number }[];
  /** 叠在 svg 资产上的额外笔画（局部坐标），如电源的 +/− 号。 */
  artOverlay?: string[];
  pins: SymPin[];
  /** 半宽 / 半高，供标签避让。 */
  hw: number;
  hh: number;
  /** 标签画在符号内部（方框类）。 */
  labelInside?: boolean;
}

export const SYMBOLS: Record<string, SymDef> = {
  /** 电阻：resistor.svg，引脚 ±44。rot=90 即竖向。 */
  res: {
    pins: [
      { id: 'a', x: -44, y: 0 },
      { id: 'b', x: 44, y: 0 },
    ],
    hw: 44,
    hh: 11,
  },
  /** 二极管：diode.svg，阳极在左。 */
  diode: {
    pins: [
      { id: 'a', x: -34, y: 0 },
      { id: 'c', x: 34, y: 0 },
    ],
    hw: 34,
    hh: 13,
  },
  /** 稳压管：diode.svg + 阴极折钩（库中没有稳压管，用二极管派生）。 */
  zener: {
    pins: [
      { id: 'a', x: -34, y: 0 },
      { id: 'c', x: 34, y: 0 },
    ],
    hw: 34,
    hh: 19,
  },
  /** NPN：npn.svg，基极在左，集电极上，发射极下，箭头朝外。 */
  npn: {
    pins: [
      { id: 'b', x: -44, y: 0 },
      { id: 'c', x: 8.8, y: -44 },
      { id: 'e', x: 8.8, y: 44 },
    ],
    hw: 44,
    hh: 44,
  },
  /** N 沟道增强型 MOS：nmos.svg，栅极独立，衬底箭头朝内。 */
  nmos: {
    pins: [
      { id: 'g', x: -50, y: 0 },
      { id: 'd', x: 10, y: -50 },
      { id: 's', x: 10, y: 50 },
    ],
    hw: 50,
    hh: 50,
  },
  /**
   * 横置 N-MOS（共栅用）：专用画法，不靠整体旋转。
   * 生成器把 D/S 重画成直角折线：g 在上、d 在右、s 在左。
   */
  'nmos-r90': {
    pins: [
      { id: 'g', x: 0, y: -50 },
      { id: 'd', x: 50, y: 10 },
      { id: 's', x: -50, y: 10 },
    ],
    hw: 50,
    hh: 50,
  },
  /** P 沟道 MOS：pmos.svg。 */
  pmos: {
    pins: [
      { id: 'g', x: -50, y: 0 },
      { id: 'd', x: 10, y: -50 },
      { id: 's', x: 10, y: 50 },
    ],
    hw: 50,
    hh: 50,
  },
  /** 横置 P-MOS（与 nmos-r90 镜像）：g 在上、d 在右、s 在左，箭头背离沟道。 */
  'pmos-r90': {
    pins: [
      { id: 'g', x: 0, y: -50 },
      { id: 'd', x: 50, y: 10 },
      { id: 's', x: -50, y: 10 },
    ],
    hw: 50,
    hh: 50,
  },
  /** 运放：opamp.svg 上下镜像后 − 在上、+ 在下（教科书惯例）。 */
  opamp: {
    pins: [
      { id: 'inm', x: -42.5, y: -17 },
      { id: 'inp', x: -42.5, y: 17 },
      { id: 'out', x: 42.5, y: 0 },
    ],
    hw: 42.5,
    hh: 34,
  },
  /** 电压源：voltage-source.svg 转 90°，上 + 下 −。rot=180 即上 − 下 +。 */
  vsrc: {
    artOverlay: ['M -3.6 -6.6 H 3.6', 'M 0 -10.2 V -3', 'M -3.6 6.6 H 3.6'],
    pins: [
      { id: 'p', x: 0, y: -44 },
      { id: 'n', x: 0, y: 44 },
    ],
    hw: 20,
    hh: 44,
  },
  /** 受控电流源：ctrlsrc.svg 菱形，箭头朝下 = 由 p 端流向 n 端。 */
  ctrlsrc: {
    pins: [
      { id: 'p', x: 0, y: -44 },
      { id: 'n', x: 0, y: 44 },
    ],
    hw: 34,
    hh: 44,
  },
  /** 接地：ground.svg，引脚在上，横杠向下挂。rot=180 变成「地在上」。 */
  gnd: {
    pins: [{ id: 't', x: 0, y: 0 }],
    hw: 9,
    hh: 27,
  },
  /** 电容：capacitor.svg（暂未用于 A 组）。 */
  cap: {
    pins: [
      { id: 'a', x: -44, y: 0 },
      { id: 'b', x: 44, y: 0 },
    ],
    hw: 44,
    hh: 11,
  },

  /** 求和圆：in 在左，fb 在下，out 在右（库中没有，手绘）。 */
  sum: {
    circles: [{ cx: 0, cy: 0, r: 20 }],
    paths: ['M -44 0 H -20', 'M 20 0 H 44', 'M 0 20 V 44', 'M -13 0 H -3', 'M -8 -5 V 5', 'M -5 14 H 5'],
    pins: [
      { id: 'in', x: -44, y: 0 },
      { id: 'out', x: 44, y: 0 },
      { id: 'fb', x: 0, y: 44 },
    ],
    hw: 44,
    hh: 44,
  },
  /** 方框（增益 / 反馈网络）：标签画在框内。 */
  block: {
    paths: ['M -50 -28 H 50 V 28 H -50 Z'],
    pins: [
      { id: 'in', x: -50, y: 0 },
      { id: 'out', x: 50, y: 0 },
      { id: 'x', x: 0, y: 28 },
    ],
    hw: 50,
    hh: 28,
    labelInside: true,
  },
  /** 实心连接点。 */
  dot: {
    circles: [{ cx: 0, cy: 0, r: 4.5, fill: true }],
    pins: [],
    hw: 4,
    hh: 4,
  },
  /** 只画标签、不画图元（端口 / 轨名 / 极性 +−）。 */
  text: {
    pins: [],
    hw: 0,
    hh: 0,
  },
  /** 隐形端子：只用来接线。 */
  pin: {
    pins: [{ id: 'p', x: 0, y: 0 }],
    hw: 0,
    hh: 0,
  },
  /**
   * 力学三支座：图形来自 public/symbols/mechanics/*.svg（由 gen-symbol-art 编译）。
   * 引脚 n 就是「与梁轴线接触的那个点」——固定端在墙上、铰/辊在三角形顶点。
   * 布局只摆这个点，支座其余部分自然向下展开。
   */
  fixedSupport: {
    pins: [{ id: 'n', x: 0, y: 0 }],
    hw: 12,
    hh: 25,
  },
  // hh 参与「标签相对图元的偏移」（labelOffset 用 hh+16）。svg 按 0.5 缩放后
  // 三角形 + 地基斜线画到 y≈27 px，hh 写 14 会把「固定铰」三个字压在图上。
  pinSupport: {
    pins: [{ id: 'n', x: 0, y: 0 }],
    hw: 25,
    hh: 28,
  },
  rollerSupport: {
    pins: [{ id: 'n', x: 0, y: 0 }],
    hw: 25,
    hh: 26,
  },
  /** 载荷箭头：tip 指向作用点、tail 在尾端；rot=180 即向上。手绘（库里只有载荷资产，不带箭杆方向语义）。 */
  arrow: {
    pins: [
      { id: 'tip', x: 0, y: 0 },
      { id: 'tail', x: 0, y: -42 },
    ],
    paths: ['M0 -42 L0 -9', 'M-4.5 -11 L0 0 L4.5 -11'],
    hw: 6,
    hh: 21,
  },
  /**
   * 力偶 / 反力偶：半径 17 的圆弧箭头，右侧留 60° 开口（rot=0 逆时针，rot=180 顺时针）。
   * 圆弧自己不带方向字面量，方向由 rot 决定；轴（绕 z / 绕 x）写在标签里。
   * 手绘：库里没有力偶图元，支座资产也不含它。
   */
  momentArrow: {
    pins: [{ id: 'c', x: 0, y: 0 }],
    paths: ['M14.7 -8.5 A17 17 0 1 0 14.7 8.5', 'M7.9 12.7 L14.7 8.5 L14.5 16.5'],
    hw: 20,
    hh: 20,
  },
};

/**
 * W12 引脚中文名：按 `kind → pinId → 名字` 查，查不到回落到 pinId。
 *
 * 这一张表是唯一真相：末尾把它注入每个 SymPin.label，于是 hover tooltip、
 * 选中态、两次点击下拉、门禁检查读的都是同一份文字，不会各写一套。
 * opamp 的实物引脚是 `inm`（−）/ `inp`（+），`inn` 作为文档别名一并登记。
 */
export const PIN_LABEL: Record<string, Record<string, string>> = {
  npn: { b: '基极 b', c: '集电极 c', e: '发射极 e' },
  pnp: { b: '基极 b', c: '集电极 c', e: '发射极 e' },
  nmos: { g: '栅极 g', d: '漏极 d', s: '源极 s' },
  'nmos-r90': { g: '栅极 g', d: '漏极 d', s: '源极 s' },
  pmos: { g: '栅极 g', d: '漏极 d', s: '源极 s' },
  'pmos-r90': { g: '栅极 g', d: '漏极 d', s: '源极 s' },
  opamp: { inp: '同相输入 +', inm: '反相输入 −', inn: '反相输入 −', out: '输出' },
  res: { a: '端 A', b: '端 B' },
  cap: { a: '端 A', b: '端 B' },
  vsrc: { p: '正端 +', n: '负端 −' },
  isrc: { p: '正端 +', n: '负端 −' },
  ctrlsrc: { p: '受控端', n: '回程端' },
  diode: { a: '阳极', c: '阴极' },
  zener: { a: '阳极', c: '阴极' },
  gnd: { t: '地' },
  sum: { in: '输入', out: '输出', fb: '反馈输入' },
  block: { in: '输入', out: '输出', x: '控制端' },
  pin: { p: '端子' },
  fixedSupport: { n: '与梁接触点' },
  pinSupport: { n: '支座接触点' },
  rollerSupport: { n: '支座接触点' },
  arrow: { tip: '作用点', tail: '箭尾' },
  momentArrow: { c: '力偶中心' },
};

export function pinLabel(kind: string, pinId: string): string {
  return PIN_LABEL[kind]?.[pinId] ?? pinId;
}

/** 注入一次：SymPin.label 与 PIN_LABEL 永不漂移。 */
for (const [kind, names] of Object.entries(PIN_LABEL)) {
  const def = SYMBOLS[kind];
  if (!def) continue;
  for (const pin of def.pins) {
    if (!pin.label && names[pin.id]) pin.label = names[pin.id];
  }
}

/** 把局部引脚按旋转角换算成世界坐标。 */
export function pinAt(
  kind: string,
  at: [number, number],
  rot: number,
  pin: string,
): [number, number] {
  const def = SYMBOLS[kind];
  if (!def) throw new Error(`未知符号 kind=${kind}`);
  const found = def.pins.find((p) => p.id === pin);
  if (!found) throw new Error(`符号 ${kind} 没有引脚 ${pin}`);
  const r = ((rot % 360) + 360) % 360;
  const rad = (r * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const x = found.x * cos - found.y * sin;
  const y = found.x * sin + found.y * cos;
  return [at[0] + x, at[1] + y];
}
