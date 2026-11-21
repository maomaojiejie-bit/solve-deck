// 稠密线性代数：列主元高斯消元 + 奇异检测。
// 原型规模（≤200 结点 = 600 DOF）稠密消元够用，稀疏求解留二期。

export type SolveResult =
  | { ok: true; x: number[] }
  | { ok: false; reason: "singular"; pivotCol: number };

/** 解 A x = b。pivotCol 为消元失败的列号（相对入参矩阵）。
 *  2026-11-21 修订（评审 M2）：改用「按行尺度的部分主元」——
 *  原来拿主元和全矩阵最大元比（EA/L~2e9 与 4EI/L~1e2 并存时 tol=0.2），
 *  会把真实主元 1e-1 误判成奇异、假报机构。行尺度只缩放比较，不改方程。 */
export function solveSquare(aIn: number[][], bIn: number[], relTol = 1e-10): SolveResult {
  const n = bIn.length;
  const m = aIn.map((row, i) => [...row, bIn[i]]);
  const rowScale = aIn.map((row) => row.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0));

  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = -1;
    for (let r = col; r < n; r++) {
      const s = Math.abs(m[r][col]) / (rowScale[r] || 1);
      if (s > best) {
        best = s;
        piv = r;
      }
    }
    const pivotAbs = Math.abs(m[piv][col]);
    const pivotScale = rowScale[piv];
    if (pivotAbs === 0 || (pivotScale > 0 && pivotAbs < relTol * pivotScale)) {
      return { ok: false, reason: "singular", pivotCol: col };
    }
    if (piv !== col) {
      const t = m[piv];
      m[piv] = m[col];
      m[col] = t;
      const ts = rowScale[piv];
      rowScale[piv] = rowScale[col];
      rowScale[col] = ts;
    }
    const d = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return { ok: true, x };
}
