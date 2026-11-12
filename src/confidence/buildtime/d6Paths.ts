/**
 * D6 三路径（构建期）：
 *  A 位权展开     → 'place-value-digits'
 *  B 除基取余     → 'radix-remainders'
 *  C 码制位运算   → 'code-bitops'
 *
 * 本文件不 import D6.ts；算术在这里独立重写一遍，避免“路径 C 调用 solver 自证”。
 */

export interface D6PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'place-value-digits';
  pathBIntermediate: 'radix-remainders';
  pathCIntermediate: 'code-bitops';
  valueA: number;
  valueB: number;
  valueC: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

type Input = Record<string, number | string>;

function num(input: Input, key: string, fallback?: number): number {
  const raw = input[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`D6 已知量 ${key} 必须是数字`);
  return raw;
}

function divisionDigits(value: number, base: number): number[] {
  if (value < 0 || !Number.isInteger(value)) throw new Error(`除基取余只接受非负整数：${value}`);
  const digits: number[] = [];
  let rest = value;
  if (rest === 0) return [0];
  while (rest > 0) {
    digits.push(rest % base);
    rest = Math.floor(rest / base);
  }
  return digits;
}

function placeValue(digits: readonly number[], base: number): number {
  return digits.reduce((sum, digit, index) => {
    if (digit < 0 || digit >= base) throw new Error(`digit=${digit} 超出 base=${base}`);
    return sum + digit * base ** index;
  }, 0);
}

function signedBits(bits: string): number {
  const unsigned = Number.parseInt(bits, 2);
  return unsigned >= 2 ** (bits.length - 1) ? unsigned - 2 ** bits.length : unsigned;
}

function fixed(value: number, width: number): string {
  const mod = 2 ** width;
  return (((value % mod) + mod) % mod).toString(2).padStart(width, '0');
}

const checks: D6PathsResult['checks'] = [];
function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function finish(valueA: number, valueB: number, valueC: number): D6PathsResult {
  const same = valueA === valueB && valueA === valueC;
  const failures = checks.filter((item) => !item.ok);
  const ok = same && failures.length === 0;
  return {
    ok,
    maxResidual: ok ? 0 : Math.max(1, Math.abs(valueA - valueB), Math.abs(valueA - valueC)),
    detail: ok
      ? `A/B/C 一致于 ${valueA}；${checks.length} 条码制恒等式通过`
      : failures.length > 0
        ? failures.map((item) => `${item.name}：${item.detail}`).join('；')
        : `三路径不一致：A=${valueA}，B=${valueB}，C=${valueC}`,
    pathAIntermediate: 'place-value-digits',
    pathBIntermediate: 'radix-remainders',
    pathCIntermediate: 'code-bitops',
    valueA,
    valueB,
    valueC,
    checks,
  };
}

function runConvert(input: Input, result?: Input): D6PathsResult {
  const value = num(input, 'value');
  const bits = num(input, 'bits', 8);
  if (!Number.isInteger(value) || value < 0) throw new Error('convert.value 必须是非负整数');
  if (value >= 2 ** bits) throw new Error(`value=${value} 超出 ${bits} 位`);

  // A：十进制位权展开。
  const decDigits = divisionDigits(value, 10);
  const valueA = placeValue(decDigits, 10);

  // B：除 2 取余后反向，再按位权展开。
  const binDigits = divisionDigits(value, 2);
  const binText = [...binDigits].reverse().join('');
  const valueB = placeValue(binDigits, 2);
  record('除基取余反向拼接', binText === value.toString(2), `除 2 得 ${binText}`);

  // C：BCD / 格雷码 / 补码取模三条位运算恒等。
  const bcdText = String(value)
    .split('')
    .map((digit) => Number(digit).toString(2).padStart(4, '0'))
    .join(' ');
  const bcdDigits = bcdText.split(' ').map((group) => Number.parseInt(group, 2));
  const bcdValue = bcdDigits.reduce((sum, digit) => sum * 10 + digit, 0);
  record('BCD 8421 回转', bcdValue === value, `BCD 回转得 ${bcdValue}`);

  let gray = value ^ (value >>> 1);
  const grayBits = fixed(gray, bits);
  let grayBack = 0;
  let rest = gray;
  while (rest > 0) {
    grayBack ^= rest;
    rest >>>= 1;
  }
  record('格雷码逆变换', grayBack === value, `g=${grayBits} → b=${grayBack}`);

  const twos = ((value % 2 ** bits) + 2 ** bits) % 2 ** bits;
  // 对非负数，补码就是本身；「反码+1」验的是 -value 的模负表示。
  const modularNeg = ((2 ** bits - value) % 2 ** bits + 2 ** bits) % 2 ** bits;
  const invertPlus = (Number.parseInt(fixed(~value, bits), 2) + 1) % 2 ** bits;
  record('模负与反码+1', modularNeg === invertPlus, `${modularNeg} vs ${invertPlus}`);

  if (result) {
    const octText = [...divisionDigits(value, 8)].reverse().join('');
    const hexText = [...divisionDigits(value, 16)]
      .reverse()
      .map((digit) => '0123456789ABCDEF'[digit])
      .join('');
    record('结果二进制', result.binary === `0b${binText}`, `结果=${result.binary}，应为 0b${binText}`);
    record('结果八进制', result.octal === `0o${octText}`, `结果=${result.octal}，应为 0o${octText}`);
    record('结果十六进制', result.hex === `0x${hexText}`, `结果=${result.hex}，应为 0x${hexText}`);
    record('结果格雷码', result.gray === grayBits, `结果=${result.gray}，应为 ${grayBits}`);
    const grayBackClaimed = String(result.grayBack ?? '').replace(/^0b/, '');
    record('结果格雷码逆变换', grayBackClaimed === value.toString(2), `结果=${result.grayBack}，应为 ${value}`);
    record('结果 BCD', result.bcd === bcdText, `结果=${result.bcd}，应为 ${bcdText}`);
  }

  return finish(valueA, valueB, twos);
}

function runComplement(input: Input, result?: Input): D6PathsResult {
  const value = num(input, 'value');
  const bits = num(input, 'bits', 8);
  if (!Number.isInteger(value)) throw new Error('complement.value 必须是整数');
  if (value < -(2 ** (bits - 1)) || value > 2 ** (bits - 1) - 1) {
    throw new Error(`value=${value} 超出 ${bits} 位补码范围`);
  }

  // A：按符号位与位权展开回读。
  const magnitude = Math.abs(value);
  const magDigits = divisionDigits(magnitude, 2);
  const unsignedRead = placeValue(magDigits, 2);
  const sign = value < 0 ? -1 : 1;
  const valueA = sign * unsignedRead;

  // B：先除基得数值位，再套符号位（符号扩展）。
  const widthBits = fixed(value, bits);
  const valueB = signedBits(widthBits);

  // C：两条独立补码公式（反码+1 从 |x| 的原码出发，不是从 x 的位模式出发）。
  const modValue = ((value % 2 ** bits) + 2 ** bits) % 2 ** bits;
  const magnitudeBits = fixed(Math.abs(value), bits);
  const onesBits =
    value >= 0
      ? magnitudeBits
      : fixed(~Number.parseInt(magnitudeBits, 2) & (2 ** bits - 1), bits);
  const onesPlusOne =
    value >= 0 ? Number.parseInt(onesBits, 2) : (Number.parseInt(onesBits, 2) + 1) % 2 ** bits;
  record('补码两公式', modValue === onesPlusOne, `mod=${modValue}，反码+1=${onesPlusOne}`);
  const valueC = signedBits(fixed(modValue, bits));
  record('16 位符号扩展回读', signedBits(fixed(value, 16)) === value, `16 位=${fixed(value, 16)}`);
  if (result) {
    record('结果 8 位补码', result.twos === fixed(value, bits), `结果=${result.twos}`);
    record('结果 16 位补码', result.twos16 === fixed(value, 16), `结果=${result.twos16}`);
    record('结果补码回读', Number(result.readBack) === value, `结果=${result.readBack}`);
  }

  return finish(valueA, valueB, valueC);
}

function runAdd(input: Input, result?: Input): D6PathsResult {
  const a = num(input, 'a');
  const b = num(input, 'b');
  const bits = num(input, 'bits', 4);
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('add 只接受整数');
  const mod = 2 ** bits;
  const min = -(2 ** (bits - 1));
  const max = 2 ** (bits - 1) - 1;
  if (a < min || a > max || b < min || b > max) throw new Error('加数超出补码范围');

  const valueA = a + b;

  // B：两个加数分别除基取余，再按二进制加法逐位相加。
  const aDigits = divisionDigits(((a % mod) + mod) % mod, 2);
  const bDigits = divisionDigits(((b % mod) + mod) % mod, 2);
  const width = Math.max(aDigits.length, bDigits.length, bits);
  const paddedA = [...aDigits, ...Array(width - aDigits.length).fill(0)];
  const paddedB = [...bDigits, ...Array(width - bDigits.length).fill(0)];
  const sumDigits: number[] = [];
  let carry = 0;
  for (let index = 0; index < width; index += 1) {
    const total = paddedA[index] + paddedB[index] + carry;
    sumDigits.push(total % 2);
    carry = Math.floor(total / 2);
  }
  if (carry > 0) sumDigits.push(carry);
  const raw = placeValue(sumDigits, 2);
  const valueB = signedBits(fixed(raw, bits));

  // C：模 2ⁿ 加法 + 两条溢出判据。
  const ua = ((a % mod) + mod) % mod;
  const ub = ((b % mod) + mod) % mod;
  const unsignedSum = ua + ub;
  const rawC = unsignedSum % mod;
  const valueC = signedBits(fixed(rawC, bits));
  const carryOut = unsignedSum >= mod ? 1 : 0;
  const lowerMask = 2 ** (bits - 1) - 1;
  const carryIn = ((ua & lowerMask) + (ub & lowerMask)) >= 2 ** (bits - 1) ? 1 : 0;
  const overflowCarry = carryIn !== carryOut;
  const sumSigned = signedBits(fixed(rawC, bits));
  const overflowSign = a >= 0 === b >= 0 && (sumSigned >= 0) !== (a >= 0);
  record('溢出双判据', overflowCarry === overflowSign, `carry=${carryIn}/${carryOut}，sign=${overflowSign}`);
  record('逐位加法与取模一致', raw % mod === rawC, `${raw} vs ${rawC}`);
  if (result) {
    record('结果和位串', result.sumBits === fixed(rawC, bits), `结果=${result.sumBits}`);
    record('结果 carryOut', Number(result.carryOut) === carryOut, `结果=${result.carryOut}`);
    record('结果 overflow', result.overflow === (overflowCarry ? '是' : '否'), `结果=${result.overflow}`);
  }

  return finish(valueA, valueB, valueC);
}

function runBcdAscii(input: Input, result?: Input): D6PathsResult {
  const digit = num(input, 'digit');
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new Error('digit 必须是 0–9');

  const valueA = digit; // BCD 数值位
  const bcdDigits = digit.toString(2).padStart(4, '0').split('').map(Number);
  const valueB = Number.parseInt(bcdDigits.join(''), 2);
  const asciiBits = (0x30 + digit).toString(2).padStart(8, '0');
  const lowNibble = asciiBits.slice(4);
  const highNibble = asciiBits.slice(0, 4);
  record('ASCII 高 4 位为 0011', highNibble === '0011', `高半字节=${highNibble}`);
  const valueC = placeValue(lowNibble.split('').map(Number).reverse(), 2);
  record('ASCII 低 4 位等于 BCD', lowNibble === bcdDigits.join(''), `${lowNibble} vs ${bcdDigits.join('')}`);
  if (result) {
    record('结果 BCD', result.bcd === bcdDigits.join(''), `结果=${result.bcd}`);
    record('结果 ASCII', result.asciiBits === asciiBits, `结果=${result.asciiBits}`);
  }

  return finish(valueA, valueB, valueC);
}

export function runD6Paths(input: Input, result?: Input): D6PathsResult {
  checks.length = 0;
  const op = input.op;
  if (op === 'convert') return runConvert(input, result);
  if (op === 'complement') return runComplement(input, result);
  if (op === 'add') return runAdd(input, result);
  if (op === 'bcd-ascii') return runBcdAscii(input, result);
  throw new Error(`D6 不支持 op=${String(op)}`);
}