/**
 * W15-S3 数字通用求值的文本解析器：三行语法 → 既有 Netlist 契约。
 *
 * 语法（# / // 开头是注释，空行忽略）：
 *   IN  a, b, c          ← 输入名声明（必须有，≥1 个）
 *   OUT F, Cout          ← 可选：显式声明输出（多输出时推荐；缺省取「没人引用的赋值」）
 *   g1 = AND(a, b)       ← 赋值：门 = OP(信号, …) 或 输出 = 信号（纯连线别名，仅限输出）
 *   F  = OR(g1, g2)
 * 门集：AND / OR / NOT / NAND / NOR / XOR / XNOR（XNO 是 XNOR 的别名）。
 * XNOR 在既有 logicEval 里没有原语，如实展开为 XOR + NOT 两只门（gateCount 记 2）。
 *
 * 引脚命名与 logicEval.ts 现有读法对齐（D2 同款）：门输入脚 in1/in2/…（单输入
 * 用 in）、OUT 器件的输入脚 p、驱动脚 IN 用 p / 门用 out。
 *
 * 错误一律中文具体化并带 code：未知门 / 参数个数不对 / 引用不存在的信号 /
 * 组合环 / 重复定义 / 输出没被驱动。环检测放在解析层（求值层 memo 是后置的，
 * 有环会先无限递归——必须在进 truthTable 之前拦下）。
 */

import type { Netlist } from '../types.ts';

export type GateCode =
  | 'syntax'
  | 'unknownGate'
  | 'arity'
  | 'unknownSignal'
  | 'duplicate'
  | 'undrivenOutput'
  | 'cycle'
  | 'empty'
  | 'tooManyInputs';

/** 信号 → 驱动定义；op='ALIAS' 表示纯连线别名（仅输出允许）。 */
export interface SignalDef {
  op: string;
  args: string[];
  /** XNOR/XNO：参数先进 XOR，再接一只 NOT（gateCount 记 2、层深 +1）。 */
  extraNot: boolean;
  aliasSource?: string;
  line: number;
}

export interface ParsedText {
  netlist: Netlist;
  /** 按声明序的输入名（= truthTable 的位序，首位是 MSB）。 */
  inputs: string[];
  /** 输出名：OUT 声明序在前，其余（没人引用的赋值）按行序补后。 */
  outputs: string[];
  drivers: Map<string, SignalDef>;
  /** 门器件总数（XNOR 展开成 XOR+NOT 记 2，如实）。 */
  gateCount: number;
}

export type ParseResult =
  | { ok: true; parsed: ParsedText }
  | { ok: false; code: GateCode; reason: string };

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const GATE_OPS = new Set(['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'XNO']);

export function parseNetlistText(
  text: string,
  options: { checkCycle?: boolean } = {},
): ParseResult {
  const fail = (code: GateCode, reason: string) => ({ ok: false as const, code, reason });

  const lines = text
    .split('\n')
    .map((line) => line.replace(/(^|\s)(#|\/\/).*$/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return fail('empty', '输入是空的：第一行先写 IN（如 IN a, b, c），再用门拼出输出。');

  const inputs: string[] = [];
  const outDeclared: string[] = [];
  const assigned = new Map<string, SignalDef>();
  const referenced = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const upper = line.toUpperCase();
    if (upper === 'IN' || upper.startsWith('IN ') || upper.startsWith('IN,')) {
      const names = line.slice(2).split(/[,\s]+/).filter(Boolean);
      if (names.length === 0) return fail('syntax', `第 ${index + 1} 行：IN 后面没有输入名（如 IN a, b, c）。`);
      for (const name of names) {
        if (!NAME.test(name)) return fail('syntax', `第 ${index + 1} 行：「${name}」不是合法信号名（字母开头，只含字母/数字/下划线）。`);
        if (inputs.includes(name) || assigned.has(name)) {
          return fail('duplicate', `第 ${index + 1} 行：输入名「${name}」重复定义。`);
        }
        inputs.push(name);
      }
      continue;
    }
    if (upper === 'OUT' || upper.startsWith('OUT ') || upper.startsWith('OUT,')) {
      const names = line.slice(3).split(/[,\s]+/).filter(Boolean);
      if (names.length === 0) return fail('syntax', `第 ${index + 1} 行：OUT 后面没有输出名（如 OUT F, Cout）。`);
      for (const name of names) {
        if (!NAME.test(name)) return fail('syntax', `第 ${index + 1} 行：「${name}」不是合法信号名。`);
        if (outDeclared.includes(name)) return fail('duplicate', `第 ${index + 1} 行：输出「${name}」重复声明。`);
        outDeclared.push(name);
      }
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!match) {
      return fail('syntax', `第 ${index + 1} 行看不懂：「${line}」。赋值要写成 名字 = 门(信号, …)，声明写成 IN a, b 或 OUT F。`);
    }
    const lhs = match[1];
    const rhsRaw = match[2].trim();
    if (inputs.includes(lhs)) return fail('duplicate', `第 ${index + 1} 行：「${lhs}」已经在 IN 里声明过，不能再赋值。`);
    if (assigned.has(lhs)) return fail('duplicate', `第 ${index + 1} 行：「${lhs}」被赋值了两次（重复定义）。`);
    const aliasMatch = /^([A-Za-z][A-Za-z0-9_]*)$/.exec(rhsRaw);
    if (aliasMatch) {
      const source = aliasMatch[1];
      if (!NAME.test(source)) return fail('syntax', `第 ${index + 1} 行：「${source}」不是合法信号名。`);
      referenced.set(source, referenced.get(source) ?? index + 1);
      assigned.set(lhs, { op: 'ALIAS', args: [source], extraNot: false, aliasSource: source, line: index + 1 });
      continue;
    }
    const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(.*?)\s*\)$/.exec(rhsRaw);
    if (!call) {
      return fail('syntax', `第 ${index + 1} 行：「${rhsRaw}」不是门调用（要写成 AND(a, b) 这样的 门(信号, …) 形式）。`);
    }
    if (!GATE_OPS.has(call[1].toUpperCase())) {
      return fail('unknownGate', `第 ${index + 1} 行：未知门「${call[1]}」——支持 AND / OR / NOT / NAND / NOR / XOR / XNOR（XNO）。`);
    }
    const op = call[1].toUpperCase();
    const args = call[2].length === 0 ? [] : call[2].split(',').map((arg) => arg.trim()).filter(Boolean);
    // XNOR（含别名 XNO）如实展开为 XOR + NOT
    const checkOp = op === 'XNOR' || op === 'XNO' ? 'XOR' : op;
    const extraNot = checkOp === 'XOR' && op !== 'XOR';
    if (checkOp === 'NOT') {
      if (args.length !== 1) return fail('arity', `第 ${index + 1} 行：「NOT」必须恰好 1 个输入，实际 ${args.length} 个。`);
    } else if (args.length < 2) {
      return fail('arity', `第 ${index + 1} 行：「${checkOp}」需要至少 2 个输入，实际 ${args.length} 个。`);
    }
    for (const arg of args) {
      if (!NAME.test(arg)) return fail('syntax', `第 ${index + 1} 行：参数「${arg}」不是合法信号名。`);
      referenced.set(arg, referenced.get(arg) ?? index + 1);
    }
    assigned.set(lhs, { op: checkOp, args, extraNot, line: index + 1 });
  }

  if (inputs.length === 0) return fail('syntax', '没有 IN 行：第一行先声明输入（如 IN a, b, c）。');
  for (const [signal, line] of referenced) {
    if (!inputs.includes(signal) && !assigned.has(signal)) {
      return fail('unknownSignal', `第 ${line} 行引用了不存在的信号「${signal}」：它既不在 IN 里，也没有赋值行（先定义后使用、注意拼写）。`);
    }
  }

  // 组合环检测：赋值图 DFS。logicEval 的 memo 是求值后置位，有环会先无限
  // 递归爆栈——必须在进 truthTable 之前拦下，并给出环路径。
  // （放在「无输出」判断之前：环是更根本的结构错误，先报环。）
  if (options.checkCycle !== false) {
    const color = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (signal: string): ParseResult | null => {
      const state = color.get(signal);
      if (state === 2) return null;
      if (state === 1) {
        const start = Math.max(0, stack.indexOf(signal));
        const path = [...stack.slice(start), signal].join(' → ');
        return fail('cycle', `组合环：${path}——组合逻辑不能有环（信号绕回自己的输入），做时序要用触发器，这里如实拒答。`);
      }
      color.set(signal, 1);
      stack.push(signal);
      const def = assigned.get(signal);
      if (def) {
        for (const arg of def.args) {
          if (assigned.has(arg)) {
            const bad = visit(arg);
            if (bad) return bad;
          }
        }
      }
      stack.pop();
      color.set(signal, 2);
      return null;
    };
    for (const name of assigned.keys()) {
      const bad = visit(name);
      if (bad) return bad;
    }
  }

  // 输出集：OUT 显式声明 ∪ 没被任何行引用的赋值（多输出：F、Cout 各一行）
  const outputs: string[] = [];
  for (const name of outDeclared) {
    if (inputs.includes(name) || assigned.has(name)) {
      if (!outputs.includes(name)) outputs.push(name);
    } else {
      return fail('undrivenOutput', `输出「${name}」没有被驱动：给它一行 ${name} = AND(…) 这样的赋值，或从 OUT 里删掉它。`);
    }
  }
  for (const [name] of assigned) {
    if (!referenced.has(name) && !outputs.includes(name)) outputs.push(name);
  }
  if (outputs.length === 0) {
    return fail('empty', '没有任何输出：每个赋值结果都被别的门用掉了——补一行最终输出（如 F = OR(g1, g2)），或用 OUT 声明输出。');
  }
  for (const [name, def] of assigned) {
    if (def.aliasSource !== undefined && !outputs.includes(name)) {
      return fail('syntax', `第 ${def.line} 行：中间量「${name}」不能是纯连线别名（${name} = ${def.aliasSource}）——直接用 ${def.aliasSource} 本身，或把它声明成输出。`);
    }
  }

  // 组 Netlist：IN 器件 + 门器件 + OUT 器件 + 连线（引脚名与 D2/logicEval 同款）
  const devices: Netlist['devices'] = inputs.map((name) => ({ id: name, symbolId: 'IN', rotation: 0 as const }));
  const connectors: Netlist['connectors'] = [];
  let gateCount = 0;
  let anonSeq = 0;
  for (const [name, def] of assigned) {
    if (def.aliasSource !== undefined) continue;
    const isOutput = outputs.includes(name);
    // 输出赋值：门是匿名的（id 带 $，用户名留给 OUT 器件）；中间量直接用名字
    const gateId = isOutput ? `${name}$g${anonSeq++}` : name;
    const xorId = `${name}$x${anonSeq++}`;
    if (def.extraNot) {
      devices.push({ id: xorId, symbolId: 'XOR', rotation: 0 as const });
      devices.push({ id: gateId, symbolId: 'NOT', rotation: 0 as const });
      connectors.push({ from: [xorId, 'out'], to: [gateId, 'in'] });
      gateCount += 2;
    } else {
      devices.push({ id: gateId, symbolId: def.op, rotation: 0 as const });
      gateCount += 1;
    }
    const argTarget = def.extraNot ? xorId : gateId;
    def.args.forEach((arg, argIndex) => {
      connectors.push({
        from: [arg, inputs.includes(arg) ? 'p' : 'out'],
        to: [argTarget, def.args.length === 1 ? 'in' : `in${argIndex + 1}`],
      });
    });
    if (isOutput) {
      connectors.push({ from: [gateId, 'out'], to: [name, 'p'] });
    }
  }
  for (const name of outputs) {
    devices.push({ id: name, symbolId: 'OUT', rotation: 0 as const });
    const def = assigned.get(name);
    if (def && !def.aliasSource) continue; // 门驱动：上面已接线
    // 别名输出 / 输出=输入直通
    const source = def?.aliasSource ?? (inputs.includes(name) ? name : undefined);
    if (source) {
      connectors.push({ from: [source, inputs.includes(source) ? 'p' : 'out'], to: [name, 'p'] });
    }
  }

  return {
    ok: true,
    parsed: {
      netlist: { kind: 'logic', devices, connectors },
      inputs,
      outputs,
      drivers: assigned,
      gateCount,
    },
  };
}

/** 层深：最长门级链（输入=0，每过一只门 +1；XNOR 展开的 NOT 也如实 +1）。 */
export function depthOfParsed(parsed: ParsedText): number {
  const depthOf = new Map<string, number>();
  const depth = (signal: string): number => {
    const cached = depthOf.get(signal);
    if (cached !== undefined) return cached;
    const def = parsed.drivers.get(signal);
    if (!def || def.aliasSource !== undefined) {
      const aliasDepth = def?.aliasSource ? depth(def.aliasSource) : 0;
      depthOf.set(signal, aliasDepth);
      return aliasDepth;
    }
    const base = Math.max(0, ...def.args.map((arg) => (parsed.drivers.has(arg) ? depth(arg) : 0))) + 1;
    const value = base + (def.extraNot ? 1 : 0);
    depthOf.set(signal, value);
    return value;
  };
  let max = 0;
  for (const name of parsed.drivers.keys()) max = Math.max(max, depth(name));
  return max;
}
