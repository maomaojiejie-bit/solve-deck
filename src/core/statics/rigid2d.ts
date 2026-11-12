/**
 * 平面刚体（一个物体 / 静止的物体系）的平衡求解器 —— S1 / S3 / S7 共用。
 *
 * 未知量 = 支座反力分量（`pin` 2、`roller` 1、`fixed` 3、`cable` 1），
 * 方程 = ΣFx=0、ΣFy=0、ΣM_O=0（三行）。**判据不是靠数数**，而是靠约束矩阵的秩：
 *
 *   rank(A) = 3 且 n = 3  → 静定，可解
 *   rank(A) = 3 且 n > 3  → 静不定（有多余约束），拒绝
 *   rank(A) < 3           → 机构（约束方向重复/不足），拒绝
 *
 * 拒绝时**不给任何反力数字**：`reactions` 为空，只有理由与「载荷能否被平衡」的残差。
 * 这与 M1–M4 的静不定分支同一条规矩：先给个数再标黄是不允许的。
 */

/** 支座类型（与 physicsValidator 的 reactionUnknownCount 一致）。 */
export type Rigid2DSupportKind = 'pin' | 'roller' | 'fixed' | 'cable';

export interface Rigid2DPoint {
  id: string;
  /** 右手系，y 向上（渲染层再翻成屏幕坐标）。 */
  x: number;
  y: number;
}

export interface Rigid2DBody {
  id: string;
  points: Rigid2DPoint[];
}

export interface Rigid2DSupport {
  at: string;
  kind: Rigid2DSupportKind;
  /** 可动铰 / 柔索的反力方向，度（数学正向，0°=+x，90°=+y）。默认 90°（竖直）。 */
  angleDeg?: number;
}

export interface Rigid2DLoad {
  at: string;
  /** 力分量 [Fx, Fy]，N 或 kN（与调用方单位一致）。 */
  F?: [number, number];
  /** 集中力偶，逆时针为正。 */
  M?: number;
}

export interface Rigid2DSpec {
  bodies: Rigid2DBody[];
  supports: Rigid2DSupport[];
  loads: Rigid2DLoad[];
  /** 二力杆：两点之间只有轴力，方向沿两点连线（S1 的判据会用到，S3 不用）。 */
  twoForceMembers?: { from: string; to: string }[];
}

export interface ReactionUnknown {
  at: string;
  kind: Rigid2DSupportKind;
  /** 未知量个数（pin 2 / roller 1 / fixed 3 / cable 1）。 */
  count: number;
  /** 反力方向是否已知（可动铰、柔索：已知方向，只差大小）。 */
  directionKnown: boolean;
  /** 该支座每个未知量的方向单位矢量；fixed 的第三个是纯力偶。 */
  columns: { dir: [number, number]; moment: boolean }[];
}

export interface Rigid2DReaction {
  at: string;
  kind: Rigid2DSupportKind;
  /** 水平分量（+x）。 */
  Rx: number;
  /** 竖直分量（+y）。 */
  Ry: number;
  /** 反力偶（仅 fixed）。 */
  M?: number;
  /** 合力大小（有反力偶时只算力的部分）。 */
  magnitude: number;
}

export type Rigid2DVerdict = 'determinate' | 'indeterminate' | 'mechanism';

export interface Rigid2DAnalysis {
  verdict: Rigid2DVerdict;
  /** 未知量总数。 */
  unknownCount: number;
  /** 独立方程数（平面单刚体恒为 3）。 */
  equationCount: number;
  /** 约束矩阵的秩。 */
  rank: number;
  unknowns: ReactionUnknown[];
  /** 仅静定时非空。 */
  reactions: Rigid2DReaction[];
  /** 平衡方程残差（max |A·x−b| / 量级）；拒绝时为 0。 */
  residual: number;
  /** 载荷能否被约束方向平衡：机构时这个值 > 0 说明「载荷把机构推走了」。 */
  loadResidual: number;
  /** 一句话说明（拒绝时给理由，含缺几个/多几个约束）。 */
  message: string;
}

function unit(angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** 每个支座贡献的未知量列（方向 + 力偶标记）。 */
export function supportUnknowns(support: Rigid2DSupport): ReactionUnknown {
  const angle = support.angleDeg ?? 90;
  if (support.kind === 'pin') {
    return {
      at: support.at,
      kind: support.kind,
      count: 2,
      directionKnown: false,
      columns: [
        { dir: [1, 0], moment: false },
        { dir: [0, 1], moment: false },
      ],
    };
  }
  if (support.kind === 'fixed') {
    return {
      at: support.at,
      kind: support.kind,
      count: 3,
      directionKnown: true,
      columns: [
        { dir: [1, 0], moment: false },
        { dir: [0, 1], moment: false },
        { dir: [0, 0], moment: true },
      ],
    };
  }
  return {
    at: support.at,
    kind: support.kind,
    count: 1,
    directionKnown: true,
    columns: [{ dir: unit(angle), moment: false }],
  };
}

/** 3×n 高斯消元求秩（行主元，容差按矩阵量级给）。 */
function rankOf(matrix: number[][]): number {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const m = matrix.map((row) => row.slice());
  let scale = 0;
  for (const row of m) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tol = 1e-10 * Math.max(scale, 1);
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col += 1) {
    let pivot = rank;
    for (let row = rank; row < rows; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) <= tol) continue;
    [m[rank], m[pivot]] = [m[pivot], m[rank]];
    for (let row = rank + 1; row < rows; row += 1) {
      const factor = m[row][col] / m[rank][col];
      if (factor === 0) continue;
      for (let k = col; k < cols; k += 1) m[row][k] -= factor * m[rank][k];
    }
    rank += 1;
  }
  return rank;
}

/** 3×3 线性方程组（列主元高斯消元；只在 rank=3 且 n=3 时调用）。 */
function solve3(matrix: number[][], rhs: number[]): number[] {
  const n = 3;
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const head = a[col][col];
    if (head === 0) throw new Error('平衡方程奇异：约束方向线性相关（应为机构）');
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / head;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];
    for (let col = row + 1; col < n; col += 1) sum -= a[row][col] * x[col];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** 把 b 投影到 A 的列空间后的残差（判「载荷能否被这些约束平衡」）。 */
function projectionResidual(columns: number[][], b: number[]): number {
  if (columns.length === 0) return Math.hypot(...b);
  const basis: number[][] = [];
  for (const column of columns) {
    const v = column.slice();
    for (const q of basis) {
      const dot = q.reduce((acc, value, index) => acc + value * v[index], 0);
      for (let i = 0; i < v.length; i += 1) v[i] -= dot * q[i];
    }
    const norm = Math.hypot(...v);
    if (norm > 1e-12) basis.push(v.map((value) => value / norm));
  }
  const projected = b.slice();
  for (const q of basis) {
    const dot = q.reduce((acc, value, index) => acc + value * b[index], 0);
    for (let i = 0; i < projected.length; i += 1) projected[i] -= dot * q[i];
  }
  return Math.hypot(...projected);
}

/**
 * 求一个平面刚体系的支座反力，并给出静定判据。
 *
 * @param spec 物体 + 支座 + 载荷（坐标 y 向上）
 */
export function analyzeRigid2D(spec: Rigid2DSpec): Rigid2DAnalysis {
  const points = new Map<string, Rigid2DPoint>();
  for (const body of spec.bodies) {
    for (const point of body.points) {
      if (points.has(point.id)) throw new Error(`点 ${point.id} 重复定义`);
      points.set(point.id, point);
    }
  }
  const at = (id: string): Rigid2DPoint => {
    const point = points.get(id);
    if (!point) throw new Error(`支座 / 载荷指向不存在的点 ${id}`);
    return point;
  };

  const unknowns = spec.supports.map(supportUnknowns);
  const unknownCount = unknowns.reduce((acc, item) => acc + item.count, 0);

  // 三行 = ΣFx / ΣFy / ΣM_O；列的物理意义写进 columns 备注。
  const A: number[][] = [
    new Array<number>(unknownCount).fill(0),
    new Array<number>(unknownCount).fill(0),
    new Array<number>(unknownCount).fill(0),
  ];
  let column = 0;
  for (const item of unknowns) {
    const point = at(item.at);
    for (const entry of item.columns) {
      if (entry.moment) {
        A[2][column] = 1;
      } else {
        A[0][column] = entry.dir[0];
        A[1][column] = entry.dir[1];
        A[2][column] = point.x * entry.dir[1] - point.y * entry.dir[0];
      }
      column += 1;
    }
  }

  // b = −(载荷合力 / 合力偶)
  let loadFx = 0;
  let loadFy = 0;
  let loadM = 0;
  for (const load of spec.loads) {
    const point = at(load.at);
    const [fx, fy] = load.F ?? [0, 0];
    loadFx += fx;
    loadFy += fy;
    loadM += point.x * fy - point.y * fx + (load.M ?? 0);
  }
  const b = [-loadFx, -loadFy, -loadM];

  const rank = rankOf(A);
  const loadScale = Math.max(1, Math.abs(loadFx), Math.abs(loadFy), Math.abs(loadM));
  const columns = A[0].map((_, index) => A.map((row) => row[index]));
  const loadResidual = projectionResidual(columns, b) / loadScale;

  const base = {
    unknownCount,
    equationCount: 3,
    rank,
    unknowns,
    loadResidual,
  };

  if (rank < 3) {
    const missing = 3 - rank;
    return {
      ...base,
      verdict: 'mechanism',
      reactions: [],
      residual: 0,
      message:
        `机构（约束不足 / 方向重复）：约束矩阵秩 ${rank} < 3，缺 ${missing} 个独立约束方向。` +
        (loadResidual > 1e-9
          ? `载荷在该方向无法平衡（残差 ${loadResidual.toExponential(2)} 量级），刚体会被推走。`
          : '当前载荷恰好落在可平衡的方向上，但结构仍然不是刚性的。'),
    };
  }

  if (unknownCount > 3) {
    return {
      ...base,
      verdict: 'indeterminate',
      reactions: [],
      residual: 0,
      message: `静不定：${unknownCount} 个未知反力 > 3 个独立平衡方程（多 ${unknownCount - 3} 个多余约束），需要变形协调，当前只解静定。`,
    };
  }

  if (unknownCount < 3) {
    return {
      ...base,
      verdict: 'mechanism',
      reactions: [],
      residual: 0,
      message: `机构：只有 ${unknownCount} 个未知反力 < 3 个平衡方程，约束不足。`,
    };
  }

  const solution = solve3(
    A.map((row) => row.slice(0, 3)),
    b,
  );

  // 回代残差
  const residualVector = A.map((row) => row.reduce((acc, value, index) => acc + value * solution[index], 0) - 0);
  let residual = 0;
  for (let row = 0; row < 3; row += 1) {
    residual = Math.max(residual, Math.abs(residualVector[row] - b[row]) / loadScale);
  }

  const reactions: Rigid2DReaction[] = [];
  let cursor = 0;
  for (const item of unknowns) {
    let Rx = 0;
    let Ry = 0;
    let M: number | undefined;
    for (const entry of item.columns) {
      const value = solution[cursor];
      cursor += 1;
      if (entry.moment) M = value;
      else {
        Rx += entry.dir[0] * value;
        Ry += entry.dir[1] * value;
      }
    }
    reactions.push({
      at: item.at,
      kind: item.kind,
      Rx,
      Ry,
      ...(M === undefined ? {} : { M }),
      magnitude: Math.hypot(Rx, Ry),
    });
  }

  return {
    ...base,
    verdict: 'determinate',
    reactions,
    residual,
    message: `静定：3 个未知反力 = 3 个独立方程，残差 ${residual.toExponential(2)}`,
  };
}

/**
 * S1 的判据表：每个支座「几个未知量 / 方向是否已知」。
 * 二力杆单独判：构件两端为铰、中间无载荷 ⇒ 反力沿两点连线。
 */
export interface SupportCriterion {
  at: string;
  kind: Rigid2DSupportKind;
  unknownCount: number;
  directionKnown: boolean;
  note: string;
}

export function supportCriteria(spec: Rigid2DSpec): SupportCriterion[] {
  return spec.supports.map((support) => {
    const item = supportUnknowns(support);
    const angle = support.angleDeg ?? 90;
    const note =
      support.kind === 'pin'
        ? '固定铰：约束 x/y 两个位移，反力方向未知'
        : support.kind === 'fixed'
          ? '固定端：约束 x/y 位移与转动，3 个未知量'
          : support.kind === 'roller'
            ? `可动铰：只约束法向（${angle}°），反力方向已知、大小未知`
            : `柔索：只能受拉，反力沿索向（${angle}°）`;
    return {
      at: support.at,
      kind: support.kind,
      unknownCount: item.count,
      directionKnown: item.directionKnown,
      note,
    };
  });
}

/**
 * 二力杆判定：两端都是铰（pin/roller 作用点）且**杆上没有别的东西**（中间无载荷、
 * 不挂别的构件）⇒ 是二力杆。
 *
 * `interiorPoints` 是杆身内部的点（例如载荷作用点 P）—— 只看两端会漏判：
 * 梁 AB 两端是铰，但跨中 P 有载荷，它就不是二力杆。
 */
export function twoForceCheck(
  spec: Rigid2DSpec,
  member: { from: string; to: string },
  interiorPoints: string[] = [],
): { isTwoForce: boolean; reason: string } {
  const pinned = new Set(
    spec.supports.filter((item) => item.kind === 'pin' || item.kind === 'roller').map((item) => item.at),
  );
  const ends = [member.from, member.to];
  const loaded = spec.loads.some(
    (load) => ends.includes(load.at) || interiorPoints.includes(load.at),
  );
  const bothPinned = ends.every((id) => pinned.has(id));
  if (loaded) {
    return {
      isTwoForce: false,
      reason: '杆身（含跨中）作用有外载，不是二力杆 —— 反力方向不再沿两点连线，两端各 2/1 个未知量都要留着',
    };
  }
  if (!bothPinned) {
    return { isTwoForce: false, reason: '两端未都是铰接（有固定端或刚接），不能按二力杆处理' };
  }
  return {
    isTwoForce: true,
    reason: '两端铰接且中间无载荷 ⇒ 二力杆：反力沿两点连线，方向已知，只有大小一个未知量',
  };
}
