/**
 * 题型注册表（设计稿 v2 第 2 / 5 节 + P0）。
 *
 * 每个 templateId 登记：solver 绑定、renderType、paths[]、判据、黄金夹具、预置示例、状态。
 * - ready 必须有 3 条 principle 两两不同的 paths；
 * - renderType=null 表示“本来就不需要图”，ready 时必须带 figurelessReason；
 * - 新增题型 = 这里加一行 + 一个模块；不改内核、契约、播放器。
 *
 * P1 状态：28 型全部登记；D2 为 example-only（唯一预置示例）；其余 planned；
 * 没有任何 ready，因此 scopeGate 白名单为空。
 */

import type {
  BeamModel,
  Frame,
  Netlist,
  RenderSpec,
  RenderType,
  Solution,
  Subject,
  TemplateId,
} from '../types.ts';
import {
  CONTRACT_VERSION,
  MAX_PATH_TOLERANCE,
  RESIDUAL_TOLERANCE,
} from '../types.ts';

/** 求解器输入：结构化已知量 / 网表 / 力学模型三选一（第 3 节管道）。 */
export type SolverInput = Record<string, number | string> | Netlist | BeamModel;

/** 确定性求解器：同步纯函数，模型不参与。 */
export type Solver = (input: SolverInput) => Solution;

/** F8：题型 solver 必须懒加载，禁止把所有 solver 静态塞进主包。 */
export type LazySolver = () => Promise<{ default: Solver }>;

/** 一条独立校验路径；principle 必须指向不同物理原理，不能换算法充数。 */
export interface PathSpec {
  id: string;
  label: string;
  principle: string;
  /** 该路径产出的中间量类型；同一题型三条必须互不相同。 */
  intermediate: string;
  /** 该路径与本型主路径比对时的相对容差；不填 = 1e-6。 */
  tolerance?: number;
  /** tolerance > 1e-6 时必填：近似来源（忽略 ro / 折线化 等）。 */
  approximation?: string;
}

export type TemplateStatus = 'planned' | 'example-only' | 'ready';

export type ParamValue = number | string | number[];

/** 参数实验场的参数描述：范围由模板声明，UI 不猜。 */
export interface ParamSpec {
  key: string;
  label: string;
  unit?: string;
  kind: 'number' | 'bits';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: ParamValue;
  /** 对数滑杆（仅 number，min > 0）。 */
  log?: boolean;
  /** bits 的逐位标签。 */
  bitLabels?: string[];
}

/** 同一模板的常驻组态变体（如 A3 的 CB/CC），各自一份已校验快照。 */
export interface TemplateVariant {
  /** 路由与快照 id，必须带模板前缀，如 'A3-CB'。 */
  id: string;
  title: string;
  /** 首页芯片文案，如 '共基 CB'。 */
  short: string;
  /** 求解器入参里的组态名，必须与快照 result.config 一致。 */
  config: string;
  /** 预置示例路径（相对项目根）。 */
  example: string;
  /**
   * 反例标签：这一页是**刻意**拒绝求解的演示题（如「静不定体系」「机构」）。
   * 有值 → 结果页顶部挂 danger 横幅，明说「按设计拒绝、不输出内力数值」，
   * 免得读者以为是算挂了。普通变体（A3-CB、M3-悬臂）不填。
   */
  rejection?: string;
  /**
   * 变体自己的默认参数。母题的默认值往往对应母题那个工况（简支梁），
   * 变体（悬臂）要换一组才有意义；缺省则沿用母题默认值。
   */
  params?: Record<string, number | string>;
}

export interface TemplateEntry {
  id: TemplateId;
  subject: Subject;
  title: string;
  tier: 'T1' | 'T2';
  /** null = 这道题本来就不需要图（纯数值步骤），不是“图还没画”。 */
  renderType: RenderType | null;
  /** renderType === null 且 status === 'ready' 时必填：为什么这题不需要图。 */
  figurelessReason?: string;
  /** 第 5 节多路径判据；每条 2–3 条。 */
  paths: PathSpec[];
  /** 第 5 节“判据”列。 */
  criterion: string;
  status: TemplateStatus;
  solver: LazySolver | null;
  /** goldenSet 夹具 id；status='ready' 时至少 1 条。 */
  golden: string[];
  /** 预置示例路径（相对项目根）。 */
  example: string | null;
  /** 参数实验场：可编辑参数（只在 ready 型上出现）。 */
  params?: readonly ParamSpec[];
  /** 非面板参数的固定输入（mode / topology / config / ff / op / Vt 等）。 */
  fixedInput?: Record<string, number | string>;
  /** 可选组态变体；只在 ready 型上出现。 */
  variants?: readonly TemplateVariant[];
  note?: string;
}

/* ── 第 5 节判据表：28 型逐行照抄 ───────────────────────────────── */

const D1_PATHS: PathSpec[] = [
  { id: 'truth-table', label: '真值表穷举', principle: '枚举语义（所有输入组合）', intermediate: 'truth-rows' },
  { id: 'kmap', label: '卡诺图分组覆盖（极大矩形 + 集合覆盖）', principle: '最小项几何相邻合并', intermediate: 'prime-rectangles' },
  { id: 'algebra', label: '第三方 QMC 化简成 SOP 后展开', principle: '布尔代数化简', intermediate: 'sop-terms' },
];

/** D2 的第三条路径按本轮的 QMC 实现走；D3/D5 各有自己的路径表。 */
const D2_PATHS: PathSpec[] = [
  { id: 'truth-table', label: '真值表穷举全输入组合', principle: '穷举语义', intermediate: 'truth-rows' },
  {
    id: 'propagation',
    label: '门级传播逐拍比对（digitaljs）',
    principle: '结构化传播',
    intermediate: 'node-levels',
  },
  {
    id: 'qmc',
    label: 'QMC 化简成 SOP 后回代',
    principle: '布尔代数化简',
    intermediate: 'sop-terms',
  },
];

/** D3 是组合逻辑设计：路径 C 验目标函数化简，不验次态。 */
const D3_PATHS: PathSpec[] = [
  { id: 'target-truth', label: '目标函数真值表穷举', principle: '目标语义穷举', intermediate: 'truth-rows' },
  {
    id: 'netlist-propagation',
    label: '生成网表经 digitaljs 逐门传播',
    principle: '结构化传播',
    intermediate: 'node-levels',
  },
  {
    id: 'qmc-target',
    label: 'QMC 化简目标函数后展开回代',
    principle: '布尔代数化简',
    intermediate: 'sop-terms',
  },
];

/** D5 是状态机：三条路径分别是符号表、编码后的布尔方程、直接序列判据。 */
const D5_PATHS: PathSpec[] = [
  { id: 'state-table', label: '状态转移表逐拍查表', principle: '状态转移表语义', intermediate: 'state-table-rows' },
  {
    id: 'encoded-trace',
    label: '状态编码后按次态布尔方程逐拍求值',
    principle: '状态编码 + 布尔方程',
    intermediate: 'state-traces',
  },
  {
    id: 'direct-sequence',
    label: '序列直接判据（模式匹配 / 模运算）',
    principle: '序列直接判据',
    intermediate: 'direct-sequence',
  },
];

const D4_PATHS: PathSpec[] = [
  { id: 'characteristic-table', label: '特性表逐项查表', principle: '查表语义', intermediate: 'characteristic-rows' },
  { id: 'timing-sim', label: '时序仿真逐拍', principle: '事件驱动状态转移', intermediate: 'timing-traces' },
  { id: 'excitation', label: '激励表反解 + 次态方程代入', principle: '反解 + 代数代入', intermediate: 'excitation-rows' },
];

const D6_PATHS: PathSpec[] = [
  { id: 'place-value', label: '按位权展开求和', principle: '位置记数法', intermediate: 'place-value-digits' },
  { id: 'radix-convert', label: '除基取余 / 乘基取整互逆', principle: '进制转换互逆', intermediate: 'radix-remainders' },
  {
    id: 'code-identity',
    label: '码制位运算恒等式（补码 = 反码+1、g = b⊕(b>>1) 及其逆）',
    principle: '码制位运算恒等',
    intermediate: 'code-bitops',
  },
];

const A1_PATHS: PathSpec[] = [
  { id: 'load-line', label: '图解法：负载线与分段特性交点', principle: '图解法', intermediate: 'load-line-intersection' },
  { id: 'piecewise', label: '分段线性迭代（假设导通/截止并回代）', principle: '分段线性化', intermediate: 'piecewise-states' },
  {
    id: 'ideal-bounds',
    label: '理想模型上下界区间校验',
    principle: '理想模型极限',
    intermediate: 'ideal-bounds',
    tolerance: 1e-3,
    approximation: '分段线性二极管（恒压降 + 动态电阻）',
  },
];

const WORKZONE_PATHS: PathSpec[] = [
  { id: 'node-voltage', label: '节点电压法', principle: 'KCL 节点分析', intermediate: 'node-voltages' },
  { id: 'mesh-kvl', label: '回路 KVL', principle: 'KVL 回路分析', intermediate: 'loop-currents' },
  { id: 'zone-backsub', label: '先假设工作区再回代不等式', principle: '工作区假设-回代', intermediate: 'zone-residuals' },
];

const SMALL_SIGNAL_PATHS: PathSpec[] = [
  { id: 'small-signal', label: '小信号等效电路解析式 Av/Ri/Ro', principle: '小信号等效电路', intermediate: 'small-signal-params' },
  {
    id: 'port-test',
    label: '端口测试法：输入端加测试源求 Ri、输出端加测试源求 Ro',
    principle: '端口测试',
    intermediate: 'port-test-results',
  },
  {
    id: 'symbolic-equiv',
    label: '手推闭式（含 ro/gds）',
    principle: '解析式',
    intermediate: 'symbolic-residuals',
  },
];

const A6_PATHS: PathSpec[] = [
  { id: 'virtual-short', label: '虚短虚断解析', principle: '理想运放约束', intermediate: 'node-equations' },
  { id: 'finite-mna', label: '有限开环增益 MNA', principle: '有限增益节点方程', intermediate: 'finite-gain-mna' },
  {
    id: 'limit-sweep',
    label: 'Aol 从 1e3 扫到 1e7 的极限收敛',
    principle: '极限一致性',
    intermediate: 'limit-sweep',
    tolerance: 1e-3,
    approximation: '开环增益有限（误差 ~1/Aol）',
  },
];

const A7_PATHS: PathSpec[] = [
  { id: 'loop-gain', label: '环路增益法求 T 再合成 Af', principle: '环路增益', intermediate: 'loop-gain' },
  { id: 'closed-loop-mna', label: '闭环 MNA（不拆环路直接解）', principle: '闭环节点方程', intermediate: 'closed-loop-mna' },
  {
    id: 'asymptotic',
    label: '深度负反馈近似 1/β 的单调收敛判据',
    principle: '渐近一致性',
    intermediate: 'asymptotic-error',
    tolerance: 5e-3,
    approximation: '深度负反馈近似，仅在 T≥100 时成立（T<100 直接判超域）',
  },
];


/** M5 弯曲变形：库 M 双积分 / 标准挠曲线闭式 / 单位载荷法（虚功）。 */
const DEFLECTION_PATHS: PathSpec[] = [
  { id: 'mech-deflection', label: '内核 M(x) + Simpson 双积分 + 边界条件', principle: '截面内力双积分', intermediate: 'mech-deflection' },
  { id: 'closed-curve', label: '简支梁标准挠曲线闭式 δmax=Pb(L²−b²)^{3/2}/(9√3LEI)', principle: '挠曲线微分方程闭式解', intermediate: 'deflection-closed' },
  { id: 'virtual-work', label: '单位载荷法（虚功 ∫MM̄/EI）', principle: '单位载荷虚功', intermediate: 'deflection-virtual-work' },
];


/**
 * 力学三路径（W1）：A 库复刻（被 check:mech-parity 钉住）、B 材料力学闭式、C 数值积分。
 * 三条 principle / intermediate 两两不同，且都由 src/core/templates/mechanics/paths.ts 实跑。
 */
const MECH_AXIAL_PATHS: PathSpec[] = [
  { id: 'mech', label: '内核复刻：静力平衡 + 截面法', principle: '静力平衡与截面法', intermediate: 'mech-internal-force' },
  { id: 'closed', label: 'σ=N/A 与 ΔL=NL/(EA) 闭式', principle: '材料力学基本定义式', intermediate: 'axial-closed' },
  { id: 'numeric', label: '200 段数值积分 ∫N/(EA)dx', principle: '数值积分', intermediate: 'axial-integrated' },
];

const MECH_TORSION_PATHS: PathSpec[] = [
  { id: 'mech', label: '内核复刻：扭矩图 + Ip/Wp', principle: '内核的扭转求解', intermediate: 'mech-torque' },
  { id: 'closed', label: 'τ=T/Wp、φ=TL/(GIp) 闭式', principle: '圆轴扭转闭式解', intermediate: 'torsion-closed' },
  { id: 'numeric', label: '200 段累积 ∫T/(GIp)dx', principle: '分段数值积分', intermediate: 'torsion-integrated' },
];

const MECH_BEAM_PATHS: PathSpec[] = [
  { id: 'mech', label: '内核复刻：diagrams 的 Q(x)/M(x)', principle: '内核的截面内力累积', intermediate: 'mech-diagrams' },
  { id: 'closed', label: '静力平衡闭式 RA/RB 与 M(x)', principle: '刚体静力平衡', intermediate: 'beam-closed' },
  { id: 'numeric', label: '对 q 累积求 Q、对 Q 累积求 M', principle: '载荷微分关系的数值累积', intermediate: 'beam-integrated' },
];

const MECH_STRESS_PATHS: PathSpec[] = [
  { id: 'mech', label: '内核复刻：stresses 的 σ=N/A+M·y/Iy', principle: '内核的应力求解', intermediate: 'mech-stresses' },
  { id: 'closed', label: 'σ=M/W 与 W=bh²/6 闭式', principle: '弯曲正应力定义式', intermediate: 'bending-closed' },
  { id: 'numeric', label: '沿截面高度条带积分回代', principle: '数值条带积分', intermediate: 'section-integrated' },
];

/** M6 应力状态：σ(θ) 极值数值搜索 / 主应力闭式 / 特征方程根。 */
const M6_PATHS: PathSpec[] = [
  { id: 'search', label: 'σ(θ) 极值搜索（粗扫 + 黄金分割）', principle: '数值寻优', intermediate: 'principal-search' },
  { id: 'closed', label: '主应力闭式 σ₁,₂=C±R', principle: '莫尔圆几何', intermediate: 'principal-closed' },
  { id: 'invariant', label: '特征方程 λ²−I₁λ+I₂=0 求根', principle: '应力不变量', intermediate: 'principal-invariant' },
];

/** M7 压杆稳定：欧拉公式 / 能量法解析 / 能量法数值积分。 */
const M7_PATHS: PathSpec[] = [
  { id: 'euler', label: 'λ 定义式 + 欧拉公式 π²E/λ²', principle: '临界载荷微分方程特征值', intermediate: 'euler-critical' },
  { id: 'energy', label: '能量法 Rayleigh 商（解析）', principle: '势能驻值原理', intermediate: 'energy-rayleigh' },
  { id: 'numeric', label: 'Rayleigh 商的两个积分用 Simpson 数值算', principle: '数值积分', intermediate: 'energy-integrated' },
];

const M8_PATHS: PathSpec[] = [
  { id: 'mech', label: '内核 N/M/T + 分项叠加 σ=N/A+M·y/I', principle: '内核的截面内力 + 叠加原理', intermediate: 'mech-combined' },
  { id: 'closed', label: '悬臂闭式 N=−P_n、M=−P_tL、T', principle: '刚体静力平衡', intermediate: 'combined-closed' },
  { id: 'numeric', label: '由 σ(y) 沿截面数值积分回代 N 与 M', principle: '积分回代（∫σdA=N、∫yσdA=M）', intermediate: 'combined-integrated' },
];

/* 静力学：每一型的三个 intermediate 必须与 src/core/templates/statics/paths.ts 实跑一致 */
const S1_PATHS: PathSpec[] = [
  { id: 'rank', label: '约束矩阵秩判据（rank A=3?）', principle: '约束矩阵秩', intermediate: 'rank-criterion' },
  { id: 'count', label: '未知量数 vs 独立方程数计数', principle: '静定判据计数', intermediate: 'count-criterion' },
  { id: 'projection', label: '载荷到约束列空间的投影残差', principle: '线性代数（可平衡性）', intermediate: 'load-projection' },
];

const S2_PATHS: PathSpec[] = [
  { id: 'components', label: '分量投影相加', principle: '力的平行四边形法则', intermediate: 'component-sum' },
  { id: 'rotated', label: '旋转坐标系合成后转回', principle: '坐标变换', intermediate: 'rotated-frame' },
  { id: 'cosine', label: '余弦定理只求大小', principle: '三角形余弦定理', intermediate: 'cosine-law' },
];

const S3_PATHS: PathSpec[] = [
  { id: 'rigid2d', label: '刚体求解器（约束矩阵 + 三平衡方程）', principle: '刚体平衡方程组', intermediate: 'rigid2d-solve' },
  { id: 'moment', label: '对 A 取矩闭式求 RB', principle: '力矩平衡', intermediate: 'moment-closed' },
  { id: 'force', label: '竖向力平衡闭式求 RA', principle: '力平衡', intermediate: 'force-sum' },
];

const S4_PATHS: PathSpec[] = [
  { id: 'closed', label: '临界平衡闭式 P=μW/(cosα+μsinα)', principle: '摩擦临界平衡', intermediate: 'friction-closed' },
  { id: 'bisection', label: '把 P 当未知量二分求根', principle: '数值求根', intermediate: 'friction-bisection' },
  { id: 'angle', label: '摩擦角 φf 处极值 Pmin=μW/√(1+μ²)', principle: '极值条件', intermediate: 'friction-angle' },
];

const S5_PATHS: PathSpec[] = [
  { id: 'node', label: '节点法（逐节点 ΣF=0 联立）', principle: '节点法', intermediate: 'node-method' },
  { id: 'section', label: '截面法（切 AC/AB 取左段）', principle: '截面法', intermediate: 'section-method' },
  { id: 'residual', label: '逐节点回代残差 + 零杆判据', principle: '回代与零杆判定', intermediate: 'joint-residual' },
];

const S6_PATHS: PathSpec[] = [
  { id: 'block', label: '分块求和 ȳ=ΣAᵢyᵢ/ΣAᵢ', principle: '分块面积矩', intermediate: 'block-sum' },
  { id: 'integral', label: '沿高度数值积分 ∫y·w(y)dy/A', principle: '数值积分', intermediate: 'height-integral' },
  { id: 'moment', label: '对形心静矩回代（ΣAᵢ(yᵢ−ȳ)=0）', principle: '静矩平衡', intermediate: 'first-moment-zero' },
];

const S7_PATHS: PathSpec[] = [
  { id: 'work', label: '虚功方程 Wδ₁−Fδ₂=0', principle: '虚位移原理', intermediate: 'virtual-work' },
  { id: 'moment', label: '静力平衡 ΣM_O=0', principle: '刚体平衡', intermediate: 'moment-balance' },
  { id: 'ratio', label: '位移比 = 臂长比', principle: '刚体转动几何', intermediate: 'displacement-ratio' },
];

const CRITERION = {
  D1: '三种表示同解 + 无关项处理一致',
  LOGIC: '全组合逐位一致',
  D4: '任意初态下状态序列一致',
  D6: '往返转换无损 + 补码符号位正确',
  A1: '输出峰值 / 有效值 / 纹波一致',
  WORKZONE: 'KCL/KVL 残差 + 工作区不等式回代全部成立',
  SMALL_SIGNAL: '符号等价 + 残差 ≤ 1e-6 + gm/rπ 量纲 + 端口测试与解析式一致',
  A6: '节点方程残差 + 叠加各分量一致 + 电容节点电荷守恒',
  A7: '增益三法一致 + 输入/输出阻抗升降方向与组态（电压/电流、串联/并联）相符',
  INTERNAL: '简支端 M=0、ΣF=0、ΣM=0',
  DEFLECTION: '边界位移、最大应力位置一致',
  STRESS: '圆心半径一致 + 主应力一致 + 强度理论选取与材料脆/塑性相符 + 临界应力不超比例极限',
  M8: '危险点位置与 σr 一致',
  STATICS: 'ΣFx=ΣFy=ΣM=0、杆力符号',
  S6: '形心坐标三法一致',
  S7: '虚位移与实位移方向/量值自洽',
} as const;

export const TEMPLATES: readonly TemplateEntry[] = [
  /* ── digital 数电 ─────────────────────────────────────────────── */
  {
    id: 'D1', subject: 'digital',
    title: '逻辑代数：摩根律、卡诺图、最小项、无关项',
    tier: 'T2', renderType: 'karnaugh',
    paths: [...D1_PATHS], criterion: CRITERION.D1,
    status: 'ready',
    solver: () => import('./digital/D1.ts').then((module) => ({ default: module.solveD1 })),
    golden: ['D1-01', 'D1-02', 'D1-03'],
    example: 'src/examples/D1.json',
    params: [
      {
        key: 'bits',
        label: '输入 ABCD',
        kind: 'bits',
        defaultValue: [0, 0, 0, 0],
        bitLabels: ['A', 'B', 'C', 'D'],
      },
    ],
    fixedInput: { variables: 'ABCD', minterms: '0,1,2,3,4,6' },
  },
  {
    id: 'D2', subject: 'digital',
    title: '组合逻辑分析：门→表达式→真值表',
    tier: 'T1', renderType: 'schematic',
    paths: [...D2_PATHS], criterion: CRITERION.LOGIC,
    status: 'ready',
    solver: () => import('./digital/D2.ts').then((module) => ({ default: module.solveD2 })),
    golden: ['D2-01', 'D2-02', 'D2-03'],
    example: 'src/examples/D2.json',
    params: [
      {
        key: 'bits',
        label: '输入 ABC',
        kind: 'bits',
        defaultValue: [0, 0, 0],
        bitLabels: ['A', 'B', 'C'],
      },
    ],
  },
  {
    id: 'D3', subject: 'digital',
    title: '组合逻辑设计：译码器、MUX、加法器、比较器、奇偶校验',
    tier: 'T2', renderType: 'schematic',
    paths: [...D3_PATHS], criterion: CRITERION.LOGIC,
    status: 'ready',
    solver: () => import('./digital/D3.ts').then((module) => ({ default: module.solveD3 })),
    golden: ['D3-01'],
    example: 'src/examples/D3.json',
    params: [
      {
        key: 'bits',
        label: '输入 SAB',
        kind: 'bits',
        defaultValue: [0, 0, 0],
        bitLabels: ['S', 'A', 'B'],
      },
    ],
    fixedInput: { op: 'mux2' },
  },
  {
    id: 'D4', subject: 'digital',
    title: '触发器：SR / D / JK / T、边沿触发、特性表与激励表',
    tier: 'T2', renderType: 'timing',
    paths: [...D4_PATHS], criterion: CRITERION.D4,
    status: 'ready',
    solver: () => import('./digital/D4.ts').then((module) => ({ default: module.solveD4 })),
    golden: ['D4-01'],
    example: 'src/examples/D4.json',
    params: [
      {
        key: 'jBits',
        label: 'J 序列',
        kind: 'bits',
        defaultValue: [1, 0, 1, 1],
        bitLabels: ['t1', 't2', 't3', 't4'],
      },
      {
        key: 'kBits',
        label: 'K 序列',
        kind: 'bits',
        defaultValue: [0, 1, 0, 1],
        bitLabels: ['t1', 't2', 't3', 't4'],
      },
    ],
    fixedInput: { ff: 'JK', q0: 0 },
  },
  {
    id: 'D5', subject: 'digital',
    title: '时序逻辑：寄存器、同步/异步计数器、FSM 分析与设计',
    tier: 'T1', renderType: 'state',
    paths: [...D5_PATHS], criterion: CRITERION.LOGIC,
    status: 'ready',
    solver: () => import('./digital/D5.ts').then((module) => ({ default: module.solveD5 })),
    golden: ['D5-01', 'D5-02', 'D5-03'],
    example: 'src/examples/D5.json',
    params: [
      {
        key: 'inputBits',
        label: '输入 X',
        kind: 'bits',
        defaultValue: [1, 0, 1, 1, 0, 1, 0],
        bitLabels: ['1', '2', '3', '4', '5', '6', '7'],
      },
    ],
    fixedInput: { kind: 'seq-detector', pattern: '101' },
    note: '序列检测模式限 2–3 位，状态编码固定 2 位；计数器状态 0–2',
  },
  {
    id: 'D6', subject: 'digital',
    title: '数制码制：进制转换、BCD、补码、格雷码',
    tier: 'T2', renderType: null,
    figurelessReason: '数制码制是纯数值转换，正文表格已足够，不需要图形',
    paths: [...D6_PATHS], criterion: CRITERION.D6,
    status: 'ready',
    solver: () => import('./digital/D6.ts').then((module) => ({ default: module.solveD6 })),
    golden: ['D6-01', 'D6-02', 'D6-03'],
    example: 'src/examples/D6.json',
    params: [
      {
        key: 'bits',
        label: '二进制值',
        kind: 'bits',
        defaultValue: [1, 0, 1, 0, 1, 1, 0, 0],
        bitLabels: ['b7', 'b6', 'b5', 'b4', 'b3', 'b2', 'b1', 'b0'],
      },
    ],
    fixedInput: { op: 'convert' },
  },

  /* ── analog 模电 ──────────────────────────────────────────────── */
  {
    id: 'A1', subject: 'analog',
    title: '二极管：恒压降模型、整流、钳位、稳压',
    tier: 'T2', renderType: 'timing',
    paths: [...A1_PATHS], criterion: CRITERION.A1,
    status: 'ready',
    solver: () => import('./analog/A1.ts').then((module) => ({ default: module.solveA1 })),
    golden: ['A1-01'],
    example: 'src/examples/A1.json',
    params: [
      { key: 'Vs', label: 'Vs', unit: 'V', kind: 'number', min: 0.1, max: 10, step: 0.1, defaultValue: 5 },
      { key: 'R', label: 'R', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
      { key: 'Vf', label: 'Vf', unit: 'V', kind: 'number', min: 0.5, max: 0.9, step: 0.01, defaultValue: 0.7 },
      { key: 'Vz', label: 'Vz', unit: 'V', kind: 'number', min: 3, max: 10, step: 0.1, defaultValue: 5.1 },
      { key: 'Rz', label: 'Rz', unit: 'Ω', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 10 },
    ],
    fixedInput: { mode: 'series' },
  },
  {
    id: 'A2', subject: 'analog',
    title: 'BJT 直流工作点：截止/放大/饱和区判定循环、分压偏置',
    tier: 'T1', renderType: 'schematic',
    paths: [...WORKZONE_PATHS], criterion: CRITERION.WORKZONE,
    status: 'ready',
    solver: () => import('./analog/A2.ts').then((module) => ({ default: module.solveA2 })),
    golden: ['A2-01', 'A2-02', 'A2-03'],
    example: 'src/examples/A2.json',
    params: [
      { key: 'Vcc', label: 'Vcc', unit: 'V', kind: 'number', min: 5, max: 20, step: 0.5, defaultValue: 12 },
      { key: 'R1', label: 'R1', unit: 'Ω', kind: 'number', min: 1_000, max: 100_000, step: 1, defaultValue: 47_000, log: true },
      { key: 'R2', label: 'R2', unit: 'Ω', kind: 'number', min: 1_000, max: 100_000, step: 1, defaultValue: 10_000, log: true },
      { key: 'Rc', label: 'Rc', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 3_300, log: true },
      { key: 'Re', label: 'Re', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
      { key: 'beta', label: 'β', kind: 'number', min: 20, max: 300, step: 1, defaultValue: 100 },
      { key: 'VBE', label: 'VBE', unit: 'V', kind: 'number', min: 0.6, max: 0.8, step: 0.01, defaultValue: 0.7 },
      { key: 'VCEsat', label: 'VCEsat', unit: 'V', kind: 'number', min: 0.1, max: 0.3, step: 0.01, defaultValue: 0.2 },
    ],
  },
  {
    id: 'A3', subject: 'analog',
    title: 'BJT 三种组态：共射/共集/共基、π 模型、rπ=β/gm、Av/Ri/Ro',
    tier: 'T1', renderType: 'schematic',
    paths: [...SMALL_SIGNAL_PATHS], criterion: CRITERION.SMALL_SIGNAL,
    status: 'ready',
    solver: () => import('./analog/A3.ts').then((module) => ({ default: module.solveA3 })),
    golden: ['A3-01', 'A3-02', 'A3-03'],
    example: 'src/examples/A3.json',
    params: [
      { key: 'beta', label: 'β', kind: 'number', min: 20, max: 300, step: 1, defaultValue: 100 },
      { key: 'Ic', label: 'Ic', unit: 'A', kind: 'number', min: 1e-4, max: 1e-2, step: 1e-5, defaultValue: 1e-3, log: true },
      { key: 'Rc', label: 'Rc', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 2_000, log: true },
      { key: 'Rl', label: 'Rl', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 10_000, log: true },
      { key: 'Rs', label: 'Rs', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
      { key: 'Re', label: 'Re', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
      { key: 'VA', label: 'VA', unit: 'V', kind: 'number', min: 20, max: 200, step: 1, defaultValue: 100 },
    ],
    fixedInput: { config: 'CE', Vt: 0.026 },
    variants: [
      {
        id: 'A3-CB',
        title: 'A3 · 共基（CB）小信号分析',
        short: '共基 CB',
        config: 'CB',
        example: 'src/examples/A3-CB.json',
      },
      {
        id: 'A3-CC',
        title: 'A3 · 共集（CC）小信号分析',
        short: '共集 CC',
        config: 'CC',
        example: 'src/examples/A3-CC.json',
      },
    ],
  },
  {
    id: 'A4', subject: 'analog',
    title: 'MOS 工作区：NMOS/PMOS 区判定（截止/triode/饱和）、Vth/Kn',
    tier: 'T1', renderType: 'schematic',
    paths: [...WORKZONE_PATHS], criterion: CRITERION.WORKZONE,
    status: 'ready',
    solver: () => import('./analog/A4.ts').then((module) => ({ default: module.solveA4 })),
    golden: ['A4-01', 'A4-02', 'A4-03'],
    example: 'src/examples/A4.json',
    params: [
      { key: 'Vdd', label: 'Vdd', unit: 'V', kind: 'number', min: 5, max: 20, step: 0.5, defaultValue: 12 },
      { key: 'Rg1', label: 'Rg1', unit: 'Ω', kind: 'number', min: 100_000, max: 10_000_000, step: 1_000, defaultValue: 2_000_000, log: true },
      { key: 'Rg2', label: 'Rg2', unit: 'Ω', kind: 'number', min: 100_000, max: 10_000_000, step: 1_000, defaultValue: 1_000_000, log: true },
      { key: 'Rd', label: 'Rd', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 2_000, log: true },
      { key: 'Rs', label: 'Rs', unit: 'Ω', kind: 'number', min: 100, max: 1_000_000, step: 1, defaultValue: 180_000, log: true },
      { key: 'Vth', label: 'Vth', unit: 'V', kind: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { key: 'Kn', label: 'Kn', unit: 'A/V²', kind: 'number', min: 1e-4, max: 5e-3, step: 1e-6, defaultValue: 5e-4, log: true },
      { key: 'lambda', label: 'λ', unit: '1/V', kind: 'number', min: 0, max: 0.1, step: 0.001, defaultValue: 0.02 },
    ],
  },
  {
    id: 'A5', subject: 'analog',
    title: 'MOS 组态：共源/共漏/共栅、gm=2ID/VOV、gds、Av/Ri/Ro',
    tier: 'T1', renderType: 'schematic',
    paths: [...SMALL_SIGNAL_PATHS], criterion: CRITERION.SMALL_SIGNAL,
    status: 'ready',
    solver: () => import('./analog/A5.ts').then((module) => ({ default: module.solveA5 })),
    golden: ['A5-01', 'A5-02', 'A5-03'],
    example: 'src/examples/A5.json',
    params: [
      { key: 'gm', label: 'gm', unit: 'S', kind: 'number', min: 1e-4, max: 1e-2, step: 1e-6, defaultValue: 1e-3, log: true },
      { key: 'ro', label: 'ro', unit: 'Ω', kind: 'number', min: 100_000, max: 10_000_000, step: 1_000, defaultValue: 5_000_000, log: true },
      { key: 'Rd', label: 'Rd', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 2_000, log: true },
      { key: 'Rl', label: 'Rl', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 10_000, log: true },
      { key: 'Rs', label: 'Rs', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
      { key: 'Rss', label: 'Rss', unit: 'Ω', kind: 'number', min: 100, max: 100_000, step: 1, defaultValue: 1_000, log: true },
    ],
    fixedInput: { config: 'CS' },
    variants: [
      {
        id: 'A5-CG',
        title: 'A5 · 共栅（CG）小信号分析',
        short: '共栅 CG',
        config: 'CG',
        example: 'src/examples/A5-CG.json',
      },
      {
        id: 'A5-CD',
        title: 'A5 · 共漏（CD）小信号分析',
        short: '共漏 CD',
        config: 'CD',
        example: 'src/examples/A5-CD.json',
      },
    ],
  },
  {
    id: 'A6', subject: 'analog',
    title: '理想运放：虚短虚断、反相/同相/加减/积分/微分',
    tier: 'T2', renderType: 'schematic',
    paths: [...A6_PATHS], criterion: CRITERION.A6,
    status: 'ready',
    solver: () => import('./analog/A6.ts').then((module) => ({ default: module.solveA6 })),
    golden: ['A6-01'],
    example: 'src/examples/A6.json',
    params: [
      { key: 'Aol', label: 'Aol', kind: 'number', min: 1_000, max: 1_000_000, step: 1, defaultValue: 1_000_000, log: true },
      { key: 'R1', label: 'R1', unit: 'Ω', kind: 'number', min: 1_000, max: 1_000_000, step: 10, defaultValue: 10_000, log: true },
      { key: 'R2', label: 'R2', unit: 'Ω', kind: 'number', min: 1_000, max: 1_000_000, step: 10, defaultValue: 100_000, log: true },
      { key: 'Rin', label: 'Rin', unit: 'Ω', kind: 'number', min: 100_000, max: 100_000_000, step: 1_000, defaultValue: 10_000_000, log: true },
      { key: 'Rout', label: 'Rout', unit: 'Ω', kind: 'number', min: 0, max: 1_000, step: 10, defaultValue: 50 },
      { key: 'Vin', label: 'Vin', unit: 'V', kind: 'number', min: 0.01, max: 1, step: 0.01, defaultValue: 0.1 },
    ],
    fixedInput: { topology: 'inverting' },
  },
  {
    id: 'A7', subject: 'analog',
    title: '反馈基础：四种组态判别、基本闭环增益',
    tier: 'T2', renderType: 'schematic',
    paths: [...A7_PATHS], criterion: CRITERION.A7,
    status: 'ready',
    solver: () => import('./analog/A7.ts').then((module) => ({ default: module.solveA7 })),
    golden: ['A7-01'],
    example: 'src/examples/A7.json',
    params: [
      { key: 'A', label: 'A', kind: 'number', min: 1_000, max: 1_000_000, step: 1, defaultValue: 100_000, log: true },
      { key: 'beta', label: 'β', kind: 'number', min: 0.001, max: 0.1, step: 0.0001, defaultValue: 0.01, log: true },
      { key: 'Rin', label: 'Rin', unit: 'Ω', kind: 'number', min: 1_000, max: 1_000_000, step: 10, defaultValue: 10_000, log: true },
      { key: 'Rout', label: 'Rout', unit: 'Ω', kind: 'number', min: 10, max: 1_000, step: 1, defaultValue: 100, log: true },
      { key: 'Rl', label: 'Rl', unit: 'Ω', kind: 'number', min: 1_000, max: 1_000_000, step: 10, defaultValue: 10_000, log: true },
    ],
  },

  /* ── mechanics 材料力学 ───────────────────────────────────────── */
  {
    id: 'M1', subject: 'mechanics',
    title: '轴向拉压：轴力图 N(x)、正应力、胡克定律、变形',
    tier: 'T2', renderType: 'beam',
    paths: [...MECH_AXIAL_PATHS], criterion: CRITERION.INTERNAL,
    status: 'ready',
    solver: () => import('./mechanics/M1.ts').then((module) => ({ default: module.solveM1 })),
    golden: ['M1-01', 'M1-02'],
    example: 'src/examples/M1.json',
    params: [
      { key: 'L', label: '长度 L', unit: 'm', kind: 'number', min: 0.2, max: 5, step: 0.1, defaultValue: 1 },
      { key: 'A', label: '面积 A', unit: 'mm²', kind: 'number', min: 50, max: 2000, step: 10, defaultValue: 200, log: true },
      { key: 'P', label: '轴力 P', unit: 'kN', kind: 'number', min: -200, max: 200, step: 5, defaultValue: 40 },
      { key: 'E', label: '弹性模量 E', unit: 'GPa', kind: 'number', min: 50, max: 300, step: 5, defaultValue: 200 },
      { key: 'allow', label: '许用应力 [σ]', unit: 'MPa', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 160 },
    ],
  },
  {
    id: 'M2', subject: 'mechanics',
    title: '扭转：扭矩图 T(x)、切应力、扭转角',
    tier: 'T2', renderType: 'shaft',
    paths: [...MECH_TORSION_PATHS], criterion: CRITERION.INTERNAL,
    status: 'ready',
    solver: () => import('./mechanics/M2.ts').then((module) => ({ default: module.solveM2 })),
    golden: ['M2-01'],
    example: 'src/examples/M2.json',
    params: [
      { key: 'L', label: '长度 L', unit: 'm', kind: 'number', min: 0.2, max: 5, step: 0.1, defaultValue: 1 },
      { key: 'd', label: '直径 d', unit: 'mm', kind: 'number', min: 10, max: 120, step: 1, defaultValue: 40 },
      { key: 'T', label: '扭矩 T', unit: 'kN·m', kind: 'number', min: -20, max: 20, step: 0.5, defaultValue: 1 },
      { key: 'G', label: '切变模量 G', unit: 'GPa', kind: 'number', min: 30, max: 120, step: 5, defaultValue: 80 },
      { key: 'allow', label: '许用切应力 [τ]', unit: 'MPa', kind: 'number', min: 10, max: 200, step: 5, defaultValue: 40 },
    ],
  },
  {
    id: 'M3', subject: 'mechanics',
    title: '弯曲内力：V(x) / M(x)、载荷微分关系、简支/悬臂梁',
    tier: 'T1', renderType: 'beam',
    paths: [...MECH_BEAM_PATHS], criterion: CRITERION.INTERNAL,
    status: 'ready',
    solver: () => import('./mechanics/M3.ts').then((module) => ({ default: module.solveM3 })),
    golden: ['M3-01', 'M3-02', 'M3-03'],
    example: 'src/examples/M3.json',
    variants: [
      {
        id: 'M3-cantilever',
        title: '悬臂梁弯曲内力：固定端反力偶、自由端挠度、V(x)/M(x) 从固定端起画',
        short: '悬臂梁',
        config: 'cantilever',
        example: 'src/examples/M3-cantilever.json',
        // §2 悬臂标准答案：L=2 m、P=10 kN 作用于 x=1 m ⇒ R=10 kN、M_A=10 kN·m、M(0)=−10
        params: { L: 2, a: 1, P: 10, q: 0 },
      },
    ],
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 8, step: 0.1, defaultValue: 4 },
      { key: 'a', label: '集中力位置 a', unit: 'm', kind: 'number', min: 0.1, max: 7.9, step: 0.1, defaultValue: 2 },
      { key: 'P', label: '集中力 P', unit: 'kN', kind: 'number', min: 0, max: 200, step: 5, defaultValue: 20 },
      { key: 'q', label: '均布载荷 q', unit: 'kN/m', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'M4', subject: 'mechanics',
    title: '弯曲应力：σ=My/I、惯性矩、截面系数、强度校核',
    tier: 'T1', renderType: 'stress',
    paths: [...MECH_STRESS_PATHS], criterion: CRITERION.STRESS,
    status: 'ready',
    solver: () => import('./mechanics/M4.ts').then((module) => ({ default: module.solveM4 })),
    golden: ['M4-01', 'M4-02'],
    example: 'src/examples/M4.json',
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 8, step: 0.1, defaultValue: 4 },
      { key: 'a', label: '集中力位置 a', unit: 'm', kind: 'number', min: 0.1, max: 7.9, step: 0.1, defaultValue: 2 },
      { key: 'P', label: '集中力 P', unit: 'kN', kind: 'number', min: 0, max: 200, step: 5, defaultValue: 20 },
      { key: 'b', label: '截面宽 b', unit: 'mm', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 100 },
      { key: 'h', label: '截面高 h', unit: 'mm', kind: 'number', min: 20, max: 600, step: 5, defaultValue: 200 },
      { key: 'allow', label: '许用应力 [σ]', unit: 'MPa', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 160 },
    ],
  },
  {
    id: 'M5', subject: 'mechanics',
    title: '弯曲变形：挠曲线、积分法 / 叠加法',
    tier: 'T1', renderType: 'beam',
    paths: [...DEFLECTION_PATHS], criterion: CRITERION.DEFLECTION,
    status: 'ready',
    solver: () => import('./mechanics/M5.ts').then((module) => ({ default: module.solveM5 })),
    golden: ['M5-01', 'M5-02'],
    example: 'src/examples/M5.json',
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 8, step: 0.1, defaultValue: 4 },
      { key: 'a', label: '集中力位置 a', unit: 'm', kind: 'number', min: 0.1, max: 7.9, step: 0.1, defaultValue: 2 },
      { key: 'P', label: '集中力 P', unit: 'kN', kind: 'number', min: 0, max: 200, step: 5, defaultValue: 20 },
      { key: 'b', label: '截面宽 b', unit: 'mm', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 100 },
      { key: 'h', label: '截面高 h', unit: 'mm', kind: 'number', min: 20, max: 600, step: 5, defaultValue: 200 },
      { key: 'E', label: '弹性模量 E', unit: 'GPa', kind: 'number', min: 50, max: 300, step: 5, defaultValue: 200 },
    ],
  },
  {
    id: 'M6', subject: 'mechanics',
    title: '应力状态：主应力、莫尔圆、四大强度理论',
    tier: 'T2', renderType: 'mohr',
    paths: [...M6_PATHS], criterion: CRITERION.STRESS,
    status: 'ready',
    solver: () => import('./mechanics/M6.ts').then((module) => ({ default: module.solveM6 })),
    golden: ['M6-01', 'M6-02'],
    example: 'src/examples/M6.json',
    params: [
      { key: 'sx', label: 'σx', unit: 'MPa', kind: 'number', min: -200, max: 300, step: 5, defaultValue: 100 },
      { key: 'sy', label: 'σy', unit: 'MPa', kind: 'number', min: -200, max: 300, step: 5, defaultValue: -20 },
      { key: 'txy', label: 'τxy', unit: 'MPa', kind: 'number', min: -200, max: 200, step: 5, defaultValue: 40 },
      { key: 'allow', label: '许用应力 [σ]', unit: 'MPa', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 160 },
    ],
  },
  {
    id: 'M7', subject: 'mechanics',
    title: '压杆稳定：柔度、欧拉临界力',
    tier: 'T2', renderType: 'beam',
    paths: [...M7_PATHS], criterion: CRITERION.STRESS,
    status: 'ready',
    solver: () => import('./mechanics/M7.ts').then((module) => ({ default: module.solveM7 })),
    golden: ['M7-01', 'M7-02'],
    example: 'src/examples/M7.json',
    params: [
      { key: 'L', label: '杆长 L', unit: 'm', kind: 'number', min: 0.5, max: 8, step: 0.1, defaultValue: 2 },
      { key: 'b', label: '截面宽 b', unit: 'mm', kind: 'number', min: 20, max: 200, step: 5, defaultValue: 60 },
      { key: 'h', label: '截面高 h', unit: 'mm', kind: 'number', min: 20, max: 200, step: 5, defaultValue: 60 },
      { key: 'E', label: '弹性模量 E', unit: 'GPa', kind: 'number', min: 50, max: 300, step: 5, defaultValue: 200 },
      { key: 'mu', label: '长度系数 μ', kind: 'number', min: 0.5, max: 2, step: 0.5, defaultValue: 1 },
      { key: 'P', label: '工作压力 P', unit: 'kN', kind: 'number', min: 0, max: 1000, step: 10, defaultValue: 150 },
      { key: 'sp', label: '比例极限 σp', unit: 'MPa', kind: 'number', min: 100, max: 400, step: 10, defaultValue: 200 },
    ],
  },
  {
    id: 'M8', subject: 'mechanics',
    title: '组合变形：拉弯、弯扭合成',
    tier: 'T2', renderType: 'stress',
    paths: [...M8_PATHS], criterion: CRITERION.M8,
    status: 'ready',
    solver: () => import('./mechanics/M8.ts').then((module) => ({ default: module.solveM8 })),
    golden: ['M8-01', 'M8-02'],
    example: 'src/examples/M8.json',
    params: [
      { key: 'L', label: '悬臂长度 L', unit: 'm', kind: 'number', min: 0.5, max: 6, step: 0.1, defaultValue: 2 },
      { key: 'd', label: '直径 d', unit: 'mm', kind: 'number', min: 20, max: 300, step: 5, defaultValue: 140 },
      { key: 'Pn', label: '轴向压力 Pn', unit: 'kN', kind: 'number', min: 0, max: 500, step: 5, defaultValue: 150 },
      { key: 'Pt', label: '横向力 Pt', unit: 'kN', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 8 },
      { key: 'T', label: '扭矩 T', unit: 'kN·m', kind: 'number', min: 0, max: 20, step: 0.1, defaultValue: 0.5 },
      { key: 'allow', label: '许用应力 [σ]', unit: 'MPa', kind: 'number', min: 20, max: 400, step: 5, defaultValue: 160 },
    ],
  },

  /* ── statics 理论力学（仅静力学） ─────────────────────────────── */
  {
    id: 'S1', subject: 'statics',
    title: '约束与受力图：固定铰/可动铰/固定端/柔索/光滑面/球铰、二力杆',
    tier: 'T1', renderType: 'freebody',
    paths: [...S1_PATHS], criterion: CRITERION.STATICS,
    status: 'ready',
    solver: () => import('./statics/S1.ts').then((module) => ({ default: module.solveS1 })),
    golden: ['S1-01', 'S1-02', 'S1-03'],
    example: 'src/examples/S1.json',
    // 组态用变体切换（滑杆造不出「机构」）：静定 / 静不定 / 机构各一份快照
    variants: [
      {
        id: 'S1-indeterminate',
        title: 'S1 · 静不定（pin@A + pin@B）',
        short: '静不定',
        config: 'indeterminate',
        example: 'src/examples/S1-indeterminate.json',
        rejection: '静不定体系',
        params: { L: 4, a: 2, P: 10 },
      },
      {
        id: 'S1-mechanism',
        title: 'S1 · 机构（两平行可动铰）',
        short: '机构',
        config: 'mechanism',
        example: 'src/examples/S1-mechanism.json',
        rejection: '机构',
        params: { L: 4, a: 2, P: 10 },
      },
    ],
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 8, step: 0.1, defaultValue: 4 },
      { key: 'a', label: '载荷位置 a', unit: 'm', kind: 'number', min: 0.1, max: 7.9, step: 0.1, defaultValue: 2 },
      { key: 'P', label: '载荷 P', unit: 'kN', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'S2', subject: 'statics',
    title: '平面汇交力系与力偶系：合成、平衡、力偶矩',
    tier: 'T2', renderType: 'freebody',
    paths: [...S2_PATHS], criterion: CRITERION.STATICS,
    status: 'ready',
    solver: () => import('./statics/S2.ts').then((module) => ({ default: module.solveS2 })),
    golden: ['S2-01', 'S2-02'],
    example: 'src/examples/S2.json',
    params: [
      { key: 'F1', label: 'F1 大小', unit: 'N', kind: 'number', min: 10, max: 500, step: 10, defaultValue: 100 },
      { key: 'th1', label: 'F1 方向', unit: '°', kind: 'number', min: -180, max: 180, step: 5, defaultValue: 30 },
      { key: 'F2', label: 'F2 大小', unit: 'N', kind: 'number', min: 10, max: 500, step: 10, defaultValue: 100 },
      { key: 'th2', label: 'F2 方向', unit: '°', kind: 'number', min: -180, max: 180, step: 5, defaultValue: 150 },
    ],
  },
  {
    id: 'S3', subject: 'statics',
    title: '平面任意力系：简化、平衡方程、支座反力',
    tier: 'T1', renderType: 'freebody',
    paths: [...S3_PATHS], criterion: CRITERION.STATICS,
    status: 'ready',
    solver: () => import('./statics/S3.ts').then((module) => ({ default: module.solveS3 })),
    golden: ['S3-01', 'S3-02'],
    example: 'src/examples/S3.json',
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 10, step: 0.1, defaultValue: 3 },
      { key: 'x1', label: 'P1 位置', unit: 'm', kind: 'number', min: 0.1, max: 9.9, step: 0.1, defaultValue: 1 },
      { key: 'P1', label: '集中力 P1', unit: 'kN', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 10 },
      { key: 'x2', label: 'P2 位置', unit: 'm', kind: 'number', min: 0.1, max: 9.9, step: 0.1, defaultValue: 2 },
      { key: 'P2', label: '集中力 P2', unit: 'kN', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 20 },
    ],
  },
  {
    id: 'S4', subject: 'statics',
    title: '摩擦：摩擦角、自锁、临界平衡',
    tier: 'T2', renderType: 'freebody',
    paths: [...S4_PATHS], criterion: CRITERION.STATICS,
    status: 'ready',
    solver: () => import('./statics/S4.ts').then((module) => ({ default: module.solveS4 })),
    golden: ['S4-01', 'S4-02'],
    example: 'src/examples/S4.json',
    params: [
      { key: 'mu', label: '摩擦系数 μ', kind: 'number', min: 0.05, max: 1, step: 0.05, defaultValue: 0.3 },
      { key: 'W', label: '物重 W', unit: 'N', kind: 'number', min: 10, max: 2000, step: 10, defaultValue: 200 },
      { key: 'alpha', label: '拉角 α', unit: '°', kind: 'number', min: 1, max: 89, step: 1, defaultValue: 30 },
      { key: 'beta', label: '斜面倾角 β', unit: '°', kind: 'number', min: 0, max: 60, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'S5', subject: 'statics',
    // 拓扑只有一种：静定三角桁架。标题不许写成泛指的「桁架」，免得让人以为能输入任意拓扑。
    title: '静定三角桁架：节点法、截面法、零杆判别（L/H/载荷可变）',
    tier: 'T1', renderType: 'truss',
    paths: [...S5_PATHS], criterion: CRITERION.STATICS,
    status: 'ready',
    solver: () => import('./statics/S5.ts').then((module) => ({ default: module.solveS5 })),
    golden: ['S5-01', 'S5-02'],
    example: 'src/examples/S5.json',
    params: [
      { key: 'L', label: '跨度 L', unit: 'm', kind: 'number', min: 1, max: 8, step: 0.1, defaultValue: 2 },
      { key: 'H', label: '矢高 H', unit: 'm', kind: 'number', min: 0.2, max: 6, step: 0.1, defaultValue: 1 },
      { key: 'P', label: '顶点载荷 P', unit: 'kN', kind: 'number', min: 0, max: 100, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'S6', subject: 'statics',
    title: '重心与形心：组合体形心',
    tier: 'T2', renderType: 'freebody',
    paths: [...S6_PATHS], criterion: CRITERION.S6,
    status: 'ready',
    solver: () => import('./statics/S6.ts').then((module) => ({ default: module.solveS6 })),
    golden: ['S6-01', 'S6-02'],
    example: 'src/examples/S6.json',
    note: '第 2 条为数值复核，不视为独立物理原理',
    params: [
      { key: 'bf', label: '翼缘宽 bf', unit: 'mm', kind: 'number', min: 20, max: 400, step: 10, defaultValue: 100 },
      { key: 'tf', label: '翼缘厚 tf', unit: 'mm', kind: 'number', min: 5, max: 100, step: 5, defaultValue: 20 },
      { key: 'bw', label: '腹板宽 bw', unit: 'mm', kind: 'number', min: 5, max: 200, step: 5, defaultValue: 20 },
      { key: 'hw', label: '腹板高 hw', unit: 'mm', kind: 'number', min: 20, max: 600, step: 10, defaultValue: 100 },
    ],
  },
  {
    id: 'S7', subject: 'statics',
    title: '虚位移原理：虚功方程',
    tier: 'T2', renderType: 'freebody',
    paths: [...S7_PATHS], criterion: CRITERION.S7,
    status: 'ready',
    solver: () => import('./statics/S7.ts').then((module) => ({ default: module.solveS7 })),
    golden: ['S7-01', 'S7-02'],
    example: 'src/examples/S7.json',
    params: [
      { key: 'a', label: '左臂 a', unit: 'm', kind: 'number', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
      { key: 'b', label: '右臂 b', unit: 'm', kind: 'number', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
      { key: 'W', label: '重物 W', unit: 'N', kind: 'number', min: 10, max: 2000, step: 10, defaultValue: 100 },
    ],
  },
];

const SUBJECT_PREFIX: Record<string, Subject> = {
  D: 'digital',
  A: 'analog',
  M: 'mechanics',
  S: 'statics',
};

export const TEMPLATE_BY_ID: ReadonlyMap<TemplateId, TemplateEntry> = new Map(
  TEMPLATES.map((entry) => [entry.id, entry]),
);

export const VARIANT_BY_ID: ReadonlyMap<string, { entry: TemplateEntry; variant: TemplateVariant }> =
  new Map(
    TEMPLATES.flatMap((entry) =>
      (entry.variants ?? []).map((variant) => [variant.id, { entry, variant }] as const),
    ),
  );

export function getTemplate(templateId: TemplateId): TemplateEntry {
  const entry = TEMPLATE_BY_ID.get(templateId);
  if (!entry) throw new Error(`未注册的 templateId：${templateId}`);
  return entry;
}

/** 路由解析：模板本体或常驻组态变体都能取到所属模板。 */
export function getTemplateRoute(
  templateId: string,
): { entry: TemplateEntry; variant?: TemplateVariant } | undefined {
  const entry = TEMPLATE_BY_ID.get(templateId);
  if (entry) return { entry };
  const variantRoute = VARIANT_BY_ID.get(templateId);
  if (!variantRoute) return undefined;
  // 全覆盖 F7：变体显示自己的描述，不借用母型标题（索引卡 / 工具栏 / 收藏与
  // M3 同名的问题）。浅拷贝换 title，solver / 快照等引用原样共享。
  // 必须缓存同一实例：调用方以 entry 为 React effect 依赖，每次新对象会无限重跑。
  const { variant } = variantRoute;
  if (!variant?.title) return variantRoute;
  let wrapped = VARIANT_ENTRY_WRAPPED.get(templateId);
  if (!wrapped) {
    wrapped = { ...variantRoute.entry, title: variant.title };
    VARIANT_ENTRY_WRAPPED.set(templateId, wrapped);
  }
  return { entry: wrapped, variant };
}

const VARIANT_ENTRY_WRAPPED = new Map<string, TemplateEntry>();

/** scopeGate 只放行真正完成的题型；P1 为空。 */
export const SCOPE_WHITELIST: readonly TemplateId[] = TEMPLATES.filter(
  (entry) => entry.status === 'ready',
).map((entry) => entry.id);

export function isScopeReady(templateId: TemplateId): boolean {
  return SCOPE_WHITELIST.includes(templateId);
}

/* ── 契约不变量 ─────────────────────────────────────────────────── */

function collectSpecIds(spec: RenderSpec): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  const push = (items: readonly { id: string }[] | undefined, where: string) => {
    for (const item of items ?? []) out.push({ id: item.id, where });
  };
  push(spec.nodes, 'nodes');
  push(spec.edges, 'edges');
  push(spec.vectors, 'vectors');
  push(spec.regions, 'regions');
  push(spec.circles, 'circles');
  push(spec.segments, 'segments');
  push(spec.flow, 'flow');
  return out;
}

/**
 * 单题契约：
 * - render_specs 非空；spec.id 唯一；
 * - nodes/edges/vectors/regions/circles/segments/flow 的 id 跨 spec 全局唯一
 *   （Step.highlight 与 Frame 共用一个 id 空间，重名会点亮错图）；
 * - type='table' 必须带 table；
 * - Step.highlight / Frame 引用的 id 必须真实存在。
 */
export function assertSolutionContract(solution: Solution): void {
  if (!Array.isArray(solution.render_specs) || solution.render_specs.length === 0) {
    throw new Error(`${solution.templateId}：render_specs 不得为空`);
  }
  if (!solution.validatedAt || Number.isNaN(Date.parse(solution.validatedAt))) {
    throw new Error(`${solution.templateId}：validatedAt 必须是非空 ISO 时间`);
  }
  if (solution.contractVersion !== CONTRACT_VERSION) {
    throw new Error(
      `${solution.templateId}：contractVersion=${solution.contractVersion}，应为 ${CONTRACT_VERSION}`,
    );
  }

  const specIds = new Set<string>();
  const owners = new Map<string, string>();

  for (const spec of solution.render_specs) {
    if (!spec.id) throw new Error('render_spec 缺少 id');
    if (specIds.has(spec.id)) throw new Error(`render_spec id 重复：${spec.id}`);
    specIds.add(spec.id);

    if (spec.role !== 'primary' && spec.role !== 'secondary') {
      throw new Error(`render_spec ${spec.id}：role 非法`);
    }
    if (spec.type === 'table' && !spec.table) {
      throw new Error(`render_spec ${spec.id}：type=table 必须带 table`);
    }
    if (spec.table && spec.table.rows.length === 0) {
      throw new Error(`render_spec ${spec.id}：table 不得为空`);
    }

    for (const item of collectSpecIds(spec)) {
      const owner = owners.get(item.id);
      if (owner !== undefined) {
        throw new Error(
          `跨图 id 重复：${item.id} 同时出现在 ${owner} 与 ${spec.id}/${item.where}` +
            `（Step.highlight 与 Frame 共用 id 空间）`,
        );
      }
      owners.set(item.id, `${spec.id}/${item.where}`);
    }
  }

  solution.steps.forEach((step, index) => {
    if (step.i !== index) throw new Error(`step ${index} 的 i=${step.i}，必须连续`);
    for (const id of step.highlight) {
      if (!owners.has(id)) {
        throw new Error(`step ${step.i} 高亮 ${id} 不存在于任何 render_spec`);
      }
    }
  });

  const checkFrames = (frames: Frame[], label: string) => {
    for (const frame of frames) {
      for (const id of frame.activeEdges) {
        if (!owners.has(id)) throw new Error(`${label} frame ${frame.stepIndex} 边 ${id} 不存在`);
      }
      for (const id of frame.activeNodes) {
        if (!owners.has(id)) throw new Error(`${label} frame ${frame.stepIndex} 点 ${id} 不存在`);
      }
      for (const item of frame.labels) {
        if (!owners.has(item.id)) {
          throw new Error(`${label} frame ${frame.stepIndex} 标签 ${item.id} 不存在`);
        }
      }
    }
  };
  if ('frames' in solution) {
    throw new Error('Solution 顶层不得出现 frames；逐帧数据挂在 render_specs[i].frames');
  }
  for (const spec of solution.render_specs) {
    checkFrames(spec.frames, `render_spec ${spec.id}.frames`);
  }
}

/**
 * 单题型契约：
 * - paths 2–3 条，id 唯一；ready 必须 3 条且 principle 两两不同；
 * - renderType=null（本来无图）不得 ready；
 * - ready 必须有 solver + ≥1 夹具 + 示例；example-only 必须有示例；
 * - planned 不得偷偷带 solver / 夹具 / 示例。
 */
export function assertTemplateEntry(entry: TemplateEntry): void {
  const expectedSubject = SUBJECT_PREFIX[entry.id[0]];
  if (!expectedSubject) throw new Error(`题型 id 前缀非法：${entry.id}`);
  if (entry.subject !== expectedSubject) {
    throw new Error(`题型 ${entry.id} 科目应为 ${expectedSubject}，实际 ${entry.subject}`);
  }
  if (entry.tier !== 'T1' && entry.tier !== 'T2') {
    throw new Error(`题型 ${entry.id} Tier 非法`);
  }
  if (!entry.criterion.trim()) throw new Error(`题型 ${entry.id} 缺少判据`);

  if (entry.paths.length < 2 || entry.paths.length > 3) {
    throw new Error(`${entry.id}：paths 必须 2–3 条，实际 ${entry.paths.length}`);
  }
  const pathIds = new Set<string>();
  for (const path of entry.paths) {
    if (!path.id || !path.label || !path.principle || !path.intermediate) {
      throw new Error(`${entry.id}：path 字段不完整`);
    }
    if (pathIds.has(path.id)) throw new Error(`${entry.id}：path id 重复 ${path.id}`);
    pathIds.add(path.id);
    const tolerance = path.tolerance ?? RESIDUAL_TOLERANCE;
    if (tolerance < RESIDUAL_TOLERANCE) {
      throw new Error(`${entry.id}/${path.id}：tolerance 不得低于 ${RESIDUAL_TOLERANCE}`);
    }
    if (tolerance >= MAX_PATH_TOLERANCE) {
      throw new Error(`${entry.id}/${path.id}：tolerance=${tolerance} 达到上限 ${MAX_PATH_TOLERANCE}，等于关闭校验`);
    }
    if (tolerance > RESIDUAL_TOLERANCE && !path.approximation?.trim()) {
      throw new Error(`${entry.id}/${path.id}：tolerance 放宽必须写明 approximation`);
    }
    if (tolerance === RESIDUAL_TOLERANCE && path.approximation?.trim()) {
      throw new Error(`${entry.id}/${path.id}：默认容差不得填 approximation`);
    }
  }
  const principles = entry.paths.map((path) => path.principle);
  if (new Set(principles).size !== entry.paths.length) {
    throw new Error(`${entry.id}：paths 的 principle 必须两两不同`);
  }
  const intermediates = entry.paths.map((path) => path.intermediate);
  if (new Set(intermediates).size !== entry.paths.length) {
    throw new Error(`${entry.id}：paths 的 intermediate 必须两两不同`);
  }

  // null 不是默认值，而是一句声明：ready 时必须给出为什么本来不需要图。
  if (entry.renderType === null) {
    if (entry.status === 'ready' && !entry.figurelessReason?.trim()) {
      throw new Error(`${entry.id}：renderType=null 且 ready，必须填 figurelessReason`);
    }
  } else if (entry.figurelessReason?.trim()) {
    throw new Error(`${entry.id}：renderType=${entry.renderType}，不得填 figurelessReason`);
  }

  const variantIds = new Set<string>();
  for (const variant of entry.variants ?? []) {
    if (!variant.id.startsWith(`${entry.id}-`)) {
      throw new Error(`${entry.id}：组态变体 id ${variant.id} 必须以 ${entry.id}- 开头`);
    }
    if (variantIds.has(variant.id)) throw new Error(`${entry.id}：组态变体 id 重复 ${variant.id}`);
    variantIds.add(variant.id);
    if (!variant.title.trim() || !variant.short.trim() || !variant.config.trim() || !variant.example.trim()) {
      throw new Error(`${entry.id}/${variant.id}：组态变体字段不完整`);
    }
  }
  if ((entry.variants?.length ?? 0) > 0 && entry.status !== 'ready') {
    throw new Error(`${entry.id}：只有 ready 型才能登记组态变体`);
  }

  if (entry.status === 'ready') {
    if (!entry.params || entry.params.length === 0) {
      throw new Error(`${entry.id}：ready 必须声明参数实验场参数`);
    }
    const paramKeys = new Set<string>();
    for (const param of entry.params) {
      if (!param.key.trim() || !param.label.trim()) {
        throw new Error(`${entry.id}：参数 key/label 不得为空`);
      }
      if (paramKeys.has(param.key)) throw new Error(`${entry.id}：参数 key 重复 ${param.key}`);
      paramKeys.add(param.key);
      if (param.kind === 'number') {
        if (typeof param.defaultValue !== 'number' || !Number.isFinite(param.defaultValue)) {
          throw new Error(`${entry.id}/${param.key}：number 默认值必须是有限数字`);
        }
        if (param.min !== undefined && param.defaultValue < param.min) {
          throw new Error(`${entry.id}/${param.key}：默认值 ${param.defaultValue} 小于 min`);
        }
        if (param.max !== undefined && param.defaultValue > param.max) {
          throw new Error(`${entry.id}/${param.key}：默认值 ${param.defaultValue} 大于 max`);
        }
        if (param.log && !(typeof param.min === 'number' && param.min > 0)) {
          throw new Error(`${entry.id}/${param.key}：log 滑杆要求 min > 0`);
        }
      } else if (param.kind === 'bits') {
        if (!Array.isArray(param.defaultValue) || param.defaultValue.some((bit) => bit !== 0 && bit !== 1)) {
          throw new Error(`${entry.id}/${param.key}：bits 默认值必须是 0/1 数组`);
        }
        if (param.bitLabels && param.bitLabels.length !== param.defaultValue.length) {
          throw new Error(`${entry.id}/${param.key}：bitLabels 长度与默认值不一致`);
        }
      } else {
        throw new Error(`${entry.id}/${param.key}：kind 非法`);
      }
    }
    if (entry.paths.length !== 3) {
      throw new Error(`${entry.id}：ready 必须 3 条 paths，实际 ${entry.paths.length}`);
    }
    if (!entry.solver) throw new Error(`${entry.id}：ready 但缺少 solver`);
    if (entry.golden.length === 0) throw new Error(`${entry.id}：ready 但缺少黄金夹具`);
    if (!entry.example) throw new Error(`${entry.id}：ready 但缺少预置示例`);
  }

  if (entry.status === 'example-only') {
    if (!entry.example) throw new Error(`${entry.id}：example-only 但没有示例`);
    if (entry.paths.length < 2) throw new Error(`${entry.id}：example-only 至少 2 条 paths`);
  }

  if (entry.status === 'planned') {
    if (entry.solver || entry.golden.length > 0 || entry.example) {
      throw new Error(`${entry.id}：仍为 planned，却带有 solver / 夹具 / 示例`);
    }
  }
}

/** 注册表不变量；传入 solution 时一并检查跨图 id 与 table 契约。 */
export function assertRegistryInvariants(solution?: Solution): void {
  const seen = new Set<TemplateId>();
  const variantIds = new Set<string>();
  for (const entry of TEMPLATES) {
    if (seen.has(entry.id)) throw new Error(`题型重复注册：${entry.id}`);
    seen.add(entry.id);
    assertTemplateEntry(entry);
    for (const variant of entry.variants ?? []) {
      if (variantIds.has(variant.id)) throw new Error(`组态变体重复注册：${variant.id}`);
      variantIds.add(variant.id);
    }
  }
  if (solution) assertSolutionContract(solution);
}

assertRegistryInvariants();