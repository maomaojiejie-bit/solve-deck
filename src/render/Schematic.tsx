import type { RenderSpec } from '../core/types';

interface SchematicProps {
  spec: RenderSpec;
  activeIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
  /** 参数实验场当前输入对应的信号路径：用琥珀色叠在步进高亮上。 */
  liveIds?: ReadonlySet<string>;
}

type Box = { w: number; h: number };

/** 只按 node.kind 决定外形与占位；坐标一律读 nodes[].x / .y。 */
function boxFor(kind: string): Box {
  switch (kind) {
    case 'input':
    case 'output':
      return { w: 44, h: 44 };
    case 'and':
    case 'or':
    case 'not':
      return { w: 84, h: 48 };
    case 'xor':
      return { w: 96, h: 48 };
    case 'nand':
    case 'nor':
      return { w: 108, h: 48 };
    default:
      return { w: 72, h: 40 };
  }
}

const ACTIVE = 'var(--schematic-active)';
const LIVE = 'var(--sch-live)';
const IDLE = 'var(--schematic-idle)';
const ACTIVE_TEXT = 'var(--sch-label-active)';
const IDLE_TEXT = 'var(--sch-label-idle)';

function GateBody({ kind }: { kind: string }) {
  switch (kind) {
    case 'and':
    case 'nand':
      return <path d="M-42 -24H10A32 32 0 0 1 10 24H-42Z" />;
    case 'or':
    case 'nor':
      return <path d="M-42 -24Q0 -24 42 0Q0 24 -42 24Q-28 0 -42 -24Z" />;
    case 'xor':
      return <path d="M-42 -24Q0 -24 42 0Q0 24 -42 24Q-28 0 -42 -24Z" />;
    case 'not':
      return <path d="M-42 -24L-42 24L30 0Z" />;
    default:
      return <rect x={-36} y={-20} width={72} height={40} rx={6} />;
  }
}

function GateAccessory({ kind }: { kind: string }) {
  if (kind === 'xor') return <path d="M-48 -24Q-34 0 -48 24" />;
  if (kind === 'not') return <circle cx={36} cy={0} r={6} />;
  if (kind === 'nand' || kind === 'nor') return <circle cx={48} cy={0} r={6} />;
  return null;
}

export function Schematic({ spec, activeIds, labels, liveIds }: SchematicProps) {
  if (spec.nodes.length === 0) {
    /** 从零自建的起点：必须仍然给一张可点的 SVG 白纸。以前这里只返回
     *  一个 div，SpecGrid 的 mainSvg() 拿到 null，力学「结点」放置器在空
     *  画布上点一下什么都不会发生 —— 空态反而把唯一的新建入口堵死了。 */
    return (
      <svg
        viewBox="0 60 800 580"
        className="canvas-grid h-full w-full"
        style={{ minHeight: 320 }}
        role="img"
        aria-label="空白画布：从零开始"
      >
        <text x="400" y="330" textAnchor="middle" fontSize="14" fill="var(--sch-label-idle)">
          画布已空 · 用左侧的加入器件 / 放置器开始自建
        </text>
      </svg>
    );
  }

  const boxes = new Map(
    spec.nodes.map((node) => [node.id, { ...node, ...boxFor(node.kind) }]),
  );

  const xs = spec.nodes.map((node) => {
    const box = boxFor(node.kind);
    return [node.x - box.w / 2, node.x + box.w / 2];
  });
  const ys = spec.nodes.map((node) => {
    const box = boxFor(node.kind);
    return [node.y - box.h / 2, node.y + box.h / 2];
  });
  const pad = 56;
  /** 从零自建时画布可能一个图元都没有（或只剩一行旧标注）：包围盒会退化成
   *  Infinity / 一个字那么窄，既渲染不出来也没地方点。给一张固定白纸，
   *  范围同时覆盖「加入器件」的默认落点 y=560 与力学结点的常用高度。 */
  const bare = spec.nodes.every((node) => node.kind === 'text');
  const minX = bare ? 0 : Math.min(...xs.flat()) - pad;
  const maxX = bare ? 800 : Math.max(...xs.flat()) + pad;
  const minY = bare ? 60 : Math.min(...ys.flat()) - pad;
  const maxY = bare ? 640 : Math.max(...ys.flat()) + pad;

  const wires = spec.edges.flatMap((edge) => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) return [];
    const startX = from.x + from.w / 2;
    const endX = to.x - to.w / 2;
    const midX = startX + (endX - startX) / 2;
    const d =
      Math.abs(from.y - to.y) < 0.5
        ? `M ${startX} ${from.y} H ${endX}`
        : `M ${startX} ${from.y} H ${midX} V ${to.y} H ${endX}`;
    const active = activeIds.has(edge.id);
    const live = liveIds?.has(edge.id) ?? false;
    return [
      <g key={edge.id}>
        <path
          d={d}
          fill="none"
          stroke={live ? LIVE : active ? ACTIVE : IDLE}
          strokeWidth={live || active ? 2.4 : 1.6}
          strokeLinejoin="round"
        />
        {edge.label ? (
          <text
            x={midX}
            y={from.y + (to.y - from.y) / 2 - 7}
            textAnchor="middle"
            fontSize={11}
            fill={live || active ? ACTIVE_TEXT : IDLE_TEXT}
          >
            {edge.label}
          </text>
        ) : null}
      </g>,
    ];
  });

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="canvas-grid h-full w-full"
      style={{ minHeight: 320 }}
      role="img"
      aria-label={`schematic ${spec.id}`}
    >
      {wires}
      {spec.nodes.map((node) => {
        const active = activeIds.has(node.id);
        const live = liveIds?.has(node.id) ?? false;
        const stroke = live ? LIVE : active ? ACTIVE : IDLE;
        const frameLabel = labels.get(node.id);
        const text = frameLabel ?? node.label ?? node.id;
        const isPort = node.kind === 'input' || node.kind === 'output';
        return (
          <g
            key={node.id}
            data-node-id={node.id}
            transform={`translate(${node.x} ${node.y})`}
          >
            <g fill="none" stroke={stroke} strokeWidth={live || active ? 2.4 : 1.8}>
              {isPort ? <circle r={20} /> : <GateBody kind={node.kind} />}
              {!isPort ? <GateAccessory kind={node.kind} /> : null}
            </g>
            <text
              x={0}
              y={isPort ? 5 : -32}
              textAnchor="middle"
              fontSize={isPort ? 15 : 11}
              fill={live || active ? ACTIVE_TEXT : IDLE_TEXT}
            >
              {isPort ? node.label ?? node.id : text}
            </text>
            {isPort && frameLabel ? (
              <text
                x={0}
                y={-30}
                textAnchor="middle"
                fontSize={11}
                fill={live || active ? ACTIVE_TEXT : IDLE_TEXT}
              >
                {frameLabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}