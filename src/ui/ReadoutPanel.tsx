/**
 * 读数体检面板（结果页右栏，紧跟「结果 result」之后）。
 *
 * 只负责把 core/readouts.ts 造好的报告画出来：
 *   - 上面一组「量级核对」：strict 违反是红点（矛盾），typical 偏离是琥珀点（不常见）；
 *   - 下面一组「近似代价」：实测偏差 vs 一阶预期，解释得清才是好近似；
 *   - 末尾 details 收着依据，默认不占版面。
 *
 * 判定逻辑一律在 core 里，这里不重算任何一个数字。
 */

import type { ApproxRow, Reading, ReadoutReport } from '../core/readouts';
import { formatPct, readoutSummary } from '../core/readouts';

function toneOf(item: Reading): { dot: string; text: string; label: string } {
  if (item.ok) {
    return {
      dot: 'bg-ok',
      text: 'text-ok',
      label: item.kind === 'strict' ? '一致' : '参考',
    };
  }
  return item.kind === 'strict'
    ? { dot: 'bg-danger', text: 'text-danger', label: '矛盾' }
    : { dot: 'bg-amber', text: 'text-amber', label: '偏离' };
}

function ReadingRow({ item }: { item: Reading }) {
  const tone = toneOf(item);
  return (
    <li
      data-verdict={item.ok ? 'ok' : item.kind === 'strict' ? 'conflict' : 'off'}
      className="px-3 py-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted">{item.label}</span>
        <span className="flex shrink-0 items-center gap-1 text-[10px]">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
          <span className={tone.text}>{tone.label}</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-ink">{item.value}</span>
        <span className="min-w-0 truncate text-right text-[10px] text-faint">{item.expect}</span>
      </div>
    </li>
  );
}

function ApproxLine({ row }: { row: ApproxRow }) {
  return (
    <li className="px-3 py-1.5" data-verdict={row.ok ? 'ok' : 'off'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted">{row.label}</span>
        <span className={`shrink-0 font-mono text-[10px] ${row.ok ? 'text-ok' : 'text-amber'}`}>
          实测 {formatPct(row.errorPct)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px] text-faint">
        <span className="truncate">
          精 {row.exact} · 近 {row.approx}
        </span>
        {row.expectPct !== undefined ? (
          <span className="shrink-0">一阶预期 {formatPct(row.expectPct)}</span>
        ) : null}
      </div>
    </li>
  );
}

export function ReadoutPanel({ report }: { report: ReadoutReport }) {
  const off = report.readings.some((item) => !item.ok) || report.approximations.some((item) => !item.ok);
  const conflicts = report.readings.filter((item) => !item.ok && item.kind === 'strict').length;

  return (
    <section data-testid="readouts" className="rounded-xl border border-line bg-panel elev">
      <header className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px]">
        <span className="text-muted">读数体检</span>
        <span className={conflicts > 0 ? 'text-danger' : off ? 'text-amber' : 'text-ok'}>
          {readoutSummary(report)}
        </span>
      </header>

      {report.readings.length > 0 ? (
        <div>
          <p className="px-3 pt-2 text-[10px] text-faint">量级核对</p>
          <ul className="mt-0.5 divide-y divide-line/50">
            {report.readings.map((item) => (
              <ReadingRow key={`${item.kind}-${item.label}`} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      {report.approximations.length > 0 ? (
        <div className="border-t border-line/70">
          <p className="px-3 pt-2 text-[10px] text-faint">近似代价</p>
          <ul className="mt-0.5 divide-y divide-line/50">
            {report.approximations.map((row) => (
              <ApproxLine key={row.label} row={row} />
            ))}
          </ul>
        </div>
      ) : null}

      <details className="no-print border-t border-line/70 px-3 py-1.5 text-[10px] text-muted">
        <summary className="cursor-pointer">每条核对的依据</summary>
        <ul className="mt-1 space-y-1 leading-4">
          {report.readings.map((item) => (
            <li key={`n-${item.label}`}>
              <span className="text-faint">{item.label}：</span>
              {item.note}
            </li>
          ))}
          {report.approximations.map((row) => (
            <li key={`an-${row.label}`}>
              <span className="text-faint">{row.label}：</span>
              {row.note}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
