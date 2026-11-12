/**
 * 自写 Quine-McCluskey 最小化器（纯位运算，零依赖，进运行时）。
 *
 * 产品路径必须零依赖；第三方 QMC 只在构建期校验里做独立对照。
 * 位序：bit (n-1) 是第一个变量（A），bit 0 是最后一个变量（D）。
 */

export interface Implicant {
  /** 固定位取 value 上的值，无关位由 mask 标记（1 = 无关）。 */
  value: number;
  mask: number;
}

export const GRAY2 = ['00', '01', '11', '10'] as const;

function keyOf(term: Implicant): string {
  return `${term.value}:${term.mask}`;
}

function popcount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest > 0) {
    count += rest & 1;
    rest >>>= 1;
  }
  return count;
}

function combine(a: Implicant, b: Implicant): Implicant | null {
  if (a.mask !== b.mask) return null;
  const diff = (a.value ^ b.value) & ~a.mask;
  if (diff === 0 || (diff & (diff - 1)) !== 0) return null;
  return { value: a.value & ~diff, mask: a.mask | diff };
}

export function covers(term: Implicant, minterm: number): boolean {
  return (minterm & ~term.mask) === term.value;
}

/** 返回覆盖全部 minterm 的最小 SOP（无关项可被覆盖）。 */
export function minimize(
  minterms: readonly number[],
  dontCares: readonly number[] = [],
  variableCount = 4,
): Implicant[] {
  const all = [...new Set([...minterms, ...dontCares])].sort((a, b) => a - b);
  if (all.length === 0) return [];
  if (all.some((item) => !Number.isInteger(item) || item < 0 || item >= 2 ** variableCount)) {
    throw new Error(`最小项超出 ${variableCount} 变量范围`);
  }

  let current: Implicant[] = all.map((value) => ({ value, mask: 0 }));
  const primes: Implicant[] = [];

  while (current.length > 0) {
    const next = new Map<string, Implicant>();
    const used = new Set<number>();
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const merged = combine(current[i], current[j]);
        if (!merged) continue;
        used.add(i);
        used.add(j);
        next.set(keyOf(merged), merged);
      }
    }
    current.forEach((term, index) => {
      if (!used.has(index)) primes.push(term);
    });
    current = [...next.values()];
  }

  const unique = [...new Map(primes.map((term) => [keyOf(term), term])).values()];

  // 每个 minterm 的候选素项。
  const coverMap = new Map<number, Implicant[]>();
  for (const minterm of minterms) {
    coverMap.set(
      minterm,
      unique.filter((term) => covers(term, minterm)),
    );
  }

  const selected: Implicant[] = [];
  const selectedKeys = new Set<string>();
  const uncovered = () => minterms.filter((minterm) => !selected.some((term) => covers(term, minterm)));
  const push = (term: Implicant): boolean => {
    if (selectedKeys.has(keyOf(term))) return false;
    selectedKeys.add(keyOf(term));
    selected.push(term);
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const minterm of uncovered()) {
      const candidates = coverMap.get(minterm) ?? [];
      if (candidates.length === 1) {
        if (push(candidates[0])) changed = true;
      }
    }
  }

  while (uncovered().length > 0) {
    let best: Implicant | null = null;
    let bestGain = -1;
    let bestText = '';
    for (const term of unique) {
      const gain = uncovered().filter((minterm) => covers(term, minterm)).length;
      const text = `${term.value}/${term.mask}`;
      if (gain > bestGain || (gain === bestGain && gain > 0 && text < bestText)) {
        best = term;
        bestGain = gain;
        bestText = text;
      }
    }
    if (!best || bestGain <= 0) throw new Error('最小化失败：仍有最小项未被覆盖');
    push(best);
  }

  // 确定性排序：先按覆盖数，再按位串。
  return selected.sort((a, b) => {
    const ca = minterms.filter((minterm) => covers(a, minterm)).length;
    const cb = minterms.filter((minterm) => covers(b, minterm)).length;
    if (ca !== cb) return cb - ca;
    return keyOf(a).localeCompare(keyOf(b));
  });
}

/** 素项 → 变量乘积（A·B' 形式）；全无关项返回 '1'。 */
export function implicantText(term: Implicant, variables: readonly string[]): string {
  const parts: string[] = [];
  for (let index = 0; index < variables.length; index += 1) {
    const bit = variables.length - 1 - index;
    if ((term.mask >>> bit) & 1) continue;
    parts.push((term.value >>> bit) & 1 ? variables[index] : `${variables[index]}'`);
  }
  return parts.length === 0 ? '1' : parts.join('·');
}

/** 4 变量卡诺图：rs = 行下标 + 列下标（各一位数字），如 '02'。 */
export function implicantCells(term: Implicant, variableCount = 4): string[] {
  if (variableCount !== 4) throw new Error('卡诺图单元格目前只支持 4 变量');
  const rowMask = (0b11 << 2) & (2 ** variableCount - 1);
  const colMask = 0b11;
  const rows: number[] = [];
  const cols: number[] = [];

  for (let index = 0; index < 4; index += 1) {
    const rowBits = Number.parseInt(GRAY2[index], 2);
    const colBits = Number.parseInt(GRAY2[index], 2);
    if (((rowBits << 2) & rowMask & ~term.mask) === (term.value & rowMask & ~term.mask)) {
      rows.push(index);
    }
    if ((colBits & colMask & ~term.mask) === (term.value & colMask & ~term.mask)) {
      cols.push(index);
    }
  }

  const cells: string[] = [];
  for (const row of rows) for (const col of cols) cells.push(`${row}${col}`);
  return cells;
}

/**
 * 卡诺图矩形合法性：行/列索引集合必须是循环连续区间且长度为 2 的幂，
 * cells 恰好等于两者的笛卡尔积，且不得覆盖任何 0。
 */
export function checkKarnaughRegion(
  cells: readonly string[],
  values: Readonly<Record<string, string>>,
): { ok: boolean; detail: string } {
  if (cells.length === 0) return { ok: false, detail: 'region 没有单元格' };
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const cell of cells) {
    if (!/^[0-3][0-3]$/.test(cell)) return { ok: false, detail: `单元格坐标非法：${cell}` };
    rows.add(Number(cell[0]));
    cols.add(Number(cell[1]));
  }
  const sizeOk = (size: number) => size === 1 || size === 2 || size === 4;
  if (!sizeOk(rows.size) || !sizeOk(cols.size)) {
    return { ok: false, detail: `行列跨度必须为 1/2/4，实际 ${rows.size}×${cols.size}` };
  }
  const cyclic = (set: Set<number>): boolean => {
    if (set.size === 1) return true;
    if (set.size === 4) return true;
    const [a, b] = [...set].sort((x, y) => x - y);
    return b - a === 1 || (a === 0 && b === 3);
  };
  if (!cyclic(rows) || !cyclic(cols)) {
    return { ok: false, detail: '行列索引不是循环连续区间（允许首尾环绕）' };
  }
  if (rows.size * cols.size !== cells.length) {
    return { ok: false, detail: 'cells 不是行列集合的笛卡尔积' };
  }
  for (const cell of cells) {
    const value = values[cell];
    if (value === '0') return { ok: false, detail: `region 覆盖了 0：${cell}` };
  }
  return { ok: true, detail: `${rows.size}×${cols.size} 矩形，${cells.length} 格均为 1/无关` };
}

export function mintermCount(terms: readonly Implicant[], minterms: readonly number[]): number {
  return minterms.filter((minterm) => terms.some((term) => covers(term, minterm))).length;
}

export { popcount };