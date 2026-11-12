import type { GoldenCase } from './types';

/** S2 汇交力系：F1=100@30°、F2=100@150° → R=100 N @90°（文档 §3 标准答案）。 */
export const S2_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S2-01',
    templateId: 'S2',
    title: 'F1=100 N@30°、F2=100 N@150°（对称，合力竖直）',
    input: { F1: 100, th1: 30, F2: 100, th2: 150 },
    expected: { Rx: 0, Ry: 100, R: 100, thetaR: 90, Feq: 100, FeqAngle: 270, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: '两力夹角 120°，对称轴 90°：R=2×100×cos60°=100 N，方向 90°。',
    provenance: 'self-authored',
  },
  {
    id: 'S2-02',
    templateId: 'S2',
    title: '正交两力：80 N@0° 与 60 N@90°',
    input: { F1: 80, th1: 0, F2: 60, th2: 90 },
    expected: { R: 100, thetaR: 36.869898, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'R=√(80²+60²)=100 N，θ=arctan(60/80)=36.8699°。',
    provenance: 'self-authored',
  },
];
