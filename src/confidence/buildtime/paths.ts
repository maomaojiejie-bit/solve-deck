/**
 * D2 三路径执行器（P3）。
 *
 * A · 真值表穷举       → intermediate: 'truth-rows'
 * B · digitaljs 门级传播 → intermediate: 'node-levels'
 * C · QMC 化简回代      → intermediate: 'sop-terms'
 *
 * B/C 不读取 A 的 rows；只共享逻辑网表与 physicsConstants 级约定。
 */

import { createRequire } from 'node:module';
import type { Netlist, TruthTable } from '../../core/types';
import {
  expressionFor,
  gateDevices,
  inputDevices,
  outputDevice,
  truthTable,
} from '../../core/templates/digital/logicEval.ts';

const require = createRequire(import.meta.url);

interface VectorSignal {
  toBin(): string;
}

interface DigitalJsCircuit {
  setInput(id: string, signal: unknown): void;
  getOutput(id: string): VectorSignal;
  updateGates(): void;
  shutdown(): void;
  get hasPendingEvents(): boolean;
  get tick(): number;
  _graph: {
    getCell(id: string): { get(name: string): { out?: VectorSignal } | undefined } | undefined;
  };
}

interface LevelSample {
  t: number;
  node: string;
  value: 0 | 1;
}

export interface PathRunResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'truth-rows';
  pathBIntermediate: 'node-levels';
  pathCIntermediate: 'sop-terms';
  rowsA: TruthTable['rows'];
  rowsB: TruthTable['rows'];
  rowsC: TruthTable['rows'];
  levels: LevelSample[];
  terms: string[];
}

const inputAssignment = (inputs: string[], index: number): Record<string, 0 | 1> => {
  const assignment: Record<string, 0 | 1> = {};
  inputs.forEach((id, bit) => {
    assignment[id] = ((index >> (inputs.length - 1 - bit)) & 1) as 0 | 1;
  });
  return assignment;
};

function rowsFromOutputs(
  rows: TruthTable['rows'],
  outputs: (0 | 1)[],
): TruthTable['rows'] {
  return rows.map((row, index) => ({
    in: [...row.in],
    out: [outputs[index]],
  }));
}

/* ── B · digitaljs 门级传播 ─────────────────────────────────────── */

function digitalJsData(netlist: Netlist) {
  const typeMap: Record<string, string> = {
    AND: 'And',
    OR: 'Or',
    NOT: 'Not',
    NAND: 'Nand',
    NOR: 'Nor',
    XOR: 'Xor',
  };
  const devices: Record<string, unknown> = {};
  for (const device of netlist.devices) {
    if (device.symbolId === 'IN') {
      devices[device.id] = { type: 'Input', bits: 1, label: device.id };
    } else if (device.symbolId === 'OUT') {
      devices[device.id] = { type: 'Output', bits: 1, label: device.id };
    } else {
      const inputs = netlist.connectors.filter((connector) => connector.to[0] === device.id).length;
      devices[device.id] = {
        type: typeMap[device.symbolId] ?? device.symbolId,
        ...(device.symbolId === 'NOT' ? {} : { inputs }),
      };
    }
  }

  const connectors = netlist.connectors.map((connector) => {
    const [fromId, fromPin] = connector.from;
    const [toId, toPin] = connector.to;
    return {
      from: { id: fromId, port: fromPin === 'p' ? 'out' : fromPin },
      to: { id: toId, port: toPin === 'p' ? 'in' : toPin },
    };
  });

  return { devices, connectors, subcircuits: {} };
}

export function runDigitalJs(netlist: Netlist): {
  rows: TruthTable['rows'];
  levels: LevelSample[];
} {
  const { HeadlessCircuit } = require('digitaljs') as {
    HeadlessCircuit: new (data: unknown) => DigitalJsCircuit;
  };
  const { Vector3vl } = require('3vl') as {
    Vector3vl: { fromBool(value: boolean): VectorSignal };
  };

  const inputs = inputDevices(netlist);
  const output = outputDevice(netlist);
  const gates = gateDevices(netlist);
  const template = digitalJsData(netlist);
  const baseRows = Array.from({ length: 2 ** inputs.length }, (_, index) => ({
    in: inputs.map(
      (_, bit) => ((index >> (inputs.length - 1 - bit)) & 1) as 0 | 1,
    ),
    out: [0 as 0 | 1],
  }));

  const outputs: (0 | 1)[] = [];
  const levels: LevelSample[] = [];

  baseRows.forEach((row, rowIndex) => {
    const circuit = new HeadlessCircuit(template);
    try {
      inputs.forEach((id, bit) => {
        circuit.setInput(id, Vector3vl.fromBool(row.in[bit] === 1));
      });

      for (let tick = 0; tick < 32; tick += 1) {
        circuit.updateGates();
        for (const gate of gates) {
          const signal = circuit._graph.getCell(gate)?.get('outputSignals')?.out;
          if (!signal) continue;
          const bin = signal.toBin();
          if (bin !== '0' && bin !== '1') continue;
          levels.push({
            t: rowIndex * 100 + circuit.tick,
            node: gate,
            value: bin === '1' ? 1 : 0,
          });
        }
        if (!circuit.hasPendingEvents) break;
      }

      const bin = circuit.getOutput(output).toBin();
      if (bin !== '0' && bin !== '1') {
        throw new Error(`digitaljs 输出为 ${bin}（未收敛）`);
      }
      outputs.push(bin === '1' ? 1 : 0);
    } finally {
      circuit.shutdown();
    }
  });

  return {
    rows: rowsFromOutputs(baseRows, outputs),
    levels,
  };
}

/* ── C · QMC 化简 + 回代 ───────────────────────────────────────── */

export function evalExpr(expr: string, assignment: Record<string, 0 | 1>): 0 | 1 {
  let index = 0;
  const text = expr;

  const skip = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  const peek = () => {
    skip();
    return text[index];
  };
  const readIdentifier = () => {
    skip();
    const match = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) throw new Error(`表达式此处需要变量：${text.slice(index)}`);
    index += match[0].length;
    return match[0];
  };

  const parseAtom = (): 0 | 1 => {
    skip();
    if (text[index] === '(') {
      index += 1;
      const value = parseOr();
      if (text[index] !== ')') throw new Error('表达式括号不匹配');
      index += 1;
      return value;
    }
    const id = readIdentifier();
    const value = assignment[id];
    if (value === undefined) throw new Error(`表达式变量 ${id} 无赋值`);
    return value;
  };

  const parseNot = (): 0 | 1 => {
    let value = parseAtom();
    skip();
    while (text[index] === "'") {
      value = value === 1 ? 0 : 1;
      index += 1;
      skip();
    }
    return value;
  };

  const parseAnd = (): 0 | 1 => {
    let value = parseNot();
    while (peek() === '·') {
      index += 1;
      const right = parseNot();
      value = value === 1 && right === 1 ? 1 : 0;
    }
    return value;
  };

  const parseXor = (): 0 | 1 => {
    let value = parseAnd();
    while (peek() === '⊕') {
      index += 1;
      const right = parseAnd();
      value = value === right ? 0 : 1;
    }
    return value;
  };

  const parseOr = (): 0 | 1 => {
    let value = parseXor();
    while (peek() === '+') {
      index += 1;
      const right = parseXor();
      value = value === 1 || right === 1 ? 1 : 0;
    }
    return value;
  };

  const result = parseOr();
  skip();
  if (index !== text.length) throw new Error(`表达式未解析完：${text.slice(index)}`);
  return result;
}

function runQmc(netlist: Netlist): {
  rows: TruthTable['rows'];
  terms: string[];
} {
  const QuineMcCluskey = require('@helander/quine-mccluskey-js') as new (
    variables: string,
    values: number[],
  ) => { solve(): { getValue(): string }[] };
  const inputs = inputDevices(netlist);
  const output = outputDevice(netlist);
  const expr = expressionFor(netlist, output);
  const baseRows = Array.from({ length: 2 ** inputs.length }, (_, index) => ({
    in: inputs.map(
      (_, bit) => ((index >> (inputs.length - 1 - bit)) & 1) as 0 | 1,
    ),
    out: [0 as 0 | 1],
  }));

  const minterms: number[] = [];
  baseRows.forEach((_, index) => {
    if (evalExpr(expr, inputAssignment(inputs, index)) === 1) minterms.push(index);
  });

  const qmc = new QuineMcCluskey(inputs.join(''), minterms);
  const terms = qmc.solve().map((term) => term.getValue());

  const outputs = baseRows.map((_, index) => {
    const assignment = inputAssignment(inputs, index);
    const value = terms.some((term) =>
      [...term].every((bit, bitIndex) => {
        if (bit === '-') return true;
        return assignment[inputs[bitIndex]] === (bit === '1' ? 1 : 0);
      }),
    );
    return (value ? 1 : 0) as 0 | 1;
  });

  return {
    rows: rowsFromOutputs(baseRows, outputs),
    terms,
  };
}

/* ── A/B/C 比对 ──────────────────────────────────────────────── */

function compareRows(
  a: TruthTable['rows'],
  b: TruthTable['rows'],
): { same: boolean; firstMismatch: number } {
  if (a.length !== b.length) return { same: false, firstMismatch: 0 };
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].in.join('') !== b[index].in.join('')) {
      return { same: false, firstMismatch: index };
    }
    if (a[index].out[0] !== b[index].out[0]) {
      return { same: false, firstMismatch: index };
    }
  }
  return { same: true, firstMismatch: -1 };
}

export function runPaths(netlist: Netlist): PathRunResult {
  const pathA = truthTable(netlist).rows;
  const pathB = runDigitalJs(netlist);
  const pathC = runQmc(netlist);

  const ab = compareRows(pathA, pathB.rows);
  const ac = compareRows(pathA, pathC.rows);
  const ok = ab.same && ac.same;
  const maxResidual = ok ? 0 : Math.hypot(ab.same ? 0 : 1, ac.same ? 0 : 1);

  let detail = 'A/B/C 全组合逐位一致';
  if (!ab.same) detail = `A 与 B 第 ${ab.firstMismatch} 行不一致`;
  else if (!ac.same) detail = `A 与 C 第 ${ac.firstMismatch} 行不一致`;

  return {
    ok,
    maxResidual,
    detail,
    pathAIntermediate: 'truth-rows',
    pathBIntermediate: 'node-levels',
    pathCIntermediate: 'sop-terms',
    rowsA: pathA,
    rowsB: pathB.rows,
    rowsC: pathC.rows,
    levels: pathB.levels,
    terms: pathC.terms,
  };
}