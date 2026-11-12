import type { GoldenCase } from './types';

export const A7_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A7-01',
    templateId: 'A7',
    title: '电压串联负反馈：T≈990 的闭环增益',
    input: {},
    expected: {
      T: 990.09900990099,
      AfLoop: 99.89910190707386,
      AfMNA: 99.89910190707384,
      AfDeep: 100,
      errorAtT1000: 0.001000000000000224,
    },
    residualThreshold: 5e-3,
    handCheck: 'A′=A·Rl/(Rout+Rl)=9.99e4，T=A′β=990.1，Af=A′/(1+T)=99.899。',
    provenance: 'self-authored',
  },
];