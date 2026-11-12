import type { GoldenCase } from './types';

/** M1 轴向拉压：标准答案 L=1m、A=200mm²、P=40kN、E=200GPa → N=40kN、σ=200MPa、ΔL=1.000mm。 */
export const M1_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M1-01',
    templateId: 'M1',
    title: 'Φ16 圆杆：P=40kN，A=200mm²，E=200GPa',
    input: { L: 1, A: 200, P: 40, E: 200, allow: 160 },
    expected: { N: 40, sigmaMax: 200, deltaL: 1, status: 'over' },
    residualThreshold: 1e-6,
    handCheck: 'σ=N/A=40e3/2e-4=200MPa；ΔL=NL/(EA)=40e3·1/(200e9·2e-4)=1.000mm；200>160 超限。',
    provenance: 'self-authored',
  },
  {
    id: 'M1-02',
    templateId: 'M1',
    title: '面积加倍、长度加倍：σ 不变、ΔL 加倍',
    input: { L: 2, A: 400, P: 80, E: 200, allow: 160 },
    expected: { sigmaMax: 200, deltaL: 2 },
    residualThreshold: 1e-6,
    handCheck: 'σ=80e3/4e-4=200MPa；ΔL=80e3·2/(200e9·4e-4)=2.000mm。',
    provenance: 'self-authored',
  },
];
