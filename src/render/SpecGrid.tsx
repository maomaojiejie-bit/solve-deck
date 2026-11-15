import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { RenderSpec } from '../core/types';
import type { PointerHit } from '../core/lab/pointer.ts';
import type { PlaceGhost } from '../core/lab/place.ts';
import { snapGrid } from '../core/lab/pins.ts';

const Schematic = lazy(() => import('./Schematic').then((module) => ({ default: module.Schematic })));
const TruthTable = lazy(() => import('./Table').then((module) => ({ default: module.TruthTable })));
const Matrix = lazy(() => import('./Matrix').then((module) => ({ default: module.Matrix })));
const Karnaugh = lazy(() => import('./Karnaugh').then((module) => ({ default: module.Karnaugh })));
const Timing = lazy(() => import('./Timing').then((module) => ({ default: module.Timing })));
const StateGraph = lazy(() => import('./StateGraph').then((module) => ({ default: module.StateGraph })));
const AnalogSchematic = lazy(() =>
  import('./AnalogSchematic').then((module) => ({ default: module.AnalogSchematic })),
);
const Chart = lazy(() => import('./Chart').then((module) => ({ default: module.Chart })));
const Mohr = lazy(() => import('./Mohr').then((module) => ({ default: module.Mohr })));

/** R-36 B2：图头给人话，不给学生念开发词。id 翻译表只收渲染侧真实用到的键；
 *  没收到的 id 不再裸奔英文，退回用 type 的中文（再没有就不显示）——
 *  data-spec-id / data-role 数据属性原样保留，门禁与自动化不受影响。 */
const SPEC_ID_LABELS: Record<string, string> = {
  internal: '内力图',
  checks: '校核表',
  pi: 'π 等效电路',
  'pi-n-gnd': 'π 等效电路（含发射极地）',
  thevenin: '戴维南等效',
  'small-signal': '小信号等效',
  'symbolic-equiv': '符号等效',
  deflection: '挠曲线',
  axial: '轴力图',
  shear: '剪力图',
  moment: '弯矩图',
  torque: '扭矩图',
  torsion: '扭转应力图',
  stress: '应力图',
  'section-stress': '弯曲应力图',
  stability: '临界力',
  react: '受力图',
  vectors: '矢量图',
  mohr: '莫尔圆',
  beam: '内力图',
  combined: '内力与应力',
  truth: '真值表',
  'truth-table': '真值表',
  'state-table': '状态表',
  states: '状态图',
  kmap: '卡诺图',
  wave: '波形图',
  'timing-sim': '时序仿真',
  numeric: '数制对照',
  'radix-convert': '数制转换',
  gain: '增益',
};
const SPEC_TYPE_LABELS: Record<string, string> = {
  schematic: '电路图',
  timing: '时序图',
  karnaugh: '卡诺图',
  state: '状态图',
  beam: '内力图',
  stress: '应力图',
  mohr: '莫尔圆',
  shaft: '扭矩图',
  truss: '桁架图',
  freebody: '受力图',
  table: '真值表',
  matrix: '数据表',
};
const specIdLabel = (id: string): string | undefined => SPEC_ID_LABELS[id];
const specTypeLabel = (type: string): string | undefined => SPEC_TYPE_LABELS[type];

const DIGITAL_KINDS = new Set(['and', 'or', 'not', 'xor', 'nand', 'nor', 'input', 'output']);
const ACCENT = 'var(--schematic-active)';
/** 零杆用赭色，和「当前步 / 选中」的钴蓝明确分开。 */
const ZERO_COLOR = 'var(--sch-live)';

const FIGURE_FALLBACK = (
  <div className="flex min-h-[200px] items-center justify-center text-xs text-muted">
    加载图形…
  </div>
);

export interface LiveSelection {
  row?: number;
  kmap?: { row: number; col: number };
  active?: Record<string, string[]>;
}

/** 装配台画布的交互契约：其余页面不传，SpecGrid 就还是纯只读渲染器。 */
export interface EditableCanvas {
  family: 'circuit' | 'beam';
  /** 可点引脚 / 结点 / 汇流条（世界坐标 + 中文名），由 clickableAnchors(graph) 给出。 */
  pins: { key: string; x: number; y: number; label?: string }[];
  /** 可拖动的节点热区（世界坐标）；composite 标记复合器件（双击摊开），selected 标多选。 */
  nodes: { id: string; x: number; y: number; composite?: boolean; selected?: boolean }[];
  /** 文字标注热区：点它要说「这是标注，不是电气点」。 */
  labels?: { id: string; x: number; y: number }[];
  /** 左下角选中态：`已选：Q · 基极 b` / `Q · 基极 b → Rc · 端 A`。 */
  statusText?: string;
  /** 第一个被选中的引脚 key（橡皮筋起点与高亮）。 */
  wireFirst: string | null;
  onWireClick: (hit: PointerHit) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeMoveEnd: () => void;
  onNodeMoveCancel: (id: string, x: number, y: number) => void;
  onAutoLayout: () => void;
  /** Shift+点击节点 → 多选（封装复合器件的选料方式，W13）。 */
  onSelectNode?: (nodeId: string) => void;
  /**
   * R3-4 U1：点电路器件本体 —— `PointerHit.body` 只带 kind 不带 id（老契约不动），
   * 面板要列引脚就得知道是哪一颗，所以单独给一条回调。
   */
  onBodyPinList?: (nodeId: string) => void;
  /** 双击复合器件 → 摊开（原生节点双击仍是自动整理）。 */
  onExpandComposite?: (nodeId: string) => void;
  /** W14：双击普通器件 → 焦点跳到左侧行（不是删除，避免误触）；没传则维持自动整理。 */
  onNodeFocusRow?: (nodeId: string) => void;
  /** W16 导线选中：可点线体（世界坐标折线，6px 容差）+ 当前选中 id。 */
  wires?: { id: string; points: [number, number][] }[];
  selectedWireId?: string | null;
  /** R-37 零杆高亮：需要描粗 + 打「零杆」标签的边 id（只画，不接收指针事件）。 */
  highlightWires?: string[];
  /** 点中线体 / 点空白取消选中。引脚热区优先级高于线体（先画线体后画引脚）。 */
  onSelectWire?: (edgeId: string | null) => void;
  /**
   * W17-C：力学族物件点选。普通点击节点 = 选物件（选中条说话）；
   * linkMode（加杆模式）或连线进行中（wireFirst）时仍走既有两次点击加杆。
   */
  linkMode?: boolean;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  /**
   * R3-4 U1：放置器。`tool !== 'off'` 时指针事件不再走「选中 / 拖动 / 连线」，
   * 而是把世界坐标交给页面去落条件；ghost 也由页面算好送进来 ——
   * **几何判断只有 place.ts 一处**，渲染层不参与「点到的是什么」。
   */
  place?: {
    tool: string;
    onHover: (x: number, y: number) => void;
    onHoverEnd: () => void;
    onPlaceDown: (x: number, y: number) => void;
    onPlaceUp: (x: number, y: number) => void;
    ghost: PlaceGhost | null;
  };
}

interface SpecGridProps {
  specs: RenderSpec[];
  stepIndex: number;
  liveSelection?: LiveSelection;
  editable?: boolean;
  canvas?: EditableCanvas;
}

interface FigureProps {
  spec: RenderSpec;
  stepIndex: number;
  liveSelection?: LiveSelection;
  canvas?: EditableCanvas;
}

/** 屏幕坐标 → SVG 用户坐标（ preserveAspectRatio 的变换已在 CTM 里）。 */
function clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): [number, number] {
  const matrix = svg.getScreenCTM();
  if (!matrix) return [clientX, clientY];
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(matrix.inverse());
  return [local.x, local.y];
}

type DragState = {
  pointerId: number;
  nodeId: string;
  nodeKind?: string;
  startX: number;
  startY: number;
  worldX: number;
  worldY: number;
  moved: boolean;
};

/**
 * 装配台专用的指针层：一次事件委托管引脚点击、橡皮筋、节点拖动。
 *
 * 电路点引脚（data-pin），力学点节点（data-node）—— 绝不提供「点器件本体连线」，
 * 因为多端子器件按中心连线会把 R1/R2/Rc/Re 画成短路。
 * 拖动只在 pointerup 时通知页面重算导线，过程中只搬坐标。
 */
function EditableLayer({ spec, canvas, children }: { spec: RenderSpec; canvas: EditableCanvas; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [viewBox, setViewBox] = useState('');
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [hoverPin, setHoverPin] = useState<string | null>(null);

  /** 主体 svg 的 viewBox 随节点坐标变化，overlay 必须同步，否则橡皮筋会偏。 */
  useEffect(() => {
    const svg = wrapRef.current?.querySelector<SVGSVGElement>('svg[role="img"]');
    if (svg) setViewBox(svg.getAttribute('viewBox') ?? '');
  }, [spec, canvas.pins]);

  const mainSvg = () => wrapRef.current?.querySelector<SVGSVGElement>('svg[role="img"]') ?? null;

  /** 放置器开着的时候，指针事件全归页面（选中 / 拖动 / 连线一律让路）。 */
  const placing = canvas.place !== undefined && canvas.place.tool !== 'off';

  const bounds = (): [number, number, number, number] => {
    const parts = (viewBox || '0 0 800 500').split(/\s+/).map(Number);
    return [parts[0], parts[1], parts[0] + parts[2], parts[1] + parts[3]];
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const svg = mainSvg();
    if (!svg) return;
    // R2-T1：只对画布区域拦掉原生拖选 / 文字选择（输入框在左栏，不受影响）——
    // 松手后浏览器拿选中文字去搜索（bing 搜索记录「固定铰 P = 150 kN」）就是这么来的。
    event.preventDefault();
    if (placing && canvas.place) {
      // R3-4 U1：按一下 = 落一个条件。命中判断统一按世界坐标走 place.ts，
      // 所以这里不查 data-pin / data-node（DOM 热区与几何口径两套会让「点哪算哪」失真）。
      const [wx, wy] = clientToWorld(svg, event.clientX, event.clientY);
      canvas.place.onPlaceDown(wx, wy);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 合成 pointer 事件没有活动指针，捕获会抛；松手仍由容器收。
      }
      return;
    }
    const target = event.target as Element;
    const pin = target.closest?.('[data-pin]');
    if (pin) {
      const key = pin.getAttribute('data-pin');
      if (key) canvas.onWireClick({ kind: 'pin', key });
      return;
    }
    const label = target.closest?.('[data-label]');
    if (label) {
      canvas.onWireClick({ kind: 'label' });
      return;
    }
    const node = target.closest?.('[data-node]');
    if (node) {
      const nodeId = node.getAttribute('data-node');
      const specNode = spec.nodes.find((one) => one.id === nodeId);
      if (!nodeId || !specNode) return;
      // Shift+点击 = 多选（封装复合器件的选料），不进入拖动。
      if (event.shiftKey && canvas.onSelectNode) {
        canvas.onSelectNode(nodeId);
        return;
      }
      const [wx, wy] = clientToWorld(svg, event.clientX, event.clientY);
      dragRef.current = {
        pointerId: event.pointerId,
        nodeId,
        nodeKind: specNode.kind,
        startX: specNode.x,
        startY: specNode.y,
        worldX: wx,
        worldY: wy,
        moved: false,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 合成 pointer / 无活动指针时 setPointerCapture 会抛；拖动本身仍可继续。
      }
      return;
    }
    if (canvas.wireFirst) canvas.onWireClick({ kind: 'blank' });
    else if (canvas.selectedWireId && canvas.onSelectWire) canvas.onSelectWire(null);
    else canvas.onNodeSelect?.(null);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const svg = mainSvg();
    if (!svg) return;
    const [wx, wy] = clientToWorld(svg, event.clientX, event.clientY);
    if (placing && canvas.place) {
      canvas.place.onHover(wx, wy);
      return;
    }
    if (canvas.wireFirst) setCursor([wx, wy]);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = wx - drag.worldX;
    const dy = wy - drag.worldY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const [minX, minY, maxX, maxY] = bounds();
    const x = Math.min(Math.max(snapGrid(drag.startX + dx), minX + 16), maxX - 16);
    const y = Math.min(Math.max(snapGrid(drag.startY + dy), minY + 16), maxY - 16);
    canvas.onNodeMove(drag.nodeId, x, y);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (placing && canvas.place) {
      const svg = mainSvg();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (svg) {
        const [wx, wy] = clientToWorld(svg, event.clientX, event.clientY);
        canvas.place.onPlaceUp(wx, wy);
      }
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setCursor(null);
    if (!drag) return;
    if (drag.moved) {
      canvas.onNodeMoveEnd();
      return;
    }
    if (canvas.family === 'beam') {
      // W17-C：加杆模式 / 连线进行中 → 两次点击加杆（现状）；否则普通点击 = 选物件。
      if (canvas.linkMode || canvas.wireFirst) {
        canvas.onWireClick({ kind: 'node', key: `${drag.nodeId}:center` });
      } else if (canvas.onNodeSelect) {
        canvas.onNodeSelect(drag.nodeId);
      } else {
        canvas.onWireClick({ kind: 'node', key: `${drag.nodeId}:center` });
      }
    } else {
      // 电路器件本体不是端点：只提示一次，不取消已选中的第一个引脚；
      // R3-4 U1 起再把它的引脚名列出来（点名字就起线）。
      canvas.onWireClick({ kind: 'body', nodeKind: drag.nodeKind });
      canvas.onBodyPinList?.(drag.nodeId);
    }
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // 放置器开着时双击没有语义（容易误触自动整理），直接让路。
    if (placing) return;
    const node = (event.target as Element).closest?.('[data-node]');
    if (!node) return;
    const nodeId = node.getAttribute('data-node');
    const canvasNode = canvas.nodes.find((one) => one.id === nodeId);
    // 双击复合器件 → 摊开；普通器件 → 焦点到左侧行（W14，页面找不到行就自然无操作）；没给回调才退回自动整理。
    if (canvasNode?.composite && canvas.onExpandComposite && nodeId) {
      canvas.onExpandComposite(nodeId);
      return;
    }
    if (canvasNode && nodeId && canvas.onNodeFocusRow) {
      canvas.onNodeFocusRow(nodeId);
      return;
    }
    canvas.onAutoLayout();
  };

  /** Esc 取消本次拖动，回到按下时的坐标。 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const drag = dragRef.current;
      if (!drag) return;
      canvas.onNodeMoveCancel(drag.nodeId, drag.startX, drag.startY);
      dragRef.current = null;
      setCursor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvas]);

  const ghost = canvas.place?.ghost ?? null;
  const ghostWire = ghost?.edgeId ? (canvas.wires ?? []).find((wire) => wire.id === ghost.edgeId) : undefined;
  const ghostDir = ((ghost?.dir ?? 0) * Math.PI) / 180;
  const ghostUx = Math.sin(ghostDir);
  const ghostUy = Math.cos(ghostDir);
  const ghostX = ghost?.point.x ?? 0;
  const ghostY = ghost?.point.y ?? 0;
  /** 杆上的刻度线：垂直于杆身的小短线 —— 「t 落在这里」的可见证据。 */
  const ghostTick = (() => {
    if (!ghostWire || !ghost || ghost.t === undefined) return null;
    const p0 = ghostWire.points[0];
    const p1 = ghostWire.points[ghostWire.points.length - 1];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const nx = -(p1[1] - p0[1]) / len;
    const ny = (p1[0] - p0[0]) / len;
    return (
      <line x1={ghostX - nx * 9} y1={ghostY - ny * 9} x2={ghostX + nx * 9} y2={ghostY + ny * 9} stroke={ACCENT} strokeWidth={1.6} />
    );
  })();

  const first = canvas.wireFirst ? canvas.pins.find((pin) => pin.key === canvas.wireFirst) : undefined;
  // W17-C：力学族杆线体热区要画在节点拖动圆点**之下**（节点在杆的端点上，
  // 热区重叠时点节点必须选中物件而不是杆）；电路族维持 W16 顺序（引脚最上）。
  const beamFamily = canvas.family === 'beam';
  const memberHits = (canvas.wires ?? []).map((wire) => (
    <path
      key={`hit-${wire.id}`}
      d={`M ${wire.points.map(([x, y]) => `${x} ${y}`).join(' L ')}`}
      stroke="transparent"
      strokeWidth={6}
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
      className="pointer-events-auto cursor-pointer"
      onPointerDown={(event) => {
        // 放置器模式下杆身点击交给容器的几何口径（12 单位容差比这条 6px 热区宽），
        // 否则「差一两个像素点不到」的老毛病还在。
        if (placing) return;
        event.stopPropagation();
        canvas.onSelectWire?.(wire.id);
      }}
    />
  ));

  return (
    <div
      ref={wrapRef}
      className="relative select-none"
      style={{ touchAction: 'none', WebkitUserDrag: 'none' } as React.CSSProperties}
      // R2-T1：可拖元素是 SVG 图元（不走 HTML5 drag API，draggable 属性不适用），
      // 原生 dragstart 会冒泡到容器 —— 在容器上拦掉，配合 pointerdown preventDefault 双保险。
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => canvas.place?.onHoverEnd()}
      onDoubleClick={onDoubleClick}
    >
      {children}
      {viewBox ? (
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute inset-0 h-full w-full"
          role="presentation"
          aria-hidden="true"
        >
          {/* 文字标注热区：点它不是电气点，要明确说话（不是静默取消） */}
          {(canvas.labels ?? []).map((label) => (
            <rect
              key={label.id}
              data-label={label.id}
              x={label.x - 60}
              y={label.y - 12}
              width={120}
              height={24}
              fill="transparent"
              className="pointer-events-auto cursor-help"
            />
          ))}
          {beamFamily ? memberHits : null}
          {/* R-37 零杆高亮：描粗 + 标签，pointerEvents=none 不抢点选 / 拖动。 */}
          {(canvas.highlightWires?.length ?? 0) > 0 ? (
            <g pointerEvents="none" data-testid="zero-member-highlight">
              {(canvas.wires ?? [])
                .filter((wire) => canvas.highlightWires?.includes(wire.id) && wire.points.length >= 2)
                .map((wire) => {
                  const a = wire.points[0];
                  const b = wire.points[wire.points.length - 1];
                  return (
                    <g key={wire.id}>
                      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={ZERO_COLOR} strokeWidth={12} strokeLinecap="round" opacity={0.3} />
                      <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 14} textAnchor="middle" fontSize={13} fill={ZERO_COLOR}>零杆</text>
                    </g>
                  );
                })}
            </g>
          ) : null}
          {/* 拖动热区（在引脚下面，点击引脚时会优先命中 data-pin） */}
          {canvas.nodes.map((node) => (
            <circle
              key={node.id}
              data-node={node.id}
              cx={node.x}
              cy={node.y}
              r={18}
              fill="transparent"
              className="pointer-events-auto cursor-move"
            />
          ))}
          {/* 多选高亮：封装复合器件的选料反馈 */}
          {canvas.nodes
            .filter((node) => node.selected)
            .map((node) => (
              <circle
                key={`sel-${node.id}`}
                cx={node.x}
                cy={node.y}
                r={26}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.8}
              />
            ))}
          {/* 橡皮筋：从选中的第一个引脚拉到光标 */}
          {first && cursor ? (
            <path
              d={`M ${first.x} ${first.y} L ${cursor[0]} ${cursor[1]}`}
              stroke={ACCENT}
              strokeWidth={2}
              strokeDasharray="6 5"
              opacity={0.65}
              fill="none"
            />
          ) : null}
          {/* W16 导线选中：透明 6px 线体热区（在引脚圆点之前渲染，引脚优先命中）；
              选中的线加一条 2.2px 青色高亮描边。 */}
          {!beamFamily ? memberHits : null}
          {(canvas.wires ?? [])
            .filter((wire) => wire.id === canvas.selectedWireId)
            .map((wire) => (
              <path
                key={`sel-${wire.id}`}
                d={`M ${wire.points.map(([x, y]) => `${x} ${y}`).join(' L ')}`}
                stroke={ACCENT}
                strokeWidth={2.2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            ))}
          {/* R3-4 U1：放置器 ghost —— 杆身加粗 + t 刻度 + 箭头 / 空圈 / 引脚环。
              几何全由页面（place.ts）算好，这里只画。 */}
          {ghost ? (
            <g data-testid="place-ghost" data-kind={ghost.kind} pointerEvents="none">
              {ghostWire ? (
                <path
                  d={`M ${ghostWire.points.map(([x, y]) => `${x} ${y}`).join(' L ')}`}
                  stroke={ACCENT}
                  strokeWidth={2.6}
                  opacity={0.62}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {ghostTick}
              {ghost.dir !== undefined && (ghost.kind === 'member' || ghost.kind === 'joint') ? (
                <g stroke={ACCENT} strokeWidth={1.8} fill="none" opacity={0.9}>
                  <line
                    x1={ghostX - ghostUx * 36}
                    y1={ghostY - ghostUy * 36}
                    x2={ghostX - ghostUx * 3}
                    y2={ghostY - ghostUy * 3}
                  />
                  <path
                    d={`M ${ghostX - ghostUx * 3} ${ghostY - ghostUy * 3} L ${ghostX - ghostUx * 12 + ghostUy * 5} ${ghostY - ghostUy * 12 - ghostUx * 5}`}
                  />
                  <path
                    d={`M ${ghostX - ghostUx * 3} ${ghostY - ghostUy * 3} L ${ghostX - ghostUx * 12 - ghostUy * 5} ${ghostY - ghostUy * 12 + ghostUx * 5}`}
                  />
                </g>
              ) : null}
              {ghost.kind === 'blank' ? (
                <circle cx={ghostX} cy={ghostY} r={9} fill="none" stroke={ACCENT} strokeWidth={1.4} strokeDasharray="3 3" />
              ) : null}
              {ghost.kind === 'joint' ? (
                <circle cx={ghostX} cy={ghostY} r={13} fill="none" stroke={ACCENT} strokeWidth={1.6} strokeDasharray="3 3" />
              ) : null}
              {(ghost.pins ?? []).map((pin) => (
                <circle key={`ghost-pin-${pin.key}`} cx={pin.x} cy={pin.y} r={8} fill="none" stroke={ACCENT} strokeWidth={1.6} />
              ))}
              {(ghost.candidates ?? []).map((one, index) => (
                <circle
                  key={`ghost-cand-${index}`}
                  cx={one.x}
                  cy={one.y}
                  r={11}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              ))}
            </g>
          ) : null}
          {/* 引脚可点圆点：W22-D F7 热区 r 6→8（对角线容差加大），
              hover 放大到 9 并变青；选中实心上色。z 序：本组最后渲染 = 恒在导线热区之上。 */}
          {canvas.pins.map((pin) => {
            const selected = pin.key === canvas.wireFirst;
            const hovered = pin.key === hoverPin;
            return (
              <circle
                key={pin.key}
                data-pin={pin.key}
                data-pin-name={pin.label ?? ''}
                cx={pin.x}
                cy={pin.y}
                r={selected || hovered ? 9 : 8}
                fill={selected ? ACCENT : 'transparent'}
                stroke={selected || hovered ? ACCENT : 'var(--schematic-idle)'}
                strokeWidth={selected || hovered ? 2 : 1}
                opacity={selected || hovered ? 1 : 0.45}
                className="pin-hit pointer-events-auto cursor-crosshair"
                onPointerEnter={() => setHoverPin(pin.key)}
                onPointerLeave={() => setHoverPin((current) => (current === pin.key ? null : current))}
              >
                <title>{pin.label ?? pin.key}</title>
              </circle>
            );
          })}
        </svg>
      ) : null}
      {canvas.place && canvas.place.tool !== 'off' && canvas.place.ghost?.text ? (
        <div
          data-testid="place-hint"
          className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] leading-4 text-cyan shadow"
        >
          {canvas.place.ghost.text}
          {canvas.place.ghost.hint ? <span className="ml-1 text-muted">· {canvas.place.ghost.hint}</span> : null}
        </div>
      ) : null}
      {hoverPin ? (
        <div data-testid="pin-hover" className="pointer-events-none absolute right-2 top-2 rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] text-cyan shadow">
          {canvas.pins.find((pin) => pin.key === hoverPin)?.label ?? hoverPin}
        </div>
      ) : null}
      {canvas.statusText ? (
        <div data-testid="pin-status" className="pointer-events-none absolute bottom-2 left-2 rounded-lg border border-cyan/50 bg-panel px-2 py-1 text-[11px] text-cyan shadow">
          {canvas.statusText}
        </div>
      ) : null}
    </div>
  );
}

function Figure({ spec, stepIndex, liveSelection, canvas }: FigureProps) {
  const frame = spec.frames.find((item) => item.stepIndex === stepIndex);
  const activeIds = new Set([
    ...(frame?.activeEdges ?? []),
    ...(frame?.activeNodes ?? []),
    ...(liveSelection?.active?.[spec.id] ?? []),
  ]);
  const labels = new Map((frame?.labels ?? []).map((item) => [item.id, item.text]));

  let body: ReactNode;
  if (spec.type === 'schematic') {
    // 除数字门电路外，一律走模拟电路渲染器（符号表 symbols.ts 才是唯一判据，
    // 以前这里写死了一份 'R'/'NPN' 大写字面量清单，改了符号名就再也进不来）。
    const analog = spec.nodes.some((node) => !DIGITAL_KINDS.has(node.kind));
    body = (
      <div className="schematic-frame h-[420px] w-full">
        {analog ? (
          <AnalogSchematic spec={spec} activeIds={activeIds} labels={labels} />
        ) : (
          <Schematic
            spec={spec}
            activeIds={activeIds}
            labels={labels}
            liveIds={new Set(liveSelection?.active?.[spec.id] ?? [])}
          />
        )}
      </div>
    );
  } else if (spec.type === 'table') {
    body = <TruthTable spec={spec} highlightRow={liveSelection?.row} />;
  } else if (spec.type === 'matrix') {
    body = <Matrix spec={spec} />;
  } else if (spec.type === 'karnaugh') {
    body = <Karnaugh spec={spec} highlightCell={liveSelection?.kmap} />;
  } else if (spec.type === 'timing') {
    body = <Timing spec={spec} />;
  } else if (spec.type === 'state') {
    body = <StateGraph spec={spec} activeIds={activeIds} />;
  } else if (spec.type === 'freebody' || spec.type === 'truss') {
    // 受力图 / 桁架 / 矢量图：有 chart 的走坐标图引擎（矢量合成、P–α 曲线），
    // 其余复用同一套 schematic 渲染器（支座/杆件/载荷都是符号表里的图元）。
    body = spec.chart ? (
      <Chart spec={spec.chart} />
    ) : (
      /* W21-B B1 红线声明：画布 fit-to-content 的容器高度只在这里定义。
       * freebody / truss 是宽扁图（梁），给 280px；schematic 方形图给 420px。
       * 只改这一行 className，不动 place 契约 / 指针层 / 快照数据。 */
      <div className={`schematic-frame w-full ${spec.type === 'freebody' || spec.type === 'truss' ? 'h-[clamp(320px,42vh,520px)]' : 'h-[420px]'}`}>
        <AnalogSchematic spec={spec} activeIds={activeIds} labels={labels} />
      </div>
    );
  } else if (spec.type === 'beam' || spec.type === 'shaft' || spec.type === 'stress') {
    body = spec.chart ? (
      <Chart spec={spec.chart} />
    ) : (
      <div className="flex min-h-[160px] items-center justify-center text-sm text-muted">
        {spec.type} 图缺少 chart 数据
      </div>
    );
  } else if (spec.type === 'mohr') {
    body = spec.mohr ? (
      <div className="flex justify-center">
        <Mohr spec={spec.mohr} />
      </div>
    ) : (
      <div className="flex min-h-[160px] items-center justify-center text-sm text-muted">
        mohr 图缺少 mohr 数据
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-[200px] items-center justify-center px-4 text-center text-sm text-muted">
        render/{spec.type} 在 P2+ 接入；P1 只读外壳不伪造图。
      </div>
    );
  }

  return (
    <figure
      data-spec-id={spec.id}
      data-role={spec.role}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel-2"
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-xs">
        <span className="flex items-center gap-2">
          <span className="rounded border border-line px-1.5 py-0.5 text-muted">
            {spec.role === 'primary' ? '主图' : '辅图'}
          </span>
          {/* R-36 B2：图头不再对学生念开发词（main / freebody / primary）。
              id 翻人话（未知 id 原样兜底，自建图元的名字不受影响）；type 只在
              与 id 不同义时补一句中文；右侧裸 role（primary/secondary）删掉 ——
              和左边的「主图 / 辅图」徽标重复。data-spec-id / data-role 保留，
              门禁与自动化照旧走数据层。 */}
          {spec.id === 'main'
            ? null
            : specIdLabel(spec.id)
              ? <span className="text-ink">{specIdLabel(spec.id)}</span>
              : specTypeLabel(spec.type)
                ? <span className="text-ink">{specTypeLabel(spec.type)}</span>
                : null}
          {spec.derivedFrom ? (
            <span className="text-muted">← 由{SPEC_ID_LABELS[spec.derivedFrom] ?? '原图'}推导</span>
          ) : null}
        </span>
      </figcaption>
      <div className="min-w-0 flex-1 p-3">
        <Suspense fallback={FIGURE_FALLBACK}>
          {canvas ? <EditableLayer spec={spec} canvas={canvas}>{body}</EditableLayer> : body}
        </Suspense>
        {spec.type === 'matrix' ? (
          <p className="mt-2 text-[10px] text-muted">表格对照：本图种无图内高亮</p>
        ) : null}
      </div>
    </figure>
  );
}

/** 多图按 role 排版：主图占满中栏，辅图并排（>1）或整行放主图下方。 */
export function SpecGrid({ specs, stepIndex, liveSelection, editable = false, canvas }: SpecGridProps) {
  const primary = specs.filter((spec) => spec.role === 'primary');
  const secondary = specs.filter((spec) => spec.role === 'secondary');

  if (specs.length === 0) {
    return <p className="p-6 text-sm text-muted">这份解答没有 render_specs。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {primary.map((spec, index) => (
        <Figure
          key={spec.id}
          spec={spec}
          stepIndex={stepIndex}
          liveSelection={liveSelection}
          canvas={editable && index === 0 ? canvas : undefined}
        />
      ))}
      {secondary.length > 0 ? (
        // 坐标图 / 校验表都是「信息密度高、宽度敏感」的图：只要有一张 chart，辅图就整行铺开，
        // 否则双联图会被压进半栏，刻度和标注全糊在一起。
        <div
          className={
            secondary.length > 1 && !secondary.some((spec) => spec.chart)
              ? 'grid gap-4 xl:grid-cols-2'
              : 'grid gap-4'
          }
        >
          {secondary.map((spec) => (
            <Figure key={spec.id} spec={spec} stepIndex={stepIndex} liveSelection={liveSelection} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
