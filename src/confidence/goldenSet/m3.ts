import type { GoldenCase } from './types';

/** M3 弯曲内力：简支 L=4、P=20@2 → RA=RB=10kN、Mmax=20@2；加均布 q=5 → Mmax=10@2。 */
export const M3_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M3-01',
    templateId: 'M3',
    title: '简支梁 L=4m，P=20kN 作用于跨中',
    input: { L: 4, a: 2, P: 20, q: 0 },
    expected: { RA: 10, RB: 10, Mmax: 20, MmaxX: 2, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'RA=RB=10kN；M(2)=10·2=20kN·m，Q 在 x=2 变号。',
    provenance: 'self-authored',
  },
  {
    id: 'M3-02',
    templateId: 'M3',
    title: '简支梁 L=4m，全跨 q=5kN/m',
    input: { L: 4, a: 2, P: 0, q: 5 },
    expected: { RA: 10, RB: 10, Mmax: 10, MmaxX: 2 },
    residualThreshold: 1e-6,
    handCheck: 'R=qL/2=10kN；Mmax=qL²/8=10kN·m @跨中。',
    provenance: 'self-authored',
  },
  {
    id: 'M3-03',
    templateId: 'M3',
    title: '悬臂梁 L=2m，P=10kN 作用于 x=1m（固定端在 x=0）',
    input: { config: 'cantilever', L: 2, a: 1, P: 10, q: 0 },
    expected: { config: 'cantilever', RA: 10, MA: 10, Mmax: 10, MmaxX: 0, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'R=P=10kN，M_A=P·a=10kN·m；M(0)=−10kN·m（上侧受拉），|M|max=10 在固定端。',
    provenance: 'self-authored',
  },
];
