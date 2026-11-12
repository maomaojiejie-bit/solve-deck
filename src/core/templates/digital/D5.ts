/**
 * D5 时序逻辑：序列检测器 / 模 3 计数器。
 *
 * 产品路径用符号状态转移表；构建期路径 B 把状态编码后按表求值，
 * 路径 C 用序列直接判据（模式匹配 / 模运算）。
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

type D5Kind = 'seq-detector' | 'mod3-counter';

interface Fsm {
  kind: D5Kind;
  states: string[];
  symbols: string[];
  /** 状态 × 符号 → 次态。 */
  transition: Map<string, Map<string, string>>;
  /** Moore 输出：状态 → 0/1。 */
  output: Map<string, 0 | 1>;
  initial: string;
  /** 每拍的实际输入序列（计数器为空串）。 */
  sequence: string[];
  title: string;
}

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

function bitText(raw: unknown, label: string): string {
  const text = String(raw ?? '');
  if (!/^[01]+$/.test(text)) throw new Error(`${label} 必须是 0/1 序列`);
  if (text.length > 24) throw new Error(`${label} 最长 24 拍`);
  return text;
}

function buildDetector(pattern: string, sequence: string): Fsm {
  const states = Array.from({ length: pattern.length + 1 }, (_, index) => `P${index}`);
  const transition = new Map<string, Map<string, string>>();
  const output = new Map<string, 0 | 1>();
  for (let prefix = 0; prefix <= pattern.length; prefix += 1) {
    const key = `P${prefix}`;
    const row = new Map<string, string>();
    for (const symbol of ['0', '1']) {
      const candidate = `${pattern.slice(0, prefix)}${symbol}`;
      let next = 0;
      const max = Math.min(candidate.length, pattern.length);
      for (let length = max; length >= 0; length -= 1) {
        if (candidate.slice(candidate.length - length) === pattern.slice(0, length)) {
          next = length;
          break;
        }
      }
      row.set(symbol, `P${next}`);
    }
    transition.set(key, row);
    output.set(key, prefix === pattern.length ? 1 : 0);
  }
  return {
    kind: 'seq-detector',
    states,
    symbols: ['0', '1'],
    transition,
    output,
    initial: 'P0',
    sequence: sequence.split(''),
    title: `序列检测器（模式 ${pattern}，Moore 输出）`,
  };
}

function buildCounter(cycles: number): Fsm {
  const states = ['0', '1', '2'];
  const transition = new Map<string, Map<string, string>>();
  const output = new Map<string, 0 | 1>();
  states.forEach((state) => {
    const next = String((Number(state) + 1) % 3);
    transition.set(state, new Map([['', next]]));
    output.set(state, state === '0' ? 1 : 0);
  });
  return {
    kind: 'mod3-counter',
    states,
    symbols: [''],
    transition,
    output,
    initial: '0',
    sequence: Array.from({ length: cycles }, () => ''),
    title: '模 3 计数器（同步，从 0 起）',
  };
}

function simulate(fsm: Fsm): { states: string[]; outputs: (0 | 1)[] } {
  let state = fsm.initial;
  const states: string[] = [];
  const outputs: (0 | 1)[] = [];
  for (const symbol of fsm.sequence) {
    const next = fsm.transition.get(state)?.get(symbol);
    if (next === undefined) throw new Error(`状态 ${state} 在输入 ${symbol} 下无转移`);
    state = next;
    states.push(state);
    outputs.push(fsm.output.get(state) ?? 0);
  }
  return { states, outputs };
}

function encode(state: string): number {
  const match = state.match(/^P?(\d+)$/);
  if (!match) throw new Error(`无法编码状态 ${state}`);
  return Number(match[1]);
}

function stateBits(value: number): [0 | 1, 0 | 1] {
  return [((value >> 1) & 1) as 0 | 1, (value & 1) as 0 | 1];
}

function encodedTable(fsm: Fsm): TruthTable {
  const includesInput = fsm.kind === 'seq-detector';
  const inputs = includesInput ? ['X', 'Q1', 'Q0'] : ['Q1', 'Q0'];
  const rows: TruthTable['rows'] = [];
  for (let index = 0; index < 2 ** inputs.length; index += 1) {
    const bits = inputs.map(
      (_, position) => ((index >> (inputs.length - 1 - position)) & 1) as 0 | 1,
    );
    const x = includesInput ? bits[0] : 0;
    const qValue = includesInput ? (bits[1] << 1) | bits[2] : (bits[0] << 1) | bits[1];
    const state = fsm.states[qValue] ?? null;
    const symbol = includesInput ? String(x) : '';
    const nextState = state ? fsm.transition.get(state)?.get(symbol) ?? null : null;
    const nextValue = nextState ? encode(nextState) : 0;
    const [n1, n0] = stateBits(nextValue);
    const z = nextState ? fsm.output.get(nextState) ?? 0 : 0;
    rows.push({ in: bits, out: [n1, n0, z] });
  }
  return { inputs, outputs: ['D1', 'D0', 'Z'], rows };
}

function buildStateSpec(fsm: Fsm, sequenceStates: string[], stepCount: number): RenderSpec {
  const positions = new Map<string, { x: number; y: number }>();
  const detectorGrid: { x: number; y: number }[] = [
    { x: 160, y: 160 },
    { x: 420, y: 160 },
    { x: 420, y: 380 },
    { x: 160, y: 380 },
    { x: 290, y: 540 },
  ];
  fsm.states.forEach((state, index) => {
    if (fsm.kind === 'mod3-counter') {
      const angle = (index / fsm.states.length) * Math.PI * 2 - Math.PI / 2;
      positions.set(state, { x: 260 + 120 * Math.cos(angle), y: 200 + 120 * Math.sin(angle) });
    } else if (index < detectorGrid.length) {
      positions.set(state, detectorGrid[index]);
    } else {
      positions.set(state, { x: 100 + index * 180, y: 200 });
    }
  });

  const nodes = fsm.states.map((state) => ({
    id: `state-${state}`,
    x: positions.get(state)!.x,
    y: positions.get(state)!.y,
    kind: 'state',
    label: `${state}/${fsm.output.get(state) ?? 0}`,
  }));

  const edges: RenderSpec['edges'] = [];
  let edgeIndex = 0;
  for (const state of fsm.states) {
    for (const symbol of fsm.symbols) {
      const next = fsm.transition.get(state)?.get(symbol);
      if (!next) continue;
      edgeIndex += 1;
      edges.push({
        id: `edge-${edgeIndex}`,
        from: `state-${state}`,
        to: `state-${next}`,
        kind: 'transition',
        label: symbol === '' ? '+1' : symbol,
      });
    }
  }

  const frames: Frame[] = Array.from({ length: stepCount }, (_, stepIndex) => {
    if (stepIndex === 1) {
      return {
        stepIndex,
        activeEdges: [],
        activeNodes: nodes.map((node) => node.id),
        labels: [],
      };
    }
    if (stepIndex === 2) {
      const pathStates = new Set(sequenceStates);
      return {
        stepIndex,
        activeEdges: edges
          .filter((edge) => pathStates.has(edge.from.slice(6)) || pathStates.has(edge.to.slice(6)))
          .map((edge) => edge.id),
        activeNodes: nodes.filter((node) => pathStates.has(node.id.slice(6))).map((node) => node.id),
        labels: [],
      };
    }
    return {
      stepIndex,
      activeEdges: edges.map((edge) => edge.id),
      activeNodes: nodes.map((node) => node.id),
      labels: [],
    };
  });

  return {
    id: 'states',
    role: 'primary',
    type: 'state',
    nodes,
    edges,
    frames,
  };
}

function buildTableSpec(table: TruthTable, stepCount: number): RenderSpec {
  return {
    id: 'state-table',
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

function buildTimingSpec(
  fsm: Fsm,
  sequenceStates: string[],
  outputs: (0 | 1)[],
  stepCount: number,
): RenderSpec {
  const includesInput = fsm.kind === 'seq-detector';
  const stateBitsList = sequenceStates.map((state) => stateBits(encode(state)));
  const signals = [
    { name: 'CLK', wave: 'p'.repeat(sequenceStates.length) },
    ...(includesInput ? [{ name: 'X', wave: fsm.sequence.join('') }] : []),
    { name: 'Q1', wave: stateBitsList.map(([q1]) => q1).join('') },
    { name: 'Q0', wave: stateBitsList.map(([, q0]) => q0).join('') },
    { name: 'Z', wave: outputs.join('') },
  ];
  return {
    id: 'wave',
    role: 'secondary',
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

export function solveD5(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('D5 solver 只接受结构化已知量');
  const record = input as Record<string, number | string>;
  const kind = String(record.kind ?? '') as D5Kind;
  let fsm: Fsm;
  if (kind === 'seq-detector') {
    const pattern = bitText(record.pattern, 'pattern');
    if (pattern.length < 2 || pattern.length > 3) throw new Error('D5 模式长度限 2–3（2 位状态编码）');
    fsm = buildDetector(pattern, bitText(record.input, 'input'));
  } else if (kind === 'mod3-counter') {
    const cycles = Number(record.cycles ?? 6);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 24) throw new Error('cycles 必须是 1–24');
    fsm = buildCounter(cycles);
  } else {
    throw new Error(`D5 不支持 kind=${String(record.kind)}`);
  }

  const { states: sequenceStates, outputs } = simulate(fsm);
  const table = encodedTable(fsm);
  const stateSequence = sequenceStates.map((state) => (fsm.kind === 'mod3-counter' ? state : state)).join('→');
  const outputText = outputs.join('');
  const matches = outputs.filter((value) => value === 1).length;

  const steps: Step[] = [
    {
      i: 0,
      title: '确定状态与输入字母表',
      formula_tex: `S=\\{${fsm.states.join(',')}\\},\\quad \\Sigma=\\{${fsm.symbols.filter(Boolean).join(',') || '\\text{时钟}'}\\}`,
      substitution: fsm.title,
      value: `${fsm.states.length} 个状态，${fsm.sequence.length} 拍`,
      basis: '同步时序：状态在时钟沿统一更新',
      highlight: fsm.states.map((state) => `state-${state}`),
    },
    {
      i: 1,
      title: '列状态转移表',
      formula_tex: `\\delta:S\\times\\Sigma\\to S`,
      substitution: fsm.states
        .flatMap((state) =>
          fsm.symbols.map((symbol) => `${state}--${symbol || 'clk'}-->${fsm.transition.get(state)?.get(symbol)}`),
        )
        .join('；'),
      value: `${fsm.states.length} 状态 × ${fsm.symbols.length} 符号`,
      basis: '状态转移表是时序逻辑的唯一语义来源',
      highlight: [],
    },
    {
      i: 2,
      title: '逐拍推进状态',
      formula_tex: `S_{n+1}=\\delta(S_n,x_n)`,
      substitution: `输入 ${fsm.sequence.join('') || '（无输入，仅时钟）'}`,
      value: `状态序列 ${stateSequence}`,
      basis: '状态寄存器在每拍取次态',
      highlight: [],
    },
    {
      i: 3,
      title: '读出 Moore 输出',
      formula_tex: `Z=\\lambda(S)`,
      substitution: `输出序列 ${outputText}`,
      value: `1 的个数 ${matches}`,
      basis: 'Moore 输出只由当前状态决定',
      highlight: [],
    },
    {
      i: 4,
      title: '编码后复核',
      formula_tex: `(Q_1,Q_0)\\to(D_1,D_0)`,
      substitution: `${table.rows.length} 行编码转移表`,
      value: `终态 ${sequenceStates[sequenceStates.length - 1] ?? fsm.initial}`,
      basis: '状态编码后仍须满足同一转移表',
      highlight: [],
    },
  ];

  return {
    templateId: 'D5',
    subject: 'digital',
    parsed_given: {
      kind,
      states: fsm.states.length,
      ticks: fsm.sequence.length,
      inputs: fsm.symbols.filter(Boolean).join(',') || '无',
    },
    steps,
    result: {
      kind,
      stateSequence,
      outputs: outputText,
      matches,
      finalState: sequenceStates[sequenceStates.length - 1] ?? fsm.initial,
    },
    render_specs: [
      buildStateSpec(fsm, sequenceStates, steps.length),
      buildTableSpec(table, steps.length),
      buildTimingSpec(fsm, sequenceStates, outputs, steps.length),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [],
  };
}