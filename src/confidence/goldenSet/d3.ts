import type { GoldenCase } from './types';

type D3Input = Record<string, number | string>;

export const D3_GOLDEN: GoldenCase<D3Input>[] = [
  {
    id: 'D3-01',
    templateId: 'D3',
    title: '全加器本位和由真值表综合',
    input: { op: 'adder-sum' },
    expected: {
      op: 'adder-sum',
      minterms: 'Σm(1,2,4,7)',
      gateCount: 10,
      inputs: 'ABC',
    },
    residualThreshold: 0,
    handCheck:
      'S=A⊕B⊕C 在 A/B/C 为 001,010,100,111 时为 1；四项无法合并，三变量各需一个非门（3），四个三输入与门（4），三输入或链（3），共 10 个门。',
    provenance: 'self-authored',
  },
];