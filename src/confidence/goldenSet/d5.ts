import type { GoldenCase } from './types';

type D5Input = Record<string, number | string>;

export const D5_GOLDEN: GoldenCase<D5Input>[] = [
  {
    id: 'D5-01',
    templateId: 'D5',
    title: '101 序列检测器：输入 1011010',
    input: { kind: 'seq-detector', pattern: '101', input: '1011010' },
    expected: {
      kind: 'seq-detector',
      stateSequence: 'P1→P2→P3→P1→P2→P3→P2',
      outputs: '0010010',
      matches: 2,
      finalState: 'P2',
    },
    residualThreshold: 0,
    handCheck:
      'KMP 前缀状态：1→P1，10→P2，101→P3(输出1)，1011→P1，10110→P2，101101→P3(输出1)，1011010→P2。',
    provenance: 'self-authored',
  },
  {
    id: 'D5-02',
    templateId: 'D5',
    title: '110 序列检测器：输入 1101100',
    input: { kind: 'seq-detector', pattern: '110', input: '1101100' },
    expected: {
      kind: 'seq-detector',
      stateSequence: 'P1→P2→P3→P1→P2→P3→P0',
      outputs: '0010010',
      matches: 2,
      finalState: 'P0',
    },
    residualThreshold: 0,
    handCheck:
      '1→P1，11→P2，110→P3(1)，1101→P1，11011→P2，110110→P3(1)，1101100→P0。',
    provenance: 'self-authored',
  },
  {
    id: 'D5-03',
    templateId: 'D5',
    title: '模 3 计数器 7 拍',
    input: { kind: 'mod3-counter', cycles: 7 },
    expected: {
      kind: 'mod3-counter',
      stateSequence: '1→2→0→1→2→0→1',
      outputs: '0010010',
      matches: 2,
      finalState: '1',
    },
    residualThreshold: 0,
    handCheck: '从 0 起每拍 +1 mod 3，7 拍后状态 7 mod 3=1；状态 0 时 Moore 输出 1。',
    provenance: 'self-authored',
  },
];