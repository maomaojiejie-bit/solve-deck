import type { GoldenCase } from './types';

/**
 * M6 应力状态：**默认工况就是文档 §2 那张表**（σx=100、σy=−20、τxy=40）
 * → σ1=112.111、σ2=−32.111、τmax=72.111、θp=16.845°。
 * 第二道两个主应力都为压，钉住符号与 θp 落在第二象限的处理。
 */
export const M6_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'M6-01',
    templateId: 'M6',
    title: '拉-压-剪：σx=100、σy=−20、τxy=40 MPa（文档 §2 标准答案）',
    input: { sx: 100, sy: -20, txy: 40, allow: 160 },
    expected: {
      center: 40,
      radius: 72.11102550927978,
      sigma1: 112.11102550927978,
      sigma2: -32.111025509279784,
      tauMax: 72.11102550927978,
      thetaP: 16.845033762989893,
      sigmaR4: 131.14877048604,
      status: 'ok',
    },
    residualThreshold: 1e-6,
    handCheck:
      'C=(100−20)/2=40，R=√(60²+40²)=72.111；σ1,2=C±R=112.111/−32.111；θp=½atan2(80,120)=16.845°；σr4=√(σ1²+σ2²−σ1σ2)=131.149MPa。',
    provenance: 'self-authored',
  },
  {
    id: 'M6-02',
    templateId: 'M6',
    title: '压-压-剪：σx=−60、σy=−20、τxy=35 MPa',
    input: { sx: -60, sy: -20, txy: 35, allow: 160 },
    expected: {
      center: -40,
      radius: 40.311289,
      sigma1: 0.311289,
      sigma2: -80.311289,
      thetaP: 59.872441,
      sigmaR4: 80.467385,
    },
    residualThreshold: 1e-6,
    handCheck: 'C=−40，R=√(20²+35²)=40.311；σ1=0.311（接近单向拉伸）；θp=59.87°。',
    provenance: 'self-authored',
  },
];
