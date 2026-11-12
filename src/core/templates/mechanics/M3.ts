/**
 * M3 弯曲内力：简支梁 + 集中力 P@a + 全跨均布 q。
 * Q/M 用库的 diagrams（不另做积分），双联图共享一条 x 轴。
 */

import { CONTRACT_VERSION } from '../../types.ts';
import type { RenderSpec, Solution } from '../../types.ts';
import type { SolverInput } from '../registry';
import { solveMech } from '../../mechanics/solve.ts';
import type { MechSpec } from '../../mechanics/spec.ts';
import type { ParamRecord } from './common.ts';
import {
  beamFigure,
  chartPair,
  checksMatrix,
  framesFor,
  INDETERMINATE_VERDICT,
  num,
  pendingConfidence,
  reactionArrowsOf,
  step,
} from './common.ts';

export interface M3Params {
  L: number;
  /** 集中力作用位置，m（0..L）。 */
  a: number;
  /** 集中力，kN，向下为正。 */
  P: number;
  /** 全跨均布载荷，kN/m，向下为正。 */
  q: number;
}

export const M3_DEFAULTS: M3Params = { L: 4, a: 2, P: 20, q: 0 };

export function m3Params(input: ParamRecord): M3Params {
  const params: M3Params = {
    L: num(input, 'L', M3_DEFAULTS.L),
    a: num(input, 'a', M3_DEFAULTS.a),
    P: num(input, 'P', M3_DEFAULTS.P),
    q: num(input, 'q', M3_DEFAULTS.q),
  };
  if (!(params.L > 0)) throw new Error('M3 跨度 L 必须 > 0');
  // 悬臂的集中力允许落在自由端（a = L，悬臂最常考的情形：P 作用在悬臂端）；
  // 简支仍要求严格 (0, L) 内（a = L 时简支无法平衡）。这是校验前提，不动任何公式。
  if (!(params.a > 0) || params.a > params.L + 1e-12) {
    throw new Error('M3 载荷位置 a 必须落在 (0, L) 内');
  }
  if (params.a >= params.L && String(input.config ?? '') !== 'cantilever') {
    throw new Error('M3 简支的载荷位置 a 必须落在 (0, L) 内');
  }
  if (params.P < 0 || params.q < 0) throw new Error('M3 的 P / q 表示向下的大小，不得为负');
  return params;
}

export function m3Spec(params: M3Params): MechSpec {
  const loads: MechSpec['loads'] = [{ type: 'point_force', x: params.a, value: -params.P }];
  if (params.q > 0) {
    loads.push({ type: 'distributed', x0: 0, x1: params.L, q0: -params.q, q1: -params.q });
  }
  return {
    kind: 'beam',
    length: params.L,
    supports: [
      { x: 0, type: 'pin' },
      { x: params.L, type: 'roller' },
    ],
    loads,
    section: { shape: 'rect', params: { b: 0.1, h: 0.2 }, E: 200e9 },
  };
}

/** 路径 B：静力平衡闭式。 */
export function m3Closed(params: M3Params): { RA: number; RB: number; Mmax: number; MmaxX: number } {
  const { L, a, P, q } = params;
  const RA = (P * (L - a)) / L + (q * L) / 2;
  const RB = (P * a) / L + (q * L) / 2;
  const qa = q === 0 ? 0 : (RA - q * a) / q;
  const candidates: { x: number; m: number }[] = [{ x: 0, m: 0 }, { x: L, m: 0 }, { x: a, m: RA * a - (q * a * a) / 2 }];
  if (q > 0 && qa > 0 && qa < L && qa !== a) {
    candidates.push({ x: qa, m: RA * qa - (q * qa * qa) / 2 - P * Math.max(0, qa - a) });
  }
  let best = candidates[0];
  for (const item of candidates) if (Math.abs(item.m) > Math.abs(best.m)) best = item;
  return { RA, RB, Mmax: Math.abs(best.m), MmaxX: best.x };
}

/** 路径 C：对 Q 做中点累积求 M（每个区间 Q 线性 ⇒ 中点法精确），不用闭式 M。 */
export function m3Numeric(params: M3Params): { Mmax: number; MmaxX: number } {
  const { L, a, P, q } = params;
  const closed = m3Closed(params);
  // 只在「载荷不连续点」处分段，分段内 Q 是线性的，中点法没有离散误差。
  const cuts = [0, a, L];
  const perSegment = 200;
  const xs: number[] = [];
  for (let s = 0; s < cuts.length - 1; s += 1) {
    const x0 = cuts[s];
    const x1 = cuts[s + 1];
    for (let i = 0; i < perSegment; i += 1) xs.push(x0 + ((x1 - x0) * i) / perSegment);
  }
  xs.push(L);
  const Q = (x: number) => closed.RA - q * x - (x >= a ? P : 0);
  let m = 0;
  let best = 0;
  let bestX = 0;
  for (let i = 1; i < xs.length; i += 1) {
    const h = xs[i] - xs[i - 1];
    m += Q((xs[i] + xs[i - 1]) / 2) * h;
    if (Math.abs(m) > Math.abs(best)) {
      best = m;
      bestX = xs[i];
    }
  }
  return { Mmax: Math.abs(best), MmaxX: bestX };
}

/** 悬臂：固定端在 x=0，集中力 P@a 与全跨均布 q 都向下。 */
export function m3CantileverSpec(params: M3Params): MechSpec {
  const loads: MechSpec['loads'] = [{ type: 'point_force', x: params.a, value: -params.P }];
  if (params.q > 0) {
    loads.push({ type: 'distributed', x0: 0, x1: params.L, q0: -params.q, q1: -params.q });
  }
  return {
    kind: 'beam',
    length: params.L,
    supports: [{ x: 0, type: 'fixed' }],
    loads,
    section: { shape: 'rect', params: { b: 0.1, h: 0.2 }, E: 200e9 },
  };
}

/** 悬臂路径 B：静力平衡闭式（R=P+qL，M_A=Pa+qL²/2，|M|max 在固定端）。 */
export function m3CantileverClosed(params: M3Params): {
  RA: number;
  MA: number;
  Mmax: number;
  MmaxX: number;
  Qmax: number;
} {
  const { a, P, q, L } = params;
  const MA = P * a + (q * L * L) / 2;
  return { RA: P + q * L, MA, Mmax: MA, MmaxX: 0, Qmax: P + q * L };
}

/** 悬臂路径 C：从自由端往回累积 Q，再对 Q 累积求 M（中点法，逐段精确）。 */
export function m3CantileverNumeric(params: M3Params): { Mmax: number; MmaxX: number } {
  const { L, a, P, q } = params;
  const cuts = [...new Set([0, a, L])].sort((x, y) => x - y);
  const perSegment = 200;
  const xs: number[] = [];
  for (let s = 0; s < cuts.length - 1; s += 1) {
    const x0 = cuts[s];
    const x1 = cuts[s + 1];
    for (let i = 0; i < perSegment; i += 1) xs.push(x0 + ((x1 - x0) * i) / perSegment);
  }
  xs.push(L);
  const Q = (x: number) => q * (L - x) + (x < a ? P : 0);
  let m = 0;
  let best = 0;
  let bestX = 0;
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const h = xs[i] - xs[i - 1];
    m -= Q((xs[i] + xs[i - 1]) / 2) * h;
    if (Math.abs(m) > Math.abs(best)) {
      best = m;
      bestX = xs[i - 1];
    }
  }
  return { Mmax: Math.abs(best), MmaxX: bestX };
}

export function solveM3(input: SolverInput): Solution {
  if ('devices' in input || 'members' in input) throw new Error('M3 只接受结构化参数');
  const params = m3Params(input as ParamRecord);
  const cantilever = String((input as ParamRecord).config ?? '') === 'cantilever';
  const sol = solveMech(cantilever ? m3CantileverSpec(params) : m3Spec(params));
  const closed = m3Closed(params);
  const cantileverClosed = cantilever ? m3CantileverClosed(params) : null;

  if (!sol.determinate) {
    throw new Error(`${INDETERMINATE_VERDICT.text}（M3 当前只挂静定的简支梁 / 悬臂）`);
  }

  const Mmax = sol.extrema.M?.abs_max ?? 0;
  const MmaxX = sol.extrema.M?.abs_max_x ?? 0;
  // 标注必须落在曲线上：悬臂的 |M|max 出现在 M(0)=−15（负弯矩），
  // 直接拿 abs_max 当 y 会把标注点到图顶去 —— 这里取该处的**带符号**值。
  const mAtMax = (sol.diagrams.M ?? []).reduce(
    (best, point) =>
      Math.abs(Math.abs(point.value) - Mmax) < Math.abs(Math.abs(best.value) - Mmax) ? point : best,
    { x: MmaxX, value: 0 },
  );
  const Qmax = sol.extrema.Q?.max ?? 0;
  const Qmin = sol.extrema.Q?.min ?? 0;
  // 互校的对照物必须跟着梁型走：悬臂拿简支闭式（PL/4）去比，图上会印出「闭式 20 / 库 10」
  // 这种一看就是算错了的东西（W4 实测）。悬臂的闭式极值就是固定端的 M_A。
  const closedMax = cantilever ? (cantileverClosed?.Mmax ?? 0) : closed.Mmax;

  const supports = cantilever
    ? [{ x: 0, type: 'fixed' as const }]
    : [{ x: 0, type: 'pin' as const }, { x: params.L, type: 'roller' as const }];
  const figure = beamFigure({
    id: 'main',
    L: params.L,
    member: 'beam',
    supports,
    pointLoads: [{ x: params.a, value: -params.P, label: `P = ${params.P} kN` }],
    distributed: params.q > 0 ? { x0: 0, x1: params.L, q: -params.q, label: `q = ${params.q} kN/m` } : undefined,
    // 简支画 R_A / R_B，悬臂画 R_A 与 R_A 处力偶 M_A：箭头数 = 载荷数 + 反力数
    withReactions: true,
    reactions: reactionArrowsOf(sol.reactions, { span: params.L }),
  });
  const ids = [...figure.nodes.map((node) => node.id), ...figure.edges.map((edge) => edge.id)];
  figure.frames = framesFor(ids, [
    cantilever ? ['e-member', 'n-sup-0'] : ['e-member', 'n-sup-0', 'n-sup-1'],
    ['e-member', 'n-load-0'],
    ['e-member', 'n-load-0'],
    ['e-member', 'n-span'],
    ['e-member', 'n-span'],
  ]);

  const qPoints = (sol.diagrams.Q ?? []).map((point) => [point.x, point.value] as [number, number]);
  const mPoints = (sol.diagrams.M ?? []).map((point) => [point.x, point.value] as [number, number]);

  const pair = chartPair(
    'internal',
    {
      id: 'q',
      title: '剪力图',
      unit: 'kN',
      xLabel: 'x (m)',
      yLabel: 'kN',
      xDomain: [0, params.L],
      series: [{ kind: 'step', points: qPoints, label: 'Q(x)' }],
      marks: [
        { x: sol.extrema.Q?.max_x ?? 0, y: Qmax, text: `Q=${Qmax.toFixed(2)} kN`, side: 'up' },
        { x: sol.extrema.Q?.min_x ?? 0, y: Qmin, text: `Q=${Qmin.toFixed(2)} kN`, side: 'down' },
      ],
    },
    {
      id: 'm',
      title: '弯矩图',
      unit: 'kN·m',
      xLabel: 'x (m)',
      yLabel: 'kN·m',
      xDomain: [0, params.L],
      series: [{ kind: 'line', points: mPoints, label: 'M(x)', fill: true }],
      // 标签写 |M| 就必须是正数：y 用带符号的 mAtMax.value（落在曲线上），
      // 文字用 Math.abs(Mmax) —— 两件事分开，别再让「-10.00」印在绝对值里。
      marks: [
        { x: mAtMax.x, y: mAtMax.value, text: `|M|max=${Math.abs(Mmax).toFixed(2)} kN·m`, side: 'down' },
      ],
    },
    'Q 使微段顺时针转为正　M 下侧受拉为正　dM/dx = Q（库 conventions）',
  );

  const chartSpec: RenderSpec = { id: 'internal', role: 'secondary', type: 'beam', nodes: [], edges: [], chart: pair, frames: [] };

  const steps = [
    step(0, cantilever ? '取整体，求固定端反力' : '取整体，求支座反力', '\\sum F_y=0,\\ \\sum M_A=0',
      `P=${params.P} kN @x=${params.a} m${params.q > 0 ? `，q=${params.q} kN/m 全跨` : ''}`,
      cantilever
        ? `R=${(cantileverClosed?.RA ?? 0).toFixed(3)} kN，M_A=${(cantileverClosed?.MA ?? 0).toFixed(3)} kN·m`
        : `RA=${closed.RA.toFixed(3)} kN，RB=${closed.RB.toFixed(3)} kN`,
      cantilever ? '刚体平衡（固定端提供反力偶）' : '刚体平衡',
      cantilever ? ['n-sup-0'] : ['n-sup-0', 'n-sup-1']),
    step(1, '剪力图 Q(x)', 'Q(x)=R_A-\\int_0^x q\\,dx-\\sum P_i',
      '按库的符号约定取左段，逐段累加', `Q: ${Qmax.toFixed(3)} / ${Qmin.toFixed(3)} kN`, '截面法（左段）', ['n-load-0', 'e-member']),
    step(2, '弯矩图 M(x)', 'M(x)=\\int_0^x Q\\,dx',
      'M 在集中力处折角、在铰端归零', `|M|max = ${Mmax.toFixed(3)} kN·m @ x=${MmaxX.toFixed(3)} m`, 'dM/dx=Q（库已用中心差分校核）', ['e-member']),
    step(3, '极值定位', 'dM/dx=0\\ \\Rightarrow\\ Q=0',
      `Q 变号处即 M 极值；本解 |M|max 在 x=${MmaxX.toFixed(3)} m`,
      `${Math.abs(Mmax - closedMax) / Math.max(closedMax, 1e-12) < 1e-6 ? '闭式与数值积分一致' : '闭式与数值不一致'}`,
      '极值判据 + 双路径互校', ['e-member', 'n-span']),
    step(4, '结论', 'M_{max}=M(x^{*})',
      `闭式 ${closedMax.toFixed(4)} kN·m，库 ${Mmax.toFixed(4)} kN·m`,
      `|M|max = ${Mmax.toFixed(3)} kN·m`, '库 diagrams.extrema', ['e-member', 'n-span']),
  ];

  return {
    templateId: 'M3',
    subject: 'mechanics',
    parsed_given: { L: params.L, a: params.a, P: params.P, q: params.q },
    steps,
    result: {
      ...(cantilever ? { config: 'cantilever' } : {}),
      RA: Number((cantileverClosed?.RA ?? closed.RA).toFixed(6)),
      ...(cantilever ? { MA: Number((cantileverClosed?.MA ?? 0).toFixed(6)) } : {}),
      // 悬臂没有 B 支座：这里以前无条件写 RB=Pa/L（简支式），结果页上凭空多一个 RB=5
      ...(cantilever ? {} : { RB: Number(closed.RB.toFixed(6)) }),
      Qmax: Number(Qmax.toFixed(6)),
      Qmin: Number(Qmin.toFixed(6)),
      Mmax: Number(Mmax.toFixed(6)),
      MmaxX: Number(MmaxX.toFixed(6)),
      status: 'ok',
      conclusion: `|M|max = ${Mmax.toFixed(3)} kN·m @ x=${MmaxX.toFixed(3)} m`,
    },
    render_specs: [figure, chartSpec, checksMatrix(sol.checks, steps.length)],
    confidence: pendingConfidence(),
    validatedAt: '',
    contractVersion: CONTRACT_VERSION,
    warnings: sol.warnings,
  };
}
