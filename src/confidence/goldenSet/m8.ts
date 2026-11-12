import type { GoldenCase } from './types';

/**
 * M8 组合变形：悬臂圆轴 Φ120、L=2m、Pn=50kN、Pt=10kN、T=0.5kN·m
 * → σN=−4.421、σM=117.893、σmax=122.314、τ=1.474、σr4=122.340 MPa，中性轴 y=−2.25mm。
 */
export const M8_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M8-01',
    templateId: 'M8',
    title: 'Φ120 悬臂轴：Pn=50kN、Pt=10kN、T=0.5kN·m',
    input: { L: 2, d: 120, Pn: 50, Pt: 10, T: 0.5, allow: 160 },
    expected: {
      A: 11309.734,
      W: 169646.003,
      N: -50,
      M: 20,
      sigmaN: -4.420971,
      sigmaM: 117.89255,
      sigmaMax: 122.313521,
      tau: 1.473657,
      sigmaR4: 122.340151,
      neutralAxis: -2.25,
      status: 'ok',
    },
    residualThreshold: 1e-6,
    handCheck:
      'W=πd³/32=1.696e-4 m³ ⇒ σM=20/1.696e-4=117.89MPa；σN=−50/(1.131e-2)=−4.42MPa；σr4=√(122.31²+3·1.474²)=122.34MPa。',
    provenance: 'self-authored',
  },
  {
    id: 'M8-02',
    templateId: 'M8',
    title: 'Φ60 细轴过载：σr4 远超许用（红字超限）',
    input: { L: 1.5, d: 60, Pn: 80, Pt: 20, T: 1.2, allow: 160 },
    expected: { sigmaMax: 1443.004817, sigmaR4: 1443.83676, tau: 28.294212, status: 'over' },
    residualThreshold: 1e-6,
    handCheck: 'W=2.121e-5 m³ ⇒ σM=30/2.121e-5=1414.7MPa，加轴向 −28.3 ⇒ σr4=1443.8MPa ≫ 160MPa。',
    provenance: 'self-authored',
  },
];
