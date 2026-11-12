import type { GoldenCase } from './types';

/**
 * M7 压杆稳定：60×60、L=2m、μ=1 → λ=115.47 > λp=99.35，σcr=148.044MPa。
 * 第二道杆太短（λ=43.3 < λp）⇒ 必须**拒绝给数字**（sigmaCr/pCr 是字符串「—」）。
 */
export const M7_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M7-01',
    templateId: 'M7',
    title: '60×60 方杆，L=2m，两端铰支',
    input: { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 },
    expected: {
      A: 3600,
      Imin: 1080000,
      i: 17.320508,
      lambda: 115.470054,
      lambdaP: 99.345883,
      sigmaCr: 148.044066,
      pCr: 532.958638,
      status: 'ok',
    },
    residualThreshold: 1e-6,
    handCheck: 'i=√(I/A)=√300=17.32mm；λ=2000/17.32=115.47；σcr=π²·200000/115.47²=148.04MPa；Pcr=532.96kN。',
    provenance: 'self-authored',
  },
  {
    id: 'M7-02',
    templateId: 'M7',
    title: '80×80 方杆，L=1m（λ<λp，必须拒绝作答）',
    input: { L: 1, b: 80, h: 80, E: 200, mu: 1, P: 150, sp: 200 },
    expected: {
      A: 6400,
      lambda: 43.30127,
      lambdaP: 99.345883,
      sigmaCr: '—',
      pCr: '—',
      status: 'out-of-scope',
    },
    residualThreshold: 1e-6,
    handCheck: 'λ=43.30 < λp=99.35：欧拉公式前提不成立，σcr / Pcr 一律不给数（黄底写「超出适用范围」）。',
    provenance: 'self-authored',
  },
];
