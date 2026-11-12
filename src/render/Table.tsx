import type { RenderSpec } from '../core/types';

interface TableProps {
  spec: RenderSpec;
  highlightRow?: number;
}

/** 真值表 / 特性表；数据只来自 spec.table，不按题型分支。 */
export function TruthTable({ spec, highlightRow }: TableProps) {
  const table = spec.table;
  if (!table) {
    return <p className="p-4 text-sm text-danger">type=table 但缺少 table 数据</p>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-center text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-2 py-2 font-normal">#</th>
            {table.inputs.map((name) => (
              <th key={`in-${name}`} className="px-3 py-2 font-normal">
                {name}
              </th>
            ))}
            <th className="px-3 py-2 font-normal text-cyan">|</th>
            {table.outputs.map((name) => (
              <th key={`out-${name}`} className="px-3 py-2 font-normal text-cyan">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr
              key={`row-${index}`}
              className={`${
                index === highlightRow
                  ? 'bg-amber/15 ring-1 ring-inset ring-amber/70'
                  : row.out[0] === 1
                    ? 'bg-cyan/5'
                    : ''
              }`}
            >
              <td className="px-2 py-1.5 text-xs text-muted">{index}</td>
              {row.in.map((bit, bitIndex) => (
                <td
                  key={`in-${index}-${bitIndex}`}
                  className={bit === 1 ? 'px-3 py-1.5 text-ink' : bit === 'x' ? 'px-3 py-1.5 text-muted' : 'px-3 py-1.5 text-muted'}
                >
                  {bit}
                </td>
              ))}
              <td className="px-3 py-1.5 text-muted">|</td>
              {row.out.map((bit, bitIndex) => (
                <td
                  key={`out-${index}-${bitIndex}`}
                  className={bit === 1 ? 'px-3 py-1.5 text-cyan' : bit === 'x' ? 'px-3 py-1.5 text-muted/70' : 'px-3 py-1.5 text-muted'}
                >
                  {bit}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}