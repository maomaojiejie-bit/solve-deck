import { useEffect, useRef, useState } from 'react';
import type { ParamSpec, ParamValue } from '../core/templates/registry';
import { formatScalar, isInfiniteValue } from '../core/format.ts';

interface ParamPanelProps {
  params: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  solveMs?: number | null;
  error?: string | null;
  onChange: (key: string, value: ParamValue) => void;
  onReset: (key: string) => void;
  onResetAll: () => void;
  /** 实时档：拖动即重算（改值算作「你确认过这一项」，确认闸门不撤）。
   *  只有装配台右栏那份提供开关；/t/ 题面页那份不传，行为不变。 */
  live?: boolean;
  onLiveChange?: (live: boolean) => void;
  /** 黑盒 #19：落了骨架默认值的键 → 解释。求解前参数行就标「骨架默认值」。 */
  defaultsUsed?: Record<string, string>;
  /** A3：键 → 不可写的原因（写入目标不在画布上，如 q：图上没有均布载荷）。
   *  在列的键输入框只读置灰 + 给原因，不再让用户白打一个被静默丢弃的数。 */
  readOnlyHints?: Record<string, string>;
  /** R-36 A9：同页可能有两份参数实验场（装配台右栏 + 嵌入讲解稿各一份），
   *  标题与读屏名必须能区分开，不然学生改错面板、读屏两条同名播报。 */
  title?: string;
  ariaPrefix?: string;
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
  defaultsUsed,
  readOnlyHints,
  onChange,
  onReset,
  onResetAll,
  live,
  onLiveChange,
  title = '参数实验场',
  ariaPrefix = '',
}: ParamPanelProps) {
  const labelled = (label: string) => (ariaPrefix ? `${ariaPrefix}·${label}` : label);
  /**
   * R-38：滑杆连续拖动时 `onChange` 会按像素逐次触发，而每次改值在装配台里
   * 都是一次 `applyParams` → 整图归约预览 → 撤销栈入栈。这里做 120ms 节流：
   * 窗口内只提交第一个值，松手前后只补一次最终值（trailing 不丢用户意图）。
   */
  const commitSlots = useRef<Record<string, { timer: number; last: ParamValue }>>({});
  useEffect(() => () => {
    for (const slot of Object.values(commitSlots.current)) window.clearTimeout(slot.timer);
  }, []);
  // R3 修复：数值框以前是纯受控（value={Number}），清空的那一瞬 onChange('')
  // 会算成 0 并立刻回填 —— 用户「全选 → 重输」被打断，还会看到「06」这类前导零。
  // 现在打字期间留本地草稿，只有「写完了的数」才提交；失焦丢草稿回到真实值。
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const throttledChange = (key: string, value: ParamValue) => {
    const slot = commitSlots.current[key];
    if (slot) {
      slot.last = value;
      return;
    }
    onChange(key, value);
    const timer = window.setTimeout(() => {
      const pending = commitSlots.current[key];
      delete commitSlots.current[key];
      if (pending && pending.last !== value) onChange(key, pending.last);
    }, 120);
    commitSlots.current[key] = { timer, last: value };
  };
  return (
    <section data-testid="param-panel" className="no-print rounded-xl border border-line bg-panel">
      {/* W21-B B6：标题独占一行，「全部恢复默认」在下一行右对齐，不再压着小标题。 */}
      <header className="flex flex-col items-stretch gap-1 border-b border-line px-3 py-2 text-[11px]">
        <span className="text-ink">{title}</span>
        <span className="flex items-center justify-end gap-2">
          <label
            className="flex items-center gap-1 text-[10px] text-muted"
            title="实时：拖动/改值就跟着重算，并把这一项当作你已确认（已确认的标记不撤）。关掉则改值回到未确认，需要重新确认后才重算。"
            hidden={!onLiveChange}
          >
            <input
              type="checkbox"
              data-testid="param-live"
              checked={live === true}
              onChange={(event) => onLiveChange?.(event.target.checked)}
              className="h-3 w-3 accent-cyan"
            />
            实时
          </label>
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
          拖动即时重算（120 ms 节流，松手前就在跟着变）；「实时」开着时改值算你确认过这一项，已确认的标记不撤 ——
          关掉「实时」则改值回到未确认，重新确认后才重算（当前步骤不重置）。
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
                    aria-label={labelled(`恢复 ${param.label} 默认值`)}
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
          // P0：1e12 = 归约的「此件不存在」哨兵（Rc→∞ / Rl 空载）。它不该显示成
          // 1000000000000 + 越界红条，也不该夹取 —— 显示成 ∞，区间提示换成人话。
          const infinite = isInfiniteValue(value);
          // W22-R P0-E3：越界不夹取 —— 框里如实显示用户的值并标红给区间，
          // 拒绝计算交给结果区的红条（「面板参数 === 求解参数」不破）。
          const outOfRange =
            !infinite &&
            ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max));
          const writeBlock = readOnlyHints?.[param.key];
          return (
            // R-36：一行塞不下 7 个元素（303px 栏宽里恢复按钮被压到 16px、滑杆被挤没）。
            // 拆两行：上行 = 标签 + 滑杆 + 恢复；下行 = 数值框 + 单位 + 工程值 + 区间提示。
            <div key={param.key} className="py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-12 shrink-0 text-[11px] text-muted" title={param.label}>
                  {param.label}
                </span>
                {defaultsUsed?.[param.key] ? (
                  <span
                    data-testid={`param-default-${param.key}`}
                    title={defaultsUsed[param.key]}
                    className="shrink-0 rounded border border-amber/50 bg-amber/10 px-1 text-[9px] text-amber"
                  >
                    骨架默认值
                  </span>
                ) : null}
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={sliderOf(param, value)}
                  onChange={(event) => throttledChange(param.key, valueOf(param, Number(event.target.value)))}
                  // 修复计划 T1.1：readOnly 对 input[type=range] 无效（滑杆照样能拖），
                  // 必须用 disabled 才真正锁住「画布上没有写入目标」的键。
                  disabled={writeBlock !== undefined}
                  aria-disabled={writeBlock !== undefined || undefined}
                  aria-label={labelled(param.label)}
                  // W22-D F11：读屏要听到工程值与单位（「2000 Ω」），不是归一化刻度 0–1000。
                  // 内部 value 仍走归一化映射（sliderOf / valueOf），只把语义翻给 AT。
                  aria-valuenow={value}
                  aria-valuetext={formatValue(param, value)}
                  data-param={param.key}
                  data-role="slider"
                  className="h-1 min-w-0 flex-1 accent-cyan"
                />
                <button
                  type="button"
                  onClick={() => onReset(param.key)}
                  disabled={writeBlock !== undefined}
                  title={writeBlock ?? '恢复默认'}
                  aria-label={writeBlock ? undefined : labelled(`恢复 ${param.label} 默认值（滑杆）`)}
                  className="h-5 w-5 shrink-0 rounded border border-line text-[11px] leading-none text-muted enabled:hover:border-cyan/60 enabled:hover:text-cyan disabled:opacity-40"
                >
                  ↺
                </button>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="w-12 shrink-0" aria-hidden="true" />
                <input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={drafts[param.key] ?? (infinite ? '' : String(value))}
                  placeholder={infinite ? '∞' : undefined}
                  readOnly={writeBlock !== undefined}
                  title={writeBlock}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => {
                    const text = event.target.value;
                    setDrafts((current) => ({ ...current, [param.key]: text }));
                    const next = Number(text);
                    // 不夹取：原值上交，越界由红边 + 结果区红条点名（承诺：越界标红、不夹取）。
                    // 打到一半（'' / '-' / '0.'）先不提交，草稿留在框里。
                    if (text.trim() !== '' && Number.isFinite(next)) onChange(param.key, next);
                  }}
                  onBlur={() => {
                    setDrafts((current) => {
                      const copy = { ...current };
                      delete copy[param.key];
                      return copy;
                    });
                  }}
                  aria-label={labelled(`${param.label} 数值`)}
                  aria-invalid={outOfRange || undefined}
                  data-param-input={param.key}
                  className={`w-[76px] shrink-0 rounded border bg-panel-2 px-1 py-0.5 text-right text-[11px] tabular-nums text-ink ${
                    writeBlock !== undefined
                      ? 'cursor-not-allowed border-line opacity-50'
                      : outOfRange
                        ? 'border-danger text-danger'
                        : 'border-line'
                  }`}
                />
                <span className="w-8 shrink-0 text-[9px] text-muted">{param.unit ?? ''}</span>
                <span className="w-14 shrink-0 text-right text-[9px] tabular-nums text-muted">
                  {formatValue(param, value)}
                </span>
                {writeBlock ? (
                  <span
                    data-testid="param-readonly-hint"
                    title={writeBlock}
                    className="min-w-0 flex-1 break-words text-[9px] leading-3 text-muted"
                  >
                    {writeBlock}
                  </span>
                ) : null}
                {outOfRange ? (
                  <span className="min-w-0 flex-1 break-words text-[9px] leading-3 text-danger" data-testid="param-range-flag">
                    合法 {param.min ?? '−∞'}~{param.max ?? '+∞'}
                  </span>
                ) : null}
                {infinite ? (
                  <span className="min-w-0 flex-1 break-words text-[9px] leading-3 text-muted" data-testid="param-infinite-flag">
                    ∞ · 按规则当作不存在
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {error ? <p className="px-1 pt-1 text-[10px] leading-4 text-danger">{error}</p> : null}
      </div>
    </section>
  );
}