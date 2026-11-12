/**
 * S5 桁架：节点法（主）+ 截面法（核验）+ 零杆判别。
 *
 * 标准答案：A(0,0) pin、B(2,0) roller、C(1,1) apex，10 kN 竖直向下作用于 **C**
 * → RA=RB=5 kN、N_AC=N_BC=−7.071 kN（压）、N_AB=+5.000 kN（拉）。
 *
 * 两条路径：
 *  A 节点法（逐节点 ΣF=0 联立，未知量 = 3 杆内力 + 3 反力）
 *  B 截面法（切 AC、AB 取左段：ΣFy 求 N_AC，ΣM_C 求 N_AB）—— 不复用节点方程
 * 零杆判别按课本两条判据写理由，本工况结论是「无零杆」，理由必须显式写出来。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import type { TrussSpec } from '../../statics/truss.ts';
import { analyzeTruss, findZeroMembers, sectionTriangle } from '../../statics/truss.ts';
import type { ParamRecord } from './common.ts';
import {
  checksMatrix,
  figureOf,
  frameOf,
  framesFor,
  num,
  pendingConfidence,
  selfCheck,
  step,
  tensionLabel,
} from './common.ts';

export interface S5Params {
  /** 跨度（A 到 B），m。 */
  L: number;
  /** 矢高（C 到 AB 的距离），m。 */
  H: number;
  /** 顶点 C 处的竖向载荷，kN，向下。 */
  P: number;
}

export const S5_DEFAULTS: S5Params = { L: 2, H: 1, P: 10 };

export function s5Params(input: ParamRecord): S5Params {
  const params: S5Params = {
    L: num(input, 'L', S5_DEFAULTS.L),
    H: num(input, 'H', S5_DEFAULTS.H),
    P: num(input, 'P', S5_DEFAULTS.P),
  };
  if (!(params.L > 0)) throw new Error('S5 跨度 L 必须 > 0');
  if (!(params.H > 0)) throw new Error('S5 矢高 H 必须 > 0');
  if (!(params.P > 0)) throw new Error('S5 载荷 P 必须 > 0');
  return params;
}

export function s5Spec(params: S5Params): TrussSpec {
  return {
    nodes: [
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: params.L, y: 0 },
      { id: 'C', x: params.L / 2, y: params.H },
    ],
    members: [
      { id: 'AB', a: 'A', b: 'B' },
      { id: 'AC', a: 'A', b: 'C' },
      { id: 'BC', a: 'B', b: 'C' },
    ],
    supports: [
      { at: 'A', kind: 'pin' },
      { at: 'B', kind: 'roller' },
    ],
    loads: [{ at: 'C', F: [0, -params.P] }],
  };
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
}

export function solveS5(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('S5 只接受结构化参数');
  const params = s5Params(input as ParamRecord);
  const spec = s5Spec(params);
  const analysis = analyzeTruss(spec);
  if (!analysis.ok) throw new Error(analysis.message);

  const section = sectionTriangle(spec, 'C', 'A', 'B');
  const zeros = findZeroMembers(spec);
  const force = (id: string) => analysis.forces[id] ?? 0;

  const ra = analysis.reactions.find((item) => item.at === 'A');
  const rb = analysis.reactions.find((item) => item.at === 'B');
  const RA = ra?.Ry ?? 0;
  const RB = rb?.Ry ?? 0;

  /* ── 图：桁架（节点 + 直杆边 + 内力标注） ─────────────────────────── */
  const map = frameOf([{ x: 0, y: 0 }, { x: params.L, y: 0 }, { x: params.L / 2, y: params.H }], {
    w: 700,
    h: 320,
    pad: 78,
  });
  const at = (id: string) => {
    const node = spec.nodes.find((item) => item.id === id)!;
    return { x: map.sx(node.x), y: map.sy(node.y) };
  };
  const pa = at('A');
  const pb = at('B');
  const pc = at('C');

  const nodes: ReturnType<typeof figureOf>['nodes'] = [
    { id: 'n-A', x: pa.x, y: pa.y, kind: 'dot', label: 'A', labelSide: 'down' },
    { id: 'n-B', x: pb.x, y: pb.y, kind: 'dot', label: 'B', labelSide: 'down' },
    // C 的标签放左侧：顶点上方就是载荷箭头，写上去会和箭尾粘在一起
    { id: 'n-C', x: pc.x, y: pc.y, kind: 'dot', label: 'C', labelSide: 'left' },
    { id: 'n-sup-A', x: pa.x, y: pa.y, kind: 'pinSupport', label: '固定铰', labelSide: 'down' },
    { id: 'n-sup-B', x: pb.x, y: pb.y, kind: 'rollerSupport', label: '可动铰', labelSide: 'down' },
    { id: 'n-load', x: pc.x, y: pc.y - 6, kind: 'arrow', rot: 0, label: `P = ${params.P} kN`, labelSide: 'right' },
    // 反力箭头（错开 30 px，避免完全压在支座三角形上）
    {
      id: 'n-RA',
      x: pa.x - 30,
      y: pa.y,
      kind: 'arrow',
      rot: 180,
      label: `R_A = ${RA.toFixed(2)} kN`,
      labelSide: 'left',
    },
    {
      id: 'n-RB',
      x: pb.x + 30,
      y: pb.y,
      kind: 'arrow',
      rot: 180,
      label: `R_B = ${RB.toFixed(2)} kN`,
      labelSide: 'right',
    },
  ];

  const tagOf = (id: string) => `${id}: ${force(id) >= 0 ? '+' : ''}${force(id).toFixed(3)} kN（${tensionLabel(force(id))}）`;
  const edges: ReturnType<typeof figureOf>['edges'] = [
    { id: 'e-AB', from: 'n-A', to: 'n-B', kind: 'line', weight: 2, points: [[pa.x, pa.y], [pb.x, pb.y]], tag: tagOf('AB') },
    { id: 'e-AC', from: 'n-A', to: 'n-C', kind: 'line', weight: 2, points: [[pa.x, pa.y], [pc.x, pc.y]], tag: tagOf('AC') },
    { id: 'e-BC', from: 'n-B', to: 'n-C', kind: 'line', weight: 2, points: [[pb.x, pb.y], [pc.x, pc.y]], tag: tagOf('BC') },
  ];

  const ids = edges.map((edge) => edge.id);
  const figure = figureOf({
    id: 'main',
    nodes,
    edges,
    type: 'truss',
    frames: framesFor(ids, [
      ids,
      ids,
      ['e-AC', 'e-BC'],
      ['e-AB', 'e-AC'],
      ids,
    ]),
  });

  const residualByNode = analysis.nodeResiduals;
  const worstNode = residualByNode.reduce(
    (worst, item) => (item.residual > worst.residual ? item : worst),
    residualByNode[0],
  );

  const checks = [
    selfCheck(
      '逐节点 ΣF=0 最大残差',
      0,
      worstNode.residual,
      worstNode.residual,
      worstNode.residual < 1e-9,
      `最差节点 ${worstNode.node}：ΣFx=${worstNode.sumFx.toExponential(2)}，ΣFy=${worstNode.sumFy.toExponential(2)}`,
    ),
    selfCheck(
      'N_AC：节点法 vs 截面法',
      force('AC'),
      section.nAC,
      rel(force('AC'), section.nAC),
      rel(force('AC'), section.nAC) < 1e-9,
      section.note,
    ),
    selfCheck(
      'N_AB：节点法 vs 截面法（对 C 取矩）',
      force('AB'),
      section.nAB,
      rel(force('AB'), section.nAB),
      rel(force('AB'), section.nAB) < 1e-9,
      '截面法用 ΣM_C=0，不经过节点 C 的两个方程',
    ),
    selfCheck(
      '整体 ΣFy=0：RA+RB−P',
      0,
      RA + RB - params.P,
      Math.abs(RA + RB - params.P) / params.P,
      Math.abs(RA + RB - params.P) < 1e-12,
      `RA=${RA.toFixed(3)} kN，RB=${RB.toFixed(3)} kN`,
    ),
    selfCheck(
      '零杆数与判据一致',
      0,
      zeros.length,
      zeros.length,
      zeros.length === 0,
      zeros.length === 0
        ? '无零杆：C 是两杆节点但作用有外载 P（两杆零杆判据不成立）；A、B 是支座节点，不在判据范围'
        : zeros.map((item) => `${item.member}（${item.rule}）`).join('；'),
    ),
  ];

  const steps = [
    step(0, '几何与自由度', 'n=2j-3\\ (\\text{静定桁架})',
      `j=3 节点、m=3 杆：m=3=2×3−3`,
      `A(${0},${0})、B(${params.L},${0})、C(${(params.L / 2).toFixed(2)},${params.H})`, '桁架静定判据 m=2j−3', ['e-AB', 'e-AC', 'e-BC']),
    step(1, '整体平衡求反力', '\\sum M_A=0,\\ \\sum F_y=0',
      `P=${params.P} kN 作用于 C（跨中）`,
      `RA=${RA.toFixed(3)} kN，RB=${RB.toFixed(3)} kN`, '对称结构 + 跨中载荷 ⇒ 反力各半', ['n-sup-A', 'n-sup-B']),
    step(2, '节点 C：两杆节点求斜杆内力', '\\sum F_x=0,\\ \\sum F_y=0',
      `N_AC·cosθ + N_BC·cosθ = 0，N_AC·sinθ + N_BC·sinθ = −P`,
      `N_AC=N_BC=${force('AC').toFixed(3)} kN（${tensionLabel(force('AC'))}）`,
      'θ 为斜杆与水平夹角', ['n-C']),
    step(3, '节点 A：下弦杆', '\\sum F_x=0:\\ N_{AB}+N_{AC}\\cos\\theta=0',
      `${force('AC').toFixed(3)}×cosθ`,
      `N_AB=${force('AB').toFixed(3)} kN（${tensionLabel(force('AB'))}）`, '节点法逐点推进', ['n-A']),
    step(4, '截面法核验 + 零杆判别', '\\sum F_y=0,\\ \\sum M_C=0',
      section.note,
      `截面法：N_AC=${section.nAC.toFixed(3)} kN，N_AB=${section.nAB.toFixed(3)} kN`,
      zeros.length === 0 ? '零杆：0 根（理由见校验表）' : `零杆：${zeros.map((item) => item.member).join('、')}`, []),
  ];

  return {
    templateId: 'S5',
    subject: 'statics',
    parsed_given: { L: params.L, H: params.H, P: params.P },
    steps,
    result: {
      RA: Number(RA.toFixed(6)),
      RB: Number(RB.toFixed(6)),
      N_AB: Number(force('AB').toFixed(6)),
      N_AC: Number(force('AC').toFixed(6)),
      N_BC: Number(force('BC').toFixed(6)),
      zeroMembers: zeros.length,
      status: 'ok',
      conclusion: `RA=RB=${RA.toFixed(3)} kN；N_AC=N_BC=${force('AC').toFixed(3)} kN（压），N_AB=${force('AB').toFixed(3)} kN（拉）；零杆 0 根`,
    },
    render_specs: [
      figure,
      checksMatrix(checks, steps.length, checks.map(() => '本页自算（节点法 / 截面法）')),
    ],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: ['S5 只做静定桁架（m=2j−3）；超静定桁架与刚架需要位移法，本工具拒绝'],
  };
}
