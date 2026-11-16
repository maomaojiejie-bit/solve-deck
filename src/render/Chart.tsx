/**
 * 坐标图引擎：把 ChartSpec 画成 SVG（Q/M 图、轴力图、扭矩图、应力分布、挠曲线）。
 *
 * 三条硬规矩（由 scripts/check-chart.mjs 机械判定）：
 *  1. yDomain 必须覆盖全部采样点 —— 这里不裁剪、不「自动放大」，超出就画到框外；
 *  2. marks 的 (x, y) 由 solver 给，渲染层只负责落点，绝不另算一个「好看的」数；
 *  3. panels 共享同一条 x 轴，只有最后一张画 x 刻度。
 *
 * 曲线用采样点直连（step 用水平+垂直），不做拟合。
 */

import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ChartSpec, ChartSeries } from '../core/types';
import { visiblePanels, flatZeroPanels } from '../core/chartPanels.ts';

const W = 760;
const PAD_LEFT = 58;
const PAD_RIGHT = 22;
const PANEL_H = 132;
const GAP = 30;
const PAD_TOP = 44;

const LINE = 'var(--schematic-idle)';
const ACCENT = 'var(--schematic-active)';
const TEXT = 'var(--schematic-text)';

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1000 || abs < 0.01) return value.toExponential(1);
  return String(Number(value.toPrecision(3)));
}

/** 面板内部坐标映射。 */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xs: (v: number) => number;
  ys: (v: number) => number;
}

function box(spec: ChartSpec, top: number): Box {
  const x0 = PAD_LEFT;
  const x1 = W - PAD_RIGHT;
  const y0 = top;
  const y1 = top + PANEL_H;
  const [dx0, dx1] = spec.xDomain;
  const [dy0, dy1] = spec.yDomain;
  const spanX = dx1 - dx0 || 1;
  const spanY = dy1 - dy0 || 1;
  return {
    x0,
    x1,
    y0,
    y1,
    xs: (v: number) => x0 + ((v - dx0) / spanX) * (x1 - x0),
    ys: (v: number) => y1 - ((v - dy0) / spanY) * (y1 - y0),
  };
}

function seriesPath(series: ChartSeries, b: Box): string {
  const pts = series.points;
  if (pts.length === 0) return '';
  if (series.kind === 'step') {
    let d = `M ${b.xs(pts[0][0])} ${b.ys(pts[0][1])}`;
    for (let i = 1; i < pts.length; i += 1) {
      const previous = pts[i - 1];
      const [x, y] = pts[i];
      d += ` L ${b.xs(x)} ${b.ys(previous[1])} L ${b.xs(x)} ${b.ys(y)}`;
    }
    return d;
  }
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${b.xs(x)} ${b.ys(y)}`).join(' ');
}

function areaPath(series: ChartSeries, b: Box): string {
  const pts = series.points;
  if (pts.length === 0) return '';
  const zero = Math.min(Math.max(0, b.y0), b.y1);
  const last = pts[pts.length - 1];
  const first = pts[0];
  return `${seriesPath(series, b)} L ${b.xs(last[0])} ${zero} L ${b.xs(first[0])} ${zero} Z`;
}

/** 等分刻度：只在整齐刻度落不进域内时兜底用。 */
function evenTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(min + (span * i) / count);
  return out;
}

/** 1 / 2 / 2.5 / 5 × 10ⁿ 的刻度步长。 */
function niceStep(span: number, target: number): number {
  const rough = span / Math.max(target, 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/**
 * 整齐刻度（-10 / 0 / 10，而不是 11.6 / 4.2 / -1.6）。
 * 只取落在域内的整数倍刻度；域太窄取不满 3 条时才退回等分。
 * 刻度值不写进 spec（spec 只存 domain），所以换刻度不动快照。
 */
function ticks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  const step = niceStep(span, target);
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let i = first; i <= last; i += 1) out.push(Number((i * step).toPrecision(12)));
  return out.length >= 3 ? out : evenTicks(min, max, 4);
}

/** 约定文案折行：优先在「、，；。　空格」处断，别把「[δ]=L/400」劈成两行。 */
function wrap(text: string, width: number): string[] {
  const BREAK = '、，；。　 ';
  const lines: string[] = [];
  let rest = text;
  while (rest.length > width) {
    let cut = -1;
    for (let i = width; i >= Math.max(1, width - 10); i -= 1) {
      if (BREAK.includes(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = width;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) lines.push(rest);
  return lines.slice(0, 5);
}

type MarkSide = 'up' | 'down' | 'left' | 'right';

interface Placed {
  tx: number;
  ty: number;
  anchor: 'start' | 'middle' | 'end';
}

/**
 * 标注落位。极值落在面板顶边/底边时改往反方向写，否则文字被面板边框压住；
 * 四个方向都塞不下才夹回框内。**只动文字落点，mark 的 (x, y) 一个数都不改**，
 * 所以 check:chart ②「标注必须落在曲线上」照样成立。
 */
function placeMark(b: Box, cx: number, cy: number, text: string, side: MarkSide): Placed {
  const width = text.length * 5.9;
  const nearBottom = cy > b.y1 - 26;
  const nearTop = cy < b.y0 + 24;
  const order: MarkSide[] = [];
  const push = (item: MarkSide) => {
    if (!order.includes(item)) order.push(item);
  };
  if (nearBottom) {
    push('up');
    push('right');
    push('left');
    push('down');
  } else if (nearTop) {
    push('down');
    push('right');
    push('left');
    push('up');
  } else {
    push(side);
    push('up');
    push('down');
    push('right');
    push('left');
  }

  const geo = (item: MarkSide): Placed => {
    if (item === 'down') return { tx: cx, ty: cy + 15, anchor: 'middle' };
    if (item === 'left') return { tx: cx - 9, ty: cy + 4, anchor: 'end' };
    if (item === 'right') return { tx: cx + 9, ty: cy + 4, anchor: 'start' };
    return { tx: cx, ty: cy - 8, anchor: 'middle' };
  };

  const adjust = (placed: Placed): Placed => {
    const next = { ...placed };
    if (next.anchor === 'middle') {
      if (next.tx - width / 2 < b.x0 + 2) {
        next.anchor = 'start';
        next.tx = cx + 6;
      } else if (next.tx + width / 2 > b.x1 - 2) {
        next.anchor = 'end';
        next.tx = cx - 6;
      }
    }
    return next;
  };

  const inside = (placed: Placed): boolean => {
    const left = placed.tx - (placed.anchor === 'middle' ? width / 2 : placed.anchor === 'end' ? width : 0);
    const right = placed.tx + (placed.anchor === 'middle' ? width / 2 : placed.anchor === 'start' ? width : 0);
    return (
      placed.ty >= b.y0 + 11 &&
      placed.ty <= b.y1 - 3 &&
      left >= b.x0 + 2 &&
      right <= b.x1 - 2
    );
  };

  for (const item of order) {
    const placed = adjust(geo(item));
    if (inside(placed)) return placed;
  }
  const fallback = adjust(geo(order[0]));
  return { ...fallback, ty: Math.min(Math.max(fallback.ty, b.y0 + 11), b.y1 - 3) };
}

function Panel({
  spec,
  top,
  showX,
  compact,
}: {
  spec: ChartSpec;
  top: number;
  showX: boolean;
  compact: boolean;
}) {
  const b = box(spec, top);
  const [dy0, dy1] = spec.yDomain;
  const zero = 0 >= dy0 && 0 <= dy1 ? b.ys(0) : null;

  return (
    <g data-panel={spec.id}>
      <rect
        x={b.x0}
        y={b.y0}
        width={b.x1 - b.x0}
        height={b.y1 - b.y0}
        fill="none"
        stroke={LINE}
        strokeOpacity={0.35}
        strokeWidth={1}
      />

      {ticks(dy0, dy1, 5).map((value) => (
        <g key={`y${value}`}>
          <line
            x1={b.x0}
            x2={b.x1}
            y1={b.ys(value)}
            y2={b.ys(value)}
            stroke={LINE}
            strokeOpacity={0.12}
            strokeDasharray="2 4"
          />
          <text
            x={b.x0 - 8}
            y={b.ys(value) + 3.5}
            textAnchor="end"
            fontSize={9.5}
            fill={TEXT}
            fillOpacity={0.72}
          >
            {fmt(value)}
          </text>
        </g>
      ))}

      {showX
        ? ticks(spec.xDomain[0], spec.xDomain[1], 6).map((value) => (
            <g key={`x${value}`}>
              <line
                x1={b.xs(value)}
                x2={b.xs(value)}
                y1={b.y0}
                y2={b.y1}
                stroke={LINE}
                strokeOpacity={0.12}
                strokeDasharray="2 4"
              />
              <text
                x={b.xs(value)}
                y={b.y1 + 14}
                textAnchor="middle"
                fontSize={9.5}
                fill={TEXT}
                fillOpacity={0.72}
              >
                {fmt(value)}
              </text>
            </g>
          ))
        : null}

      {zero !== null ? (
        <line
          x1={b.x0}
          x2={b.x1}
          y1={zero}
          y2={zero}
          stroke={TEXT}
          strokeOpacity={0.55}
          strokeWidth={1}
        />
      ) : null}

      <line x1={b.x0} x2={b.x0} y1={b.y0} y2={b.y1} stroke={TEXT} strokeOpacity={0.55} strokeWidth={1} />

      {spec.series.map((series, index) =>
        series.fill || series.kind === 'area' ? (
          <path
            key={`a${index}`}
            d={areaPath(series, b)}
            fill={ACCENT}
            fillOpacity={0.12}
            stroke="none"
          />
        ) : null,
      )}

      {spec.series.map((series, index) => (
        <path
          key={`s${index}`}
          d={seriesPath(series, b)}
          fill="none"
          stroke={index === 0 ? ACCENT : LINE}
          strokeWidth={1.8}
          strokeLinejoin="round"
          // 第 2 条起画虚线：分量 / 参考线不能和主曲线糊成一条
          strokeDasharray={index === 0 ? undefined : '4 3'}
        />
      ))}

      {/* 矢量图的箭头：末端三角，方向取自最后两个采样点 */}
      {spec.series.map((series, index) => {
        if (!series.arrow || series.points.length < 2) return null;
        const n = series.points.length;
        const [x1, y1] = series.points[n - 1];
        const [x0, y0] = series.points[n - 2];
        const tip = [b.xs(x1), b.ys(y1)];
        const tail = [b.xs(x0), b.ys(y0)];
        const dx = tip[0] - tail[0];
        const dy = tip[1] - tail[1];
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const size = 7;
        const back = [tip[0] - ux * size, tip[1] - uy * size];
        const side = [(-uy * size) / 2, (ux * size) / 2];
        const points = [
          `${tip[0]},${tip[1]}`,
          `${back[0] - side[0]},${back[1] - side[1]}`,
          `${back[0] + side[0]},${back[1] + side[1]}`,
        ].join(' ');
        return (
          <polygon
            key={`h${index}`}
            points={points}
            fill={index === 0 ? ACCENT : LINE}
            stroke="none"
          />
        );
      })}

      {/* 轴标签只放单位、标题只放中文名：两者都写符号会拼成「Q (kN) 剪力图 Q(x) (kN)」。 */}
      <text x={b.x0 - 8} y={b.y0 - 8} textAnchor="end" fontSize={9.5} fill={TEXT} fillOpacity={0.65}>
        {spec.yLabel}
      </text>
      <text x={b.x0} y={b.y0 - 8} fontSize={10.5} fill={TEXT}>
        {spec.title}
      </text>
      {showX && !compact ? (
        <text x={(b.x0 + b.x1) / 2} y={b.y1 + 26} textAnchor="middle" fontSize={10} fill={TEXT} fillOpacity={0.8}>
          {spec.xLabel}
        </text>
      ) : null}

      {(spec.marks ?? []).map((mark, index) => {
        const cx = b.xs(mark.x);
        const cy = b.ys(mark.y);
        const placed = placeMark(b, cx, cy, mark.text, mark.side ?? 'up');
        return (
          <g key={`m${index}`} data-mark={mark.text}>
            <circle cx={cx} cy={cy} r={2.6} fill={ACCENT} />
            {/* 文字带描边底：标注压在曲线上时仍然读得清（不移动任何数值） */}
            <text
              x={placed.tx}
              y={placed.ty}
              textAnchor={placed.anchor}
              fontSize={10}
              fill={ACCENT}
              stroke="var(--color-panel, #ffffff)"
              strokeWidth={3}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {mark.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * 探针读数：在**已有的采样点**上取值，绝不另算一套数。
 * - `step` 序列（剪力图那种阶跃）取左端值，和画出来的水平段一致；
 * - `line` 序列做线性插值，和画出来的折线一致；
 * - 多条序列的面板（挠曲线 v/θ、应力分量）逐条给值，最多 3 条，不做任何合成。
 */
function probeSeries(panel: ChartSpec, x: number): number[] {
  const series = panel.series ?? [];
  const out: number[] = [];
  for (const one of series.slice(0, 3)) {
    const pts = one.points;
    if (!pts || pts.length === 0) continue;
    if (x <= pts[0][0]) {
      out.push(pts[0][1]);
      continue;
    }
    const last = pts[pts.length - 1];
    if (x >= last[0]) {
      out.push(last[1]);
      continue;
    }
    let value = last[1];
    for (let i = 1; i < pts.length; i += 1) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        if (one.kind === 'step') value = y0;
        else {
          const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
          value = y0 + (y1 - y0) * t;
        }
        break;
      }
    }
    out.push(value);
  }
  return out;
}

/** 面板短名：标题去掉括号里的符号（中英文括号都去），避免读数条太长。 */
function shortTitle(panel: ChartSpec): string {
  return (panel.title ?? '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .slice(0, 8);
}

/** 一条 ChartSpec（可含 panels）→ 一张 SVG。 */
export function Chart({ spec }: { spec: ChartSpec }) {
  // 探针：指针所在的 x（数据域坐标）。hooks 必须排在下面「全是零 → 空态早退」之前。
  const [probeX, setProbeX] = useState<number | null>(null);
  const panels = visiblePanels(spec);
  // W21-C C0-3：被判恒零的面板不出轴，改出一行灰字（面板数 ≥1 时也照给）。
  const hidden = flatZeroPanels(spec);
  // W21-B B1：N(x)≡0（或所有分量恒 0）不画零信息直线，如实给一句人话。
  if (panels.length === 0) {
    return (
      <p data-testid="flat-zero-chart" className="p-4 text-center text-[12px] text-muted">
        这张图的各内力分量恒为 0，不渲染零信息图。
      </p>
    );
  }
  const compact = panels.length > 1;
  const heights = panels.map((_, index) => PAD_TOP + index * (PANEL_H + GAP));
  const height = PAD_TOP + panels.length * PANEL_H + (panels.length - 1) * GAP + 46;
  const convention = spec.panels?.[0]?.convention ?? spec.convention;
  const convLines = convention ? wrap(convention, 30) : [];
  const convW = 190;

  // 指针 → 数据域 x。用第一张面板的盒子做换算，各面板共享同一条 x 刻度。
  const firstBox = box(panels[0], heights[0]);
  const [fx0, fx1] = panels[0].xDomain;
  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    if (px < firstBox.x0 - 2 || px > firstBox.x1 + 2) {
      setProbeX(null);
      return;
    }
    const ratio = Math.min(1, Math.max(0, (px - firstBox.x0) / (firstBox.x1 - firstBox.x0 || 1)));
    setProbeX(fx0 + ratio * (fx1 - fx0));
  };
  const handleLeave = () => setProbeX(null);

  /** 一行读数：`x = 2.12 · 剪力图 10 kN · 弯矩图 18.8 kN·m`。 */
  const probeReadout =
    probeX === null
      ? ''
      : [
          `x = ${fmt(probeX)}`,
          ...panels.map((panel) => {
            if (probeX < panel.xDomain[0] || probeX > panel.xDomain[1]) return '';
            const values = probeSeries(panel, probeX);
            if (values.length === 0) return '';
            const text = values.map((value) => fmt(value)).join(' / ');
            return `${shortTitle(panel)} ${text}${panel.unit ? ` ${panel.unit}` : panel.yLabel ? ` ${panel.yLabel}` : ''}`;
          }),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <svg
      viewBox={`0 0 ${W} ${height + (hidden.length > 0 ? 18 : 0)}`}
      className="h-auto w-full"
      role="img"
      aria-label={`chart ${spec.id}`}
      style={{ minHeight: 160, cursor: 'crosshair' }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
    >
      {panels.map((panel, index) => (
        <Panel
          key={`${panel.id}-${index}`}
          spec={panel}
          top={heights[index]}
          showX={index === panels.length - 1}
          compact={compact}
        />
      ))}
      {hidden.map((panel, index) => (
        <text
          key={`flat-${panel.id}-${index}`}
          data-testid="flat-zero-note"
          data-flat-panel={panel.id}
          x={PAD_LEFT}
          y={PAD_TOP + panels.length * PANEL_H + (panels.length - 1) * GAP + 30 + index * 14}
          fontSize={10.5}
          fill={TEXT}
          fillOpacity={0.55}
        >
          本图该内力恒为 0（{panel.title.replace(/（[^）]*）/g, '')}）· 不画空轴
        </text>
      ))}

      {convLines.length > 0 ? (
        <g data-convention="1">
          <rect
            x={W - PAD_RIGHT - convW}
            y={2}
            width={convW}
            height={12 + convLines.length * 12}
            rx={4}
            fill="var(--color-panel-2, transparent)"
            fillOpacity={0.85}
            stroke={LINE}
            strokeOpacity={0.5}
          />
          {convLines.map((line, index) => (
            <text
              key={line + index}
              x={W - PAD_RIGHT - convW + 8}
              y={16 + index * 12}
              fontSize={9.5}
              fill={TEXT}
              fillOpacity={0.85}
            >
              {line}
            </text>
          ))}
        </g>
      ) : null}

      {/*
        探针：一条竖线贯穿所有面板，曲线上的点标出「读的是哪一处」，读数统一放在左上角。
        数值全部取自「画出来的同一批采样点」（probeValue），不另算一套账，所以图上看到什么、读数就是什么。
        读数条固定位置而不是跟着指针跑 —— 跟着跑会盖住曲线上的极值标注（|M|max 那类）。
      */}
      {probeX !== null ? (
        <g data-probe="1" pointerEvents="none">
          {panels.map((panel, index) => {
            const panelBox = box(panel, heights[index]);
            const [px0, px1] = panel.xDomain;
            if (probeX < px0 || probeX > px1) return null;
            const cx = panelBox.xs(probeX);
            const values = probeSeries(panel, probeX);
            return (
              <g key={`probe-${panel.id}-${index}`}>
                <line
                  x1={cx}
                  y1={panelBox.y0}
                  x2={cx}
                  y2={panelBox.y1}
                  stroke={ACCENT}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  strokeOpacity={0.85}
                />
                {values.map((value, vi) => (
                  <circle key={vi} cx={cx} cy={panelBox.ys(value)} r={3.2} fill={ACCENT} />
                ))}
              </g>
            );
          })}
          {probeReadout ? (
            <text
              data-probe-readout={probeReadout}
              x={PAD_LEFT}
              y={14}
              fontSize={10.5}
              fill={ACCENT}
              stroke="var(--color-panel, #ffffff)"
              strokeWidth={3.4}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {probeReadout}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
