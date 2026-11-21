// 空间桁架数据契约 —— 与 solve-deck Solution 风格对齐，P2 求解器直接消费。
// 坐标约定：世界坐标，单位 m，Y 轴竖直向上（与 three.js 一致）。

export type Axis = "x" | "y" | "z";

/** 结点自由度：平动 x/y/z + 转动 rx/ry/rz（6-DOF 统一口径，Q1） */
export type Dof = Axis | "rx" | "ry" | "rz";

export const DOFS: Dof[] = ["x", "y", "z", "rx", "ry", "rz"];

export interface Node3 {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface Member {
  id: string;
  a: string; // 起点结点 id
  b: string; // 终点结点 id
  A: number; // 截面积 m²
  E: number; // 弹性模量 Pa
  /** 单元类型：truss=只传轴力（默认，一期口径）；beam=12×12 空间梁单元（Q1） */
  kind?: "truss" | "beam";
  /** 内部刚性连接（实体块内部的隐藏支撑）：照常参与求解，但画布/结果表都不展示 */
  hidden?: boolean;
  /** 梁截面属性（kind=beam 必填）：对局部 y/z 轴惯性矩 m⁴、扭转常数 m⁴ */
  Iy?: number;
  Iz?: number;
  J?: number;
  /** 剪切模量 Pa，缺省取 E/2.6（钢） */
  G?: number;
  /** 端部铰：释放该端 My/Mz（弯矩），默认 false */
  releaseA?: boolean;
  releaseB?: boolean;
  // ---- Q2 截面/材料口径（应力后处理与强度校核用） ----
  /** 截面库预设 id（编辑器写回 A/Iy/Iz/J/Wy/Wz/Wt/ks；求解器不消费） */
  sectionId?: string;
  /** 材料库 id 与安全因数 n（σallow=σs/n，编辑器口径字段，求解器不消费） */
  materialId?: string;
  safetyN?: number;
  /** 弯曲截面模量 m³：σ=|My|/Wy+|Mz|/Wz（缺项 → 该分量应力跳过并警告） */
  Wy?: number;
  Wz?: number;
  /** 抗扭截面模量 m³：τ=T/Wt */
  Wt?: number;
  /** 剪应力实用计算形状系数：τ=ks·|V|/A（矩形 1.5、圆 4/3、管 2） */
  ks?: number;
  /** 许用正应力 Pa（设置即触发该杆应力后处理与强度校核） */
  sigmaAllow?: number;
  /** 许用切应力 Pa（可选，剪/扭校核） */
  tauAllow?: number;
}

export interface Support {
  node: string;
  /** 约束的自由度；球铰 = ["x","y","z"]，固定端 = 6 个全锁 */
  fix: Dof[];
  /** 弹性支座：对指定自由度附加弹簧刚度 k（N/m 或 N·m/rad），不进 fix 集合 */
  springs?: { dof: Dof; k: number }[];
}

export interface Load3 {
  node: string;
  fx?: number;
  fy?: number;
  fz?: number;
  /** 结点力偶 N·m（仅梁模型可承受；桁架结点上出现将触发拒答） */
  mx?: number;
  my?: number;
  mz?: number;
}

/** 杆上荷载（仅作用于 kind=beam 杆件，Q1）：固端力/等效结点荷载自动折算。单位：point=N，uniform/linear=N/m。 */
export interface MemberLoad {
  member: string;
  kind: "point" | "uniform" | "linear";
  /** point：距 A 端距离 m */
  pos?: number;
  /** 荷载分量（全局轴向）：point 为集中力，uniform 为满跨均布集度，linear 为 A 端集度 */
  fx?: number;
  fy?: number;
  fz?: number;
  /** linear（梯形）：B 端集度 */
  fx2?: number;
  fy2?: number;
  fz2?: number;
}

/** 实体块（编辑器「+实体」）：真正画出来的填充体，与框架结点/杆件并存。
 *  求解仍只消费 nodes/members；本记录只携带几何与所属结点，供画布画实心面 + 棱线。
 *  缺键时模型与旧口径完全一致（不写空数组，保住快照逐字节红线）。 */
export interface SolidBody {
  id: string;
  /** 底面边数 3..16（12≈圆柱/圆台） */
  sides: number;
  /** 底面中心；cy 为底面标高 */
  cx: number;
  cy: number;
  cz: number;
  /** 底面 x 向宽、z 向深、y 向高 m */
  w: number;
  d: number;
  h: number;
  /** 顶面 x/z 缩放（0=收尖）与绕 y 扭转角（度） */
  topScaleW: number;
  topScaleD: number;
  twist: number;
  /** 归属该实体的底环 + 顶环节点 id（堆叠合并后可能含重复项） */
  nodes: string[];
}

export interface TrussModel {
  id: string;
  name: string;
  nodes: Node3[];
  members: Member[];
  supports: Support[];
  loads: Load3[];
  memberLoads?: MemberLoad[];
  /** 实体块外观（与框架结点/杆件并存；只在用过「+实体」的模型里出现） */
  solids?: SolidBody[];
  /** Q2 压杆稳定：求解后做几何刚度广义特征值 → Pcr = λ × 当前荷载（全部荷载同乘 λ 即临界） */
  buckling?: boolean;
  /** Q2 能量法：输出总应变能（J），供卡氏定理/单位载荷法对账 */
  reportEnergy?: boolean;
  /** Q3 刚体静力引擎（E2）：存在即走刚体路由，杆件仅作轮廓渲染不参与求解 */
  rigid?: RigidSpec;
}

// ---------- Q3 刚体静力学（引擎 E2） ----------

/** 刚体 = 结点集合（力作用点/轮廓顶点）；两刚体共享结点 = 铰连接；单结点刚体按质点口径（只列 3 力方程） */
export interface RigidBody {
  id: string;
  name: string;
  nodes: string[];
}

/** 摩擦接触（S6）：node 处光滑法向约束 + 切平面摩擦，静摩擦系数 f，判别 |Ft| ≤ f·Fn */
export interface FrictionContact {
  node: string;
  /** 接触面法向（指向刚体一侧，自动归一） */
  normal: [number, number, number];
  f: number;
}

/** 重心/形心组合体部件（S7）：node 放在部件形心，w 为重量/面积/体积（口径自洽即可，负值=挖空） */
export interface GravityPart {
  node: string;
  w: number;
}

export interface RigidSpec {
  bodies: RigidBody[];
  friction?: FrictionContact[];
  gravity?: GravityPart[];
  /** 力系简化主矩基点 O（缺省原点） */
  simplifyAt?: [number, number, number];
}

/** 力系简化结果（S3/S4）：主矢 R、对 O 主矩 M、最简形式；合力/力螺旋给出作用线/中心轴 */
export interface SimplifyResult {
  O: [number, number, number];
  R: [number, number, number];
  M: [number, number, number];
  form: "equilibrium" | "couple" | "force" | "wrench";
  formCn: string;
  /** 合力作用线 / 力螺旋中心轴：轴上一点 p + 方向 d（沿 R）；pitch=螺旋参数 (R·M)/|R|² */
  axis?: { p: [number, number, number]; d: [number, number, number]; pitch?: number };
}

/** 铰接内力（S5 拆体）：f 为作用在 bodies[1] 上的铰链力（bodies[0] 受反力） */
export interface HingeForce {
  node: string;
  bodies: [string, string];
  f: [number, number, number];
}

/** 摩擦锥判别报告（S6） */
export interface FrictionReport {
  node: string;
  Fn: number;
  Ft: number;
  Fmax: number;
  state: "stick" | "critical" | "slip" | "separate";
  /** 摩擦角 atan(f) rad */
  angle: number;
  note: string;
}

export interface CentroidReport {
  c: [number, number, number];
  W: number;
}

/** 约束反力教学命名（受力图口径） */
export interface ReactionLabel {
  /** 球铰支座 / 固定铰支座 / 辊轴支座 / 固定端 / 摩擦接触 … */
  type: string;
  force?: [string, string, string];
  moment?: [string, string, string];
}

export function nodeMap(model: TrussModel): Map<string, Node3> {
  return new Map(model.nodes.map((n) => [n.id, n]));
}

// ---------- 编辑器（P5 真实交互） ----------

/** 画布编辑工具：选择 / 加结点 / 连构件 / 设支座 / 加荷载 / 删除 / 加实体框架 */
export type EditTool = "select" | "node" | "member" | "support" | "load" | "delete" | "solid";

/** 栅格吸附步长（m）——PLAN §2.5：拖拽只作粗调，精调走坐标数值输入 */
export const SNAP = 0.5;

/** 原型结点上限（PLAN §2.5：稠密消元规模约束） */
export const MAX_NODES = 200;

export function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

// ---------- 求解输出契约（与 solve-deck Solution 同构） ----------

export type DeterminacyKind = "determinate" | "indeterminate" | "mechanism";

export interface MemberForce {
  id: string;
  N: number; // 轴力 N，拉为正（梁杆取 A 端截面轴力）
  kind: "tension" | "compression" | "zero";
}

/** 控制截面内力（材料力学六分量口径，局部轴：x̂ 杆轴、ŷ/ẑ 截面轴；N=kN 级数值按 SI 存） */
export interface MemberSection {
  x: number; // 距 A 端 m
  N: number;
  Vy: number;
  Vz: number;
  T: number; // 扭矩（绕 x̂）
  My: number; // 绕 ŷ 弯矩
  Mz: number; // 绕 ẑ 弯矩
  /** 集中荷载作用点给出左右两侧值 */
  side?: "left" | "right";
}

export interface MemberInternal {
  id: string;
  kind: "truss" | "beam";
  L: number;
  sections: MemberSection[];
}

// ---------- Q2 应力后处理 / 强度理论 / 稳定 ----------

/** 危险点应力状态（平面应力口径 σ3=0；主应力按 s1≥s2≥s3 排序） */
export interface StressPoint {
  x: number;
  side?: "left" | "right";
  sigma: number; // σ = N/A + |My|/Wy + |Mz|/Wz
  tauT: number; // 扭转切应力 T/Wt
  tauV: number; // 剪力实用切应力 ks·|V|/A
  tau: number; // √(τT²+τV²)
  s1: number;
  s2: number;
  s3: number;
  tresca: number; // 第三强度理论相当应力
  mises: number; // 第四强度理论相当应力（默认校核口径）
}

export interface MemberStress {
  id: string;
  points: StressPoint[];
  worst: number; // 最危险点下标（按 mises）
  sigmaMax: number;
  tauMax: number;
  ratio: number; // max(mises)/σallow
  tauRatio: number; // max(τ)/τallow（无 τallow 时为 0）
  pass: boolean;
}

export interface BucklingReport {
  ok: boolean;
  lambda: number; // 荷载乘子：全部荷载同乘 λ 即达临界
  loadRef: string; // 基准荷载口径说明
  mode: { node: string; d: [number, number, number] }[]; // 屈曲模态（最大分量归一）
  /** 幂迭代是否收敛（评审 P0-4：跑满 300 次不再假装成功） */
  converged?: boolean;
  note?: string;
}

export interface Check {
  name: string;
  pass: boolean;
  residual: number;
  note?: string;
}

export interface SolveStep {
  title: string; // 认题 / 建模 / 求解 / 校核
  detail: string;
}

export interface Solution3D {
  modelId: string;
  headline: string;
  verified: boolean; // 所有校核通过才允许盖「已验证」
  determinacy: DeterminacyKind;
  reactions: Record<string, [number, number, number]>;
  memberForces: MemberForce[];
  displacements: Record<string, [number, number, number]>;
  steps: SolveStep[];
  checks: Check[];
  warnings: string[];
  refusals?: string[]; // 拒答时：理由 + 改法，且 memberForces 为空
  solveMs: number;
  // ---- Q1 梁扩展（仅含梁单元模型输出；纯桁架模型必须保持缺键，快照逐字节红线） ----
  /** 固定端反力矩 N·m */
  reactionMoments?: Record<string, [number, number, number]>;
  /** 结点转角 rad */
  rotations?: Record<string, [number, number, number]>;
  /** 逐杆控制截面内力表（D-C 拍板：Q1 数值表口径） */
  internals?: MemberInternal[];
  // ---- Q2 材料力学后处理（仅模型设置许用应力 / buckling / reportEnergy 时输出，保 T/B 快照红线） ----
  /** 逐杆应力后处理 + 强度理论校核（有杆件设置 sigmaAllow/tauAllow 时输出） */
  stress?: MemberStress[];
  /** 压杆稳定报告（model.buckling=true 时输出） */
  buckling?: BucklingReport;
  /** 总应变能 J（model.reportEnergy=true 时输出） */
  energy?: number;
  // ---- Q3 刚体静力（仅 model.rigid 路由输出，T/B/C 快照逐字节红线） ----
  /** 主动力系简化结果（主矢/主矩/最简形式） */
  simplify?: SimplifyResult;
  /** 铰接内力（物体系拆体 S5） */
  hingeForces?: HingeForce[];
  /** 摩擦锥判别（S6） */
  friction?: FrictionReport[];
  /** 重心/形心（S7） */
  centroid?: CentroidReport;
  /** 约束反力教学命名（受力图渲染用） */
  reactionLabels?: Record<string, ReactionLabel>;
}

// ---------- Q4 运动学/动力学（引擎 E3）：机构模型 + 时程输出 ----------

/** E3 模板类型：K=运动学（解析），D=动力学（RK4/闭式+守恒校核） */
export type MechType = "K1" | "K2" | "K3" | "K4" | "K4R" | "D1" | "D2" | "D3" | "D4" | "D5";

/** 机构构件连线（仅渲染用：端点 id 对应 nodes，动画时按帧插值重画） */
export interface MechMember {
  id: string;
  a: string;
  b: string;
}

/**
 * 机构模型：与 TrussModel 并列的独立契约（E3 路由），走 #/m/<id>。
 * p 为模板参数扁平表（通用数值编辑器直接消费；求解器按键取值，缺省 0）。
 * 约定键：tKey=金色对账时刻 s；duration 在模型级。
 */
export interface MechModel {
  id: string;
  name: string;
  type: MechType;
  /** 初始位形结点（画布与模板几何基准） */
  nodes: Node3[];
  members?: MechMember[];
  p: Record<string, number>;
  /** 仿真时长 s（D5 为 θ 扫描区间，单位 rad） */
  duration: number;
  /** 输出采样帧数（缺省 61） */
  samples?: number;
}

/** 时程曲线（时程图 + 快照对账共用） */
export interface KinSeries {
  name: string;
  unit: string;
  values: number[];
}

/** 动画帧：机构各点当前位形；vel/acc 为可画速度/加速度矢量的关键点 */
export interface KinFrame {
  t: number;
  pts: Record<string, [number, number, number]>;
  vel?: Record<string, [number, number, number]>;
  acc?: Record<string, [number, number, number]>;
}

export interface KinKeyValue {
  name: string;
  value: number;
  unit: string;
}

/** E3 输出契约：与 Solution3D 同构口径（headline/checks/refusals/steps），拒答不产数字 */
export interface SolutionKin {
  modelId: string;
  kind: "kin" | "dyn";
  headline: string;
  verified: boolean;
  duration: number;
  frames: KinFrame[];
  series: KinSeries[];
  keyValues: KinKeyValue[];
  steps: SolveStep[];
  checks: Check[];
  warnings: string[];
  refusals?: string[];
  solveMs: number;
}

/** 重力加速度统一口径（金色对账基准） */
export const G_ACC = 9.8;

/** 默认输出帧数 */
export const KIN_SAMPLES = 61;
