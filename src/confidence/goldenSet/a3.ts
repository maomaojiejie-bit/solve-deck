import type { GoldenCase } from './types';

export const A3_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'A3-01',
    templateId: 'A3',
    title: '共射 CE：Av/Ri/Ro',
    input: { config: 'CE' },
    expected: {
      config: 'CE',
      Av: -45.537340619307834,
      Ri: 2600,
      Ro: 1960.7843137254902,
    },
    residualThreshold: 1e-9,
    handCheck: 'gm=38.46mS，rπ=2.6k，ro=100k；闭式 Av=-gm(Rc∥Rl∥ro)·rπ/(Rs+rπ)，Ri=rπ，Ro=Rc∥ro。',
    provenance: 'self-authored',
  },
  {
    id: 'A3-02',
    templateId: 'A3',
    title: '共基 CB：同相、低输入阻抗',
    input: { config: 'CB' },
    expected: {
      config: 'CB',
      Av: 1.6078351947225273,
      Ri: 26.16056583357525,
      Ro: 1998.6113521957993,
    },
    residualThreshold: 1e-9,
    handCheck: 'CB 闭式：k=(1+gm·ro)RcL/(RcL+ro)，Ri=1/(1/rπ+gm+(1-gm·RcL)/(RcL+ro))，Ro=Rc∥[ro+(rπ∥Rs)(1+gm·ro)]。',
    provenance: 'self-authored',
  },
  {
    id: 'A3-03',
    templateId: 'A3',
    title: '共集 CC：电压跟随、低输出阻抗',
    input: { config: 'CC' },
    expected: {
      config: 'CC',
      Av: 0.9619414072917063,
      Ri: 93590.99099099099,
      Ro: 34.4049849000344,
    },
    residualThreshold: 1e-9,
    handCheck: 'CC 闭式：Reff=Re∥Rl∥ro，Av=(β+1)Reff/(Rs+rπ+(β+1)Reff)，Ri=rπ+(β+1)Reff，Ro=(Rs+rπ)/(β+1)∥Re∥ro。',
    provenance: 'self-authored',
  },
];