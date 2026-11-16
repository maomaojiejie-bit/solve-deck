/**
 * 拼接台的 UI 动作层 —— 页面按钮和门禁共用同一套状态机。
 *
 * 这一层存在的理由：门禁要验的是「用户点的那一串动作」（删杆 → 出现判据 →
 * 恢复骨架 → 回到可解），不是直接构造一个模型塞给 reduce()。
 * 页面每一处 mutate / 恢复 / 求解都调 labUiStep；门禁按同样顺序派发动作，
 * 读的是状态里的 preview / verdict（即页面上那张归约预览卡的内容）。
 */

import type { RenderSpec } from '../types.ts';
import type { ParamValue } from '../templates/registry.ts';
import { applyOp } from './ops.ts';
import { reduce } from './reduce.ts';
import { effectiveSemantic, semanticCheck, type SemanticCheck } from './semantics.ts';
import { freshSkeleton } from './skeleton.ts';
import { tierOf, genericVerdict, type LabVerdict } from './tiers.ts';
import { PICKS } from './picks.ts';
import { resolveLabSolve, supportOffJointProblems, noGroundProblems } from './resolve.ts';
import { emptySession, wireClick, type PointerHit, type PointerSession } from './pointer.ts';
import { relayout } from './pins.ts';
import { countComposites, isBlockingProblem } from './composite.ts';
import type { CanvasGraph, CanvasNode, GraphOp, LabTier } from './types.ts';

export interface UiPreview {
  params: Record<string, number | string>;
  problems: string[];
  appliedRules: string[];
  /** 黑盒 #19：落了骨架默认值的键 → 解释；参数行据此在求解前标注。 */
  defaultsUsed: Record<string, string>;
  semantic: SemanticCheck;
  tier: LabTier;
}

/* ── W14 撤销 / 重做 ─────────────────────────────────────────────── */

/** 一份可回退的快照：图 + 证据规则 + 归约参数。 */
export interface LabSnapshot {
  graph: CanvasGraph;
  rules: string[];
  params: Record<string, number | string>;
}

/** 栈深上限：超出丢最旧。 */
export const UNDO_LIMIT = 30;

/**
 * W18-E 支座跟随：拖结点时共点支座随之移动（拖支座 = 拖它吸附的结点）。
 * follow 变异位：check:assemble ㉙ 关掉 → 「拖 n-A 后 n-sup-A 必须跟随」红。
 */
export const SUPPORT_FOLLOW_CONFIG = { follow: true, tolerance: 0.6 };

/** 入栈的结构操作（W14 文档清单；addSupport/addLoad 是力学侧的 addDevice 同类，一并入栈）。 */
export const UNDOABLE_OPS = new Set([
  'clearGraph',
  'deleteDevice',
  'addDevice',
  'addEdge',
  'addMember',
  'deleteMember',
  'wrapComposite',
  'expandComposite',
  'collapseComposite',
  'unwrapComposite',
  'changeKind',
  'setSemantic',
  'addSupport',
  'addLoad',
  // R3-1：支座改类型 / 摘掉、载荷改方向 / 挪到跨内 t —— 都是可撤销的结构编辑。
  'setSupport',
  'setLoadDir',
  'setLoadT',
  // W16 三个缺失的操作：改值 / 旋转 / 删线都是可撤销的结构编辑。
  'setDeviceValue',
  // W24：补模型参数（gm / ro…）也是一次可撤销的结构编辑。
  'setDeviceParams',
  'rotateDevice',
  'deleteEdge',
  // W17-C：杆的截面属性（A / I / E）也是可撤销的结构编辑。
  'setMemberProps',
  // R3-4 U1：空白放结点、点杆切段 —— 与加杆同级的结构编辑。
  'addNode',
  'splitMember',
]);

/**
 * 变异开关（check:undo 用）：restoreRules=false → 撤销不回退 appliedRules（第 1 条红）；
 * respectLimit=false → 栈无上限（第 3 条红）；dragSnapshots=true → 拖动也进栈
 * （check:assemble ㉖ 变异：拖动不该产生历史）。
 */
export const UNDO_CONFIG = { restoreRules: true, respectLimit: true, dragSnapshots: false };

const snapshotOf = (state: LabUiState): LabSnapshot => ({
  graph: state.graph,
  rules: state.rules,
  params: { ...state.preview.params },
});

export interface LabUiState {
  graph: CanvasGraph;
  rules: string[];
  dirty: boolean;
  preview: UiPreview;
  verdict: LabVerdict | null;
  /** 上一步的人话（拒绝操作 / 恢复成功），页面 toast 用。 */
  note: string;
  /** 画布两次点击的会话（第一个引脚 / 橡皮筋起点）。 */
  wire: PointerSession;
  /** 撤销 / 重做快照栈（上限 UNDO_LIMIT，超出丢最旧）。 */
  undoStack: LabSnapshot[];
  redoStack: LabSnapshot[];
}

export type LabUiAction =
  | { type: 'op'; op: GraphOp }
  | { type: 'reset'; templateId: string; spec: RenderSpec }
  | { type: 'solve' }
  /** 拖动：pointermove 只改坐标；pointerup 才 relayout 全部导线。 */
  | { type: 'moveNode'; nodeId: string; x: number; y: number }
  | { type: 'moveNodeEnd'; before: CanvasGraph }
  /** 双击节点：对整张图跑一次 relayout（把端点重新吸附回引脚）。 */
  | { type: 'autoLayout' }
  /** 载入三候选之一（换骨架，不改求解器）。 */
  | { type: 'loadCandidate'; candidateId: string; baseTemplateId: string; spec: RenderSpec; defaults: Record<string, ParamValue> }
  /** 「只看看」：显式动作，state 必须原样返回。 */
  | { type: 'peekCandidate'; candidateId: string }
  /** W14 撤销 / 重做。 */
  | { type: 'undo' }
  | { type: 'redo' };

/** 右侧「归约预览」卡的数据：结构判据 + 语义判据 + 三档结论。 */
export function previewOf(templateId: string, graph: CanvasGraph, rules: readonly string[]): UiPreview {
  const result = reduce(templateId, graph, rules);
  const semantic = semanticCheck(templateId, graph);
  const verdict = verdictPreviewOf(templateId, graph, rules, result, semantic);
  return {
    params: result.params,
    problems: result.problems,
    appliedRules: result.appliedRules,
    defaultsUsed: result.defaultsUsed ?? {},
    semantic,
    tier: verdict.tier,
  };
}

/**
 * W15-S4：档位判据与 solve 的两级入口同源。
 * 归约有硬伤不再直接 U —— 先看通用求解器收不收：收 → N（无讲解稿，已用通用
 * 求解）；不收（拓扑非法）→ U。无硬伤维持既有 tierOf（F / 语义 N）。
 */
function verdictPreviewOf(
  templateId: string,
  graph: CanvasGraph,
  rules: readonly string[],
  result: ReturnType<typeof reduce>,
  semantic: SemanticCheck,
): LabVerdict {
  // W18-E：支座没钉在结点上 → 一律 U（与 resolveLabSolve 的拒答同源同话术）。
  const supportOff = supportOffJointProblems(graph);
  if (supportOff.length > 0) {
    return {
      tier: 'U',
      headline: '本题解不动，不渲染数值',
      detail: supportOff.join('；'),
      substitute: [
        { label: '恢复骨架重试', hash: '' },
        { label: '换一个题型', hash: '#/lab' },
      ],
    };
  }
  const blocking = result.problems.filter(isBlockingProblem);
  // 接地判据：与 resolveLabSolve 同源同话术 —— 删 gnd 后归约仍「无硬伤」，
  // 以前这里会照旧给 F，屏幕上盖章、求解却拒答（自相矛盾）。
  const noGnd = noGroundProblems(graph);
  if (noGnd.length > 0) {
    return {
      tier: 'U',
      headline: '本题解不动，不渲染数值',
      detail: noGnd.join('；'),
      substitute: [
        { label: '恢复骨架重试', hash: '' },
        { label: '换一个题型', hash: '#/lab' },
      ],
    };
  }
  // W17-A：删即合并后的图拓扑合法但模板讲解稿不适用（solver 要求被合并器件 > 0）
  // → 档位与 resolve 的 generic 路由同源给 N，不再亮 F。
  if (blocking.length === 0 && graph.meta.healedSeries !== undefined) {
    return genericVerdict(PICKS[templateId]?.family ?? graph.family);
  }
  if (blocking.length === 0) {
    return verdictOf(result.outOfScope, result.problems, semantic, countComposites(graph), PICKS[templateId]?.family ?? graph.family);
  }
  const route = resolveLabSolve(templateId, graph, rules);
  if (route.kind === 'refused') {
    return {
      tier: 'U',
      headline: '本题解不动，不渲染数值',
      detail: route.reason,
      substitute: [
        { label: '恢复骨架重试', hash: '' },
        { label: '换一个题型', hash: '#/lab' },
      ],
    };
  }
  if (route.kind === 'generic') return genericVerdict(route.family);
  // 不可达（有硬伤时 resolve 不会给 template）；保险落 N 档
  return genericVerdict('circuit');
}

export function verdictOf(
  outOfScope: boolean,
  problems: readonly string[],
  semantic: SemanticCheck,
  composites = 0,
  family?: 'circuit' | 'beam',
): LabVerdict {
  return tierOf({
    outOfScope,
    scopeOk: outOfScope ? 'fail' : 'pass',
    problems,
    semantic: effectiveSemantic(semantic),
    composites,
    family,
  });
}

export function createUiState(templateId: string, graph: CanvasGraph): LabUiState {
  return {
    graph,
    rules: [],
    dirty: false,
    preview: previewOf(templateId, graph, []),
    verdict: null,
    note: '',
    wire: emptySession(),
    undoStack: [],
    redoStack: [],
  };
}

/**
 * 画布点一下：两次点击连线走的就是这个函数。门禁派发 pointerdown 序列时
 * 调它与页面完全同源 —— 拒绝时图与 dirty 一动不动，只给一句人话。
 */
export function labUiClick(templateId: string, state: LabUiState, hit: PointerHit): LabUiState {
  const outcome = wireClick(state.graph, state.wire, hit);
  if (!outcome.verdict) {
    return { ...state, wire: outcome.session, ...(outcome.note ? { note: outcome.note } : {}) };
  }
  if (!outcome.verdict.ok) {
    return { ...state, wire: outcome.session, note: outcome.verdict.reason ?? '' };
  }
  const op = outcome.verdict.op;
  if (!op) return { ...state, wire: outcome.session };
  const next = labUiStep(templateId, state, { type: 'op', op });
  return { ...next, wire: outcome.session };
}

/** 派发一个 UI 动作；任何一步都自动刷新预览（页面与门禁所见即同一份）。 */
export function labUiStep(templateId: string, state: LabUiState, action: LabUiAction): LabUiState {
  if (action.type === 'op') {
    const out = applyOp(templateId, state.graph, action.op);
    if (out.refused) return { ...state, note: out.refused };
    // W14：结构操作入栈（拖动 / 参数写回不入栈），新操作清空重做栈。
    let undoStack = state.undoStack;
    let redoStack = state.redoStack;
    if (UNDOABLE_OPS.has(action.op.op)) {
      undoStack = [...state.undoStack, snapshotOf(state)];
      if (UNDO_CONFIG.respectLimit && undoStack.length > UNDO_LIMIT) undoStack = undoStack.slice(undoStack.length - UNDO_LIMIT);
      redoStack = [];
    }
    // R3 修复：参数实验场拖滑杆每次节流触发都 append 同一条「参数表改动已写回图」，
    // 日志瞬间一大片重复行。这里对**连续重复**的 rule 去重（同一条不动图的话只留最新），
    // 并把清单封顶在 40 条（保留最新的，更早的丢弃）—— 结构证据仍然逐条可查。
    const rules = [...state.rules, ...out.rules]
      .filter((rule, index, all) => index === 0 || rule !== all[index - 1])
      .slice(-40);
    return {
      ...state,
      graph: out.graph,
      rules,
      dirty: true,
      preview: previewOf(templateId, out.graph, rules),
      verdict: null,
      // W16：setDeviceValue 这类非结构改动 rules 为空，人话在 out.note。
      note: out.note ?? (out.rules.length > 0 ? out.rules[out.rules.length - 1] : ''),
      undoStack,
      redoStack,
    };
  }
  if (action.type === 'undo') {
    if (state.undoStack.length === 0) return { ...state, note: '没有可撤销的操作' };
    const snap = state.undoStack[state.undoStack.length - 1];
    const graph = snap.graph;
    const rules = UNDO_CONFIG.restoreRules ? snap.rules : state.rules;
    return {
      ...state,
      graph,
      rules,
      dirty: true,
      preview: previewOf(templateId, graph, rules),
      verdict: null,
      note: '已撤销：回到上一步结构',
      wire: emptySession(),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshotOf(state)].slice(-UNDO_LIMIT),
    };
  }
  if (action.type === 'redo') {
    if (state.redoStack.length === 0) return { ...state, note: '没有可重做的操作' };
    const snap = state.redoStack[state.redoStack.length - 1];
    const graph = snap.graph;
    const rules = UNDO_CONFIG.restoreRules ? snap.rules : state.rules;
    return {
      ...state,
      graph,
      rules,
      dirty: true,
      preview: previewOf(templateId, graph, rules),
      verdict: null,
      note: '已重做',
      wire: emptySession(),
      undoStack: [...state.undoStack, snapshotOf(state)].slice(-UNDO_LIMIT),
      redoStack: state.redoStack.slice(0, -1),
    };
  }
  if (action.type === 'reset') {
    const fresh = freshSkeleton(action.templateId, action.spec);
    return {
      // W22-A：resetAt 自增 —— Lab 的画布 / 列表树以此为 key 强制 remount，
      // 不依赖 reconciliation 自己收敛（旧图残留是 id 复用的窝点）。
      graph: { ...fresh, meta: { ...fresh.meta, resetAt: (typeof state.graph.meta.resetAt === 'number' ? state.graph.meta.resetAt : 0) + 1 } },
      rules: [],
      dirty: false,
      preview: previewOf(templateId, fresh, []),
      verdict: null,
      note: '已恢复骨架：清掉所有改动、appliedRules 与结构判据。',
      wire: emptySession(),
      // 换骨架 = 历史断代：栈清空，不许跨骨架撤销。
      undoStack: [],
      redoStack: [],
    };
  }
  if (action.type === 'moveNode') {
    // W18-E 支座钉结点：力学族里支座与结点是两个物件但必须共点 ——
    //  - 拖结点 → 吸附在它上面的支座跟随（≤0.6px 视为共点）；
    //  - 拖支座 → 不许单独动，带着它吸附的结点一起走（等价于拖结点）。
    // follow 变异位：check:assemble ㉙ 关掉验红。
    const follow = SUPPORT_FOLLOW_CONFIG.follow && (PICKS[templateId]?.family ?? state.graph.family) === 'beam';
    const SUPPORT_KINDS = new Set(['pinSupport', 'rollerSupport', 'fixedSupport']);
    const movedOld = state.graph.nodes.find((node) => node.id === action.nodeId);
    const dx = movedOld ? action.x - movedOld.x : 0;
    const dy = movedOld ? action.y - movedOld.y : 0;
    const isSupport = movedOld !== undefined && SUPPORT_KINDS.has(movedOld.kind);
    let anchorOld: CanvasNode | undefined;
    if (follow && isSupport) {
      anchorOld = state.graph.nodes.find(
        (node) =>
          !SUPPORT_KINDS.has(node.kind) &&
          (node.kind === 'dot' || node.kind === 'pin') &&
          Math.hypot(node.x - movedOld!.x, node.y - movedOld!.y) <= SUPPORT_FOLLOW_CONFIG.tolerance,
      );
    }
    const graph: CanvasGraph = {
      ...state.graph,
      nodes: state.graph.nodes.map((node) => {
        if (node.id === action.nodeId) return { ...node, x: action.x, y: action.y };
        // R3-1 A3：结点载荷跟着结点走 —— 载荷的 x/y 是它自己的坐标，不同步就会
        // 「挂在这个结点上、画的却在别处」，reduce 的 loadAt 还会算出一个假 t。
        if (node.atJoint === action.nodeId) return { ...node, x: node.x + dx, y: node.y + dy };
        if (!follow || !movedOld) return node;
        if (!isSupport && SUPPORT_KINDS.has(node.kind)) {
          // 拖结点：共点支座跟随同样的位移
          if (Math.hypot(node.x - movedOld.x, node.y - movedOld.y) <= SUPPORT_FOLLOW_CONFIG.tolerance) {
            return { ...node, x: node.x + dx, y: node.y + dy };
          }
          return node;
        }
        if (isSupport && anchorOld && node.id === anchorOld.id) {
          // 拖支座：吸附的结点跟着支座走到同一目标点
          return { ...node, x: action.x, y: action.y };
        }
        return node;
      }),
    };
    // 拖动过程中只搬坐标，导线一条都不重算（避免抖动）。
    return { ...state, graph };
  }
  if (action.type === 'moveNodeEnd') {
    const graph: CanvasGraph = { ...state.graph, edges: relayout(action.before, state.graph) };
    // 拖动不产生历史（W14 起的规矩）；dragSnapshots 变异开关打开才入栈。
    const undoStack = UNDO_CONFIG.dragSnapshots
      ? [...state.undoStack, snapshotOf({ ...state, graph: action.before })].slice(-UNDO_LIMIT)
      : state.undoStack;
    return {
      ...state,
      graph,
      dirty: true,
      preview: previewOf(templateId, graph, state.rules),
      verdict: null,
      note: '节点已移动，导线端点重新吸附到引脚。',
      undoStack,
    };
  }
  if (action.type === 'autoLayout') {
    const graph: CanvasGraph = { ...state.graph, edges: relayout(state.graph, state.graph) };
    return { ...state, graph, note: '自动整理：全部导线端点已重新对齐引脚。' };
  }
  if (action.type === 'loadCandidate') {
    const fresh = freshSkeleton(action.baseTemplateId, action.spec, action.defaults);
    // W22-A：载入候选也自增 resetAt，画布 / 列表树强制 remount。
    const graph = { ...fresh, meta: { ...fresh.meta, resetAt: (typeof state.graph.meta.resetAt === 'number' ? state.graph.meta.resetAt : 0) + 1 } };
    const rules = [`已载入候选「${action.candidateId}」：骨架换成 ${action.spec.nodes.length} 个图元 / ${action.spec.edges.length} 条连线`];
    return {
      graph,
      rules,
      dirty: true,
      preview: previewOf(templateId, graph, rules),
      verdict: null,
      note: rules[0],
      wire: emptySession(),
      // 换骨架 = 历史断代：栈清空。
      undoStack: [],
      redoStack: [],
    };
  }
  if (action.type === 'peekCandidate') {
    // 「只看看」不改图、不改 dirty、不留 evidence。
    return state;
  }
  // solve：与页面「分步求解」同一档位判据（数值仍由页面调既有 solver / 通用求解产出）。
  // 悬空端口等非阻断警告不算 outOfScope（W13）；W15-S4 起硬伤也先问通用求解器。
  // W18-E：支座没钉在结点上 → 一律 U（与 verdictPreviewOf / resolve 同源）。
  const blockingCount = state.preview.problems.filter(isBlockingProblem).length;
  const healed = state.graph.meta.healedSeries !== undefined;
  const supportOff = supportOffJointProblems(state.graph);
  const supportOffVerdict: LabVerdict = {
    tier: 'U',
    headline: '本题解不动，不渲染数值',
    detail: supportOff.join('；'),
    substitute: [
      { label: '恢复骨架重试', hash: '' },
      { label: '换一个题型', hash: '#/lab' },
    ],
  };
  const verdict = supportOff.length > 0
    ? supportOffVerdict
    : blockingCount > 0
      ? verdictPreviewOf(templateId, state.graph, state.rules, reduce(templateId, state.graph, state.rules), state.preview.semantic)
      : healed
        ? genericVerdict(PICKS[templateId]?.family ?? state.graph.family)
        : verdictOf(false, state.preview.problems, state.preview.semantic, countComposites(state.graph), PICKS[templateId]?.family ?? state.graph.family);
  return { ...state, verdict, note: verdict.headline };
}
