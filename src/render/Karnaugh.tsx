import type { RenderSpec } from '../core/types';

const GRAY = ['00', '01', '11', '10'];
const CELL = 64;
const LEFT = 72;
const TOP = 56;

const COLORS = [
  'var(--sch-region-0)',
  'var(--sch-region-1)',
  'var(--sch-region-2)',
  'var(--sch-region-3)',
  'var(--sch-region-4)',
  'var(--sch-region-5)',
];

function runs(indices: number[]): [number, number][] {
  const set = [...new Set(indices)].sort((a, b) => a - b);
  if (set.length === 4) return [[0, 3]];
  if (set.length === 2) {
    if (set[1] - set[0] === 1) return [[set[0], set[1]]];
    return [
      [set[0], set[0]],
      [set[1], set[1]],
    ];
  }
  return [[set[0] ?? 0, set[0] ?? 0]];
}

/** 4×4 卡诺图：regions 以行/列索引的笛卡尔积画真正的矩形（环绕拆成两段）。 */
export function Karnaugh({
  spec,
  highlightCell,
}: {
  spec: RenderSpec;
  highlightCell?: { row: number; col: number };
}) {
  const values = new Map<string, string>();
  for (const node of spec.nodes) {
    if (node.kind !== 'kmap-cell') continue;
    values.set(`${node.y}${node.x}`, node.label ?? '0');
  }

  return (
    <svg
      viewBox={`0 0 ${LEFT + 4 * CELL + 150} ${TOP + 4 * CELL + 44}`}
      className="h-auto w-full"
      role="img"
      aria-label="卡诺图"
    >
      <text x={LEFT + 2 * CELL} y={20} textAnchor="middle" fill="currentColor" fontSize="12" opacity="0.7">
        {`列 ${GRAY.join(' / ')}`}
      </text>
      <text
        x={18}
        y={TOP + 2 * CELL}
        textAnchor="middle"
        fill="currentColor"
        fontSize="12"
        opacity="0.7"
        transform={`rotate(-90 18 ${TOP + 2 * CELL})`}
      >
        {`行 ${GRAY.join(' / ')}`}
      </text>

      {GRAY.map((label, col) => (
        <text
          key={`col-${label}`}
          x={LEFT + col * CELL + CELL / 2}
          y={TOP - 12}
          textAnchor="middle"
          fill="currentColor"
          fontSize="12"
        >
          {label}
        </text>
      ))}
      {GRAY.map((label, row) => (
        <text
          key={`row-${label}`}
          x={LEFT - 14}
          y={TOP + row * CELL + CELL / 2 + 4}
          textAnchor="end"
          fill="currentColor"
          fontSize="12"
        >
          {label}
        </text>
      ))}

      {Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 4 }, (_, col) => {
          const value = values.get(`${row}${col}`) ?? '0';
          return (
            <g key={`cell-${row}-${col}`}>
              <rect
                x={LEFT + col * CELL}
                y={TOP + row * CELL}
                width={CELL}
                height={CELL}
                fill="var(--sch-grid-fill)"
                stroke="var(--sch-grid-line)"
                strokeWidth={1}
              />
              <text
                x={LEFT + col * CELL + CELL / 2}
                y={TOP + row * CELL + CELL / 2 + 6}
                textAnchor="middle"
                fontSize="18"
                fill={value === '1' ? 'var(--sch-cell-1)' : value === '-' ? 'var(--sch-cell-x)' : 'var(--sch-cell-0)'}
              >
                {value === '-' ? '×' : value}
              </text>
            </g>
          );
        }),
      )}

      {highlightCell ? (
        <rect
          x={LEFT + highlightCell.col * CELL + 5}
          y={TOP + highlightCell.row * CELL + 5}
          width={CELL - 10}
          height={CELL - 10}
          fill="none"
          stroke="var(--sch-cell-x)"
          strokeWidth={3}
          rx={8}
          pointerEvents="none"
        />
      ) : null}

      {(spec.regions ?? []).map((region, index) => {
        const rows = new Set<number>();
        const cols = new Set<number>();
        for (const cell of region.cells) {
          rows.add(Number(cell[0]));
          cols.add(Number(cell[1]));
        }
        const color = COLORS[index % COLORS.length];
        const colRuns = runs([...cols]);
        const rowRuns = runs([...rows]);
        const colWrap = cols.size === 2 && cols.has(0) && cols.has(3);
        const rowWrap = rows.size === 2 && rows.has(0) && rows.has(3);
        return (
          <g key={region.id} data-region={region.id}>
            {colRuns.flatMap(([c0, c1]) =>
              rowRuns.map(([r0, r1]) => (
                <rect
                  key={`${r0}-${r1}-${c0}-${c1}`}
                  x={LEFT + c0 * CELL + 3}
                  y={TOP + r0 * CELL + 3}
                  width={(c1 - c0 + 1) * CELL - 6}
                  height={(r1 - r0 + 1) * CELL - 6}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  rx={10}
                />
              )),
            )}
            {colWrap && rowRuns.length > 0 ? (
              <g stroke={color} strokeWidth={1.4} strokeDasharray="5 4" fill="none">
                <path
                  d={`M ${LEFT + 0.5 * CELL} ${TOP + 4 * CELL + 12} H ${LEFT + 3.5 * CELL}`}
                />
                <text
                  x={LEFT + 2 * CELL}
                  y={TOP + 4 * CELL + 28}
                  textAnchor="middle"
                  fill={color}
                  fontSize="10"
                  stroke="none"
                >
                  首尾相接
                </text>
              </g>
            ) : null}
            {rowWrap && colRuns.length > 0 ? (
              <g stroke={color} strokeWidth={1.4} strokeDasharray="5 4" fill="none">
                <path
                  d={`M ${LEFT + colRuns[0][0] * CELL - 7} ${TOP + 0.5 * CELL} V ${TOP + 3.5 * CELL}`}
                />
                <text
                  x={LEFT + colRuns[0][0] * CELL - 12}
                  y={TOP + 2 * CELL}
                  textAnchor="middle"
                  fill={color}
                  fontSize="10"
                  stroke="none"
                  transform={`rotate(-90 ${LEFT + colRuns[0][0] * CELL - 12} ${TOP + 2 * CELL})`}
                >
                  首尾相接
                </text>
              </g>
            ) : null}
            <text
              x={LEFT + CELL * 4 + 4}
              y={TOP + index * 18 + 14}
              fill={color}
              fontSize="11"
            >
              {region.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}