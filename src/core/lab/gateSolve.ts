/**
 * W15-S3 数字通用求值：gateSolve(text) → LogicSolution。
 *
 * 输入面是文本网表（netlistParse.ts 解析成既有 Netlist 契约），不是画布——
 * 数字族没有可装配的几何（coverage.ts 已判定），别再画方框拖线。
 *
 * 红线遵守：只 import 纯工具 logicEval.ts / minimize.ts（truthTable /
 * evaluateNetlist / mintermsOf / expressionFor / minimize / implicantText），
 * 不 import 任何 D1–D6 模板本体——check:gatesolve 有一条 import 白名单，
 * check:runtime 闭包也会扫。XNOR 由解析器展开成 XOR+NOT，不动 logicEval。
 *
 * 模式：≤6 输入全枚举真值表（truthTable，同 D2/D3 一条路径）；7–8 输入
 * 不再枚举（truthTable 会生 128/256 行），走激励模式按给定激励逐条求值，
 * minterms/minimized 留空（不假装算过）；>8 输入如实拒答。不做时序仿真，
 * 页面写明。
 */

import {
  evaluateNetlist,
  expressionFor,
  mintermsOf,
  truthTable,
} from '../templates/digital/logicEval.ts';
import { implicantText, minimize } from '../templates/digital/minimize.ts';
import { depthOfParsed, parseNetlistText, type GateCode } from './netlistParse.ts';
import type { Netlist } from '../types.ts';

/** 变异开关：check:gatesolve 第 ⑥ 条把它关掉 = 组合环不再拒答 → 第 ④ 条红。 */
export const GATESOLVE_CONFIG = { checkCycle: true };

export interface LogicOutput {
  name: string;
  minterms: number[];
  /** 结构式（按网表原样展开，XNOR 呈现为 (…⊕…)′）。 */
  expression: string;
  /** QMC 最小化式（SOP）；激励模式下不枚举，留空并如实说明。 */
  minimized: string;
}

export interface LogicSolution {
  inputs: string[];
  outputs: LogicOutput[];
  gateCount: number;
  /** 最长门级链（输入=0；XNOR 的 NOT 如实 +1）。 */
  depth: number;
  /** 激励模式（给了 stimuli 时）：每条激励一行，in/out 都是按声明序的位串。 */
  states?: { in: string; out: string }[];
}

export type GateSolveOutcome =
  | { ok: true; solution: LogicSolution }
  | { ok: false; code: GateCode; reason: string };

export interface GateSolveOptions {
  /** 激励串列表（激励模式）：每串按 IN 声明序给出各位（0/1，可含逗号/空格分隔）。 */
  stimuli?: string[];
}

/** 单输出子网表：器件全保留，只留目标 OUT（logicEval 的 outputDevice 取第一只）。 */
function netlistForOutput(netlist: Netlist, output: string): Netlist {
  const devices = netlist.devices.filter(
    (device) => device.symbolId !== 'OUT' || device.id === output,
  );
  return { kind: 'logic', devices, connectors: netlist.connectors };
}

export function gateSolve(text: string, options: GateSolveOptions = {}): GateSolveOutcome {
  const refuse = (code: GateCode, reason: string): GateSolveOutcome => ({ ok: false, code, reason });

  const parsed = parseNetlistText(text, { checkCycle: GATESOLVE_CONFIG.checkCycle });
  if (!parsed.ok) return { ok: false, code: parsed.code, reason: parsed.reason };
  const { inputs, outputs, gateCount, netlist } = parsed.parsed;

  if (inputs.length > 8) {
    return refuse('tooManyInputs', `输入有 ${inputs.length} 个：通用求值最多 8 个（2^8 已是 256 行）——把不参与本输出的输入拆出去。`);
  }

  const excitationMode = inputs.length > 6;
  if (excitationMode && (!options.stimuli || options.stimuli.length === 0)) {
    return refuse(
      'tooManyInputs',
      `输入有 ${inputs.length} 个（>6）：不再枚举真值表，请走激励模式——按 IN 声明序给 ${inputs.length} 位 0/1 激励串（每行一条），逐条求值。`,
    );
  }

  // 激励解析（给了就逐条求值；≤6 输入也允许附带激励）
  const states: { in: string; out: string }[] = [];
  if (options.stimuli && options.stimuli.length > 0) {
    for (const raw of options.stimuli) {
      const bits = raw.split(/[^01]/).filter((bit) => bit.length > 0).join('');
      if (bits.length !== inputs.length || !/^[01]+$/.test(bits)) {
        return refuse('syntax', `激励「${raw.trim()}」应为 ${inputs.length} 位 0/1（按 IN 声明序：${inputs.join(', ')}），实际解析出 ${bits.length} 位。`);
      }
      const assignment: Record<string, 0 | 1> = {};
      inputs.forEach((name, index) => {
        assignment[name] = (bits[index] === '1' ? 1 : 0) as 0 | 1;
      });
      const outBits = outputs.map((output) => {
        const value = evaluateNetlist(netlistForOutput(netlist, output), assignment);
        return String(value);
      });
      states.push({ in: bits, out: outBits.join('') });
    }
  }

  // ≤6 输入：全枚举真值表 → 最小项 → QMC 最小化（与 D2/D3 同一条路径）
  const solutionOutputs: LogicOutput[] = outputs.map((output) => {
    const sub = netlistForOutput(netlist, output);
    if (excitationMode) {
      return { name: output, minterms: [], expression: expressionFor(sub), minimized: '' };
    }
    const table = truthTable(sub);
    const minterms = mintermsOf(table.rows);
    const terms = minimize(minterms, [], inputs.length);
    return {
      name: output,
      minterms,
      expression: expressionFor(sub),
      minimized: terms.map((term) => implicantText(term, inputs)).join(' + ') || '0',
    };
  });

  return {
    ok: true,
    solution: {
      inputs,
      outputs: solutionOutputs,
      gateCount,
      depth: depthOfParsed(parsed.parsed),
      ...(states.length > 0 ? { states } : {}),
    },
  };
}

/** 供页面/门禁复用：IN / OUT 器件数核对（防止解析器漏建器件）。 */
export function netlistShape(netlist: Netlist): { ins: number; outs: number; gates: number } {
  return {
    ins: netlist.devices.filter((device) => device.symbolId === 'IN').length,
    outs: netlist.devices.filter((device) => device.symbolId === 'OUT').length,
    gates: netlist.devices.filter((device) => !['IN', 'OUT'].includes(device.symbolId)).length,
  };
}
