import type { GoldenCase } from './types';

export const A6_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A6-01',
    templateId: 'A6',
    title: '反相运放：Aol=1e6 的有限增益修正',
    input: {},
    expected: {
      topology: 'inverting',
      AvIdeal: -10,
      AvFinite: -9.999889846163345,
      lastSweepError: 0.0000011015492866306432,
      Vout: -0.9999889846163346,
    },
    residualThreshold: 1e-3,
    handCheck: 'Av=-R2/R1=-10；有限增益误差≈1/(Aol·β)≈1.1e-5。',
    provenance: 'self-authored',
  },
];