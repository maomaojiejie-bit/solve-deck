import type { GoldenCase } from './types';

/**
 * M5 弯曲变形：简支 L=4、P=20@2、100×200、E=200GPa → δmax=2.000mm（跨中）。
 * 第二道把载荷挪到 L/4 侧，钉住「最大挠度不一定在跨中」。
 * 期望值来源：fixtures/mech-self/M5-0x.json（脚本按教科书公式独立算）。
 */
export const M5_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M5-01',
    templateId: 'M5',
    title: '简支梁 L=4m，P=20kN 作用于跨中',
    input: { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 },
    expected: { Iy: 66666666.667, deltaMax: 2, deltaMaxX: 2, deltaAllow: 10, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: 'I=bh³/12=6.667e-5 m⁴；δ=PL³/(48EI)=20e3·64/(48·1.333e7)=2.000mm；[δ]=L/400=10mm。',
    provenance: 'self-authored',
  },
  {
    id: 'M5-02',
    templateId: 'M5',
    title: 'L=6.5m，P=45kN 作用于 x=1.7m（偏置）',
    input: { L: 6.5, a: 1.7, P: 45, b: 60, h: 120, E: 210 },
    expected: { deltaMax: 102.753007, deltaMaxX: 2.877846, deltaAllow: 16.25 },
    residualThreshold: 1e-6,
    handCheck: 'a<b ⇒ x*=L−√((L²−a²)/3)=2.8778m，δ=Pa(L²−a²)^{3/2}/(9√3LEI)=102.753mm。',
    provenance: 'self-authored',
  },
];
