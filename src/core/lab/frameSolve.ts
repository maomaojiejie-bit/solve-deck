/**
 * W15-S2 力学通用求解：2D 框架刚度法（平面杆系），输入画布本身。
 *
 * 与模板求解器的关系：模板（M3/S5…）只负责「讲解稿」；这张图只要杆件拓扑
 * 合法（有支座、几何稳定），刚度法一盘就解——超静定直接算，不再因
 * 「题库没这一型」拒答。不 import 任何 src/core/templates/**（高斯消元 /
 * 单元刚度全部本地实现），对账只读 examples 快照 JSON（门禁里做）。
 *
 * ── 三个坑，S1 的参考点/运放系数是同一类，先写死 ──
 * ① 支座约束一律【行列划去】（从 active 自由度里删掉行列再解）。
 *    大数惩罚会污染残差（ΣF 残差是验收项 <1e-9），且惩罚刚度会掩盖
 *    「几何不稳定」——划去后矩阵奇异才是真机构，能如实判出来。
 * ② 桁架杆必须【释放转动】（releaseMoment）：杆端弯矩全放掉，单元只留
 *    轴向刚度 (EA/L)·aaᵀ（a=[-c,-s,c,s]，全局坐标下的 rank-1）。否则
 *    三杆桁架的结点转角被卡死，AC/BC 的刚体转动互相打架诱发出弯矩，
 *    轴力不再是 -qL/√2 那套——桁架整个变刚架（门禁 ⑥ 变异验的正是它）。
 *    纯桁架结点（所连杆全是桁架杆、无固定端、无力偶）的 θ 自由度无刚度，
 *    跟支座一起划去——不是惩罚，是它本来就不是未知量。
 * ③ 回代得到的是【杆端力】f̄ = k·u − f_eq（f_eq 是单元内载荷的一致结点
 *    载荷向量，不是直接结点载荷），内力按「沿 x 积分」恢复，符号与库
 *    （M3 快照 conventions）对齐：Q 顺时针为正、M 下侧受拉为正、N 拉为正。
 *    杆端映射（单元内载荷恒在杆跨内 (0,1)，端点载荷吸附成结点载荷）：
 *      N(0)=-f̄₁  N(L)=+f̄₄   Q(0)=+f̄₂  Q(L)=-f̄₅   M(0)=-f̄₃  M(L)=+f̄₆
 *
 * ── 画法约定（如实，不是猜测；与 graphToBeam 同一套 kind） ──
 *  - 结点 = kind 'pin' | 'dot' 的器件；杆件 = 边 kind 'beam'/'shaft'（梁 /
 *    刚架段，弯剪轴都刚）或 'trussMember'/'line'（桁架杆，释放转动）。
 *  - 支座 = 器件 kind pinSupport（固定铰：约束 ux,uy）/ rollerSupport（可动
 *    铰：约束 uy，滚动方向按水平梁惯例取竖直）/ fixedSupport（固定端：三约束）。
 *    cable/smooth 支座如实拒答。支座吸附到最近结点（容差 = 0.35·最短杆长）。
 *  - 载荷 = 器件 kind arrow（集中力，rot 定方向：rot 0 = 向下、90 = 向左、
 *    180 = 向上、270 = 向右 —— 与图元 SVG rotate 同一套，见 M1 快照里"向右拉"
 *    的载荷写成 rot270、"向左"的反力写成 rot90）/
 *    udl（均布，按满杆长、方向恒竖直向下 = 重力向）/ momentArrow（力偶，
 *    逆时针为正）。反力箭头（id 前缀 n-reaction- 或 R_/M_ 开头标注）不是载荷。
 *  - 坐标换算：画布 y 向下，求解前翻转成物理坐标 Y = −y；若 meta.L 是正数
 *    且图幅横向有宽度，按 scale = meta.L / 图幅宽 把像素换算成物理长度
 *    （均布载荷的「每米」才有意义；集中力与比例几何不受影响）。
 *  - 刚度取 EA=EI=1（meta.EA/meta.EI 可覆盖）：内力与反力只依赖刚度【比例】，
 *    均匀取值不影响任何验收量；位移只是相对量，如实标注不承诺绝对值。
 *
 * 拒答方式：本函数按约定接口直接返回 FrameSolution；画布不合法时 throw
 * Error（人话），调用方（S4 结果页）负责接住展示。
 */

import { REACTION_LABEL, valueFromLabel } from './picks.ts';
import { supportRefs } from './attach.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';

/** 变异开关：check:framesolve ⑥ 把它关掉（桁架当刚架）→ 桁架断言红。 */
export const FRAME_SOLVE_CONFIG = {
  releaseMoment: true,
  /**
   * W19：载荷吸附到结点的容差（**画布像素**，不是杆长比例）。
   * 以前和支座共用 0.35·minL —— 单跨 4m 时「离端点 1.4m 以内」的集中力会被
   * 静默挪到支座上（t=0.7 的 20kN 变成支座载荷，|M|max 直接掉成 0）。
   * 现在按像素：只有"画在结点上"（≤12 画布单位，S5 的顶点载荷差 6 个单位）
   * 才吸附；跨内载荷按投影 t 算。
   * 变异位：check:measures 把它调成 1e6 → 一切吸附，②⑥ 必红。
   */
  loadSnapPx: 12,
  /** 兜底：无论画布比例如何，最多吃杆长的 5%（防止坐标本来就是米时 12"像素"=12m）。 */
  loadSnapFraction: 0.05,
  /**
   * 内力曲线每个断点段的采样数。deflectionOf 把相邻样本之间的 M 当作线性
   * 积分（v''=M）；均布段的 M 是二次的，只取首/中/末三点会把对称梁的
   * δmax 算偏约 2%（P=20+q=5 时 3.313 mm vs 解析 3.250 mm），峰值位置也会
   * 偏离跨中。加密到 16 段后误差约 0.03%，绘图也会更顺。
   */
  curveSubdivisions: 16,
};

/* ── 输出契约 ───────────────────────────────────────────────────── */

export interface FrameReaction {
  nodeId: string;
  fx: number;
  fy: number;
  mz: number;
}

export interface FrameDisplacement {
  nodeId: string;
  u: number;
  v: number;
  theta: number;
}

export interface MemberEndForce {
  edgeId: string;
  /** [始端, 末端]；拉为正。 */
  N: [number, number];
  /** [Q(0⁺), Q(L⁻)]；顺时针为正。 */
  Q: [number, number];
  /** [M(0), M(L)]；下侧受拉为正。 */
  M: [number, number];
}

/** 沿杆采样（局部 x 从 0 到 L；断点 + 段中点，Q/M 闭式精确，不是差分）。 */
export interface MemberCurve {
  edgeId: string;
  /** gx = 全局 X（多杆共享 x 轴画内力图用；水平杆 gx = x + 始端 X）。 */
  samples: { x: number; gx: number; N: number; Q: number; M: number }[];
}

/** W19：杆件几何（位移积分要按杆逐段做，且要知道哪一端是起点）。 */
export interface FrameMemberInfo {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  /** 物理长度 */
  L: number;
  /** 该杆抗弯刚度（相对比例，缺省 1） */
  ei: number;
  /** 是否水平杆（位移曲线只在水平杆上直接可画） */
  horizontal: boolean;
}

/** W19：杆件几何（位移要按杆逐段积分，且需要知道哪一端是起点）。 */
export interface FrameMemberInfo {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  /** 物理长度 */
  L: number;
  /** 该杆抗弯刚度（相对比例，缺省 1） */
  ei: number;
  /** 是否水平杆（位移曲线只在水平杆上直接可画） */
  horizontal: boolean;
}

export interface FrameSolution {
  reactions: FrameReaction[];
  displacements: FrameDisplacement[];
  memberEndForces: MemberEndForce[];
  extremes: { Mmax: number; atX: number; Qmax: number };
  residual: { sumFx: number; sumFy: number; sumM: number };
  /**
   * S2 相对约定接口的增量（如实交代）：每杆内力曲线采样。extremes 只给
   * 极值，跨中 M / Q(2) 这类抽查位置必须有曲线才能断言，S4 结果页的
   * N/Q/M 三图也直接吃它。
   */
  memberCurves: MemberCurve[];
  /** W19：杆件几何（位移视图按杆积分、稳定判据取杆长）。 */
  members: FrameMemberInfo[];
  /** 不拦解的如实说明（像素换算、同结点双支座、被跳过的悬空边…）。 */
  notes: string[];
}

/* ── 图解析 ─────────────────────────────────────────────────────── */

const FRAME_KINDS = new Set(['beam', 'shaft']);
const TRUSS_KINDS = new Set(['trussMember', 'line']);
const LOAD_KINDS = new Set(['arrow', 'udl', 'momentArrow']);

interface Joint {
  id: string;
  x: number;
  y: number;
}

interface Member {
  id: string;
  i: number;
  j: number;
  truss: boolean;
  L: number;
  c: number;
  s: number;
  /** 该杆的轴向 / 抗弯刚度（相对比例，缺省 1；W17-C 杆行 A/I/E 可改）。 */
  ea: number;
  ei: number;
}

interface Support {
  nodeId: string;
  joint: number;
  type: 'pin' | 'roller' | 'fixed';
}

/** 集中力（全局物理坐标）；onMember 为空 = 结点载荷。 */
interface PointLoad {
  px: number;
  py: number;
  joint: number | null;
  member: number | null;
  t: number;
}

/** 均布载荷：满杆长、竖直向下 q（物理单位/长度）。 */
interface UdlLoad {
  member: number;
  q: number;
}

interface MomentLoad {
  joint: number;
  mz: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Parsed {
  joints: Joint[];
  members: Member[];
  supports: Support[];
  pointLoads: PointLoad[];
  udlLoads: UdlLoad[];
  momentLoads: MomentLoad[];
  notes: string[];
}

function parseGraph(graph: CanvasGraph): Parsed {
  const eaFallback = typeof graph.meta.EA === 'number' && graph.meta.EA > 0 ? graph.meta.EA : 1;
  const eiFallback = typeof graph.meta.EI === 'number' && graph.meta.EI > 0 ? graph.meta.EI : 1;
  const notes: string[] = [];

  // 物理坐标：Y = −画布 y；meta.L 给物理全长时按图幅宽换算像素 → 物理长度
  const canvasJoints = graph.nodes.filter((node) => node.kind === 'pin' || node.kind === 'dot');
  if (canvasJoints.length === 0) fail('画布上没有结点（pin/dot）：先从骨架或构件面板搭出结构。');
  const xs = canvasJoints.map((node) => node.x);
  const width = Math.max(...xs) - Math.min(...xs);
  const metaL = graph.meta.L;
  const scale = typeof metaL === 'number' && metaL > 0 && width > 1e-9 ? metaL / width : 1;
  if (scale !== 1) notes.push(`按 meta.L=${metaL} 把图幅宽度换算为物理长度（scale=${scale.toPrecision(4)} m/px）。`);
  const joints: Joint[] = canvasJoints.map((node) => ({ id: node.id, x: node.x * scale, y: -node.y * scale }));
  // 结构平移到原点（画布原点≠结构原点时，extremes.atX 与内力图的 x 轴会带着
  // 一个无意义的偏移，如 M3 像素图 → @0.875）：力与反力平移不变，ΣF=0 时 ΣM 也不变。
  const minX = Math.min(...joints.map((joint) => joint.x));
  const minY = Math.min(...joints.map((joint) => joint.y));
  // 支座 / 载荷的坐标换算必须走同一个平移，否则吸附容差会被假距离撑破
  const physX = (canvasX: number): number => canvasX * scale - minX;
  const physY = (canvasY: number): number => -canvasY * scale - minY;
  for (const joint of joints) {
    joint.x -= minX;
    joint.y -= minY;
  }
  const jointById = new Map(joints.map((joint, index) => [joint.id, index]));

  // 杆件：边两端都要落在结点上（id 或 'x,y' 字面），落不上如实跳过并记录
  const members: Member[] = [];
  for (const edge of graph.edges) {
    const isFrame = FRAME_KINDS.has(edge.kind);
    const isTruss = TRUSS_KINDS.has(edge.kind);
    if (!isFrame && !isTruss) continue;
    const resolve = (raw: string): number | null => {
      const byId = jointById.get(raw);
      if (byId !== undefined) return byId;
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
      if (m) {
        const cx = Number(m[1]) * scale;
        const cy = -Number(m[2]) * scale;
        let best = -1;
        let bestD = Infinity;
        joints.forEach((joint, index) => {
          const d = Math.hypot(joint.x - cx, joint.y - cy);
          if (d < bestD) {
            bestD = d;
            best = index;
          }
        });
        if (best >= 0 && bestD <= 0.6 * scale + 1e-9) return best;
      }
      return null;
    };
    const i = resolve(edge.from);
    const j = resolve(edge.to);
    if (i === null || j === null || i === j) {
      notes.push(`构件「${edge.id}」两端没有都落在结点上，已跳过（不参与求解）。`);
      continue;
    }
    const a = joints[i];
    const b = joints[j];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= 1e-9) fail(`构件「${edge.id}」长度为零：两个结点重合了。`);
    members.push({
      id: edge.id,
      i,
      j,
      truss: isTruss,
      L,
      c: (b.x - a.x) / L,
      s: (b.y - a.y) / L,
      // W17-C：杆行的 A / I / E 按**相对比例**进刚度（EA=E·A、EI=E·I）；
      // 没种就落到 meta.EA / meta.EI，再落到 1 —— 旧行为逐位不变。
      ea: edgeStiffness(edge.E, edge.A, eaFallback),
      ei: edgeStiffness(edge.E, edge.I, eiFallback),
    });
  }
  if (members.length === 0) fail('画布上没有可求解的构件（beam/shaft/trussMember 边，且两端落在结点上）。');

  const minL = Math.min(...members.map((member) => member.L));
  /** 支座吸附容差（支座符号本来就和结点画在一起）。 */
  const snapTol = 0.35 * minL;
  /** W19：载荷只吸附「几乎正好落在结点上」的（见 FRAME_SOLVE_CONFIG.loadSnapPx / loadSnapFraction）。 */
  const loadSnapTol = Math.min(FRAME_SOLVE_CONFIG.loadSnapPx * scale, FRAME_SOLVE_CONFIG.loadSnapFraction * minL);
  const nearestJoint = (x: number, y: number, tol: number = snapTol): number | null => {
    let best = -1;
    let bestD = Infinity;
    joints.forEach((joint, index) => {
      const d = Math.hypot(joint.x - x, joint.y - y);
      if (d < bestD) {
        bestD = d;
        best = index;
      }
    });
    return bestD <= tol ? best : null;
  };

  // 支座（R3-1 A1：读 supportRefs —— 结点属性形态直接给 jointId，不再靠就近吸附；
  // 旧形态图元与孤儿支座仍走原来的吸附 / 如实跳过逻辑）
  const supports: Support[] = [];
  for (const ref of supportRefs(graph)) {
    const byId = ref.jointId !== null ? jointById.get(ref.jointId) : undefined;
    const joint = byId !== undefined ? byId : nearestJoint(physX(ref.x), physY(ref.y));
    if (joint === null || joint === undefined) {
      notes.push(`支座「${ref.label || ref.id}」附近没有结点（容差内），没有参与约束。`);
      continue;
    }
    supports.push({ nodeId: ref.id, joint, type: ref.type });
  }
  if (supports.length === 0) fail('画布上没有支座（pinSupport/rollerSupport/fixedSupport）：结构没有约束，解不了。');

  // 载荷（反力箭头不算：id 前缀 n-reaction- 或 R_/M_ 开头标注，与 graphToBeam 同判据）
  const pointLoads: PointLoad[] = [];
  const udlLoads: UdlLoad[] = [];
  const momentLoads: MomentLoad[] = [];
  const loadValue = (node: CanvasNode): number => {
    const value = node.value ?? valueFromLabel(node.label);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`载荷「${node.label || node.id}」没有数值：在参数表里给它填一个值。`);
    }
    return value;
  };
  for (const node of graph.nodes) {
    if (!LOAD_KINDS.has(node.kind)) continue;
    if (node.id.startsWith('n-reaction-') || REACTION_LABEL.test((node.label ?? '').trim())) continue;
    const x = physX(node.x);
    const y = physY(node.y);
    if (node.kind === 'momentArrow') {
      const joint = nearestJoint(x, y, loadSnapTol);
      if (joint === null) fail(`力偶「${node.label || node.id}」没有落在结点上：力偶要加在结点（pin/dot）上。`);
      // 方向跟图元走：渲染器约定 rot=0 逆时针、rot=180 顺时针（symbols.ts 力偶
      // 注释）。以前这里无视 rot —— 物件行「旋转 90°」转两下把力偶画成顺时针，
      // 求解还是按逆时针算，画与算相反。torqueArrow 同一套约定。
      const mRot = ((((node.rot ?? 0) % 360) + 360) % 360);
      const mSign = mRot === 180 ? -1 : 1;
      momentLoads.push({ joint, mz: mSign * loadValue(node) });
      continue;
    }
    if (node.kind === 'udl') {
      // 吸附到最近的杆件（按线段距离）
      let best = -1;
      let bestD = Infinity;
      members.forEach((member, index) => {
        const a = joints[member.i];
        const b = joints[member.j];
        const d = segDist(x, y, a.x, a.y, b.x, b.y);
        if (d < bestD) {
          bestD = d;
          best = index;
        }
      });
      const member = members[best];
      if (!member) fail(`均布载荷「${node.label || node.id}」附近没有构件。`);
      if (member.truss && FRAME_SOLVE_CONFIG.releaseMoment) {
        fail(`均布载荷「${node.label || node.id}」落在了桁架杆上：桁架杆中间不吃横向载荷，把它挪到结点或换成构件。`);
      }
      udlLoads.push({ member: best, q: loadValue(node) });
      continue;
    }
    // arrow：rot 定方向（画布系 rot 0 朝下）→ 物理系
    // 约定与渲染器**同一套**（SVG rotate 顺时针：rot 90 = 朝左，270 = 朝右；
    // 快照自证 —— M1 的载荷 rot270 画成"向右拉"、反力 rot90 画成"向左拉"）。
    // 所以物理分量 = (−sin rot, −cos rot)·P：rot0 → 向下，90 → 向左，270 → 向右。
    // R3-1 A3 修正：原来写成 (sin, −cos)，水平载荷的图与力反着来（rot90 画朝左、
    // 算成朝右）—— 竖向快照看不出来，一加横向载荷就自相矛盾。
    const rot = ((node.rot ?? 0) * Math.PI) / 180;
    const value = loadValue(node);
    const px = -Math.sin(rot) * value;
    const py = -Math.cos(rot) * value;
    const joint = nearestJoint(x, y, loadSnapTol);
    if (joint !== null) {
      pointLoads.push({ px, py, joint, member: null, t: 0 });
      continue;
    }
    // 不在结点上：投影到最近杆件
    let best = -1;
    let bestD = Infinity;
    let bestT = 0;
    members.forEach((member, index) => {
      const a = joints[member.i];
      const b = joints[member.j];
      const d = segDist(x, y, a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = index;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        bestT = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      }
    });
    const member = members[best];
    if (!member) fail(`集中力「${node.label || node.id}」附近没有构件也没有结点。`);
    if (member.truss && FRAME_SOLVE_CONFIG.releaseMoment) {
      fail(`集中力「${node.label || node.id}」落在了桁架杆中间：桁架杆只受轴力，把载荷放到结点上。`);
    }
    pointLoads.push({ px, py, joint: null, member: best, t: bestT });
  }

  // 孤立结点：没有杆件相连 → 自由度无刚度
  const connected = new Set<number>();
  for (const member of members) {
    connected.add(member.i);
    connected.add(member.j);
  }
  for (const support of supports) connected.add(support.joint);
  joints.forEach((joint, index) => {
    if (!connected.has(index)) fail(`结点「${joint.id}」没有任何构件与它相连（孤立点）：删掉它或补构件。`);
  });

  return { joints, members, supports, pointLoads, udlLoads, momentLoads, notes };
}

/* ── 线性代数 ───────────────────────────────────────────────────── */

/** 高斯消元（列主元）。奇异 → 几何不稳定，如实抛错（划去法才判得出来）。 */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  let norm = 0;
  for (const row of a) for (const value of row) norm = Math.max(norm, Math.abs(value));
  if (norm === 0) fail('刚度矩阵全零：结构没有任何有效约束或构件，几何不稳定。');
  const aug = a.map((row, index) => [...row, b[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
    }
    if (Math.abs(aug[pivot][col]) <= norm * 1e-11) {
      fail('几何不稳定（机构）：划去约束后刚度矩阵奇异——结构缺约束或缺构件（比如少一根斜杆、支座不够）。');
    }
    if (pivot !== col) {
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    }
    for (let row = col + 1; row < n; row += 1) {
      const factor = aug[row][col] / aug[col][col];
      if (factor === 0) continue;
      for (let term = col; term <= n; term += 1) aug[row][term] -= factor * aug[col][term];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = aug[row][n];
    for (let col = row + 1; col < n; col += 1) sum -= aug[row][col] * x[col];
    x[row] = sum / aug[row][row];
  }
  return x;
}

/** 6×6 单元刚度（局部坐标：x 沿杆 1→2，y 上）：DOF = [ux1, uy1, θ1, ux2, uy2, θ2]。 */
function kLocal(EA: number, EI: number, L: number): number[][] {
  const k: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const ax = EA / L;
  const b = EI / (L * L * L);
  const cpl = EI / (L * L);
  const rot = EI / L;
  const set = (r: number, c: number, v: number) => {
    k[r][c] = v;
    k[c][r] = v;
  };
  set(0, 3, -ax);
  k[0][0] = ax;
  k[3][3] = ax;
  set(1, 4, -12 * b);
  set(1, 2, 6 * cpl);
  set(1, 5, 6 * cpl);
  set(4, 2, -6 * cpl);
  set(4, 5, -6 * cpl);
  set(2, 5, 2 * rot);
  k[1][1] = 12 * b;
  k[4][4] = 12 * b;
  k[2][2] = 4 * rot;
  k[5][5] = 4 * rot;
  return k;
}

/** 全局→局部旋转变换 T（两块 R=[[c,s],[−s,c]]，θ 直通）。 */
function transformOf(c: number, s: number): number[][] {
  const T: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (const block of [0, 3]) {
    T[block][block] = c;
    T[block][block + 1] = s;
    T[block + 1][block] = -s;
    T[block + 1][block + 1] = c;
    T[block + 2][block + 2] = 1;
  }
  return T;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const mid = b.length;
  const cols = b[0].length;
  const out: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    for (let k2 = 0; k2 < mid; k2 += 1) {
      const aik = a[i][k2];
      if (aik === 0) continue;
      for (let j = 0; j < cols; j += 1) out[i][j] += aik * b[k2][j];
    }
  }
  return out;
}

const transpose = (m: number[][]): number[][] => m[0].map((_, col) => m.map((row) => row[col]));

/** 杆的刚度换算：E·截面（相对比例）；都没种 → 落 meta / 1（旧行为不变）。 */
function edgeStiffness(e: number | undefined, section: number | undefined, fallback: number): number {
  if (e === undefined && section === undefined) return fallback;
  const ee = typeof e === 'number' && e > 0 ? e : 1;
  const ss = typeof section === 'number' && section > 0 ? section : 1;
  return ee * ss;
}

/* ── 主入口 ─────────────────────────────────────────────────────── */

export function frameSolve(graph: CanvasGraph): FrameSolution {
  const parsed = parseGraph(graph);
  const { joints, members, supports, pointLoads, udlLoads, momentLoads, notes } = parsed;
  const nDof = joints.length * 3;

  // 自由度分类：支座约束与纯桁架结点的 θ 一律划去（不用大数惩罚）
  const restrained = new Set<number>();
  for (const support of supports) {
    const base = support.joint * 3;
    if (support.type === 'fixed') {
      restrained.add(base);
      restrained.add(base + 1);
      restrained.add(base + 2);
    } else if (support.type === 'pin') {
      restrained.add(base);
      restrained.add(base + 1);
    } else {
      // roller：只约束竖向（水平梁惯例，滚动方向取水平）
      restrained.add(base + 1);
    }
  }
  const membersAt = joints.map(() => [] as Member[]);
  for (const member of members) {
    membersAt[member.i].push(member);
    membersAt[member.j].push(member);
  }
  const momentAtJoint = new Set(momentLoads.map((load) => load.joint));
  const thetaInactive = new Set<number>();
  if (FRAME_SOLVE_CONFIG.releaseMoment) {
    joints.forEach((_joint, index) => {
      const base = index * 3;
      if (restrained.has(base + 2) || momentAtJoint.has(index)) return;
      const attached = membersAt[index];
      if (attached.length > 0 && attached.every((member) => member.truss)) thetaInactive.add(base + 2);
    });
  }
  const active: number[] = [];
  for (let dof = 0; dof < nDof; dof += 1) {
    if (!restrained.has(dof) && !thetaInactive.has(dof)) active.push(dof);
  }

  // 组装 K（满阵，供反力回代）与 F
  const K: number[][] = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const F = new Array<number>(nDof).fill(0);
  /** 单元内载荷的一致结点载荷（局部系），按杆收集——杆端力回代要减它。 */
  const fEqLocal = new Map<string, number[]>();
  const addFEq = (member: Member, vec: number[]) => {
    const cur = fEqLocal.get(member.id) ?? new Array<number>(6).fill(0);
    for (let i = 0; i < 6; i += 1) cur[i] += vec[i];
    fEqLocal.set(member.id, cur);
  };
  /** 外载合力清单（残差用）：作用点全局坐标 + 合力 + 力偶。 */
  const extLoads: { x: number; y: number; fx: number; fy: number; mz: number }[] = [];

  const scatter6 = (member: Member, kg: number[][]) => {
    const map = [member.i * 3, member.i * 3 + 1, member.i * 3 + 2, member.j * 3, member.j * 3 + 1, member.j * 3 + 2];
    for (let r = 0; r < 6; r += 1) {
      for (let c2 = 0; c2 < 6; c2 += 1) {
        K[map[r]][map[c2]] += kg[r][c2];
      }
    }
  };

  for (const member of members) {
    const trussReleased = member.truss && FRAME_SOLVE_CONFIG.releaseMoment;
    if (trussReleased) {
      // 桁架杆：全局坐标下 rank-1 轴向刚度 (EA/L)·aaᵀ，a=[-c,-s,c,s]
      const a = [-member.c, -member.s, member.c, member.s];
      const map = [member.i * 3, member.i * 3 + 1, member.j * 3, member.j * 3 + 1];
      const k = member.ea / member.L;
      for (let r = 0; r < 4; r += 1) {
        for (let c2 = 0; c2 < 4; c2 += 1) {
          K[map[r]][map[c2]] += k * a[r] * a[c2];
        }
      }
      continue;
    }
    const T = transformOf(member.c, member.s);
    const kg = matMul(transpose(T), matMul(kLocal(member.ea, member.ei, member.L), T));
    scatter6(member, kg);
  }

  // 结点载荷
  for (const load of pointLoads) {
    if (load.joint !== null) {
      F[load.joint * 3] += load.px;
      F[load.joint * 3 + 1] += load.py;
      const joint = joints[load.joint];
      extLoads.push({ x: joint.x, y: joint.y, fx: load.px, fy: load.py, mz: 0 });
    }
  }
  for (const load of momentLoads) {
    F[load.joint * 3 + 2] += load.mz;
    const joint = joints[load.joint];
    extLoads.push({ x: joint.x, y: joint.y, fx: 0, fy: 0, mz: load.mz });
  }

  // 单元内载荷：一致结点载荷向量（局部系）→ 转全局散装进 F
  const hermite = (t: number, L: number): [number, number, number, number] => [
    1 - 3 * t * t + 2 * t * t * t,
    L * (t - 2 * t * t + t * t * t),
    3 * t * t - 2 * t * t * t,
    L * (-t * t + t * t * t),
  ];
  const toGlobal6 = (member: Member, fLoc: number[]): number[] => {
    const out = new Array<number>(6).fill(0);
    for (let block = 0; block < 2; block += 1) {
      const o = block * 3;
      out[o] = member.c * fLoc[o] - member.s * fLoc[o + 1];
      out[o + 1] = member.s * fLoc[o] + member.c * fLoc[o + 1];
      out[o + 2] = fLoc[o + 2];
    }
    return out;
  };
  for (const load of pointLoads) {
    if (load.member === null) continue;
    const member = members[load.member];
    const px = member.c * load.px + member.s * load.py;
    const py = -member.s * load.px + member.c * load.py;
    const [n1, n2, n3, n4] = hermite(load.t, member.L);
    addFEq(member, [px * (1 - load.t), py * n1, py * n2, px * load.t, py * n3, py * n4]);
    const fg = toGlobal6(member, [px * (1 - load.t), py * n1, py * n2, px * load.t, py * n3, py * n4]);
    const map = [member.i * 3, member.i * 3 + 1, member.i * 3 + 2, member.j * 3, member.j * 3 + 1, member.j * 3 + 2];
    map.forEach((dof, index) => {
      F[dof] += fg[index];
    });
    const a = joints[member.i];
    extLoads.push({
      x: a.x + member.c * load.t * member.L,
      y: a.y + member.s * load.t * member.L,
      fx: load.px,
      fy: load.py,
      mz: 0,
    });
  }
  for (const load of udlLoads) {
    const member = members[load.member];
    // 竖直向下 q（全局 (0,−q)）→ 局部分量：qx = −s·q（斜杆轴向），qy = −c·q（横向）
    const qx = member.s * -load.q;
    const qy = member.c * -load.q;
    const L = member.L;
    // 一致结点载荷：轴端 ±qx·L/2；横向端力 ±qy·L/2、固端力矩 ∓qy·L²/12（∫N₂ = L²/12）
    const fLoc = [qx * L * 0.5, qy * L * 0.5, (qy * L * L) / 12, qx * L * 0.5, qy * L * 0.5, (-qy * L * L) / 12];
    addFEq(member, fLoc);
    const fg = toGlobal6(member, fLoc);
    const map = [member.i * 3, member.i * 3 + 1, member.i * 3 + 2, member.j * 3, member.j * 3 + 1, member.j * 3 + 2];
    map.forEach((dof, index) => {
      F[dof] += fg[index];
    });
    const a = joints[member.i];
    extLoads.push({
      x: a.x + member.c * L * 0.5,
      y: a.y + member.s * L * 0.5,
      fx: 0,
      fy: -load.q * L,
      mz: 0,
    });
  }

  // 划去行列 → 解 → 回填位移（全约束时 active 为空：整体刚定，位移全零，直接跳过求解）
  const d = new Array<number>(nDof).fill(0);
  if (active.length > 0) {
    const kAA = active.map((row) => active.map((col) => K[row][col]));
    const fA = active.map((dof) => F[dof]);
    const dActive = solveLinear(kAA, fA);
    active.forEach((dof, index) => {
      d[dof] = dActive[index];
    });
  }

  // 反力：R = (K·d) − F（约束自由度上 d=0，这就是支座给结构的外力）
  const kd = new Array<number>(nDof).fill(0);
  for (let r = 0; r < nDof; r += 1) {
    let sum = 0;
    for (let c2 = 0; c2 < nDof; c2 += 1) sum += K[r][c2] * d[c2];
    kd[r] = sum;
  }
  const reactions: FrameReaction[] = supports.map((support) => {
    const base = support.joint * 3;
    return {
      nodeId: support.nodeId,
      fx: kd[base] - F[base],
      fy: kd[base + 1] - F[base + 1],
      mz: kd[base + 2] - F[base + 2],
    };
  });
  const supportJointCount = new Map<number, number>();
  for (const support of supports) {
    supportJointCount.set(support.joint, (supportJointCount.get(support.joint) ?? 0) + 1);
  }
  for (const [joint, count] of supportJointCount) {
    if (count > 1) notes.push(`结点「${joints[joint].id}」上有 ${count} 个支座：每个支座名下都报了该结点的合力，不是每个支座各分一份。`);
  }

  // 杆端力与内力曲线
  const memberEndForces: MemberEndForce[] = [];
  const memberCurves: MemberCurve[] = [];
  let mMax = 0;
  let mMaxX = 0;
  let qMax = 0;
  for (const member of members) {
    const a = joints[member.i];
    if (member.truss && FRAME_SOLVE_CONFIG.releaseMoment) {
      const elong = (d[member.j * 3] - d[member.i * 3]) * member.c + (d[member.j * 3 + 1] - d[member.i * 3 + 1]) * member.s;
      const nAxial = (member.ea / member.L) * elong;
      memberEndForces.push({ edgeId: member.id, N: [nAxial, nAxial], Q: [0, 0], M: [0, 0] });
      memberCurves.push({
        edgeId: member.id,
        samples: [
          { x: 0, gx: a.x, N: nAxial, Q: 0, M: 0 },
          { x: member.L, gx: a.x + member.c * member.L, N: nAxial, Q: 0, M: 0 },
        ],
      });
      continue;
    }
    const dLoc: number[] = [];
    const map = [member.i * 3, member.i * 3 + 1, member.i * 3 + 2, member.j * 3, member.j * 3 + 1, member.j * 3 + 2];
    for (let block = 0; block < 2; block += 1) {
      const o = block * 3;
      dLoc.push(member.c * d[map[o]] + member.s * d[map[o + 1]], -member.s * d[map[o]] + member.c * d[map[o + 1]], d[map[o + 2]]);
    }
    const k = kLocal(member.ea, member.ei, member.L);
    const fEq = fEqLocal.get(member.id) ?? new Array<number>(6).fill(0);
    const fBar = k.map((row, r) => row.reduce((sum, value, c2) => sum + value * dLoc[c2], 0) - fEq[r]);
    const nStart = -fBar[0];
    const nEnd = fBar[3];
    const qStart = fBar[1];
    const qEnd = -fBar[4];
    const mStart = -fBar[2];
    const mEnd = fBar[5];
    memberEndForces.push({
      edgeId: member.id,
      N: [nStart, nEnd],
      Q: [qStart, qEnd],
      M: [mStart, mEnd],
    });

    // 沿 x 积分恢复 Q(x)/M(x)：Q(0)=f̄₂，集中力处 Q 跳跃、M 连续；udl 段闭式积分
    // （断点用局部长度 x = t·L，不是归一化 t）
    const memberIndex = members.indexOf(member);
    const pxDown = pointLoads
      .filter((load) => load.member === memberIndex)
      .map((load) => {
        const py = -member.s * load.px + member.c * load.py;
        return { x: load.t * member.L, p: -py };
      });
    const udl = udlLoads.find((load) => load.member === memberIndex);
    // 局部系「向下」的分布强度：全局竖直向下 → 局部横向分量 = −qy = q·cosθ（水平杆 = q）
    const qDownLocal = udl ? udl.q * member.c : 0;
    const breaks = [...new Set([0, ...pxDown.map((p) => p.x), member.L])].sort((p, q2) => p - q2);
    const samples: { x: number; gx: number; N: number; Q: number; M: number }[] = [];
    let q = qStart;
    let m = mStart;
    const push = (x: number, qv: number, mv: number) => {
      samples.push({ x, gx: a.x + member.c * x, N: nStart, Q: qv, M: mv });
      if (Math.abs(mv) > mMax) {
        mMax = Math.abs(mv);
        mMaxX = a.x + member.c * x;
      }
      if (Math.abs(qv) > qMax) qMax = Math.abs(qv);
    };
    push(0, q, m);
    for (let seg = 0; seg + 1 < breaks.length; seg += 1) {
      const x0 = breaks[seg];
      const x1 = breaks[seg + 1];
      const h = x1 - x0;
      if (seg > 0) {
        const jump = pxDown.filter((p) => Math.abs(p.x - x0) < 1e-12).reduce((sum, p) => sum + p.p, 0);
        q -= jump;
      }
      if (h > 1e-12) {
        // 段内 Q 线性、M 二次。给 deflectionOf 更密的采样，让它的「段内 M 线
        // 性」积分假设在均布载荷下也足够精确；首/末样本位置保持不变。
        const subdivisions = Math.max(1, FRAME_SOLVE_CONFIG.curveSubdivisions);
        for (let k = 1; k < subdivisions; k += 1) {
          const d = (h * k) / subdivisions;
          push(x0 + d, q - qDownLocal * d, m + q * d - qDownLocal * d * d * 0.5);
        }
        m += q * h - qDownLocal * h * h * 0.5;
        q -= qDownLocal * h;
      }
      push(x1, q, m);
    }
    memberCurves.push({ edgeId: member.id, samples });
  }

  // 残差：Σ 外力（载荷 + 反力）与 Σ 外力矩（对原点）
  let sumFx = 0;
  let sumFy = 0;
  let sumM = 0;
  for (const load of extLoads) {
    sumFx += load.fx;
    sumFy += load.fy;
    sumM += load.x * load.fy - load.y * load.fx + load.mz;
  }
  for (const reaction of reactions) {
    const joint = joints[supports.find((s) => s.nodeId === reaction.nodeId)?.joint ?? 0];
    sumFx += reaction.fx;
    sumFy += reaction.fy;
    sumM += joint.x * reaction.fy - joint.y * reaction.fx + reaction.mz;
  }

  const displacements: FrameDisplacement[] = joints.map((joint, index) => ({
    nodeId: joint.id,
    u: d[index * 3],
    v: d[index * 3 + 1],
    theta: d[index * 3 + 2],
  }));
  if (members.every((member) => member.ea === 1 && member.ei === 1)) {
    notes.push('刚度取 EA=EI=1（构件行可改 A/I/E，或 meta.EA/meta.EI 覆盖）：内力与反力只依赖刚度比例，均匀取值不变；位移是相对量，不代表真实变形。');
  }

  return {
    reactions,
    displacements,
    memberEndForces,
    extremes: { Mmax: mMax, atX: mMaxX, Qmax: qMax },
    residual: { sumFx, sumFy, sumM },
    memberCurves,
    members: members.map((member) => ({
      edgeId: member.id,
      fromNodeId: joints[member.i].id,
      toNodeId: joints[member.j].id,
      L: member.L,
      ei: member.ei,
      horizontal: Math.abs(member.s) < 1e-9,
    })),
    notes,
  };
}
