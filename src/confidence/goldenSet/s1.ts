import type { GoldenCase } from './types';

/**
 * S1 三个组态各一道：静定（给反力）、静不定（拒绝）、机构（拒绝）。
 * 判据是约束矩阵的秩，不是「数一数」——夹具只钉结论与计数，不钉内部实现。
 */
export const S1_GOLDEN: GoldenCase<Record<string, number | string>>[] = [
  {
    id: 'S1-01',
    templateId: 'S1',
    title: 'pin@A + roller@B，P=10 kN @x=2（静定）',
    input: { L: 4, a: 2, P: 10, config: 'static' },
    expected: { config: 'static', unknownCount: 3, equationCount: 3, rank: 3, RA: 5, RB: 5, status: 'ok' },
    residualThreshold: 1e-6,
    handCheck: '未知量 2+1=3 = 3 方程，rank=3 ⇒ 静定；对 A 取矩 RB·4=10×2 ⇒ RB=5，ΣFy ⇒ RA=5。',
    provenance: 'self-authored',
  },
  {
    id: 'S1-02',
    templateId: 'S1',
    title: 'pin@A + pin@B（4 未知量 > 3 方程 ⇒ 静不定，拒绝）',
    input: { L: 4, a: 2, P: 10, config: 'indeterminate' },
    expected: { unknownCount: 4, equationCount: 3, rank: 3, status: 'indeterminate' },
    residualThreshold: 1e-6,
    handCheck: '两端固定铰各 2 个未知量 = 4 > 3；只能给判据，反力需要变形协调。',
    provenance: 'self-authored',
  },
  {
    id: 'S1-03',
    templateId: 'S1',
    title: '两个平行可动铰（rank=2 < 3 ⇒ 机构，拒绝）',
    input: { L: 4, a: 2, P: 10, config: 'mechanism' },
    expected: { unknownCount: 2, equationCount: 3, rank: 2, status: 'out-of-scope' },
    residualThreshold: 1e-6,
    handCheck: '两个竖向反力方向相同，约束矩阵秩 2 ⇒ 缺水平约束，几何可变。',
    provenance: 'self-authored',
  },
];
