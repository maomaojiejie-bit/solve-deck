/**
 * D1 逻辑代数 solver（4 变量卡诺图）。
 *
 * 产品路径走自写最小化器 minimize.ts（零依赖）；
 * 第三方 QMC 只出现在 buildtime 的路径 C，不参与这里。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type {
  ConfidenceReport,
  Frame,
  RenderSpec,
  Solution,
  Step,
  TruthTable,
} from '../../types.ts';
import type { SolverInput } from '../registry';
import { toTex } from './logicEval.ts';
import {
  GRAY2,
  checkKarnaughRegion,
  implicantCells,
  implicantText,
  minimize,
  type Implicant,
} from './minimize.ts';

function pendingConfidence(): ConfidenceReport {
  const names = ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk'];
  return {
    scopeOk: 'skipped',
    inputOk: 'skipped',
    pathsConsistent: 'skipped',
    residualOk: 'skipped',
    boundaryOk: 'skipped',
    goldenOk: 'skipped',
    maxResidual: 0,
    checks: names.map((name) => ({
      name,
      state: 'skipped' as const,
      detail: 'solver 输出占位，等待 validateSolution',
      skipReason: '待校验',
    })),
    failedCount: 0,
    skippedCount: 6,
    allPassed: false,
  };
}

function parseNumberList(raw: unknown, label: string): number[] {
  if (raw === undefined || raw === '') return [];
  const text = String(raw);
  const items = text
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((item) => {
      if (!/^\d+$/.test(item)) throw new Error(`${label} 含非法项：${item}`);
      return Number(item);
    });
  return [...new Set(items)].sort((a, b) => a - b);
}

function parseVariables(raw: unknown): string[] {
  const text = String(raw ?? 'ABCD');
  if (!/^[A-Z]{4}$/.test(text)) throw new Error('D1 卡诺图要求 4 个变量（A–Z），如 ABCD');
  return text.split('');
}

function rowBits(index: number, variableCount: number): (0 | 1)[] {
  return Array.from(
    { length: variableCount },
    (_, bit) => ((index >> (variableCount - 1 - bit)) & 1) as 0 | 1,
  );
}

function truthRows(
  minterms: readonly number[],
  dontCares: readonly number[],
  variableCount: number,
): TruthTable['rows'] {
  const ones = new Set(minterms);
  const cares = new Set(dontCares);
  return Array.from({ length: 2 ** variableCount }, (_, index) => ({
    in: rowBits(index, variableCount),
    out: [ones.has(index) ? 1 : cares.has(index) ? 'x' : 0] as TruthTable['rows'][number]['out'],
  }));
}

function kmapCellValue(
  row: number,
  col: number,
  minterms: Set<number>,
  dontCares: Set<number>,
): string {
  const minterm = Number.parseInt(`${GRAY2[row]}${GRAY2[col]}`, 2);
  if (minterms.has(minterm)) return '1';
  if (dontCares.has(minterm)) return '-';
  return '0';
}

function buildKmapSpec(
  terms: Implicant[],
  minterms: readonly number[],
  dontCares: readonly number[],
  variables: string[],
  stepCount: number,
): RenderSpec {
  const oneSet = new Set(minterms);
  const dcSet = new Set(dontCares);
  const nodes: RenderSpec['nodes'] = [];
  const values: Record<string, string> = {};
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const cell = `${row}${col}`;
      const value = kmapCellValue(row, col, oneSet, dcSet);
      values[cell] = value;
      nodes.push({ id: `cell-${cell}`, x: col, y: row, kind: 'kmap-cell', label: value });
    }
  }

  const regions = terms.map((term, index) => {
    const cells = implicantCells(term, 4);
    const legal = checkKarnaughRegion(cells, values);
    if (!legal.ok) throw new Error(`D1 生成了非法卡诺图矩形：${legal.detail}`);
    return {
      id: `group-${index}`,
      cells,
      label: implicantText(term, variables),
    };
  });

  const regionIds = regions.map((region) => region.id);
  const frames: Frame[] = Array.from({ length: stepCount }, (_, stepIndex) => {
    if (stepIndex === 2) {
      return {
        stepIndex,
        activeEdges: [],
        activeNodes: nodes.map((node) => node.id),
        labels: regionIds.map((id, index) => ({ id, text: regions[index].label })),
      };
    }
    if (stepIndex >= 3) {
      return {
        stepIndex,
        activeEdges: [],
        activeNodes: nodes.map((node) => node.id),
        labels: regionIds.map((id, index) => ({ id, text: regions[index].label })),
      };
    }
    return { stepIndex, activeEdges: [], activeNodes: [], labels: [] };
  });

  return {
    id: 'kmap',
    role: 'primary',
    type: 'karnaugh',
    nodes,
    edges: [],
    regions,
    rowVars: variables.slice(0, 2),
    colVars: variables.slice(2),
    frames,
  };
}

function buildTableSpec(
  variables: string[],
  rows: TruthTable['rows'],
  stepCount: number,
): RenderSpec {
  return {
    id: 'truth',
    role: 'secondary',
    type: 'table',
    nodes: [],
    edges: [],
    table: { inputs: variables, outputs: ['F'], rows },
    frames: Array.from({ length: stepCount }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

export function solveD1(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('D1 solver 只接受结构化已知量，不接受网表');
  const record = input as Record<string, number | string>;
  const variables = parseVariables(record.variables);
  const minterms = parseNumberList(record.minterms, 'minterms');
  const dontCares = parseNumberList(record.dontCares, 'dontCares');
  const variableCount = variables.length;
  const domain = 2 ** variableCount;

  if (minterms.length === 0 && dontCares.length === 0) {
    throw new Error('D1 至少需要 1 个最小项或无关项');
  }
  for (const item of [...minterms, ...dontCares]) {
    if (item >= domain) throw new Error(`最小项 ${item} 超出 4 变量范围 0–15`);
  }
  const overlap = minterms.filter((item) => dontCares.includes(item));
  if (overlap.length > 0) throw new Error(`最小项与无关项重叠：${overlap.join(',')}`);

  const terms = minimize(minterms, dontCares, variableCount);
  const sop = terms.length === 0 ? '0' : terms.map((term) => implicantText(term, variables)).join(' + ');
  const rows = truthRows(minterms, dontCares, variableCount);
  const ones = minterms.length;
  const zeros = domain - ones - dontCares.length;
  const dcTex = dontCares.length > 0 ? ` + Σd(${dontCares.join(',')})` : '';

  const steps: Step[] = [
    {
      i: 0,
      title: '确定变量与最小项',
      formula_tex: `F(${variables.join(',')})=\\sum m(${minterms.join(',')})${dcTex}`,
      substitution: `变量 ${variables.join('')}；最小项 ${minterms.join(', ') || '无'}；无关项 ${dontCares.join(', ') || '无'}`,
      value: `${domain} 行真值表，${ones} 个 1，${zeros} 个 0`,
      basis: '最小项使函数取 1；无关项可任取 0/1 以利化简',
      highlight: [],
    },
    {
      i: 1,
      title: '按格雷码顺序排卡诺图',
      formula_tex: `\\text{rows}=${variables.slice(0, 2).join('')},\\ \\text{cols}=${variables.slice(2).join('')}`,
      substitution: `行序 00→01→11→10；列序 00→01→11→10`,
      value: '相邻格只差一位，首尾也相邻',
      basis: '卡诺图的几何相邻等价于布尔相邻',
      highlight: [],
    },
    {
      i: 2,
      title: '圈出极大矩形（允许环绕）',
      formula_tex: `2^k\\times 2^l\\ \\text{矩形}`,
      substitution: terms.map((term) => implicantText(term, variables)).join('；'),
      value: `${terms.length} 个素项覆盖全部 1`,
      basis: '极大全 1 矩形 = 素蕴含项；每圈越大，乘积项越短',
      highlight: terms.map((_, index) => `group-${index}`),
    },
    {
      i: 3,
      title: '读出最简与或式',
      formula_tex: `F=${toTex(sop)}`,
      substitution: `每个矩形读一个乘积项，再相或`,
      value: `F = ${sop}（${terms.length} 项）`,
      basis: '卡诺图化简',
      highlight: terms.map((_, index) => `group-${index}`),
    },
    {
      i: 4,
      title: '回代全部最小项',
      formula_tex: `F(m_i)=1,\\quad F(\\text{零项})=0`,
      substitution: `${terms.length} 个乘积项覆盖 ${ones} 个 1，且不覆盖任何 0`,
      value: `F = ${sop}`,
      basis: '覆盖完备性与一致性检查',
      highlight: terms.map((_, index) => `group-${index}`),
    },
  ];

  const kmap = buildKmapSpec(terms, minterms, dontCares, variables, steps.length);
  const table = buildTableSpec(variables, rows, steps.length);

  return {
    templateId: 'D1',
    subject: 'digital',
    parsed_given: {
      variables: variables.join(''),
      minterms: minterms.join(','),
      dontCares: dontCares.join(',') || '无',
      termCount: terms.length,
    },
    steps,
    result: {
      sop: `F = ${sop}`,
      termCount: terms.length,
      minterms: `Σm(${minterms.join(',')})`,
      dontCares: dontCares.length > 0 ? `Σd(${dontCares.join(',')})` : '无',
      ones,
      zeros,
    },
    render_specs: [kmap, table],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: dontCares.length > 0 ? [`无关项 ${dontCares.join(',')} 在真值表中记为 x，仅参与化简`] : [],
  };
}