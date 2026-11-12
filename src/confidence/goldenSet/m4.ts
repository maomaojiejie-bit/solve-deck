import type { GoldenCase } from './types';

/** M4 弯曲应力：rect 100×200、M=20kN·m → W=6.6667e-4m³、σ=30MPa。 */
export const M4_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M4-01',
    templateId: 'M4',
    title: '简支 L=4、P=20@2，矩形 100×200mm',
    input: { L: 4, a: 2, P: 20, b: 100, h: 200, allow: 160 },
    expected: { W: 666666.667, Mmax: 20, sigmaMax: 30, neutralAxis: 0, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'W=bh²/6=6.6667e-4m³；σ=M/W=20e3/6.6667e-4=30MPa。',
    provenance: 'self-authored',
  },
  {
    id: 'M4-02',
    templateId: 'M4',
    title: '截面高度减半：W 降为 1/4、σ 升 4 倍',
    input: { L: 4, a: 2, P: 20, b: 100, h: 100, allow: 160 },
    expected: { W: 166666.667, sigmaMax: 120 },
    residualThreshold: 1e-6,
    handCheck: 'W=bh²/6=1.6667e-4m³；σ=20e3/1.6667e-4=120MPa。',
    provenance: 'self-authored',
  },
];
