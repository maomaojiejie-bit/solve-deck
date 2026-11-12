import type { GoldenCase } from './types';

/**
 * S5 桁架：A(0,0) pin / B(2,0) roller / C(1,1)，10 kN 竖直向下作用在 C
 * → RA=RB=5、N_AC=N_BC=−7.071 kN（压）、N_AB=+5.000 kN（拉）（文档 §3 标准答案）。
 */
export const S5_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S5-01',
    templateId: 'S5',
    title: '三角桁架 L=2 m、H=1 m，顶点 C 受 10 kN',
    input: { L: 2, H: 1, P: 10 },
    expected: { RA: 5, RB: 5, N_AB: 5, N_AC: -7.071068, N_BC: -7.071068, zeroMembers: 0, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: '反力各 5 kN；节点 C：N_AC=N_BC=−P/(2sin45°)=−7.071 kN；节点 A：N_AB=−N_AC cos45°=+5 kN。',
    provenance: 'self-authored',
  },
  {
    id: 'S5-02',
    templateId: 'S5',
    title: '扁桁架 L=4 m、H=1.5 m，顶点 C 受 24 kN',
    input: { L: 4, H: 1.5, P: 24 },
    expected: { RA: 12, RB: 12, N_AB: 16, N_AC: -20, N_BC: -20 },
    residualThreshold: 1e-6,
    handCheck: 'θ=atan(1.5/2)=36.87°；N_AC=−12/sinθ=−20 kN；N_AB=−N_AC cosθ=16 kN。',
    provenance: 'self-authored',
  },
];
