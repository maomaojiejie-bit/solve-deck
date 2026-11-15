/**
 * W15-S4 通用求解接入：装配台「分步求解」的两级入口。
 *
 * 图与该型骨架逐器件一致（归约无硬伤）→ 走模板五步（讲解稿），现状不动；
 * 归约有硬伤（删器件 / 骨架不符 / 参数找不到来源）→ **不再拒答**，按族调
 * netSolve / frameSolve 渲染通用结果（N 档，skipReason「无讲解稿，已用通用求解」）；
 * 通用求解器也解不动（拓扑非法：noGround / geometricUnstable / shortVSource /
 * vSourceLoop / floatingNet…）→ 才是真正的 U 档拒答。
 *
 * 变异开关：check:labresolve 把 genericOnMismatch 关掉 = 「骨架不符也走模板」
 * 写回去（旧行为：一律拒答）→ 第 ② 条红。
 *
 * 已有门禁的档位语义在此收口（不破坏）：
 *  - check:assemble ㉕① 删 e-c-bus（开路）→ netSolve floatingNet → 仍 U；
 *  - check:assemble ⑦ 删杆成机构 → frameSolve 抛「几何不稳定」→ 仍 U；
 *  - W16 两级开路的「整器件悬空」是警告不阻断 → 无硬伤 → 模板路径不变。
 */

import { PICKS, valueFromLabel } from './picks.ts';
import { supportRefs, rotToDir } from './attach.ts';
import { reduce } from './reduce.ts';
import { isBlockingProblem } from './composite.ts';
import { interpretQuestion, type Measure } from './measures.ts';
import type { CanvasGraph, ReduceResult } from './types.ts';
import { netSolve, NO_GROUND_REASON, type CircuitSolution, type NetSolveOptions, type NetSolveOutcome } from './netSolve.ts';
import { frameSolve, type FrameSolution } from './frameSolve.ts';

export const RESOLVE_CONFIG = { genericOnMismatch: true };

/**
 * W18-E 支座钉结点：任何支座若没有落在某个结点上（距离 > 0.6px），判 U
 * 「几何不合法」，不许照常出数 —— frameSolve 只吃坐标，会把悬空支座静默
 * 吸附到最近结点，给出看似合法的数字，这正是「有时候杆不在支座上还能解」
 * 的来源。判据在**模板早退之前**查（模板路径的 solver 不看坐标，同样不许过）。
 * enforce 变异位：check:assemble ㉙ 把它关掉验红。
 */
export const SUPPORT_PIN_CONFIG = { tolerance: 0.6, enforce: true };

/**
 * 力学族：支座没有落在结点上的问题清单（空 = 全部钉住了）。
 * R3-1 A1 起支座是结点属性 —— 属性形态不可能悬空，所以这里实际只拦**旧形态**：
 * 折叠不到结点上的图元（旧分享链接 / 手改数据）。判据不删、不降级：那种图照旧 U。
 */
export function supportOffJointProblems(graph: CanvasGraph): string[] {
  if (!SUPPORT_PIN_CONFIG.enforce) return [];
  if ((PICKS[graph.templateId]?.family ?? graph.family) !== 'beam') return [];
  const problems: string[] = [];
  for (const ref of supportRefs(graph)) {
    if (ref.nodeForm && ref.jointId === null) {
      problems.push(
        `支座「${ref.label || ref.kind}」（${ref.id}）没有落在结点上：支座要挂在结点上（选中结点再加），否则杆端悬空、解出的数是假的。`,
      );
    }
  }
  return problems;
}

/**
 * 画布上的电压源没种数值时（A3 的 Vs 只在题面/模板语义里），通用求解按 S1
 * 的同一约定给 1V 测试源（输出即增益值），并返回 defaultedVsrc 让页面如实
 * 标注。导出供门禁做「与直接调 netSolve 逐位相等」的对照（单一来源）。
 */
export function netSolveOptionsFor(graph: CanvasGraph): { options: NetSolveOptions; defaultedVsrc: string[] } {
  const vsrcValues: Record<string, number> = {};
  const defaultedVsrc: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'vsrc') continue;
    if (typeof node.value === 'number') continue;
    const fromLabel = valueFromLabel(node.label);
    if (fromLabel !== null) vsrcValues[node.id] = fromLabel;
    else {
      vsrcValues[node.id] = 1;
      defaultedVsrc.push(node.id);
    }
  }
  return { options: Object.keys(vsrcValues).length > 0 ? { vsrcValues } : {}, defaultedVsrc };
}

export type LabSolveRoute =
  | { kind: 'template'; result: ReduceResult }
  | {
      kind: 'generic';
      family: 'circuit' | 'beam';
      circuit?: CircuitSolution;
      frame?: FrameSolution;
      notices: string[];
      /** W19：这张图问什么（结果视图的主内容）。 */
      measures: Measure[];
      /** 为什么落到通用求解（三态横幅用）。 */
      reason: 'skeleton' | 'unmodeled' | 'healed';
    }
  | { kind: 'refused'; code: string; reason: string };

/**
 * W19：**模板不认识的元件** —— 接了线、却不在归约表引用集合里的器件。
 *
 * 这是「图变了、答案没变」的病根：A3 并联一个 100Ω（白名单内、不触发任何
 * rejects）→ 归约参数逐键不变 → 仍走模板 → 屏幕上还是旧 Av。这类图必须
 * 交给通用求解按图算。
 *
 * 只看**接了线**的器件：从面板加进来但还没连线的悬空器件不影响电路，不算。
 */
export function unmodeledDevices(graph: CanvasGraph, templateId: string): string[] {
  const picks = PICKS[templateId];
  if (!picks) return [];
  if (graph.family === 'circuit') return unmodeledCircuitDevices(graph, picks, templateId);
  return unmodeledBeamLoads(graph, picks, templateId);
}

/** 电路：接了线、却不在归约表引用集合里的器件。 */
function unmodeledCircuitDevices(graph: CanvasGraph, picks: NonNullable<(typeof PICKS)[string]>, templateId: string): string[] {
  const tokens = new Set<string>();
  for (const pick of picks.picks) {
    for (const source of pick.sources) {
      if ('device' in source && typeof source.device === 'string') tokens.add(source.device.toUpperCase());
    }
  }
  const wired = new Set<string>();
  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to]) {
      if (typeof end !== 'string') continue;
      const cut = end.indexOf(':');
      if (cut > 0) wired.add(end.slice(0, cut));
      else wired.add(end);
    }
  }
  const skip = new Set(['gnd', 'dot', 'pin', 'text']);
  const problems: string[] = [];
  for (const node of graph.nodes) {
    if (skip.has(node.kind)) continue;
    if (node.compositeId) continue; // 复合器件由展开逻辑管
    if (!wired.has(node.id)) continue;
    const bare = node.id.replace(/^n-/, '').toUpperCase();
    const label = (node.label ?? '').toUpperCase();
    const known = [...tokens].some((token) => bare === token || bare.startsWith(`${token}-`) || label.startsWith(token));
    if (!known) {
      problems.push(
        `器件「${node.label || node.id}」（${node.kind}）接了线，但 ${templateId} 的归约表不认识它 —— 讲解稿算不到它，按这张图求解。`,
      );
    }
  }
  return problems;
}

/** 梁族：归约表根本没有引用的载荷类型（例如 M2 的扭矩——它读的是标注文字，不是扭矩箭头）。 */
function unmodeledBeamLoads(graph: CanvasGraph, picks: NonNullable<(typeof PICKS)[string]>, templateId: string): string[] {
  const consumed = new Set<string>();
  for (const pick of picks.picks) {
    for (const source of pick.sources) {
      if ('src' in source && source.src === 'load' && typeof source.type === 'string') consumed.add(source.type);
    }
  }
  const kindOf: Record<string, string> = { arrow: 'point', udl: 'udl', momentArrow: 'moment', torqueArrow: 'torque' };
  const element = picks.element ?? 'beam';
  const axialElement = element === 'bar' || element === 'shaft';
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const node of graph.nodes) {
    const type = kindOf[node.kind];
    if (!type) continue;
    // 方向必须跟元素对得上：梁的读法只有竖向（↓ / ↑），杆 / 轴的读法只有沿轴（→ 拉 / ← 压）。
    // 对不上的不让模板硬算 —— 交给刚架通用解（它按 rot 真的分成 fx / fy），
    // 否则画布画的是水平箭头、讲解稿按竖向 P 解，画与算相反。
    if (type === 'point' && consumed.has(type)) {
      const dir = rotToDir(node.rot);
      const along = dir === 90 || dir === 270;
      if (axialElement && !along) {
        problems.push(
          `载荷「${node.label || node.id}」是竖向的：${templateId} 是轴力题，只认沿杆轴的集中力（→ 拉力 / ← 压力）。竖向箭头按刚架通用解算，讲解稿不再适用。`,
        );
        continue;
      }
      if (!axialElement && along) {
        problems.push(
          `载荷「${node.label || node.id}」是水平的：${templateId} 的讲解稿只认竖向集中力（↓ 向下 / ↑ 向上）。水平箭头按刚架通用解算（轴力、剪力都有），讲解稿不再适用。`,
        );
        continue;
      }
    }
    if (consumed.has(type) || seen.has(type)) continue;
    seen.add(type);
    problems.push(
      `载荷「${node.label || node.id}」（${type}）不在 ${templateId} 的归约表读法里 —— 讲解稿算不到它，按这张图求解。`,
    );
  }
  return problems;
}

/** 通用路由：解完就把「这张图问什么」整理出来（只有这一处产出 measures）。 */
function genericRoute(
  graph: CanvasGraph,
  family: 'circuit' | 'beam',
  solved: { circuit?: CircuitSolution; frame?: FrameSolution },
  notices: string[],
  reason: 'skeleton' | 'unmodeled' | 'healed',
  /** 图里少了关键器件（blocking 不为空）：算出来的增益是「残图的线性解」，
   *  不是本题答案 —— 数值照给，但必须当场标明（巡检 B5：缺晶体管时印了个 Av=0）。 */
  incomplete = false,
): LabSolveRoute {
  // W22-B：电路族的通用解一律按交流小信号口径 —— 图上有 C / L 时结果卡要说清。
  const acNotice =
    family === 'circuit' && graph.nodes.some((node) => node.kind === 'cap' || node.kind === 'ind')
      ? ['交流小信号口径：C 视为短路、L 视为开路 —— 增益等小信号量按这个口径现算']
      : [];
  const measures = interpretQuestion(graph, family === 'beam' ? 'beam' : 'circuit', solved);
  if (incomplete) {
    for (const measure of measures) {
      if (measure.id !== 'gain') continue;
      measure.title = '电压增益（残图，不是答案）';
      measure.tone = 'warn';
      measure.note = `这张图缺关键器件，下面这个 Av 只是残图的线性解 —— 补回器件再求解才是本题答案。${measure.note ?? ''}`;
    }
  }
  return {
    kind: 'generic',
    family,
    circuit: solved.circuit,
    frame: solved.frame,
    notices: [...notices, ...acNotice],
    measures,
    reason,
  };
}

/**
 * 电路族：画布上必须有接地符号。模板路径的 solver 只读归约出来的器件数值、
 * 根本不看 gnd，所以删掉 gnd 后归约照旧齐全 → 走模板 → 屏幕上出数，
 * 与通用路径的 noGround 拒答自相矛盾（同一个「没有参考点」的图，点空画布
 * 拒答、删 gnd 却给数）。判据先于模板早退，覆盖全部路由。
 *
 * enforce 变异位：check:labresolve ⑧ 把它关掉 → 删 gnd 又照常出数，必红。
 */
export const GROUND_GATE_CONFIG = { enforce: true };

/** 接地判据：电路族没有 gnd 符号时返回一句话（空数组 = 通过）。 */
export function noGroundProblems(graph: CanvasGraph): string[] {
  if (!GROUND_GATE_CONFIG.enforce) return [];
  const family = PICKS[graph.templateId]?.family ?? graph.family;
  if (family !== 'circuit') return [];
  if (graph.nodes.some((node) => node.kind === 'gnd')) return [];
  // 复合器件里带 gnd 的极少见；真带了就按「有地」放过，交给 netSolve 展开后再判。
  if (graph.nodes.some((node) => node.compositeId && node.kind === 'gnd')) return [];
  return [NO_GROUND_REASON];
}

export function resolveLabSolve(templateId: string, graph: CanvasGraph, rules: readonly string[] = []): LabSolveRoute {
  // W18-E：支座没钉在结点上 → 一律 U（先于模板早退，覆盖全部路由）。
  const supportProblems = supportOffJointProblems(graph);
  if (supportProblems.length > 0) {
    return { kind: 'refused', code: 'supportOffJoint', reason: supportProblems.join('；') };
  }
  // A1 这一型的归约表不含 gnd：删地后仍「无硬伤」，模板路径会照常出数 —— 先拦。
  const groundProblems = noGroundProblems(graph);
  if (groundProblems.length > 0) {
    return { kind: 'refused', code: 'noGround', reason: groundProblems.join('；') };
  }
  const result = reduce(templateId, graph, rules);
  const blocking = result.problems.filter(isBlockingProblem);
  // W19：图上有归约表不认识的元件（接线了）→ 模板的答案不是这张图的答案。
  const unmodeled = unmodeledDevices(graph, templateId);
  // W17-A 删除即合并：串联器件（如 Rs）删掉后两端已合并、归约给出 0 值，
  // 但模板讲解稿按 Rs>0 推导（A3 solver 硬性要求 Rs>0，红线不改它）——
  // 这类图路由到通用求解（netSolve 现算），params.Rs=0 仍是归约产物与证据。
  if (blocking.length === 0 && graph.meta.healedSeries === undefined && unmodeled.length === 0) {
    return { kind: 'template', result };
  }
  if (!RESOLVE_CONFIG.genericOnMismatch) {
    // 旧行为（变异位）：骨架不符一律拒答，不试通用求解
    return { kind: 'refused', code: 'skeletonMismatch', reason: [...blocking, ...unmodeled].join('；') };
  }
  const family = PICKS[templateId]?.family ?? graph.family;
  const reason = unmodeled.length > 0 && blocking.length === 0 ? 'unmodeled' : graph.meta.healedSeries !== undefined && blocking.length === 0 ? 'healed' : 'skeleton';
  if (blocking.length === 0) {
    // healedSeries / 未建模元件：拓扑合法、归约齐全，只是讲解稿不再适用。
    if (family === 'beam') {
      try {
        const frame = frameSolve(graph);
        return genericRoute(graph, 'beam', { frame }, unmodeled, reason);
      } catch (error) {
        return {
          kind: 'refused',
          code: 'geometricUnstable',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const healedNames = String(graph.meta.healedSeries ?? '').split(',').filter(Boolean);
    const { options, defaultedVsrc } = netSolveOptionsFor(graph);
    // W22-B：装配台的增益 / Ri / Ro 类 measure 一律走交流小信号口径（C 短路、L 开路）。
    const outcome: NetSolveOutcome = netSolve(graph, { ...options, mode: 'ac' });
    if (outcome.ok) {
      const notices = healedNames.map(
        (name) => `已删除器件「${name}」并两端合并（参数记 0）：讲解稿按该器件存在推导，这里用通用求解对这张图现算`,
      );
      notices.push(...unmodeled);
      notices.push(
        ...defaultedVsrc.map((id) => `电压源「${id}」画布上没标数值，按 1V 测试源求值（输出即增益/响应值）`),
      );
      return genericRoute(graph, 'circuit', { circuit: outcome.solution }, notices, reason);
    }
    return { kind: 'refused', code: outcome.code, reason: outcome.reason };
  }
  // 纯断线（器件都在、只是导线断了：W16 半接半悬判据）→ 维持断线阻断，如实拒。
  // 器件没了（骨架不符 / 参数找不到来源）才走通用求解 —— 对断线图硬解会把
  // 线性模型推到荒谬电压（集电极悬空 → ro 上千伏），拒比解诚实。
  // 但拓扑非法码优先：删 gnd 也是「断线」形态，该报 noGround 就报 noGround。
  const structural = blocking.filter((problem) => !problem.startsWith('开路：'));
  if (structural.length === 0) {
    if (family === 'circuit') {
      const outcome: NetSolveOutcome = netSolve(graph, netSolveOptionsFor(graph).options);
      if (!outcome.ok) return { kind: 'refused', code: outcome.code, reason: outcome.reason };
    }
    return { kind: 'refused', code: 'openCircuit', reason: blocking.join('；') };
  }
  // 阻断问题透传到结果面板（如「删 Rs 后基极开路」——面板里的 0 值就有了人话解释）
  const notices = blocking.slice(0, 3);
  if (family === 'beam') {
    try {
      const frame = frameSolve(graph);
      return genericRoute(graph, 'beam', { frame }, notices, 'skeleton', true);
    } catch (error) {
      return {
        kind: 'refused',
        code: 'geometricUnstable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const { options, defaultedVsrc } = netSolveOptionsFor(graph);
  const outcome: NetSolveOutcome = netSolve(graph, options);
  if (outcome.ok) {
    notices.push(
      ...defaultedVsrc.map((id) => `电压源「${id}」画布上没标数值，按 1V 测试源求值（输出即增益/响应值）`),
    );
    return genericRoute(graph, 'circuit', { circuit: outcome.solution }, notices, 'skeleton', true);
  }
  return { kind: 'refused', code: outcome.code, reason: outcome.reason };
}
