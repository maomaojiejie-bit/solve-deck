import type { GoldenCase } from './types';

type D1Input = Record<string, number | string>;

export const D1_GOLDEN: GoldenCase<D1Input>[] = [
  {
    id: 'D1-01',
    templateId: 'D1',
    title: 'Σm(0,1,2,3) 化简为 A′B′',
    input: { variables: 'ABCD', minterms: '0,1,2,3' },
    expected: {
      sop: "F = A'·B'",
      termCount: 1,
      minterms: 'Σm(0,1,2,3)',
      ones: 4,
      zeros: 12,
    },
    residualThreshold: 0,
    handCheck: 'm0–m3 的 A、B 均为 0，C/D 任意，故 F=A′B′。',
    provenance: 'self-authored',
  },
  {
    id: 'D1-02',
    templateId: 'D1',
    title: 'Σm(1,3,5,7) 化简为 A′D',
    input: { variables: 'ABCD', minterms: '1,3,5,7' },
    expected: {
      sop: "F = A'·D",
      termCount: 1,
      minterms: 'Σm(1,3,5,7)',
      ones: 4,
      zeros: 12,
    },
    residualThreshold: 0,
    handCheck: '四个最小项的 A=0、D=1，B/C 任意，故 F=A′D。',
    provenance: 'self-authored',
  },
  {
    id: 'D1-03',
    templateId: 'D1',
    title: 'Σm(1,3,5,7)+Σd(9,11,13,15) 化简为 D',
    input: { variables: 'ABCD', minterms: '1,3,5,7', dontCares: '9,11,13,15' },
    expected: {
      sop: 'F = D',
      termCount: 1,
      minterms: 'Σm(1,3,5,7)',
      dontCares: 'Σd(9,11,13,15)',
      ones: 4,
      zeros: 8,
    },
    residualThreshold: 0,
    handCheck: '四个最小项均 D=1；借助 D=1 的无关项补齐整列，得 F=D。',
    provenance: 'self-authored',
  },
];