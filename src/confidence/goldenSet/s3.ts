import type { GoldenCase } from './types';

/** S3 任意力系：L=3、P1=10@1、P2=20@2 → RA=13.333、RB=16.667（文档 §3 标准答案）。 */
export const S3_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S3-01',
    templateId: 'S3',
    title: '简支 L=3 m，P1=10 kN@1 m、P2=20 kN@2 m',
    input: { L: 3, x1: 1, P1: 10, x2: 2, P2: 20 },
    expected: { RA: 13.333333, RB: 16.666667, RAx: 0, Fy: -30, MA: -50, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'RB=(10×1+20×2)/3=16.667 kN；RA=30−16.667=13.333 kN；主矩 M_A=−50 kN·m（顺时针）。',
    provenance: 'self-authored',
  },
  {
    id: 'S3-02',
    templateId: 'S3',
    title: '简支 L=6 m，P1=8 kN@1.5 m、P2=30 kN@4.5 m',
    input: { L: 6, x1: 1.5, P1: 8, x2: 4.5, P2: 30 },
    expected: { RA: 13.5, RB: 24.5 },
    residualThreshold: 1e-6,
    handCheck: 'RB=(8×1.5+30×4.5)/6=24.5 kN；RA=38−24.5=13.5 kN。',
    provenance: 'self-authored',
  },
];
