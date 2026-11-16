import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { getExample } from '../examples';
import { getTemplateRoute, type ParamValue } from '../core/templates/registry';
import { CONTRACT_VERSION, type RenderSpec, type Solution } from '../core/types';
import { graphToSpec } from '../core/lab/graphFromSpec';
import { PICKS, SUPPORTED_IDS, applyParams, findDevice, findLoads, valueFromLabel } from '../core/lab/picks';
import { CIRCUIT_KINDS, KIND_LABEL, memberLabel, applyOp, UNIT_OF, valueInRange, valueRangeHint } from '../core/lab/ops';
import { reduce } from '../core/lab/reduce';
import {
  allComposites,
  decodeSharePayload,
  encodeSharePayload,
  isBlockingProblem,
  loadStoredComposites,
  registerComposites,
  usedCompositeDefs,
} from '../core/lab/composite';
import { BUILTIN_COMPOSITES } from '../core/lab/compositeBuiltin';
import { registeredComposites } from '../core/lab/compositeStore';
import { SEMANTIC_OPTIONS, SEMANTIC_LABEL, suggestSemantics } from '../core/lab/semantics';
import { defaultValues, freshSkeleton, isParametricSkeleton, labSkeletonSpec } from '../core/lab/skeleton';
import { notApplicableView, type NotApplicableView } from '../core/lab/coverage';
import { clickableAnchors, anchorsOfNode } from '../core/lab/pins.ts';
import { anchorDisplay, anchorOptionText, deviceName, selectionText } from '../core/lab/pinNames.ts';
import { QuickFill, QUICKFILL_TEMPLATES } from '../ui/QuickFill.tsx';
import { candidateDefaults, candidateHeading, candidatesFor, type Candidate } from '../core/lab/candidates';
import { P_OVERRIDE_CONFIG, mergeOverrides, paramOverrideText, parseParamOverrides } from '../core/lab/params';
import {
  createUiState,
  labUiClick,
  labUiStep,
  verdictOf,
  type LabUiAction,
  type LabUiState,
} from '../core/lab/ui';
import type { PointerHit } from '../core/lab/pointer.ts';
import {
  PLACE_TOOLS,
  dirFromDrag,
  hoverAt,
  pinsOfNode,
  placeHit,
  placePlan,
  type PlaceGhost,
  type PlaceOptions,
  type PlaceTool,
} from '../core/lab/place.ts';
import { beamMemberRows, beamObjectRows, INSPECT_CONFIG } from '../core/lab/inspect';
import {
  LOAD_DIR_LABEL,
  LOAD_DIRECTIONS,
  SUPPORT_LABEL,
  addTargetOf,
  foldSupports,
  loadSpotText,
  mainSpanOf,
  rotToDir,
  selectedJointOf,
  tOnSpan,
} from '../core/lab/attach';
import { N_TIER_STEP4_TITLE, withLabChecks, genericVerdict, type LabVerdict } from '../core/lab/tiers';
import { resolveLabSolve } from '../core/lab/resolve';
import { beamCapabilities, filterWarningsByCapability, type Measure } from '../core/lab/measures';
import type { CircuitSolution } from '../core/lab/netSolve';
import type { FrameSolution } from '../core/lab/frameSolve';
import { GenericResult } from '../ui/GenericResult';
import { deriveCircuitEquivalent, type CircuitEquivalent } from '../core/lab/equivalent';
import { displayLabels } from '../core/lab/display';
import { deviceParamFields, deviceParamValue, missingModelParams, type DeviceParamField } from '../core/lab/deviceParams';
import { deriveAcEquivalent, type AcEquivalentResult } from '../core/lab/acEquivalent';
import { GraphMeasures } from '../ui/GraphMeasures';
import { confidenceSummary } from '../ui/confidenceSummary';
import { formatScalar, isInfiniteValue } from '../core/format.ts';
import { ParamPanel } from '../ui/ParamPanel';
import { prepareImages } from '../ui/imagePipeline';
import { ThemeToggle } from '../ui/ThemeToggle';
import { LoadingPlate, LoadingInline } from '../ui/LoadingPlate';
import {
  CountUp,
  DecodeText,
  Magnetic,
  Marquee,
  Parallax,
  Reveal,
  Spotlight,
  Tilt,
  Typewriter,
  useActiveStep,
} from '../ui/motion';
import { draftToGraph } from '../core/lab/draftToGraph';
import { labDraftFromAIDraft } from '../core/ai/labDraft';
import { isVisionEnabled, keepOnFailure, readStructure, setVisionEnabled, visionUsesLeft } from '../core/ai/vision';
import { VISION_CONFIG } from '../core/ai/config';
import { validateLive } from '../confidence/live';
import { SpecGrid } from '../render/SpecGrid';
import { AnalogSchematic } from '../render/AnalogSchematic';
import { SiteNav } from '../ui/SiteNav';
import { Result } from './Result';
import type { CanvasGraph, GraphOp } from '../core/lab/types';
import { buildStandaloneSvg, downloadBlob, findGraphSvg, graphFileName, svgToPngBlob } from '../ui/exportGraph';
import { UnitModeSelect } from '../ui/UnitModeSelect.tsx';
import { getUnitMode, subscribeUnitMode } from '../core/units.ts';
import { copyText } from '../ui/clipboard.ts';
import { templateZeroForceInfo, zeroForceMembers, type ZeroForceInfo } from '../core/lab/zeroForce';
import { slantedMemberNote } from '../core/lab/geometry';
import {
  addFavorite,
  clearHistory,
  libraryHref,
  loadLibrary,
  loadLibrarySort,
  makeSavedGraph,
  parseTags,
  relativeTime,
  removeFavorite,
  renameFavorite,
  saveLibrary,
  saveLibrarySort,
  setFavoriteTags,
  sortFavorites,
  touchHistory,
  type LabLibrary,
  type LibrarySort,
  type SavedGraph,
} from '../core/lab/library';

/* 面板：首页同款「墨线 + 玻璃面」。三块面板是这一屏的全部玻璃层，
   里面不再叠半透，底下那张骨架图才不会被糊住。 */
const CARD = 'lab-panel relative rounded-[14px] border border-line-2';
const EYEBROW = 'text-[11px] text-cyan';
/* 工具条小键统一成一个手势：等宽小字 + 描边，hover 才亮（见 motion.css .lab-chip） */

const CIRCUIT_ADDS: { kind: string; label: string; value?: number; params?: Record<string, number>; note?: string }[] = [
  // W16：默认值要合理（R=1k / V=5V / C=1nF），加进来立刻可编辑。
  { kind: 'res', label: 'R', value: 1000 },
  { kind: 'vsrc', label: 'V', value: 5 },
  // W22-B F10：白名单语义统一 —— C 不再被判「白名单外」，口径=交流短路 / 直流开路。
  { kind: 'cap', label: 'C', value: 1e-9, note: '交流短路 / 直流开路' },
  { kind: 'diode', label: 'D' },
  { kind: 'npn', label: 'Q2', value: 1e-3, params: { beta: 100, lambda: 100 } },
  { kind: 'nmos', label: 'M2', params: { gm: 0.001, ro: 5e6 } },
  // 引擎早就能 stamp 的三种，面板一直没给按钮：没有地符号 = 无参考点 = 整张图拒答。
  { kind: 'gnd', label: '接地', note: '每张图必须有且只有一处' },
  { kind: 'isrc', label: 'I', value: 1e-3 },
  { kind: 'opamp', label: 'OP' },
];
const BEAM_SUPPORTS: { type: 'pin' | 'roller' | 'fixed' }[] = [{ type: 'pin' }, { type: 'roller' }, { type: 'fixed' }];
const BEAM_LOADS: { type: 'point' | 'udl' | 'moment'; value: number; label: string }[] = [
  { type: 'point', value: 10, label: '集中力' },
  { type: 'udl', value: 5, label: '均布' },
  { type: 'moment', value: 5, label: '力偶' },
];
/** 支座标签的单一来源是 attach.SUPPORT_LABEL（渲染 / 左栏 / 证据同一份）。 */
const SUPPORT_KIND_LABEL = SUPPORT_LABEL;

type Stage = 'idle' | 'editing' | 'solving' | 'solved' | 'refused';

/** 打开时的参数表 = 骨架默认 + `?p=` 覆盖；恢复骨架也回到这一份。 */
function initialValues(templateId: string): {
  values: Record<string, ParamValue>;
  keys: string[];
  ignored: string[];
} {
  const route = getTemplateRoute(templateId);
  const overrides = parseParamOverrides(paramOverrideText(window.location.hash), route?.entry.params ?? []);
  return {
    values: mergeOverrides(defaultValues(templateId), overrides.values),
    keys: [...overrides.keys],
    ignored: [...overrides.ignored],
  };
}

interface LabProps {
  templateId?: string;
  onBack: () => void;
  onStart: (hash: string) => void;
  onToast: (message: string) => void;
}

interface LibraryPanelProps {
  library: LabLibrary;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  onStart: (hash: string) => void;
  onRemoveFavorite: (id: string) => void;
  onRenameFavorite: (entry: SavedGraph, name: string) => void;
  onSetTags: (entry: SavedGraph, tags: string[]) => void;
  onClearHistory: () => void;
}

/** R-36：装配台首页的「最近使用 / 我的收藏」。空库整块不渲染（不占位、不教育用户）。 */
function LibraryPanel({
  library,
  sort,
  onSortChange,
  onStart,
  onRemoveFavorite,
  onRenameFavorite,
  onSetTags,
  onClearHistory,
}: LibraryPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');

  const beginEdit = (entry: SavedGraph) => {
    setEditing(entry.id);
    setName(entry.title);
    setTags((entry.tags ?? []).join(', '));
  };
  const commitEdit = (id: string) => {
    const entry = library.favorites.find((item) => item.id === id);
    if (!entry) return;
    onRenameFavorite(entry, name);
    onSetTags(entry, parseTags(tags));
    setEditing(null);
  };

  if (library.history.length === 0 && library.favorites.length === 0) return null;

  return (
    <section data-testid="library-panel" className="mb-6 space-y-4">
      {library.history.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[12px] font-medium text-ink">最近使用</h3>
            <span className="text-[10px] text-faint">改过的图会自动记在这里（每型只留最新）</span>
            <button
              type="button"
              data-testid="library-clear-history"
              onClick={onClearHistory}
              className="focus-ring ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-cyan/50"
            >
              清空
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {library.history.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid="library-open"
                data-template-id={item.templateId}
                onClick={() => onStart(libraryHref(item))}
                className="card focus-ring rounded-lg px-3 py-2 text-left"
              >
                <p className="id-mono text-faint">
                  最近 · {item.templateId} · {relativeTime(item.at)}
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-5 text-ink">{item.title}</p>
                <p className="mt-0.5 text-[10px] text-muted">{item.dirty ? '已改动 · 带回装配图' : '骨架'}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {library.favorites.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[12px] font-medium text-ink">我的收藏</h3>
            <select
              data-testid="library-sort"
              aria-label="收藏排序"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as LibrarySort)}
              className="rounded border border-line bg-bg px-1 py-0.5 text-[10px] text-muted"
            >
              <option value="recent">最近收藏</option>
              <option value="name">按名称</option>
              <option value="template">按题型</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortFavorites(library.favorites, sort).map((item) => (
              <div key={item.id} className="card rounded-lg px-3 py-2">
                <button
                  type="button"
                  data-testid="library-open"
                  data-template-id={item.templateId}
                  onClick={() => onStart(libraryHref(item))}
                  className="focus-ring block w-full text-left"
                >
                  <p className="id-mono text-faint">
                    收藏 · {item.templateId} · {relativeTime(item.at)}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] leading-5 text-ink">{item.title}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{item.dirty ? '已改动 · 带回装配图' : '骨架'}</p>
                </button>
                {item.tags && item.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        data-testid="favorite-tag"
                        className="rounded bg-cyan/10 px-1 text-[10px] leading-4 text-cyan"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    data-testid="favorite-edit"
                    aria-label={`编辑收藏 ${item.title}`}
                    onClick={() => beginEdit(item)}
                    className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-cyan/60"
                  >
                    改名 / 标签
                  </button>
                  <button
                    type="button"
                    data-testid="library-unfavorite"
                    aria-label={`取消收藏 ${item.title}`}
                    onClick={() => onRemoveFavorite(item.id)}
                    className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-danger/60"
                  >
                    取消收藏
                  </button>
                </div>
                {editing === item.id ? (
                  <div data-testid="favorite-edit-form" className="mt-1.5 space-y-1 border-t border-line pt-1.5">
                    <input
                      type="text"
                      data-testid="favorite-edit-name"
                      aria-label="收藏名称"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink outline-none focus:border-cyan/60"
                    />
                    <input
                      type="text"
                      data-testid="favorite-edit-tags"
                      aria-label="收藏标签"
                      placeholder="标签用逗号分隔，如 分压, 作业"
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitEdit(item.id);
                        if (event.key === 'Escape') setEditing(null);
                      }}
                      className="w-full rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink outline-none focus:border-cyan/60"
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        data-testid="favorite-edit-save"
                        onClick={() => commitEdit(item.id)}
                        className="focus-ring rounded border border-cyan/60 px-1.5 py-0.5 text-[10px] text-cyan"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function Lab({ templateId, onBack, onStart, onToast }: LabProps) {
  const [pickId, setPickId] = useState<string | null>(templateId ?? null);
  const [stage, setStage] = useState<Stage>(templateId && PICKS[templateId] ? 'editing' : 'idle');
  const [ui, setUi] = useState<LabUiState | null>(null);
  /** 骨架载入失败的说明（骨架快照 / solver 分包拉了但没回来）；null = 没问题。
   *  以前这条路径是静默的：页面停在索引页，用户以为「点卡片没反应」。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 重试计数：递增即重跑载入 effect（骨架与 solver 都重拉）。 */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [specType, setSpecType] = useState<string>('schematic');
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [solution, setSolution] = useState<Solution | null>(null);
  const [verdict, setVerdict] = useState<LabVerdict | null>(null);
  const [refusal, setRefusal] = useState<string[]>([]);
  /** H-11 参数实验场：最近一次求解耗时（ms）。 */
  const [solveMs, setSolveMs] = useState<number | null>(null);
  /** §5 AI 识图：默认关、本次会话有效、每会话最多 3 次；不点按钮不发请求。 */
  const [visionOn, setVisionOnState] = useState(() => isVisionEnabled());
  const [visionImage, setVisionImage] = useState<string | null>(null);
  const [visionNote, setVisionNote] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  /** W15-S4：骨架不符但拓扑合法 → 通用求解结果（与模板 solution 互斥）。 */
  const [generic, setGeneric] = useState<{
    family: 'circuit' | 'beam';
    circuit?: CircuitSolution;
    frame?: FrameSolution;
    notices: string[];
    measures: Measure[];
    reason: 'skeleton' | 'unmodeled' | 'healed';
    /** ㉞⑤：等效电路（戴维南 / 小信号）跟着这次求解一起算，结果卡直接面板化显示。 */
    equivalent?: CircuitEquivalent;
    acEquivalent?: AcEquivalentResult;
  } | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  /** 首页同款滚动叙事：索引页那三步（认骨架 → 改结构 → 现算）走到哪一步。 */
  const { active: labStep, setStep: setLabStep } = useActiveStep(3);
  /** R-36：装配台首页的最近使用 / 我的收藏（落 localStorage）。 */
  const [library, setLibrary] = useState<LabLibrary>(() => loadLibrary());
  const [librarySort, setLibrarySort] = useState<LibrarySort>(() => loadLibrarySort());
  /** R-36：☆ 收藏 → 起名字的表单。 */
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [favoriteName, setFavoriteName] = useState('');
  /** R-37：导出图菜单 + 清空画布确认条 + 零杆高亮开关。 */
  const [exportOpen, setExportOpen] = useState(false);
  /** 黑盒 #4：求解成功后把结果区滚进首屏（只认按钮触发，实时重算不滚）。
   *  用 effect 而不是 rAF：后台 / 遮挡窗口里 rAF 不触发。 */
  const resultSectionRef = useRef<HTMLElement | null>(null);
  const scrollAfterSolveRef = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  /** 黑盒 #29：点菜单外面就收起（以前只有再点一次「导出图」才能关）。 */
  useEffect(() => {
    if (!exportOpen) return;
    const onOutside = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [exportOpen]);
  /** ㊱③：剪贴板被拒时把链接摊在页面上，用户还能手动复制。 */
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  /** ㉟⑦：刚补完模型参数 → 立刻用新数重算一次（否则屏幕上还挂着旧增益）。 */
  const [pendingParamSolve, setPendingParamSolve] = useState<string | null>(null);
  /** 参数实验场实时档：拖动即重算（改值算「你确认过这一项」，确认闸门不撤）。 */
  const [liveExperiment, setLiveExperiment] = useState(true);
  // 修复计划 T1.3：订阅单位制 —— 切换后立即重渲染（渲染期格式化的数字/单位即刻变），
  // 求解期预格式化的 headline 串则靠下面的 effect 静默重解刷新。
  const unitMode = useSyncExternalStore(subscribeUnitMode, getUnitMode, () => getUnitMode());
  /** A1/A2：参数表输入框的打字草稿 —— 打字期间留本地文本（空串不提交、不把 0 写进模型），
   *  失焦丢草稿回到真实值（顺带把 020 归一成 20，聚焦时全选旧值实现「替换」而非「拼接」）。 */
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [clearArmed, setClearArmed] = useState(false);
  const [showZeroMembers, setShowZeroMembers] = useState(false);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  /** 修复计划 T2.2：换结构浮层钳到视口内 —— 1152 宽下按钮右对齐会把 900px
   *  面板推出右缘，量出溢出量后用 translateX 拉回来（不依赖 offset parent）。 */
  const candidatesPanelRef = useRef<HTMLDivElement | null>(null);
  const [candidatesShift, setCandidatesShift] = useState(0);
  /** 修复计划 T3.8：清空确认 popover 弹出即聚焦「确认清空」（键盘直达，Esc 可放掉）。 */
  const clearYesRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (clearArmed) clearYesRef.current?.focus();
  }, [clearArmed]);
  /** 载入候选前的「会丢掉改动」确认（Esc / 取消都能放掉）。 */
  const [pendingLoadCandidate, setPendingLoadCandidate] = useState<Candidate | null>(null);
  const [peeked, setPeeked] = useState<string | null>(null);
  /** `?p=` 覆盖到的键：参数行标「题面」来源角标（仍需逐个点确认）。 */
  const [pKeys, setPKeys] = useState<string[]>([]);
  /** 快填写入的键：参数行标「推得」，区别于骨架 / 题面 / 手改。 */
  const [derivedKeys, setDerivedKeys] = useState<string[]>([]);
  /** 上次连成的两个端点，用于左下角 `Q · 基极 b → Rc · 端 A`。 */
  const [lastLink, setLastLink] = useState<{ from: string; to: string } | null>(null);
  /** W13 多选（Shift+点击）→ 封装复合器件。 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** W14 删除确认：删掉会让归约失败的器件，先亮一次黄条。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** W16 导线选中：画布点线 / 导线列表行 → Delete 或按钮删。 */
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  /** W17-C：力学族杆 / 物件选中（与导线选中互斥，同一时刻只有一个选择）。 */
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  /** W17-C：力学「加杆」模式 —— 打开后点节点走既有两次点击加杆；平时点节点 = 选物件。 */
  const [linkMode, setLinkMode] = useState(false);
  /** R3-1 A3：新载荷的方向（↓0 / →90 / ↑180 / ←270）。 */
  const [loadDir, setLoadDir] = useState<number>(0);
  /** R3-4 U1 放置器：off = 老行为（选中 / 拖动 / 连线），其余 = 在图上指一下就落条件。 */
  const [placeTool, setPlaceTool] = useState<PlaceTool>('off');
  const [placeGhost, setPlaceGhost] = useState<PlaceGhost | null>(null);
  const [placeAlt, setPlaceAlt] = useState(0);
  const [placeAmbiguous, setPlaceAmbiguous] = useState(false);
  /** 放置器要落的量（集中力 kN / 均布 kN/m）。 */
  const [placeValue, setPlaceValue] = useState(20);
  /** 点电路器件本体 → 列出它的引脚名（点名字就起线）。 */
  const [pinList, setPinList] = useState<{ nodeId: string; pins: { key: string; x: number; y: number; label: string }[] } | null>(null);
  /** W17-B：当前图是否从链接（?g=）载入 —— 状态要可见。 */
  const [loadedFromLink, setLoadedFromLink] = useState(false);
  /** R2-T3：从题面（#/solve 双出口）带着结构草稿进来 —— 与分享载入同 ?g=，来源不同。 */
  const [fromProblem, setFromProblem] = useState(false);
  /** 封装 / 编辑端口面板的打开状态。 */
  const [wrapPanel, setWrapPanel] = useState<'wrap' | { edit: string } | null>(null);
  const specRef = useRef<RenderSpec | null>(null);
  const solverRef = useRef<((input: unknown) => Solution) | null>(null);
  /** 拖动开始时的整张图：pointerup 时用它做 relayout 的对照物。 */
  const beforeDragRef = useRef<CanvasGraph | null>(null);
  const graph = ui?.graph ?? null;
  const preview = ui?.preview ?? null;
  /** 确认区「图上元件 · 实时读数」：直接读当前画布的支座 / 载荷 / 构件，
   *  图一动立刻刷新 —— 核对数字时能对着实物看，不靠记忆里的题面值。 */
  const liveDeviceRows = useMemo(() => {
    if (!graph) return [] as string[];
    if (graph.family === 'beam') {
      const rows: string[] = [];
      for (const node of graph.nodes) {
        if (node.kind === 'text') continue;
        const name = (node.label ?? '').trim() || node.id.replace(/^n-/, '').toUpperCase();
        if (node.support) {
          rows.push(`${name} · ${SUPPORT_KIND_LABEL[`${node.support.type}Support`] ?? '支座'}`);
        } else if (['arrow', 'udl', 'momentArrow', 'torqueArrow'].includes(node.kind)) {
          let where: string;
          if (node.atJoint) {
            where = `在结点 ${(graph.nodes.find((one) => one.id === node.atJoint)?.label ?? '').trim() || node.atJoint.replace(/^n-/, '').toUpperCase()}`;
          } else {
            const host =
              graph.edges.find((edge) => edge.id === node.atMember) ??
              graph.edges.find((edge) => {
                const a = graph.nodes.find((one) => one.id === edge.from);
                const b = graph.nodes.find((one) => one.id === edge.to);
                if (!a || !b || b.x === a.x) return false;
                const t = (node.x - a.x) / (b.x - a.x);
                return t >= -0.02 && t <= 1.02;
              });
            if (host) {
              const a = graph.nodes.find((one) => one.id === host.from);
              const b = graph.nodes.find((one) => one.id === host.to);
              const t = a && b && b.x !== a.x ? (node.x - a.x) / (b.x - a.x) : 0;
              where = `落在 ${memberLabel(host.id)} · t=${Math.min(1, Math.max(0, t)).toFixed(2)}`;
            } else {
              where = '位置未定（不落在任何杆上）';
            }
          }
          rows.push(`${(node.label ?? name).trim()} · ${where}`);
        }
      }
      for (const edge of graph.edges) {
        const kindText = edge.kind === 'truss' ? '桁架杆' : '构件';
        const name = memberLabel(edge.id);
        rows.push(name === kindText ? `${name}（A/I/E 可改）` : `${name} · ${kindText}`);
      }
      return rows;
    }
    return graph.nodes
      .filter((node) => !['text', 'dot', 'gnd'].includes(node.kind))
      .map((node) => (node.label ?? '').trim() || node.id);
  }, [graph]);
  /**
   * W21-A A2：归约是唯一真相。确认栏 / 参数实验场 / 快填都读这一份 ——
   * `values` 只记「用户刚打进去的意图」，屏幕上的数一律以 `ui.preview.params`
   * 为准，不再出现「确认栏 a=2、归约预览 a=3、实验场 a=3」三处三值。
   */
  const displayValues = useMemo(() => {
    const out: Record<string, ParamValue> = { ...values };
    if (preview) {
      for (const [key, value] of Object.entries(preview.params)) {
        if (typeof value === 'number' || typeof value === 'string') out[key] = value;
      }
    }
    return out;
  }, [values, preview]);
  /** W21-A A3：文案能力按当前这张图算（填了截面才谈 σ / δ）。 */
  const capabilities = useMemo(() => (graph ? beamCapabilities(graph) : []), [graph]);
  const route = pickId ? getTemplateRoute(pickId) : undefined;
  const entry = route?.entry;
  /** 图上显示的名字 = 题型标题（收藏 / 最近使用 / 导出都用它）。 */
  const labTitle = entry?.title ?? pickId ?? '';
  /** 画布上还剩几个真图元（清空画布按钮的 disabled 判据）。 */
  const canvasFigureCount = graph ? graph.nodes.filter((node) => node.kind !== 'text').length : 0;
  const canvasEmpty = canvasFigureCount === 0;
  /** R-38 ⑤：非水平构件提示（S5 / S3 的斜杆是合法的，纯函数里已白名单）。 */
  const slantedNote = graph ? slantedMemberNote(graph) : null;
  /** R-39 ②：模板解（S5）也透出零杆判据；通用解仍按杆端轴力相对阈值。 */
  const zeroInfo: ZeroForceInfo = useMemo(() => {
    const fromFrame = zeroForceMembers(generic?.frame ?? null);
    if (fromFrame.source === 'frame' && generic?.frame) return fromFrame;
    return templateZeroForceInfo(solution) ?? fromFrame;
  }, [generic, solution]);
  const zeroFromTemplate = zeroInfo.source === 'template';
  const baseParams = entry?.params ?? [];
  /** a 的合法区间跟着支座数与 L 走：简支 a∈(0,L)，悬臂（单固定端）a 可取到自由端 L。
   *  以前 max 固定 7.9，简支 a=L 能一键确认、求解才炸；悬臂又看不出上限在哪。 */
  const params = useMemo(() => {
    if (pickId !== 'M3' && pickId !== 'M3-cantilever') return baseParams;
    if (graph?.family !== 'beam') return baseParams;
    const l = Number(displayValues.L);
    if (!Number.isFinite(l) || l <= 0.2) return baseParams;
    const supported = graph.nodes.filter((node) => node.support).length;
    if (supported === 2) {
      return baseParams.map((param) =>
        param.key === 'a' ? { ...param, max: Math.max(0.1, Number((l - 0.1).toFixed(1))) } : param,
      );
    }
    if (supported === 1) {
      return baseParams.map((param) => (param.key === 'a' ? { ...param, max: l } : param));
    }
    return baseParams;
  }, [baseParams, pickId, graph, displayValues.L]);

  /** 路由 → 状态：#/lab/t/<id> 变化（含换题型）必须清空重建，不叠加。 */
  useEffect(() => {
    setPickId((current) => {
      const next = templateId && PICKS[templateId] ? templateId : null;
      return next === current ? current : next;
    });
  }, [templateId]);

  /** localStorage 里的自定义模块注册进会话（一次即可；分享载入会再注册增量）。 */
  useEffect(() => {
    registerComposites(loadStoredComposites());
  }, []);

  /** 载入骨架：打开就是一张对的图；换题型 / 恢复骨架都走 freshSkeleton。 */
  useEffect(() => {
    if (!pickId || !PICKS[pickId]) {
      setUi(null);
      setStage('idle');
      setLoadError(null);
      return;
    }
    let active = true;
    setStage('editing');
    setLoadError(null);
    // 换题型时先把旧图交出去：不然新 pickId 配着上一张图的 ui 会闪一帧旧画布，
    // 载入板也没有出现的时机（「点卡片 → 图直接变了」缺少中间态）。
    setUi(null);
    // W21-A A1：换题型 / 换结构后立刻作废旧 solver 闭包。以前 solverRef 挂着上一
    // 张题型的函数，用户在异步载入完成前点「分步求解」就会拿旧模板算新图。
    solverRef.current = null;
    setSolution(null);
    setVerdict(null);
    setGeneric(null);
    setRefusal([]);
    setResetArmed(false);
    setConfirmed({});
    setDerivedKeys([]);
    setLastLink(null);
    setSelectedIds([]);
    setWrapPanel(null);
    setPendingDelete(null);
    setSelectedWire(null);
    setSelectedMember(null);
    setSelectedObject(null);
    setLinkMode(false);
    (async () => {
      const route2 = getTemplateRoute(pickId);
      if (!route2) {
        if (active) setLoadError('这张骨架没有可用的装载路由 —— 题型清单与路由表对不上。');
        return;
      }
      const example = await getExample(pickId);
      if (!active) return;
      if (!example) {
        // 骨架快照是从已校验解里拿的；拉不到就是网络 / 分包问题，说清楚再给重试。
        setLoadError('骨架快照没有载入成功 —— 可能是网络中断或分包没拉到。');
        return;
      }
      // M7 之类的参数化骨架在这里统一取规格，页面与门禁走同一张图。
      const spec = labSkeletonSpec(pickId, example.render_specs[0]);
      specRef.current = spec;
      // `?p=Rc:3300,beta:150` 打开即覆盖参数表；坏 key / 越界值如实忽略并 toast。
      const seeded = initialValues(pickId);
      const defaults = seeded.values;
      setPKeys(seeded.keys);
      if (seeded.ignored.length > 0) onToast(`?p= 已忽略：${seeded.ignored.join('；')}`);
      // R1-F：`?p=` 的覆盖值必须落到力学族图元（载荷值 / 位置、跨度文字）——
      // freshSkeleton 只把 L/H 种进 meta，会被画布来源（spanText / load）压掉而静默失效。
      // applyParams 与 W10 手改同一通道（挪载荷位置、改载荷值、刷新跨度文字）。
      const fresh0 = freshSkeleton(pickId, spec, defaults);
      const fresh =
        seeded.keys.length > 0 && P_OVERRIDE_CONFIG.applyToGraph ? applyParams(pickId, fresh0, defaults) : fresh0;
      const query = window.location.hash.split('?')[1] ?? '';
      const shared = new URLSearchParams(query).get('g');
      // solver 先行载入：分享图也走同一条模板 / 通用路由，缺 solver 会让按钮哑掉。
      // W21-A A1：动态载入可能被后一次路由切换打断，只有 active 的那次允许写回 ref。
      let loadedSolver: ((input: unknown) => Solution) | null = null;
      try {
        loadedSolver = route2.entry.solver ? ((await route2.entry.solver()).default as (input: unknown) => Solution) : null;
      } catch {
        // 分包 404 / 版本不匹配会让这里 reject：以前是静默挂起，现在点名 + 可重试。
        if (active) setLoadError('求解器分包没有载入成功 —— 点重试通常就好（也可能是缓存里的旧分包）。');
        return;
      }
      if (!active) return;
      solverRef.current = loadedSolver;
      if (shared) {
        try {
          const payload = decodeSharePayload(shared);
          const decoded = payload?.graph;
          if (decoded && payload) {
            // 分享自带 defs：先注册再建状态，复合器件的端口 / 展开才有定义可查。
            if (payload.defs && payload.defs.length > 0) registerComposites(payload.defs);
            if (decoded.templateId === pickId) {
              setLoadedFromLink(true);
              // R3-1 A1：旧链接里的支座还是独立图元（也可能本来就跟结点错开）——
              // 与结点共点的折成属性，折不到的原样留着（resolve 会判 U，不静默吸附）。
              const folded = foldSupports(decoded);
              // R2-T3：来自题面的图同样带 ?g=（分享同编码），按 from 参数分辨来源
              setFromProblem(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('from') === '题面');
              setUi(createUiState(pickId, folded));
              setSpecType(spec.type);
              setValues({ ...defaults, ...sharedValuesFromGraph(pickId, folded) });
              onToast('已载入分享的装配图 —— 参数请逐条确认');
              return;
            }
          }
        } catch {
          onToast('分享链接解析失败，已回到骨架');
        }
      }
      setLoadedFromLink(false);
      setFromProblem(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('from') === '题面');
      const nextUi = createUiState(pickId, fresh);
      // R1-F：不生效必须提示，不许静默 —— 覆盖键逐一对照归约结果，对不上就说话。
      if (seeded.keys.length > 0) {
        const missed = seeded.keys.filter((key) => {
          const want = seeded.values[key];
          const got = nextUi.preview.params[key];
          return typeof want === 'number' && !(typeof got === 'number' && Math.abs(got - want) <= 1e-9);
        });
        if (missed.length > 0) {
          onToast(
            `?p= 的 ${missed.map((key) => `${key}:${seeded.values[key]}`).join('、')} 没生效（画布上的几何 / 载荷没跟上）—— 这些键以画布为准，请在画布上改或恢复骨架`,
          );
        }
      }
      setUi(nextUi);
      setSpecType(spec.type);
      setValues(defaults);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickId, loadAttempt]);

  /** W17-B 刷新语义：脏图始终同步进 URL（?g=），刷新 / 分享 / 历史导航都拿得到
   *  同一张图 —— 与「分享此图」同一编码；骨架态清掉 ?g=，状态可见不玩隐形。 */
  const syncUrl = useCallback(
    (nextGraph: CanvasGraph, dirty: boolean) => {
      if (!pickId) return;
      const base = `#/lab/t/${pickId}`;
      if (!dirty) {
        if (window.location.hash.includes('?g=')) history.replaceState(null, '', base);
        return;
      }
      const encoded = encodeURIComponent(encodeSharePayload({ graph: nextGraph, defs: usedCompositeDefs(nextGraph) }));
      const target = `${base}?g=${encoded}`;
      if (window.location.hash !== target) history.replaceState(null, '', target);
    },
    [pickId],
  );

  /** 页面按钮与门禁共用同一套 UI 动作层。 */
  /** F4 排查发现的真 bug：step 闭包读渲染时的 ui，同一 tick 里连发多个 op
   *  （markAllSemantics 三连、级联 …）会用同一份旧状态各算各的，只剩最后一个
   *  op 生效。改成函数式更新 + 提交后副作用（URL / toast / 拒答复位按最终态刷一次）。 */
  const pendingToastRef = useRef<string | null>(null);
  const graphChangedRef = useRef(false);
  const step = useCallback(
    (action: LabUiAction) => {
      setUi((current) => {
        if (!current || !pickId) return current;
        const next = labUiStep(pickId, current, action);
        if (next.graph !== current.graph) graphChangedRef.current = true;
        if (action.type === 'op' && next.note && (next.graph === current.graph || action.op.op === 'setDeviceValue')) {
          pendingToastRef.current = next.note;
        }
        if (action.type === 'undo' || action.type === 'redo') {
          pendingToastRef.current = next.note || (action.type === 'undo' ? '没有可撤销的操作' : '没有可重做的操作');
        }
        return next;
      });
    },
    [pickId],
  );

  // 提交后统一刷副作用：URL 与上一轮拒答复位只看最终态（批量 op 合并成一次）。
  useEffect(() => {
    if (!ui) return;
    if (graphChangedRef.current) {
      graphChangedRef.current = false;
      setRefusal((prev) => (prev.length > 0 ? [] : prev));
      setStage((prev) => (prev === 'refused' ? 'editing' : prev));
    }
    syncUrl(ui.graph, ui.dirty);
    if (pendingToastRef.current) {
      onToast(pendingToastRef.current);
      pendingToastRef.current = null;
    }
  }, [ui, onToast, syncUrl]);

  const mutate = useCallback((op: GraphOp) => step({ type: 'op', op }), [step]);

  /* ── W20 右栏「截面」：b/h [mm]、E [GPa]，写进 graph.meta.section ── */
  const [sectionDraft, setSectionDraft] = useState<{ b: string; h: string; E: string }>({ b: '', h: '', E: '' });
  useEffect(() => {
    if (!graph || graph.family !== 'beam') return;
    const panel = graph.meta.section;
    const fromPanel = panel && typeof panel === 'object' ? panel : undefined;
    const pick = (key: 'b' | 'h' | 'E') => {
      const value = fromPanel ? fromPanel[key] : graph.meta[key];
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    };
    setSectionDraft({ b: pick('b'), h: pick('h'), E: pick('E') });
  }, [graph]);

  /** 边打边生效（onBlur 会被画布 pointerdown 吃掉，U1 踩过）；三项填齐正数才落盘。 */
  const onSectionChange = (key: 'b' | 'h' | 'E', raw: string) => {
    const next = { ...sectionDraft, [key]: raw };
    setSectionDraft(next);
    const b = Number(next.b);
    const h = Number(next.h);
    const E = Number(next.E);
    if (next.b !== '' && next.h !== '' && next.E !== '' && [b, h, E].every((one) => Number.isFinite(one) && one > 0)) {
      mutate({ op: 'setSection', section: { b, h, E } });
    }
  };

  /* ── W17-C 选中互斥：物件 / 杆 / 导线 / 器件，同一时刻只有一个 ── */
  const selectWire = useCallback((id: string | null) => {
    setSelectedWire(id);
    if (id) {
      setSelectedMember(null);
      setSelectedObject(null);
    }
  }, []);
  const selectMember = useCallback((id: string | null) => {
    setSelectedMember(id);
    if (id) {
      setSelectedWire(null);
      setSelectedObject(null);
    }
  }, []);
  const selectObject = useCallback((id: string | null) => {
    setSelectedObject(id);
    if (id) {
      setSelectedWire(null);
      setSelectedMember(null);
    }
  }, []);

  /** W14 统一删除手势：🗑 与 Delete 键都走这里；有下游影响先确认，其余直接删。
   *  W17-C：力学结点一定先确认（删节点连带杆，清单要亮出来）。 */
  const requestDeleteDevice = useCallback(
    (nodeId: string) => {
      if (!ui || !pickId) return;
      const victim = ui.graph.nodes.find((node) => node.id === nodeId);
      if (ui.graph.family === 'beam' && victim && (victim.kind === 'dot' || victim.kind === 'pin')) {
        setPendingDelete(nodeId);
        return;
      }
      const probe = labUiStep(pickId, ui, { type: 'op', op: { op: 'deleteDevice', nodeId } });
      if (probe.graph === ui.graph) {
        onToast(probe.note || '删除被拒');
        return;
      }
      const before = ui.preview.problems.filter(isBlockingProblem).length;
      const after = probe.preview.problems.filter(isBlockingProblem).length;
      if (after > before) {
        setPendingDelete(nodeId);
        return;
      }
      mutate({ op: 'deleteDevice', nodeId });
      onToast('已删除，可 Ctrl+Z 撤销');
    },
    [ui, pickId, mutate, onToast],
  );
  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    mutate({ op: 'deleteDevice', nodeId: pendingDelete });
    setPendingDelete(null);
    setSelectedObject((current) => (current === pendingDelete ? null : current));
    onToast('已删除，可 Ctrl+Z 撤销');
  }, [pendingDelete, mutate, onToast]);

  /** W17-C：删一根杆（可撤销；判据话术由 ops 的 deleteMember 规则带出）。 */
  const deleteMember = useCallback(
    (edgeId: string) => {
      if (!ui || !pickId) return;
      const next = labUiStep(pickId, ui, { type: 'op', op: { op: 'deleteMember', edgeId } });
      setUi(next);
      syncUrl(next.graph, next.dirty);
      if (next.graph === ui.graph) {
        onToast(next.note || '删不了这个构件');
        return;
      }
      setSelectedMember(null);
      onToast(next.note || '已删除构件，可 Ctrl+Z 撤销');
    },
    [ui, pickId, onToast, syncUrl],
  );

  /** W16 删一条导线：不弹确认（可撤销），删后清选中；被拒时如实说话。 */
  const deleteWire = useCallback(
    (edgeId: string) => {
      if (!ui || !pickId) return;
      const next = labUiStep(pickId, ui, { type: 'op', op: { op: 'deleteEdge', edgeId } });
      setUi(next);
      syncUrl(next.graph, next.dirty);
      if (next.graph === ui.graph) {
        onToast(next.note || '删不了这条线');
        return;
      }
      setSelectedWire(null);
      onToast('已删除导线，可 Ctrl+Z 撤销');
    },
    [ui, pickId, onToast, syncUrl],
  );

  /** W14：Ctrl+Z 撤销 / Ctrl+Shift+Z、Ctrl+Y 重做；Delete 删选中（导线优先）；
   *  R 旋转选中的器件。输入框里不拦。 */
  useEffect(() => {
    if (!pickId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        step({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        step({ type: 'redo' });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (selectedWire) {
          deleteWire(selectedWire);
          return;
        }
        // W17-C：按当前选择分派 —— 杆 → 删杆；物件 → 删节点（结点连带杆先确认）。
        if (selectedMember) {
          deleteMember(selectedMember);
          return;
        }
        if (selectedObject) {
          requestDeleteDevice(selectedObject);
          return;
        }
        if (selectedIds.length === 1) requestDeleteDevice(selectedIds[0]);
        return;
      }
      // W16：R = 旋转 90°。对象 = 唯一 Shift 选中的器件；没有就退而求其次，
      // 用当前聚焦的器件行（双击器件会聚焦到行上）。
      if ((event.key === 'r' || event.key === 'R') && !mod && !event.altKey) {
        let nodeId: string | null = selectedIds.length === 1 ? selectedIds[0] : null;
        if (!nodeId) {
          const active = document.activeElement as HTMLElement | null;
          if (active?.id?.startsWith('dev-row-')) nodeId = active.id.slice('dev-row-'.length);
        }
        if (nodeId) {
          event.preventDefault();
          mutate({ op: 'rotateDevice', nodeId, delta: 90 });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickId, step, selectedIds, requestDeleteDevice, selectedWire, deleteWire, selectedMember, deleteMember, selectedObject, mutate]);

  /** W14：双击器件 → 焦点跳到左侧那一行（不是删除，避免误触）。 */
  const onFocusNodeRow = useCallback((nodeId: string) => {
    const row = document.getElementById(`dev-row-${nodeId}`);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      row.focus();
    }
  }, []);

  /** Shift+点击多选：封装复合器件的选料（再点一下取消）。 */
  const onSelectNode = (nodeId: string) => {
    setSelectedIds((current) => (current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]));
  };
  const onExpandComposite = (nodeId: string) => {
    step({ type: 'op', op: { op: 'expandComposite', nodeId } });
  };

  /** 封装 / 编辑保存前的校验：真跑 expandComposites + reduce + 既有 solver。
   *  归约失败 → 红字「封装后无法归约：<原因>」，不许保存；成功 → 绿字给 Av。 */
  const validateWrapOp = (op: GraphOp): { refused?: string; problems: string[]; summary: string } => {
    if (!pickId || !ui) return { refused: '还没进装配台', problems: [], summary: '' };
    const out = applyOp(pickId, ui.graph, op);
    if (out.refused) return { refused: out.refused, problems: [], summary: '' };
    const result = reduce(pickId, out.graph, out.rules);
    const blocking = result.problems.filter(isBlockingProblem);
    if (result.outOfScope || blocking.length > 0) {
      return { problems: blocking.length > 0 ? blocking : result.problems.filter((p) => !isBlockingProblem(p)), summary: '' };
    }
    let summary = '封装后可解（params 齐全）';
    if (solverRef.current) {
      try {
        const sol = solverRef.current(result.params) as Solution;
        const record = (sol.result ?? {}) as Record<string, unknown>;
        const avKey = Object.keys(record).find((key) => /^av/i.test(key) && typeof record[key] === 'number');
        if (avKey) summary = `封装后可解：${avKey}=${Number((record[avKey] as number).toPrecision(6))}`;
      } catch {
        /* solver 对这套 params 抛错就只报「可归约」，不假装算出了增益 */
      }
    }
    return { problems: result.problems, summary };
  };

  /** 高频指针动作用函数式更新，避免 pointermove 期间读到过期的 ui。 */
  const stepLive = useCallback(
    (action: LabUiAction) => {
      if (!pickId) return;
      setUi((current) => (current ? labUiStep(pickId, current, action) : current));
    },
    [pickId],
  );

  /** 画布点一下（引脚 / 结点 / 本体 / 空白）：与门禁同一套两次点击 reducer。 */
  const onWireClick = (hit: PointerHit) => {
    if (!ui || !pickId) return;
    const from = ui.wire.first;
    const next = labUiClick(pickId, ui, hit);
    setUi(next);
    syncUrl(next.graph, next.dirty);
    // W22-A P0-1：两次点击加构件也会改图 —— 同 step() 一样清掉过期的拒答。
    if (next.graph !== ui.graph) {
      setRefusal((prev) => (prev.length > 0 ? [] : prev));
      setStage((prev) => (prev === 'refused' ? 'editing' : prev));
    }
    if (from && (hit.kind === 'pin' || hit.kind === 'node') && next.graph !== ui.graph) {
      setLastLink({ from, to: hit.key });
      // W17-C：加杆模式里连完一根杆就退出模式（继续加再点一次「加杆」）。
      setLinkMode(false);
    } else if (hit.kind === 'blank') {
      setLastLink(null);
    }
    if (next.graph === ui.graph && next.note && next.note !== ui.note) onToast(next.note);
    // 点到别处就收起引脚列表（它是「这个器件有什么脚」的临时答案）。
    if (hit.kind !== 'body') setPinList(null);
  };

  /* ── R3-4 U1 放置器：hover 预告 + 松手落条件 ─────────────────────── */

  const placeDownRef = useRef<{ x: number; y: number } | null>(null);

  const onPlaceHover = (x: number, y: number) => {
    if (!ui || placeTool === 'off') return;
    const { ghost, ambiguous } = hoverAt(ui.graph, placeTool, x, y, { value: placeValue, dir: loadDir }, placeAlt);
    setPlaceAmbiguous(ambiguous);
    setPlaceGhost(ghost);
  };

  const onPlaceDown = (x: number, y: number) => {
    placeDownRef.current = { x, y };
  };

  /**
   * 松手 = 落条件。方向取自「按下 → 松手」的位移（小于 8 单位按垂直向下）；
   * 真正要写进图的 op 由 place.ts 给，这里只负责执行 + 把人话说出来。
   */
  const onPlaceUp = (x: number, y: number) => {
    if (!ui || !pickId || placeTool === 'off') return;
    const down = placeDownRef.current ?? { x, y };
    placeDownRef.current = null;
    const hit = placeHit(ui.graph, down.x, down.y, placeAlt);
    const opts: PlaceOptions = {
      value: placeValue,
      dir: placeTool === 'point' ? dirFromDrag(x - down.x, y - down.y, loadDir) : loadDir,
    };
    const plan = placePlan(ui.graph, placeTool, hit, opts);
    if (plan.refused || plan.ops.length === 0) {
      onToast(plan.refused ?? '这里落不了条件');
      return;
    }
    // 先空跑一遍拿人话（拒绝也在这里说清楚），再真落 —— 不靠猜文案。
    const preview = applyOp(pickId, ui.graph, plan.ops[0]);
    if (preview.refused) {
      onToast(preview.refused);
      return;
    }
    for (const op of plan.ops) mutate(op);
    onToast(preview.rules[preview.rules.length - 1] ?? '已落到图上');
    setPlaceGhost(null);
  };

  /**
   * Esc 总闸（㊱⑤）：确认条 / 兜底条 / 浮层都要能被 Esc 关掉 ——
   * 以前只有放置器吃 Esc，恢复骨架/清空画布的确认条只能靠鼠标点「取消」。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /** 两个候选咬得很近时「Tab 待选的那一个」—— Esc 也要能把它放掉。 */
      const pendingCandidate = placeAmbiguous ? placeAlt : null;
      if (event.key === 'Escape' && (resetArmed || clearArmed || pendingCandidate || pendingLoadCandidate || pendingDelete || shareFallback || candidatesOpen || wrapPanel || favoriteOpen || exportOpen)) {
        setResetArmed(false);
        setClearArmed(false);
        setPendingLoadCandidate(null);
        setPendingDelete(null);
        setShareFallback(null);
        setCandidatesOpen(false);
        setWrapPanel(null);
        setFavoriteOpen(false);
        setExportOpen(false);
        if (pendingCandidate) setPlaceAlt(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resetArmed, clearArmed, pendingDelete, shareFallback, candidatesOpen, wrapPanel, favoriteOpen, exportOpen, pendingLoadCandidate, placeAmbiguous, placeAlt]);

  /** Esc：退出放置器（拖到一半也一并放掉）。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (placeTool === 'off') return;
      if (event.key === 'Escape') {
        setPlaceTool('off');
        setPlaceGhost(null);
        placeDownRef.current = null;
      }
      // 两个候选咬得很近时，Tab 在它们之间切换（「差 <3 提示 Tab 切换候选」）。
      if (event.key === 'Tab' && placeAmbiguous) {
        event.preventDefault();
        setPlaceAlt((current) => (current === 0 ? 1 : 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placeTool, placeAmbiguous]);

  const onNodeMove = (nodeId: string, x: number, y: number) => {
    if (!beforeDragRef.current) beforeDragRef.current = ui?.graph ?? null;
    stepLive({ type: 'moveNode', nodeId, x, y });
  };
  const onNodeMoveEnd = () => {
    const before = beforeDragRef.current;
    beforeDragRef.current = null;
    if (before) {
      stepLive({ type: 'moveNodeEnd', before });
      // 拖动不走 step()，URL 同步在这里补（用落点后的最新图）。
      setUi((current) => {
        if (current) syncUrl(current.graph, true);
        return current;
      });
    }
  };
  const onNodeMoveCancel = (nodeId: string, x: number, y: number) => {
    beforeDragRef.current = null;
    stepLive({ type: 'moveNode', nodeId, x, y });
  };

  /** 载入三候选之一：换骨架不换求解器；换归约表的那张直接跳对应路由。
   *  W21-A A1：无论走哪条分支，先把上一份解 / 讲解稿 / 横幅 / solver 闭包清空，
   *  给一帧 idle，再由新图重建 ui.preview；结果区的 render_specs 由下一次
   *  带 variant.config 的求解重新生成，绝不沿用旧模板的主图。 */
  /** 黑盒回归修复：图已被改动时载入别的骨架会整张覆盖 —— 先亮确认条，别静默丢数据。 */
  const loadCandidate = async (candidate: Candidate) => {
    if (!pickId || !ui || candidate.source.kind === 'none') return;
    if (ui.dirty) {
      setPendingLoadCandidate(candidate);
      onToast(`画布有未保存的改动 —— 载入「${candidate.title}」会全部丢掉，确认条里点「仍要载入」`);
      return;
    }
    await doLoadCandidate(candidate);
  };

  const doLoadCandidate = async (candidate: Candidate) => {
    if (!pickId || !ui || candidate.source.kind === 'none') return;
    setStage('idle');
    setSolution(null);
    setGeneric(null);
    setVerdict(null);
    setRefusal([]);
    setConfirmed({});
    solverRef.current = null;
    if (candidate.source.baseTemplateId !== pickId) {
      // 换归约表：整张状态交回路由 effect 重建，页面不留上一题的任何数字。
      setUi(null);
      specRef.current = null;
      onStart(`#/lab/t/${candidate.source.baseTemplateId}`);
      onToast(`「${candidate.title}」用另一张归约表，已切到对应装配台`);
      return;
    }
    const example = await getExample(candidate.source.exampleId);
    if (!example) return;
    const spec = labSkeletonSpec(pickId, example.render_specs[0]);
    const defaults = candidateDefaults(candidate, defaultValues(pickId), ui.preview.params);
    specRef.current = spec;
    step({
      type: 'loadCandidate',
      candidateId: candidate.id,
      baseTemplateId: candidate.source.baseTemplateId,
      spec,
      defaults,
    });
    setSpecType(spec.type);
    setValues(defaults);
    setConfirmed({});
    setDerivedKeys([]);
    setLastLink(null);
    setSelectedIds([]);
    setSolution(null);
    setVerdict(null);
    setGeneric(null);
    setRefusal([]);
    setStage('editing');
    setCandidatesOpen(false);
    onToast(`已载入「${candidate.title}」：共享参数继承了当前图（含 Rc 等改动）`);
  };

  const peekCandidate = (candidate: Candidate) => {
    setPeeked(candidate.id);
    if (pickId) step({ type: 'peekCandidate', candidateId: candidate.id });
  };

  const onParamChange = (key: string, value: ParamValue, opts?: { confirmed?: boolean }) => {
    if (!pickId) return;
    const next = { ...displayValues, [key]: value };
    setValues(next);
    // 实时档（参数实验场）：改值算「你已经确认过这一项」，闸门不撤 —— 否则每拖一下
    // 都要重新确认一次，看起来就像「不实时」。
    setConfirmed((current) => ({ ...current, [key]: opts?.confirmed === true }));
    setDerivedKeys((current) => current.filter((one) => one !== key));
    mutate({ op: 'applyParams', values: next });
  };

  /** 快填「写入参数表」：只写本型参数表真有的键，写入项标「推得」且回到未确认。 */
  const onQuickWrite = (patch: Record<string, number>, keys: string[]) => {
    const next = { ...displayValues, ...patch };
    setValues(next);
    setDerivedKeys(keys);
    // 模式1 推出的是 π 模型内部量，参数表没有对应项：不要为了「点了写入」把图标成已改动。
    if (keys.length === 0) return;
    setConfirmed((current) => {
      const copy = { ...current };
      for (const key of keys) copy[key] = false;
      return copy;
    });
    mutate({ op: 'applyParams', values: next });
  };

  /** 恢复骨架：先亮确认条（reset-skeleton-confirm，yes/no 都是 aria 可见的
   *  button —— 之前是「再点一次」式，读屏与自动化都够不着）。 */
  const resetSkeleton = () => {
    if (!pickId || !specRef.current) return;
    setResetArmed(true);
    onToast('会丢掉全部改动 —— 确认条里点「确认恢复」');
  };
  const confirmResetSkeleton = () => {
    if (!pickId || !specRef.current) return;
    step({ type: 'reset', templateId: pickId, spec: specRef.current });
    setValues(initialValues(pickId).values);
    setConfirmed({});
    setDerivedKeys([]);
    setLastLink(null);
    setSelectedIds([]);
    setSelectedMember(null);
    setSelectedObject(null);
    setLinkMode(false);
    setSolution(null);
    setVerdict(null);
    setGeneric(null);
    setRefusal([]);
    setStage('editing');
    setResetArmed(false);
    setLoadedFromLink(false);
    onToast('已恢复骨架');
  };

  // 修复计划 T1.1：写入目标不在画布上的参数（q：图上没有均布载荷）不参与确认闸 ——
  // 它本来就不进计算，卡着「未确认」只会让人以为机器坏了。
  const writableParams = params.filter((p) => (pickId ? paramWriteBlock(pickId, graph, p.key) === null : false));
  const allConfirmed = params.length > 0 && writableParams.length > 0 && writableParams.every((p) => confirmed[p.key]);

  /** R-36：收藏 = 把当前张图存成一条 SavedGraph（首页可一键载回）。 */
  const openFavorite = () => {
    if (!pickId) return;
    setFavoriteName(`${pickId} · ${labTitle}`);
    setFavoriteOpen((open) => !open);
  };
  const saveFavorite = () => {
    if (!pickId || !graph) return;
    const entry = makeSavedGraph(pickId, graph, labTitle, ui?.dirty === true, favoriteName);
    setLibrary((prev) => addFavorite(prev, entry));
    setFavoriteOpen(false);
    onToast(`已收藏「${entry.title}」—— 装配台首页可一键载入`);
  };
  const startFromLibrary = (hash: string) => {
    onStart(hash);
  };
  const forgetFavorite = (id: string) => {
    setLibrary((prev) => removeFavorite(prev, id));
  };
  const renameFavoriteEntry = (target: SavedGraph, name: string) => {
    setLibrary((prev) => renameFavorite(prev, target.id, name));
  };
  const retagFavoriteEntry = (target: SavedGraph, tags: string[]) => {
    setLibrary((prev) => setFavoriteTags(prev, target.id, tags));
  };
  const clearLibraryHistory = () => {
    setLibrary((prev) => clearHistory(prev));
    onToast('已清空最近使用');
  };
  const changeLibrarySort = (next: LibrarySort) => {
    setLibrarySort(next);
    saveLibrarySort(next);
  };

  /** R-37：导出装配图 —— 绘制层 svg 内联样式后存成独立文件。 */
  const exportGraphImage = async (kind: 'svg' | 'png') => {
    setExportOpen(false);
    const source = findGraphSvg(document);
    if (!source) {
      onToast('没找到可导出的画布 —— 请先载入一个题型');
      return;
    }
    try {
      const { text, box } = buildStandaloneSvg(source);
      const blob =
        kind === 'svg'
          ? new Blob([text], { type: 'image/svg+xml;charset=utf-8' })
          : await svgToPngBlob(text, box);
      downloadBlob(blob, graphFileName(pickId ?? 'graph', kind));
      onToast(`已导出 ${kind.toUpperCase()} 装配图`);
    } catch (error) {
      onToast(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** 清空画布：先亮确认条（可撤销），确认后整图清空、参数表与求解器保留。 */
  const armClearCanvas = () => {
    if (canvasEmpty) return;
    setClearArmed(true);
    onToast('会清掉画布上全部器件、导线与标注 —— 确认条里点「确认清空」（Ctrl+Z 可撤销）');
  };
  const confirmClearCanvas = () => {
    mutate({ op: 'clearGraph' });
    setClearArmed(false);
    setResetArmed(false);
    // 黑盒 #37：画布空了，归约来源也没了 —— 四个勾不能还挂着「全部已确认」。
    setConfirmed({});
    setDerivedKeys([]);
    setSelectedIds([]);
    setSelectedObject(null);
    setSelectedMember(null);
    setSolution(null);
    setVerdict(null);
    setGeneric(null);
    setRefusal([]);
    setStage('editing');
    onToast('已清空画布：现在可以自己加器件 / 连线 / 加构件了（Ctrl+Z 可撤销）');
  };

  /** R-36：库一改就落盘（无 localStorage 时 saveLibrary 自己静默降级）。 */
  useEffect(() => {
    saveLibrary(library);
  }, [library]);

  /** R-36：改过的图自动记进「最近使用」（同一题型只留最新一条）。 */
  useEffect(() => {
    if (!pickId || !graph) return;
    const dirty = ui?.dirty === true;
    setLibrary((prev) => touchHistory(prev, makeSavedGraph(pickId, graph, labTitle, dirty)));
    // graph 换一次（载入 / 撤销 / 拖动）记一次；title 随题型变。
  }, [graph, pickId, labTitle, ui?.dirty]);

  /**
   * `force` = 参数实验场的重算：结构没动、只改了数字。
   * W21-A A2.3：确认是真闸门 —— force 也不绕过，未逐项确认时撤下结果、撤下
   * 校验章并回到 editing（报告 5.3「改了 L 未确认也照算照盖章」）。
   */
  const solve = async (force = false) => {
    if (!graph || !ui || !pickId || !entry) return;
    // force 仍保留在签名里（参数实验场按这个通道重算），但已不再豁免确认闸。
    void force;
    if (!allConfirmed) {
      setSolution(null);
      setGeneric(null);
      setVerdict(null);
      setRefusal([]);
      setStage('editing');
      return;
    }
    // 修复计划 T1.2：越界参数不给静默求解 —— 求解前拦下，红 banner 常驻（不是
    // 一闪而过的 toast），带合法区间；改回区间红条自然消失。
    const outOfRange = writableParams.filter((param) => {
      const value = displayValues[param.key];
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))
      );
    });
    if (outOfRange.length > 0) {
      setSolution(null);
      setGeneric(null);
      setVerdict(null);
      setRefusal(
        outOfRange.map(
          (param) =>
            `${param.label ?? param.key} = ${displayValues[param.key]}${param.unit ? ` ${param.unit}` : ''} 超出合法区间 ${param.min ?? '−∞'} ~ ${param.max ?? '+∞'}${param.unit ? ` ${param.unit}` : ''}：改回区间后再求解`,
        ),
      );
      setStage('refused');
      return;
    }
    setStage('solving');
    const started = performance.now();
    // W15-S4 两级入口：归约无硬伤 → 模板五步；有硬伤不再拒答，先问通用求解器；
    // 通用求解器也解不动（拓扑非法：noGround / 机构 / 源环路…）才是 U 档拒答。
    const route = resolveLabSolve(pickId, graph, ui.rules);
    if (route.kind === 'refused') {
      setSolution(null);
      setGeneric(null);
      setRefusal([route.reason]);
      setStage('refused');
      return;
    }
    if (route.kind === 'generic') {
      setSolution(null);
      setRefusal([]);
      // ㉞⑤：等效电路与「这张图的值」同源 —— 都用这一份归约解推，不另算一套。
      const equivalent = deriveCircuitEquivalent(graph, route.circuit);
      setGeneric({
        family: route.family,
        circuit: route.circuit,
        frame: route.frame,
        notices: route.notices,
        measures: route.measures,
        reason: route.reason,
        equivalent,
        acEquivalent: deriveAcEquivalent(graph),
      });
      setVerdict(genericVerdict(route.family));
      setSolveMs(performance.now() - started);
      setStage('solved');
      return;
    }
    const current = ui.preview;
    try {
      // W21-A A1：solver 只认当前路由。ref 为空（刚换过结构 / 被打断）就按
      // 当前 entry 现载一份，绝不拿上一题的闭包顶上。
      let solveFn = solverRef.current;
      if (!solveFn) {
        const loaded = await entry.solver?.();
        if (!loaded) return;
        solveFn = loaded.default as (input: unknown) => Solution;
        solverRef.current = solveFn;
      }
      const variant = getTemplateRoute(pickId)?.variant;
      /**
       * W21-A A1 真根因：M3-cantilever 这类 variant 的公式分支写在 solver 的
       * `input.config` 上，而归约表只给 L/a/P/q。以前把 current.params 直接喂给
       * solver，悬臂图会按简支公式算出 RA=5/RB=5/Mmax=5（连刷新都错）。
       * 这里把当前路由的 variant.config 补进同一份输入，标题 / 画布 / 结果表
       * 就都由这同一份 {entryId, graph, params} 生成。
       */
      const solverInput = {
        ...current.params,
        ...(variant?.config ? { config: variant.config } : {}),
      };
      setGeneric(null);
      const base = solveFn(solverInput);
      const live = await validateLive(entry, variant, base, solverInput);
      const report = withLabChecks(
        live.confidence,
        { state: 'pass' as const, detail: current.appliedRules.length > 0 ? `结构改动已逐条核对（${current.appliedRules.length} 条）` : '骨架未改动，归约逐键一致' },
        current.semantic,
      );
      const verdictLocal = {
        ...verdictOf(false, [], current.semantic, 0, graph?.family),
        // W21-A A4：横幅与徽标 / 页脚同一个口径，不再宣称「六项全部通过」。
        detail: `校验口径：${confidenceSummary(report)}；跳过项见「自检」。`,
      };
      // N 档：数值保留，但第 4 帧换成「等价模型 + 方程」，等效图不渲染
      const nTier = verdictLocal.tier === 'N';
      const final: Solution = {
        ...base,
        confidence: report,
        validatedAt: new Date().toISOString(),
        contractVersion: CONTRACT_VERSION,
        warnings: [
          ...filterWarningsByCapability(base.warnings, capabilities),
          ...current.appliedRules,
        ],
        steps:
          nTier && base.steps.length > 3
            ? base.steps.map((one) =>
                one.i === 3
                  ? { ...one, title: N_TIER_STEP4_TITLE, substitution: '结构改动后的等价模型与方程（等效图不渲染：语义未确认）', highlight: [] }
                  : one,
              )
            : base.steps,
        render_specs: nTier ? base.render_specs.filter((spec) => !spec.derivedFrom) : base.render_specs,
      };
      setSolution(final);
      setVerdict(verdictLocal);
      setSolveMs(performance.now() - started);
      setStage('solved');
    } catch (error) {
      // 修复计划 T1.2：求解异常不能只靠 toast（一闪就没）—— 常驻红 banner +
      // 回到 refused，toast 只做辅助播报。
      const message = error instanceof Error ? error.message : String(error);
      setSolution(null);
      setGeneric(null);
      setVerdict(null);
      setRefusal([`求解失败：${message}`]);
      setStage('refused');
      onToast(`求解失败：${message}`);
    }
  };

  /** 参数实验场改值 → 等归约预览刷新后重算一次（不依赖用户再点「分步求解」）。 */
  const recomputeArmed = useRef(false);
  const solveRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    solveRef.current = solve;
  });
  useEffect(() => {
    if (!recomputeArmed.current) return;
    if (stage !== 'solved') return;
    recomputeArmed.current = false;
    void solveRef.current?.(true);
  }, [ui, stage]);
  // 修复计划 T1.3：已求解状态下切单位制 → 静默重解一次（同一张图同一批参数），
  // 读数 headline 里的单位跟着变；未求解时切制只影响渲染期格式化，无需重解。
  useEffect(() => {
    if (stage === 'solved') void solveRef.current?.(true);
  }, [unitMode]);
  // 修复计划 T2.2：浮层溢出视口就整体平移回视口内（右缘优先对齐视口右 −8px，
  // 左缘同理；宽度已是 min(900px, 100vw−2rem)，两侧同时溢出不会发生）。
  const clampCandidates = useCallback(() => {
    const el = candidatesPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const shift = rect.right > vw - 8 ? vw - 8 - rect.right : rect.left < 8 ? 8 - rect.left : 0;
    setCandidatesShift(shift);
  }, []);
  useLayoutEffect(() => {
    if (!candidatesOpen) {
      setCandidatesShift(0);
      return;
    }
    clampCandidates();
    window.addEventListener('resize', clampCandidates);
    return () => window.removeEventListener('resize', clampCandidates);
  }, [candidatesOpen, clampCandidates]);

  /** 黑盒 #4：按钮触发的求解成功 → 结果区滚进首屏（实时重算不带标记，不滚）。
   *  即时跳转而不是 smooth：smooth 依赖渲染帧，遮挡 / 后台窗口会整段不滚。 */
  useEffect(() => {
    if (stage !== 'solved' || !scrollAfterSolveRef.current) return;
    scrollAfterSolveRef.current = false;
    resultSectionRef.current?.scrollIntoView({ block: 'start' });
  }, [stage]);

  /** 参数实验场：改一个值 → 归约预览与结果同时变（H-11）。 */
  const experimentChange = (key: string, value: ParamValue) => {
    // 实时档：这次改值当作「已确认」，所以 solve 的确认闸门不撤，结果区跟着滑杆变。
    onParamChange(key, value, liveExperiment ? { confirmed: true } : undefined);
    if (stage === 'solved') recomputeArmed.current = true;
  };
  const experimentReset = (key: string) => {
    const param = params.find((one) => one.key === key);
    if (!param) return;
    onParamChange(key, param.defaultValue as ParamValue, liveExperiment ? { confirmed: true } : undefined);
    if (stage === 'solved') recomputeArmed.current = true;
  };
  const experimentResetAll = () => {
    if (!pickId) return;
    const next = defaultValues(pickId);
    setValues(next);
    setConfirmed({});
    setDerivedKeys([]);
    mutate({ op: 'applyParams', values: next });
    if (stage === 'solved') recomputeArmed.current = true;
  };

  /**
   * AI 识图（默认关）：只在用户点了按钮之后发一次请求。
   * 成功 → 结构草稿落成图、跳到同一型（?g=&from=题面）；失败 → **图与结果原地不动**，只多一行。
   */
  const runVision = async () => {
    if (!visionImage || !graph) return;
    setVisionBusy(true);
    try {
      const out = await readStructure([visionImage]);
      if (out.ok && out.draft) {
        const targetId = out.draft.templateId;
        const seed = labDraftFromAIDraft(out.draft);
        if (!seed.ok) {
          setVisionNote(`AI 读出了 ${targetId}，但草稿不可用：${seed.reason}`);
          return;
        }
        const example = await getExample(targetId);
        if (!example) {
          setVisionNote(`AI 读出了 ${targetId}，但这一型没有骨架可落。`);
          return;
        }
        const built = draftToGraph(seed.draft, labSkeletonSpec(targetId, example.render_specs[0]));
        if (!built.ok) {
          setVisionNote(`AI 读出了 ${targetId}，但结构草稿落不成图：${built.reason}`);
          return;
        }
        const encoded = encodeURIComponent(encodeSharePayload({ graph: built.graph, defs: usedCompositeDefs(built.graph) }));
        onStart(`#/lab/t/${targetId}?g=${encoded}&from=题面`);
        return;
      }
      // 失败不阻断：keepOnFailure 把原因折成一行，图与已有结果都还在
      setVisionNote(keepOnFailure(graph, out.reason).note);
    } catch (error) {
      setVisionNote(keepOnFailure(graph, error instanceof Error ? error.message : String(error)).note);
    } finally {
      setVisionBusy(false);
    }
  };

  /** ㉟⑦：通用解会硬拒答、但补几个数就能解的器件 —— 就地列出可填的字段。 */
  const missingParams = useMemo(() => missingModelParams(graph), [graph]);

  /**
   * ㉟⑦：仍停在「参考量级」的字段（现值恰好等于字段表里的 example）——
   * 这些数只是输入框灰字提示，**不是题面值**；界面上必须标出来，免得用户当成答案。
   */
  const givenDefaults = useMemo(() => {
    const out = new Set<string>();
    for (const node of graph?.nodes ?? []) {
      for (const field of deviceParamFields(node)) {
        if (deviceParamValue(node, field) === field.example) out.add(`${node.id}:${field.key}`);
      }
    }
    return out;
  }, [graph]);
  /** ㉟⑦：补一个模型参数就写进图（一项 op，避免逐字段基于同一份闭包互相覆盖）。 */
  const applyMissingParams = (nodeId: string, field: DeviceParamField, value: number) => {
    if (!(Number.isFinite(value) && value > 0)) return;
    const entry = field.source === 'value' ? { nodeId, value } : { nodeId, params: { [field.key]: value } };
    mutate({ op: 'setDeviceParams', entries: [entry as { nodeId: string; value?: number; params?: Record<string, number> }] });
    setPendingParamSolve(nodeId);
  };
  /** ㉛④：一键标全语义 —— 按题型拓扑给建议，逐个 setSemantic 写进去（可撤销）。 */
  const markAllSemantics = () => {
    if (!pickId || !graph) return;
    const suggestions = suggestSemantics(pickId, graph);
    if (suggestions.length === 0) {
      onToast('这张图的拓扑没给出可标的语义 —— 手动在器件行选吧');
      return;
    }
    for (const suggestion of suggestions) {
      mutate({ op: 'setSemantic', nodeId: suggestion.nodeId, semantic: suggestion.semantic });
    }
    onToast(`已按拓扑标全 ${suggestions.length} 个关键语义（可撤销）`);
  };

  /** ㉟⑧：补完模型参数就自动重解 —— 屏幕上不再挂旧增益。 */
  useEffect(() => {
    if (!pendingParamSolve) return;
    setPendingParamSolve(null);
    void solveRef.current?.();
  }, [pendingParamSolve]);
  /** ㉛④：一键确认全部 —— 默认值也要点一次，这是真闸门。
   *  修复计划 T1.1：只确认「写得进图」的参数；不可写的（q：图上没有均布载荷）
   *  不参与确认闸，也不占「N 项」的数。
   *  修复计划 T1.2：越界的值**允许确认**（确认 = 签收「我看过这个数」），
   *  越界拦截统一在 solve() 里做常驻红条 —— 否则 a=0 连确认都点不了，
   *  求解按钮永远灰着，用户不知道卡在哪。 */
  const confirmAllParams = () => {
    const bad = writableParams.filter((param) => {
      const value = displayValues[param.key];
      return typeof value === 'number' && ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max));
    });
    const next: Record<string, boolean> = { ...confirmed };
    for (const param of writableParams) next[param.key] = true;
    setConfirmed(next);
    onToast(
      bad.length > 0
        ? `已确认全部 ${writableParams.length} 项 —— ${bad.map((param) => param.label ?? param.key).join('、')} 超出合法区间，求解会被拦下`
        : `已确认全部 ${writableParams.length} 项，可以求解了`,
    );
  };

  const shareLink = () => {
    if (!graph) return;
    // W13 §5：图里引用了自定义复合器件时，定义必须随链接走 —— 否则别人的
    // 机器上会少一块。只带本次用到的，不带全部；内置定义人手一份不进链接。
    const payload = { graph, defs: usedCompositeDefs(graph) };
    const encoded = encodeSharePayload(payload);
    // base64 里的 `+` 会被 URLSearchParams 解成空格（W15-S4 截图流程踩出来的
    // 潜伏 bug：带 + 的分享链接会静默回落骨架）——这里显式百分号编码。
    const hash = `#/lab/t/${pickId}?g=${encodeURIComponent(encoded)}`;
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    void copyText(url).then((ok) => {
      if (ok) {
        setShareFallback(null);
        onToast(payload.defs.length > 0 ? `分享链接已复制（含 ${payload.defs.length} 个自定义模块定义）` : '分享链接已复制');
      } else {
        setShareFallback(url);
        onToast('浏览器没给剪贴板权限 —— 链接已显示在页面上，手动复制即可');
      }
    });
  };

  const devices = graph?.nodes.filter((node) => !['text', 'dot'].includes(node.kind)) ?? [];
  /* W22-A：恢复骨架 / 载入候选自增 meta.resetAt —— 画布与列表树以此为 key
     强制 remount，不给「reconciliation 收敛不干净留旧行」任何机会。 */
  const resetKey = `${pickId}:${graph?.meta.resetAt ?? 0}`;
  const isBeam = pickId ? PICKS[pickId]?.family === 'beam' : false;
  /** P0-1：力学构件的真实种类。family 只管「力学 / 电路」两套机器，元素种类是另一根轴：
   *  轴向拉压（M1）与压杆稳定（M7）是 bar，扭转（M2）是 shaft，梁 / 框架才是 beam。 */
  const mechElement = (pickId && PICKS[pickId]?.element) ?? 'beam';
  const axialElement = mechElement === 'bar';
  const shaftElement = mechElement === 'shaft';
  /** P1：电路题的器件白名单（picks.ts 里本来就有，给 rejects 用的那一份）。
   *  只有白名单里的种类才摆「加入器件」——运放页不给晶体管，二极管页不给 MOSFET。 */
  const circuitWhitelist = (pickId && PICKS[pickId]?.whitelist) ?? null;
  /** 修复计划 T3.5：空态提示按白名单点名可加的器件（接地在 CIRCUIT_ADDS 里，去重）。 */
  const allowedAdds = CIRCUIT_ADDS.filter((item) => !circuitWhitelist || circuitWhitelist.includes(item.kind));
  const circuitAddHint = [
    ...allowedAdds.map((item) => `+ ${item.label}`),
    ...(allowedAdds.some((item) => item.kind === 'gnd') ? [] : ['+ 接地']),
  ].join(' / ');
  /** ㊱⑦：只有真在可装配清单里的题型才有「看原题」；空 id / 未知 id 不给死链。 */
  const peekTemplateId = pickId && PICKS[pickId] ? pickId : null;
  /** W17-C：力学「物件」组含结点（dot 是自由度载体，可删、连带杆先确认）；
   *  电路维持「器件」组（dot 不可按器件删）。行来源 = inspect 分组函数。
   *  R3-1 A1：支座行是结点子行（无自己的节点）—— 选中 / 删除都落到父结点上。 */
  const objectRows = graph && isBeam ? beamObjectRows(graph) : [];
  const objectNodes = graph && !isBeam ? devices : [];
  const objectNameOf = (node: (typeof devices)[number]) => {
    const text = (node.label ?? '').trim();
    if (text) return text;
    return isBeam && node.kind === 'dot' ? node.id.replace(/^n-/, '').toUpperCase() : node.kind;
  };
  /** R3-1 A2：加支座 / 载荷的唯一目标 = 当前选中的结点（没选就不给加）。 */
  const addTarget = graph ? addTargetOf(graph, selectedObject) : { nodeId: null, reason: '先打开一张骨架。' };
  const selectedJointNode = graph ? selectedJointOf(graph, selectedObject) : null;
  const selectedLoadNode = graph?.nodes.find((node) => node.id === selectedObject && ['arrow', 'udl', 'momentArrow', 'torqueArrow'].includes(node.kind)) ?? null;
  /** 载荷在跨上的当前位置（选中条里 t 输入框的默认值来源）。 */
  const objectSpan = graph ? mainSpanOf(graph) : null;
  const loadTNow = selectedLoadNode && objectSpan ? tOnSpan(objectSpan, selectedLoadNode.x) : null;
  const critical = preview?.semantic.critical ?? [];
  /** 13 型没结构可装：直接给专属原因 + 去向，不让人卡在选题列表里。 */
  const naView = templateId ? notApplicableView(templateId) : null;
  const customModules = registeredComposites();

  /** W17-C 杆行（单一来源 = inspect.beamMemberRows）：杆组与「合并回器件组」
   *  的变异形态共用同一段渲染 —— ㉘ 的行数断言与页面所见严格一致。 */
  const memberRowList = graph && isBeam
    ? beamMemberRows(graph).map((row) => {
        const edge = graph.edges.find((one) => one.id === row.id);
        if (!edge) return null;
        return (
          <li
            key={row.id}
            data-testid="member-row"
            data-edge={row.id}
            className={`flex items-center gap-1 rounded text-[11px] ${selectedMember === row.id ? 'bg-cyan/10 text-cyan' : ''}`}
          >
            <button
              type="button"
              onClick={() => selectMember(selectedMember === row.id ? null : row.id)}
              className="id-mono min-w-0 truncate text-cyan hover:underline"
              title={`选中这个构件（${row.name}）`}
            >
              {row.name}
            </button>
            <span className="shrink-0 whitespace-nowrap text-muted">{row.kindLabel}</span>
            {(mechElement === 'beam' ? (['A', 'I', 'E'] as const) : (['A', 'E'] as const)).map((key) => (
              <label key={`${edge.id}-${key}`} className="flex shrink-0 items-center gap-0.5">
                {/* 三个框原来只有 title，屏幕上就是一排光秃秃的数字（P0：看不出哪个是 A/I/E）。 */}
                <span className="text-[9px] leading-none text-muted" aria-hidden="true">
                  {key}
                </span>
                <input
                  data-testid={`member-${key.toLowerCase()}`}
                  data-edge={edge.id}
                  type="number"
                  defaultValue={edge[key] ?? 1}
                  step="any"
                  aria-label={`构件 ${row.name} 的 ${key}（相对比例，EA=E·A / EI=E·I）`}
                  title={`${key}（相对比例，EA=E·A / EI=E·I）`}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value > 0 && value !== (edge[key] ?? 1)) {
                      mutate({ op: 'setMemberProps', edgeId: edge.id, [key]: value });
                    }
                  }}
                  className="w-9 min-w-0 rounded border border-line bg-bg px-0.5 text-right text-[10px] text-ink"
                />
              </label>
            ))}
            <button
              type="button"
              data-testid="delete-member"
              onClick={() => deleteMember(edge.id)}
              className="ml-auto rounded border border-line px-1 text-[10px] text-danger hover:border-danger/60"
              aria-label={`删除构件 ${edge.id}`}
            >
              删
            </button>
          </li>
        );
      })
    : [];

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-ink">
      {/* 环境光 + 制图网格：光斑给玻璃取色，网格随滚动视差（首页同一层） */}
      <div className="lab-ambient" aria-hidden="true">
        <span className="lab-glow lab-glow-a" />
        <span className="lab-glow lab-glow-b" />
        <Parallax speed={0.04} className="draft-grid absolute -inset-x-10 -top-16 h-[170%] opacity-[0.14]" />
      </div>

      <header className="no-print sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] w-full max-w-[1440px] items-center gap-4 px-6">
          <button
            type="button"
            onClick={onBack}
            className="focus-ring shrink-0 font-mono text-[11px] tracking-[0.08em] text-muted transition-colors hover:text-ink"
          >
            ← 返回
          </button>
          <span className="h-4 w-px shrink-0 bg-[var(--color-line-2)]" aria-hidden="true" />
          <a href="#/lab" aria-label="装配台索引" className="focus-ring flex shrink-0 items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 20V6l8 4 8-4v14l-8-4-8 4Z" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 10v8" stroke="var(--color-cyan)" strokeWidth="1.5" />
            </svg>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">装配台</span>
            <span className="hidden font-mono text-[10.5px] tracking-[0.12em] text-faint sm:inline">改结构，不改求解器</span>
          </a>
          {/* 黑盒 #31：全站同一套 SiteNav（知识库 · 数字求值 · 范围 · 看原题） */}
          <SiteNav current="lab">
            {peekTemplateId ? (
              <a
                href={`#/t/${peekTemplateId}`}
                onClick={(e) => { e.preventDefault(); onStart(`#/t/${peekTemplateId}`); }}
                className="focus-ring text-[13px] text-cyan transition-colors hover:text-ink"
              >
                看原题
              </a>
            ) : pickId ? (
              <span className="hidden text-[11px] text-faint md:inline">看原题（当前题型不在装配台清单里）</span>
            ) : null}
          </SiteNav>
          <ThemeToggle />
        </div>
      </header>

      <main className="lab-surface page-enter relative z-10 mx-auto w-full max-w-[1440px] px-6 pb-16 pt-6">
        {naView ? (
          <NotApplicableCard view={naView} />
        ) : pickId && loadError ? (
          /* 载入失败：不再静默停在索引页，点名失败环节并给重试 */
          <LoadingPlate
            testId="lab-load-error"
            title={`「${pickId}」没载入成功`}
            error={loadError}
            onRetry={() => setLoadAttempt((count) => count + 1)}
          />
        ) : pickId && !ui ? (
          /* 载入窗口：骨架快照 + solver 分包在拉 —— 点卡片之后立刻有反馈 */
          <LoadingPlate
            testId="lab-loading"
            title={`正在装配 ${pickId}`}
            detail={getTemplateRoute(pickId)?.entry.title ?? '载入骨架、装配判据与求解器…'}
          />
        ) : stage === 'idle' || !graph || !pickId || !ui ? (
          <section>
            {templateId && !PICKS[templateId] ? (
              <p
                data-testid="unknown-template-note"
                className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger"
              >
                「{templateId}」不在装配台可装配清单里 —— 链接可能拼错了，或这个题型只在解题页可看。
                下面是能装配的题型，点一张从它的骨架开始。
              </p>
            ) : null}
            {/* 首屏：与首页同一套版式 —— 眉标 / 大字 / 一句话 / 事实行 */}
            <div className="max-w-[860px]">
              <div className="flex items-center gap-3">
                <span className="tag-mono">
                  <span className="inline-block h-1 w-1 rounded-full bg-cyan" />
                  装配台 · 白名单骨架
                </span>
                <span className="draft-rule flex-1" />
                <span className="font-mono text-[10.5px] tracking-[0.1em] text-faint">
                  <CountUp value={SUPPORTED_IDS.length} decimals={0} /> 型
                </span>
              </div>
              <h1 className="mt-6 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[46px]">
                选一张骨架，
                <br />
                <span className="text-cyan">
                  <DecodeText text="改到能算为止。" />
                </span>
              </h1>
              <p className="mt-5 max-w-[600px] text-[14px] leading-[1.9] text-muted">
                打开就是一张对的图。删器件、加器件、删构件、加构件、改参数，确认已知量后求解；
                结构改动逐条记进「改动台账」—— 归约不唯一或拓扑对不上，直接拒答并告诉你该怎么改。
              </p>
              <p className="callout mt-5 max-w-[600px] font-mono text-[11px] leading-[1.9] text-muted">
                <Typewriter text="骨架是起点：也能清空画布，从两个结点、一根构件开始自己搭。" speed={17} />
              </p>
            </div>

            {/* 题型卡：错峰进场 + 悬停上浮 + 3D 倾斜 + 流光扫过 */}
            <div className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {SUPPORTED_IDS.map((id, index) => {
                const route2 = getTemplateRoute(id);
                return (
                  <Reveal key={id} delay={index * 42} fade>
                    <Tilt max={4} className="h-full">
                      <button
                        type="button"
                        onClick={() => onStart(`#/lab/t/${id}`)}
                        className="lab-tile sheen float focus-ring group h-full w-full rounded-[10px] border border-line px-3.5 py-3 text-left"
                      >
                        <p className="id-mono text-faint transition-colors group-hover:text-cyan">{id}</p>
                        <p className="mt-1 text-[12px] leading-5 text-ink">{route2?.entry.title ?? id}</p>
                      </button>
                    </Tilt>
                  </Reveal>
                );
              })}
            </div>

            {/* 跑马灯：把白名单横着摊一遍（同首页科目带） */}
            <Reveal className="mt-10 border-y border-line py-3">
              <div className="flex items-center gap-4">
                <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-faint">骨架</span>
                <span className="h-3 w-px shrink-0 bg-[var(--color-line-2)]" />
                <div className="min-w-0 flex-1">
                  <Marquee items={SUPPORTED_IDS.map((id) => `${id} · ${getTemplateRoute(id)?.entry.title ?? id}`)} speed={72} />
                </div>
              </div>
            </Reveal>

            {/* 三步叙事：滚到哪一步，左边的进度轨就长到哪 */}
            <div className="mt-12 mb-12 grid gap-8 lg:grid-cols-[150px_minmax(0,1fr)]">
              <aside className="hidden lg:flex lg:flex-col">
                <p className="font-mono text-[10px] tracking-[0.16em] text-faint">装配流程</p>
                <div className="rail ml-[3px] mt-5 min-h-[96px] flex-1">
                  <i style={{ '--p': String((labStep + 1) / 3) } as CSSProperties} />
                </div>
                <p className="mt-3 font-mono text-[10px] text-faint">
                  {String(labStep + 1).padStart(2, '0')} / 03
                </p>
              </aside>
              <ol className="space-y-6">
                {[
                  {
                    id: '01',
                    title: '载入骨架',
                    body: '每个题型都带一张已校验的骨架：支座在哪、构件几根、器件怎么接，打开就是对的。先看清它，再动手改。',
                  },
                  {
                    id: '02',
                    title: '改结构',
                    body: '删器件、加构件、拖结点、改参数。每一次改动逐条记进改动台账，撤销 / 重做都跟得上 —— 改错了能退回去。',
                  },
                  {
                    id: '03',
                    title: '确认 + 现算',
                    body: '每个参数点一次确认（默认值也要点），再求解。数值由求解器现算，校验不过就标红，不给你一个「看着像」的答案。',
                  },
                ].map((item, index) => (
                  <li key={item.id} ref={setLabStep(index)} data-step={index}>
                    <Reveal delay={index * 60}>
                      <div className="flex items-baseline gap-3">
                        <span className="sec-idx">{item.id}</span>
                        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{item.title}</h2>
                      </div>
                      <p className="mt-2 max-w-[560px] text-[13px] leading-[1.85] text-muted">{item.body}</p>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
            {/* P1：最近使用 / 我的收藏都为空时 LibraryPanel 整块 return null ——
                新人永远不知道这里会长出这两个功能。空态留一句话，功能才有被发现的机会。 */}
            {library.history.length === 0 && library.favorites.length === 0 ? (
              <p data-testid="library-empty-hint" className="mt-4 text-[11px] leading-5 text-faint">
                用过的题型会出现在这里（最近使用 + 我的收藏）；右上角「☆ 收藏」可以给一张图起名留存。
              </p>
            ) : null}
            <LibraryPanel
              library={library}
              sort={librarySort}
              onSortChange={changeLibrarySort}
              onStart={startFromLibrary}
              onRemoveFavorite={forgetFavorite}
              onRenameFavorite={renameFavoriteEntry}
              onSetTags={retagFavoriteEntry}
              onClearHistory={clearLibraryHistory}
            />
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-5">
              <a
                data-testid="lab-digital-entry"
                href="#/lab/digital"
                className="focus-ring text-[13px] text-ink transition-colors hover:text-muted"
              >
                数字求值 · 门级网表 →
              </a>
              <p className="text-[13px] text-faint">
                数字族没有可装配的几何：那边给文本网表，真值表、最小化式与门数现算。
              </p>
              <a href="#/scope" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
                不确定能不能算？走范围判别 →
              </a>
            </div>
          </section>
        ) : (
          <>
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel/55 px-3 py-2 backdrop-blur-md">
              <span className="id-mono shrink-0 text-[11px] text-cyan">{pickId}</span>
              <span className="min-w-0 truncate text-[11.5px] text-ink">{labTitle}</span>
              <span className="shrink-0 whitespace-nowrap rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {ui.dirty ? '已改动' : '骨架' } · {stage === 'editing' ? '装配中' : stage === 'solving' ? '求解中…' : stage === 'solved' ? '已求解' : '已拒答'}
              </span>
              {/* N-03：来源徽标只有一枚 —— 题面来的写全，非题面的链接只写「已从链接载入」 */}
              {fromProblem || loadedFromLink ? (
                <span
                  data-testid="badge-source"
                  data-source={fromProblem ? 'problem' : 'link'}
                  className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${
                    fromProblem ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-amber/50 bg-amber/10 text-amber'
                  }`}
                  title={
                    fromProblem
                      ? '这张图来自题面（贴文字 / 读图）解析出的结构草稿，随链接带进来 —— 结构与参数都能改，数值由求解器现算'
                      : '这张图来自链接里的 ?g=，不是骨架 —— 刷新 / 分享都会带上它；要回原题点「恢复骨架」'
                  }
                >
                  {fromProblem ? '来自题面（链接载入）· 结构与参数可改' : '已从链接载入'}
                </span>
              ) : null}
              {verdict ? (
                <span
                  data-testid="tier-badge"
                  /* P1：徽标只印一个字母（N / F / U），屏幕上没人知道 N 是什么。
                     补一句 title：字母的意思是「这张图被验到什么程度」。 */
                  title={
                    verdict.tier === 'F'
                      ? 'F 档 · 等效图也验过了：数值与等效电路两条路径互核一致，可以拿等效图讲'
                      : verdict.tier === 'N'
                        ? 'N 档 · 只验了数值：反力 / 内力 / 增益等算得过校验，但等效图还没法核（关键语义没标全或本题不给等效图）'
                        : 'U 档 · 还没验成：这张图当前按求解器判据不适用，请看下面的拒答理由与改法'
                  }
                  className={`max-w-[min(100%,22rem)] shrink-0 truncate rounded border px-2 py-0.5 text-[10px] ${
                    verdict.tier === 'F' ? 'border-ok/40 bg-ok/10 text-ok' : verdict.tier === 'N' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-danger/40 bg-danger/10 text-danger'
                  }`}
                >
                  {verdict.tier} · {verdict.headline}
                </span>
              ) : null}
              <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5">
                <button
                  type="button"
                  data-testid="undo-button"
                  onClick={() => step({ type: 'undo' })}
                  disabled={ui.undoStack.length === 0}
                  title="撤销 (Ctrl+Z)"
                  className="lab-chip focus-ring disabled:opacity-30"
                >
                  ↶
                </button>
                <button
                  type="button"
                  data-testid="redo-button"
                  onClick={() => step({ type: 'redo' })}
                  disabled={ui.redoStack.length === 0}
                  title="重做 (Ctrl+Shift+Z)"
                  className="lab-chip focus-ring disabled:opacity-30"
                >
                  ↷
                </button>
                {selectedIds.length >= 2 ? (
                  <button
                    type="button"
                    data-testid="wrap-button"
                    onClick={() => setWrapPanel('wrap')}
                    className="lab-chip focus-ring border-cyan/60 bg-cyan/15 text-cyan"
                  >
                    封装为复合器件（{selectedIds.length}）
                  </button>
                ) : null}
                {candidatesFor(pickId).length > 0 ? (
                  <div className="relative">
                    <button
                      type="button"
                      data-testid="candidates-button"
                      onClick={() => setCandidatesOpen((open) => !open)}
                      className="lab-chip focus-ring border-cyan/40 text-cyan"
                    >
                      {candidateHeading(pickId)}
                    </button>
                    {/* 全覆盖 F6：候选面板从通栏块改为按钮下方浮层 —— 快速换拓扑
                        不再把整个工作台推下一屏；收起方式不变（Esc / 收起按钮）。 */}
                    {candidatesOpen ? (
                      <div
                        ref={candidatesPanelRef}
                        className="absolute right-0 top-full z-40 mt-1 w-[min(900px,calc(100vw-2rem))]"
                        style={{ transform: `translateX(${candidatesShift}px)` }}
                      >
                        <CandidatePanel
                          templateId={pickId}
                          peeked={peeked}
                          onLoad={(candidate) => void loadCandidate(candidate)}
                          onPeek={peekCandidate}
                          onClose={() => setCandidatesOpen(false)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button type="button" data-testid="reset-skeleton" onClick={resetSkeleton} className={`lab-chip focus-ring ${resetArmed || loadedFromLink || ui.dirty ? 'border-amber/60 bg-amber/10 text-amber' : ''}`}>
                  {resetArmed ? '恢复骨架 · 待确认' : '恢复骨架'}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    data-testid="clear-canvas"
                    onClick={armClearCanvas}
                    disabled={canvasEmpty}
                    aria-expanded={clearArmed}
                    title={canvasEmpty ? '画布已经是空的' : '清掉全部图元，从零自己搭电路 / 模型（可撤销）'}
                    className={`lab-chip focus-ring disabled:opacity-30 ${clearArmed ? 'border-amber/60 bg-amber/10 text-amber' : ''}`}
                  >
                    清空画布
                  </button>
                  {/* 修复计划 T3.8：确认条改成贴着按钮的 popover（不再把整页工作台推下去），
                      弹出即聚焦「确认清空」，Esc 关闭走全局放料。 */}
                  {clearArmed ? (
                    <div
                      data-testid="clear-canvas-confirm"
                      role="alertdialog"
                      aria-label="确认清空画布"
                      className="absolute right-0 top-full z-40 mt-1 w-[min(420px,calc(100vw-2rem))] flex flex-wrap items-center gap-2 rounded-xl border border-amber/50 bg-panel px-3 py-2 text-[11px] leading-5 text-amber shadow-lg"
                    >
                      <span className="min-w-0 flex-1">清空会删掉画布上全部器件、导线、结点与标注（参数表与本题求解器保留）—— 确认吗？</span>
                      <button
                        type="button"
                        data-testid="clear-canvas-yes"
                        ref={clearYesRef}
                        onClick={confirmClearCanvas}
                        className="focus-ring rounded border border-amber/60 px-2 py-0.5 font-medium text-amber hover:bg-amber/20"
                      >
                        确认清空
                      </button>
                      <button
                        type="button"
                        data-testid="clear-canvas-no"
                        onClick={() => setClearArmed(false)}
                        className="focus-ring rounded border border-line px-2 py-0.5 text-muted hover:border-cyan/50"
                      >
                        取消
                      </button>
                    </div>
                  ) : null}
                </div>
                <button type="button" onClick={shareLink} className="lab-chip focus-ring">
                  复制链接
                </button>
                <div className="relative" ref={exportMenuRef}>
                  <button
                    type="button"
                    data-testid="export-toggle"
                    aria-expanded={exportOpen}
                    aria-label="导出图"
                    onClick={() => setExportOpen((open) => !open)}
                    className="lab-chip focus-ring"
                  >
                    导出图 ▾
                  </button>
                  {exportOpen ? (
                    <div
                      data-testid="export-menu"
                      className="pop-menu absolute right-0 top-full z-40 mt-1 w-52 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        data-testid="export-svg"
                        onMouseDown={(event) => { event.preventDefault(); void exportGraphImage('svg'); }}
                        className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
                      >
                        SVG（矢量）
                      </button>
                      <button
                        type="button"
                        data-testid="export-png"
                        onMouseDown={(event) => { event.preventDefault(); void exportGraphImage('png'); }}
                        className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
                      >
                        PNG（2×）
                      </button>
                      <p className="mt-0.5 whitespace-normal break-words border-t border-line px-2 pb-1 pt-1.5 text-[10px] leading-4 text-faint">白底深线，不受深色主题影响</p>
                    </div>
                  ) : null}
                </div>
                <UnitModeSelect testId="unit-mode-lab" label="装配台读数单位制" />
                {generic?.frame || zeroFromTemplate ? (
                  <>
                    <button
                      type="button"
                      data-testid="zero-member-toggle"
                      aria-pressed={showZeroMembers}
                      disabled={zeroInfo.ids.length === 0}
                      title={
                        zeroFromTemplate
                          ? `模板解按课本节点判据：${zeroInfo.reason}。模板的杆名与画布边 id 不是同一套，这里不假装能高亮；自建桁架走通用解时可一键高亮。`
                          : zeroInfo.noLoad
                            ? '本图没有可判定的荷载，零杆判据不适用'
                            : `按杆端轴力相对最大轴力判定，共 ${zeroInfo.total} 根杆`
                      }
                      onClick={() => setShowZeroMembers((on) => !on)}
                      className="lab-chip focus-ring disabled:opacity-40"
                    >
                      {zeroFromTemplate ? `零杆判据 · ${zeroInfo.total} 根` : showZeroMembers ? '隐藏零杆' : `零杆高亮 · ${zeroInfo.ids.length} 根`}
                    </button>
                    {zeroFromTemplate ? (
                      <span
                        data-testid="zero-member-note"
                        title={zeroInfo.reason}
                        className="max-w-[260px] truncate text-[10px] leading-4 text-faint"
                      >
                        {zeroInfo.reason}
                      </span>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid="favorite-toggle"
                  onClick={openFavorite}
                  title="把当前装配图存进收藏（装配台首页可一键载入）"
                  className="lab-chip focus-ring"
                >
                  ☆ 收藏
                </button>
                <Magnetic strength={0.18}>
                  <button
                    type="button"
                    data-testid="solve-button"
                    onClick={() => {
                      scrollAfterSolveRef.current = true;
                      void solve();
                    }}
                    disabled={!allConfirmed || refusal.length > 0}
                    title={
                      refusal.length > 0
                        ? '上一轮被拒：先把画布改到能算，再点一次'
                        : allConfirmed
                          ? '归约 → 既有 solver'
                          : '先把每个参数都确认一遍（默认值也要点一次）'
                    }
                    className="sheen focus-ring whitespace-nowrap rounded-[4px] bg-cyan px-3.5 py-1 font-semibold text-[11px] text-white disabled:opacity-40"
                  >
                    分步求解
                  </button>
                </Magnetic>
              </div>
            </div>

            {resetArmed ? (
              <div
                data-testid="reset-skeleton-confirm"
                role="alertdialog"
                aria-label="确认恢复骨架"
                className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber/50 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber"
              >
                <span>恢复骨架会丢掉全部改动（含删除即合并的拓扑修复与撤销历史）—— 确认吗？</span>
                <button
                  type="button"
                  data-testid="reset-skeleton-yes"
                  onClick={confirmResetSkeleton}
                  className="focus-ring rounded border border-amber/60 px-2 py-0.5 font-medium text-amber hover:bg-amber/20"
                >
                  确认恢复
                </button>
                <button
                  type="button"
                  data-testid="reset-skeleton-no"
                  onClick={() => setResetArmed(false)}
                  className="focus-ring rounded border border-line px-2 py-0.5 text-muted hover:border-cyan/50"
                >
                  取消
                </button>
              </div>
            ) : null}

            {favoriteOpen ? (
              <div
                data-testid="favorite-form"
                className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-cyan/40 bg-cyan/5 px-3 py-2 text-[11px] leading-5"
              >
                <span className="text-ink">给这张图起个名字：</span>
                <input
                  type="text"
                  data-testid="favorite-name"
                  aria-label="收藏名称"
                  value={favoriteName}
                  onChange={(event) => setFavoriteName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveFavorite();
                    if (event.key === 'Escape') setFavoriteOpen(false);
                  }}
                  className="w-56 rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-cyan/60"
                />
                <button
                  type="button"
                  data-testid="favorite-save"
                  onClick={saveFavorite}
                  className="focus-ring rounded border border-cyan/60 px-2 py-0.5 font-medium text-cyan hover:bg-cyan/15"
                >
                  保存
                </button>
                <button
                  type="button"
                  data-testid="favorite-cancel"
                  onClick={() => setFavoriteOpen(false)}
                  className="focus-ring rounded border border-line px-2 py-0.5 text-muted hover:border-cyan/50"
                >
                  取消
                </button>
              </div>
            ) : null}

            {slantedNote ? (
              <p
                data-testid="slanted-member-note"
                className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber"
              >
                {slantedNote}
              </p>
            ) : null}

            {isParametricSkeleton(pickId) ? (
              <p data-testid="parametric-note" className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber">
                M7 的快照主图是 λ–σcr 曲线（零图元）；这里的压杆构件是按题面「两端铰压杆」参数化生成的装配示意，
                <strong>不是快照原图</strong>。L / b / h / E / μ / P / σp 以右侧「确认已知量」为准。
              </p>
            ) : null}

            {candidatesOpen ? (
              <>
                {pendingLoadCandidate ? (
                  <div data-testid="load-candidate-confirm" className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber/50 bg-amber/10 px-3 py-2 text-[11px] text-amber">
                    <span>画布有未保存的改动 —— 载入「{pendingLoadCandidate.title}」会全部丢掉。</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = pendingLoadCandidate;
                        setPendingLoadCandidate(null);
                        void doLoadCandidate(next);
                      }}
                      className="focus-ring rounded border border-amber/60 px-1.5 py-0.5 hover:bg-amber/20"
                    >
                      仍要载入
                    </button>
                    <button type="button" onClick={() => setPendingLoadCandidate(null)} className="focus-ring rounded border border-line px-1.5 py-0.5 text-muted">
                      取消
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {wrapPanel ? (
              <WrapPanel
                mode={wrapPanel === 'wrap' ? 'wrap' : { edit: wrapPanel.edit }}
                graph={graph}
                nodeIds={wrapPanel === 'wrap' ? selectedIds : [wrapPanel.edit]}
                onValidate={validateWrapOp}
                onSubmit={(op) => {
                  step({ type: 'op', op });
                  setWrapPanel(null);
                  setSelectedIds([]);
                }}
                onClose={() => setWrapPanel(null)}
              />
            ) : null}

            {verdict ? (
              <div
                className={`mb-3 rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                  verdict.tier === 'F' ? 'border-ok/40 bg-ok/10 text-ok' : verdict.tier === 'N' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-danger/40 bg-danger/10 text-danger'
                }`}
              >
                <p>{verdict.detail}</p>
                {/* 全覆盖 F4：N 档下一步别让用户找 —— 横幅里直接给「标全语义并升 F 档」。
                    条件：N 档 + 关键语义确实没标全（点一下等于归约预览里那个「按拓扑标全」）。 */}
                {verdict.tier === 'N' && critical.length > 0 && preview && preview.semantic.missing.length > 0 ? (
                  <button
                    type="button"
                    data-testid="banner-mark-all-semantics"
                    onClick={() => {
                      markAllSemantics();
                      // 标完立即重解：走 recomputeArmed 通道 —— solve 的闭包要等
                      // ui 更新后才是新的（直接调用拿到的是标注前的归约，档位不动）。
                      if (stage === 'solved') recomputeArmed.current = true;
                    }}
                    className="focus-ring mt-1.5 rounded border border-current px-2 py-0.5 text-[10px]"
                  >
                    标全语义并升 F 档（还缺 {preview.semantic.missing.length} 项）
                  </button>
                ) : null}
                {verdict.substitute ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {verdict.substitute.map((sub) =>
                      sub.hash ? (
                        <a key={sub.label} href={sub.hash} className="focus-ring rounded border border-current px-2 py-0.5 text-[10px]">
                          {sub.label}
                        </a>
                      ) : (
                        <button key={sub.label} type="button" onClick={resetSkeleton} className="focus-ring rounded border border-current px-2 py-0.5 text-[10px]">
                          {sub.label}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* W22-A P0-1：拒答只出横条，绝不替换编辑器主体 ——
                「先没放结点」是自建结构最常见的中间态，之前一拒就把三栏整块吞掉，等于把人赶出工作区。 */}
            {stage === 'refused' || refusal.length > 0 ? (
              <div
                data-testid="refusal-banner"
                role="status"
                className="mb-3 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2"
              >
                <p className="text-[11px] leading-5 text-danger">
                  本题不适用，不求解{stage === 'refused' ? '（画布还在，接着改就行）' : ''}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-ink">
                  {refusal.map((problem: string) => (
                    <li key={problem}>· {problem}</li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-testid="refusal-dismiss"
                    onClick={() => {
                      setRefusal([]);
                      setStage('editing');
                    }}
                    className="focus-ring rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink hover:border-cyan/50"
                  >
                    知道了，继续编辑
                  </button>
                  <a href="#/scope" className="focus-ring rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:border-cyan/50">
                    去范围判别走一遍
                  </a>
                  <button type="button" onClick={resetSkeleton} className="focus-ring rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:border-cyan/50">
                    恢复骨架
                  </button>
                </div>
              </div>
            ) : null}
            {/* C1：三栏断点 1280 → 1100 —— 1600@125%（CSS 1252）/ 1440@100% 这类常见
                笔记本宽度以前塌成单栏，装配动线（左栏 / 画布 / 参数）看不全。
                316+320+画布最小 420 ≈ 1080 就够，1100 起三栏刚好不挤。 */}
            <Spotlight className="grid gap-3 min-[1100px]:grid-cols-[316px_minmax(0,1fr)_320px] min-[1100px]:items-start">
                {/* 左：装配操作（N-04：min-w-0 + overflow-x-hidden，消灭底部横向滚动条） */}
                <section data-testid="col-left" className={`${CARD} min-w-0 max-w-[560px] max-h-[70vh] overflow-x-hidden overflow-y-auto p-3 min-[1100px]:max-w-none`}>
                  <div className="flex items-center gap-2 pb-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-cyan" />
                    <h2 className="shrink-0 text-[11.5px] font-medium tracking-[0.01em] text-ink">装配（白名单内）</h2>
                    <span className="draft-rule flex-1" />
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    {isBeam
                      ? // W21-C C1-2：力学页只讲力学手势，不再插电路的「引脚连线」。
                        '点节点选物件、拖节点改布局（pointerup 才重算）；「加构件」模式下按两次节点连一根构件；双击自动整理，Esc 取消拖动。'
                      : '点引脚两次连线；拖节点改布局（pointerup 才重算导线）；双击自动整理，Esc 取消拖动。'}
                  </p>

                  <h3 className="mt-3 text-[11px] text-muted">{isBeam ? '物件（点行或点画布节点 → 选中条）' : '器件（点行选中，Delete 删）'}</h3>
                  {pendingDelete ? (
                    <div data-testid="delete-confirm" className="mb-2 flex items-center gap-2 rounded-lg border border-amber/50 bg-amber/10 px-2 py-1.5 text-[10px] leading-4 text-amber">
                      <span>
                        {(() => {
                          const victim = graph.nodes.find((node) => node.id === pendingDelete);
                          if (isBeam && victim && (victim.kind === 'dot' || victim.kind === 'pin')) {
                            const attached = graph.edges.filter((edge) => edge.from === pendingDelete || edge.to === pendingDelete);
                            const name = (victim.label ?? '').trim() || pendingDelete.replace(/^n-/, '').toUpperCase();
                            // R3-1 A1/H-06：支座是结点属性 → 必然一起消失；载荷共点 / 挂靠 → 一并删。
                            const supportText = victim.support ? `、支座（${SUPPORT_KIND_LABEL[`${victim.support.type}Support`]}）` : '';
                            const loads = graph.nodes.filter(
                              (node) =>
                                ['arrow', 'udl', 'momentArrow', 'torqueArrow'].includes(node.kind) &&
                                (node.atJoint === pendingDelete || Math.hypot(node.x - victim.x, node.y - victim.y) <= 0.6),
                            );
                            const loadText = loads.length > 0 ? `、${loads.length} 个载荷` : '';
                            return attached.length > 0 || supportText || loadText
                              ? `删节点 ${name} 会连带删掉 ${attached.map((edge) => memberLabel(edge.id)).join('、')}${attached.length > 0 ? ` ${attached.length} 个构件` : ''}${supportText}${loadText} —— 确认要删吗？`
                              : `删节点 ${name}（没有构件挂在上面）—— 确认要删吗？`;
                          }
                          return `删掉「${graph.nodes.find((node) => node.id === pendingDelete)?.label ?? pendingDelete}」后归约会失败（有下游影响）—— 确认要删吗？`;
                        })()}
                      </span>
                      <button type="button" data-testid="delete-confirm-yes" onClick={confirmDelete} className="focus-ring rounded border border-amber/60 px-1.5 py-0.5 text-amber hover:bg-amber/20">
                        确认删除
                      </button>
                      <button type="button" onClick={() => setPendingDelete(null)} className="focus-ring rounded border border-line px-1.5 py-0.5 text-muted hover:border-cyan/50">
                        取消
                      </button>
                    </div>
                  ) : null}
                  <ul key={resetKey} className="mt-1 space-y-1">
                    {/* 黑盒 #37：清空后别只留一个光秃秃的表头。 */}
                    {(isBeam ? objectRows.length === 0 : objectNodes.length === 0) ? (
                      <li data-testid="object-list-empty" className="rounded border border-dashed border-line px-2 py-2 text-[10px] leading-4 text-faint">
                        画布上还没有{isBeam ? '物件' : '器件'} —— 用下面「放置器」先落一个结点，或点顶部「恢复骨架」。
                      </li>
                    ) : null}
                    {isBeam
                      ? objectRows.map((row) => {
                          const owner = row.parentId ?? row.id;
                          const node = graph.nodes.find((one) => one.id === owner);
                          if (!node) return null;
                          const active = selectedObject === owner;
                          return (
                            <li
                              key={row.id}
                              id={row.parentId ? undefined : `dev-row-${row.id}`}
                              data-testid="device-row"
                              data-support-row={row.parentId ? '1' : undefined}
                              data-node={owner}
                              tabIndex={-1}
                              className={`grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1 rounded text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-cyan/60 ${row.parentId ? 'pl-4' : ''}`}
                            >
                              <span className="id-mono shrink-0 whitespace-nowrap text-muted">{row.parentId ? '└' : row.id}</span>
                              <button
                                type="button"
                                onClick={() => selectObject(active ? null : owner)}
                                className={`min-w-[88px] truncate text-left text-ink hover:text-cyan ${active ? 'text-cyan' : ''}`}
                                title={row.parentId ? '支座是结点属性：选中即选中它挂的那个结点' : '选中这一行'}
                              >
                                {row.name}
                              </button>
                              <span className="shrink-0 text-muted">{row.kindLabel}</span>
                              {row.parentId ? (
                                <span className="ml-auto shrink-0 text-[10px] text-muted" title="支座的坐标就是结点坐标：拖结点它跟着走，删结点它一起消失">
                                  结点属性
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  data-testid="delete-device"
                                  onClick={() => requestDeleteDevice(row.id)}
                                  className="ml-auto shrink-0 rounded border border-line px-1 text-[10px] text-danger hover:border-danger/60"
                                  title="删除（快捷键 Delete）"
                                  aria-label={`删除构件 ${row.name}`}
                                >
                                  删
                                </button>
                              )}
                            </li>
                          );
                        })
                      : null}
                    {!isBeam
                      ? objectNodes.map((device) => (
                      <li
                        key={device.id}
                        id={`dev-row-${device.id}`}
                        data-testid="device-row"
                        data-node={device.id}
                        tabIndex={-1}
                        title={device.kind === 'cap' ? '电容：交流短路 / 直流开路' : undefined}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-cyan/60"
                      >
                        <span className="id-mono shrink-0 whitespace-nowrap text-muted">{device.id}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (isBeam) {
                              selectObject(selectedObject === device.id ? null : device.id);
                            } else {
                              setSelectedWire(null);
                              setSelectedMember(null);
                              setSelectedObject(null);
                              setSelectedIds([device.id]);
                            }
                          }}
                          className={`min-w-[88px] truncate text-left text-ink hover:text-cyan ${(isBeam ? selectedObject === device.id : selectedIds.includes(device.id)) ? 'text-cyan' : ''}`}
                          title="选中这一行"
                        >
                          {objectNameOf(device)}
                        </button>
                        {/* W22-C F8：名字按钮之后的控件收进一个 auto 列，名字列 minmax(0,1fr)+min-w 永不压成 0 宽 */}
                        <div className="flex min-w-0 items-center gap-1">
                        {!isBeam && UNIT_OF[device.kind] && !device.compositeId ? (
                          <ValueInput
                            kind={device.kind}
                            value={device.value}
                            onCommit={(value) => mutate({ op: 'setDeviceValue', nodeId: device.id, value })}
                          />
                        ) : null}
                        {!isBeam && !['text', 'dot', 'gnd', 'block'].includes(device.kind) && !device.compositeId ? (
                          <button
                            type="button"
                            data-testid="rotate-device"
                            data-node={device.id}
                            onClick={() => mutate({ op: 'rotateDevice', nodeId: device.id, delta: 90 })}
                            className="shrink-0 rounded border border-line px-1 text-[10px] text-muted hover:border-cyan/60"
                            title="旋转 90°（R）"
                            aria-label={`旋转器件 ${device.label ?? device.id} 90°`}
                          >
                            ⟳
                          </button>
                        ) : null}
                        {/* W21-B B4：角色标签默认收起，选中这个器件才展开；「unknown 未标」不再占屏。 */}
                        {!isBeam && !['text', 'dot'].includes(device.kind) && selectedIds.includes(device.id) ? (
                          <div data-testid="role-chips" className="ml-auto flex shrink-0 items-center gap-1">
                            <span className="text-[10px] text-muted">角色</span>
                            <select
                              data-testid="semantic-select"
                              data-node={device.id}
                              value={device.semantic ?? 'unknown'}
                              onChange={(event) => mutate({ op: 'setSemantic', nodeId: device.id, semantic: event.target.value })}
                              className="w-[92px] rounded border border-line bg-bg px-1 text-[10px]"
                              title="语义标签"
                            >
                              <option value="unknown" disabled>选择角色</option>
                              {SEMANTIC_OPTIONS.filter((option) => option.value !== 'unknown').map((option) => (
                                <option key={option.value} value={option.value}>
                                  {SEMANTIC_LABEL[option.value]}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {/* W24 ㉟⑦：选中器件时把「模型参数」（gm / ro / β / VA…）摊在行内 ——
                            这些数不在参数表里，缺了就拒答；填完立刻重解。 */}
                        {!isBeam && selectedIds.includes(device.id) && deviceParamFields(device).length > 0 ? (
                          <div data-testid="device-param-row" className="ml-auto flex shrink-0 items-center gap-1">
                            {deviceParamFields(device).map((field) => (
                              <span key={field.key} className="flex items-center gap-0.5" title={field.hint}>
                                <span className="text-[10px] text-faint">{field.key}</span>
                                {deviceParamValue(device, field) !== undefined ? (
                                  <span className="flex items-center gap-0.5">
                                    <span className="text-[10px] text-muted">{deviceParamValue(device, field)}</span>
                                    {givenDefaults.has(`${device.id}:${field.key}`) ? (
                                      <span
                                        data-testid="device-param-default"
                                        className="rounded bg-amber/15 px-1 text-[9px] text-amber"
                                        title="这只是参考量级，不是题面值 —— 题面给了就改"
                                      >
                                        参考
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <ModelParamInput
                                    field={field}
                                    onCommit={(field, value) => {
                                      applyMissingParams(device.id, field, value);
                                      if (stage === 'solved') recomputeArmed.current = true;
                                    }}
                                  />
                                )}
                              </span>
                            ))}
                          </div>
                        ) : null}                        {!isBeam && CIRCUIT_KINDS.includes(device.kind) ? (
                          <select
                            data-testid="kind-select"
                            value={device.kind}
                            onChange={(event) => mutate({ op: 'changeKind', nodeId: device.id, kind: event.target.value })}
                            className="w-[62px] shrink-0 rounded border border-line bg-bg px-1 text-[10px]"
                            title="改器件种类（保留数值，丢不兼容参数）"
                          >
                            {CIRCUIT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {KIND_LABEL[kind]}
                              </option>
                            ))}
                          </select>
                        ) : !isBeam && !['text', 'dot'].includes(device.kind) ? (
                          <span
                            data-testid="kind-readonly"
                            className="w-[62px] shrink-0 rounded border border-line/60 px-1 text-center text-[10px] text-muted"
                            title="这个器件不在可改种类列表里"
                          >
                            {device.kind.toUpperCase()}
                          </span>
                        ) : null}
                        {device.compositeId ? (
                          <span className="ml-auto flex shrink-0 items-center gap-1">                            <button
                              type="button"
                              data-testid="composite-expand"
                              onClick={() => mutate({ op: 'expandComposite', nodeId: device.id })}
                              className="rounded border border-line px-1 text-[10px] text-muted hover:border-cyan/60"
                              title="摊开成内层器件（可再收拢）"
                            >
                              摊开
                            </button>
                            <button
                              type="button"
                              data-testid="composite-ungroup"
                              onClick={() => mutate({ op: 'ungroupComposite', nodeId: device.id })}
                              className="rounded border border-line px-1 text-[10px] text-muted hover:border-cyan/60"
                              title="永久拆开实例（定义保留在组件定义区）"
                            >
                              拆开
                            </button>
                            <button
                              type="button"
                              data-testid="composite-edit"
                              onClick={() => setWrapPanel({ edit: device.id })}
                              className="rounded border border-line px-1 text-[10px] text-muted hover:border-cyan/60"
                              title="编辑端口与模型声明"
                            >
                              编辑端口
                            </button>
                          </span>
                        ) : device.id.startsWith('cmp/') ? (
                          <button
                            type="button"
                            data-testid="composite-collapse"
                            onClick={() => mutate({ op: 'collapseComposite', nodeId: device.id })}
                            className="ml-auto shrink-0 rounded border border-line px-1 text-[10px] text-muted hover:border-cyan/60"
                            title="把同一模块的内层器件收回复合块"
                          >
                            收拢
                          </button>
                        ) : null}
                        {/* R3-1 A1：支座不再是图元 —— 电路组这里只会是器件，删就完事 */}
                        <button
                          type="button"
                          data-testid="delete-device"
                          onClick={() => requestDeleteDevice(device.id)}
                          className="ml-auto shrink-0 rounded border border-line px-1 text-[10px] text-danger hover:border-danger/60"
                          title="删除（快捷键 Delete）"
                          aria-label={`删除器件 ${device.label ?? device.id}`}
                        >
                          删
                        </button>
                        </div>
                      </li>
                    ))
                      : null}
                    {/* W17-C 变异形态：INSPECT_CONFIG.membersSeparate=false → 构件行混回物件组 */}
                    {isBeam && !INSPECT_CONFIG.membersSeparate ? memberRowList : null}
                  </ul>

                  {/* 力学：杆组（单一来源 memberRowList；变异开关可把杆挪回物件组） */}
                  {isBeam && INSPECT_CONFIG.membersSeparate ? (
                    <>
                      <h3 className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                        构件（点行或点画布构件线 → 选中条）
                        <button
                          type="button"
                          data-testid="link-mode"
                          onClick={() => {
                            const entering = !linkMode;
                            setLinkMode(entering);
                            if (entering) {
                              // W22-A P0-2：模式互斥 —— 放置器和「加构件」都抢画布左键，
                              // 同时 armed 时点两下只会放出两个结点，构件静默不生成。进一边就关另一边。
                              setPlaceTool('off');
                              setPlaceGhost(null);
                              setPlaceAlt(0);
                              setSelectedMember(null);
                              setSelectedObject(null);
                            } else if (ui.wire.first) {
                              onWireClick({ kind: 'blank' });
                            }
                          }}
                          className={`focus-ring rounded border px-1.5 py-0.5 text-[10px] ${linkMode ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line text-muted hover:border-cyan/50'}`}
                          title="打开后按两次节点加一根构件（力学两次点击的既有手势）"
                        >
                          {linkMode ? '加构件中…（再点取消）' : '加构件'}
                        </button>
                      </h3>
                      <ul key={resetKey} className="mt-1 space-y-1">{memberRowList.length > 0 ? memberRowList : (
                        <li data-testid="member-list-empty" className="rounded border border-dashed border-line px-2 py-2 text-[10px] leading-4 text-faint">
                          还没有构件 —— 点「加构件」再按两个结点连成一根。
                        </li>
                      )}</ul>
                    </>
                  ) : !isBeam ? (
                    /* W16 电路：导线列表逐条可删（与画布点线 / Delete 同一条 deleteEdge 路） */
                    <>
                      <h3 className="mt-3 text-[11px] text-muted">导线（画布上点线或点行 → 删 / Delete）</h3>
                      <ul className="mt-1 max-h-[120px] space-y-1 overflow-y-auto">
                        {graph.edges.map((edge) => (
                          <li
                            key={edge.id}
                            data-testid="wire-row"
                            data-edge={edge.id}
                            className={`flex items-center gap-1 text-[11px] ${selectedWire === edge.id ? 'rounded bg-cyan/10 text-cyan' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => selectWire(selectedWire === edge.id ? null : edge.id)}
                              className="id-mono shrink-0 text-cyan hover:underline"
                              title="选中这条导线"
                            >
                              {edge.id}
                            </button>
                            <span className="text-muted">{edge.kind === 'wire' ? '导线' : edge.kind}</span>
                            <button
                              type="button"
                              data-testid="delete-wire"
                              onClick={() => deleteWire(edge.id)}
                              className="ml-auto shrink-0 rounded border border-line px-1 text-[10px] text-danger hover:border-danger/60"
                              aria-label={`删除导线 ${edge.id}`}
                            >
                              删
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {/* R3-4 U1：放置器 —— 先选一个，再在图上指一下；不用「先选东西再点按钮」。
                      P1：轴向拉压 / 扭转的放置器只留「结点」—— 上面那条 element-note 刚说完
                      「这里不给你支座和横向载荷」，下面还挂着「集中力 / 均布 / 支座」就自相矛盾。 */}
                  {isBeam ? (
                    <>
                      <h3 className="mt-3 text-[11px] text-muted">放置器（选一个，再在图上指）</h3>
                      <div data-testid="place-tools" className="mt-1 flex flex-wrap gap-1">
                        {PLACE_TOOLS.filter((item) => item.tool !== 'off' && (!axialElement && !shaftElement || item.tool === 'node')).map((item) => (
                          <button
                            key={item.tool}
                            type="button"
                            data-testid={`place-tool-${item.tool}`}
                            aria-pressed={placeTool === item.tool}
                            title={item.hint}
                            onClick={() => {
                              const next = placeTool === item.tool ? 'off' : item.tool;
                              setPlaceTool(next);
                              setPlaceGhost(null);
                              setPlaceAlt(0);
                              // W22-A P0-2：与「加构件」互斥 —— 选放置器就退出加构件模式，
                              // 否则两个 armed 状态都不报错，画布左键按谁处理全凭事件顺序。
                              if (next !== 'off' && linkMode) {
                                setLinkMode(false);
                                if (ui.wire.first) onWireClick({ kind: 'blank' });
                              }
                            }}
                            className={`focus-ring rounded border px-2 py-0.5 text-[10px] ${
                              placeTool === item.tool
                                ? 'border-cyan bg-cyan/15 text-cyan'
                                : 'border-line text-ink hover:border-cyan/50'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          data-testid="place-tool-off"
                          aria-pressed={placeTool === 'off'}
                          onClick={() => {
                            setPlaceTool('off');
                            setPlaceGhost(null);
                          }}
                          className={`focus-ring rounded border px-2 py-0.5 text-[10px] ${
                            placeTool === 'off' ? 'border-cyan bg-cyan/15 text-cyan' : 'border-line text-muted hover:border-cyan/50'
                          }`}
                        >
                          选中 / 拖动
                        </button>
                      </div>
                      {placeTool !== 'off' ? (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
                          {/* 黑盒 #38：只有「集中力 / 均布」要填数值；结点 / 支座工具跟 P 无关。 */}
                          {placeTool === 'point' || placeTool === 'udl' ? (
                            <label className="flex items-center gap-1">
                              {placeTool === 'udl' ? 'q' : 'P'}
                              <input
                                type="number"
                                data-testid="place-value"
                                value={placeValue}
                                onChange={(event) => setPlaceValue(Number(event.target.value) || 0)}
                                className="w-14 rounded border border-line bg-bg px-1 text-right text-[10px] text-ink"
                              />
                              {placeTool === 'udl' ? 'kN/m' : 'kN'}
                            </label>
                          ) : null}
                          <span data-testid="place-mode-hint" className="min-w-0 flex-1 leading-4">
                            {PLACE_TOOLS.find((one) => one.tool === placeTool)?.hint}　Esc 退出
                          </span>
                        </div>
                      ) : null}
                      {placeTool === 'point' && isBeam && !axialElement && !shaftElement ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted" data-testid="place-dir">
                          落点方向
                          {LOAD_DIRECTIONS.map((dir) => (
                            <button
                              key={dir}
                              type="button"
                              data-testid={`place-dir-${dir}`}
                              aria-pressed={loadDir === dir}
                              onClick={() => setLoadDir(dir)}
                              title={`单击落点用 ${LOAD_DIR_LABEL[dir]}（${dir}°）`}
                              className={`focus-ring rounded border px-1.5 ${loadDir === dir ? 'border-cyan/60 bg-cyan/10 text-cyan' : 'border-line text-ink hover:border-cyan/50'}`}
                            >
                              {LOAD_DIR_LABEL[dir]}
                            </button>
                          ))}
                          <span className="ml-1 leading-4">单击 = 这个方向；按住往受力方向拖一下 = 按拖动方向</span>
                        </div>
                      ) : null}
                      {placeTool !== 'off' ? null : (
                        <p data-testid="place-mode-hint" className="mt-1 text-[10px] leading-4 text-muted">
                          现在点画布 = 选中 / 拖动。选一个放置器，点一下就把条件落到图上（不必先选中再点按钮）。
                        </p>
                      )}
                    </>
                  ) : null}

                  <h3 className="mt-3 text-[11px] text-muted">加入器件</h3>
                  {axialElement ? (
                    <p data-testid="element-note" className="mt-1 text-[10px] leading-4 text-muted">
                      轴向拉压：载荷沿杆轴（→ 拉 / ← 压），轴力 N(x) 全跨恒定。图上的铰支座 / 滚支座只用来把轴向反力画出来，不是梁的支承 —— 所以这里不给你「+ 支座」和横向载荷。
                    </p>
                  ) : null}
                  {isBeam ? (
                    // R3-1 A2：目标 = 当前选中的结点；没选就 disabled 并说明原因（不替你猜是哪个点）。
                    <p data-testid="add-target-hint" className="mt-1 text-[10px] leading-4 text-muted">
                      {addTarget.nodeId
                        ? `将加在结点 ${graph?.nodes.find((node) => node.id === addTarget.nodeId)?.label?.trim() || addTarget.nodeId.replace(/^n-/, '').toUpperCase()} 上（改选中结点即换目标）。`
                        : addTarget.reason}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!isBeam
                      ? /* P1：按题型给器件 —— A6 运放页原来也摆着「+ Q2 / + M2」晶体管，
                          点了只会被 circuitReject 拒。归约表里本来就有 whitelist，直接用它裁。 */
                        CIRCUIT_ADDS.filter(
                          (item) => !circuitWhitelist || circuitWhitelist.includes(item.kind),
                        ).map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            data-testid="device-add"
                            data-kind={item.kind}
                            title={item.note}
                            onClick={() => mutate({ op: 'addDevice', kind: item.kind, label: item.label, value: item.value, params: item.params, x: 120 + (graph.nodes.length % 5) * 110, y: 560 })}
                            className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50"
                          >
                            + {item.label}
                          </button>
                        ))
                      : axialElement || shaftElement ? (
                        /* P0-1：轴向杆 / 圆轴不摆梁的「支座 + 横向载荷」。
                           支座在这里只是把轴向反力画出来的载体（M1 要求恰好 铰+滚、M2 要求恰好一个固定端），
                           多摆一个反而会让题被拒；横向集中力 / 均布 / 力偶对杆轴题也没有意义。 */
                        <div className="flex flex-wrap items-center gap-1" data-testid="element-adds" data-element={mechElement}>
                          {axialElement
                            ? ([
                                { label: '轴向拉力 P →', dir: 90 },
                                { label: '轴向压力 P ←', dir: 270 },
                              ] as const).map((item) => (
                                <button
                                  key={item.dir}
                                  type="button"
                                  data-testid={`add-load-axial-${item.dir}`}
                                  disabled={!addTarget.nodeId}
                                  title={addTarget.nodeId ? `在选中的结点上加${item.label}（沿杆轴，进轴力 N(x)）` : addTarget.reason}
                                  onClick={() => addTarget.nodeId && mutate({ op: 'addLoad', atNodeId: addTarget.nodeId, type: 'point', value: 10, dir: item.dir })}
                                  className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                                >
                                  + {item.label}
                                </button>
                              ))
                            : null}
                          {shaftElement ? (
                            /* P1：扭转页原来一个按钮都没有（面板像坏了）。扭矩箭头是引擎
                               早就能 stamp 的载荷（LOAD_KIND_OF.torqueArrow = 'torque'），
                               归约表的 T 现在也认它 —— 所以这里给两个方向的真按钮。 */
                            ([
                              { label: '扭矩 T ↻（右手螺旋 +x）', dir: 90 },
                              { label: '扭矩 T ↺（反向）', dir: 270 },
                            ] as const).map((item) => (
                              <button
                                key={item.dir}
                                type="button"
                                data-testid={`add-load-torque-${item.dir}`}
                                disabled={!addTarget.nodeId}
                                title={addTarget.nodeId ? `在选中的结点上加${item.label}，进扭矩图 T(x)` : addTarget.reason}
                                onClick={() => addTarget.nodeId && mutate({ op: 'addLoad', atNodeId: addTarget.nodeId, type: 'torque', value: 1, dir: item.dir })}
                                className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                              >
                                + {item.label}
                              </button>
                            ))
                          ) : null}
                          {shaftElement ? (
                            <span data-testid="element-adds-note" className="text-[10px] leading-4 text-muted">
                              圆轴扭转：载荷是扭矩 T（右栏参数表也能直接改值）；加第二个扭矩会按叠加算总扭矩，横向载荷对扭转题没有意义。
                            </span>
                          ) : null}
                        </div>
                      ) : BEAM_SUPPORTS.map((item) => (
                          <button
                            key={item.type}
                            type="button"
                            data-testid={`add-support-${item.type}`}
                            disabled={!addTarget.nodeId}
                            title={addTarget.nodeId ? `在选中的结点上加${SUPPORT_KIND_LABEL[`${item.type}Support`]}` : addTarget.reason}
                            onClick={() => addTarget.nodeId && mutate({ op: 'addSupport', atNodeId: addTarget.nodeId, type: item.type })}
                            className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                          >
                            + {SUPPORT_KIND_LABEL[`${item.type}Support`]}
                          </button>
                        ))}
                    {isBeam && !axialElement && !shaftElement
                      ? BEAM_LOADS.map((item) => {
                          // 选中杆 = 跨内载荷（默认 t=0.5，可在选中条里改）；选中结点 = 结点载荷。
                          const span = graph ? mainSpanOf(graph) : null;
                          const onMember = Boolean(selectedMember && span && span.id === selectedMember) && item.type !== 'moment';
                          const ready = onMember || Boolean(addTarget.nodeId);
                          const where = onMember ? '跨内 t=0.50' : addTarget.nodeId ? '选中结点' : '';
                          return (
                            <button
                              key={item.type}
                              type="button"
                              data-testid={`add-load-${item.type}`}
                              disabled={!ready}
                              title={ready ? `在${where}加${item.label}${item.type === 'point' ? `（方向 ${LOAD_DIR_LABEL[loadDir]}）` : ''}` : addTarget.reason}
                              onClick={() => {
                                if (onMember && span) {
                                  mutate({ op: 'addLoad', atMember: { edgeId: span.id, t: 0.5 }, type: item.type, value: item.value, dir: loadDir });
                                  return;
                                }
                                if (addTarget.nodeId) mutate({ op: 'addLoad', atNodeId: addTarget.nodeId, type: item.type, value: item.value, dir: loadDir });
                              }}
                              className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
                            >
                              + {item.label}
                              {item.type === 'point' ? <span className="ml-0.5 text-cyan">{LOAD_DIR_LABEL[loadDir]}</span> : null}
                            </button>
                          );
                        })
                      : null}
                  </div>
                  {isBeam && !axialElement && !shaftElement ? (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted" data-testid="load-dir">
                      方向
                      {LOAD_DIRECTIONS.map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          data-testid={`load-dir-${dir}`}
                          onClick={() => setLoadDir(dir)}
                          title={`新集中力方向 ${dir}°（放置器单击也用它）`}
                          className={`focus-ring rounded border px-1.5 ${loadDir === dir ? 'border-cyan/60 bg-cyan/10 text-cyan' : 'border-line text-ink hover:border-cyan/50'}`}
                        >
                          {LOAD_DIR_LABEL[dir]}
                        </button>
                      ))}
                      <span className="ml-1">选中构件 → 载荷落跨内 t=0.50；放置器里单击就用这个方向，拖一下则按拖动方向</span>
                    </div>
                  ) : null}

                  {/* H-04：自定义模块是电学器件，力学页一个都不许出现（与上面「加入器件」同一条分流） */}
                  {!isBeam ? (
                    <>
                  <h3 className="mt-3 text-[11px] text-muted">自定义模块</h3>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.values(BUILTIN_COMPOSITES).map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        data-testid="composite-add"
                        title={def.note}
                        onClick={() => mutate({ op: 'addDevice', kind: 'block', label: def.title, compositeId: def.id, x: 120 + (graph.nodes.length % 5) * 110, y: 560 })}
                        className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:border-cyan/50"
                      >
                        + {def.title}（内置）
                      </button>
                    ))}
                    {customModules.map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        data-testid="composite-add"
                        title={def.note}
                        onClick={() => mutate({ op: 'addDevice', kind: 'block', label: def.title, compositeId: def.id, x: 120 + (graph.nodes.length % 5) * 110, y: 560 })}
                        className="focus-ring rounded border border-cyan/40 px-2 py-0.5 text-[10px] text-cyan hover:border-cyan"
                      >
                        + {def.title}（自定义）
                      </button>
                    ))}
                  </div>
                    </>
                  ) : null}

                  <h3 className="mt-3 text-[11px] text-muted">{isBeam ? '两次点击：加构件' : '两次点击：连线'}</h3>
                  <TwoClickHelper
                    beam={isBeam}
                    anchors={clickableAnchors(graph).map((anchor) => {
                      const owner = graph.nodes.find((node) => node.id === anchor.key.split(':')[0]);
                      return {
                        key: anchor.key,
                        text: anchorOptionText(graph, pickId, anchor.key),
                        device: owner ? deviceName(owner) : '结点',
                      };
                    })}
                    edges={graph.edges}
                    onWire={(from, to) => mutate({ op: 'addEdge', from, to })}
                    onMember={(from, to) =>
                      // 修复计划 T3.10：梁族手搭默认按「梁」建构件（弯矩才有得算），
                      // 桁架题（S5）保持桁架杆；电路连线走 addEdge 不经过这里。
                      mutate({ op: 'addMember', from, to, kind: pickId === 'S5' ? 'truss' : isBeam ? 'beam' : 'frame' })
                    }
                  />
                </section>

                {/* 中：画布 */}
                <section data-testid="col-canvas" className={`${CARD} edge relative p-3`}>
                  <div className="flex items-center gap-2 pb-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-cyan" />
                    <h2 className="shrink-0 text-[11.5px] font-medium tracking-[0.01em] text-ink">画布（骨架 + 装配结果）</h2>
                    <span className="draft-rule flex-1" />
                  </div>
                  {/* ㉜③：清空之后画布上什么都没有了 —— 直接给一眼能照做的下一步。 */}
                  {canvasEmpty ? (
                    <p
                      data-testid="empty-canvas-hint"
                      className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-dashed border-line bg-panel/90 px-3 py-2 text-center text-[11px] leading-5 text-muted"
                    >
                      {/* 修复计划 T3.5：空态提示按题型白名单点名器件（A3 是 +Vs / +R / +D / +接地，
                          不是写死的 +R / +V / +C / +接地 —— 页面上根本没有 +V / +C 可点）。 */}
                      {isBeam
                        ? '画布已空 · 左侧「结点」放两个端点 →「加构件」连成跨 → 加支座 →「集中力」点在跨内'
                        : `画布已空 · 左侧「加入器件」开始自建（${circuitAddHint}）`}
                      <br />
                      想回原题图点顶部「恢复骨架」。
                    </p>
                  ) : null}
                  <SpecGrid
                    key={resetKey}
                    specs={[graphToSpec(graph, specType)]}
                    stepIndex={-1}
                    editable
                    canvas={{
                      family: PICKS[pickId]?.family ?? 'beam',
                      /** R-39 ②：零杆高亮（模板解没有可高亮的边 id，按钮本身就是禁用的）。 */
                      highlightWires: showZeroMembers ? zeroInfo.ids : undefined,
                      pins: clickableAnchors(graph).map((anchor) => ({
                        key: anchor.key,
                        x: anchor.x,
                        y: anchor.y,
                        label: anchorDisplay(graph, anchor).text,
                      })),
                      labels: graph.nodes
                        .filter((node) => node.kind === 'text')
                        .map((node) => ({ id: node.id, x: node.x, y: node.y })),
                      statusText: [
                        selectionText(graph, ui.wire.first, lastLink),
                        selectedIds.length > 0 ? `已选 ${selectedIds.length} 个（Shift+点击加选，≥2 可封装）` : '',
                      ]
                        .filter(Boolean)
                        .join('　'),
                      nodes: graph.nodes
                        .filter((node) => node.kind !== 'text')
                        .map((node) => ({
                          id: node.id,
                          x: node.x,
                          y: node.y,
                          composite: Boolean(node.compositeId),
                          selected: selectedIds.includes(node.id),
                        })),
                      wireFirst: ui.wire.first,
                      onWireClick,
                      onNodeMove,
                      onNodeMoveEnd,
                      onNodeMoveCancel,
                      onAutoLayout: () => stepLive({ type: 'autoLayout' }),
                      onSelectNode,
                      onExpandComposite,
                      onNodeFocusRow: onFocusNodeRow,
                      // W17-C：力学杆线体热区（杆 = 两节点连线，6 容差同导线）；
                      // 点杆选杆、点节点选物件、加杆模式里维持两次点击。
                      wires: (isBeam
                        ? graph.edges.map((edge) => {
                            const a = graph.nodes.find((node) => node.id === edge.from);
                            const b = graph.nodes.find((node) => node.id === edge.to);
                            return { id: edge.id, points: (a && b ? [[a.x, a.y], [b.x, b.y]] : []) as [number, number][] };
                          })
                        : graph.edges
                            .filter((edge) => edge.points && edge.points.length >= 2)
                            .map((edge) => ({ id: edge.id, points: edge.points as [number, number][] }))
                      ).filter((wire) => wire.points.length >= 2),
                      selectedWireId: isBeam ? selectedMember : selectedWire,
                      onSelectWire: isBeam
                        ? (edgeId: string | null) => selectMember(edgeId)
                        : (edgeId: string | null) => selectWire(edgeId),
                      linkMode: isBeam && linkMode,
                      // R3-4 U1：放置器（力学族）。tool='off' 时画布事件与以前完全一致。
                      place: isBeam
                        ? {
                            tool: placeTool,
                            onHover: onPlaceHover,
                            onHoverEnd: () => {
                              setPlaceGhost(null);
                              setPlaceAmbiguous(false);
                            },
                            onPlaceDown,
                            onPlaceUp,
                            ghost: placeGhost,
                          }
                        : undefined,
                      // 电路：点器件本体 → 把它的引脚列出来（点名字就起线）。
                      onBodyPinList: isBeam
                        ? undefined
                        : (nodeId: string) => {
                            const pins = graph ? pinsOfNode(graph, nodeId) : [];
                            setPinList(pins.length > 0 ? { nodeId, pins } : null);
                          },
                      selectedNodeId: selectedObject,
                      onNodeSelect: isBeam
                        ? (nodeId: string | null) => {
                            selectObject(nodeId);
                            if (nodeId) setSelectedIds([]);
                          }
                        : undefined,
                    }}
                  />
                  {/* R3-4 U1：点电路器件本体 → 把它的脚列出来（点名字就起线，不再是一句提示）。 */}
                  {pinList && pinList.pins.length > 0 ? (
                    <div data-testid="pin-list" className="mt-2 rounded-lg border border-line bg-panel px-2 py-1.5">
                      <p className="text-[10px] leading-4 text-muted">
                        器件本体不是接线端点，但它的每个脚都是 —— 点一个脚起线：
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {pinList.pins.map((pin) => (
                          <button
                            key={pin.key}
                            type="button"
                            data-testid="pin-list-item"
                            data-pin-key={pin.key}
                            onClick={() => onWireClick({ kind: 'pin', key: pin.key })}
                            className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-ink hover:border-cyan/50"
                          >
                            {pin.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPinList(null)}
                          className="focus-ring ml-auto text-[10px] text-muted hover:text-ink"
                        >
                          收起
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {selectedWire ? (
                    <div
                      data-testid="selection-bar"
                      className="mt-2 flex items-center gap-2 rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] text-cyan"
                    >
                      {/* 修复计划 T3.4：不再给用户看裸 id（e-pin-4），改报两端引脚名；id 留在 title 里备查 */}
                      已选：导线 {wireDisplayName(graph, selectedWire)}
                      <button
                        type="button"
                        data-testid="wire-delete"
                        onClick={() => deleteWire(selectedWire)}
                        className="ml-auto rounded border border-cyan/60 px-1.5 py-0.5 hover:bg-cyan/15"
                      >
                        删（Delete）
                      </button>
                    </div>
                  ) : selectedMember ? (
                    <div
                      data-testid="selection-bar"
                      className="mt-2 flex items-center gap-2 rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] text-cyan"
                    >
                      已选：构件 {memberLabel(selectedMember)}
                      {(mechElement === 'beam' ? (['A', 'I', 'E'] as const) : (['A', 'E'] as const)).map((key) => {
                        const edge = graph.edges.find((one) => one.id === selectedMember);
                        return (
                          <input
                            key={key}
                            type="number"
                            defaultValue={edge?.[key] ?? 1}
                            step="any"
                            title={`${key}（相对比例，EA=E·A / EI=E·I）`}
                            onBlur={(event) => {
                              const value = Number(event.target.value);
                              if (Number.isFinite(value) && value > 0 && value !== (edge?.[key] ?? 1)) {
                                mutate({ op: 'setMemberProps', edgeId: selectedMember, [key]: value });
                              }
                            }}
                            className="w-14 rounded border border-line bg-bg px-1 text-right text-[10px] text-ink"
                          />
                        );
                      })}
                      <button
                        type="button"
                        data-testid="selection-delete"
                        onClick={() => deleteMember(selectedMember)}
                        className="ml-auto rounded border border-cyan/60 px-1.5 py-0.5 hover:bg-cyan/15"
                      >
                        删（Delete）
                      </button>
                    </div>
                  ) : selectedObject ? (
                    <div
                      data-testid="selection-bar"
                      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] text-cyan"
                    >
                      {(() => {
                        const node = graph.nodes.find((one) => one.id === selectedObject);
                        const name = (node?.label ?? '').trim() || selectedObject.replace(/^n-/, '').toUpperCase();
                        const kindLabel = node?.support
                          ? `节点 · ${SUPPORT_KIND_LABEL[`${node.support.type}Support`] ?? '支座'}`
                          : node?.kind === 'arrow'
                            ? '集中力'
                            : node?.kind === 'udl'
                              ? '均布载荷'
                              : node?.kind === 'momentArrow' || node?.kind === 'torqueArrow'
                                ? '力偶'
                                : '节点';
                        return `已选：物件 ${name} · ${kindLabel}`;
                      })()}
                      {/* 结点：支座是它的属性 —— 改类型 / 摘掉都在这里，坐标不另存 */}
                      {selectedJointNode ? (
                        selectedJointNode.support ? (
                          <span className="flex items-center gap-1" data-testid="joint-support">
                            支座
                            <select
                              data-testid="selection-support"
                              aria-label="支座类型"
                              value={selectedJointNode.support.type}
                              onChange={(event) => mutate({ op: 'setSupport', nodeId: selectedJointNode.id, type: event.target.value as 'pin' | 'roller' | 'fixed' })}
                              className="rounded border border-line bg-bg px-1 text-[10px] text-ink"
                              title="改支座类型（同一结点只能有一个支座）"
                            >
                              {Object.entries(SUPPORT_KIND_LABEL).map(([kind, label]) => (
                                <option key={kind} value={kind.replace(/Support$/, '')}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              data-testid="remove-support"
                              onClick={() => mutate({ op: 'setSupport', nodeId: selectedJointNode.id, type: null })}
                              className="rounded border border-line px-1 text-[10px] text-muted hover:border-danger/60"
                              title="摘掉这个支座（这个点就不再受约束）"
                            >
                              摘掉
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted" data-testid="joint-support">
                            无支座（左栏「加入器件」里加）
                          </span>
                        )
                      ) : null}
                      {/* 载荷：方向与跨内位置都是真的，改完立刻重算（reduce 的 a = t·L） */}
                      {selectedLoadNode ? (
                        <>
                          {selectedLoadNode.kind === 'arrow' ? (
                            <span className="flex items-center gap-1" data-testid="load-direction">
                              方向
                              {LOAD_DIRECTIONS.map((dir) => (
                                <button
                                  key={dir}
                                  type="button"
                                  data-testid={`selection-dir-${dir}`}
                                  onClick={() => mutate({ op: 'setLoadDir', nodeId: selectedLoadNode.id, dir })}
                                  className={`rounded border px-1 text-[10px] ${rotToDir(selectedLoadNode.rot) === dir ? 'border-cyan/70 bg-cyan/10 text-cyan' : 'border-line text-ink hover:border-cyan/50'}`}
                                >
                                  {LOAD_DIR_LABEL[dir]}
                                </button>
                              ))}
                            </span>
                          ) : null}
                          {selectedLoadNode.kind === 'udl' ? (
                            <span data-testid="load-span-note" className="text-[10px] text-muted">
                              整跨均布 · 铺满该段（位置固定在跨上，不能拖到跨内某一点）
                            </span>
                          ) : null}
                          <span className="flex items-center gap-1" data-testid="load-spot" title="跨内相对位置：0 / 1 = 落到两端结点">
                            {loadSpotText(graph, selectedLoadNode)}
                            <input
                              type="number"
                              data-testid="load-t"
                              aria-label="跨内相对位置 t"
                              step="0.05"
                              min="0"
                              max="1"
                              defaultValue={loadTNow ?? 0.5}
                              onFocus={(event) => event.target.select()}
                              // 边打边生效：输入框失焦前若点了画布空白，选中条会先卸载
                              // （pointerdown 的 preventDefault 也吃掉了 blur），只靠 onBlur
                              // 会把这次编辑悄悄丢掉。只认「写完了的数」（0. / 00 这类中间态跳过）。
                              onChange={(event) => {
                                const text = event.target.value;
                                if (!/^\d+(\.\d+)?$/.test(text)) return;
                                const t = Number(text);
                                if (Number.isFinite(t) && t >= 0 && t <= 1) mutate({ op: 'setLoadT', nodeId: selectedLoadNode.id, t });
                              }}
                              onBlur={(event) => {
                                const t = Number(event.target.value);
                                if (Number.isFinite(t) && t >= 0 && t <= 1) mutate({ op: 'setLoadT', nodeId: selectedLoadNode.id, t });
                              }}
                              className="w-14 rounded border border-line bg-bg px-1 text-right text-[10px] text-ink"
                            />
                          </span>
                        </>
                      ) : null}
                      <button
                        type="button"
                        data-testid="selection-delete"
                        onClick={() => requestDeleteDevice(selectedObject)}
                        className="ml-auto rounded border border-cyan/60 px-1.5 py-0.5 hover:bg-cyan/15"
                      >
                        删（Delete）
                      </button>
                    </div>
                  ) : null}
                </section>

                {/* 右：参数确认 + 归约预览 */}
                <section data-testid="col-known" className={`${CARD} max-h-[70vh] space-y-3 overflow-y-auto p-3`}>
                  <div className="flex items-center gap-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-amber" />
                    <h2 className="shrink-0 text-[11.5px] font-medium tracking-[0.01em] text-ink">确认已知量</h2>
                    <span className="draft-rule flex-1" />
                  </div>
                  {QUICKFILL_TEMPLATES.includes(pickId) ? (
                    <QuickFill
                      templateId={pickId}
                      values={displayValues}
                      writableKeys={params.map((param) => param.key)}
                      testId="quickfill-lab"
                      onWrite={onQuickWrite}
                    />
                  ) : null}
                  <p className="text-[10px] leading-4 text-muted">每个参数都要点一次「确认」（默认值也要）；改动后自动回到未确认。</p>
                  <p data-testid="known-source-note" className="text-[10px] leading-4 text-faint">
                    下面是本题的参数表（默认取骨架值）：画布上新增 / 删除的载荷<strong>不会自动写回</strong>这里；
                    改器件数值请用左栏输入框。
                  </p>
                  {/* 图上元件实时读数：确认数值时对着画布实物核对。 */}
                  {liveDeviceRows.length > 0 ? (
                    <div data-testid="canvas-live-devices" className="rounded-lg border border-line bg-bg/60 p-2">
                      <p className="text-[10px] font-medium leading-4 text-cyan">图上元件 · 实时读数</p>
                      <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-muted">
                        {liveDeviceRows.map((row, index) => (
                          <li key={`${row}-${index}`} className="truncate" title={row}>· {row}</li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[9px] leading-3 text-faint">随画布实时刷新（挪载荷 / 换支座 / 加器件立刻更新）；确认数值以这一份为准。</p>
                    </div>
                  ) : null}
                  {/* ㊱③：剪贴板被拒（file:// / 权限策略）时把链接摊在页面上 —— 用户拿得到、能手动复制。 */}
                  {shareFallback ? (
                    <div data-testid="share-fallback" className="rounded-lg border border-line bg-panel-2 p-2">
                      <p className="text-[10px] leading-4 text-muted">
                        浏览器没给剪贴板权限 —— 链接在这里，手动全选复制即可（Esc 关掉这条）。
                      </p>
                      <input
                        readOnly
                        data-testid="share-fallback-url"
                        value={shareFallback}
                        onFocus={(event) => event.currentTarget.select()}
                        className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-0.5 text-[10px] text-ink"
                      />
                    </div>
                  ) : null}                  {/* ㉟⑦：拒答原因在「缺 gm / ro / Ic·β·VA」时，就地给补参面板 ——
                      面板只列 required 字段；灰字是参考量级，绝不冒充题面值。 */}
                  {missingParams.length > 0 ? (
                    <div
                      data-testid="missing-params-panel"
                      className="rounded-lg border border-amber/50 bg-amber/10 p-2"
                    >
                      <p className="text-[11px] text-amber">补模型参数（{missingParams.length} 个器件缺必填项）</p>
                      <p className="mt-0.5 text-[10px] leading-4 text-amber/80">
                        这些数不在参数表里 —— 缺一项通用解就拒答。输入框里的灰字是<strong>参考值不是题面值</strong>，
                        只作量级提示；题面默认给了就按题面填。填一项即写进图，补完自动重解。
                      </p>
                      {missingParams.map((item) => (
                        <div key={item.nodeId} className="mt-1.5 border-t border-amber/20 pt-1">
                          <p className="text-[10px] text-ink">
                            {item.label} · {item.kind}
                          </p>
                          {item.fields.map((field) => (
                            <div key={field.key} className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                              <span className="w-24 shrink-0">{field.label}</span>
                              <ModelParamInput
                                field={field}
                                onCommit={(field, value) => {
                                  applyMissingParams(item.nodeId, field, value);
                                  if (stage === 'solved') recomputeArmed.current = true;
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate text-faint" title={field.hint}>
                                {field.hint}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}                  {/* W21-A A2.3：确认是真闸门，把还差几项直接写在屏幕上。 */}
                  {canvasEmpty ? (
                    <p data-testid="confirm-gate-note" className="text-[11px] font-medium leading-4 text-amber">画布已空 · 先放器件 / 连构件，再回来核对数值</p>
                  ) : !allConfirmed ? (
                    <p data-testid="confirm-gate-note" className="text-[11px] font-medium leading-4 text-danger">
                      还有 {writableParams.filter((one) => !confirmed[one.key]).length} 项没确认 —— 未确认前不求解、不给校验章
                    </p>
                  ) : (
                    <p data-testid="confirm-gate-note" className="text-[11px] leading-4 text-ok">全部已确认 · 三处数值都取自归约结果</p>
                  )}
                  {!allConfirmed ? (
                    <button
                      type="button"
                      data-testid="confirm-all"
                      onClick={confirmAllParams}
                      title="默认值也要你点一次 —— 这一下就是「我看过这些数了」的签收"
                      className="focus-ring rounded border border-cyan/50 px-2 py-1 text-[10px] text-cyan hover:border-cyan"
                    >
                      一键确认全部（{writableParams.filter((one) => !confirmed[one.key]).length} 项）
                    </button>
                  ) : null}
                  <ul className="space-y-1.5">
                    {params.map((param) => {
                      const value = displayValues[param.key];
                      /* P0：1e12 是归约的「此件不存在」哨兵（Rc→∞ / Rl 空载），
                         别把它当越界数值摆出来 —— 显示 ∞ + 一句规则，不标红。 */
                      const infinite = isInfiniteValue(value);
                      /* 哨兵值来自归约规则（不是用户填的），徽标也照实写「归约」。 */
                      const isDefault = String(value) === String(param.defaultValue) || infinite;
                      /* ㊱④：越界就当场标红 —— 不等到求解才报「参数不合法」。 */
                      const outOfRange =
                        !infinite &&
                        typeof value === 'number' &&
                        ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max));
                      /* A3：写入目标不在画布上（如 q：图上没有均布载荷）→ 只读 + 说明缺什么。 */
                      const writeBlock = paramWriteBlock(pickId, graph, param.key);
                      const draft = paramDrafts[param.key];
                      return (
                        <li key={param.key} data-testid="param-row" data-param={param.key} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <input
                            type="checkbox"
                            aria-label={`确认 ${param.label ?? param.key}`}
                            checked={Boolean(confirmed[param.key])}
                            disabled={writeBlock !== null}
                            title={writeBlock ?? undefined}
                            onChange={(event) => setConfirmed((current) => ({ ...current, [param.key]: event.target.checked }))}
                            className="accent-[var(--color-cyan,#6366f1)] disabled:opacity-40"
                          />
                          {/* P1：这里以前印的是内部参数键（M1 的 `allow`、A3 的 `beta`），
                              同一行的 aria-label 却已经写「许用应力 [σ]」「β」—— 屏幕上是英文、
                              读屏是中文。改用 registry 的 label，键名挪到 title 里备查。 */}
                          {/* 修复计划 T2.4：标签不竖排（whitespace-nowrap），长提示折行不撑宽（min-w-0 break-words）
                              —— 右栏 320px 下 scrollWidth === clientWidth，不再横向溢出。 */}
                          <span className="whitespace-nowrap text-muted" title={param.key}>
                            {param.label ?? param.key}
                          </span>
                          <input
                            type="number"
                            aria-label={`${param.label ?? param.key}（确认框输入值）`}
                            aria-invalid={outOfRange || undefined}
                            data-testid={`confirm-input-${param.key}`}
                            value={draft ?? (typeof value === 'number' && !infinite ? String(value) : infinite ? '' : '0')}
                            placeholder={infinite ? '∞' : undefined}
                            step="any"
                            readOnly={writeBlock !== null}
                            title={writeBlock ?? undefined}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => {
                              const text = event.target.value;
                              setParamDrafts((current) => ({ ...current, [param.key]: text }));
                              const next = Number(text);
                              // A2：空串 / 「-」「0.」这类中间态不提交 —— 模型保留上一个有效值，
                              // 不会把 0 当真值拿去画退化图；失焦丢草稿回到真实值（020 归一成 20）。
                              if (text.trim() !== '' && Number.isFinite(next)) onParamChange(param.key, next);
                            }}
                            onBlur={() => {
                              setParamDrafts((current) => {
                                if (current[param.key] === undefined) return current;
                                const copy = { ...current };
                                delete copy[param.key];
                                return copy;
                              });
                            }}
                            className={`w-20 rounded border bg-bg px-1.5 py-0.5 text-right text-ink ${
                              writeBlock !== null ? 'cursor-not-allowed border-line opacity-50' : outOfRange ? 'border-danger' : 'border-line'
                            }`}
                          />
                          <span className="shrink-0 whitespace-nowrap text-[10px] text-muted">{param.unit ?? ''}</span>
                          {writeBlock ? (
                            <span data-testid="param-readonly-hint" className="min-w-0 flex-1 break-words rounded bg-panel-2 px-1 text-[10px] leading-4 text-muted">
                              {writeBlock}
                            </span>
                          ) : null}
                          {outOfRange ? (
                            <span data-testid="param-range-flag" className="min-w-0 break-words rounded bg-danger/15 px-1 text-[10px] leading-4 text-danger">
                              超出 {`合法 ${param.min ?? '−∞'}~${param.max ?? '+∞'}`}
                            </span>
                          ) : null}
                          {infinite ? (
                            <span data-testid="param-infinite-flag" className="min-w-0 flex-1 break-words rounded bg-panel-2 px-1 text-[10px] leading-4 text-muted">
                              ∞ · 图上没有它，按规则当作不存在
                            </span>
                          ) : null}
                          <span
                            data-testid={derivedKeys.includes(param.key) ? 'derived-source' : pKeys.includes(param.key) ? 'p-source' : undefined}
                            className={`ml-auto shrink-0 whitespace-nowrap text-[10px] ${
                              derivedKeys.includes(param.key)
                                ? 'rounded bg-ok/15 px-1 text-ok'
                                : pKeys.includes(param.key)
                                  ? 'rounded bg-cyan/15 px-1 text-cyan'
                                  : 'text-muted'
                            }`}
                          >
                            {derivedKeys.includes(param.key) ? '推得' : pKeys.includes(param.key) ? '题面' : isDefault ? '归约' : '用户'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {/* W20：梁族专属「截面」。三个数一起给、一起清，写进 graph.meta.section。 */}
                  {graph?.family === 'beam' ? (
                    <div data-testid="section-panel" className="rounded-lg border border-line bg-panel-2 p-2">
                      <p className="text-[11px] text-ink">截面（矩形）</p>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted">
                        b / h 按 mm、E 按 GPa。
                        {capabilities.includes('stress') || capabilities.includes('deflection')
                          ? '这组截面已用于当前图的应力与挠度计算，数值见下方「这张图的量」。'
                          : '没有完整截面时只给反力与内力；三项填齐正数后，这张图能算的量会写在结论卡里，缺什么也写清。'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(['b', 'h', 'E'] as const).map((key) => (
                          <label key={key} className="flex items-center gap-1 text-[10px] text-muted">
                            <span className="id-mono">{key}</span>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              data-testid={`section-${key}`}
                              value={sectionDraft[key]}
                              onChange={(event) => onSectionChange(key, event.target.value)}
                              className="w-16 rounded border border-line bg-bg px-1 py-0.5 text-right text-[11px] text-ink"
                            />
                            <span>{key === 'E' ? 'GPa' : 'mm'}</span>
                          </label>
                        ))}
                        <button
                          type="button"
                          data-testid="section-clear"
                          onClick={() => {
                            setSectionDraft({ b: '', h: '', E: '' });
                            mutate({ op: 'setSection', section: null });
                          }}
                          className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-cyan/50 hover:text-cyan"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {preview ? (
                    <div className="rounded-lg border border-line bg-panel-2 p-2">
                      <p className="text-[11px] text-ink">归约预览</p>
                      {preview.problems.length > 0 ? (
                        <div data-testid="structure-card" className="mt-1 rounded-lg border border-amber/50 bg-amber/10 p-2">
                          <p className="text-[10px] text-amber">结构判据 · 可执行建议</p>
                          {preview.problems.map((problem: string) => (
                            <p key={problem} className="mt-1 text-[10px] leading-4 text-amber">· {problem}</p>
                          ))}
                          <p className="mt-1 text-[10px] text-amber/80">可点「恢复骨架」回到原始结构，或在左侧加 / 删构件后重新求解。</p>
                        </div>
                      ) : (
                        /* 黑盒 #25：裸串会贴到面板右缘裁断 —— 每个键值一枚 chip，装不下就换行。
                           修复计划 T3.6：图与骨架不一致、归约给不出参数时不再留一张空卡。 */
                        <div data-testid="preview-params" className="mt-1 text-[10px] leading-4 text-muted">
                          params：
                          {Object.keys(preview.params).length === 0 ? (
                            <span className="text-faint">这张图与骨架差异太大，归约给不出参数表 —— 点「恢复骨架」回原题，或按题型把支座 / 载荷 / 器件补回。</span>
                          ) : (
                            Object.entries(preview.params).map(([key, value]) => (
                              <span key={key} className="mb-0.5 mr-1.5 inline-block whitespace-nowrap rounded border border-line/70 bg-bg px-1 font-mono">
                                {key}={typeof value === 'number' ? Number(value.toPrecision(6)) : value}
                              </span>
                            ))
                          )}
                        </div>
                      )}
                      {critical.length > 0 ? (
                        <p className="mt-1 text-[10px] leading-4 text-muted">
                          关键语义：{critical.map((tag) => SEMANTIC_LABEL[tag] ?? tag).join(' / ')}
                          {preview.semantic.missing.length > 0 ? ` · 还缺 ${preview.semantic.missing.map((tag) => SEMANTIC_LABEL[tag] ?? tag).join(' / ')}` : ' · 已标全'}
                          {preview.semantic.missing.length > 0 ? ' —— 在归约预览点「按拓扑标全」（还缺 ' + preview.semantic.missing.length + ' 项）即可升 F 档看等效电路' : ''}
                        </p>
                      ) : null}
                      {critical.length > 0 && preview.semantic.missing.length > 0 ? (
                        <button
                          type="button"
                          data-testid="mark-all-semantics"
                          onClick={markAllSemantics}
                          title="按题型拓扑把关键语义（偏置 / 耦合 / 负载 / 电源）标到对应器件上；标完等效图才通"
                          className="focus-ring mt-1 rounded border border-cyan/50 px-2 py-0.5 text-[10px] text-cyan hover:border-cyan"
                        >
                          按拓扑标全（还缺 {preview.semantic.missing.length} 项）
                        </button>
                      ) : null}
                      {preview.appliedRules.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-amber">
                          {preview.appliedRules.map((rule: string) => (
                            <li key={rule}>· {rule}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {/* H-11：参数实验场接进装配台 —— 拖一个值，归约预览与结果同时变 */}
                  {params.length > 0 ? (
                    <ParamPanel
                      params={params}
                      values={displayValues}
                      solveMs={solveMs}
                      defaultsUsed={preview?.defaultsUsed}
                      readOnlyHints={Object.fromEntries(
                        params
                          .map((one) => [one.key, paramWriteBlock(pickId, graph, one.key)] as const)
                          .filter((entry): entry is readonly [string, string] => entry[1] !== null),
                      )}
                      onChange={experimentChange}
                      onReset={experimentReset}
                      onResetAll={experimentResetAll}
                      live={liveExperiment}
                      onLiveChange={setLiveExperiment}
                    />
                  ) : null}

                  {/* §5：AI 只剩识图，默认关；不点按钮不发任何请求 */}
                  <details data-testid="lab-advanced" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5">
                    <summary className="cursor-pointer text-[11px] text-muted">高级 · AI 识图（默认关）</summary>
                    <div className="mt-2 grid gap-2">
                      <label className="flex items-start gap-2 text-[10px] leading-4 text-muted">
                        <input
                          type="checkbox"
                          data-testid="vision-switch"
                          checked={visionOn}
                          onChange={(event) => {
                            setVisionEnabled(event.target.checked);
                            setVisionOnState(event.target.checked);
                            setVisionNote('');
                          }}
                          className="mt-0.5"
                        />
                        <span>本场开启 AI 识图（本次会话有效，刷新即关）</span>
                      </label>
                      {visionOn ? (
                        <>
                          <input
                            type="file"
                            accept="image/*"
                            data-testid="vision-image"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              event.target.value = '';
                              if (!file) return;
                              const { list, errors } = await prepareImages([file], []);
                              if (list[0]) {
                                setVisionImage(list[0].send);
                                setVisionNote('');
                              } else {
                                setVisionNote(keepOnFailure(graph, errors[0] ?? '这张图没接住').note);
                              }
                            }}
                            className="w-full text-[10px] text-muted file:mr-2 file:rounded file:border file:border-line file:bg-transparent file:px-1.5 file:py-0.5 file:text-[10px] file:text-muted"
                          />
                          <button
                            type="button"
                            data-testid="vision-read"
                            disabled={!visionImage || visionBusy || visionUsesLeft() === 0}
                            onClick={() => void runVision()}
                            className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-ink transition-colors hover:border-line-2 disabled:opacity-40"
                          >
                            {visionBusy ? '正在读…' : `让 AI 看一眼（剩 ${visionUsesLeft()} 次）`}
                          </button>
                          <p className="text-[10px] leading-4 text-muted">
                            只读结构、不算数；每会话上限 {VISION_CONFIG.maxPerSession} 次，点了才发请求。
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] leading-4 text-muted">
                          关着的时候一次网络请求都不会发。打开后仍需点按钮才算一次。
                        </p>
                      )}
                      {visionNote ? (
                        <p data-testid="vision-note" className="text-[10px] leading-4 text-amber">
                          {visionNote}
                        </p>
                      ) : null}
                    </div>
                  </details>
                </section>
              </Spotlight>

            {stage === 'solved' && generic ? (
              <section ref={resultSectionRef} className="result-heavy mt-4 scroll-mt-24">
                {/* ㉝①/㊱④：把当前画布（不只是归约参数）一并交给通用结果卡 ——
                    图上改一个截面 / 换一根构件，结果卡里的力学量就能跟着重算。 */}
                <GenericResult
                  family={generic.family}
                  circuit={generic.circuit}
                  frame={generic.frame}
                  notices={generic.notices}
                  measures={generic.measures}
                  reason={generic.reason}
                  graphSpec={graph ? graphToSpec(graph, specType) : null}
                  labels={graph ? displayLabels(graph) : {}}
                  equivalent={generic.equivalent}
                  acEquivalent={generic.acEquivalent}
                />
              </section>
            ) : null}

            {stage === 'solved' && solution ? (
              <section ref={resultSectionRef} className="result-heavy mt-4 scroll-mt-24">
                {/* W20：默认骨架走 template，讲解稿之外也给出「这张图的量」——填截面后即时更新。 */}
                {graph ? <GraphMeasures graph={graph} /> : null}
                {solution.warnings.length > 0 ? (
                  <div className="print-applied-rules mb-3 rounded-xl border border-amber/50 bg-amber/10 p-3">
                    <p className={EYEBROW}>改动台账 · 结构改动证据（随 PDF 导出）</p>
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-amber">
                      {solution.warnings.map((rule: string) => (
                        <li key={rule}>· {rule}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {/* 黑盒 #5：内力图只画一套 —— GraphMeasures 的三联图（带 |M|max 读数）是主口径，
                    讲解稿里那张同款「internal」图在装配台嵌入态不再重画；独立结果页（#/t/）不受影响。 */}
                <Result
                  templateId={pickId}
                  search=""
                  onBack={onBack}
                  onToast={onToast}
                  override={
                    graph?.family === 'beam'
                      ? { ...solution, render_specs: solution.render_specs.filter((spec) => spec.id !== 'internal') }
                      : solution
                  }
                />
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

/** W13 封装 / 编辑端口面板：端口标注 → 命名与模型声明 → 校验后保存。 */
function WrapPanel({
  mode,
  graph,
  nodeIds,
  onValidate,
  onSubmit,
  onClose,
}: {
  mode: 'wrap' | { edit: string };
  graph: CanvasGraph;
  nodeIds: string[];
  onValidate: (op: GraphOp) => { refused?: string; problems: string[]; summary: string };
  onSubmit: (op: GraphOp) => void;
  onClose: () => void;
}) {
  const isEdit = mode !== 'wrap';
  const editNode = isEdit ? graph.nodes.find((node) => node.id === (mode as { edit: string }).edit) : undefined;
  const editDef = isEdit ? allComposites()[editNode?.compositeId ?? ''] : undefined;
  const members = graph.nodes.filter((node) => nodeIds.includes(node.id) && node.kind !== 'text');

  /** 候选端口：选中集合内部但连着外部的节点（封装）；编辑模式列定义里的全部端口。 */
  const candidates = useMemo(() => {
    if (isEdit) return (editDef?.ports ?? []).map((port) => ({ nodeId: port.nodeId, defaultLabel: port.label }));
    const memberAnchors = members.flatMap((member) => anchorsOfNode(member, graph.family));
    const near = (x: number, y: number) => memberAnchors.some((anchor) => Math.hypot(anchor.x - x, anchor.y - y) <= 0.6);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const boundary = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.points && edge.points.length >= 2) {
        const first = edge.points[0];
        const last = edge.points[edge.points.length - 1];
        const aIn = near(first[0], first[1]);
        const bIn = near(last[0], last[1]);
        if (aIn === bIn) continue;
        const inner = aIn ? first : last;
        const anchor = memberAnchors.find((one) => Math.hypot(one.x - inner[0], one.y - inner[1]) <= 0.6);
        if (anchor) boundary.add(anchor.nodeId);
      } else {
        const fIn = nodeIds.includes(edge.from);
        const tIn = nodeIds.includes(edge.to);
        if (fIn && !tIn) boundary.add(edge.from);
        if (tIn && !fIn) boundary.add(edge.to);
      }
    }
    return [...boundary].map((nodeId) => {
      const node = nodeById.get(nodeId);
      const label = (node?.label ?? '').trim().split(/[\s=]/)[0];
      return { nodeId, defaultLabel: label || '节点' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, nodeIds.join(','), isEdit, editDef?.id]);

  const [portRows, setPortRows] = useState(() => candidates.map((one) => ({ ...one, label: one.defaultLabel, on: true })));
  const [title, setTitle] = useState(isEdit ? (editDef?.title ?? '') : '');
  const [note, setNote] = useState(isEdit ? (editDef?.note ?? '') : '');
  const [equations, setEquations] = useState(isEdit ? (editDef?.modelSpec.equations ?? []).join('\n') : '');
  const [applicableRange, setApplicableRange] = useState(isEdit ? editDef?.modelSpec.applicableRange ?? '' : '');
  const [unitsText, setUnitsText] = useState(isEdit ? Object.entries(editDef?.modelSpec.units ?? {}).map(([key, value]) => `${key}:${value}`).join(', ') : '');
  const [goldenRefs, setGoldenRefs] = useState(isEdit ? (editDef?.goldenRefs ?? []).join(', ') : '');
  const [verdict, setVerdict] = useState<{ refused?: string; problems: string[]; summary: string } | null>(null);

  const buildOp = (): GraphOp => {
    const units = Object.fromEntries(
      unitsText
        .split(/[,，;；\n]/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, value] = line.split(':');
          return [key.trim(), (value ?? '').trim()] as [string, string];
        }),
    );
    const modelSpec = {
      equations: equations.split('\n').map((line) => line.trim()).filter(Boolean),
      applicableRange: applicableRange.trim(),
      units,
    };
    const golden = goldenRefs.split(/[,，\s]+/).map((one) => one.trim()).filter(Boolean);
    const checked = portRows.filter((row) => row.on);
    if (isEdit) {
      return {
        op: 'editCompositePorts',
        nodeId: (mode as { edit: string }).edit,
        title: title.trim() || '未命名模块',
        note,
        ports: checked.map((row) => ({
          id: editDef?.ports.find((port) => port.nodeId === row.nodeId)?.id ?? `p-new-${row.nodeId}`,
          nodeId: row.nodeId,
          label: row.label.trim() || '端口',
        })),
        modelSpec,
        goldenRefs: golden,
      };
    }
    return {
      op: 'wrapComposite',
      nodeIds: [...nodeIds],
      title: title.trim() || '未命名模块',
      note,
      ports: checked.map((row) => ({ nodeId: row.nodeId, label: row.label.trim() || '端口' })),
      modelSpec,
      goldenRefs: golden,
    };
  };

  const runValidate = () => setVerdict(onValidate(buildOp()));
  const save = () => {
    const result = onValidate(buildOp());
    setVerdict(result);
    // 归约失败 → 红字 + 不许保存；绿字才放行。
    if (result.refused || result.summary === '') return;
    onSubmit(buildOp());
  };

  const blocked = Boolean(verdict && (verdict.refused || verdict.summary === ''));

  return (
    <section data-testid="wrap-panel" className="mb-3 rounded-xl border border-cyan/50 bg-panel p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xs text-ink">{isEdit ? `编辑复合器件「${editDef?.title ?? ''}」` : '封装为复合器件'}</h2>
        <button type="button" onClick={onClose} className="focus-ring ml-auto rounded border border-line px-2 py-0.5 text-[10px] text-muted hover:border-cyan/50">
          取消
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        端口 = 选中集合里连着外部的节点；不勾的视为内部。保存前会真跑一遍「展开 → 归约 → 既有 solver」，归不过不给保存。
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <h3 className="text-[11px] text-muted">① 端口标注</h3>
          <ul className="mt-1 space-y-1">
            {portRows.map((row, index) => (
              <li key={row.nodeId} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={row.on}
                  onChange={(event) => setPortRows((current) => current.map((one, i) => (i === index ? { ...one, on: event.target.checked } : one)))}
                />
                <span className="id-mono shrink-0 text-muted">{row.nodeId}</span>
                <input
                  value={row.label}
                  onChange={(event) => setPortRows((current) => current.map((one, i) => (i === index ? { ...one, label: event.target.value } : one)))}
                  className="w-24 rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink"
                  aria-label="端口名"
                />
              </li>
            ))}
            {portRows.length === 0 ? <li className="text-[10px] text-faint">没有边界节点（选中的器件没连外面）。</li> : null}
          </ul>
        </div>

        <div>
          <h3 className="text-[11px] text-muted">② 命名与说明</h3>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="模块名（必填）"
            data-testid="wrap-title"
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="一句话说明（选填）"
            rows={2}
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
        </div>

        <div>
          <h3 className="text-[11px] text-muted">③ 模型声明（缺了按判 U 处理）</h3>
          <textarea
            value={equations}
            onChange={(event) => setEquations(event.target.value)}
            placeholder={'端口方程，一行一条\n如：Vout = Vin · R2/(R1+R2)'}
            rows={2}
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
          <input
            value={applicableRange}
            onChange={(event) => setApplicableRange(event.target.value)}
            placeholder="适用范围：如 直流、线性、R1+R2 ≤ 1 MΩ"
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
          <input
            value={unitsText}
            onChange={(event) => setUnitsText(event.target.value)}
            placeholder="单位表：R:Ω, V:V"
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
          <input
            value={goldenRefs}
            onChange={(event) => setGoldenRefs(event.target.value)}
            placeholder="已校验夹具：如 A3（check:lab 逐键校验过的快照 id）"
            className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="wrap-validate" onClick={runValidate} className="lab-chip focus-ring">
          校验
        </button>
        <button
          type="button"
          data-testid="wrap-save"
          onClick={save}
          className={`focus-ring rounded-md px-3 py-1 text-[11px] font-semibold text-white ${blocked ? 'bg-faint opacity-50' : 'bg-cyan'}`}
        >
          保存
        </button>
        {verdict ? (
          <p
            data-testid="wrap-verdict"
            className={`text-[11px] leading-5 ${blocked ? 'text-danger' : 'text-ok'}`}
          >
            {verdict.refused
              ? `封装后无法归约：${verdict.refused}`
              : verdict.summary === ''
                ? `封装后无法归约：${verdict.problems[0] ?? '模型声明不全（missingModelSpec / missingGoldenCase）'}`
                : verdict.summary + (verdict.problems.length > 0 ? `（提醒：${verdict.problems[0]}）` : '')}
          </p>
        ) : (
          <p className="text-[10px] text-muted">先「校验」再保存；绿字才能保存。</p>
        )}
      </div>
    </section>
  );
}

/**
 * W16 器件数值输入：失焦 / 回车提交（不逐键 reduce）；范围 (0, 1e12]，
 * 非法值红边不提交。单位按 kind 固定显示 —— 单位不可编辑，不给填错的机会。
 */
/** ㉟⑦：器件「模型参数」输入框（gm / ro / β / VA / Ic…）。
 *  placeholder 是**参考量级**，不是题面值；空着不写，填了才 commit，0 / 负数不收。 */
function ModelParamInput({
  field,
  onCommit,
}: {
  field: DeviceParamField;
  onCommit: (field: DeviceParamField, value: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const value = Number(draft);
    if (draft.trim() === '' || !(Number.isFinite(value) && value > 0)) return;
    onCommit(field, value);
    setDraft('');
  };
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        step="any"
        data-testid="device-param-input"
        aria-label={`${field.label}（${field.unit}）`}
        placeholder={`参考 ${field.example}${field.unit && field.unit !== '—' ? ' ' + field.unit : ''}`}
        title={field.hint}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        className="w-24 rounded border border-line bg-bg px-1.5 py-0.5 text-right text-[10px] text-ink"
      />
      <span className="text-[10px] text-muted">{field.unit}</span>
    </span>
  );
}
function ValueInput({ kind, value, onCommit }: { kind: string; value: number | undefined; onCommit: (value: number) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
    setInvalid(false);
  }, [value]);
  /** W22-R P0-E2：边打字边校验 —— 负电阻、0、超限当场红边，不等失焦。
   *  ㊲④：判据统一问 ops 的 valueInRange —— 源器件允许 0 / 负（0 = 短路、负 = 反极性），
   *  电阻 / 电容 / 电感必须落在 (0, 1e12]。以前这里一律 `<= 0` 就红，把 0 V 源判成非法。 */
  const check = (raw: string) => {
    const parsed = Number(raw);
    setInvalid(raw.trim() !== '' && !valueInRange(kind, parsed));
  };
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === '' || !valueInRange(kind, parsed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  };
  const unit = UNIT_OF[kind] ?? '';
  const shown = text.trim() !== '' && Number.isFinite(Number(text)) ? formatScalar(Number(text), unit) : '';
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <input
        type="number"
        data-testid="device-value"
        data-node={kind}
        value={text}
        step="any"
        min="0"
        onChange={(event) => {
          setText(event.target.value);
          check(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        className={`min-w-[64px] w-full max-w-[104px] rounded border bg-bg px-1 text-[10px] outline-none focus:border-cyan/60 ${invalid ? 'border-danger' : 'border-line'}`}
        title={`器件数值（失焦提交；${valueRangeHint(kind)}）`}
      />
      {/* W21-B B5：编辑框留原始数字方便改，旁边的读数是与画布 / 右栏同一个格式器。 */}
      <span data-testid="device-value-formatted" className="text-[10px] text-muted">{shown || unit}</span>
      {invalid ? (
        <span data-testid="device-value-hint" className="text-[10px] text-danger">
          {valueRangeHint(kind)}
        </span>
      ) : null}
    </span>
  );
}

/** 两次点击：先选第一个锚点，再点目标锚点；选项全是有中文名的可读端点。
 *  W22-C F1：候选不再截 8 个 —— 已连过滤 + 按器件分组 + 面板内滚动，
 *  超过 12 个候选出搜索框（大图如 A7 的 20+ 锚点全部可达）。 */
function TwoClickHelper({
  beam,
  anchors,
  edges,
  onWire,
  onMember,
}: {
  beam: boolean;
  anchors: { key: string; text: string; device: string }[];
  edges: { from: string; to: string }[];
  onWire: (from: string, to: string) => void;
  onMember: (from: string, to: string) => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [mode, setMode] = useState<'wire' | 'member'>(beam ? 'member' : 'wire');
  const [query, setQuery] = useState('');
  const labelOf = (key: string) => anchors.find((anchor) => anchor.key === key)?.text ?? key;
  /** 力学加杆收的是节点 id（不带 `:center`），电路连线收的是完整锚点 key（带 `:`）。 */
  const nodeOf = (key: string) => key.split(':')[0];
  /** 已连过滤：候选与第一个端点之间已有同向线/杆的不再给按钮（重复连线会被守卫拒，提前藏掉）。 */
  const linkedToFirst = (key: string) => {
    if (!first) return false;
    if (mode === 'member') {
      const a = nodeOf(first);
      const b = nodeOf(key);
      return edges.some((edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a));
    }
    return edges.some((edge) => (edge.from === first && edge.to === key) || (edge.from === key && edge.to === first));
  };
  const available = anchors.filter((anchor) => anchor.key !== first && !linkedToFirst(anchor.key));
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? available.filter((anchor) => anchor.text.toLowerCase().includes(needle) || anchor.device.toLowerCase().includes(needle))
    : available;
  /** 按器件分组（保持 anchors 原顺序），组头是器件中文名。 */
  const groups: { device: string; items: typeof anchors }[] = [];
  for (const anchor of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.device === anchor.device) last.items.push(anchor);
    else groups.push({ device: anchor.device, items: [anchor] });
  }
  const showSearch = available.length > 12;
  /** W22-C：候选不再截断后，同文案端点（两条地轨端 / 两个结点）会成对出现 ——
   *  读屏的同名可交互元素要可区分：文案撞车时用完整锚点 key 兜底区分，视觉不变。 */
  const seenTexts = new Set<string>();
  const dupTexts = new Set<string>();
  for (const anchor of anchors) {
    if (seenTexts.has(anchor.text)) dupTexts.add(anchor.text);
    seenTexts.add(anchor.text);
  }
  return (
    <div className="mt-1">
      <div className="flex gap-1">
        <select
          value={first ?? ''}
          onChange={(event) => setFirst(event.target.value || null)}
          className="w-full rounded border border-line bg-bg px-1.5 py-1 text-[10px]"
          title="第一个端点"
        >
          <option value="">第一个端点…</option>
          {anchors.map((anchor) => (
            <option key={anchor.key} value={anchor.key} data-testid="anchor-option">
              {anchor.text}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(event) => setMode(event.target.value as 'wire' | 'member')} className="rounded border border-line bg-bg px-1 text-[10px]" title="动作">
          <option value="wire">连线</option>
          {/* P1：电路页根本加不了「构件」（那是有力学骨架才有的东西），
              下拉里留着这一项只会让人点出一个必被拒的动作。 */}
          {beam ? <option value="member">加构件</option> : null}
        </select>
      </div>
      {showSearch ? (
        <input
          type="search"
          data-testid="anchor-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`搜端点（共 ${available.length} 个）…`}
          className="mt-1 w-full rounded border border-line bg-bg px-1.5 py-1 text-[10px]"
          aria-label="搜索候选端点"
        />
      ) : null}
      <div data-testid="anchor-candidates" className="mt-1 max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
        {groups.map((group) => (
          <div key={group.device}>
            <div className="text-[9px] leading-4 text-faint">{group.device}</div>
            <div className="flex flex-wrap gap-1">
              {group.items.map((anchor) => (
                <button
                  key={anchor.key}
                  type="button"
                  data-testid="anchor-candidate"
                  disabled={!first}
                  onClick={() => {
                    if (!first) return;
                    if (mode === 'member') onMember(nodeOf(first), nodeOf(anchor.key));
                    else onWire(first, anchor.key);
                    setFirst(null);
                    setQuery('');
                  }}
                  className="focus-ring rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-cyan/50 disabled:opacity-40"
                  aria-label={dupTexts.has(anchor.text) ? `${labelOf(anchor.key)}（${anchor.key}）` : undefined}
                >
                  {mode === 'member' ? '+ 构件 → ' : '→ '}{labelOf(anchor.key)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <div className="text-[10px] text-faint">{first ? (needle ? '没有匹配的端点（换个搜索词）' : '全部端点都已连过') : '先在上面选第一个端点'}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 修复计划 T3.4：导线的用户可见名 —— 两端引脚 / 结点名（`Rc·端 b – Q·基极 b`），
 * 裸 id（e-pin-4 / e-wire-2）只进 title。找不到端点时回退裸 id。
 */
function wireDisplayName(graph: CanvasGraph, wireId: string): string {
  const edge = graph.edges.find((one) => one.id === wireId);
  if (!edge) return wireId;
  const nodeName = (id: string) => {
    const node = graph.nodes.find((one) => one.id === id);
    return (node?.label ?? '').trim() || id.replace(/^n-/, '').toUpperCase();
  };
  const from = nodeName(edge.from);
  const to = nodeName(edge.to);
  if (!from || !to) return wireId;
  return `${from} – ${to}`;
}

/**
 * A3：这个参数键现在能不能写进图。`applyParams` 的写入目标在画布上不存在时
 * （例：M3 的 q —— 图上没有均布载荷），参数表只是个镜像，输入会被静默丢弃；
 * 与其让人白打一个数，不如直接只读 + 说明缺什么。
 * 目标查找逻辑与 picks.ts `applyParams` 逐条对应，两边一起改。
 */
function paramWriteBlock(pickId: string, graph: CanvasGraph | null, key: string): string | null {
  if (!graph) return null;
  const entry = PICKS[pickId]?.picks.find((one) => one.key === key);
  if (!entry) return null;
  const loadName = (type: string) => (type === 'udl' ? '均布载荷' : type === 'point' ? '集中力' : type === 'moment' ? '力偶' : '扭矩');
  for (const source of entry.sources) {
    if (source.src === 'load' || source.src === 'loadAt') {
      return findLoads(graph, source.type)[source.index ?? 0]
        ? null
        : `画布上没有${loadName(source.type)}，先放一个再改这个值`;
    }
    if (source.src === 'device' || source.src === 'deviceParam') {
      if (findDevice(graph, source.device)) return null;
      // 多源（gm/ro 有 M、Q 两个备选）与 applyParams 一致：找不到谁试下一个备选
      if (entry.sources.length > 1) continue;
      return `画布上没有器件 ${source.device}，先放一个再改这个值`;
    }
    if (source.src === 'spanText') {
      return graph.nodes.some((node) => node.kind === 'text' && /^L\s*=/.test(node.label ?? ''))
        ? null
        : '画布上没有「L = …」标注文字，先放一个再改这个值';
    }
    if (source.src === 'textValue') {
      return graph.nodes.some((node) => node.id === source.nodeId && node.kind === 'text')
        ? null
        : '这条标注文字不在画布上，先放一个再改这个值';
    }
    if (source.src === 'meta') return null;
  }
  return null;
}

/** 从分享图反推参数（器件值 / 载荷标签），骨架级参数保持默认。 */
function sharedValuesFromGraph(pickId: string, graph: CanvasGraph): Record<string, ParamValue> {  // W20：meta.section 是截面对象，不属于参数表；只把标量带进 values。
  const out: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(graph.meta)) {
    if (typeof value === 'number' || typeof value === 'string') out[key] = value;
  }
  const picks = PICKS[pickId];
  if (!picks) return out;
  for (const pick of picks.picks) {
    for (const source of pick.sources) {
      if (source.src === 'device') {
        const device = findDevice(graph, source.device);
        if (device?.value !== undefined) {
          out[pick.key] = device.value;
          break;
        }
      }
      if (source.src === 'deviceParam') {
        const device = findDevice(graph, source.device);
        const found = device?.params?.[source.field];
        if (found !== undefined) {
          out[pick.key] = found;
          break;
        }
      }
      if (source.src === 'spanText') {
        const text = graph.nodes.find((node) => node.kind === 'text' && /^L\s*=/.test(node.label ?? ''));
        const value = valueFromLabel(text?.label);
        if (value !== null) {
          out[pick.key] = value;
          break;
        }
      }
      if (source.src === 'textValue') {
        const text = graph.nodes.find((node) => node.id === source.nodeId && node.kind === 'text');
        const value = valueFromLabel(text?.label);
        if (value !== null) {
          out[pick.key] = value;
          break;
        }
      }
      if (source.src === 'load') {
        const load = findLoads(graph, source.type)[source.index ?? 0];
        const value = load ? (load.value ?? valueFromLabel(load.label)) : null;
        if (value !== null && value !== undefined) {
          out[pick.key] = value;
          break;
        }
      }
    }
  }
  return out;
}

/** 13 型「不适用」卡：专属原因 + 这一型能算什么 + 去向按钮 + 已知边界。 */
function NotApplicableCard({ view }: { view: NotApplicableView }) {
  return (
    <section data-testid="na-card" data-template={view.id} className="mx-auto max-w-3xl rounded-xl border border-amber/50 bg-panel p-5">
      <p className="id-mono text-[11px] text-cyan">{view.id} · 拼接台覆盖</p>
      <h1 className="mt-2 text-base text-ink">{view.title}：本题不适用，不求解</h1>
      <p className="mt-1 text-[11px] text-amber">这一型没有可装配的结构，拼接台不假装全能。</p>
      <p data-testid="na-reason" className="mt-3 text-[13px] leading-7 text-ink">{view.reason}</p>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        拼接台不适用；{view.what} 请回到 {view.id} 结果页看推导与图。
      </p>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        这一型在 <a href="#/about" className="text-cyan hover:underline">关于页的拼接台账本</a> 里记作「不适用」，原因与这里同一份，不藏在角落。
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {view.buttons.map((button) => (
          <a
            key={button.testId}
            data-testid="na-button"
            data-na-action={button.testId}
            href={button.hash}
            className="focus-ring rounded-lg border border-cyan/50 bg-cyan/10 px-3 py-1.5 text-[11px] text-cyan hover:border-cyan"
          >
            {button.label}
          </a>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-line bg-panel-2 p-3">
        <p className="text-[11px] text-muted">已知边界（写在这里，不藏）</p>
        <ul className="mt-1 space-y-1 text-[10px] leading-5 text-muted">
          <li>· 拼接台仍不支持任意拓扑：只有骨架 + 白名单器件。</li>
          <li>· 超静定（两跨连续、一端固定一端铰）仍是范围判别里的「要先简化」，不进拼接台；刚度法在计划书里，属 W12。</li>
          <li>· 截面只有矩形 / 圆 / 圆管三类，没有型钢表。</li>
        </ul>
      </div>
    </section>
  );
}

/* ── 三候选：缩略图 240×140 + 一句 why + 载入 / 只看看 ────────────── */

function CandidatePanel({
  templateId,
  peeked,
  onLoad,
  onPeek,
  onClose,
}: {
  templateId: string;
  peeked: string | null;
  onLoad: (candidate: Candidate) => void;
  onPeek: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  const list = candidatesFor(templateId);
  return (
    <section data-testid="candidate-panel" className="max-h-[70vh] w-full overflow-y-auto rounded-xl border border-cyan/30 bg-panel p-3 shadow-lg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <h2 className="text-xs text-ink">{candidateHeading(templateId)}</h2>
        <span className="text-[10px] text-muted">
          数据源只有已校验快照；映射不到快照的候选给 why + 禁用态，不硬造拓扑。共享参数从当前图继承。
        </span>
        <button type="button" data-testid="candidates-close" onClick={onClose} className="ml-auto text-[11px] text-muted hover:text-cyan">
          收起
        </button>
      </header>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {list.map((candidate) => {
          const disabled = candidate.source.kind === 'none';
          return (
            <article
              key={candidate.id}
              data-testid="candidate-card"
              data-candidate={candidate.id}
              className={`rounded-lg border p-2 ${disabled ? 'border-line/60 bg-panel-2 opacity-70' : 'border-line bg-panel-2'}`}
            >
              <div className="h-[140px] w-[240px] max-w-full overflow-hidden rounded border border-line bg-bg">
                {candidate.source.kind === 'snapshot' ? (
                  <MiniSkeleton exampleId={candidate.source.exampleId} />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 text-center text-[10px] leading-4 text-muted">
                    暂无已校验骨架预览
                  </div>
                )}
              </div>
              <h3 className="mt-2 text-[11px] text-ink">
                {candidate.title}
                {disabled ? <span className="ml-1 rounded bg-amber/15 px-1 text-[9px] text-amber">未覆盖</span> : null}
              </h3>
              <p className="mt-1 min-h-[32px] text-[10px] leading-4 text-muted">{candidate.why}</p>
              {disabled ? (
                <p className="mt-1 text-[10px] leading-4 text-amber">
                  {candidate.source.kind === 'none' ? candidate.source.reason : ''}
                </p>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  data-testid="load-candidate"
                  disabled={disabled}
                  onClick={() => onLoad(candidate)}
                  className="focus-ring rounded border border-cyan/40 px-2 py-0.5 text-[10px] text-cyan disabled:opacity-40"
                >
                  载入画布
                </button>
                <button
                  type="button"
                  data-testid="peek-candidate"
                  disabled={disabled}
                  onClick={() => onPeek(candidate)}
                  className="focus-ring rounded border border-line px-2 py-0.5 text-[10px] text-muted disabled:opacity-40"
                >
                  只看看
                </button>
              </div>
              {peeked === candidate.id ? (
                <p className="mt-1 text-[10px] text-cyan">只看看：图、参数与 dirty 都没动。</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** 真骨架的迷你预览：从已校验快照的 render_specs[0] 取节点/边，等比缩到 240×140。 */
function MiniSkeleton({ exampleId }: { exampleId: string }) {
  const [spec, setSpec] = useState<RenderSpec | null>(null);
  useEffect(() => {
    let alive = true;
    void getExample(exampleId).then((solution) => {
      if (alive && solution) setSpec(solution.render_specs[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [exampleId]);
  if (!spec) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] text-muted">
        <LoadingInline text="骨架预览加载中…" />
      </div>
    );
  }
  /* 黑盒 #35：纯点线缩略图 CE/CB 分不出 —— 直接复用主画布的器件符号渲染器
     （同一份 render_spec，等比 letterbox 到 240×140），信号路径与器件形状一目了然。 */
  return (
    <div className="h-full w-full" role="img" aria-label={`${exampleId} 骨架缩略图`}>
      <AnalogSchematic spec={spec} activeIds={new Set<string>()} labels={new Map()} />
    </div>
  );
}
