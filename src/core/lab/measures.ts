/**
 * W19 · `interpretQuestion` —— 「这张图问什么」。
 *
 * 通用求解（frameSolve / netSolve）只给**引擎原始量**：反力、内力、节点电位。
 * 但一张图被问的是 δmax、Pcr、Av、工作点……这一层以前不存在，于是「图变了 →
 * 掉到通用求解 → 被问的量消失」。这里补上：**只看图和它的解，不看 templateId**。
 *
 * 三条规矩（门禁 check:measures 逐条钉住）：
 *  ① 问得到的量必须给：几何/材料够 → 给数；不够 → 给「缺什么」，不拿别的量充数；
 *  ② 问不到的量不产：压杆没有横向载荷就不出内力图，纯数值题不出结构面板；
 *  ③ 与入口无关：同一张图挂到任何 templateId 下，measures 逐位相同。
 *
 * 数值口径写死在文件里，别处不许再算一遍：
 *  - 位移：frameSolve 刚度取 EA=EI=1，真值 = 单位刚度解 / (E·I)（E 用 kN/m²、I 用 m⁴）；
 *  - 稳定：Pcr = π²EI/(μL)²，λ = μL/i，i = √(I/A)，λp = π√(E/σp)；
 *  - 应力：σ = M/W（W = bh²/6）或 σ = N/A；
 *  - 扭转：Wp = πd³/16，Ip = πd⁴/32，φ = TL/(G·Ip)；
 *  - 增益：Av = v(输出网)/v(输入网)，输入网取「未标值的电压源」的非地端。
 */

import type { ChartSpec } from '../types.ts';
import { isFlatZeroPanel } from '../chartPanels.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';
import type { FrameSolution } from './frameSolve.ts';
import { frameSolve } from './frameSolve.ts';
import type { CircuitSolution } from './netSolve.ts';
import { valueFromLabel } from './picks.ts';
import { displayLabels, shownId, shownMember } from './display.ts';
import { formatScalar } from '../format.ts';
import { getUnitMode } from '../units.ts';

/**
 * W22-B 变异位：check:netsolve 把 preferNamedNet 关掉 = 输出网退回「|v| 最大」
 * → 「命名网优先于 |v|max」条红。
 */
export const OUTPUT_NET_CONFIG = { preferNamedNet: true };

/**
 * 变异位一览（门禁各验一条，翻过来必须红）：
 *  - `readTemplateId`：按题型决定「问什么」（本项目明令禁止的做法）。
 * 载荷吸附的变异位在 `frameSolve.ts` 的
 * `FRAME_SOLVE_CONFIG.loadSnapPx` / `loadSnapFraction`。
 */
export const MEASURE_CONFIG = { readTemplateId: false };

export interface MeasureRow {
  label: string;
  value: number | string;
  unit?: string;
  hint?: string;
}

export interface Measure {
  /** 稳定 id：门禁与面板都按它找。 */
  id: 'react' | 'internal' | 'stress' | 'deflection' | 'stability' | 'torsion' | 'axial' | 'op' | 'region' | 'gain' | 'diode' | 'power' | 'kcl' | 'nodeV';
  title: string;
  /** 一行结论（大字号）。 */
  headline?: string;
  rows: MeasureRow[];
  /** 如实说明（近似、约定、被忽略的东西）。 */
  note?: string;
  /** 做不了的原因 —— 有它时 rows 为空，界面显示「缺什么」。 */
  missing?: string;
  tone?: 'ok' | 'warn' | 'bad';
  chart?: ChartSpec;
}

export interface SolvedInput {
  frame?: FrameSolution;
  circuit?: CircuitSolution;
}

/* ── 从图上读几何 / 材料（不读模板） ───────────────────────────── */

interface Section {
  b?: number;
  h?: number;
  I?: number;
  A?: number;
  E?: number;
  d?: number;
  G?: number;
  sp?: number;
  allow?: number;
  /** 杆件表里手填的 A/I/E（会覆盖上面的截面推导）。 */
  edge: { A?: number; I?: number; E?: number };
}

const numeric = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function sectionOf(graph: CanvasGraph): Section {
  const meta = graph.meta ?? {};
  const props = graph.edges as readonly { A?: number; I?: number; E?: number }[];
  const edge = props.find((one) => typeof one.A === 'number' || typeof one.I === 'number' || typeof one.E === 'number') ?? {};
  // W20：右栏手填的截面优先（它是一个整体，三个数同时给、同时清）；
  // 骨架自带的扁平 b/h/E（M5/M7）继续作回退，逐键不变。
  const filled = meta.section;
  const fromPanel = filled && typeof filled === 'object' ? filled : undefined;
  return {
    b: numeric(fromPanel?.b ?? meta.b),
    h: numeric(fromPanel?.h ?? meta.h),
    E: numeric(fromPanel?.E ?? meta.E),
    d: numeric(meta.d),
    G: numeric(meta.G),
    sp: numeric(meta.sp),
    allow: numeric(meta.allow),
    I: numeric(meta.I),
    A: numeric(meta.A),
    edge: { A: numeric(edge.A), I: numeric(edge.I), E: numeric(edge.E) },
  };
}

/** 1 / 2 / 2.5 / 5 × 10ⁿ 刻度步长（与 Chart.ticks 同一套「整齐」口径）。 */
function niceStepOf(span: number, target = 6): number {
  const rough = span / Math.max(target, 1);
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/**
 * R3 修复：y 域不再按百分比随便垫，而是**向外吸附到刻度倍数**——
 * 数据极值至少有一条刻度可对照（Qmax=50 以前悬在 40 之上、|M|max=44.9
 * 只见 -40，读数全靠猜）。flat-zero（lo===hi）保持旧的 ±1 垫法。
 */
function niceDomain(lo: number, hi: number): [number, number] {
  const span = hi - lo;
  if (!(span > 0)) return [lo - 1, hi + 1];
  const step = niceStepOf(span * 1.05, 6);
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}

/**
 * W20：沿梁长的弯曲正应力 σ(x) = M(x)/W。
 * M 是 kN·m、W 是 mm³，换到 MPa 要 ×1e6（kN·m → N·mm）。
 * 上下缘对称（±σ），这里画的是下侧受拉一侧的绝对值带符号值。
 */
export function stressChart(frame: FrameSolution, W: number): ChartSpec | undefined {
  if (!(W > 0)) return undefined;
  const curves = frame.memberCurves;
  const xs = curves.flatMap((curve) => curve.samples.map((sample) => sample.gx));
  if (xs.length === 0) return undefined;
  const values = curves.flatMap((curve) => curve.samples.map((sample) => (sample.M * 1e6) / W));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  return {
    id: 'section-stress',
    title: '应力分布 σ(x) = M(x) / W',
    unit: 'MPa',
    xLabel: 'x (m)',
    yLabel: 'σ (MPa)',
    xDomain: [Math.min(...xs), Math.max(...xs)],
    yDomain: niceDomain(lo, hi),
    zeroLine: true,
    series: curves.map((curve) => ({
      kind: 'line' as const,
      label: curve.edgeId,
      points: curve.samples.map((sample) => [sample.gx, (sample.M * 1e6) / W] as [number, number]),
    })),
  };
}

/** 抗弯惯性矩（mm⁴）：杆件手填 > 矩形 b·h³/12 > 缺。 */
function inertiaOf(section: Section): { value?: number; why?: string } {
  if (section.edge.I !== undefined) return { value: section.edge.I };
  if (section.I !== undefined) return { value: section.I };
  if (section.b !== undefined && section.h !== undefined) return { value: (section.b * section.h ** 3) / 12 };
  return { why: '图上没给截面（b/h 或 I）' };
}

function areaOf(section: Section): { value?: number; why?: string } {
  if (section.edge.A !== undefined) return { value: section.edge.A };
  if (section.A !== undefined) return { value: section.A };
  if (section.b !== undefined && section.h !== undefined) return { value: section.b * section.h };
  if (section.d !== undefined) return { value: (Math.PI * section.d ** 2) / 4 };
  return { why: '图上没给截面（b/h / A / d）' };
}

const LOAD_KINDS = new Set(['arrow', 'udl', 'momentArrow', 'torqueArrow']);

function loadValueOf(node: CanvasNode): number | null {
  const raw = node.value ?? valueFromLabel(node.label);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function loadsOf(graph: CanvasGraph): { node: CanvasNode; value: number; kind: string }[] {
  return graph.nodes
    .filter((node) => LOAD_KINDS.has(node.kind) && !node.id.startsWith('n-reaction-'))
    .map((node) => ({ node, value: loadValueOf(node) ?? 0, kind: node.kind }))
    .filter((item) => Number.isFinite(item.value));
}

/** 图里的支座（R3-1 起是结点属性）。 */
function supportsOf(graph: CanvasGraph): { nodeId: string; type: 'pin' | 'roller' | 'fixed' }[] {
  return graph.nodes
    .filter((node) => node.support)
    .map((node) => ({ nodeId: node.id, type: node.support!.type }));
}

/* ── 格式化（界面与门禁共用一套；不在界面里各写一份） ─────────── */

export function fmtMeasure(value: number | string, digits = 6): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 1e-9) return '0';
  // 巡检 A4：6.667e+5 这种 JS 科学计数法在教材语境里没人这么写 —— 换成 6.667×10⁵。
  if (Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 1e-3)) {
    const exp = value.toExponential(3);
    const [mantissa, exponent] = exp.split('e');
    const superscripts: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    const sup = exponent.replace(/^(\+|-)?0*/, '').split('').map((ch) => superscripts[ch] ?? ch).join('');
    return `${mantissa}×10${sup}`;
  }
  const rounded = Number(value.toPrecision(digits));
  return String(rounded);
}

/**
 * P0-④：带单位的读数也走「单位制」这一档 —— 结果表早就跟着切了，标题行
 * （`|M|max = 20 kN·m`）以前是写死的，于是同一屏里 N 与 kN·m 混着出现。
 * auto 档逐字沿用 fmtMeasure（几十条门禁断言的就是它），只有 si / eng 才换算。
 */
export function fmtMeasureUnit(value: number, unit: string, digits = 6): string {
  const mode = getUnitMode();
  if (mode === 'auto') return `${fmtMeasure(value, digits)} ${unit}`;
  return formatScalar(value, unit, mode);
}

/* ── 梁族 ─────────────────────────────────────────────────────── */

/** 三联内力图（N / Q / M 共享 x 轴）：直接吃 frameSolve 的 memberCurves。
 *  W21-B B1：恒为 0 的分量不产那张 panel（弯曲题的 N(x)≡0 不再占半屏）。 */
export function internalChart(frame: FrameSolution): ChartSpec | undefined {
  const curves = frame.memberCurves;
  const xs = curves.flatMap((curve) => curve.samples.map((sample) => sample.gx));
  const xDomain: [number, number] = xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const panel = (
    id: string,
    title: string,
    unit: string,
    pick: (sample: { N: number; Q: number; M: number }) => number,
  ): ChartSpec => {
    const values = curves.flatMap((curve) => curve.samples.map(pick));
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    // 巡检 C6：剪力图在集中力处的跳变必须画成竖直线 —— 采样点之间有横向间距，
    // 直接连线会变成一段斜线，被误读成坡段。跳变处补一个「同 x 双值点」：
    // 水平走到载荷位置 → 竖直跳到新值。容忍度取量程的 1%。
    const range = Math.max(hi - lo, 1e-9);
    const jumpTol = range * 0.01;
    const seriesOf = () =>
      curves.map((curve) => {
        const raw = curve.samples.map((sample) => [sample.gx, pick(sample)] as [number, number]);
        if (id !== 'q') return { kind: 'line' as const, points: raw, label: curve.edgeId };
        const stepped: [number, number][] = [];
        for (let index = 0; index < raw.length; index += 1) {
          const [x, y] = raw[index];
          if (index > 0) {
            const [px, py] = raw[index - 1];
            if (x > px && Math.abs(y - py) > jumpTol) stepped.push([x, py]);
          }
          stepped.push([x, y]);
        }
        return { kind: 'line' as const, points: stepped, label: curve.edgeId };
      });
    // 巡检 C6：弯矩图把 |M|max 极值点标在图上（原来只活在文字里）。
    const marks =
      id === 'm' && Number.isFinite(frame.extremes.atX)
        ? (() => {
            let best: [number, number] | null = null;
            let bestDist = Infinity;
            for (const curve of curves) {
              for (const sample of curve.samples) {
                const d = Math.abs(sample.gx - frame.extremes.atX);
                if (d < bestDist) {
                  bestDist = d;
                  best = [sample.gx, sample.M];
                }
              }
            }
            if (!best || bestDist > 1e-6) return undefined;
            const magnitude = Math.abs(frame.extremes.Mmax);
            const text = `|M|max ${Number(magnitude.toPrecision(4))} kN·m`;
            return [{ x: best[0], y: best[1], text, side: (best[1] >= 0 ? 'up' : 'down') as 'up' | 'down' }];
          })()
        : undefined;
    return {
      id,
      title,
      unit,
      xLabel: 'x (m)',
      yLabel: unit,
      xDomain,
      yDomain: niceDomain(lo, hi),
      zeroLine: true,
      series: seriesOf(),
      ...(marks ? { marks } : {}),
    };
  };
  const panels = [
    panel('n', '轴力图（拉为正）', 'kN', (s) => s.N),
    panel('q', '剪力图（顺时针为正）', 'kN', (s) => s.Q),
    panel('m', '弯矩图（下侧受拉为正）', 'kN·m', (s) => s.M),
  ];
  // W21-C C0-3：这里不再自己过滤 —— 恒零面板原样进 spec，渲染层（Chart.tsx）
  // 用同一个判据筛掉并出一行灰字「本图该内力恒为 0」，数据与展示单一真相。
  if (panels.every((one) => isFlatZeroPanel(one))) return undefined;
  return {
    id: 'generic-internal',
    title: '内力图（N / Q / M 三联，共享 x 轴）',
    unit: '',
    xLabel: 'x (m)',
    yLabel: '',
    xDomain,
    yDomain: [0, 1],
    series: [],
    panels,
  };
}

/**
 * 位移：逐杆把 M(x)/EI 积分两次，起点用 frameSolve 的结点位移 (v, θ) 定。
 * 只支持**水平杆且各杆 EI 相同**的情形（其它情形给 missing，不画假曲线）。
 */
function deflectionOf(
  frame: FrameSolution,
  section: Section,
): { points: { gx: number; v: number }[]; deltaMax: number; atX: number; ei: number } | { why: string } {
  const inertia = inertiaOf(section);
  const E = section.edge.E ?? section.E;
  if (inertia.value === undefined) return { why: `${inertia.why}：只给形状也给不了，位移要 E 和 I` };
  if (E === undefined) return { why: '图上没给弹性模量 E：没有 EI 就算不出位移数值' };
  if (!frame.members.every((member) => member.horizontal)) return { why: '图里有斜的 / 竖的构件：本版位移曲线只画水平构件' };
  const eiValues = frame.members.map((member) => member.ei);
  if (new Set(eiValues.map((value) => value.toFixed(9))).size > 1) {
    return { why: '各构件刚度不一致（构件行里改过 A/I/E）：位移只给相对形状，不给数值' };
  }
  // E[GPa] → kN/m²；I[mm⁴] → m⁴；EI[kN·m²]
  const eiPhys = E * 1e6 * inertia.value * 1e-12;
  if (!(eiPhys > 0)) return { why: 'EI 算出来是 0：检查 E 与截面' };

  const displByNode = new Map(frame.displacements.map((item) => [item.nodeId, item]));
  const points: { gx: number; v: number }[] = [];
  // B1：段内 M 线性 ⇒ θ 二次、v 三次 —— 下面两个公式在段内是精确的，
  // 曲线按 12 个子点画（不再是折线），δmax 用段内 θ=0 的解析驻点取（不再只在采样站里挑）。
  const SUBDIVISIONS = 12;
  let deltaMax = 0;
  let atX = Number.NaN;
  for (const member of frame.members) {
    const curve = frame.memberCurves.find((item) => item.edgeId === member.edgeId);
    const start = displByNode.get(member.fromNodeId);
    if (!curve || !start || curve.samples.length < 2) continue;
    // 单位刚度解：v''=M，起点 (v0, θ0)
    let theta = start.theta;
    let v = start.v;
    points.push({ gx: curve.samples[0].gx, v: v / eiPhys });
    const consider = (value: number, gx: number) => {
      if (!Number.isFinite(value)) return;
      if (!Number.isFinite(atX) || Math.abs(value) > Math.abs(deltaMax)) {
        deltaMax = value;
        atX = gx;
      }
    };
    consider(v / eiPhys, curve.samples[0].gx);
    for (let index = 1; index < curve.samples.length; index += 1) {
      const prev = curve.samples[index - 1];
      const next = curve.samples[index];
      const dx = next.x - prev.x;
      if (dx === 0) continue;
      const dM = next.M - prev.M;
      const gxSpan = next.gx - prev.gx;
      // 加密子点：v(t) = v + θt + M₀t²/2 + ΔM·t³/(6dx)（对线性 M 精确）
      for (let k = 1; k <= SUBDIVISIONS; k += 1) {
        const t = (dx * k) / SUBDIVISIONS;
        const vT = v + theta * t + (prev.M * t * t) / 2 + (dM * t * t * t) / (6 * dx);
        points.push({ gx: prev.gx + (gxSpan * k) / SUBDIVISIONS, v: vT / eiPhys });
      }
      // 段内驻点：解 a·t² + b·t + c = 0，其中 a=ΔM/(2dx)、b=M₀、c=θ₀
      const roots: number[] = [];
      const a = dM / (2 * dx);
      const b = prev.M;
      const c = theta;
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) roots.push(-c / b);
      } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
        }
      }
      for (const t of roots) {
        if (!(t > 0 && t < dx)) continue;
        const vT = v + theta * t + (b * t * t) / 2 + (dM * t * t * t) / (6 * dx);
        consider(vT / eiPhys, prev.gx + (gxSpan * t) / dx);
      }
      // 推进到段末（与原梯形/二次推进逐位一致：dv 用段首 θ）
      v += theta * dx + (prev.M * dx * dx) / 2 + (dM * dx * dx) / 6;
      theta += ((prev.M + next.M) / 2) * dx;
      consider(v / eiPhys, next.gx);
    }
  }
  if (points.length === 0) return { why: '位移场是空的：这张图没有可积分的构件' };
  if (!Number.isFinite(atX)) atX = points[0].gx;
  return { points, deltaMax, atX, ei: eiPhys };
}

/** 稳定：单根压杆 + 图上声明了 μ（μ 只会出现在稳定题里）+ 两端铰/固。 */
function stabilityOf(
  graph: CanvasGraph,
  frame: FrameSolution,
  section: Section,
): { mu: number; L: number; lam: number; lamP: number; pcr: number; sigmaCr: number; P: number } | { why: string } {
  const mu = numeric(graph.meta.mu);
  if (mu === undefined) return { why: '图上没有长细比系数 μ：这张图不声明自己问稳定' };
  if (frame.members.length !== 1) return { why: '稳定判据只对单根压杆成立（这张图有多个构件）' };
  const supports = supportsOf(graph);
  if (supports.length !== 2 || supports.some((item) => item.type === 'roller')) {
    return { why: '两端约束不是「铰-铰 / 固-固 / 固-铰」：稳定计算的长度系数不成立' };
  }
  const inertia = inertiaOf(section);
  const area = areaOf(section);
  const E = section.edge.E ?? section.E;
  if (inertia.value === undefined) return { why: `${inertia.why}：没有 I 算不出 Pcr` };
  if (area.value === undefined) return { why: `${area.why}：没有 A 算不出 λ 与 σcr` };
  if (E === undefined) return { why: '图上没给 E：欧拉公式要 E' };
  const L = frame.members[0].L;
  const inertiaRadius = Math.sqrt(inertia.value / area.value); // mm
  const lam = (mu * L * 1000) / inertiaRadius;
  const sigmaP = section.sp ?? 200;
  const lamP = Math.PI * Math.sqrt((E * 1000) / sigmaP);
  const sigmaCr = (Math.PI ** 2 * E * 1000) / lam ** 2; // MPa
  const pcr = (sigmaCr * area.value) / 1000; // kN
  const P = Math.max(0, ...loadsOf(graph).filter((item) => item.kind !== 'torqueArrow').map((item) => Math.abs(item.value)));
  return { mu, L, lam, lamP, pcr, sigmaCr, P };
}

/** 扭转：单根轴 + 图上写了 T（扭矩载荷或标注文字）+ d/G。 */
function torsionOf(
  graph: CanvasGraph,
  section: Section,
): { T: number; L: number; tau: number; phi: number; Wp: number; Ip: number } | { why: string } {
  const shafts = graph.edges.filter((edge) => edge.kind === 'shaft');
  if (shafts.length === 0) return { why: '这张图没有轴段（shaft）' };
  if (shafts.length > 1) return { why: '多段轴的扭矩分配要看约束：本版只算单段轴' };
  const torqueLoad = graph.nodes.find((node) => node.kind === 'torqueArrow' && loadValueOf(node) !== null);
  let T = torqueLoad ? loadValueOf(torqueLoad) : null;
  if (T === null) {
    // 图上用文字写了「T = 1.0 kN·m」
    for (const node of graph.nodes) {
      if (node.kind !== 'text') continue;
      const text = node.label ?? '';
      if (!/[Tt]\s*[=＝]/.test(text)) continue;
      const found = valueFromLabel(text);
      if (typeof found === 'number' && Number.isFinite(found)) {
        T = found;
        break;
      }
    }
  }
  if (T === null || !(Math.abs(T) > 0)) return { why: '图上没有扭矩输入（扭矩箭头或「T=」标注）' };
  const L = numeric(graph.meta.L);
  if (L === undefined) return { why: '图上没给轴长 L' };
  const d = section.d;
  const G = section.G;
  if (d === undefined) return { why: '图上没给轴径 d：没有 Wp 就算不出切应力' };
  if (G === undefined) return { why: '图上没给切变模量 G：没有 GIp 就算不出扭转角' };
  const Wp = (Math.PI * d ** 3) / 16;
  const Ip = (Math.PI * d ** 4) / 32;
  const tau = (Math.abs(T) * 1e6) / Wp; // N·mm / mm³ = MPa
  const phi = (Math.abs(T) * 1e6 * (L * 1000)) / (G * 1000 * Ip); // rad
  return { T, L, tau, phi, Wp, Ip };
}

function beamMeasures(graph: CanvasGraph, frame: FrameSolution): Measure[] {
  const section = sectionOf(graph);
  const measures: Measure[] = [];
  const members = frame.members ?? [];
  // P0：结果区行名一律走图上标签（`n-sup-0` → `END-A · 固定铰`），不印内部 id。
  const labels = displayLabels(graph);

  /* 支座反力 */
  if (frame.reactions.length > 0) {
    // 全覆盖 F2：扭转题（轴 / 扭矩）不走梁的 Fx/Fy/Mz 三列 —— 全 0 的假列会让
    // 学生以为「固定端没有反力偶」。给真实的 Mx：绕轴平衡 ΣMx=0，固定端吃下
    // 全部外扭矩（静定轴只有一个约束端；多约束端不在通用解覆盖内，不硬造分配）。
    const torques = loadsOf(graph).filter((item) => item.kind === 'torqueArrow');
    const isShaft =
      graph.edges.some((edge) => edge.kind === 'shaft') || torques.length > 0;
    const fixedEnds = graph.nodes.filter((node) => node.support?.type === 'fixed');
    if (isShaft && fixedEnds.length === 1) {
      // 外扭矩两个来源：meta.T（M2 骨架把 T 放参数里，画布上只有反力偶 + 文字）
      // 与用户手放的扭矩箭头。
      const metaT = Number(graph.meta?.T);
      const tsum =
        (Number.isFinite(metaT) ? metaT : 0) + torques.reduce((sum, item) => sum + item.value, 0);
      measures.push({
        id: 'react',
        title: '扭矩反力（绕轴，右手定则；ΣMx=0）',
        rows: [
          {
            label: shownId(labels, fixedEnds[0].id),
            value: `Mx ${fmtMeasure(-tsum)} kN·m`,
          },
        ],
      });
    } else if (!isShaft || fixedEnds.length === 0) {
      measures.push({
        id: 'react',
        title: '支座反力（全局坐标，y 向上；力偶逆时针为正）',
        rows: frame.reactions.map((reaction) => ({
          label: shownId(labels, reaction.nodeId),
          // 这张卡固定按题面单位（kN / kN·m）显示：反力三个分量都带单位，
          // 不再出现“Fy 10”这种没有单位的数；顶部单位制只影响讲解稿 headline。
          value: `Fx ${fmtMeasure(reaction.fx)} kN · Fy ${fmtMeasure(reaction.fy)} kN · Mz ${fmtMeasure(reaction.mz)} kN·m`,
        })),
      });
    }
  }

  /* 内力：只有真的存在横向载荷 / 弯矩时才出（压杆不出空图） */
  const hasBending = frame.extremes.Mmax > 1e-9 || frame.extremes.Qmax > 1e-9;
  // 桁架没有弯矩，但「各杆内力」就是它被问的量 —— N 也要出现在同一张表里。
  const hasTruss = graph.edges.some((edge) => edge.kind === 'trussMember' || edge.kind === 'line');
  if (hasBending || hasTruss) {
    measures.push({
      id: 'internal',
      title: '内力（N 拉为正 / Q 顺时针为正 / M 下侧受拉为正）',
      headline: hasBending
        ? `|M|max = ${fmtMeasure(frame.extremes.Mmax, 4)} kN·m @ x = ${fmtMeasure(frame.extremes.atX, 4)} m · |Q|max = ${fmtMeasure(frame.extremes.Qmax, 4)} kN`
        : `各构件轴力（桁架）：max |N| = ${fmtMeasure(Math.max(...frame.memberEndForces.map((member) => Math.max(Math.abs(member.N[0]), Math.abs(member.N[1]))), 0), 4)} kN`,
      rows: frame.memberEndForces.map((member) => ({
        label: shownMember(
          labels,
          member.edgeId,
          members.find((item) => item.edgeId === member.edgeId),
        ),
        // 全覆盖 F8：桁架杆只传轴力，Q/M 列恒 0 还占地方 —— 只给 N；梁杆保持 N/Q/M 三列。
        // 每列都带题面单位，和上方 headline 同一口径。
        value: hasTruss && !hasBending
          ? `N ${fmtMeasure(member.N[0])}/${fmtMeasure(member.N[1])} kN`
          : `N ${fmtMeasure(member.N[0])}/${fmtMeasure(member.N[1])} kN · Q ${fmtMeasure(member.Q[0])}/${fmtMeasure(member.Q[1])} kN · M ${fmtMeasure(member.M[0])}/${fmtMeasure(member.M[1])} kN·m`,
      })),
      chart: internalChart(frame),
      note: '端值顺序：0 = 起点，L = 末端。',
    });
  }

  /* 弯曲应力 */
  const inertia = inertiaOf(section);
  if (hasBending && inertia.value !== undefined && section.h !== undefined) {
    const W = (section.b !== undefined ? (section.b * section.h ** 2) / 6 : (2 * inertia.value) / section.h);
    const sigma = (frame.extremes.Mmax * 1e6) / W;
    const allow = section.allow;
    measures.push({
      id: 'stress',
      title: '弯曲正应力 σ = M / W',
      headline: `σmax = ${fmtMeasure(sigma)} MPa${allow !== undefined ? `（[σ] = ${allow} MPa → ${sigma <= allow ? '通过' : '不通过'}）` : ''}`,
      rows: [
        { label: 'W（抗弯截面系数）', value: W, unit: 'mm³' },
        { label: '|M|max', value: frame.extremes.Mmax, unit: 'kN·m' },
        ...(allow !== undefined ? [{ label: '强度校核', value: sigma <= allow ? '通过' : `超过 ${fmtMeasure(sigma / allow)} 倍`, hint: `[σ] = ${allow} MPa` }] : []),
      ],
      tone: allow === undefined ? 'ok' : sigma <= allow ? 'ok' : 'bad',
      chart: stressChart(frame, W),
      note: '矩形截面 W = bh²/6；构件行里改过 I 时用 I/(h/2)。曲线是沿梁长的 σ(x)=M(x)/W，峰值即 σmax。',
    });
  } else if (hasBending && (inertia.value === undefined || section.h === undefined)) {
    measures.push({
      id: 'stress',
      title: '弯曲正应力 σ = M / W',
      rows: [],
      missing: `${inertia.why ?? '图上没给截面高度 h'}：σ = My/I 要截面尺寸，这张图只有弯矩。`,
    });
  }

  /* 位移 */
  // 位移只对「真的在弯」的图有意义：纯拉压杆的挠度是 0，不该占一张卡。
  if (members.length > 0 && hasBending) {
    const deflection = deflectionOf(frame, section);
    if ('why' in deflection) {
      measures.push({ id: 'deflection', title: '位移（挠度）', rows: [], missing: deflection.why });
    } else {
      measures.push({
        id: 'deflection',
        title: '位移（挠度曲线）',
        headline: `δmax = ${fmtMeasure(Math.abs(deflection.deltaMax) * 1000)} mm（${deflection.deltaMax < 0 ? '向下' : '向上'}）@ x = ${fmtMeasure(deflection.atX)} m`,
        rows: [
          { label: 'EI（这张图的抗弯刚度）', value: deflection.ei, unit: 'kN·m²' },
          { label: 'δmax', value: Math.abs(deflection.deltaMax) * 1000, unit: 'mm', hint: deflection.deltaMax < 0 ? '向下' : '向上' },
          { label: '位置', value: deflection.atX, unit: 'm' },
        ],
        chart: {
          id: 'deflection',
          title: '挠曲线 v(x)',
          unit: 'mm',
          xLabel: 'x (m)',
          yLabel: 'v (mm)',
          xDomain: [Math.min(...deflection.points.map((p) => p.gx)), Math.max(...deflection.points.map((p) => p.gx))],
          yDomain: (() => {
            const values = deflection.points.map((p) => p.v * 1000);
            const lo = Math.min(0, ...values);
            const hi = Math.max(0, ...values);
            const pad = hi - lo > 0 ? (hi - lo) * 0.1 : 1;
            return [lo - pad, hi + pad] as [number, number];
          })(),
          zeroLine: true,
          series: [{ kind: 'line' as const, label: 'v', points: deflection.points.map((p) => [p.gx, p.v * 1000] as [number, number]) }],
        },
        note: 'EI 由图上的 E 与截面算；位移按框架刚度法的单位刚度解反算（积分 M/EI 两次）。',
      });
    }
  }

  /* 稳定 */
  const stability = stabilityOf(graph, frame, section);
  if ('why' in stability) {
    if (numeric(graph.meta.mu) !== undefined) {
      measures.push({ id: 'stability', title: '压杆稳定', rows: [], missing: stability.why });
    }
  } else {
    const overEuler = stability.lam < stability.lamP;
    measures.push({
      id: 'stability',
      title: '压杆稳定（欧拉公式）',
      headline: `Pcr = ${fmtMeasure(stability.pcr)} kN · λ = ${fmtMeasure(stability.lam, 5)}${stability.P > 0 ? ` · n = Pcr/P = ${fmtMeasure(stability.pcr / stability.P, 4)}` : ''}`,
      rows: [
        { label: '计算长度 μL', value: stability.mu * stability.L, unit: 'm', hint: `μ = ${stability.mu}` },
        { label: '长细比 λ', value: stability.lam, hint: `λp = ${fmtMeasure(stability.lamP, 4)}` },
        { label: '临界应力 σcr', value: stability.sigmaCr, unit: 'MPa' },
        { label: '临界力 Pcr', value: stability.pcr, unit: 'kN' },
        ...(stability.P > 0 ? [{ label: '工作压力 P', value: stability.P, unit: 'kN' }] : []),
      ],
      tone: overEuler ? 'warn' : 'ok',
      note: overEuler
        ? `λ < λp（${fmtMeasure(stability.lamP, 4)}）：欧拉公式超出适用范围，Pcr 只作参考（中柔度要用经验公式）。`
        : 'λ ≥ λp：大柔度杆，欧拉公式适用。P 取图上载荷的绝对值（这张图靠 μ 声明自己是压杆题）。',
    });
  }

  /* 扭转 */
  const torsion = torsionOf(graph, section);
  if ('why' in torsion) {
    if (graph.edges.some((edge) => edge.kind === 'shaft')) {
      measures.push({ id: 'torsion', title: '扭转', rows: [], missing: torsion.why });
    }
  } else {
    measures.push({
      id: 'torsion',
      title: '扭转（τ = T/Wp，φ = TL/GIp）',
      headline: `τmax = ${fmtMeasure(torsion.tau)} MPa · φ = ${fmtMeasure(torsion.phi, 4)} rad`,
      rows: [
        { label: '扭矩 T', value: Math.abs(torsion.T), unit: 'kN·m' },
        { label: 'Wp', value: torsion.Wp, unit: 'mm³' },
        { label: 'Ip', value: torsion.Ip, unit: 'mm⁴' },
        { label: '轴长 L', value: torsion.L, unit: 'm' },
      ],
      note: '单段轴、一端固定一端自由；扭矩取图上扭矩箭头或「T=」标注。',
    });
  }

  /* 轴向（拉压杆）：无横向载荷、只有轴力 */
  const axialN = Math.max(...frame.memberEndForces.map((member) => Math.max(Math.abs(member.N[0]), Math.abs(member.N[1]))), 0);
  const declaredStrut = numeric(graph.meta.mu) !== undefined;
  if (!hasBending && !hasTruss && axialN > 1e-9 && !declaredStrut) {
    const area = areaOf(section);
    const E = section.edge.E ?? section.E;
    const L = numeric(graph.meta.L);
    const rows: MeasureRow[] = [{ label: '轴力 N', value: axialN, unit: 'kN' }];
    let headline: string | undefined;
    let missing: string | undefined;
    if (area.value === undefined) {
      missing = `${area.why}：σ = N/A 算不了`;
    } else {
      const sigma = (axialN * 1000) / area.value;
      rows.push({ label: '正应力 σ = N/A', value: sigma, unit: 'MPa' });
      headline = `σ = ${fmtMeasure(sigma)} MPa`;
      if (E !== undefined && L !== undefined) {
        const deltaL = (axialN * 1000 * (L * 1000)) / (E * 1000 * area.value);
        rows.push({ label: '伸长量 ΔL = NL/EA', value: deltaL, unit: 'mm' });
        headline = `σ = ${fmtMeasure(sigma)} MPa · ΔL = ${fmtMeasure(deltaL)} mm`;
      }
      const allow = section.allow;
      if (allow !== undefined) {
        rows.push({ label: '强度校核', value: sigma <= allow ? '通过' : `超过 ${fmtMeasure(sigma / allow)} 倍`, hint: `[σ] = ${allow} MPa` });
      }
    }
    measures.push({ id: 'axial', title: '轴向拉压', headline, rows, missing, tone: missing ? 'warn' : 'ok' });
  }

  return measures;
}

/* ── 电路族 ───────────────────────────────────────────────────── */

function pinNet(solution: CircuitSolution, nodeId: string, pin: string): string | undefined {
  return solution.netOfPin[`${nodeId}:${pin}`];
}

function pinVoltage(solution: CircuitSolution, nodeId: string, pin: string): number | undefined {
  const net = pinNet(solution, nodeId, pin);
  return net === undefined ? undefined : solution.nodeVoltages[net];
}

function circuitMeasures(graph: CanvasGraph, circuit: CircuitSolution): Measure[] {
  const measures: Measure[] = [];
  const transistors = graph.nodes.filter((node) => node.kind === 'npn' || node.kind === 'nmos');
  const diodes = graph.nodes.filter((node) => node.kind === 'diode');
  /**
   * 图上有一台**没标数值**的电压源 = 小信号测试源（1V）。
   * 这时解是「增量」不是「偏置」：工作区判定要的是直流偏置，不能在这里下结论
   * （A3 并联 100Ω 那例若硬判会得出「饱和」，因为 VCE 是 −252V 的增量值）。
   */
  const testSource = graph.nodes.find((node) => node.kind === 'vsrc' && node.value === undefined && valueFromLabel(node.label) === null);
  const smallSignal = Boolean(testSource);

  /* 工作点 */
  const opRows: MeasureRow[] = [];
  const regionRows: MeasureRow[] = [];
  for (const node of transistors) {
    const current = circuit.branchCurrents[node.id];
    const scale = smallSignal ? '（小信号增量）' : '';
    if (node.kind === 'npn') {
      const vbe = (pinVoltage(circuit, node.id, 'b') ?? 0) - (pinVoltage(circuit, node.id, 'e') ?? 0);
      const vce = (pinVoltage(circuit, node.id, 'c') ?? 0) - (pinVoltage(circuit, node.id, 'e') ?? 0);
      opRows.push({ label: `${node.label || node.id}（BJT）${scale}`, value: `VBE ${fmtMeasure(vbe, 4)} V · VCE ${fmtMeasure(vce, 4)} V · IC ${fmtMeasure((current ?? 0) * 1000, 4)} mA` });
      if (!smallSignal) {
        const region = vbe < 0.5 ? '截止' : vce < 0.3 ? '饱和' : '放大';
        regionRows.push({ label: `${node.label || node.id}`, value: region, hint: 'VBE<0.5→截止；VCE<0.3→饱和' });
      }
    } else {
      const vgs = (pinVoltage(circuit, node.id, 'g') ?? 0) - (pinVoltage(circuit, node.id, 's') ?? 0);
      const vds = (pinVoltage(circuit, node.id, 'd') ?? 0) - (pinVoltage(circuit, node.id, 's') ?? 0);
      const vth = node.params?.Vth ?? node.params?.vth ?? node.params?.th ?? 1;
      opRows.push({ label: `${node.label || node.id}（MOS）${scale}`, value: `VGS ${fmtMeasure(vgs, 4)} V · VDS ${fmtMeasure(vds, 4)} V · ID ${fmtMeasure((current ?? 0) * 1000, 4)} mA` });
      if (!smallSignal) {
        const region = vgs < vth ? '截止' : vds < vgs - vth ? '线性' : '饱和';
        regionRows.push({ label: `${node.label || node.id}`, value: region, hint: `Vth = ${fmtMeasure(vth)} V` });
      }
    }
  }
  if (opRows.length > 0) {
    measures.push({
      id: 'op',
      title: smallSignal ? '增量电压 / 电流（1V 测试源）' : '直流工作点',
      rows: opRows,
      note: smallSignal
        ? '这次解是 1V 测试源下的小信号增量，不是直流偏置 —— 工作区判定要看偏置，这里不判。'
        : '电压 = 该管脚所在电气点的电位差；电流取求解器给的分支电流（集电极 / 漏极）。',
    });
  }
  if (regionRows.length > 0) {
    measures.push({ id: 'region', title: '工作区判定', rows: regionRows, tone: 'ok' });
  }

  /* 增益：输入网 = 测试源（未标值）或小信号源（|V|≤1）；输出网按 W22-B 顺序：
     ① 命名网（tag=Vo/Vout/输出的边 → n-<tag> 别名键）② |v| 最大的非地非输入网 */
  const signalSource =
    testSource ??
    graph.nodes.find((node) => node.kind === 'vsrc' && typeof node.value === 'number' && Math.abs(node.value) <= 1);
  if (signalSource) {
    const inputNet = pinNet(circuit, signalSource.id, 'p') ?? pinNet(circuit, signalSource.id, 'a');
    const inputVoltage = inputNet ? circuit.nodeVoltages[inputNet] : undefined;
    let outputNet: string | undefined;
    let outputSource: string = '|v|max';
    if (OUTPUT_NET_CONFIG.preferNamedNet) {
      // 命名网：tag 标注（Vo / Vout / 输出）的边 → nodeVoltages 里的 n-<tag> 别名键。
      const named = graph.edges.find(
        (edge) => typeof edge.tag === 'string' && /^(vo|vout|v_out|输出.*)$/i.test(edge.tag),
      );
      const alias = named ? `n-${(named.tag as string).toLowerCase()}` : undefined;
      if (alias && alias !== inputNet && circuit.nodeVoltages[alias] !== undefined) {
        outputNet = alias;
        outputSource = 'tag 命名网';
      }
    }
    if (outputNet === undefined) {
      // 运放 / 无命名网：取电位绝对值最大的非地网（A6 就是 e-out#1 = −1V）
      const ranked = Object.entries(circuit.nodeVoltages)
        .filter(([net]) => net !== 'GND' && net !== inputNet && !net.startsWith('n-'))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      outputNet = ranked[0]?.[0];
    }
    const outputVoltage = outputNet ? circuit.nodeVoltages[outputNet] : undefined;
    if (typeof inputVoltage === 'number' && Math.abs(inputVoltage) > 1e-12 && typeof outputVoltage === 'number') {
      const gain = outputVoltage / inputVoltage;
      const testSourceOnly = signalSource === testSource;
      measures.push({
        id: 'gain',
        title: testSourceOnly ? '电压增益（1V 测试源）' : '电压增益（图上信号源）',
        headline: `Av = V(${outputNet}) / V(${inputNet}) = ${fmtMeasure(gain, 3)}`,
        rows: [
          { label: `输入 ${inputNet}`, value: inputVoltage, unit: 'V' },
          { label: `输出 ${outputNet}`, value: outputVoltage, unit: 'V' },
          { label: 'Av', value: gain },
        ],
        note: testSourceOnly
          ? `图上这台电压源没标数值，按 1V 测试源求值（输出即增益，输出网取自${outputSource}）；Ri/Ro 要看端口，这一版不给。`
          : `输入取图上 |V|≤1 的信号源（${fmtMeasure(Number(signalSource.value))} V）；输出取 ${outputNet ?? '—'}（${outputSource}）。Ri/Ro 这一版不给。`,
      });
    } else {
      measures.push({ id: 'gain', title: '电压增益', rows: [], missing: '找不到输入 / 输出网：图上没有信号源，或输出端没有可读的电位。' });
    }
  }

  /* 二极管 */
  if (diodes.length > 0) {
    measures.push({
      id: 'diode',
      title: '二极管（按 Vf + 1Ω 线性化）',
      rows: diodes.map((node) => {
        const va = pinVoltage(circuit, node.id, 'a') ?? 0;
        const vb = pinVoltage(circuit, node.id, 'b') ?? 0;
        const current = circuit.branchCurrents[node.id] ?? 0;
        return {
          label: node.label || node.id,
          value: `V ${fmtMeasure(va - vb, 4)} V · I ${fmtMeasure(current * 1000, 4)} mA`,
          hint: current < 0 ? '反偏（电流为负）' : undefined,
        };
      }),
      note: '反偏击穿 / 稳压管特性未建模：稳压、钳位这类题这一路只会给线性化近似。',
      tone: 'warn',
    });
  }

  /* 原始量 */
  measures.push({
    id: 'nodeV',
    title: '节点电位（引擎原始量）',
    rows: Object.entries(circuit.nodeVoltages).map(([net, voltage]) => ({ label: net, value: voltage, unit: 'V' })),
  });
  measures.push({
    id: 'power',
    title: '功率（器件吸收；源为负 = 供电）',
    rows: Object.entries(circuit.powers).map(([id, power]) => ({ label: id, value: power, unit: 'W' })),
  });
  measures.push({
    id: 'kcl',
    title: 'KCL 逐网残差（Σ流出电流）',
    rows: Object.entries(circuit.kclByNet)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6)
      .map(([net, sum]) => ({ label: net, value: sum, unit: 'A' })),
    note: `最差 ${circuit.residual.node} = ${circuit.residual.kclMax.toExponential(2)}；MNA 残差 ${circuit.residual.mnaMax.toExponential(2)}。`,
  });

  return measures;
}

/* ── 入口 ─────────────────────────────────────────────────────── */

/**
 * 这张图问什么。**只看图和它的解**，不看 templateId。
 * `MEASURE_CONFIG.readTemplateId` 是变异位：翻成 true 会退化回「按题型决定问什么」。
 */
export function interpretQuestion(graph: CanvasGraph, family: 'circuit' | 'beam', solved: SolvedInput): Measure[] {
  const measures = family === 'beam' && solved.frame ? beamMeasures(graph, solved.frame) : solved.circuit ? circuitMeasures(graph, solved.circuit) : [];
  if (!MEASURE_CONFIG.readTemplateId) return measures;
  // 变异路径：按题型只留「这一型该问的」（错的做法，门禁 ① 抓它）
  const byTemplate: Record<string, Measure['id'][]> = { M5: ['internal'], M7: ['internal'], A3: ['gain'], A5: ['gain'] };
  const only = byTemplate[graph.templateId];
  return only ? measures.filter((measure) => only.includes(measure.id)) : measures;
}

/**
 * W21-A A3 · 文案按「这张图实际能给出什么」分支，而不是按通用免责条。
 *
 * 模板 solver 的 warnings 里有一条硬边界「本工具不计算变形」。M3（没截面）
 * 说得对，M5（已经算出 δmax 和挠曲线）就是当着用户面推翻自己。这里让文案
 * 层复用 measures 的能力判定：**能出 deflection 就不许再说不计算变形**。
 * 页面、门禁共用这一个纯函数，不各写一份字符串匹配。
 */
export function beamCapabilities(graph: CanvasGraph): string[] {
  if (graph.family !== 'beam') return [];
  try {
    const frame = frameSolve(graph);
    return interpretQuestion(graph, 'beam', { frame })
      .filter((measure) => !measure.missing)
      .map((measure) => measure.id);
  } catch {
    // 机构 / 没支座：这张图目前什么量都给不出，免责条照旧。
    return [];
  }
}

export function filterWarningsByCapability(
  warnings: readonly string[],
  capabilities: readonly string[],
): string[] {
  if (!capabilities.includes('deflection')) return [...warnings];
  return warnings.filter((warning) => !warning.includes('不计算变形'));
}

/** 结果视图用：把 measures 压成一句结论（横幅下面的副标题）。 */
export function summarizeMeasures(measures: readonly Measure[]): string {
  const headlines = measures.map((measure) => measure.headline).filter((line): line is string => Boolean(line));
  if (headlines.length > 0) return headlines.slice(0, 2).join(' · ');
  const missing = measures.filter((measure) => measure.missing).length;
  if (measures.length === 0) return '这张图问什么还认不出来';
  if (missing > 0) return `${missing} 项要补输入才能算（见下）`;
  return `${measures.length} 项结果`;
}
