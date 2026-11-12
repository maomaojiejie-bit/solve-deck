/**
 * 电路图渲染器：把 RenderSpec（节点 = 器件/端子，边 = 折线导线）画成 SVG。
 *
 * 形状全部来自 `symbols.ts` 的符号表，坐标全部来自布局的引脚，
 * 所以这里只负责三件事：按 rot 摆放图元、按 labelSide 放标签、按 points 画线。
 */

import type { RenderSpec } from '../core/types';
type RenderNode = RenderSpec['nodes'][number];
type RenderEdge = RenderSpec['edges'][number];
import { SYMBOLS } from './symbols';
import { SYMBOL_ART } from './symbolArt.generated';

// 颜色走 CSS 变量：屏幕用深色主题，打印时由 tokens.css 覆盖成白底深线。
const ACTIVE = 'var(--schematic-active)';
const IDLE = 'var(--schematic-idle)';
const TEXT = 'var(--schematic-text)';
const ACTIVE_TEXT = 'var(--schematic-active-text)';

type Pt = [number, number];

/**
 * W21-B B1（体验报告 5.6）：进场 fit-to-content。
 * 以前不管图种都是 pad=76 的正方形外扩，配合 `preserveAspectRatio=meet`
 * 把一根梁压成中间一条细线、上下各留 200px 空白。现在按图种给横向 / 纵向
 * pad 与目标宽高比：freebody / truss 宽扁，schematic 方，chart 走自己的坐标系。
 */
const FIT_BY_TYPE: Record<string, { padX: number; padY: number; ratio: number }> = {
  // W21-C C0-1：宽度方向收到 48 —— labelSide 出来后左右标签贴着端点画，
  // 120/84 的外扩让一根 4m 梁被吃掉 ~20% 宽度（主梁 449px → 达标线 520px 差一截）。
  // 高度方向保留 76：上下标签（P = 20 kN / L = 4 m）仍需要纵向余量。
  freebody: { padX: 48, padY: 76, ratio: 2.2 },
  truss: { padX: 48, padY: 76, ratio: 2.2 },
  schematic: { padX: 84, padY: 84, ratio: 1.3 },
};
const FIT_DEFAULT = { padX: 84, padY: 84, ratio: 1.6 };

function toPath(points: Pt[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
    .join(' ');
}

/** 折线总长的一半处的点，用来放标签。 */
function midPoint(points: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + len >= total / 2) {
      const t = len === 0 ? 0 : (total / 2 - walked) / len;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += len;
  }
  return points[points.length - 1];
}

function edgePoints(edge: RenderEdge, from?: RenderNode, to?: RenderNode): Pt[] | null {
  if (edge.points && edge.points.length >= 2) {
    return edge.points as Pt[];
  }
  if (!from || !to) return null;
  const midX = (from.x + to.x) / 2;
  return [
    [from.x, from.y],
    [midX, from.y],
    [midX, to.y],
    [to.x, to.y],
  ];
}

function labelOffset(
  side: 'up' | 'down' | 'left' | 'right',
  hw: number,
  hh: number,
): { x: number; y: number; anchor: 'middle' | 'start' | 'end' } {
  switch (side) {
    case 'down':
      return { x: 0, y: hh + 16, anchor: 'middle' };
    case 'left':
      return { x: -hw - 8, y: 4, anchor: 'end' };
    case 'right':
      return { x: hw + 8, y: 4, anchor: 'start' };
    default:
      return { x: 0, y: -hh - 10, anchor: 'middle' };
  }
}

function Glyph({ node, stroke }: { node: RenderNode; stroke: string }) {
  const def = SYMBOLS[node.kind];
  if (!def) return null;
  const rot = node.rot ?? 0;
  const art = SYMBOL_ART[node.kind];
  return (
    <g transform={rot ? `rotate(${rot})` : undefined} fill="none" stroke={stroke} strokeWidth={1.7}>
      {art ? (
        // 图形来自 public/symbols/electronics/*.svg（生成器已把引脚对齐到积木表坐标）。
        <g
          fill="none"
          stroke={stroke}
          transform={art.transform}
          dangerouslySetInnerHTML={{ __html: art.inner }}
        />
      ) : null}
      {(def.artOverlay ?? []).map((d, i) => (
        <path key={`o${i}`} d={d} />
      ))}
      {art ? null : (def.paths ?? []).map((d, i) => <path key={`p${i}`} d={d} />)}
      {art
        ? null
        : (def.fills ?? []).map((d, i) => (
            <path key={`f${i}`} d={d} fill={stroke} stroke="none" />
          ))}
      {art
        ? null
        : (def.circles ?? []).map((c, i) => (
            <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill ? stroke : 'none'} />
          ))}
      {(def.marks ?? []).map((m, i) => (
        <text
          key={`m${i}`}
          x={m.x}
          y={m.y}
          fontSize={m.size ?? 10}
          textAnchor="middle"
          fill={TEXT}
          stroke="none"
        >
          {m.text}
        </text>
      ))}
    </g>
  );
}

export function AnalogSchematic({
  spec,
  activeIds,
  labels,
}: {
  spec: RenderSpec;
  activeIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
}) {
  if (spec.nodes.length === 0) {
    return <p className="p-6 text-sm text-muted">这张图没有 nodes</p>;
  }

  const positions = new Map(spec.nodes.map((node) => [node.id, node]));
  const xs: number[] = spec.nodes.flatMap((n) => [n.x]);
  const ys: number[] = spec.nodes.flatMap((n) => [n.y]);
  for (const edge of spec.edges) {
    for (const p of edge.points ?? []) {
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  const fit = FIT_BY_TYPE[spec.type] ?? FIT_DEFAULT;
  const minX = Math.min(...xs) - fit.padX;
  const maxX = Math.max(...xs) + fit.padX;
  const minY = Math.min(...ys) - fit.padY;
  const maxY = Math.max(...ys) + fit.padY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let boxW = maxX - minX;
  let boxH = maxY - minY;
  // 把较短的一维补到目标比例：meet 之后图形才会尽量占满容器，而不是缩在中间。
  if (boxW / boxH < fit.ratio) boxW = boxH * fit.ratio;
  else boxH = boxW / fit.ratio;
  const fittedViewBox = `${cx - boxW / 2} ${cy - boxH / 2} ${boxW} ${boxH}`;

  /** W21-B B1：文字标注重叠时逐条上移，并画细引线指回原位（不猜用户想看哪个）。 */
  const textShift = new Map<string, number>();
  const placed: { x: number; y: number; half: number }[] = [];
  for (const node of spec.nodes) {
    if (node.kind !== 'text') continue;
    const text = labels.get(node.id) ?? node.label ?? '';
    if (!text) continue;
    const half = (String(text).length * 5.5) / 2 + 4;
    const baseY = node.y + (node.labelSide === 'down' ? 18 : -14);
    let y = baseY;
    for (let guard = 0; guard < 3; guard += 1) {
      const clash = placed.some((one) => Math.abs(one.y - y) < 13 && Math.abs(one.x - node.x) < one.half + half);
      if (!clash) break;
      y -= 16;
    }
    placed.push({ x: node.x, y, half });
    textShift.set(node.id, y - baseY);
  }

  return (
    <svg
      viewBox={fittedViewBox}
      className="canvas-grid h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`analog schematic ${spec.id}`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {spec.edges.map((edge) => {
        const pts = edgePoints(edge, positions.get(edge.from), positions.get(edge.to));
        if (!pts) return null;
        const active = activeIds.has(edge.id);
        const stroke = active ? ACTIVE : IDLE;
        const mid = midPoint(pts);
        return (
          <g key={edge.id} data-edge-id={edge.id}>
            <path
              d={toPath(pts)}
              fill="none"
              stroke={stroke}
              strokeWidth={edge.weight === 2 || active ? 2.2 : 1.7}
              strokeDasharray={edge.dashed ? '5 4' : undefined}
            />
            {edge.tag ? (
              <text
                x={mid[0] + 4}
                y={mid[1] - 7}
                textAnchor="middle"
                fontSize={11}
                fill={active ? ACTIVE_TEXT : TEXT}
              >
                {edge.tag}
              </text>
            ) : null}
            {edge.label ? (
              <text
                x={mid[0]}
                y={mid[1] - 6}
                textAnchor="middle"
                fontSize={10}
                fill={TEXT}
                stroke="none"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {spec.nodes.map((node) => {
        const active = activeIds.has(node.id);
        const stroke = active ? ACTIVE : IDLE;
        const def = SYMBOLS[node.kind];
        const text = labels.get(node.id) ?? node.label ?? '';
        const rot = node.rot ?? 0;
        const swap = rot === 90 || rot === 270;
        const hw = def ? (swap ? def.hh : def.hw) : 0;
        const hh = def ? (swap ? def.hw : def.hh) : 0;
        const side = node.labelSide ?? 'up';

        if (node.kind === 'text') {
          const off = labelOffset(side, 0, 0);
          const shift = textShift.get(node.id) ?? 0;
          return (
            <g key={node.id} data-node-id={node.id} transform={`translate(${node.x} ${node.y})`}>
              {shift !== 0 ? (
                <line
                  x1={off.x}
                  y1={off.y - shift}
                  x2={off.x}
                  y2={off.y}
                  stroke={TEXT}
                  strokeWidth={0.7}
                  strokeDasharray="2 2"
                  data-label-leader="1"
                />
              ) : null}
              <text
                x={off.x}
                y={off.y + shift}
                textAnchor={off.anchor}
                fontSize={11}
                fill={active ? ACTIVE_TEXT : TEXT}
              >
                {text}
              </text>
            </g>
          );
        }

        if (node.kind === 'dot') {
          return (
            <g key={node.id} data-node-id={node.id}>
              <circle cx={node.x} cy={node.y} r={4.5} fill={stroke} stroke="none" />
              {text ? (
                <text
                  x={
                    node.labelSide === 'left'
                      ? node.x - 10
                      : node.labelSide === 'right'
                        ? node.x + 10
                        : node.x
                  }
                  y={node.labelSide === 'down' ? node.y + 18 : node.y - 14}
                  textAnchor={
                    node.labelSide === 'left' ? 'end' : node.labelSide === 'right' ? 'start' : 'middle'
                  }
                  fontSize={11}
                  fill={active ? ACTIVE_TEXT : TEXT}
                >
                  {text}
                </text>
              ) : null}
            </g>
          );
        }

        // 箭头符号的 hh 只有箭头的半长，标签按 hh 放会压在箭杆上：
        // 让它越过箭尾（箭头全长 = 2×hh + 6）。
        const off =
          node.kind === 'arrow'
            ? labelOffset(side, hw, hh * 2 + 4)
            : labelOffset(side, hw, hh);
        const inside = def?.labelInside === true;
        return (
          <g
            key={node.id}
            data-node-id={node.id}
            transform={`translate(${node.x} ${node.y})`}
            color={stroke}
          >
            <Glyph node={node} stroke={stroke} />
            {text ? (
              <text
                x={inside ? 0 : off.x}
                y={inside ? 4 : off.y}
                textAnchor={inside ? 'middle' : off.anchor}
                fontSize={11}
                fill={active ? ACTIVE_TEXT : TEXT}
                stroke="none"
              >
                {text}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
