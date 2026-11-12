/**
 * 平面桁架：节点法（主）+ 截面法（核验）+ 零杆判别。
 *
 * 未知量 = 各杆内力（拉为正）+ 支座反力分量；方程 = 每个节点的 ΣFx=0、ΣFy=0。
 * 方程数与未知量数不等（或秩不足）时**不给内力**：静不定 / 几何可变都按「拒绝」处理。
 *
 * 截面法是另一套算法（取一段隔离体、对某点取矩），不复用节点方程，
 * 所以它能抓到节点法的符号错 —— 这是 S5 的两路径。
 */

export interface TrussNode {
  id: string;
  x: number;
  /** y 向上。 */
  y: number;
}

export interface TrussMember {
  id: string;
  a: string;
  b: string;
}

export interface TrussSupport {
  at: string;
  kind: 'pin' | 'roller';
  /** 可动铰法向，度（默认 90°）。 */
  angleDeg?: number;
}

export interface TrussLoad {
  at: string;
  F: [number, number];
}

export interface TrussSpec {
  nodes: TrussNode[];
  members: TrussMember[];
  supports: TrussSupport[];
  loads: TrussLoad[];
}

export interface TrussReaction {
  at: string;
  kind: 'pin' | 'roller';
  Rx: number;
  Ry: number;
}

export interface TrussAnalysis {
  ok: boolean;
  /** 未知量数 / 方程数 / 约束+杆件矩阵的秩。 */
  unknownCount: number;
  equationCount: number;
  rank: number;
  message: string;
  reactions: TrussReaction[];
  /** 各杆内力，拉为正；不解时为空。 */
  forces: Record<string, number>;
  /** 逐节点残差（ΣFx、ΣFy 与它们的合成）。 */
  nodeResiduals: { node: string; sumFx: number; sumFy: number; residual: number }[];
  residual: number;
}

/** 列主元高斯消元；奇异返回 null。 */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = matrix.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];
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
      for (let k = col; k < cols; k += 1) m[row][k] -= factor * m[rank][k];
    }
    rank += 1;
  }
  return rank;
}

export function analyzeTruss(spec: TrussSpec): TrussAnalysis {
  const nodeIndex = new Map<string, number>();
  spec.nodes.forEach((node, index) => nodeIndex.set(node.id, index));
  const nodeOf = (id: string): number => {
    const index = nodeIndex.get(id);
    if (index === undefined) throw new Error(`桁架引用了不存在的节点 ${id}`);
    return index;
  };

  const n = spec.nodes.length;
  const m = spec.members.length;
  const unknownCount = m + spec.supports.reduce((acc, item) => acc + (item.kind === 'pin' ? 2 : 1), 0);
  const equationCount = 2 * n;
  const A: number[][] = Array.from({ length: equationCount }, () => new Array<number>(unknownCount).fill(0));
  const b = new Array<number>(equationCount).fill(0);

  // 杆件未知量：节点 p 上受 +N·u（u 由 p 指向 q），节点 q 上受 −N·u
  spec.members.forEach((member, k) => {
    const p = spec.nodes[nodeOf(member.a)];
    const q = spec.nodes[nodeOf(member.b)];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(len > 1e-12)) throw new Error(`杆 ${member.id} 长度为零`);
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    A[2 * nodeOf(member.a)][k] = ux;
    A[2 * nodeOf(member.a) + 1][k] = uy;
    A[2 * nodeOf(member.b)][k] = -ux;
    A[2 * nodeOf(member.b) + 1][k] = -uy;
  });

  // 支座未知量
  let column = m;
  for (const support of spec.supports) {
    const index = nodeOf(support.at);
    if (support.kind === 'pin') {
      A[2 * index][column] = 1;
      A[2 * index + 1][column + 1] = 1;
      column += 2;
    } else {
      const angle = ((support.angleDeg ?? 90) * Math.PI) / 180;
      A[2 * index][column] = Math.cos(angle);
      A[2 * index + 1][column] = Math.sin(angle);
      column += 1;
    }
  }

  // 载荷移到右端
  for (const load of spec.loads) {
    const index = nodeOf(load.at);
    b[2 * index] += -load.F[0];
    b[2 * index + 1] += -load.F[1];
  }

  const rank = rankOf(A);
  const base = { unknownCount, equationCount, rank, reactions: [], forces: {}, nodeResiduals: [], residual: 0 };

  if (rank < equationCount) {
    return {
      ...base,
      ok: false,
      message: `几何可变 / 机构：方程组的秩 ${rank} < ${equationCount}（缺 ${equationCount - rank} 个独立约束），不给内力`,
    };
  }
  if (unknownCount > equationCount) {
    return {
      ...base,
      ok: false,
      message: `静不定：未知量 ${unknownCount} > 方程 ${equationCount}（多 ${unknownCount - equationCount} 个），需要变形协调，当前只解静定桁架`,
    };
  }

  const solution = solveLinear(A, b);
  if (!solution) return { ...base, ok: false, message: '桁架方程组奇异，拒绝给内力' };

  const forces: Record<string, number> = {};
  spec.members.forEach((member, k) => {
    forces[member.id] = solution[k];
  });

  const reactions: TrussReaction[] = [];
  let cursor = m;
  for (const support of spec.supports) {
    if (support.kind === 'pin') {
      reactions.push({ at: support.at, kind: 'pin', Rx: solution[cursor], Ry: solution[cursor + 1] });
      cursor += 2;
    } else {
      const angle = ((support.angleDeg ?? 90) * Math.PI) / 180;
      reactions.push({
        at: support.at,
        kind: 'roller',
        Rx: Math.cos(angle) * solution[cursor],
        Ry: Math.sin(angle) * solution[cursor],
      });
      cursor += 1;
    }
  }

  // 逐节点回代
  const residuals: TrussAnalysis['nodeResiduals'] = [];
  let worst = 0;
  const scale = Math.max(
    1,
    ...spec.loads.map((load) => Math.hypot(load.F[0], load.F[1])),
    ...Object.values(forces).map((value) => Math.abs(value)),
  );
  spec.nodes.forEach((node) => {
    let sumFx = 0;
    let sumFy = 0;
    spec.members.forEach((member) => {
      if (member.a !== node.id && member.b !== node.id) return;
      const p = spec.nodes[nodeOf(member.a)];
      const q = spec.nodes[nodeOf(member.b)];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const ux = (q.x - p.x) / len;
      const uy = (q.y - p.y) / len;
      const sign = member.a === node.id ? 1 : -1;
      sumFx += sign * forces[member.id] * ux;
      sumFy += sign * forces[member.id] * uy;
    });
    for (const reaction of reactions) {
      if (reaction.at !== node.id) continue;
      sumFx += reaction.Rx;
      sumFy += reaction.Ry;
    }
    for (const load of spec.loads) {
      if (load.at !== node.id) continue;
      sumFx += load.F[0];
      sumFy += load.F[1];
    }
    const residual = Math.hypot(sumFx, sumFy) / scale;
    worst = Math.max(worst, residual);
    residuals.push({ node: node.id, sumFx, sumFy, residual });
  });

  return {
    unknownCount,
    equationCount,
    rank,
    ok: true,
    message: `静定桁架：${unknownCount} 未知量 = ${equationCount} 方程，逐节点残差 ${worst.toExponential(2)}`,
    reactions,
    forces,
    nodeResiduals: residuals,
    residual: worst,
  };
}

/** 零杆判别：两杆节点 / 三杆节点两条课本判据，逐条给理由。 */
export interface ZeroMemberFinding {
  member: string;
  rule: string;
  reason: string;
}

export function findZeroMembers(spec: TrussSpec): ZeroMemberFinding[] {
  const findings: ZeroMemberFinding[] = [];
  const supported = new Set(spec.supports.map((item) => item.at));
  const loaded = new Set(spec.loads.filter((load) => Math.hypot(load.F[0], load.F[1]) > 1e-12).map((load) => load.at));

  for (const node of spec.nodes) {
    if (supported.has(node.id) || loaded.has(node.id)) continue;
    const attached = spec.members.filter((member) => member.a === node.id || member.b === node.id);
    if (attached.length === 2) {
      const [first, second] = attached;
      const dirOf = (member: TrussMember) => {
        const other = member.a === node.id ? member.b : member.a;
        const target = spec.nodes.find((item) => item.id === other)!;
        return [target.x - node.x, target.y - node.y];
      };
      const d1 = dirOf(first);
      const d2 = dirOf(second);
      const cross = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(cross) > 1e-9) {
        for (const member of attached) {
          findings.push({
            member: member.id,
            rule: '两杆节点',
            reason: `节点 ${node.id} 只有两根不共线的杆、且无外载与支座 ⇒ 两杆均为零杆`,
          });
        }
      }
      continue;
    }
    if (attached.length === 3) {
      // 找两条共线的杆，第三根必为零杆
      for (let i = 0; i < 3; i += 1) {
        const others = [0, 1, 2].filter((index) => index !== i);
        const dirOf = (member: TrussMember) => {
          const other = member.a === node.id ? member.b : member.a;
          const target = spec.nodes.find((item) => item.id === other)!;
          return [target.x - node.x, target.y - node.y];
        };
        const d1 = dirOf(attached[others[0]]);
        const d2 = dirOf(attached[others[1]]);
        const cross = d1[0] * d2[1] - d1[1] * d2[0];
        const dot = d1[0] * d2[0] + d1[1] * d2[1];
        if (Math.abs(cross) < 1e-9 && dot < 0) {
          findings.push({
            member: attached[i].id,
            rule: '三杆节点',
            reason: `节点 ${node.id} 有三根杆且其中两根共线、无外载 ⇒ 第三根 ${attached[i].id} 为零杆`,
          });
          break;
        }
      }
    }
  }
  return findings;
}

/** 截面法：切 AC、AB 取左段（三角形桁架的经典切法），独立求 N_AC 与 N_AB。 */
export interface SectionResult {
  /** 斜杆（A→C）内力，拉为正。 */
  nAC: number;
  /** 下弦杆（A→B）内力，拉为正。 */
  nAB: number;
  cut: string[];
  note: string;
}

export function sectionTriangle(
  spec: TrussSpec,
  apex: string,
  leftBase: string,
  rightBase: string,
): SectionResult {
  const node = (id: string) => spec.nodes.find((item) => item.id === id)!;
  const A = node(leftBase);
  const C = node(apex);
  const analysis = analyzeTruss(spec);
  if (!analysis.ok) throw new Error(analysis.message);
  const reaction = analysis.reactions.find((item) => item.at === leftBase);
  if (!reaction) throw new Error(`截面法需要 ${leftBase} 处的支座反力`);

  const len = Math.hypot(C.x - A.x, C.y - A.y);
  const uy = (C.y - A.y) / len;
  if (Math.abs(uy) < 1e-12) throw new Error('A、C 等高，ΣFy 方程退化');

  // 左段：ΣFy = 0 → R_Ay + N_AC·u_y = 0
  const nAC = -reaction.Ry / uy;
  // 左段：ΣM_C = 0 → H·N_AB − x_C·R_Ay + H·R_Ax = 0
  const h = C.y - A.y;
  const nAB = (C.x * reaction.Ry - h * reaction.Rx) / h;

  return {
    nAC,
    nAB,
    cut: [`${leftBase}${apex}`, `${leftBase}${rightBase}`],
    note: `截面法：切 ${leftBase}${apex}、${leftBase}${rightBase}，取左段（含 ${leftBase} 支座）`,
  };
}
