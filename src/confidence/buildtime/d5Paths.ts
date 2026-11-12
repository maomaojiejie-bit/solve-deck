/**
 * D5 三路径（构建期）：
 *  A 符号状态表逐拍查表   → 'state-table-rows'
 *  B 状态编码后按表求值   → 'state-traces'
 *  C 序列直接判据         → 'direct-sequence'
 *
 * 本文件不 import D5.ts。
 */

import { implicantText, minimize } from '../../core/templates/digital/minimize.ts';
import { evalExpr } from './paths.ts';

type Input = Record<string, number | string>;

export interface D5PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'state-table-rows';
  pathBIntermediate: 'state-traces';
  pathCIntermediate: 'direct-sequence';
  statesA: string;
  statesB: string;
  statesC: string;
  outputsA: string;
  outputsB: string;
  outputsC: string;
}

interface Fsm {
  states: string[];
  symbols: string[];
  transition: Map<string, Map<string, string>>;
  output: Map<string, 0 | 1>;
  initial: string;
  sequence: string[];
  detector: boolean;
  pattern: string;
}

function build(input: Input): Fsm {
  const kind = String(input.kind ?? '');
  if (kind === 'seq-detector') {
    const pattern = String(input.pattern ?? '');
    const sequence = String(input.input ?? '');
    if (!/^[01]{2,3}$/.test(pattern)) throw new Error('D5 pattern 必须是 2–3 位 0/1');
    if (!/^[01]{1,24}$/.test(sequence)) throw new Error('D5 input 必须是 1–24 位 0/1');
    const states = Array.from({ length: pattern.length + 1 }, (_, index) => `P${index}`);
    const transition = new Map<string, Map<string, string>>();
    const output = new Map<string, 0 | 1>();
    for (let prefix = 0; prefix <= pattern.length; prefix += 1) {
      const row = new Map<string, string>();
      for (const symbol of ['0', '1']) {
        const candidate = `${pattern.slice(0, prefix)}${symbol}`;
        let next = 0;
        for (let length = Math.min(candidate.length, pattern.length); length >= 0; length -= 1) {
          if (candidate.slice(candidate.length - length) === pattern.slice(0, length)) {
            next = length;
            break;
          }
        }
        row.set(symbol, `P${next}`);
      }
      transition.set(`P${prefix}`, row);
      output.set(`P${prefix}`, prefix === pattern.length ? 1 : 0);
    }
    return {
      states,
      symbols: ['0', '1'],
      transition,
      output,
      initial: 'P0',
      sequence: sequence.split(''),
      detector: true,
      pattern,
    };
  }
  if (kind === 'mod3-counter') {
    const cycles = Number(input.cycles ?? 6);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 24) throw new Error('cycles 必须是 1–24');
    const states = ['0', '1', '2'];
    const transition = new Map<string, Map<string, string>>();
    const output = new Map<string, 0 | 1>();
    states.forEach((state) => {
      transition.set(state, new Map([['', String((Number(state) + 1) % 3)]]));
      output.set(state, state === '0' ? 1 : 0);
    });
    return {
      states,
      symbols: [''],
      transition,
      output,
      initial: '0',
      sequence: Array.from({ length: cycles }, () => ''),
      detector: false,
      pattern: '',
    };
  }
  throw new Error(`D5 不支持 kind=${kind}`);
}

function encode(state: string): number {
  const match = state.match(/^P?(\d+)$/);
  if (!match) throw new Error(`无法编码 ${state}`);
  return Number(match[1]);
}

function runTable(fsm: Fsm): { states: string[]; outputs: (0 | 1)[] } {
  let state = fsm.initial;
  const states: string[] = [];
  const outputs: (0 | 1)[] = [];
  for (const symbol of fsm.sequence) {
    const next = fsm.transition.get(state)?.get(symbol);
    if (!next) throw new Error(`无转移：${state}/${symbol}`);
    state = next;
    states.push(state);
    outputs.push(fsm.output.get(state) ?? 0);
  }
  return { states, outputs };
}

/** B：状态编码后，由编码真值表最小化成次态布尔方程，再逐拍代入。 */
function runEncoded(fsm: Fsm): { states: string[]; outputs: (0 | 1)[] } {
  const includesInput = fsm.detector;
  const variables = includesInput ? ['X', 'Q1', 'Q0'] : ['Q1', 'Q0'];
  const rows: { in: (0 | 1)[]; out: (0 | 1)[] }[] = [];
  for (let index = 0; index < 2 ** variables.length; index += 1) {
    const bits = variables.map(
      (_, position) => ((index >> (variables.length - 1 - position)) & 1) as 0 | 1,
    );
    const symbol = includesInput ? String(bits[0]) : '';
    const code = includesInput ? (bits[1] << 1) | bits[2] : (bits[0] << 1) | bits[1];
    const state = fsm.states[code] ?? null;
    const next = state ? fsm.transition.get(state)?.get(symbol) : undefined;
    const nextCode = next ? encode(next) : 0;
    const z = next ? fsm.output.get(next) ?? 0 : 0;
    rows.push({
      in: bits,
      out: [((nextCode >> 1) & 1) as 0 | 1, (nextCode & 1) as 0 | 1, z],
    });
  }

  const equations = [0, 1, 2].map((column) => {
    const minterms = rows.flatMap((row, index) => (row.out[column] === 1 ? [index] : []));
    return (
      minimize(minterms, [], variables.length)
        .map((term) => implicantText(term, variables))
        .join(' + ') || '0'
    );
  });

  let code = encode(fsm.initial);
  const states: string[] = [];
  const outputs: (0 | 1)[] = [];
  for (const symbol of fsm.sequence) {
    const assignment: Record<string, 0 | 1> = {
      Q1: ((code >> 1) & 1) as 0 | 1,
      Q0: (code & 1) as 0 | 1,
    };
    if (includesInput) assignment.X = Number(symbol) as 0 | 1;
    const next1 = evalExpr(equations[0], assignment);
    const next0 = evalExpr(equations[1], assignment);
    const z = evalExpr(equations[2], assignment);
    code = (next1 << 1) | next0;
    states.push(fsm.states[code] ?? `?${code}`);
    outputs.push(z);
  }
  return { states, outputs };
}

/** C：序列直接判据。 */
function runDirect(fsm: Fsm): { states: string[]; outputs: (0 | 1)[] } {
  const states: string[] = [];
  const outputs: (0 | 1)[] = [];
  if (fsm.detector) {
    const text = fsm.sequence.join('');
    for (let tick = 0; tick < text.length; tick += 1) {
      const prefix = text.slice(0, tick + 1);
      let matched = 0;
      for (let length = Math.min(prefix.length, fsm.pattern.length); length >= 0; length -= 1) {
        if (prefix.endsWith(fsm.pattern.slice(0, length))) {
          matched = length;
          break;
        }
      }
      states.push(`P${matched}`);
      outputs.push(fsm.pattern.length > 0 && prefix.endsWith(fsm.pattern) ? 1 : 0);
    }
  } else {
    for (let tick = 0; tick < fsm.sequence.length; tick += 1) {
      const value = (tick + 1) % 3;
      states.push(String(value));
      outputs.push(value === 0 ? 1 : 0);
    }
  }
  return { states, outputs };
}

export function runD5Paths(input: Input): D5PathsResult {
  const fsm = build(input);
  const a = runTable(fsm);
  const b = runEncoded(fsm);
  const c = runDirect(fsm);
  const statesA = a.states.join('→');
  const statesB = b.states.join('→');
  const statesC = c.states.join('→');
  const outputsA = a.outputs.join('');
  const outputsB = b.outputs.join('');
  const outputsC = c.outputs.join('');
  const ok = statesA === statesB && statesA === statesC && outputsA === outputsB && outputsA === outputsC;
  return {
    ok,
    maxResidual: ok ? 0 : 1,
    detail: ok
      ? `A/B/C 状态与输出一致：${statesA}；Z=${outputsA}`
      : `不一致：状态 A=${statesA} B=${statesB} C=${statesC}；输出 A=${outputsA} B=${outputsB} C=${outputsC}`,
    pathAIntermediate: 'state-table-rows',
    pathBIntermediate: 'state-traces',
    pathCIntermediate: 'direct-sequence',
    statesA,
    statesB,
    statesC,
    outputsA,
    outputsB,
    outputsC,
  };
}