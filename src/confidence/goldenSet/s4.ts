import type { GoldenCase } from './types';

/** S4 摩擦：μ=0.3、W=200 N、α=30° → P_crit=59.05 N、φf=16.70°（文档 §3 标准答案）。 */
export const S4_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S4-01',
    templateId: 'S4',
    title: '水平面斜拉：μ=0.3、W=200 N、α=30°',
    input: { mu: 0.3, W: 200, alpha: 30, beta: 10 },
    expected: {
      Pcrit: 59.053642,
      phiF: 16.699244,
      Pmin: 57.469577,
      N: 170.473179,
      friction: 51.141954,
      selfLock: 1,
      status: 'ok',
    },
    residualThreshold: 1e-6,
    handCheck: 'P=0.3×200/(cos30°+0.3sin30°)=60/1.016=59.054 N；φf=arctan0.3=16.699°；N=200−P sin30°=170.47 N。',
    provenance: 'self-authored',
  },
  {
    id: 'S4-02',
    templateId: 'S4',
    title: 'μ=0.5、W=150 N、α=20°、斜面 β=30°（不满足自锁）',
    input: { mu: 0.5, W: 150, alpha: 20, beta: 30 },
    expected: { Pcrit: 67.524821, phiF: 26.565051, selfLock: 0 },
    residualThreshold: 1e-6,
    handCheck: 'φf=arctan0.5=26.565°，β=30° > φf ⇒ 不自锁；P=75/(cos20°+0.5sin20°)=67.525 N。',
    provenance: 'self-authored',
  },
];
