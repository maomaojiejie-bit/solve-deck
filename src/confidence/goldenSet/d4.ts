import type { GoldenCase } from './types';

type D4Input = Record<string, number | string>;

export const D4_GOLDEN: GoldenCase<D4Input>[] = [
  {
    id: 'D4-01',
    templateId: 'D4',
    title: 'JK 触发器 4 拍激励（置位/复位/置位/翻转）',
    input: { ff: 'JK', q0: 0, j: '1011', k: '0101' },
    expected: {
      ff: 'JK',
      q0: 0,
      sequence: '1010',
      finalQ: 0,
      ticks: 4,
      invalidTicks: 0,
    },
    residualThreshold: 0,
    handCheck:
      'Q0=0；t1 J1K0 置 1；t2 J0K1 清 0；t3 J1K0 置 1；t4 J1K1 翻转回 0，故序列 1010。',
    provenance: 'self-authored',
  },
];