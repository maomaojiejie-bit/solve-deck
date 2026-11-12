/**
 * 力学求解器（W0 适配层）—— M1/M2/M3/M4 与 M8 的 σ
 *
 * 唯一真理：C:\Users\17897\.dsh\profiles\desktop\node_modules\dsh-mech-workbench\scripts\analyze.py
 *
 * 这个文件的职责只有一条：把库里的算法**原样复刻**成 TypeScript，再由
 * `scripts/check-mech-parity.mjs` 用库导出的 fixture 逐字段钉住（相对误差 1e-9）。
 * 所以下面每个函数都与 Python 侧一一对应，注释里标了对应的函数名：
 *
 *   buildModel        <- build_model
 *   buildSection      <- build_section
 *   solveReactions    <- solve_reactions
 *   internalAt        <- internal_at
 *   buildDiagrams     <- build_diagrams
 *   computeExtrema    <- compute_extrema
 *   computeStresses   <- compute_stresses
 *
 * 红线：不许「我觉得更对就改」。与 fixture 不一致时，先怀疑这个文件，
 * 再怀疑 spec 写错，最后才去问。符号约定照抄库的四条：
 *
 *   N(x) = -Σ_{a<x} Fx        Q(x) = +Σ_{a<x} Fy
 *   M(x) = +Σ_{a<x} [(x-a)·Fy - Mz]        T(x) = -Σ_{a<x} Mx
 *
 * 库的能力边界：不算挠度、无主应力/莫尔圆、不做稳定、没有刚体/桁架/摩擦/形心/虚功。
 * 所以这里只有杆/梁/轴，M5/M6/M7/S1–S7 一律不在这里实现。
 */

import type {
  MechDistributedLoad,
  MechKind,
  MechLoad,
  MechSection,
  MechShape,
  MechSpec,
  MechSupportType,
} from './spec.ts';

/** 库内 POS_TOL_REL：位置比较用的相对容差。 */
const POS_TOL_REL = 1e-9;

/** 静不定时唯一允许的对外文案（文档 §1.3 钉死，不许改写）。 */
export const INDETERMINATE_MESSAGE = '静不定，当前只解静定';

export type MechChannel = 'N' | 'Q' | 'M' | 'T';

export type MechDiagramPoint = { x: number; value: number };

export type MechReaction = {
  x: number;
  type: MechSupportType;
  Rx: number;
  Ry: number;
  Mz: number;
  /** 仅 kind='shaft' 的固定端有扭转反力。 */
  Mx?: number;
};

export type MechSectionGeom = {
  shape: MechShape;
  params: Record<string, number>;
  A: number;
  Iy: number;
  W: number;
  Sy: number;
  Ip: number | null;
  Wp: number | null;
  ymax: number;
  /** 中性轴处宽度（τ = Q·Sy/(Iy·t_na) 要用）。 */
  t_na: number;
  tau_max_coeff: number;
  E: number | null;
};

export type MechExtremum = {
  max: number;
  max_x: number;
  min: number;
  min_x: number;
  /** 仅 M 有：|M| 最大值及其位置。 */
  abs_max?: number;
  abs_max_x?: number;
};

export type MechStresses = {
  sigma_max: number;
  sigma_max_x: number;
  sigma_max_y: number;
  sigma_bending: number;
  sigma_axial: number;
  sigma_N: number;
  sigma_M: number;
  tau_max: number;
  tau_max_x: number;
  tau_max_Q: number;
  tau_max_coeff: number;
  /** 仅圆/管截面（有 Wp）才有。 */
  tau_torsion_max?: number;
};

export type MechSolution = {
  kind: MechKind;
  determinate: boolean;
  /** 仅 determinate=false 时出现，值恒为 INDETERMINATE_MESSAGE。 */
  message?: string;
  /** 仅静不定时给出成因（未知量数 / 方程数 / 秩）——给 UI 用，不参与 parity。 */
  detail?: string;
  reactions: MechReaction[];
  section: MechSectionGeom;
  diagrams: Partial<Record<MechChannel, MechDiagramPoint[]>>;
  extrema: Partial<Record<MechChannel, MechExtremum>>;
  stresses: Partial<MechStresses>;
  /** 库的 checks[]：结果页「六项校验」面板的数据源，不在这里另算一套判据。 */
  checks: MechCheck[];
  /** 库的 warnings[]：不计算变形 / 量级可疑 / 超屈服。 */
  warnings: string[];
  /** 库的 conventions：内力图右上角「符号约定」小盒的文案。 */
  conventions: Record<string, string>;
};

/** 一条可核验的校验项（对应库 checks[] 的一项）。 */
export type MechCheck = {
  name: string;
  expected: number;
  actual: number;
  rel_error: number;
  pass: boolean;
  note: string;
};

/** 模型/参数非法（对应库的 SpecError，消息保持中文可读）。 */
export class MechSpecError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'MechSpecError';
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------
// 单位（对应 resolve_units；只用于把结果换算到 units.stress）
// ---------------------------------------------------------------------

const LEN_TO_M: Record<string, number> = { m: 1, mm: 1e-3, cm: 1e-2, dm: 1e-1, km: 1e3, in: 0.0254 };
const FORCE_TO_N: Record<string, number> = {
  N: 1,
  kN: 1e3,
  MN: 1e6,
  kgf: 9.80665,
  tf: 9806.65,
  lbf: 4.4482216,
};
const STRESS_TO_PA: Record<string, number> = {
  Pa: 1,
  kPa: 1e3,
  MPa: 1e6,
  GPa: 1e9,
  'N/mm^2': 1e6,
  'N/mm2': 1e6,
};
const DEFAULT_UNITS = { length: 'm', force: 'kN', moment: 'kN*m', stress: 'MPa' };

type ResolvedUnits = {
  /** 1 个 base 应力（力/长度²）= ? Pa */
  baseStressToPa: number;
  /** base 应力 -> 声明应力单位 的系数 */
  baseToStress: number;
};

function normUnit(value: string): string {
  return String(value).trim().replace(/·/g, '*').replace(/\./g, '*').replace(/ /g, '').replace(/²/g, '^2');
}

function resolveUnits(units: MechSpec['units']): ResolvedUnits {
  const declared = { ...DEFAULT_UNITS };
  // 库里只认对象形式；字符串会被静默忽略、回落默认（analyze.py resolve_units）。
  if (units && typeof units === 'object') {
    if (units.length) declared.length = units.length;
    if (units.force) declared.force = units.force;
    if (units.moment) declared.moment = units.moment;
    if (units.stress) declared.stress = units.stress;
  }
  const lenToM = LEN_TO_M[normUnit(declared.length)] ?? 1;
  const forceToN = FORCE_TO_N[normUnit(declared.force)] ?? 1;
  const stressToPa = STRESS_TO_PA[normUnit(declared.stress)] ?? 1;
  const baseStressToPa = forceToN / lenToM ** 2;
  return { baseStressToPa, baseToStress: baseStressToPa / stressToPa };
}

// ---------------------------------------------------------------------
// 截面几何（对应 build_section）
// ---------------------------------------------------------------------

function requireParam(params: Record<string, number>, key: string, shape: string): number {
  const raw = params[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new MechSpecError(`截面 ${shape} 缺少参数 '${key}'`, `params 应包含 ${Object.keys(params).sort().join(', ')}`);
  }
  if (raw <= 0) throw new MechSpecError(`截面参数 ${shape}.${key} 必须 > 0（实际 ${raw}）`);
  return raw;
}

function buildSection(section: MechSection): MechSectionGeom {
  if (!section || typeof section !== 'object') throw new MechSpecError('section 必须为对象');
  const shape = section.shape;
  if (shape !== 'rect' && shape !== 'circle' && shape !== 'tube' && shape !== 'ishape') {
    throw new MechSpecError(`未知截面形状 '${String(shape)}'`, '支持：rect, circle, tube, ishape');
  }
  const params = section.params ?? {};
  const E = typeof section.E === 'number' ? section.E : null;
  if (E !== null && (!Number.isFinite(E) || E <= 0)) {
    throw new MechSpecError(`section.E 必须 > 0（实际 ${E}）`);
  }

  let A: number;
  let Iy: number;
  let ymax: number;
  let Sy: number;
  let tNa: number;
  let Ip: number | null = null;
  let Wp: number | null = null;

  if (shape === 'rect') {
    const b = requireParam(params, 'b', shape);
    const h = requireParam(params, 'h', shape);
    A = b * h;
    Iy = (b * h ** 3) / 12;
    ymax = h / 2;
    Sy = (b * h ** 2) / 8;
    tNa = b;
  } else if (shape === 'circle') {
    const d = requireParam(params, 'd', shape);
    A = (Math.PI * d ** 2) / 4;
    Iy = (Math.PI * d ** 4) / 64;
    ymax = d / 2;
    Sy = d ** 3 / 12;
    tNa = d;
    Ip = (Math.PI * d ** 4) / 32;
    Wp = (Math.PI * d ** 3) / 16;
  } else if (shape === 'tube') {
    const D = requireParam(params, 'D', shape);
    const d = requireParam(params, 'd', shape);
    if (d >= D) throw new MechSpecError(`管截面应满足 D > d（实际 D=${D}, d=${d}）`);
    A = (Math.PI * (D ** 2 - d ** 2)) / 4;
    Iy = (Math.PI * (D ** 4 - d ** 4)) / 64;
    ymax = D / 2;
    Sy = (D ** 3 - d ** 3) / 12;
    tNa = D - d;
    Ip = (Math.PI * (D ** 4 - d ** 4)) / 32;
    Wp = (Math.PI * (D ** 4 - d ** 4)) / (16 * D);
  } else {
    const bf = requireParam(params, 'bf', shape);
    const tf = requireParam(params, 'tf', shape);
    const hw = requireParam(params, 'hw', shape);
    const tw = requireParam(params, 'tw', shape);
    const H = 2 * tf + hw;
    A = 2 * bf * tf + hw * tw;
    const yf = hw / 2 + tf / 2;
    Iy = 2 * ((bf * tf ** 3) / 12 + bf * tf * yf ** 2) + (tw * hw ** 3) / 12;
    ymax = H / 2;
    Sy = bf * tf * yf + (tw * hw ** 2) / 8;
    tNa = tw;
  }

  const W = Iy / ymax;
  const tauMaxCoeff = (A * Sy) / (Iy * tNa);

  return {
    shape,
    params,
    A,
    Iy,
    W,
    Sy,
    Ip,
    Wp,
    ymax,
    t_na: tNa,
    tau_max_coeff: tauMaxCoeff,
    E,
  };
}

// ---------------------------------------------------------------------
// 模型装配（对应 build_model）
// ---------------------------------------------------------------------

type ModelEvent = { x: number; Fx: number; Fy: number; Mz: number; Mx: number; jump: boolean };
type ModelDist = { x0: number; x1: number; q0: number; q1: number; dir: 'axial' | 'transverse' };

type MechModel = {
  kind: MechKind;
  L: number;
  supports: { x: number; type: MechSupportType }[];
  events: ModelEvent[];
  dists: ModelDist[];
  stations: number[];
  tol: number;
  units: ResolvedUnits;
};

function fnum(obj: Record<string, unknown>, key: string, where: string): number {
  const raw = obj[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new MechSpecError(`${where} 缺少字段 '${key}' 或不是有限数值`);
  }
  return raw;
}

function buildModel(spec: MechSpec): MechModel {
  if (!spec || typeof spec !== 'object') throw new MechSpecError('spec 必须是 JSON 对象');
  const kind = spec.kind;
  if (kind !== 'bar' && kind !== 'beam' && kind !== 'shaft') {
    throw new MechSpecError(`未知构件类型 kind='${String(kind)}'`, '支持：bar, beam, shaft');
  }
  const L = fnum(spec as unknown as Record<string, unknown>, 'length', 'spec');
  if (L <= 0) throw new MechSpecError(`构件长度 length 必须 > 0（实际 ${L}）`);
  const units = resolveUnits(spec.units);
  const tol = POS_TOL_REL * Math.max(L, 1);

  const supportsRaw = spec.supports;
  if (!Array.isArray(supportsRaw) || supportsRaw.length === 0) {
    throw new MechSpecError('缺少 supports 字段', '未定义任何支座（supports 为空）');
  }
  const supports: { x: number; type: MechSupportType }[] = [];
  supportsRaw.forEach((s, i) => {
    const type = s.type;
    if (type !== 'fixed' && type !== 'pin' && type !== 'roller') {
      throw new MechSpecError(`未知支座类型 '${String(type)}'（supports[${i}]）`, '支持：fixed, pin, roller');
    }
    let x = fnum(s as unknown as Record<string, unknown>, 'x', `supports[${i}]`);
    if (x < -tol || x > L + tol) throw new MechSpecError(`支座位置 x=${x} 超出构件区间 [0, ${L}]`);
    x = Math.min(Math.max(x, 0), L);
    supports.push({ x, type });
  });

  const events: ModelEvent[] = [];
  const dists: ModelDist[] = [];
  const loads: MechLoad[] = Array.isArray(spec.loads) ? spec.loads : [];

  loads.forEach((load, i) => {
    const where = `loads[${i}]`;
    const type = load.type;
    if (type === 'point_force') {
      let x = fnum(load as unknown as Record<string, unknown>, 'x', where);
      if (x < -tol || x > L + tol) throw new MechSpecError(`${where} 位置 x=${x} 超出构件区间 [0, ${L}]`);
      const dir = load.dir ?? 'transverse';
      if (dir !== 'axial' && dir !== 'transverse') throw new MechSpecError(`${where} 的 dir='${String(dir)}' 非法`);
      const value = fnum(load as unknown as Record<string, unknown>, 'value', where);
      x = Math.min(Math.max(x, 0), L);
      events.push({
        x,
        Fx: dir === 'axial' ? value : 0,
        Fy: dir === 'axial' ? 0 : value,
        Mz: 0,
        Mx: 0,
        jump: true,
      });
    } else if (type === 'distributed') {
      const dist = load as MechDistributedLoad;
      let x0 = fnum(dist as unknown as Record<string, unknown>, 'x0', where);
      let x1 = fnum(dist as unknown as Record<string, unknown>, 'x1', where);
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (x0 < -tol || x1 > L + tol) {
        throw new MechSpecError(`${where} 区间 [${x0}, ${x1}] 超出构件区间 [0, ${L}]`);
      }
      if (x1 - x0 <= 0) throw new MechSpecError(`${where} 的分布区间长度必须 > 0`);
      const dir = dist.dir ?? 'transverse';
      if (dir !== 'axial' && dir !== 'transverse') throw new MechSpecError(`${where} 的 dir='${String(dir)}' 非法`);
      const q0 = fnum(dist as unknown as Record<string, unknown>, 'q0', where);
      const q1 = dist.q1 === undefined || dist.q1 === null ? q0 : fnum(dist as unknown as Record<string, unknown>, 'q1', where);
      dists.push({ x0: Math.min(Math.max(x0, 0), L), x1: Math.min(Math.max(x1, 0), L), q0, q1, dir });
    } else if (type === 'point_moment' || type === 'point_torque') {
      let x = fnum(load as unknown as Record<string, unknown>, 'x', where);
      if (x < -tol || x > L + tol) throw new MechSpecError(`${where} 位置 x=${x} 超出构件区间 [0, ${L}]`);
      const value = fnum(load as unknown as Record<string, unknown>, 'value', where);
      x = Math.min(Math.max(x, 0), L);
      events.push({
        x,
        Fx: 0,
        Fy: 0,
        Mz: type === 'point_moment' ? value : 0,
        Mx: type === 'point_torque' ? value : 0,
        jump: value !== 0,
      });
    } else {
      throw new MechSpecError(`${where} 的 type='${String(type)}' 非法`, '支持：point_force, distributed, point_moment, point_torque');
    }
  });

  const stationsRaw = spec.stations ?? [];
  if (!Array.isArray(stationsRaw)) throw new MechSpecError('stations 必须为数组');
  const stations = stationsRaw.map((s, i) => {
    if (typeof s !== 'number' || !Number.isFinite(s)) throw new MechSpecError(`stations[${i}] 必须为数值`);
    if (s < -tol || s > L + tol) throw new MechSpecError(`stations[${i}]=${s} 超出构件区间 [0, ${L}]`);
    return Math.min(Math.max(s, 0), L);
  });

  return { kind, L, supports, events, dists, stations, tol, units };
}

// ---------------------------------------------------------------------
// 线性代数小工具（对应 numpy.linalg.lstsq / matrix_rank）
// ---------------------------------------------------------------------

/** 高斯消元（部分主元），方阵求解；奇异返回 null。 */
function solveSquare(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let maxAbs = 0;
  for (const row of A) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  const pivotTol = Math.max(maxAbs, 1) * Number.EPSILON * Math.max(n, 1) * 4;

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > best) {
        best = Math.abs(M[r][col]);
        pivot = r;
      }
    }
    if (best <= pivotTol) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/** 最小二乘：超定走正规方程（这些矩阵规模极小，条件数没有问题）。 */
function leastSquares(A: number[][], b: number[], cols: number): number[] | null {
  if (A.length === cols) return solveSquare(A, b);
  const AtA: number[][] = [];
  const Atb: number[] = [];
  for (let i = 0; i < cols; i += 1) {
    AtA.push(new Array<number>(cols).fill(0));
    Atb.push(0);
  }
  for (let r = 0; r < A.length; r += 1) {
    for (let i = 0; i < cols; i += 1) {
      Atb[i] += A[r][i] * b[r];
      for (let j = 0; j < cols; j += 1) AtA[i][j] += A[r][i] * A[r][j];
    }
  }
  return solveSquare(AtA, Atb);
}

/** 秩（对应 numpy.linalg.matrix_rank 的等价判据）。 */
function matrixRank(A: number[][], cols: number): number {
  const rows = A.length;
  const M = A.map((row) => row.slice());
  let maxAbs = 0;
  for (const row of A) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  const tol = Math.max(rows, cols) * Number.EPSILON * maxAbs;
  let rank = 0;
  let row = 0;
  for (let col = 0; col < cols && row < rows; col += 1) {
    let pivot = row;
    let best = Math.abs(M[row][col]);
    for (let r = row + 1; r < rows; r += 1) {
      if (Math.abs(M[r][col]) > best) {
        best = Math.abs(M[r][col]);
        pivot = r;
      }
    }
    if (best <= tol) continue;
    if (pivot !== row) [M[row], M[pivot]] = [M[pivot], M[row]];
    for (let r = row + 1; r < rows; r += 1) {
      const factor = M[r][col] / M[row][col];
      if (factor === 0) continue;
      for (let c = col; c < cols; c += 1) M[r][c] -= factor * M[row][c];
    }
    rank += 1;
    row += 1;
  }
  return rank;
}

// ---------------------------------------------------------------------
// 支座反力（对应 solve_reactions）
// ---------------------------------------------------------------------

type ReactionSolve =
  | {
      determinate: true;
      reactions: MechReaction[];
      torsionActive: boolean;
      loadScale: number;
      residRel: number;
      sums: { Fx_l: number; Fy_l: number; M0_l: number; Mx_l: number };
    }
  | { determinate: false; totalUnknowns: number; nEq: number; reason: string };

/** 分布载荷整段的合力与对 x=0 的力矩（对应 _dist_resultant）。 */
function distResultant(d: ModelDist): { F: number; tq: number } {
  const s = d.x1 - d.x0;
  const k = (d.q1 - d.q0) / s;
  const F = d.q0 * s + (k * s * s) / 2;
  const tq = d.x0 * (d.q0 * s + (k * s * s) / 2) + (d.q0 * s * s) / 2 + (k * s ** 3) / 3;
  return { F, tq };
}

function solveReactions(model: MechModel): ReactionSolve {
  const { kind, L } = model;
  const shaftMode = kind === 'shaft';
  const nEq = shaftMode ? 4 : 3;

  const layout: { Rx: number | null; Ry: number | null; Mz: number | null; Mx: number | null }[] = [];
  let totalUnknowns = 0;
  for (const s of model.supports) {
    const cols = { Rx: null as number | null, Ry: null as number | null, Mz: null as number | null, Mx: null as number | null };
    if (s.type === 'fixed') {
      cols.Rx = totalUnknowns;
      cols.Ry = totalUnknowns + 1;
      cols.Mz = totalUnknowns + 2;
      totalUnknowns += 3;
      if (shaftMode) {
        cols.Mx = totalUnknowns;
        totalUnknowns += 1;
      }
    } else if (s.type === 'pin') {
      cols.Rx = totalUnknowns;
      cols.Ry = totalUnknowns + 1;
      totalUnknowns += 2;
    } else {
      cols.Ry = totalUnknowns;
      totalUnknowns += 1;
    }
    layout.push(cols);
  }

  const torsionActive = shaftMode || model.events.some((e) => Math.abs(e.Mx) > 0);

  let FxL = 0;
  let FyL = 0;
  let M0L = 0;
  let MxL = 0;
  for (const e of model.events) {
    FxL += e.Fx;
    FyL += e.Fy;
    M0L += e.Mz + e.x * e.Fy;
    MxL += e.Mx;
  }
  for (const d of model.dists) {
    const { F, tq } = distResultant(d);
    if (d.dir === 'axial') FxL += F;
    else {
      FyL += F;
      M0L += tq;
    }
  }

  let loadScale = 0;
  for (const e of model.events) {
    loadScale += Math.abs(e.Fx) + Math.abs(e.Fy) + Math.abs(e.Mz) / Math.max(L, 1) + Math.abs(e.Mx) / Math.max(L, 1);
  }
  for (const d of model.dists) {
    const { F, tq } = distResultant(d);
    loadScale += Math.abs(F) + Math.abs(tq) / Math.max(L, 1);
  }
  loadScale = Math.max(loadScale, 1e-12);

  if (!shaftMode && torsionActive) {
    if (Math.abs(MxL) > 1e-8 * Math.max(loadScale, Math.abs(MxL))) {
      throw new MechSpecError(
        `扭矩不平衡：非轴类模型（kind=${kind}）没有扭转约束`,
        `外扭矩之和 ΣMx = ${MxL}，无法平衡；请改用 kind="shaft" 并设置固定端`,
      );
    }
  }

  if (totalUnknowns > nEq) {
    return {
      determinate: false,
      totalUnknowns,
      nEq,
      reason: '静不定：本工具 Phase 1 覆盖静定问题，需变形协调或刚度法',
    };
  }

  if (totalUnknowns === 0) throw new MechSpecError('约束不足/机构', '未定义任何支座');

  const A: number[][] = [];
  for (let i = 0; i < nEq; i += 1) A.push(new Array<number>(totalUnknowns).fill(0));
  const b = new Array<number>(nEq).fill(0);
  model.supports.forEach((s, si) => {
    const cols = layout[si];
    const x = s.x;
    if (cols.Rx !== null) A[0][cols.Rx] = 1;
    if (cols.Ry !== null) {
      A[1][cols.Ry] = 1;
      A[2][cols.Ry] = x;
    }
    if (cols.Mz !== null) A[2][cols.Mz] = 1;
    if (shaftMode && cols.Mx !== null) A[3][cols.Mx] = 1;
  });
  b[0] = -FxL;
  b[1] = -FyL;
  b[2] = -M0L;
  if (shaftMode) b[3] = -MxL;

  for (let i = 0; i < model.supports.length; i += 1) {
    for (let j = i + 1; j < model.supports.length; j += 1) {
      if (Math.abs(model.supports[i].x - model.supports[j].x) <= model.tol) {
        throw new MechSpecError(
          '约束不足/机构',
          `支座约束重复：supports[${i}] 与 supports[${j}] 位于同一位置 x=${model.supports[i].x}`,
        );
      }
    }
  }

  const rank = matrixRank(A, totalUnknowns);
  const sol = rank === totalUnknowns ? leastSquares(A, b, totalUnknowns) : null;
  if (!sol) {
    // 秩亏且无唯一解：库在残差可满足时同样判静不定（多余/缺失约束方向）。
    return {
      determinate: false,
      totalUnknowns,
      nEq,
      reason: `支承约束方向线性相关（秩 ${rank} < 未知反力数 ${totalUnknowns}）：存在多余约束或缺失约束方向，反力不能由平衡方程唯一确定`,
    };
  }

  let residSq = 0;
  let bSq = 0;
  for (let r = 0; r < nEq; r += 1) {
    let acc = 0;
    for (let c = 0; c < totalUnknowns; c += 1) acc += A[r][c] * sol[c];
    residSq += (acc - b[r]) ** 2;
    bSq += b[r] ** 2;
  }
  const resid = Math.sqrt(residSq);
  const denom = Math.max(Math.sqrt(bSq), 1e-12);
  if (resid > 1e-7 * denom) {
    throw new MechSpecError(
      '约束不足/机构',
      `平衡方程无法满足（残差 ${resid.toExponential(3)}，载荷范数 ${denom.toExponential(3)}）：支座方向无法承担该载荷组合`,
    );
  }

  const reactions: MechReaction[] = model.supports.map((s, si) => {
    const cols = layout[si];
    const rec: MechReaction = {
      x: s.x,
      type: s.type,
      Rx: cols.Rx === null ? 0 : sol[cols.Rx],
      Ry: cols.Ry === null ? 0 : sol[cols.Ry],
      Mz: cols.Mz === null ? 0 : sol[cols.Mz],
    };
    if (shaftMode) rec.Mx = cols.Mx === null ? 0 : sol[cols.Mx];
    return rec;
  });

  return {
    determinate: true,
    reactions,
    torsionActive,
    loadScale,
    residRel: resid / denom,
    sums: { Fx_l: FxL, Fy_l: FyL, M0_l: M0L, Mx_l: MxL },
  };
}

// ---------------------------------------------------------------------
// 内力（对应 internal_at）
// ---------------------------------------------------------------------

type Internal = { N: number; Q: number; M: number; T: number };

function internalAt(x: number, includeAt: boolean, evs: ModelEvent[], dists: ModelDist[], tol: number): Internal {
  let N = 0;
  let Q = 0;
  let M = 0;
  let T = 0;
  for (const e of evs) {
    if (e.Fx === 0 && e.Fy === 0 && e.Mz === 0 && e.Mx === 0) continue;
    const left = includeAt ? e.x <= x + tol : e.x < x - tol;
    if (!left) continue;
    N += -e.Fx;
    Q += e.Fy;
    M += (x - e.x) * e.Fy - e.Mz;
    T += -e.Mx;
  }
  for (const d of dists) {
    const xa = Math.min(d.x1, x);
    const s = xa - d.x0;
    if (s <= 0) continue;
    const span = d.x1 - d.x0;
    const k = (d.q1 - d.q0) / span;
    const F = d.q0 * s + (k * s * s) / 2;
    if (d.dir === 'axial') {
      N += -F;
    } else {
      const tq = d.x0 * (d.q0 * s + (k * s * s) / 2) + (d.q0 * s * s) / 2 + (k * s ** 3) / 3;
      Q += F;
      M += x * F - tq;
    }
  }
  return { N, Q, M, T };
}

/** 把反力并入事件集合（对应 make_event_list）。 */
function makeEventList(model: MechModel, reactions: MechReaction[]): ModelEvent[] {
  const evs: ModelEvent[] = model.events.map((e) => ({ ...e }));
  model.supports.forEach((s, i) => {
    const r = reactions[i];
    if (r.Rx || r.Ry || r.Mz || r.Mx) {
      evs.push({ x: s.x, Fx: r.Rx, Fy: r.Ry, Mz: r.Mz, Mx: r.Mx ?? 0, jump: true });
    }
  });
  return evs;
}

/** 临界截面（对应 critical_xs）。 */
function criticalXs(model: MechModel): number[] {
  const xs = new Set<number>([0, model.L]);
  for (const s of model.supports) xs.add(s.x);
  for (const e of model.events) xs.add(e.x);
  for (const d of model.dists) {
    xs.add(d.x0);
    xs.add(d.x1);
  }
  for (const s of model.stations) xs.add(s);
  return [...xs].sort((a, b) => a - b);
}

function hasJumpAt(x: number, evs: ModelEvent[], tol: number): boolean {
  return evs.some((e) => Math.abs(e.x - x) <= tol && e.jump && (e.Fx !== 0 || e.Fy !== 0 || e.Mz !== 0 || e.Mx !== 0));
}

type MechDiagrams = Record<MechChannel, MechDiagramPoint[]>;

/** 分段 + 间断点重复点（对应 build_diagrams）。 */
function buildDiagrams(model: MechModel, evs: ModelEvent[]): MechDiagrams {
  const { L, tol, dists } = model;
  const xs = criticalXs(model);

  const samples: { x: number; includeAt: boolean }[] = [];
  for (const x of xs) {
    const isLeftEnd = x <= tol;
    const isRightEnd = Math.abs(x - L) <= tol;
    if (isLeftEnd && !isRightEnd) samples.push({ x, includeAt: true });
    else if (isRightEnd && !isLeftEnd) samples.push({ x, includeAt: false });
    else if (isLeftEnd && isRightEnd) samples.push({ x, includeAt: true });
    else if (hasJumpAt(x, evs, tol)) {
      samples.push({ x, includeAt: false });
      samples.push({ x, includeAt: true });
    } else samples.push({ x, includeAt: false });
  }

  const fine: { x: number; includeAt: boolean }[] = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a <= 1e-15) continue;
    const n = dists.some((d) => Math.min(d.x1, b) > Math.max(d.x0, a)) ? 20 : 3;
    for (let k = 1; k < n; k += 1) fine.push({ x: a + ((b - a) * k) / n, includeAt: false });
  }
  samples.push(...fine);

  samples.sort((p, q) => (p.x !== q.x ? p.x - q.x : (p.includeAt ? 1 : 0) - (q.includeAt ? 1 : 0)));

  const uniq: { x: number; includeAt: boolean }[] = [];
  for (const s of samples) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.x - s.x) <= 1e-15 && last.includeAt === s.includeAt) continue;
    uniq.push(s);
  }

  const diagrams: MechDiagrams = { N: [], Q: [], M: [], T: [] };
  for (const s of uniq) {
    const r = internalAt(s.x, s.includeAt, evs, dists, tol);
    diagrams.N.push({ x: s.x, value: r.N });
    diagrams.Q.push({ x: s.x, value: r.Q });
    diagrams.M.push({ x: s.x, value: r.M });
    diagrams.T.push({ x: s.x, value: r.T });
  }
  return diagrams;
}

// ---------------------------------------------------------------------
// 极值（对应 compute_extrema；三分搜索 + Q=0 二分，与库逐行对齐）
// ---------------------------------------------------------------------

const CHANNELS: MechChannel[] = ['N', 'Q', 'M', 'T'];

function channelAt(r: Internal, ch: MechChannel): number {
  return ch === 'N' ? r.N : ch === 'Q' ? r.Q : ch === 'M' ? r.M : r.T;
}

/** 三分搜索（对应 _ternary）。 */
function ternary(f: (x: number) => number, a: number, b: number, wantMax: boolean): { x: number; v: number } {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i += 1) {
    if (hi - lo <= 1e-14 * Math.max(Math.abs(lo), Math.abs(hi), 1)) break;
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const f1 = f(m1);
    const f2 = f(m2);
    if (wantMax) {
      if (f1 < f2) lo = m1;
      else hi = m2;
    } else if (f1 > f2) lo = m1;
    else hi = m2;
  }
  const xm = 0.5 * (lo + hi);
  return { x: xm, v: f(xm) };
}

type Candidate = { x: number; v: number; prio: number };

function computeExtrema(model: MechModel, evs: ModelEvent[], diagrams: MechDiagrams): Partial<Record<MechChannel, MechExtremum>> {
  const { L, tol, dists } = model;
  let xs = criticalXs(model);
  if (xs[0] > 0) xs = [0, ...xs];
  if (xs[xs.length - 1] < L) xs = [...xs, L];

  const at = (ch: MechChannel, x: number, includeAt: boolean) => channelAt(internalAt(x, includeAt, evs, dists, tol), ch);

  const cands: Record<MechChannel, Candidate[]> = { N: [], Q: [], M: [], T: [] };
  const qZero: number[] = [];

  for (const ch of CHANNELS) for (const pt of diagrams[ch]) cands[ch].push({ x: pt.x, v: pt.value, prio: 2 });

  const NGRID = 60;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const c0 = xs[i];
    const c1 = xs[i + 1];
    if (c1 - c0 <= 1e-15) continue;
    const fsub = (ch: MechChannel, x: number) =>
      at(ch, x, Math.abs(x - c1) > 1e-15 * Math.max(Math.abs(c1), 1));

    const grid: number[] = [];
    for (let k = 0; k <= NGRID; k += 1) grid.push(c0 + ((c1 - c0) * k) / NGRID);

    for (const ch of CHANNELS) {
      const vals = grid.map((x) => fsub(ch, x));
      for (let k = 0; k <= NGRID; k += 1) cands[ch].push({ x: grid[k], v: vals[k], prio: 1 });
      for (let k = 1; k < NGRID; k += 1) {
        const up = vals[k] >= vals[k - 1] && vals[k] >= vals[k + 1] && (vals[k] > vals[k - 1] || vals[k] > vals[k + 1]);
        if (up) {
          const r = ternary((t) => fsub(ch, t), grid[k - 1], grid[k + 1], true);
          cands[ch].push({ x: r.x, v: r.v, prio: 0 });
        }
        const down = vals[k] <= vals[k - 1] && vals[k] <= vals[k + 1] && (vals[k] < vals[k - 1] || vals[k] < vals[k + 1]);
        if (down) {
          const r = ternary((t) => fsub(ch, t), grid[k - 1], grid[k + 1], false);
          cands[ch].push({ x: r.x, v: r.v, prio: 0 });
        }
      }
    }

    // M 极值补充：Q 变号点（二分到机器精度）
    const NG = 200;
    const gx: number[] = [];
    for (let k = 0; k <= NG; k += 1) gx.push(c0 + ((c1 - c0) * k) / NG);
    const gq = gx.map((x) => fsub('Q', x));
    for (let k = 0; k < NG; k += 1) {
      if (gq[k] * gq[k + 1] < 0) {
        let lo = gx[k];
        let hi = gx[k + 1];
        let flo = gq[k];
        for (let it = 0; it < 200; it += 1) {
          const mid = 0.5 * (lo + hi);
          const fm = fsub('Q', mid);
          if (flo * fm <= 0) hi = mid;
          else {
            lo = mid;
            flo = fm;
          }
        }
        const xz = 0.5 * (lo + hi);
        qZero.push(xz);
        cands.M.push({ x: xz, v: fsub('M', xz), prio: 3 });
      }
    }
  }

  // 分布载荷集度 q=0 处 Q/N 取极值（解析求根）
  for (const d of dists) {
    if (d.q0 * d.q1 < 0) {
      const span = d.x1 - d.x0;
      const t = d.x0 + (span * -d.q0) / (d.q1 - d.q0);
      if (d.x0 < t && t < d.x1) {
        const ch: MechChannel = d.dir === 'axial' ? 'N' : 'Q';
        cands[ch].push({ x: t, v: at(ch, t, false), prio: 3 });
      }
    }
  }

  const out: Partial<Record<MechChannel, MechExtremum>> = {};
  for (const ch of CHANNELS) {
    const pts = cands[ch];
    if (pts.length === 0) continue;
    let scale = 0;
    for (const p of pts) scale = Math.max(scale, Math.abs(p.v));
    const tolV = 1e-12 * Math.max(scale, 1);

    const pick = (wantMax: boolean): Candidate => {
      let key = wantMax ? -Infinity : Infinity;
      for (const p of pts) key = wantMax ? Math.max(key, p.v) : Math.min(key, p.v);
      const band = pts.filter((p) => (wantMax ? p.v >= key - tolV : p.v <= key + tolV));
      band.sort((a, b) => {
        if (a.v !== b.v) return wantMax ? b.v - a.v : a.v - b.v;
        if (a.prio !== b.prio) return b.prio - a.prio;
        return a.x - b.x;
      });
      return band[0];
    };

    const hi = pick(true);
    const lo = pick(false);
    const rec: MechExtremum = { max: hi.v, max_x: hi.x, min: lo.v, min_x: lo.x };

    if (ch === 'M') {
      let absMax = 0;
      for (const p of pts) absMax = Math.max(absMax, Math.abs(p.v));
      const band = pts.filter((p) => Math.abs(Math.abs(p.v) - absMax) <= tolV);
      band.sort((a, b) => {
        if (a.v !== b.v && Math.abs(a.v) !== Math.abs(b.v)) return Math.abs(b.v) - Math.abs(a.v);
        if (a.prio !== b.prio) return b.prio - a.prio;
        return a.x - b.x;
      });
      rec.abs_max = Math.abs(band[0].v);
      rec.abs_max_x = band[0].x;
    }
    out[ch] = rec;
  }
  return out;
}

// ---------------------------------------------------------------------
// 应力（对应 compute_stresses）
// ---------------------------------------------------------------------

/** 库用 round(x, 12) 做 N/M 同截面配对，这里用同一精度做键。 */
function round12(v: number): number {
  return Math.round(v * 1e12) / 1e12;
}

function computeStresses(geo: MechSectionGeom, diagrams: MechDiagrams, baseToStress: number): MechStresses | null {
  const { A, Iy, ymax } = geo;

  const nByX = new Map<number, number>();
  for (const p of diagrams.N) nByX.set(round12(p.x), p.value);

  let best: { tot: number; x: number; y: number; sBend: number; sAxial: number; Nv: number; Mv: number } | null = null;
  for (const p of diagrams.M) {
    const Mv = p.value;
    const Nv = nByX.get(round12(p.x)) ?? 0;
    const sBend = (Math.abs(Mv) * ymax) / Iy;
    const sAxial = Math.abs(Nv) / A;
    const tot = sBend + sAxial;
    if (best === null || tot > best.tot) {
      const sPos = (Mv * ymax) / Iy + Nv / A;
      const sNeg = (-Mv * ymax) / Iy + Nv / A;
      const y = Math.abs(sPos) >= Math.abs(sNeg) ? ymax : -ymax;
      best = { tot, x: p.x, y, sBend, sAxial, Nv, Mv };
    }
  }
  if (best === null) return null;

  let qAbs = 0;
  for (const p of diagrams.Q) qAbs = Math.max(qAbs, Math.abs(p.value));
  let qx = 0;
  for (const p of diagrams.Q) {
    if (Math.abs(p.value) >= qAbs - 1e-12 * Math.max(qAbs, 1)) {
      qx = p.x;
      break;
    }
  }

  const res: MechStresses = {
    sigma_max: best.tot * baseToStress,
    sigma_max_x: best.x,
    sigma_max_y: best.y,
    sigma_bending: best.sBend * baseToStress,
    sigma_axial: best.sAxial * baseToStress,
    sigma_N: best.Nv,
    sigma_M: best.Mv,
    tau_max: ((geo.tau_max_coeff * qAbs) / A) * baseToStress,
    tau_max_x: qx,
    tau_max_Q: qAbs,
    tau_max_coeff: geo.tau_max_coeff,
  };

  if (geo.Wp !== null) {
    let tAbs = 0;
    for (const p of diagrams.T) tAbs = Math.max(tAbs, Math.abs(p.value));
    res.tau_torsion_max = (tAbs / geo.Wp) * baseToStress;
  }
  return res;
}


// ---------------------------------------------------------------------
// 校核与警告（对应 build_checks / build_warnings）
// ---------------------------------------------------------------------

/** 库的 conventions：内力图右上角「符号约定」小盒的文案，照抄。 */
export const MECH_CONVENTIONS: Record<string, string> = {
  N: '拉为正',
  Q: '顺时针为正',
  M: '下侧受拉为正',
  T: '右手螺旋+x为正',
  x: '自构件左端量起，单位同 units.length',
  point_force: '沿 dir 的分量：transverse 向上为正，axial 沿 +x 为正',
  distributed: 'q 为集度(力/长度)，向上为正，沿 x 线性',
  point_moment: '逆时针为正',
  point_torque: '右手螺旋沿 +x 为正',
  support: 'Rx 沿+x，Ry 向上，Mz 逆时针，Mx 右手螺旋+x',
  sigma: 'σ=N/A+M·y/Iy，y 自中性轴向上为正，拉应力为正',
  M_definition: 'M=Σ_{a<x}[(x-a)·Fy-Mz]，满足 dM/dx=Q',
};

function rerr(actual: number, expected: number, scale: number): number {
  const den = Math.max(Math.abs(expected), Math.abs(scale), 1e-12);
  return Math.abs(actual - expected) / den;
}

/** 复合 Simpson（对应 _simpson，n=400）。 */
function simpson(f: (v: number) => number, a: number, b: number, n = 400): number {
  if (b === a) return 0;
  const nn = n % 2 ? n + 1 : n;
  const h = (b - a) / nn;
  let sum = f(a) + f(b);
  for (let i = 1; i < nn; i += 1) sum += (i % 2 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

/** 截面数值条带积分（对应 build_section 里的 integrate 闭包）。 */
function sectionIntegrate(geo: MechSectionGeom, f: (y: number) => number): number {
  const p = geo.params;
  if (geo.shape === 'rect') {
    const h = p.h;
    return simpson((y) => f(y) * p.b, -h / 2, h / 2);
  }
  if (geo.shape === 'circle') {
    const R = p.d / 2;
    return simpson((t) => f(R * Math.sin(t)) * 2 * R * R * Math.cos(t) ** 2, -Math.PI / 2, Math.PI / 2);
  }
  if (geo.shape === 'tube') {
    const R = p.D / 2;
    const r = p.d / 2;
    const outer = simpson((t) => f(R * Math.sin(t)) * 2 * R * R * Math.cos(t) ** 2, -Math.PI / 2, Math.PI / 2);
    const inn = simpson((t) => f(r * Math.sin(t)) * 2 * r * r * Math.cos(t) ** 2, -Math.PI / 2, Math.PI / 2);
    return outer - inn;
  }
  let total = simpson((y) => f(y) * p.tw, -p.hw / 2, p.hw / 2);
  total += simpson((y) => f(y) * p.bf, p.hw / 2, p.hw / 2 + p.tf);
  total += simpson((y) => f(y) * p.bf, -p.hw / 2 - p.tf, -p.hw / 2);
  return total;
}

function buildChecks(
  model: MechModel,
  geo: MechSectionGeom,
  solve: Extract<ReactionSolve, { determinate: true }>,
  evs: ModelEvent[],
  diagrams: MechDiagrams,
  extrema: Partial<Record<MechChannel, MechExtremum>>,
): MechCheck[] {
  const checks: MechCheck[] = [];
  const { L, tol, dists } = model;
  const { reactions, sums, loadScale } = solve;

  let actFx = sums.Fx_l;
  let actFy = sums.Fy_l;
  let actM0 = sums.M0_l;
  for (const r of reactions) {
    actFx += r.Rx;
    actFy += r.Ry;
    actM0 += r.Mz + r.x * r.Ry;
  }
  const scF = Math.max(loadScale, Math.abs(sums.Fx_l), 1e-12);
  const scM = Math.max(loadScale * Math.max(L, 1e-9), Math.abs(sums.M0_l), 1e-12);
  for (const item of [
    { name: 'ΣFx=0', actual: actFx, scale: scF },
    { name: 'ΣFy=0', actual: actFy, scale: scF },
    { name: 'ΣM(对左端)=0', actual: actM0, scale: scM },
  ]) {
    const e = rerr(item.actual, 0, item.scale);
    checks.push({ name: item.name, expected: 0, actual: item.actual, rel_error: e, pass: e < 1e-8, note: '' });
  }

  if (solve.torsionActive) {
    let actMx = sums.Mx_l;
    for (const r of reactions) actMx += r.Mx ?? 0;
    const e = rerr(actMx, 0, Math.max(loadScale, Math.abs(sums.Mx_l), 1e-12));
    checks.push({ name: 'ΣMx=0(扭转)', expected: 0, actual: actMx, rel_error: e, pass: e < 1e-8, note: '轴类模型' });
  }

  const xs = criticalXs(model);
  const samples: number[] = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const c0 = xs[i];
    const c1 = xs[i + 1];
    if (c1 - c0 <= 1e-9 * Math.max(L, 1)) continue;
    samples.push(0.5 * (c0 + c1));
  }
  if (samples.length === 0) samples.push(0.5 * L);
  let qScale = 1e-12;
  for (const p of diagrams.Q) qScale = Math.max(qScale, Math.abs(p.value));
  const h = Math.max(1e-6 * L, 1e-12 * L);
  let worst = 0;
  let worstX = samples[0];
  let worstNum = 0;
  let worstQ = 0;
  for (const x of samples) {
    const m1 = internalAt(x + h, false, evs, dists, tol).M;
    const m2 = internalAt(x - h, false, evs, dists, tol).M;
    const num = (m1 - m2) / (2 * h);
    const qx = internalAt(x, false, evs, dists, tol).Q;
    const e = rerr(num, qx, qScale);
    if (e > worst) {
      worst = e;
      worstX = x;
      worstNum = num;
      worstQ = qx;
    }
  }
  checks.push({
    name: `dM/dx=Q（数值差分抽查 ${samples.length} 点）`,
    expected: worstQ,
    actual: worstNum,
    rel_error: worst,
    pass: worst < 1e-5,
    note: `最差样本 x=${worstX}（中心差分 h=${h}）`,
  });

  let mScale = 1e-12;
  for (const p of diagrams.M) mScale = Math.max(mScale, Math.abs(p.value));
  const hinges = [...new Set(model.supports.filter((s) => s.type === 'pin' || s.type === 'roller').map((s) => s.x))].sort(
    (a, b) => a - b,
  );
  if (hinges.length > 0) {
    let worstH = 0;
    let worstHX = hinges[0];
    for (const hx of hinges) {
      const inc = hx <= tol;
      const e = Math.abs(internalAt(hx, inc, evs, dists, tol).M) / Math.max(mScale, 1e-12);
      if (e > worstH) {
        worstH = e;
        worstHX = hx;
      }
    }
    checks.push({
      name: '简支端 M=0',
      expected: 0,
      actual: internalAt(worstHX, worstHX <= tol, evs, dists, tol).M,
      rel_error: worstH,
      pass: worstH < 1e-8,
      note: `铰/辊轴支座 x=${hinges.join(', ')}`,
    });
  }

  const mx = extrema.M?.abs_max_x ?? 0;
  const at = internalAt(mx, Math.abs(mx - L) > tol, evs, dists, tol);
  const sigma = (y: number) => at.N / geo.A + (at.M * y) / geo.Iy;
  const aN = sectionIntegrate(geo, () => 1);
  const intSigma = sectionIntegrate(geo, sigma);
  const intYSigma = sectionIntegrate(geo, (y) => y * sigma(y));
  const scN = Math.max(Math.abs(at.N), (Math.abs(at.M) * geo.ymax * aN) / geo.Iy, 1e-12);
  const scMv = Math.max(Math.abs(at.M), Math.abs(at.N) * geo.ymax, 1e-12);
  const e1 = rerr(intSigma, at.N, scN);
  const e2 = rerr(intYSigma, at.M, scMv);
  checks.push({
    name: '∫σdA=N（线性正应力 σ=N/A+M·y/Iy）',
    expected: at.N,
    actual: intSigma,
    rel_error: e1,
    pass: e1 < 1e-8,
    note: `截面 x=${mx}（数值条带积分）`,
  });
  checks.push({
    name: '∫yσdA=M（同上）',
    expected: at.M,
    actual: intYSigma,
    rel_error: e2,
    pass: e2 < 1e-8,
    note: `截面 x=${mx}（数值条带积分）`,
  });

  checks.push({
    name: '平衡方程求解残差 ||A·r-b||/||b||',
    expected: 0,
    actual: solve.residRel,
    rel_error: solve.residRel,
    pass: solve.residRel < 1e-9,
    note: '未知量按 3/4 方程求解',
  });

  return checks;
}

/** 库的 warnings[]：这一版只保留「不计算变形」这一条硬边界。 */
export const MECH_WARNINGS = [
  '本工具不计算变形（挠度/转角/变形协调均无）：静定反力、内力与应力不需要 section.E；要挠度请另行积分 EI·v\'\'=M 并代入边界条件',
];


// ---------------------------------------------------------------------
// 对外入口（对应 analyze）
// ---------------------------------------------------------------------

/**
 * 解一份力学 spec。
 *
 * 静不定（未知反力数 > 平衡方程数，或约束方向线性相关）时返回
 * `{ determinate: false, message: '静不定，当前只解静定' }`，diagrams / extrema /
 * stresses 一律为空 —— 不许凑答案。
 */
export function solveMech(spec: MechSpec): MechSolution {
  const model = buildModel(spec);
  const geo = buildSection(spec.section);
  const solve = solveReactions(model);

  if (!solve.determinate) {
    return {
      kind: model.kind,
      determinate: false,
      message: INDETERMINATE_MESSAGE,
      detail: `未知反力 ${solve.totalUnknowns} / 平衡方程 ${solve.nEq}：${solve.reason}`,
      reactions: [],
      section: geo,
      diagrams: {},
      extrema: {},
      stresses: {},
      checks: [],
      warnings: [...MECH_WARNINGS],
      conventions: MECH_CONVENTIONS,
    };
  }

  const evs = makeEventList(model, solve.reactions);
  const diagramsAll = buildDiagrams(model, evs);
  const extremaAll = computeExtrema(model, evs, diagramsAll);

  let scale = 1e-12;
  for (const ch of CHANNELS) for (const p of diagramsAll[ch]) scale = Math.max(scale, Math.abs(p.value));

  const primary: MechChannel[] =
    model.kind === 'bar' ? ['N'] : model.kind === 'beam' ? ['N', 'Q', 'M'] : ['T'];
  const picked = new Set<MechChannel>(primary);
  for (const ch of CHANNELS) {
    if (!picked.has(ch) && diagramsAll[ch].some((p) => Math.abs(p.value) > 1e-12 * scale)) picked.add(ch);
  }
  const channels = CHANNELS.filter((ch) => picked.has(ch));

  const diagrams: Partial<Record<MechChannel, MechDiagramPoint[]>> = {};
  const extrema: Partial<Record<MechChannel, MechExtremum>> = {};
  for (const ch of channels) {
    diagrams[ch] = diagramsAll[ch];
    const rec = extremaAll[ch];
    if (rec) extrema[ch] = rec;
  }

  const stresses = computeStresses(geo, diagramsAll, model.units.baseToStress) ?? {};

  return {
    kind: model.kind,
    determinate: true,
    reactions: solve.reactions,
    section: geo,
    diagrams,
    extrema,
    stresses,
    checks: buildChecks(model, geo, solve, evs, diagramsAll, extremaAll),
    warnings: [...MECH_WARNINGS],
    conventions: MECH_CONVENTIONS,
  };
}
