/**
 * S3 平面任意力系：简化（主矢 / 主矩）+ 支座反力。
 *
 * 标准答案：L=3 m，pin@0 + roller@3，P1=10 kN@x=1、P2=20 kN@x=2
 * → RA=13.333 kN、RB=16.667 kN。
 *
 * 反力由 `analyzeRigid2D`（约束矩阵 + 三个平衡方程）解出；
 * 主矢 / 主矩是独立的一条路（不经过反力），用来反证平衡：R'+R_反=0、M_A+R_反=0。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { Rigid2DSpec } from '../../statics/rigid2d.ts';
import { analyzeRigid2D } from '../../statics/rigid2d.ts';
import { beamFigure } from '../mechanics/common.ts';
import type { ParamRecord } from './common.ts';
import { checksMatrix, framesFor, num, pendingConfidence, selfCheck, step } from './common.ts';

export interface S3Params {
  /** 跨度，m。 */
  L: number;
  /** 第一个集中力的位置，m。 */
  x1: number;
  /** 第一个集中力，kN，向下。 */
  P1: number;
  x2: number;
  P2: number;
}

export const S3_DEFAULTS: S3Params = { L: 3, x1: 1, P1: 10, x2: 2, P2: 20 };

export function s3Params(input: ParamRecord): S3Params {
  const params: S3Params = {
    L: num(input, 'L', S3_DEFAULTS.L),
    x1: num(input, 'x1', S3_DEFAULTS.x1),
    P1: num(input, 'P1', S3_DEFAULTS.P1),
    x2: num(input, 'x2', S3_DEFAULTS.x2),
    P2: num(input, 'P2', S3_DEFAULTS.P2),
  };
  if (!(params.L > 0)) throw new Error('S3 跨度 L 必须 > 0');
  for (const key of ['x1', 'x2'] as const) {
    if (!(params[key] > 0) || params[key] >= params.L) throw new Error(`S3 ${key} 必须落在 (0, L) 内`);
  }
  if (params.P1 < 0 || params.P2 < 0) throw new Error('S3 集中力不得为负');
  return params;
}

export function s3Spec(params: S3Params): Rigid2DSpec {
  return {
    bodies: [
      {
        id: 'beam',
        points: [
          { id: 'A', x: 0, y: 0 },
          { id: 'B', x: params.L, y: 0 },
          { id: 'P1', x: params.x1, y: 0 },
          { id: 'P2', x: params.x2, y: 0 },
        ],
      },
    ],
    supports: [
      { at: 'A', kind: 'pin' },
      { at: 'B', kind: 'roller' },
    ],
    loads: [
      { at: 'P1', F: [0, -params.P1] },
      { at: 'P2', F: [0, -params.P2] },
    ],
  };
}

export function solveS3(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S3 只接受结构化参数');
  const params = s3Params(input as ParamRecord);
  const analysis = analyzeRigid2D(s3Spec(params));
  if (analysis.verdict !== 'determinate') {
    throw new Error(`${analysis.message}（S3 只挂 pin + roller 的静定梁）`);
  }

  const ra = analysis.reactions.find((item) => item.at === 'A');
  const rb = analysis.reactions.find((item) => item.at === 'B');
  const RA = ra?.Ry ?? 0;
  const RB = rb?.Ry ?? 0;

  // 简化结果（在 A 点）：主矢 = 载荷矢量和；主矩 = 各载荷对 A 的矩之和
  const Fy = -(params.P1 + params.P2);
  const MA = -(params.P1 * params.x1 + params.P2 * params.x2);

  const sumFy = RA + RB + Fy;
  const sumM = MA + RB * params.L;
  const sumFx = (ra?.Rx ?? 0) + (rb?.Rx ?? 0);

  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'beam',
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    pointLoads: [
      { x: params.x1, value: -params.P1, label: `P1 = ${params.P1} kN` },
      { x: params.x2, value: -params.P2, label: `P2 = ${params.P2} kN` },
    ],
    // 反力画成向上箭头：箭头数 = 载荷数 + 反力数（check:statics ④ 盯着这件事）
    reactions: [
      // 标签朝图内：贴边的标签会被 SVG 视口裁掉（实测「RA =」被切掉一半）
      { x: 0, value: RA, label: `R_A = ${RA.toFixed(2)} kN`, side: 'right' },
      { x: params.L, value: RB, label: `R_B = ${RB.toFixed(2)} kN`, side: 'left' },
    ],
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    ['e-member', 'n-sup-0', 'n-sup-1'],
    ['e-member'],
    ['e-member', 'n-load-0', 'n-load-1'],
    ['e-member', 'n-sup-1'],
    ['e-member', 'n-sup-0', 'n-sup-1'],
  ]);

  const checks = [
    selfCheck('ΣFx=0 残差', 0, sumFx, Math.abs(sumFx) / Math.max(params.P1 + params.P2, 1), Math.abs(sumFx) < 1e-12, '两个载荷都竖直，A 铰的水平反力应为 0'),
    selfCheck('ΣFy=0 残差', 0, sumFy, Math.abs(sumFy) / Math.max(params.P1 + params.P2, 1), Math.abs(sumFy) < 1e-12, `RA+RB=${(RA + RB).toFixed(3)} kN 应等于 P1+P2=${(params.P1 + params.P2).toFixed(3)} kN`),
    selfCheck('ΣM_A=0 残差', 0, sumM, Math.abs(sumM) / Math.max(params.P1 * params.x1 + params.P2 * params.x2, 1), Math.abs(sumM) < 1e-12, `RB·L=${(RB * params.L).toFixed(3)} 应等于 P1x1+P2x2=${(params.P1 * params.x1 + params.P2 * params.x2).toFixed(3)}`),
    selfCheck('主矢与反力互抵 |R′+ΣR|', 0, Math.abs(Fy + RA + RB) / Math.max(params.P1 + params.P2, 1), Math.abs(Fy + RA + RB) / Math.max(params.P1 + params.P2, 1), Math.abs(Fy + RA + RB) < 1e-12, `主矢 R′=${Fy.toFixed(3)} kN（向下），反力之和 ${(RA + RB).toFixed(3)} kN（向上）`),
    selfCheck('主矩与反力偶互抵 |M_A+R_B·L|', 0, Math.abs(MA + RB * params.L) / Math.max(Math.abs(MA), 1), Math.abs(MA + RB * params.L) / Math.max(Math.abs(MA), 1), Math.abs(MA + RB * params.L) < 1e-12, `主矩 M_A=${MA.toFixed(3)} kN·m（顺时针）与 RB·L 抵消`),
    selfCheck('平衡方程求解残差 ||A·r−b||/||b||', 0, analysis.residual, analysis.residual, analysis.residual < 1e-12, '未知量按 3 方程求解'),
  ];

  const steps = [
    step(0, '取梁为隔离体', '\\text{梁} + R_A + R_B + P_1 + P_2',
      `L=${params.L} m，P1=${params.P1} kN@${params.x1} m，P2=${params.P2} kN@${params.x2} m`,
      '支座：A 固定铰（2 未知量）、B 可动铰（1 未知量）', '受力分析', ['e-member', 'n-sup-0', 'n-sup-1']),
    step(1, '向 A 点简化：主矢与主矩', 'R\'=\\sum\\vec F_i,\\ M_A=\\sum M_A(\\vec F_i)',
      `R'=${Fy.toFixed(3)} kN，M_A=${MA.toFixed(3)} kN·m`,
      `主矢 ${Math.abs(Fy).toFixed(3)} kN 向下；主矩 ${Math.abs(MA).toFixed(3)} kN·m 顺时针`,
      '力系简化的两个不变量', []),
    step(2, '对 A 取矩求 RB', '\\sum M_A=0:\\ R_B L=P_1x_1+P_2x_2',
      `(${params.P1}×${params.x1}+${params.P2}×${params.x2})/${params.L}`,
      `RB=${RB.toFixed(3)} kN`, '一个方程解一个未知量', ['n-sup-1']),
    step(3, '竖直方向求 RA', '\\sum F_y=0:\\ R_A+R_B=P_1+P_2',
      `${params.P1}+${params.P2}−${RB.toFixed(3)}`,
      `RA=${RA.toFixed(3)} kN`, '两个竖向反力分担总载荷', ['n-sup-0']),
    step(4, '校核', '\\sum F_x=0,\\ \\sum F_y=0,\\ \\sum M_A=0',
      `ΣFx=${sumFx.toExponential(2)}，ΣFy=${sumFy.toExponential(2)}，ΣM_A=${sumM.toExponential(2)}`,
      '三个残差均为机器零', '刚体平衡', []),
  ];

  return {
    templateId: 'S3',
    subject: 'statics',
    parsed_given: { L: params.L, x1: params.x1, P1: params.P1, x2: params.x2, P2: params.P2 },
    steps,
    result: {
      RA: Number(RA.toFixed(6)),
      RB: Number(RB.toFixed(6)),
      RAx: Number((ra?.Rx ?? 0).toFixed(6)),
      Fy: Number(Fy.toFixed(6)),
      MA: Number(MA.toFixed(6)),
      status: 'ok',
      conclusion: `RA=${RA.toFixed(3)} kN，RB=${RB.toFixed(3)} kN（ΣM_A 与 ΣF_y 两式联立）`,
    },
    render_specs: [
      figure,
      checksMatrix(checks, steps.length, checks.map(() => '本页自算（刚体平衡）')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['S3 只做静定梁的反力与简化；外伸梁 / 多跨连续梁属静不定，本工具拒绝'],
  };
}
