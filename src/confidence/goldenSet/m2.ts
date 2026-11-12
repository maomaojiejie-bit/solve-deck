import type { GoldenCase } from './types';

/** M2 扭转：d=40mm、T=1kN·m → τmax=79.58MPa、φ=0.049736rad。 */
export const M2_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M2-01',
    templateId: 'M2',
    title: 'Φ40 实心轴：T=1kN·m、G=80GPa、L=1m',
    input: { L: 1, d: 40, T: 1, G: 80, allow: 40 },
    expected: { tauMax: 79.57747154594767, phiPerRad: 0.04973592545723384, status: 'over' },
    residualThreshold: 1e-6,
    handCheck: 'Wp=πd³/16=1.2566e-5m³，τ=T/Wp=79.577MPa；Ip=πd⁴/32=2.5133e-7m⁴，φ=TL/(GIp)=0.049736rad。',
    provenance: 'self-authored',
  },
];
