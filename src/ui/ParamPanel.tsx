import type { ParamSpec, ParamValue } from '../core/templates/registry';
import { formatScalar } from '../core/format.ts';

interface ParamPanelProps {
  params: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  solveMs?: number | null;
  error?: string | null;
  onChange: (key: string, value: ParamValue) => void;
  onReset: (key: string) => void;
  onResetAll: () => void;
}

/** W21-B B5：右栏与左栏 / 画布同一个格式器（100kΩ / 2.00 m / 30.0 MPa）。 */
function formatValue(param: ParamSpec, value: number): string {
  return formatScalar(value, param.unit ?? '');
}

function sliderOf(param: ParamSpec, value: number): number {
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  if (param.log && min > 0) {
    const t = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
    return Math.max(0, Math.min(1000, Math.round(t * 1000)));
  }
  return Math.max(0, Math.min(1000, Math.round(((value - min) / (max - min || 1)) * 1000)));
}

function valueOf(param: ParamSpec, slider: number): number {
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  let value: number;
  if (param.log && min > 0) {
    const t = slider / 1000;
    value = Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t);
  } else {
    value = min + ((max - min) * slider) / 1000;
  }
  if (param.step) value = Math.round(value / param.step) * param.step;
  return Math.max(min, Math.min(max, value));
}

export function ParamPanel({
  params,
  values,
  solveMs,
  error,
  onChange,
  onReset,
  onResetAll,
}: ParamPanelProps) {
  return (
    <section data-testid="param-panel" className="no-print rounded-xl border border-line bg-panel">
      {/* W21-B B6：标题独占一行，「全部恢复默认」在下一行右对齐，不再压着小标题。 */}
      <header className="flex flex-col items-stretch gap-1 border-b border-line px-3 py-2 text-[11px]">
        <span className="text-ink">参数实验场</span>
        <span className="flex items-center justify-end gap-2">
          {typeof solveMs === 'number' ? (
            <span className="text-muted">{solveMs.toFixed(1)} ms</span>
          ) : null}
          <button
            type="button"
            data-testid="reset-all-params"
            onClick={onResetAll}
            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-cyan/50 hover:text-cyan"
          >
            全部恢复默认
          </button>
        </span>
      </header>
      <div className="space-y-1 p-2">
        <p className="px-1 pb-1 text-[10px] leading-4 text-muted">
          拖动后 80 ms 重算；当前步骤不重置。
        </p>
        {params.map((param) => {
          const raw = values[param.key];
          if (param.kind === 'bits') {
            const bits = Array.isArray(raw) ? raw : (param.defaultValue as number[]);
            return (
              <div key={param.key} className="rounded border border-line/70 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted">{param.label}</span>
                  <button
                    type="button"
                    onClick={() => onReset(param.key)}
                    title="恢复默认"
                    aria-label={`恢复 ${param.label} 默认值`}
                    className="rounded px-1 text-[11px] text-muted hover:text-cyan"
                  >
                    ↺
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {bits.map((bit, index) => (
                    <button
                      key={`${param.key}-${index}`}
                      type="button"
                      onClick={() => {
                        const next = [...bits];
                        next[index] = bit === 1 ? 0 : 1;
                        onChange(param.key, next);
                      }}
                      title={param.bitLabels?.[index] ?? `bit ${index}`}
                      className={`h-7 min-w-7 rounded border px-1 text-[11px] tabular-nums transition-colors ${
                        bit === 1
                          ? 'border-cyan/60 bg-cyan/15 text-cyan'
                          : 'border-line bg-panel-2 text-muted hover:border-cyan/40'
                      }`}
                    >
                      {bit}
                    </button>
                  ))}
                </div>
                {param.bitLabels ? (
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] text-muted">
                    {param.bitLabels.map((label) => (
                      <span key={label} className="min-w-7 text-center">
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          const value = typeof raw === 'number' ? raw : (param.defaultValue as number);
          // W22-R P0-E3：越界不夹取 —— 框里如实显示用户的值并标红给区间，
          // 拒绝计算交给结果区的红条（「面板参数 === 求解参数」不破）。
          const outOfRange =
            (param.min !== undefined && value < param.min) ||
            (param.max !== undefined && value > param.max);
          return (
            <div key={param.key} className="flex items-center gap-1.5 py-0.5">
              <span className="w-12 shrink-0 text-[11px] text-muted" title={param.label}>
                {param.label}
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={sliderOf(param, value)}
                onChange={(event) => onChange(param.key, valueOf(param, Number(event.target.value)))}
                aria-label={param.label}
                // W22-D F11：读屏要听到工程值与单位（「2000 Ω」），不是归一化刻度 0–1000。
                // 内部 value 仍走归一化映射（sliderOf / valueOf），只把语义翻给 AT。
                aria-valuenow={value}
                aria-valuetext={formatValue(param, value)}
                data-param={param.key}
                data-role="slider"
                className="h-1 min-w-0 flex-1 accent-cyan"
              />
              <input
                type="number"
                min={param.min}
                max={param.max}
                step={param.step}
                value={value}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  // 不夹取：原值上交，越界由红边 + 结果区红条点名（承诺：越界标红、不夹取）。
                  onChange(param.key, next);
                }}
                aria-label={`${param.label} 数值`}
                aria-invalid={outOfRange || undefined}
                data-param-input={param.key}
                className={`w-[76px] shrink-0 rounded border bg-panel-2 px-1 py-0.5 text-right text-[11px] tabular-nums text-ink ${
                  outOfRange ? 'border-danger text-danger' : 'border-line'
                }`}
              />
              <span className="w-8 shrink-0 text-[9px] text-muted">{param.unit ?? ''}</span>
              <span className="w-14 shrink-0 text-right text-[9px] tabular-nums text-muted">
                {formatValue(param, value)}
              </span>
              {outOfRange ? (
                <span className="w-[72px] shrink-0 text-[9px] leading-3 text-danger" data-testid="param-range-flag">
                  合法 {param.min ?? '−∞'}~{param.max ?? '+∞'}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onReset(param.key)}
                title="恢复默认"
                aria-label={`恢复 ${param.label} 默认值（滑杆）`}
                className="w-4 shrink-0 rounded text-[11px] text-muted hover:text-cyan"
              >
                ↺
              </button>
            </div>
          );
        })}
        {error ? <p className="px-1 pt-1 text-[10px] leading-4 text-danger">{error}</p> : null}
      </div>
    </section>
  );
}