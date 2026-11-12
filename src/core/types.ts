/**
 * 拆解台 · SolveDeck —— 数据契约（设计稿第 4 节）
 *
 * 次序原则：先契约、后 UI。求解器、渲染层、播放器、校验层只认这里的形状。
 * 本文件不包含任何界面逻辑，也不引入任何第三方类型。
 *
 * 硬边界：
 *  - 模型只产出 parsed_given 与 templateId 候选，永远不写 result；
 *  - result 只能来自确定性求解器；
 *  - render_specs 只描述「发生了什么」，播放时机由 player 决定；
 *  - frames 只描述「第几步点亮什么」，不描述动画时长。
 */

export const CONTRACT_VERSION = 'v2.2';

/** 默认/下限残差容差；按题型可在 PathSpec.tolerance 放宽。 */
export const RESIDUAL_TOLERANCE = 1e-6;
/** 容差硬上限：达到即视为关闭校验（R26）。 */
export const MAX_PATH_TOLERANCE = 1e-2;

export type Subject = 'digital' | 'analog' | 'mechanics' | 'statics';

/** 坐标图（轴力图 / 扭矩图 / Q-M 双联 / 挠曲线 / 应力分布）。 */
export interface ChartSeries {
  kind: 'line' | 'step' | 'area';
  points: [number, number][];
  label?: string;
  fill?: boolean;
  /**
   * 在折线末端画一个箭头（矢量图用：力矢、主矢）。可选字段，未 bump CONTRACT_VERSION；
   * 只影响落笔，不动任何数值 —— 箭头指向的仍是最后一个采样点。
   */
  arrow?: boolean;
}

export interface ChartMark {
  x: number;
  y: number;
  text: string;
  side?: 'up' | 'down' | 'left' | 'right';
}

export interface ChartSpec {
  id: string;
  title: string;
  unit: string;
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  yDomain: [number, number];
  zeroLine?: boolean;
  series: ChartSeries[];
  marks?: ChartMark[];
  panels?: ChartSpec[];
  /**
   * 符号约定小盒（内力图右上角）。**只给 chart 用**，其它 render 类型不读这个字段；
   * 文案来自库的 conventions，或力学模板自算题型的手写约定，不在渲染层另写一份。
   * 可选字段，未 bump CONTRACT_VERSION。
   */
  convention?: string;
}

/**
 * 莫尔圆：σ/τ 两轴**每单位长度的像素必须相同**，所以画出来是圆不是椭圆。
 *
 * center / radius / sigma1 / sigma2 / tauMax / thetaP 全部由 solver 给出，
 * 渲染层只照着画，绝不在画图时重算一遍（check:chart 的 ⑤⑥ 两条盯着这件事）。
 * sigmaDomain / tauDomain 的跨度必须相等（方形绘图区 ⇒ 同一比例），
 * 这是「圆度」的可机械判定形式。
 *
 * 注意：W2 把 center / radius / sigma1 / sigma2 / tauMax / thetaP 从可选改成必填，
 * 属于**收紧**而不是新增可选字段。没有 bump CONTRACT_VERSION，是因为 A 系列 17 份快照
 * 不含 mohr（本轮也明令不许动它们），bump 会逼着全部重建；若这份契约要对外发布，
 * 应升到 v2.3 并把 17 份 A 快照一起重建。
 */
export interface MohrSpec {
  sigmaX: number;
  sigmaY: number;
  tauXY: number;
  /** 圆心 (σx+σy)/2，MPa。 */
  center: number;
  /** 半径 R，MPa。 */
  radius: number;
  sigma1: number;
  sigma2: number;
  tauMax: number;
  /** 主平面角，度（逆时针为正，落在 (−90, 90]）。 */
  thetaP: number;
  /** σ 轴绘图域；跨度必须与 tauDomain 相等。 */
  sigmaDomain: [number, number];
  /** τ 轴绘图域；跨度必须与 sigmaDomain 相等。 */
  tauDomain: [number, number];
  unit: string;
}

/** 题型 id，见设计稿第 2 节：D1–D6 / A1–A7 / M1–M8 / S1–S7。 */
export type TemplateId = string;

/** 只允许 90° 整数倍；梁段角度由两端节点决定，不在此旋转。 */
export type Rotation = 0 | 90 | 180 | 270;

/** render_spec 的图种；结果侧图只能由 render/ 从 render_spec 生成。 */
export type RenderType =
  | 'schematic'
  | 'timing'
  | 'karnaugh'
  | 'state'
  | 'beam'
  | 'stress'
  | 'mohr'
  | 'shaft'
  | 'truss'
  | 'freebody'
  | 'table'
  /** 非布尔表格（数制转换等）；TruthTable 只承载 0/1，故单列一种。 */
  | 'matrix';

/** 一次完整解答；UI 与自检页只消费这一形状。 */
export interface Solution {
  templateId: TemplateId;
  subject: Subject;
  /** 题目解析后的已知量：输入层或模型只能写到这里。 */
  parsed_given: Record<string, number | string>;
  /** 确定性求解器产出的步骤序列，i 即 stepIndex。 */
  steps: Step[];
  /** 确定性引擎产出的答案；模型不得写入。 */
  result: Record<string, number | string>;
  /** 一个解可有多张联动图；每张由 render/ 从各自 RenderSpec 生成。 */
  render_specs: RenderSpec[];
  /** 逐帧数据在 render_specs[i].frames；顶层不再保留一份，避免两处漂移。 */
  /** 确定性校验报告；模型置信分不得混入。 */
  confidence: ConfidenceReport;
  /** 本解通过校验的时刻（ISO）；预置快照必填，运行时改参数重算后刷新。 */
  validatedAt: string;
  /** 契约版本；与代码里的版本不一致时快照必须重建。 */
  contractVersion: string;
  /** 拒答、降级、工作区无解等需要展示给用户的原因。 */
  warnings: string[];
}

/** 一步推导：公式 / 代入 / 得数 / 依据 / 高亮，五件套缺一不可。 */
export interface Step {
  /** = stepIndex，从 0 连续递增。 */
  i: number;
  title: string;
  /** KaTeX 源码。 */
  formula_tex: string;
  /** 代入数值后的形式（仍用数学写法，便于 KaTeX 渲染）。 */
  substitution: string;
  /** 得数，带单位。 */
  value: string;
  /** 本步依据的定律 / 定理 / 定义。 */
  basis: string;
  /** 本步要高亮的图元 id（必须存在于 render_spec.nodes 或 edges）。 */
  highlight: string[];
}

/** 结果侧图的纯数据描述；不含像素、不含动画曲线。 */
export interface RenderSpec {
  /** 图 id：'main' / 'wave' / 'mohr' / 'table'…；同一解内唯一。 */
  id: string;
  /** 主图占主视区；辅图并排或放主图下方。 */
  role: 'primary' | 'secondary';
  /**
   * 'main' = 由主图变换而来（直流通路 / 交流通路 / 微变等效电路 / 戴维南）。
   * 可选；只有变换图才填。
   */
  derivedFrom?: string;
  type: RenderType;
  nodes: {
    id: string;
    x: number;
    y: number;
    kind: string;
    label?: string;
    /** 图元自身旋转角（度，仅 0/90/180/270）：竖放电阻 / 竖放电源用它，标签不跟着转。 */
    rot?: number;
    /** 标签相对图元的位置；缺省 up。 */
    labelSide?: 'up' | 'down' | 'left' | 'right';
  }[];
  edges: {
    id: string;
    from: string;
    to: string;
    kind: string;
    label?: string;
    /** 显式折线（绝对坐标，含首尾）；给了就不再走默认 H-V-H 布线。 */
    points?: [number, number][];
    /** 虚线：受控源「控制量」引出线，不是导线。 */
    dashed?: boolean;
    /** 端口标签：贴在该段中点上方，字号更小。 */
    tag?: string;
    /** 线宽档位：2 = 主回路，1 = 细支路。 */
    weight?: 1 | 2;
  }[];
  axes?: { xLabel: string; yLabel: string; domain: [number, number] };
  /** N/V/M/T、挠曲线等分段函数；expr 为可直接求值的表达式字符串。 */
  segments?: { id: string; expr: string; range: [number, number] }[];
  /** 力 / 反力 / 力偶矢量；at 指向节点或段 id。 */
  vectors?: {
    id: string;
    at: string;
    dx: number;
    dy: number;
    kind: 'force' | 'reaction' | 'moment';
  }[];
  /** 卡诺图分组；cells 为「行索引+列索引」两位十进制（如 "02"）。 */
  regions?: { id: string; cells: string[]; label: string }[];
  /** 卡诺图行/列各对应哪些变量；禁止从 cells 反推。 */
  rowVars?: string[];
  colVars?: string[];
  /** 莫尔圆。 */
  circles?: { id: string; cx: number; cy: number; r: number }[];
  /** 电流 / 信号 / 位流；magnitude 与 result 联动。 */
  flow?: Flow[];
  /** type === 'table' 时必填。 */
  table?: TruthTable;
  /**
   * type === 'timing' 的数字波形；借用 WaveDrom 的 {signal:[{name,wave,data}]} 表达法。
   * wave 每个字符对应一拍：0/1 保持电平、p 正脉冲、n 负脉冲、. 延续上一拍、x 未知。
   */
  signals?: { name: string; wave: string; data?: string[] }[];
  /** type === 'matrix' 的文本表格（非布尔值，如各进制字符串）。 */
  matrix?: { columns: string[]; rows: string[][] };
  /** 力学坐标图；type = beam / shaft / stress 时使用。 */
  chart?: ChartSpec;
  /** 莫尔圆；type = mohr 时使用。 */
  mohr?: MohrSpec;
  frames: Frame[];
}

/**
 * 真值表 / 特性表。D2/D3 用真值表，D4 用特性表（outputs 存次态）。
 */
export type LogicBit = 0 | 1 | 'x';

export interface TruthTable {
  inputs: string[];
  outputs: string[];
  /** 'x' = 无所谓项；D1 的无关项、D4 的 SR 非法态统一用它。 */
  rows: { in: LogicBit[]; out: LogicBit[] }[];
}

/** 一条流动路径；path 是 edge id 序列，magnitude 改参数后必须重算。 */
export interface Flow {
  id: string;
  path: string[];
  kind: 'dc' | 'ac' | 'bit';
  /** 与 result 联动，改参数重算。 */
  magnitude: number;
  phase?: number;
  value?: 0 | 1;
}

/** 播放器的一帧：第几步、点亮哪些边/点、显示哪些标签。 */
export interface Frame {
  stepIndex: number;
  activeEdges: string[];
  activeNodes: string[];
  labels: { id: string; text: string }[];
  /** 0..1，内力图 / 挠曲线按 stepIndex 逐段绘出的进度。 */
  curveProgress?: number;
  /** 电路变换帧：从当前图移除/新增元素，做「原电路 → 等效电路」的过渡。 */
  replaced?: { remove: string[]; add: string[] };
}

/* ── 统一图元库：electronics 与 mechanics 两族共用 ─────────────────── */

/** 图元锚点 / 引脚；坐标写死在 symbolRegistry.ts，运行时不解析 SVG。 */
export interface SymbolPin {
  id: string;
  x: number;
  y: number;
}

export interface SymbolAnchor extends SymbolPin {
  attachTo: 'node' | 'segment' | 'global';
}

export interface SymbolDef {
  /** 'R' / 'NMOS' / 'beamSegment' / 'pinSupport' 等稳定 id。 */
  id: string;
  family: 'electronics' | 'mechanics';
  /** 相对 public/symbols/ 的路径，如 'electronics/resistor.svg'。 */
  file: string;
  /** [minX, minY, width, height]；与 SVG 根上的 viewBox 必须一致。 */
  viewBox: [number, number, number, number];
  /** 电路：连线端点。 */
  pins?: SymbolPin[];
  /** 力学：吸附点。 */
  anchors?: SymbolAnchor[];
  /** 基准朝向；实例旋转只允许 90° 整数倍。 */
  rotation: Rotation;
  /** SVG 内部 path/group 的 id，单步点亮用；必须真实存在。 */
  highlightable: string[];
  /** 电流 / 载荷传递经过的 pin 或 anchor id 序列。 */
  path?: string[];
  /** 可编辑参数：R / beta / Vth / P / q / EI 等。 */
  params?: string[];
  label?: string;
}

/* ── 装配结果 ──────────────────────────────────────────────────────── */

/** 电路 / 逻辑图装配后的网表。 */
export interface Netlist {
  kind: 'circuit' | 'logic';
  devices: {
    id: string;
    /** → symbolRegistry 的 SymbolDef.id。 */
    symbolId: string;
    rotation: Rotation;
    value?: number;
    params?: {
      beta?: number;
      VBE?: number;
      Vth?: number;
      Kn?: number;
      lambda?: number;
      /** 小信号与运放参数（拼接台骨架种上去；可加字段不 bump 契约版本）。 */
      gm?: number;
      ro?: number;
      Aol?: number;
      Rin?: number;
      Rout?: number;
      Vf?: number;
      Vz?: number;
      Rz?: number;
    };
  }[];
  /** deviceId + pinId 两段式连线。 */
  connectors: { from: [string, string]; to: [string, string] }[];
}

/** 力学装配后的模型；梁段共节点、支座不悬空由 attach.ts 保证。 */
export interface BeamModel {
  kind: 'beam' | 'shaft' | 'truss' | 'column' | 'rigidbody';
  nodes: { id: string; x: number; y: number }[];
  /** 梁段 / 杆件：from / to 必须指向 nodes。 */
  members: { id: string; symbolId: string; from: string; to: string }[];
  supports: {
    id: string;
    symbolId: string;
    at: string;
    type: 'pin' | 'roller' | 'fixed' | 'cable' | 'smooth';
  }[];
  /** t ∈ [0,1] 表示载荷在段内的相对位置。 */
  loads: {
    id: string;
    symbolId: string;
    at: string;
    t?: number;
    type: 'point' | 'udl' | 'moment' | 'torque';
    value: number;
  }[];
  section?: { A: number; I: number; W: number; J: number; E: number; G: number };
}

/**
 * 单项校验状态。
 * skipped = 这道题本来就不适用；不冒充通过，也不算失败。
 * 没有 skipReason 的 skipped 一律按 fail 计。
 */
export type CheckState = 'pass' | 'fail' | 'skipped';

/** 确定性校验报告；allPassed 才允许挂动画。 */
export interface ConfidenceReport {
  scopeOk: CheckState;
  inputOk: CheckState;
  /** 多路径比对（原 dualConsistent，现支持 2–3 条路径）。 */
  pathsConsistent: CheckState;
  residualOk: CheckState;
  boundaryOk: CheckState;
  goldenOk: CheckState;
  maxResidual: number;
  checks: { name: string; state: CheckState; detail: string; skipReason?: string }[];
  failedCount: number;
  skippedCount: number;
  /** 无 fail + 每个 skipped 都有 skipReason + skipped ≤ ⌊六项/2⌋。 */
  allPassed: boolean;
}