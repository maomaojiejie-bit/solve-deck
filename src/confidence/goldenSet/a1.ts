import type { GoldenCase } from './types';

export const A1_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A1-01',
    templateId: 'A1',
    title: '串联二极管导通：Vs=5V, R=1k, Vf=0.7V, Rz=10Ω',
    input: { mode: 'series', Vs: 5, R: 1000, Vf: 0.7, Rz: 10 },
    expected: {
      mode: 'series',
      on: '是',
      Vout: 0.7425742574257426,
      I: 0.004257425742574257,
      lower: 0,
      upper: 5,
    },
    residualThreshold: 1e-3,
    handCheck: '导通：I=(5-0.7)/(1000+10)=4.257mA，Vd=0.7+I·10=0.7426V。',
    provenance: 'self-authored',
  },
];