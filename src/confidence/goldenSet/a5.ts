import type { GoldenCase } from './types';

export const A5_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A5-01',
    templateId: 'A5',
    title: '共源 CS：反相放大',
    input: { config: 'CS' },
    expected: {
      config: 'CS',
      Av: -1.6661112962345885,
      Ri: '∞',
      Ro: 1999.200319872051,
    },
    residualThreshold: 1e-9,
    handCheck: 'CS 闭式：Av=-gm(Rd∥Rl∥ro)，Ri=∞，Ro=Rd∥ro。',
    provenance: 'self-authored',
  },
  {
    id: 'A5-02',
    templateId: 'A5',
    title: '共栅 CG：低输入阻抗',
    input: { config: 'CG' },
    expected: {
      config: 'CG',
      Av: 0.8332777925886429,
      Ri: 1000.133306671999,
      Ro: 1999.600119964011,
    },
    residualThreshold: 1e-9,
    handCheck: 'CG 闭式：k=(1+gm·ro)RdL/(RdL+ro)，Ri=(RdL+ro)/(1+gm·ro)，Ro=Rd∥[ro+Rs(1+gm·ro)]。',
    provenance: 'self-authored',
  },
  {
    id: 'A5-03',
    templateId: 'A5',
    title: '共漏 CD：电压跟随',
    input: { config: 'CD' },
    expected: {
      config: 'CD',
      Av: 0.47614512903533,
      Ri: '∞',
      Ro: 499.95000499950004,
    },
    residualThreshold: 1e-9,
    handCheck: 'CD 闭式：Reff=Rss∥Rl∥ro，Av=gm·Reff/(1+gm·Reff)，Ro=(1/gm)∥Rss∥ro。',
    provenance: 'self-authored',
  },
];