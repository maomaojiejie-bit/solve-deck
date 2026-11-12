/**
 * D1 三路径（构建期）：
 *  A 真值表穷举         → 'truth-rows'
 *  B 卡诺图极大矩形覆盖 → 'prime-rectangles'
 *  C 第三方 QMC 化简     → 'sop-terms'
 *
 * B 不画图装分组：枚举全部循环矩形，保留极大全 1 矩形，再做集合覆盖。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const GRAY = ['00', '01', '11', '10'];

export interface D1PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'truth-rows';
  pathBIntermediate: 'prime-rectangles';
  pathCIntermediate: 'sop-terms';
  rowsA: { in: (0 | 1)[]; out: (0 | 1)[] }[];
  rectangles: { cells: string[]; covers: number[] }[];
  terms: string[];
}

type Input = Record<string, number | string>;

function parseList(raw: unknown): number[] {
  if (raw === undefined || raw === '') return [];
  return String(raw)
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number);
}

function cyclicIntervals(): number[][] {
  return [
    [0], [1], [2], [3],
    [0, 1], [1, 2], [2, 3], [3, 0],
    [0, 1, 2, 3],
  ];
}

function cellMinterm(cell: string): number {
  const row = Number(cell[0]);
  const col = Number(cell[1]);
  return Number.parseInt(`${GRAY[row]}${GRAY[col]}`, 2);
}

function runKmap(minterms: number[], dontCares: number[]) {
  const ones = new Set(minterms);
  const dc = new Set(dontCares);
  const intervals = cyclicIntervals();

  const candidates: { cells: string[]; covers: number[] }[] = [];
  for (const rows of intervals) {
    for (const cols of intervals) {
      const cells = rows.flatMap((row) => cols.map((col) => `${row}${col}`));
      const mintermList = cells.map(cellMinterm);
      if (mintermList.some((minterm) => !ones.has(minterm) && !dc.has(minterm))) continue;
      candidates.push({ cells, covers: mintermList.filter((minterm) => ones.has(minterm)) });
    }
  }

  // 极大：不被另一个合法矩形严格包含。
  const primes = candidates.filter((candidate) => {
    const set = new Set(candidate.cells);
    return !candidates.some((other) => {
      if (other.cells.length <= candidate.cells.length) return false;
      return other.cells.every((cell) => set.has(cell));
    });
  });

  const chosen: typeof primes = [];
  const covered = new Set<number>();
  while (minterms.some((minterm) => !covered.has(minterm))) {
    let best: (typeof primes)[number] | null = null;
    let bestGain = 0;
    for (const candidate of primes) {
      const gain = candidate.covers.filter((minterm) => !covered.has(minterm)).length;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }
    if (!best) throw new Error('卡诺图覆盖失败：仍有 1 未被任何矩形覆盖');
    chosen.push(best);
    for (const minterm of best.covers) covered.add(minterm);
  }

  return chosen;
}

export function runD1Paths(input: Input): D1PathsResult {
  const variables = String(input.variables ?? 'ABCD');
  if (!/^[A-Z]{4}$/.test(variables)) throw new Error('D1 路径需要 4 变量');
  const minterms = parseList(input.minterms);
  const dontCares = parseList(input.dontCares);
  if (minterms.some((item) => item < 0 || item > 15)) throw new Error('最小项超出 0–15');

  // A：独立真值表（只按最小项，无关项不置 1）。
  const rowsA = Array.from({ length: 16 }, (_, index) => ({
    in: Array.from({ length: 4 }, (_, bit) => ((index >> (3 - bit)) & 1) as 0 | 1),
    out: [minterms.includes(index) ? 1 : 0] as (0 | 1)[],
  }));
  // B：几何分组。
  const rectangles = runKmap(minterms, dontCares);
  const coveredB = [...new Set(rectangles.flatMap((item) => item.covers))].sort((a, b) => a - b);

  // C：第三方 QMC。
  const QuineMcCluskey = require('@helander/quine-mccluskey-js') as new (
    variables: string,
    values: number[],
    dontCares?: number[],
  ) => { solve(): { getValue(): string; getValues(): number[] }[] };
  const qmc = new QuineMcCluskey(variables, [...minterms], [...dontCares]);
  const solved = qmc.solve();
  const terms = solved.map((term) => term.getValue());
  const coveredC = [...new Set(solved.flatMap((term) => term.getValues()))]
    .filter((minterm) => minterms.includes(minterm))
    .sort((a, b) => a - b);

  // A 的 1 列表实际是行下标，需与 minterm 对齐（行下标 = minterm）。
  const onesList = rowsA.flatMap((row, index) => (row.out[0] === 1 ? [index] : []));
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  const ok = same(onesList, coveredB) && same(onesList, coveredC);
  let detail = 'A/B/C 覆盖的 1 集合一致';
  if (!same(onesList, coveredB)) detail = `A 与 B 覆盖不一致：A=${onesList.join(',')}，B=${coveredB.join(',')}`;
  else if (!same(onesList, coveredC)) detail = `A 与 C 覆盖不一致：A=${onesList.join(',')}，C=${coveredC.join(',')}`;

  return {
    ok,
    maxResidual: ok ? 0 : 1,
    detail,
    pathAIntermediate: 'truth-rows',
    pathBIntermediate: 'prime-rectangles',
    pathCIntermediate: 'sop-terms',
    rowsA,
    rectangles,
    terms,
  };
}