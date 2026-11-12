import type { GoldenCase } from './types';

/** S7 虚位移：支点 O、左臂 0.4 m 挂 100 N、右臂 0.6 m → F=66.67 N。 */
export const S7_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S7-01',
    templateId: 'S7',
    title: '杠杆 a=0.4 m、b=0.6 m、W=100 N',
    input: { a: 0.4, b: 0.6, W: 100 },
    expected: { F: 66.666667, ratio: 0.666667, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: '虚功：100×0.4δθ=F×0.6δθ ⇒ F=66.667 N；位移比 δ₁/δ₂=a/b=0.667。',
    provenance: 'self-authored',
  },
  {
    id: 'S7-02',
    templateId: 'S7',
    title: '费力杠杆 a=1.2 m、b=0.3 m、W=50 N',
    input: { a: 1.2, b: 0.3, W: 50 },
    expected: { F: 200, ratio: 4 },
    residualThreshold: 1e-6,
    handCheck: 'F=50×1.2/0.3=200 N；位移比 4（力臂短 4 倍 ⇒ 力大 4 倍）。',
    provenance: 'self-authored',
  },
];
