import type { GoldenCase } from './types';

/** S6 形心：T 形（翼缘 100×20 @y=0.11、腹板 20×100 @y=0.05）→ A=0.0040 m²、ȳ=0.0800 m。 */
export const S6_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S6-01',
    templateId: 'S6',
    title: 'T 形截面：翼缘 100×20、腹板 20×100（mm）',
    input: { bf: 100, tf: 20, bw: 20, hw: 100 },
    expected: { A_mm2: 4000, 'A_m2': 0.004, ybar_mm: 80, 'ybar_m': 0.08, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'A=100×20+20×100=4000 mm²；ȳ=(2000×110+2000×50)/4000=80 mm=0.08 m。',
    provenance: 'self-authored',
  },
  {
    id: 'S6-02',
    templateId: 'S6',
    title: '窄腹板 T 形：160×12 + 10×180（mm）',
    input: { bf: 160, tf: 12, bw: 10, hw: 180 },
    expected: { A_mm2: 3720, 'A_m2': 0.00372, ybar_mm: 139.548387 },
    residualThreshold: 1e-6,
    handCheck: 'A=160×12+10×180=3720 mm²；ȳ=(1920×186+1800×90)/3720=139.548 mm。',
    provenance: 'self-authored',
  },
];
