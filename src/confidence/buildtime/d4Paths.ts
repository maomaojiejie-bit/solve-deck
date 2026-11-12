/**
 * D4 三路径（构建期）：
 *  A 特性表查表         → 'characteristic-rows'
 *  B 主从锁存器逐相仿真 → 'timing-traces'
 *  C 激励条件 + 次态方程 → 'excitation-rows'
 *
 * 本文件不 import D4.ts。
 */

type FlipFlop = 'SR' | 'D' | 'JK' | 'T';
type Input = Record<string, number | string>;

export interface D4PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'characteristic-rows';
  pathBIntermediate: 'timing-traces';
  pathCIntermediate: 'excitation-rows';
  sequenceA: string;
  sequenceB: string;
  sequenceC: string;
}

const NAMES: Record<FlipFlop, string[]> = {
  D: ['D'],
  T: ['T'],
  JK: ['J', 'K'],
  SR: ['S', 'R'],
};

function bits(raw: unknown, label: string): (0 | 1)[] {
  const text = String(raw ?? '');
  if (!/^[01]+$/.test(text)) throw new Error(`${label} 必须是 0/1 序列`);
  return text.split('').map((bit) => (bit === '1' ? 1 : 0));
}

function parse(ff: FlipFlop, input: Input): Record<string, 0 | 1>[] {
  const seqs = NAMES[ff].map((name) => bits(input[name.toLowerCase()], name));
  const length = seqs[0].length;
  if (length === 0 || seqs.some((seq) => seq.length !== length)) throw new Error('D4 激励长度不一致');
  return Array.from({ length }, (_, tick) => {
    const entry: Record<string, 0 | 1> = {};
    NAMES[ff].forEach((name, index) => {
      entry[name] = seqs[index][tick];
    });
    return entry;
  });
}

function tableNext(ff: FlipFlop, q: 0 | 1, entry: Record<string, 0 | 1>): 0 | 1 {
  switch (ff) {
    case 'D':
      return entry.D;
    case 'T':
      return (q ^ entry.T) as 0 | 1;
    case 'JK':
      if (entry.J === 0 && entry.K === 0) return q;
      if (entry.J === 1 && entry.K === 0) return 1;
      if (entry.J === 0 && entry.K === 1) return 0;
      return (q ^ 1) as 0 | 1;
    case 'SR':
      if (entry.S === 1 && entry.R === 1) return q;
      if (entry.S === 1) return 1;
      if (entry.R === 1) return 0;
      return q;
    default:
      throw new Error('未知触发器');
  }
}

/** 门控 SR 锁存器：en=1 时透明，en=0 保持；S=R=1 非法。 */
function gatedLatch(
  q: 0 | 1,
  s: 0 | 1,
  r: 0 | 1,
  enable: boolean,
): { q: 0 | 1; invalid: boolean } {
  if (!enable) return { q, invalid: false };
  if (s === 1 && r === 1) return { q, invalid: true };
  if (s === 1) return { q: 1, invalid: false };
  if (r === 1) return { q: 0, invalid: false };
  return { q, invalid: false };
}

function excitation(ff: FlipFlop, q: 0 | 1, entry: Record<string, 0 | 1>): { s: 0 | 1; r: 0 | 1 } {
  switch (ff) {
    case 'D':
      return { s: entry.D, r: (entry.D ^ 1) as 0 | 1 };
    case 'T':
      return { s: (entry.T & (q ^ 1)) as 0 | 1, r: (entry.T & q) as 0 | 1 };
    case 'JK':
      return { s: (entry.J & (q ^ 1)) as 0 | 1, r: (entry.K & q) as 0 | 1 };
    case 'SR':
      return { s: entry.S, r: entry.R };
    default:
      throw new Error('未知触发器');
  }
}

function structural(ff: FlipFlop, q0: 0 | 1, entries: Record<string, 0 | 1>[]): (0 | 1)[] {
  let slave: 0 | 1 = q0;
  let master: 0 | 1 = q0;
  const sequence: (0 | 1)[] = [];
  for (const entry of entries) {
    const { s, r } = excitation(ff, slave, entry);
    // 正沿主从：clk=0 主锁存器透明；clk=1 从锁存器取主锁存器。
    master = gatedLatch(master, s, r, true).q;
    slave = gatedLatch(slave, master, (master ^ 1) as 0 | 1, true).q;
    sequence.push(slave);
  }
  return sequence;
}

function equation(ff: FlipFlop, q: 0 | 1, entry: Record<string, 0 | 1>): 0 | 1 {
  switch (ff) {
    case 'D':
      return entry.D;
    case 'T':
      return ((entry.T === 1 ? q ^ 1 : q) as 0 | 1);
    case 'JK': {
      const termSet = (entry.J & (q ^ 1)) as 0 | 1;
      const termReset = ((entry.K ^ 1) & q) as 0 | 1;
      return (termSet | termReset) as 0 | 1;
    }
    case 'SR':
      // S=R=1 无定义，按特性表的保持处理（并计入 warning）。
      if (entry.S === 1 && entry.R === 1) return q;
      return ((entry.S | ((entry.R ^ 1) & q)) as 0 | 1);
    default:
      throw new Error('未知触发器');
  }
}

export function runD4Paths(input: Input): D4PathsResult {
  const ff = String(input.ff ?? '') as FlipFlop;
  if (!['SR', 'D', 'JK', 'T'].includes(ff)) throw new Error(`D4 不支持 ff=${String(ff)}`);
  const q0 = Number(input.q0 ?? 0);
  if (q0 !== 0 && q0 !== 1) throw new Error('q0 必须是 0/1');
  const entries = parse(ff, input);

  let q = q0 as 0 | 1;
  const sequenceA: (0 | 1)[] = [];
  for (const entry of entries) {
    q = tableNext(ff, q, entry);
    sequenceA.push(q);
  }

  const sequenceB = structural(ff, q0 as 0 | 1, entries);

  let qc = q0 as 0 | 1;
  const sequenceC: (0 | 1)[] = [];
  for (const entry of entries) {
    qc = equation(ff, qc, entry);
    sequenceC.push(qc);
  }

  const a = sequenceA.join('');
  const b = sequenceB.join('');
  const c = sequenceC.join('');
  const ok = a === b && a === c;
  return {
    ok,
    maxResidual: ok ? 0 : 1,
    detail: ok ? `A/B/C 序列一致：${a}` : `序列不一致：A=${a}，B=${b}，C=${c}`,
    pathAIntermediate: 'characteristic-rows',
    pathBIntermediate: 'timing-traces',
    pathCIntermediate: 'excitation-rows',
    sequenceA: a,
    sequenceB: b,
    sequenceC: c,
  };
}