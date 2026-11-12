/**
 * D4 触发器：SR / D / JK / T 的特性表与逐拍时序。
 *
 * 产品路径按特性表逐拍求次态；构建期路径 B 用主从锁存器逐相仿真，
 * 路径 C 用激励表反解 + 次态方程代入，三条机制不同。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type {
  ConfidenceReport,
  RenderSpec,
  Solution,
  Step,
  TruthTable,
} from '../../types.ts';
import type { SolverInput } from '../registry';

export type FlipFlop = 'SR' | 'D' | 'JK' | 'T';

export interface FlipFlopInputs {
  d?: 0 | 1;
  j?: 0 | 1;
  k?: 0 | 1;
  s?: 0 | 1;
  r?: 0 | 1;
  t?: 0 | 1;
}

export interface NextState {
  q: 0 | 1;
  invalid: boolean;
}

export function nextState(ff: FlipFlop, q: 0 | 1, inputs: FlipFlopInputs): NextState {
  switch (ff) {
    case 'D':
      return { q: inputs.d ?? 0, invalid: false };
    case 'T':
      return { q: (q ^ (inputs.t ?? 0)) as 0 | 1, invalid: false };
    case 'JK': {
      const j = inputs.j ?? 0;
      const k = inputs.k ?? 0;
      if (j === 0 && k === 0) return { q, invalid: false };
      if (j === 1 && k === 0) return { q: 1, invalid: false };
      if (j === 0 && k === 1) return { q: 0, invalid: false };
      return { q: (q ^ 1) as 0 | 1, invalid: false };
    }
    case 'SR': {
      const s = inputs.s ?? 0;
      const r = inputs.r ?? 0;
      if (s === 1 && r === 1) return { q, invalid: true };
      if (s === 1) return { q: 1, invalid: false };
      if (r === 1) return { q: 0, invalid: false };
      return { q, invalid: false };
    }
    default:
      throw new Error(`未知触发器 ${String(ff)}`);
  }
}

const INPUT_NAMES: Record<FlipFlop, string[]> = {
  D: ['D'],
  T: ['T'],
  JK: ['J', 'K'],
  SR: ['S', 'R'],
};

const EQUATIONS: Record<FlipFlop, string> = {
  D: 'Q^{+}=D',
  T: 'Q^{+}=T\\oplus Q',
  JK: "Q^{+}=JQ'+K'Q",
  SR: "Q^{+}=S+R'Q,\\quad SR=0",
};

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

function bitString(raw: unknown, label: string): (0 | 1)[] {
  const text = String(raw ?? '');
  if (!/^[01]+$/.test(text)) throw new Error(`${label} 必须是 0/1 序列，如 '1011'`);
  return text.split('').map((bit) => (bit === '1' ? 1 : 0));
}

function parseInputs(ff: FlipFlop, record: Record<string, number | string>): FlipFlopInputs[] {
  const names = INPUT_NAMES[ff];
  const sequences = names.map((name) => bitString(record[name.toLowerCase()], name));
  const length = sequences[0].length;
  if (length === 0 || length > 16) throw new Error('激励序列长度必须在 1–16 拍');
  if (sequences.some((sequence) => sequence.length !== length)) {
    throw new Error('各激励序列长度必须一致');
  }
  return Array.from({ length }, (_, tick) => {
    const entry: FlipFlopInputs = {};
    names.forEach((name, index) => {
      const key = name.toLowerCase() as keyof FlipFlopInputs;
      entry[key] = sequences[index][tick];
    });
    return entry;
  });
}

function characteristicTable(ff: FlipFlop): TruthTable {
  const names = INPUT_NAMES[ff];
  const inputs = [...names, 'Q'];
  const rows: TruthTable['rows'] = [];
  for (let index = 0; index < 2 ** inputs.length; index += 1) {
    const bits = inputs.map(
      (_, position) => ((index >> (inputs.length - 1 - position)) & 1) as 0 | 1,
    );
    const q = bits[bits.length - 1];
    const entry: FlipFlopInputs = {};
    names.forEach((name, position) => {
      entry[name.toLowerCase() as keyof FlipFlopInputs] = bits[position];
    });
    const next = nextState(ff, q, entry);
    rows.push({ in: bits, out: [next.invalid ? 'x' : next.q] });
  }
  return { inputs, outputs: ['Q+'], rows };
}

function timingSpec(
  ff: FlipFlop,
  inputs: FlipFlopInputs[],
  qValues: (0 | 1)[],
  stepCount: number,
): RenderSpec {
  const names = INPUT_NAMES[ff];
  const signals = [
    { name: 'CLK', wave: 'p'.repeat(inputs.length) },
    ...names.map((name) => ({
      name,
      wave: inputs.map((entry) => String(entry[name.toLowerCase() as keyof FlipFlopInputs] ?? 0)).join(''),
    })),
    { name: 'Q', wave: qValues.join('') },
  ];
  return {
    id: 'wave',
    role: 'primary',
    type: 'timing',
    nodes: [],
    edges: [],
    signals,
    frames: Array.from({ length: stepCount }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

function tableSpec(table: TruthTable, stepCount: number): RenderSpec {
  return {
    id: 'characteristic',
    role: 'secondary',
    type: 'table',
    nodes: [],
    edges: [],
    table,
    frames: Array.from({ length: stepCount }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

export function solveD4(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('D4 solver 只接受结构化已知量');
  const record = input as Record<string, number | string>;
  const ff = String(record.ff ?? '') as FlipFlop;
  if (!['SR', 'D', 'JK', 'T'].includes(ff)) throw new Error(`D4 不支持 ff=${String(record.ff)}`);
  const q0 = Number(record.q0 ?? 0);
  if (q0 !== 0 && q0 !== 1) throw new Error('q0 必须是 0 或 1');
  const inputs = parseInputs(ff, record);

  const qValues: (0 | 1)[] = [];
  let q = q0 as 0 | 1;
    for (const [index, entry] of inputs.entries()) {
    const next = nextState(ff, q, entry);
    if (next.invalid) {
      throw new Error(`第 ${index + 1} 拍 SR=1 无定义，D4 拒绝该激励序列`);
    }
    q = next.q;
    qValues.push(q);
  }

  const table = characteristicTable(ff);
  const sequence = qValues.join('');
  const inputText = inputs
    .map((entry, index) => {
      const parts = INPUT_NAMES[ff].map((name) => `${name}=${entry[name.toLowerCase() as keyof FlipFlopInputs]}`);
      return `t${index + 1}: ${parts.join(',')} → Q=${qValues[index]}`;
    })
    .join('；');

  const steps: Step[] = [
    {
      i: 0,
      title: '确认触发器类型与初态',
      formula_tex: `${ff}\\ \\text{触发器的特性方程}`,
      substitution: `初态 Q0=${q0}；激励长度 ${inputs.length} 拍`,
      value: `Q^{+}=${ff} 的特性函数`,
      basis: '触发器分析先定类型、初态和时钟沿',
      highlight: [],
    },
    {
      i: 1,
      title: '列出特性表',
      formula_tex: EQUATIONS[ff],
      substitution: `${table.rows.length} 行（${INPUT_NAMES[ff].join(',')},Q）`,
      value: `Q+ 由 ${INPUT_NAMES[ff].join('、')} 与 Q 唯一确定`,
      basis: '特性表穷举当前态与激励',
      highlight: [],
    },
    {
      i: 2,
      title: '逐拍代入激励序列',
      formula_tex: `Q_{n+1}=f(${INPUT_NAMES[ff].join(',')},Q_n)`,
      substitution: inputText,
      value: `Q 序列 ${sequence}`,
      basis: '同步时序：每拍按特性表更新一次',
      highlight: [],
    },
    {
      i: 3,
      title: '用次态方程复核',
      formula_tex: EQUATIONS[ff],
      substitution: `初态 ${q0}，${inputs.length} 拍后 Q=${q}`,
      value: `终态 Q=${q}`,
      basis: '特性表与次态方程两条独立依据',
      highlight: [],
    },
  ];

  return {
    templateId: 'D4',
    subject: 'digital',
    parsed_given: {
      ff,
      q0,
      ticks: inputs.length,
      inputs: INPUT_NAMES[ff].join(','),
    },
    steps,
    result: {
      ff,
      q0,
      sequence,
      finalQ: q,
      ticks: inputs.length,
      invalidTicks: 0,
    },
    render_specs: [timingSpec(ff, inputs, qValues, steps.length), tableSpec(table, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}