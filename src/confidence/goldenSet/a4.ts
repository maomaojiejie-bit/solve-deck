import type { GoldenCase } from './types';

export const A4_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A4-01',
    templateId: 'A4',
    title: '共源分压偏置饱和区',
    input: {},
    expected: {
      zone: 'saturation',
      ID: 0.0010814037230204771,
      VGS: 2.918596276979523,
      VDS: 8.755788830938569,
      VOV: 1.9185962769795228,
    },
    residualThreshold: 1e-6,
    handCheck: 'VG=4V；ID≈1.081mA，VGS=2.919V，VDS=8.756V>VOV=1.919V，饱和成立。',
    provenance: 'self-authored',
  },
  {
    id: 'A4-02',
    templateId: 'A4',
    title: '强栅压进入三极管区',
    input: { Rg1: 1000000, Rg2: 1000000, Rd: 4700, Rs: 1000, Kn: 0.001 },
    expected: {
      zone: 'triode',
      ID: 0.0019766234046268293,
      VGS: 4.023376595373171,
      VDS: 0.733246593627074,
      VOV: 3.023376595373171,
    },
    residualThreshold: 1e-6,
    handCheck: 'VG=6V，ID≈1.977mA，VDS=0.733V<VOV=3.023V，进入三极管区。',
    provenance: 'self-authored',
  },
  {
    id: 'A4-03',
    templateId: 'A4',
    title: '栅压低于阈值进入截止区',
    input: { Rg1: 2000000, Rg2: 100000 },
    expected: {
      zone: 'cutoff',
      ID: 0,
      VGS: 0.5714285714285714,
      VDS: 12,
      VOV: -0.4285714285714286,
    },
    residualThreshold: 1e-6,
    handCheck: 'VG=0.571V<Vth=1V，沟道未开启，ID=0，VDS=VDD=12V。',
    provenance: 'self-authored',
  },
];