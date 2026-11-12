/**
 * D6 数制码制 solver。
 *
 * 范围写死在设计稿 / 本轮指令 §3.1：
 *  - 十进制 ↔ 二/八/十六进制、BCD、原码/反码/补码、格雷码双向、
 *    补码加减与溢出判定、ASCII 与 BCD 的区别；
 *  - 不做浮点、定点小数、非 8421 码制、长整数高精度；
 *  - 一切进制转换走十进制中转，不写「二进制↔八进制」捷径。
 *
 * 产品路径是这里的纯算术（零依赖）；路径 C 的第三方 QMC 不参与本文件。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { ConfidenceReport, RenderSpec, Solution, Step } from '../../types.ts';
import type { SolverInput } from '../registry';

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

/** 十进制非负整数 → 低位在前的 base 进制数字。 */
export function radixDigits(value: number, base: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw new Error(`radixDigits 只接受非负整数：${value}`);
  if (value === 0) return [0];
  const digits: number[] = [];
  let rest = value;
  while (rest > 0) {
    digits.push(rest % base);
    rest = Math.floor(rest / base);
  }
  return digits;
}

/** 位权展开：Σ digitᵢ·baseⁱ（低位在前）。 */
export function weightedValue(digits: readonly number[], base: number): number {
  let value = 0;
  let place = 1;
  for (const digit of digits) {
    if (!Number.isInteger(digit) || digit < 0 || digit >= base) {
      throw new Error(`位 ${digit} 超出 base=${base}`);
    }
    value += digit * place;
    place *= base;
  }
  return value;
}

function digitsToText(digits: readonly number[]): string {
  const alphabet = '0123456789ABCDEF';
  return [...digits]
    .reverse()
    .map((digit) => alphabet[digit])
    .join('');
}

/** 定宽二进制（不含前缀），高位在左。 */
export function fixedBits(value: number, width: number): string {
  const mod = 2 ** width;
  const normalized = ((value % mod) + mod) % mod;
  return normalized.toString(2).padStart(width, '0');
}

/** 定宽补码 → 有符号十进制。 */
export function fromTwos(bits: string): number {
  const width = bits.length;
  const unsigned = Number.parseInt(bits, 2);
  return unsigned >= 2 ** (width - 1) ? unsigned - 2 ** width : unsigned;
}

/** g = b ⊕ (b >> 1)。 */
export function toGray(value: number): number {
  return value ^ (value >>> 1);
}

/** 逆变换是级联异或，不是正变换本身：b = g ⊕ (g>>1) ⊕ (g>>2) …。 */
export function fromGray(gray: number): number {
  let value = 0;
  let rest = gray;
  while (rest > 0) {
    value ^= rest;
    rest >>>= 1;
  }
  return value;
}

export function bcdGroups(value: number): string {
  return String(value)
    .split('')
    .map((digit) => Number(digit).toString(2).padStart(4, '0'))
    .join(' ');
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数：${value}`);
}

function assertBits(bits: number): void {
  if (![4, 8, 16].includes(bits)) throw new Error(`位宽只支持 4/8/16，实际 ${bits}`);
}

function numberField(input: Record<string, number | string>, key: string, fallback?: number): number {
  const raw = input[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`D6 已知量 ${key} 必须是数字`);
  }
  return raw;
}

function matrixSpec(id: string, columns: string[], rows: string[][], stepCount: number): RenderSpec {
  return {
    id,
    role: 'primary',
    type: 'matrix',
    nodes: [],
    edges: [],
    matrix: { columns, rows },
    frames: Array.from({ length: stepCount }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

interface Built {
  steps: Step[];
  result: Record<string, number | string>;
  parsed: Record<string, number | string>;
  table: { columns: string[]; rows: string[][] };
  warnings: string[];
}

function buildConvert(input: Record<string, number | string>): Built {
  const value = numberField(input, 'value');
  const bits = numberField(input, 'bits', 8);
  assertNonNegativeInteger(value, 'value');
  assertBits(bits);
  if (value >= 2 ** bits) throw new Error(`value=${value} 超出 ${bits} 位无符号范围`);

  const binaryDigits = radixDigits(value, 2);
  const octalDigits = radixDigits(value, 8);
  const hexDigits = radixDigits(value, 16);
  const binary = digitsToText(binaryDigits);
  const octal = digitsToText(octalDigits);
  const hex = digitsToText(hexDigits);
  const gray = toGray(value);
  const grayBits = fixedBits(gray, bits);
  const grayBack = fromGray(gray);
  const bcd = bcdGroups(value);

  const rem2 = binaryDigits.join(', ');
  const rem8 = octalDigits.join(', ');
  const rem16 = hexDigits.join(', ');

  const steps: Step[] = [
    {
      i: 0,
      title: '确定目标进制与位宽',
      formula_tex: `(${value})_{10}`,
      substitution: `value=${value}，bits=${bits}；只做整数，不处理小数`,
      value: `${bits} 位无符号范围 [0, ${2 ** bits - 1}]`,
      basis: '位置记数法：同一数值可写成不同基底的位权展开',
      highlight: [],
    },
    {
      i: 1,
      title: '除基取余：十进制 → 二进制 / 八进制 / 十六进制',
      formula_tex: `N = q\\cdot b + r,\\quad r\\in[0,b)`,
      substitution: `除 2 余数（低位→高位）：${rem2}；除 8：${rem8}；除 16：${rem16}`,
      value: `0b${binary}，0o${octal}，0x${hex}`,
      basis: '除基取余，余数反向拼接',
      highlight: [],
    },
    {
      i: 2,
      title: '按位权展开回验',
      formula_tex: `N=\\sum_i a_i\\,b^i`,
      substitution:
        `0b${binary} → ${value}；0o${octal} → ` +
        `${weightedValue(octalDigits, 8)}；0x${hex} → ${weightedValue(hexDigits, 16)}`,
      value: `三种表示回验均为 ${value}`,
      basis: '位置记数法；三种进制经十进制中转互验',
      highlight: [],
    },
    {
      i: 3,
      title: '格雷码双向与 BCD',
      formula_tex: `g=b\\oplus(b\\gg1),\\quad b=g\\oplus(g\\gg1)\\oplus(g\\gg2)\\oplus\\cdots`,
      substitution: `b=${binary}，g=${grayBits}，逆变换回 ${grayBack}`,
      value: `格雷码 ${grayBits}；BCD ${bcd}`,
      basis: '格雷码相邻码仅一位变化；BCD 每十进制位固定 4 位',
      highlight: [],
    },
  ];

  return {
    steps,
    result: {
      decimal: value,
      binary: `0b${binary}`,
      octal: `0o${octal}`,
      hex: `0x${hex}`,
      bcd,
      gray: grayBits,
      grayBack: `0b${grayBack.toString(2)}`,
      roundTrip: `${weightedValue(binaryDigits, 2)}/${weightedValue(octalDigits, 8)}/${weightedValue(hexDigits, 16)}`,
    },
    parsed: { op: 'convert', value, bits, base: 10 },
    table: {
      columns: ['进制', '表示', '回验值'],
      rows: [
        ['十进制', String(value), String(value)],
        ['二进制', `0b${binary}`, String(weightedValue(binaryDigits, 2))],
        ['八进制', `0o${octal}`, String(weightedValue(octalDigits, 8))],
        ['十六进制', `0x${hex}`, String(weightedValue(hexDigits, 16))],
        ['BCD（8421）', bcd, String(value)],
        ['格雷码', grayBits, String(fromGray(gray))],
      ],
    },
    warnings: [],
  };
}

function buildComplement(input: Record<string, number | string>): Built {
  const value = numberField(input, 'value');
  const bits = numberField(input, 'bits', 8);
  assertBits(bits);
  if (!Number.isInteger(value)) throw new Error('补码只接受整数');
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  if (value < min || value > max) throw new Error(`value=${value} 超出 ${bits} 位补码范围 [${min}, ${max}]`);

  const twos8 = fixedBits(value, 8);
  const twos16 = fixedBits(value, 16);
  const magnitude8 = fixedBits(Math.abs(value), 8);
  const ones8 = value >= 0 ? magnitude8 : magnitude8.replace(/[01]/g, (bit) => (bit === '1' ? '0' : '1'));
  const twos8FromOnes = fixedBits(Number.parseInt(ones8, 2) + 1, 8);

  const steps: Step[] = [
    {
      i: 0,
      title: '确定补码位宽与表示范围',
      formula_tex: `[-2^{n-1},\\;2^{n-1}-1]`,
      substitution: `n=${bits}，value=${value}`,
      value: `范围 [${min}, ${max}]`,
      basis: 'n 位补码首位为符号位，负数比正数多一个',
      highlight: [],
    },
    {
      i: 1,
      title: '原码 → 反码 → 补码',
      formula_tex: `[x]_{补}=[x]_{反}+1`,
      substitution: `|x|=${Math.abs(value)} → ${magnitude8}；反码 ${ones8}；加 1 → ${twos8FromOnes}`,
      value: `${bits} 位补码 ${twos8}`,
      basis: '负数：符号位不变，数值位取反再加 1',
      highlight: [],
    },
    {
      i: 2,
      title: '用取模 2ⁿ 独立复算',
      formula_tex: `[x]_{补}=x\\bmod 2^n`,
      substitution: `(${value} mod 256 + 256) mod 256 = ${Number.parseInt(twos8, 2)}`,
      value: `${twos8}（与反码+1 一致）`,
      basis: '补码是模 2ⁿ 的同余表示，两条独立公式必须同值',
      highlight: [],
    },
    {
      i: 3,
      title: '扩展到 16 位并回读符号',
      formula_tex: `x = -b_{n-1}2^{n-1}+\\sum_{i<n-1}b_i2^i`,
      substitution: `16 位为 ${twos16}；回读 ${fromTwos(twos16)}`,
      value: `8 位 ${twos8}，16 位 ${twos16}`,
      basis: '符号扩展复制符号位；按补码定义回读应还原原值',
      highlight: [],
    },
  ];

  return {
    steps,
    result: {
      decimal: value,
      bits,
      ones: ones8,
      twos: twos8,
      twos16,
      range: `[${min}, ${max}]`,
      readBack: fromTwos(twos16),
    },
    parsed: { op: 'complement', value, bits, base: 10 },
    table: {
      columns: ['项目', '8 位', '16 位'],
      rows: [
        ['补码', twos8, twos16],
        ['回读十进制', String(fromTwos(twos8)), String(fromTwos(twos16))],
        ['表示范围', '[-128, 127]', '[-32768, 32767]'],
      ],
    },
    warnings: [],
  };
}

function buildAdd(input: Record<string, number | string>): Built {
  const a = numberField(input, 'a');
  const b = numberField(input, 'b');
  const bits = numberField(input, 'bits', 4);
  assertBits(bits);
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('补码加法只接受整数');
  const mod = 2 ** bits;
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  for (const value of [a, b]) {
    if (value < min || value > max) throw new Error(`${value} 超出 ${bits} 位补码范围 [${min}, ${max}]`);
  }

  const aBits = fixedBits(a, bits);
  const bBits = fixedBits(b, bits);
  const raw = Number.parseInt(aBits, 2) + Number.parseInt(bBits, 2);
  const carryOut = raw >= mod ? 1 : 0;
  const sumBits = fixedBits(raw, bits);
  const sumSigned = fromTwos(sumBits);
  const carryIntoSign = (Number.parseInt(aBits.slice(0, -1), 2) + Number.parseInt(bBits.slice(0, -1), 2)) >= 2 ** (bits - 1) ? 1 : 0;
  // 两条独立溢出判据：同号相加得异号；符号位进位与最高位进位异或。
  const overflowBySign = (a >= 0) === (b >= 0) && (sumSigned >= 0) !== (a >= 0);
  const overflowByCarry = carryIntoSign !== carryOut;
  if (overflowBySign !== overflowByCarry) throw new Error('D6 溢出双判据不一致');

  const steps: Step[] = [
    {
      i: 0,
      title: '把两个加数写成 n 位补码',
      formula_tex: `[a]_{补},\\;[b]_{补}`,
      substitution: `a=${a} → ${aBits}；b=${b} → ${bBits}；n=${bits}`,
      value: `${aBits} + ${bBits}`,
      basis: '补码加法：符号位直接参与运算',
      highlight: [],
    },
    {
      i: 1,
      title: '逐位相加并保留最高进位',
      formula_tex: `S=(A+B)\\bmod 2^n`,
      substitution: `${Number.parseInt(aBits, 2)} + ${Number.parseInt(bBits, 2)} = ${raw}`,
      value: `sum=${sumBits}，carryOut=${carryOut}`,
      basis: '模 2ⁿ 加法，最高位进位单独保留',
      highlight: [],
    },
    {
      i: 2,
      title: '两条独立判据检查溢出',
      formula_tex: `V=C_{in}\\oplus C_{out}`,
      substitution: `同号相加得异号=${overflowBySign}；进位异或=${carryIntoSign}⊕${carryOut}=${overflowByCarry ? 1 : 0}`,
      value: overflowBySign ? '溢出，结果无效' : '无溢出，结果有效',
      basis: '溢出只由符号位进位与最高位进位异或判定，不能只看 carryOut',
      highlight: [],
    },
    {
      i: 3,
      title: '回读有符号结果',
      formula_tex: `S_{10}=-s_{n-1}2^{n-1}+\\sum_{i<n-1}s_i2^i`,
      substitution: `${sumBits} → ${sumSigned}`,
      value: overflowBySign ? `模值 ${sumSigned}（溢出，不代表 a+b）` : `a+b=${sumSigned}`,
      basis: '补码回读公式',
      highlight: [],
    },
  ];

  return {
    steps,
    result: {
      aBits,
      bBits,
      sumBits,
      sumSigned,
      sumRaw: raw,
      carryOut,
      overflow: overflowBySign ? '是' : '否',
      rule: `Cin=${carryIntoSign}, Cout=${carryOut}`,
    },
    parsed: { op: 'add', a, b, bits, base: 2 },
    table: {
      columns: ['项目', '值'],
      rows: [
        ['a', `${a} = ${aBits}`],
        ['b', `${b} = ${bBits}`],
        ['sum（n 位）', sumBits],
        ['sum（十进制）', String(sumSigned)],
        ['carryOut', String(carryOut)],
        ['overflow', overflowBySign ? '是' : '否'],
      ],
    },
    warnings: overflowBySign ? ['补码加法溢出，模值不代表 a+b'] : [],
  };
}

function buildBcdAscii(input: Record<string, number | string>): Built {
  const digit = numberField(input, 'digit');
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new Error('bcd-ascii 的 digit 必须是 0–9');
  }
  const bcd = digit.toString(2).padStart(4, '0');
  const ascii = 0x30 + digit;
  const asciiBits = ascii.toString(2).padStart(8, '0');

  const steps: Step[] = [
    {
      i: 0,
      title: 'BCD：每位十进制固定 4 位二进制',
      formula_tex: `d_{10}\\rightarrow 4\\text{ bits}`,
      substitution: `${digit} → ${bcd}`,
      value: `BCD ${bcd}`,
      basis: '8421 BCD 只编码十进制数字，不做算术进位',
      highlight: [],
    },
    {
      i: 1,
      title: 'ASCII：字符编码不是 BCD',
      formula_tex: `ASCII('0')=0x30`,
      substitution: `'${digit}' = 0x${ascii.toString(16).toUpperCase()} = ${asciiBits}`,
      value: `ASCII 0x${ascii.toString(16).toUpperCase()}`,
      basis: "ASCII 高 4 位固定 0011（数字 0–9），低 4 位才是数字值",
      highlight: [],
    },
    {
      i: 2,
      title: '区别与不可混用',
      formula_tex: `\\text{BCD}\\ne\\text{ASCII}`,
      substitution: `${bcd}（4 位） vs ${asciiBits}（8 位）`,
      value: 'BCD 表示数值位；ASCII 表示字符编码',
      basis: '把 ASCII 当 BCD 会多出 0x30 偏移',
      highlight: [],
    },
  ];

  return {
    steps,
    result: {
      digit,
      bcd,
      ascii: `0x${ascii.toString(16).toUpperCase()}`,
      asciiBits,
      note: 'BCD 每十进制位 4 位；ASCII 数字字符高 4 位为 0011',
    },
    parsed: { op: 'bcd-ascii', digit, bits: 4, base: 10 },
    table: {
      columns: ['编码', '位串', '说明'],
      rows: [
        ['BCD', bcd, '十进制数字 0–9 的 4 位编码'],
        ['ASCII', asciiBits, `0x${ascii.toString(16).toUpperCase()}，含 0x30 偏移`],
      ],
    },
    warnings: [],
  };
}

export function solveD6(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('D6 solver 只接受结构化已知量，不接受网表');
  const record = input as Record<string, number | string>;
  const op = record.op;
  let built: Built;
  if (op === 'convert') built = buildConvert(record);
  else if (op === 'complement') built = buildComplement(record);
  else if (op === 'add') built = buildAdd(record);
  else if (op === 'bcd-ascii') built = buildBcdAscii(record);
  else throw new Error(`D6 不支持 op=${String(op)}；允许 convert / complement / add / bcd-ascii`);

  return {
    templateId: 'D6',
    subject: 'digital',
    parsed_given: built.parsed,
    steps: built.steps,
    result: built.result,
    render_specs: [matrixSpec('conversion', built.table.columns, built.table.rows, built.steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: built.warnings,
  };
}