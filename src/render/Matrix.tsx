import type { RenderSpec } from '../core/types';

/** 非布尔文本表格（数制转换、力学校验栈等）。 */
export function Matrix({ spec }: { spec: RenderSpec }) {
  const matrix = spec.matrix;
  if (!matrix) return <p className="p-4 text-sm text-muted">matrix 数据缺失</p>;
  // 力学校验表有 7 列（校验项 / 期望 / 实际 / 相对误差 / 结论 / 说明 / 来源）：
  // 说明列要吃换行、其余列一律不折，否则中文表头会被挤成一列一个字。
  const WRAP_COLUMNS = new Set([0, 5]);
  /**
   * W21-A A4（体验报告 5.5）：「结论」列原来排在中间、被右栏边界裁掉，
   * 用户唯一想看的通过/不通过看不见。这里只在**渲染层**把结论列挪到最右，
   * 固定 72px 并 sticky 到容器右边缘（快照 columns/rows 一字节未改）。
   */
  const conclusionIndex = matrix.columns.findIndex((column) => column === '结论');
  const order = matrix.columns.map((_, index) => index).filter((index) => index !== conclusionIndex);
  if (conclusionIndex >= 0) order.push(conclusionIndex);
  const widthOf = (index: number) => {
    if (index === conclusionIndex) return '72px';
    if (index === 0) return '26%';
    if (index === 5) return '22%';
    return undefined;
  };
  return (
    <div data-testid="matrix-table" className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[11px]">
        <colgroup>
          {order.map((index) => (
            <col key={index} style={widthOf(index) ? { width: widthOf(index) } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {order.map((index) => (
              <th
                key={index}
                className={`whitespace-nowrap border-b border-line px-2 py-1.5 font-medium text-muted ${
                  index === conclusionIndex ? 'sticky right-0 z-10 bg-panel text-center' : ''
                }`}
              >
                {matrix.columns[index]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-ink/[0.02]">
              {order.map((sourceIndex) => (
                <td
                  key={sourceIndex}
                  data-testid={sourceIndex === conclusionIndex ? 'matrix-conclusion' : undefined}
                  className={`border-b border-line/60 px-2 py-1.5 align-top ${
                    WRAP_COLUMNS.has(sourceIndex) ? 'whitespace-normal leading-4' : 'whitespace-nowrap'
                  } ${sourceIndex === 0 ? 'text-muted' : 'font-mono text-ink'} ${
                    sourceIndex === conclusionIndex ? 'sticky right-0 z-10 bg-panel text-center' : ''
                  }`}
                >
                  {row[sourceIndex]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
