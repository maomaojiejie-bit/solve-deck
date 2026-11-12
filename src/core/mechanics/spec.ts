/**
 * MechSpec —— 力学模型（W0 适配层）
 *
 * 唯一真理：C:\Users\17897\.dsh\profiles\desktop\node_modules\dsh-mech-workbench\scripts\analyze.py
 * 的 `build_model()` / `build_section()`。
 *
 * 规则：
 *  - 字段名与库一字不差，不许改名、不许嵌套改造、不许加自定义字段（id 除外）。
 *  - 单位体系与符号约定见库文件头注释（本文件不重复定义，避免两套说法）。
 *  - 这里只定义「输入」；「输出」在 solve.ts。
 */

/** 构件类型：杆（轴向）/ 梁（横向弯曲）/ 轴（扭转）。库内 _KINDS。 */
export type MechKind = 'bar' | 'beam' | 'shaft';

/** 支座类型：库内 _SUPPORT_UNKNOWN 的三个键。未知量个数：fixed 3（shaft 时 4）、pin 2、roller 1。 */
export type MechSupportType = 'fixed' | 'pin' | 'roller';

/** 载荷方向：transverse 向上为正、axial 沿 +x 为正（库内约定，别改）。 */
export type MechLoadDir = 'axial' | 'transverse';

/** 截面形状：库内 _SHAPES。 */
export type MechShape = 'rect' | 'circle' | 'tube' | 'ishape';

export type MechSupport = {
  x: number;
  type: MechSupportType;
};

/** 集中力。value 为沿 dir 的分量；均布/集中力矩的符号见库注释。 */
export type MechPointForce = {
  type: 'point_force';
  x: number;
  value: number;
  dir?: MechLoadDir;
};

/** 分布载荷，沿 x 从 q0 线性变到 q1（省略 q1 即矩形分布）。 */
export type MechDistributedLoad = {
  type: 'distributed';
  x0: number;
  x1: number;
  q0: number;
  q1?: number;
  dir?: MechLoadDir;
};

/** 集中力偶，逆时针为正。 */
export type MechPointMoment = {
  type: 'point_moment';
  x: number;
  value: number;
};

/** 集中扭矩，右手螺旋沿 +x 为正。 */
export type MechPointTorque = {
  type: 'point_torque';
  x: number;
  value: number;
};

export type MechLoad =
  | MechPointForce
  | MechDistributedLoad
  | MechPointMoment
  | MechPointTorque;

/**
 * 截面。params 的键由 shape 决定（库内 build_section）：
 *   rect   -> b, h
 *   circle -> d
 *   tube   -> D, d（D > d）
 *   ishape -> bf, tf, hw, tw
 * E 只影响变形，静定反力/内力/应力不需要它；库把它记为可选。
 */
export type MechSection = {
  shape: MechShape;
  params: Record<string, number>;
  E?: number;
};

/**
 * 单位声明。库内 resolve_units() 只认对象形式（逐项覆盖默认值）；
 * 文档 §0.1 写的是 `units?: string`，传字符串会被库静默忽略、回落到默认
 * 「m / kN / kN·m / MPa」。这里按库的真实能力放成联合类型，两种都收。
 */
export type MechUnits = {
  length?: string;
  force?: string;
  moment?: string;
  stress?: string;
};

/**
 * 一份力学题目的完整描述。字段顺序与库的读取顺序一致。
 */
export type MechSpec = {
  kind: MechKind;
  /** 构件长度，单位同 units.length。 */
  length: number;
  supports: MechSupport[];
  loads: MechLoad[];
  section: MechSection;
  /** 额外采样截面位置（库会并入临界截面集合）。 */
  stations?: number[];
  units?: string | MechUnits;
};
