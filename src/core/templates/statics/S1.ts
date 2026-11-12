/**
 * S1 约束与受力图：**不做数值，做判据**。
 *
 * 三种组态（用变体切换，不做成滑杆 —— 滑杆造不出「机构」）：
 *  · static          pin@A + roller@B      3 未知量、秩 3 ⇒ 静定，给反力
 *  · indeterminate   pin@A + pin@B         4 未知量 > 3 方程 ⇒ 静不定，拒绝
 *  · mechanism       两平行可动铰         秩 2 < 3 ⇒ 机构，拒绝
 *
 * 判据本身来自 `analyzeRigid2D` 的约束矩阵秩，不是「数一数守恒」的拍脑袋结论；
 * 拒绝时 result 里**连反力的键都不写**，只留未知量数、秩与理由。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { Rigid2DSpec } from '../../statics/rigid2d.ts';
import { analyzeRigid2D, supportCriteria, twoForceCheck } from '../../statics/rigid2d.ts';
import { beamFigure } from '../mechanics/common.ts';
import type { ParamRecord } from './common.ts';
import {
  checksMatrix,
  framesFor,
  num,
  pendingConfidence,
  selfCheck,
  step,
} from './common.ts';

export type S1Config = 'static' | 'indeterminate' | 'mechanism';

export interface S1Params {
  L: number;
  /** 载荷作用位置。 */
  a: number;
  /** 集中力，kN，向下。 */
  P: number;
  config: S1Config;
}

export const S1_DEFAULTS: S1Params = { L: 4, a: 2, P: 10, config: 'static' };

const CONFIGS: S1Config[] = ['static', 'indeterminate', 'mechanism'];

/**
 * 拒绝态附带的「怎么改」：反例页要让人看完知道下一步动哪里，
 * 不是只丢一句「静不定」。文案按组态给，不按题目现算 —— 它不是解，是提示。
 */
const REMEDY: Record<Exclude<S1Config, 'static'>, string> = {
  indeterminate: '把一端固定铰换成可动铰（去掉 1 个多余约束），或改用变形协调 / 力法求解。',
  mechanism: '两个可动铰都不能提供水平约束：把 A 换成固定铰（或在 A 处加水平链杆），秩才够 3。',
};

export function s1Params(input: ParamRecord): S1Params {
  const config = String(input.config ?? S1_DEFAULTS.config) as S1Config;
  if (!CONFIGS.includes(config)) throw new Error(`S1 组态必须是 ${CONFIGS.join(' / ')}`);
  const params: S1Params = {
    L: num(input, 'L', S1_DEFAULTS.L),
    a: num(input, 'a', S1_DEFAULTS.a),
    P: num(input, 'P', S1_DEFAULTS.P),
    config,
  };
  if (!(params.L > 0)) throw new Error('S1 跨度 L 必须 > 0');
  if (!(params.a > 0) || params.a >= params.L) throw new Error('S1 载荷位置必须落在 (0, L) 内');
  if (!(params.P > 0)) throw new Error('S1 载荷 P 必须 > 0');
  return params;
}

export function s1Spec(params: S1Params): Rigid2DSpec {
  const supports: Rigid2DSpec['supports'] =
    params.config === 'static'
      ? [
          { at: 'A', kind: 'pin' },
          { at: 'B', kind: 'roller' },
        ]
      : params.config === 'indeterminate'
        ? [
            { at: 'A', kind: 'pin' },
            { at: 'B', kind: 'pin' },
          ]
        : [
            { at: 'A', kind: 'roller' },
            { at: 'B', kind: 'roller' },
          ];
  return {
    bodies: [
      {
        id: 'beam',
        points: [
          { id: 'A', x: 0, y: 0 },
          { id: 'B', x: params.L, y: 0 },
          { id: 'P', x: params.a, y: 0 },
        ],
      },
    ],
    supports,
    loads: [{ at: 'P', F: [0, -params.P] }],
  };
}

export function solveS1(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S1 只接受结构化参数');
  const params = s1Params(input as ParamRecord);
  const spec = s1Spec(params);
  const analysis = analyzeRigid2D(spec);
  const criteria = supportCriteria(spec);
  // 跨中的 P 是杆内点：只看两端会把它误判成二力杆
  const twoForce = twoForceCheck(spec, { from: 'A', to: 'B' }, ['P']);

  const determinate = analysis.verdict === 'determinate';
  const status = determinate ? 'ok' : analysis.verdict === 'indeterminate' ? 'indeterminate' : 'out-of-scope';

  const reactionOf = (id: string) => analysis.reactions.find((item) => item.at === id);
  const ra = reactionOf('A');
  const rb = reactionOf('B');

  /* ── 图：受力图（三个支座图元 + 载荷箭头），支座随组态变 ────────────── */
  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'beam',
    supports: spec.supports.map((item) => ({
      x: item.at === 'A' ? 0 : params.L,
      type: item.kind === 'fixed' ? 'fixed' : item.kind === 'roller' ? 'roller' : 'pin',
    })),
    pointLoads: [{ x: params.a, value: -params.P, label: `P = ${params.P} kN` }],
    // 反力也画成箭头：箭头数 = 载荷数 + 反力数。只画支座图元的话，
    // 读者看不到反力方向 —— 而 S1 讲的就是「约束给出什么样的反力」。
    reactions: determinate
      ? [
          { x: 0, value: ra?.Ry ?? 0, label: `R_A = ${(ra?.Ry ?? 0).toFixed(2)} kN`, side: 'right' },
          { x: params.L, value: rb?.Ry ?? 0, label: `R_B = ${(rb?.Ry ?? 0).toFixed(2)} kN`, side: 'left' },
        ]
      : [],
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0', 'n-sup-1'],
    ['n-sup-0', 'n-sup-1'],
    ['e-member'],
    ['n-sup-0', 'n-sup-1'],
    determinate ? ['n-sup-0', 'n-sup-1', 'n-load-0'] : ['n-sup-0', 'n-sup-1'],
  ]);

  /* ── 校验：判据本身也进表，不通过就是「这条判据没过」 ─────────────── */
  const checks = [
    selfCheck(
      '未知量数 = 独立方程数（3）',
      3,
      analysis.unknownCount,
      Math.abs(analysis.unknownCount - 3) / 3,
      analysis.unknownCount === 3,
      analysis.unknownCount > 3
        ? `多 ${analysis.unknownCount - 3} 个未知量 ⇒ 静不定`
        : analysis.unknownCount < 3
          ? `少 ${3 - analysis.unknownCount} 个未知量 ⇒ 机构`
          : '未知量数恰好等于 3',
    ),
    selfCheck(
      '约束矩阵秩 = 3（约束方向线性无关）',
      3,
      analysis.rank,
      Math.abs(analysis.rank - 3) / 3,
      analysis.rank === 3,
      analysis.rank < 3 ? `秩 ${analysis.rank} ⇒ 约束方向重复/不足，几何可变` : '秩 3 ⇒ 约束独立',
    ),
    selfCheck(
      '二力杆判别：梁 AB 是否二力杆（跨中有载荷 ⇒ 0）',
      0,
      twoForce.isTwoForce ? 1 : 0,
      twoForce.isTwoForce ? 1 : 0,
      !twoForce.isTwoForce,
      twoForce.reason,
    ),
    selfCheck(
      '载荷可平衡性：载荷到约束列空间的投影残差',
      0,
      analysis.loadResidual,
      analysis.loadResidual,
      analysis.loadResidual < 1e-9,
      determinate
        ? '静定体系里任何载荷都能被 3 个独立反力平衡'
        : '机构：载荷落在未被约束的方向上就推得动',
    ),
  ];

  if (determinate) {
    checks.push(
      selfCheck('ΣFx=0 残差', 0, (ra?.Rx ?? 0) + (rb?.Rx ?? 0), Math.abs((ra?.Rx ?? 0) + (rb?.Rx ?? 0)), Math.abs((ra?.Rx ?? 0) + (rb?.Rx ?? 0)) < 1e-12, 'x 向：A 铰提供水平反力，B 辊不提供'),
      selfCheck('ΣFy=0 残差', 0, (ra?.Ry ?? 0) + (rb?.Ry ?? 0) - params.P, Math.abs((ra?.Ry ?? 0) + (rb?.Ry ?? 0) - params.P) / params.P, Math.abs((ra?.Ry ?? 0) + (rb?.Ry ?? 0) - params.P) < 1e-12, 'y 向：两支座反力之和 = P'),
      selfCheck('ΣM_A=0 残差', 0, (rb?.Ry ?? 0) * params.L - params.P * params.a, Math.abs((rb?.Ry ?? 0) * params.L - params.P * params.a) / (params.P * params.L), Math.abs((rb?.Ry ?? 0) * params.L - params.P * params.a) < 1e-12, '对 A 取矩：RB·L = P·a'),
    );
  }

  const steps = [
    step(0, '取隔离体，画受力图', '\\text{隔离体} = \\text{梁} + \\text{支座反力} + \\text{外载}',
      `L=${params.L} m，P=${params.P} kN @ x=${params.a} m，支承：${spec.supports.map((item) => `${item.at}(${item.kind})`).join(' + ')}`,
      `受力图：${spec.supports.length} 个支座图元 + 1 个载荷箭头`, '受力分析', ['e-member', 'n-sup-0', 'n-sup-1']),
    step(1, '清点每个支座的未知量', 'n = \\sum n_i',
      criteria.map((item) => `${item.at}:${item.kind}→${item.unknownCount}${item.directionKnown ? '（方向已知）' : '（方向未知）'}`).join('；'),
      `未知量总数 n = ${analysis.unknownCount}`, '支座约束类型决定未知量个数', []),
    step(2, '二力杆判别', '\\text{两端铰} + \\text{中间无载} \\Rightarrow \\vec R \\parallel \\text{连线}',
      '梁 AB：两端为铰，但跨中作用 P', twoForce.isTwoForce ? '是二力杆（方向已知）' : '不是二力杆（反力方向未知）',
      '二力杆判据', ['e-member']),
    step(3, '静定判据：未知量数 vs 独立方程数', 'n \\overset{?}{=} 3,\\ \\operatorname{rank}A \\overset{?}{=} 3',
      `n=${analysis.unknownCount}，rank A=${analysis.rank}`,
      determinate ? 'n=3 且 rank=3 ⇒ 静定' : analysis.verdict === 'indeterminate' ? 'n>3 ⇒ 静不定，拒绝' : 'rank<3 ⇒ 机构，拒绝',
      '约束矩阵秩 = 独立方程数', []),
    step(4, determinate ? '求支座反力' : '拒绝作答', '\\sum F_x=0,\\ \\sum F_y=0,\\ \\sum M_A=0',
      determinate ? `P=${params.P} kN，L=${params.L} m` : '判据不过 ⇒ 不解',
      determinate
        ? `RA=${(ra?.Ry ?? 0).toFixed(3)} kN，RB=${(rb?.Ry ?? 0).toFixed(3)} kN`
        : '不给反力数字（拒绝理由见结论位）',
      determinate ? '刚体平衡' : '静不定 / 机构一律不给数字', []),
  ];

  return {
    templateId: 'S1',
    subject: 'statics',
    parsed_given: { L: params.L, a: params.a, P: params.P, 组态: params.config },
    steps,
    result: determinate
      ? {
          config: params.config,
          unknownCount: analysis.unknownCount,
          equationCount: analysis.equationCount,
          rank: analysis.rank,
          RA: Number((ra?.Ry ?? 0).toFixed(6)),
          RB: Number((rb?.Ry ?? 0).toFixed(6)),
          status,
          conclusion: `静定：RA=${(ra?.Ry ?? 0).toFixed(3)} kN，RB=${(rb?.Ry ?? 0).toFixed(3)} kN（${analysis.unknownCount} 未知量 = 3 方程）`,
        }
      : {
          config: params.config,
          unknownCount: analysis.unknownCount,
          equationCount: analysis.equationCount,
          rank: analysis.rank,
          status,
          conclusion: analysis.message,
          // 拒绝态只多这一句「怎么办」，仍然一个反力数字都不给
          remedy: REMEDY[params.config === 'indeterminate' ? 'indeterminate' : 'mechanism'],
        },
    render_specs: [
      figure,
      checksMatrix(checks, steps.length, checks.map(() => '本页自算（约束矩阵秩）')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: [
      'S1 只做判据与静定反力，不做变形协调；静不定 / 机构一律拒绝并给出判据理由',
    ],
  };
}
