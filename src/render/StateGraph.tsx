import type { RenderSpec } from '../core/types';

const RADIUS = 28;

interface Point {
  x: number;
  y: number;
}

function boundaryPoint(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / length) * RADIUS, y: from.y + (dy / length) * RADIUS };
}

/** 状态转移图：节点为状态，边为转移；自环画在节点上方。 */
export function StateGraph({ spec, activeIds }: { spec: RenderSpec; activeIds?: Set<string> }) {
  const nodes = new Map(spec.nodes.map((node) => [node.id, node]));
  const width = Math.max(480, ...spec.nodes.map((node) => node.x + 100));
  const height = Math.max(320, ...spec.nodes.map((node) => node.y + 100));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="状态转移图">
      <defs>
        <marker id="state-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--sch-arrow)" />
        </marker>
      </defs>

      {spec.edges.map((edge) => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) return null;
        const active = activeIds?.has(edge.id) ?? false;
        const stroke = active ? 'var(--schematic-active)' : 'var(--schematic-idle)';
        if (edge.from === edge.to) {
          const x = from.x;
          const y = from.y - RADIUS;
          return (
            <g key={edge.id} data-edge={edge.id}>
              <path
                d={`M${x - 14} ${y} C${x - 30} ${y - 54} ${x + 30} ${y - 54} ${x + 14} ${y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={active ? 2.4 : 1.5}
                markerEnd="url(#state-arrow)"
              />
              <text x={x} y={y - 46} textAnchor="middle" fill={stroke} fontSize="11">
                {edge.label ?? ''}
              </text>
            </g>
          );
        }
        const reciprocal = spec.edges.some(
          (other) => other.id !== edge.id && other.from === edge.to && other.to === edge.from,
        );
        const start = boundaryPoint(from, to);
        const end = boundaryPoint(to, from);
        if (reciprocal) {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = Math.hypot(dx, dy) || 1;
          const offset = edge.from < edge.to ? 9 : -9;
          const nx = (-dy / length) * offset;
          const ny = (dx / length) * offset;
          start.x += nx;
          start.y += ny;
          end.x += nx;
          end.y += ny;
        }
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        return (
          <g key={edge.id} data-edge={edge.id}>
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={stroke}
              strokeWidth={active ? 2.4 : 1.5}
              markerEnd="url(#state-arrow)"
            />
            {edge.label ? (
              <text x={midX} y={midY - 5} textAnchor="middle" fill={stroke} fontSize="11">
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {spec.nodes.map((node) => {
        const active = activeIds?.has(node.id) ?? false;
        return (
          <g key={node.id} data-node={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={RADIUS}
              fill="var(--sch-node-fill)"
              stroke={active ? 'var(--schematic-active)' : 'var(--schematic-idle)'}
              strokeWidth={active ? 2.6 : 1.6}
            />
            <text x={node.x} y={node.y + 4} textAnchor="middle" fill="currentColor" fontSize="12">
              {node.label ?? node.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}