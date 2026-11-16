/**
 * M1–M4 共用件：受力图、坐标图、六项校验表、结论位。
 *
 * 这里**不算力学**：所有数字都来自 `solveMech`（库的复刻）或由它的输出直接换算，
 * 图上的标注也只允许传 solver 给的极值。渲染层不许再估一个「差不多」的数。
 */

import type { ChartMark, ChartSeries, ChartSpec, RenderSpec, Step } from '../../types.ts';
import type { MechCheck, MechReaction } from '../../mechanics/solve.ts';

export type ParamRecord = Record<string, number | string>;

export function num(input: ParamRecord, key: string, fallback: number): number {
  const raw = input[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`参数 ${key} 必须是数字`);
  return value;
}

/* ── 受力图（复用 schematic 渲染器 + 三个支座图元 + 箭头） ────────────── */

const X0 = 140;
const X1 = 780;
const AXIS_Y = 250;

export interface BeamFigureOptions {
  id: string;
  L: number;
  supports: { x: number; type: 'fixed' | 'pin' | 'roller' }[];
  /** 集中载荷：value 正 = 沿 dir 正方向（transverse 向上为正、axial 向右为正）。 */
  pointLoads?: { x: number; value: number; label: string; dir?: 'transverse' | 'axial' }[];
  /** 分布载荷：画成若干箭头 + 顶线。 */
  distributed?: { x0: number; x1: number; q: number; label: string };
  /** 集中力偶：逆时针为正。只写标注（同一点上往往还有力箭头，再叠一个圆弧会打架）。 */
  moments?: { x: number; value: number; label: string }[];
  /**
   * 反力：力画箭头、力偶画圆弧箭头（`momentArrow`）。
   * 受力图的箭头总数必须等于「载荷数 + 反力数」，所以反力不能只靠支座图元暗示。
   * value 的符号就是 solver 的符号：横向力向上为正、轴向力向右为正、力偶逆时针为正。
   */
  reactions?: BeamReaction[];
  /**
   * 是否画反力箭头。M 系与 S 系全部打开；留成显式开关是为了「只画支座不画反力」
   * 的那种草图（没有反力方向可言时不要凭空画一个）能明确关掉。
   * 缺省 = reactions 非空即画。
   */
  withReactions?: boolean;
  /** 两端标注（默认 L）。 */
  spanLabel?: string;
  member: 'beam' | 'shaft';
}

export interface BeamReaction {
  x: number;
  /** 力（kN）或力偶（kN·m），符号即 solver 的符号。 */
  value: number;
  label: string;
  /** 缺省 force-transverse。 */
  kind?: 'force-transverse' | 'force-axial' | 'moment';
  side?: 'left' | 'right';
}

const SUPPORT_KIND = { fixed: 'fixedSupport', pin: 'pinSupport', roller: 'rollerSupport' } as const;

export function beamFigure(options: BeamFigureOptions): RenderSpec {
  const { id, L, supports, member } = options;
  const sx = (x: number) => X0 + (x / L) * (X1 - X0);
  const nodes: RenderSpec['nodes'] = [];
  const edges: RenderSpec['edges'] = [];

  edges.push({
    id: 'e-member',
    from: 'n-end-a',
    to: 'n-end-b',
    kind: member === 'shaft' ? 'shaft' : 'beam',
    weight: 2,
    points: [
      [X0, AXIS_Y],
      [X1, AXIS_Y],
    ],
  });

  nodes.push({ id: 'n-end-a', x: X0, y: AXIS_Y, kind: 'pin', label: '' });
  nodes.push({ id: 'n-end-b', x: X1, y: AXIS_Y, kind: 'pin', label: '' });

  supports.forEach((support, index) => {
    nodes.push({
      id: `n-sup-${index}`,
      x: sx(support.x),
      y: AXIS_Y,
      kind: SUPPORT_KIND[support.type],
      label: support.type === 'fixed' ? '固定端' : support.type === 'pin' ? '固定铰' : '可动铰',
      labelSide: 'down',
    });
  });

  (options.pointLoads ?? []).forEach((load, index) => {
    if (load.dir === 'axial') {
      // 轴向力：**尾在作用点、箭身朝受力方向伸出去**（教科书画法）。
      // 尖落在作用点上、箭身压在杆里的话，箭头会被杆线和支座图形吃掉（M1 就是这么糊的）。
      const dir = load.value >= 0 ? 1 : -1;
      nodes.push({
        id: `n-load-${index}`,
        x: sx(load.x) + dir * 42,
        y: AXIS_Y,
        kind: 'arrow',
        rot: dir > 0 ? 270 : 90,
        label: load.label,
        labelSide: 'up',
      });
      return;
    }
    nodes.push({
      id: `n-load-${index}`,
      x: sx(load.x),
      y: AXIS_Y,
      kind: 'arrow',
      // 箭头默认尖朝下（transverse 正 = 向上，所以要转 180）
      rot: load.value >= 0 ? 180 : 0,
      label: load.label,
      labelSide: 'up',
    });
  });

  if (options.distributed) {
    const { x0, x1, q, label } = options.distributed;
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const x = x0 + ((x1 - x0) * i) / (count - 1);
      nodes.push({
        id: `n-dist-${i}`,
        x: sx(x),
        y: AXIS_Y,
        kind: 'arrow',
        rot: q >= 0 ? 0 : 180,
        label: '',
      });
    }
    edges.push({
      id: 'e-dist-top',
      from: 'n-dist-0',
      to: 'n-dist-last',
      kind: 'topline',
      weight: 1,
      points: [
        [sx(x0), AXIS_Y - 42],
        [sx(x1), AXIS_Y - 42],
      ],
      tag: label,
    });
  }

  // 反力图元：力 → 箭头（横向在支座下、轴向贴轴线），力偶 → 圆弧箭头（轴线上方）。
  // 三者都按 solver 的符号定朝向，标签一律「名称 = 数值 单位」。
  if (options.withReactions ?? (options.reactions?.length ?? 0) > 0) {
    const momentCount = new Map<number, number>();
    (options.reactions ?? []).forEach((reaction, index) => {
      const kind = reaction.kind ?? 'force-transverse';
      if (kind === 'moment') {
        // 同一个支座上可能有两个力偶分量（Mz 与 Mx）：往上叠，第二个再抬 54 px
        // 起始高度 64：固定端图元的墙线/斜线要占到轴上方 ~25 px，压上去就成了「反力压在支座上」
        const stack = momentCount.get(reaction.x) ?? 0;
        momentCount.set(reaction.x, stack + 1);
        nodes.push({
          id: `n-reaction-${index}`,
          x: sx(reaction.x),
          y: AXIS_Y - 64 - 54 * stack,
          kind: 'momentArrow',
          rot: reaction.value >= 0 ? 0 : 180,
          label: reaction.label,
          labelSide: reaction.side ?? 'right',
        });
        return;
      }
      if (kind === 'force-axial') {
        // 与轴向载荷同一画法：尾在杆端、箭身朝外（正方向 → 右，负方向 → 左）
        const dir = reaction.value >= 0 ? 1 : -1;
        nodes.push({
          id: `n-reaction-${index}`,
          x: sx(reaction.x) + dir * 42,
          y: AXIS_Y,
          kind: 'arrow',
          rot: dir > 0 ? 270 : 90,
          label: reaction.label,
          labelSide: 'up',
        });
        return;
      }
      nodes.push({
        id: `n-reaction-${index}`,
        x: sx(reaction.x),
        // 支座图形占到轴下 ~28 px，箭头从更下面往上画，避免完全压在三角形上
        y: AXIS_Y + 58,
        kind: 'arrow',
        rot: reaction.value >= 0 ? 180 : 0,
        label: reaction.label,
        labelSide: reaction.side ?? 'left',
      });
    });
  }

  (options.moments ?? []).forEach((moment, index) => {
    nodes.push({
      id: `n-moment-${index}`,
      x: sx(moment.x),
      y: AXIS_Y,
      kind: 'text',
      label: moment.label,
      labelSide: moment.value >= 0 ? 'up' : 'down',
    });
  });

  nodes.push({
    id: 'n-span',
    x: (X0 + X1) / 2,
    y: AXIS_Y + 86,
    kind: 'text',
    label: options.spanLabel ?? `L = ${L} m`,
    labelSide: 'up',
  });

  return {
    id,
    role: 'primary',
    type: 'freebody',
    nodes,
    edges,
    frames: [],
  };
}

/* ── 反力清单（solver 的 reactions → 受力图上的箭头） ───────────────── */

/**
 * 把 solver 的支座反力摊平成受力图上的反力清单。
 *
 * 规矩（与 S 系同一条）：**零分量不画**——画一个 0 的箭头看起来像解出来一个数；
 * 符号照抄 solver（横向向上正、轴向向右正、力偶逆时针正），标签一律 `R_A = 12.34 kN`。
 * 同一个支座同时有轴/横两个非零分量时才带 x/y 后缀，避免 `R_A` 出现两次。
 */
export function reactionArrowsOf(
  reactions: readonly MechReaction[],
  options: { span: number; digits?: number } = { span: 1 },
): BeamReaction[] {
  const digits = options.digits ?? 2;
  const out: BeamReaction[] = [];
  reactions.forEach((reaction, index) => {
    const name = String.fromCharCode(65 + index);
    const fx = reaction.Rx ?? 0;
    const fy = reaction.Ry ?? 0;
    const mz = reaction.Mz ?? 0;
    const mx = reaction.Mx ?? 0;
    const dual = Math.abs(fx) > 1e-9 && Math.abs(fy) > 1e-9;
    if (Math.abs(fx) > 1e-9) {
      out.push({
        x: reaction.x,
        value: fx,
        kind: 'force-axial',
        label: `R_${name}${dual ? 'x' : ''} = ${fx.toFixed(digits)} kN`,
      });
    }
    if (Math.abs(fy) > 1e-9) {
      out.push({
        x: reaction.x,
        value: fy,
        kind: 'force-transverse',
        label: `R_${name}${dual ? 'y' : ''} = ${fy.toFixed(digits)} kN`,
        // 贴边的标签朝图内，否则被 SVG 视口裁掉（S3 踩过一次）
        side: reaction.x <= options.span / 2 ? 'right' : 'left',
      });
    }
    if (Math.abs(mz) > 1e-9) {
      out.push({
        x: reaction.x,
        value: mz,
        kind: 'moment',
        label: `M_${name} = ${mz.toFixed(digits)} kN·m`,
        side: reaction.x <= options.span / 2 ? 'right' : 'left',
      });
    }
    if (Math.abs(mx) > 1e-9) {
      out.push({
        x: reaction.x,
        value: mx,
        kind: 'moment',
        label: `T_${name} = ${mx.toFixed(digits)} kN·m`,
        side: reaction.x <= options.span / 2 ? 'right' : 'left',
      });
    }
  });
  return out;
}

/* ── 坐标图 ─────────────────────────────────────────────────────────── */

const PAD_RATIO = 0.08;

function yDomainOf(points: [number, number][], extra: number[] = []): [number, number] {
  let min = 0;
  let max = 0;
  for (const [, y] of points) {
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  for (const y of extra) {
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  if (max === min) {
    const span = Math.max(Math.abs(max), 1) * 0.5;
    return [min - span, max + span];
  }
  const pad = (max - min) * PAD_RATIO;
  return [min - pad, max + pad];
}

export interface ChartOptions {
  id: string;
  title: string;
  unit: string;
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  series: ChartSeries[];
  marks?: ChartMark[];
  convention?: string;
  zeroLine?: boolean;
}

export function chartOf(options: ChartOptions): ChartSpec {
  const all = options.series.flatMap((item) => item.points);
  const spec: ChartSpec = {
    id: options.id,
    title: options.title,
    unit: options.unit,
    xLabel: options.xLabel,
    yLabel: options.yLabel,
    xDomain: options.xDomain,
    yDomain: yDomainOf(all, (options.marks ?? []).map((mark) => mark.y)),
    zeroLine: options.zeroLine ?? true,
    series: options.series,
    marks: options.marks,
  };
  // 不要写 convention: undefined —— JSON 会丢这个键，快照与实时对象就对不上了。
  if (options.convention) spec.convention = options.convention;
  return spec;
}

/** 双联图：Q / M 共享一条 x 轴，只有下面那张画刻度。 */
export function chartPair(
  id: string,
  upper: ChartOptions,
  lower: ChartOptions,
  convention: string,
): ChartSpec {
  const first = { ...chartOf(upper), convention };
  const second = chartOf(lower);
  const yDomain = second.yDomain;
  return {
    id,
    title: '内力图（双联，共享 x 轴）',
    unit: '',
    xLabel: lower.xLabel,
    yLabel: '',
    xDomain: lower.xDomain,
    yDomain,
    series: [],
    panels: [first, second],
  };
}

/* ── 六项校验（吃库的 checks[]） ─────────────────────────────────────── */

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Math.abs(value) >= 1e-3 && Math.abs(value) < 1e5 ? String(Number(value.toPrecision(6))) : value.toExponential(3);
}

/**
 * 一条自算校验（M5–M8 用）。库不覆盖这四型的全部内容，所以「哪条是库的、
 * 哪条是本页自算的」必须逐行标出来，不许混成一套看起来都像库给的。
 */
export function selfCheck(
  name: string,
  expected: number,
  actual: number,
  relError: number,
  pass: boolean,
  note: string,
): MechCheck {
  return { name, expected, actual, rel_error: relError, pass, note };
}

export function checksMatrix(
  checks: readonly MechCheck[],
  stepCount: number,
  sources?: readonly string[],
): RenderSpec {
  const rows = checks.map((check, index) => [
    check.name,
    fmt(check.expected),
    fmt(check.actual),
    check.rel_error === 0 ? '0' : check.rel_error.toExponential(2),
    check.pass ? '通过' : '未通过',
    check.note,
    sources?.[index] ?? '求解内核自检',
  ]);
  return {
    id: 'checks',
    role: 'secondary',
    type: 'matrix',
    nodes: [],
    edges: [],
    matrix: {
      columns: ['校验项', '期望', '实际', '相对误差', '结论', '说明', '来源'],
      rows,
    },
    frames: Array.from({ length: stepCount }, (_, stepIndex) => ({
      stepIndex,
      activeEdges: [],
      activeNodes: [],
      labels: [],
    })),
  };
}

/* ── 结论位 ─────────────────────────────────────────────────────────── */

/**
 * ok / over 是数值结论；indeterminate（静不定）与 out-of-scope（超出公式适用范围）
 * 都是「不给数字」的黄底分支 —— 区别只在文案，绝不允许先给个数再标黄。
 */
export type VerdictStatus = 'ok' | 'over' | 'indeterminate' | 'out-of-scope';

export interface Verdict {
  status: VerdictStatus;
  /** σmax / [σ]（或 τmax/[τ]），静不定时不存在。 */
  ratio?: number;
  /** 结论位文案（红字/黄底由 UI 读 status 决定）。 */
  text: string;
}

export function verdictAgainstAllow(
  label: string,
  value: number,
  allow: number,
  unit: string,
): Verdict {
  const ratio = value / allow;
  const limit = allow.toFixed(3);
  if (ratio > 1) {
    return {
      status: 'over',
      ratio,
      text: `${label} = ${value.toFixed(3)} ${unit} > 许用 ${limit} ${unit}，超限 ${((ratio - 1) * 100).toFixed(1)}%`,
    };
  }
  return {
    status: 'ok',
    ratio,
    text: `${label} = ${value.toFixed(3)} ${unit} ≤ 许用 ${limit} ${unit}（富余 ${((1 - ratio) * 100).toFixed(1)}%）`,
  };
}

export const INDETERMINATE_VERDICT: Verdict = {
  status: 'indeterminate',
  text: '当前版本不解静不定',
};

/** 超出公式适用范围时用：status 为 out-of-scope，ratio 不存在。 */
export function outOfScopeVerdict(text: string): Verdict {
  return { status: 'out-of-scope', text };
}

/* ── 步骤骨架（五步叙事：建模 → 反力 → 内力 → 应力 → 校核） ────────── */

export function step(
  i: number,
  title: string,
  formulaTex: string,
  substitution: string,
  value: string,
  basis: string,
  highlight: string[],
): Step {
  return { i, title, formula_tex: formulaTex, substitution, value, basis, highlight };
}

/** 让每一帧点亮「本步该亮」的图元；没指定的沿用上一步。 */
export function framesFor(
  ids: string[],
  stepHighlights: string[][],
): RenderSpec['frames'] {
  let last: string[] = [];
  return stepHighlights.map((highlight, stepIndex) => {
    if (highlight.length > 0) last = highlight;
    return {
      stepIndex,
      activeEdges: ids.filter((id) => last.includes(id) && id.startsWith('e-')),
      activeNodes: ids.filter((id) => last.includes(id) && !id.startsWith('e-')),
      labels: [],
    };
  });
}


/** solver 产出的 Solution 先挂占位 confidence，等 validateSolution 覆盖。 */
export function pendingConfidence(): import('../../types.ts').ConfidenceReport {
  const names = ['scopeOk', 'inputOk', 'pathsConsistent', 'residualOk', 'boundaryOk', 'goldenOk'];
  return {
    scopeOk: 'skipped',
    inputOk: 'skipped',
    pathsConsistent: 'skipped',
    residualOk: 'skipped',
    boundaryOk: 'skipped',
    goldenOk: 'skipped',
    maxResidual: 0,
    checks: names.map((name) => ({
      name,
      state: 'skipped' as const,
      detail: 'solver 输出占位，等待 validateSolution',
      skipReason: '待校验',
    })),
    failedCount: 0,
    skippedCount: 6,
    allPassed: false,
  };
}
