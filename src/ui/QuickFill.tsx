/**
 * 「小信号快速输入」折叠块（W12）：#/lab 与 #/solve 用同一个组件，不复制逻辑。
 *
 * 内部数值一律 SI（A / S / Ω / V），输入框按 mA / mS / kΩ / MΩ 显示；
 * 换算与手改保护全在 `quickFill.ts`，这里只管交互与展示。
 */

import { useEffect, useState } from 'react';
import type { ParamValue } from '../core/templates/registry.ts';
import {
  QUICK_KEYS,
  QUICK_UNITS,
  displayUnit,
  initialQuickValues,
  quickCommit,
  quickDerive,
  quickReconcile,
  type QuickMode,
  type QuickResult,
  type QuickState,
  type QuickValues,
} from './quickFill.ts';

/** 挂这个块的题型。A7 只读：它的 β 是反馈系数，不是晶体管电流增益。 */
export const QUICKFILL_TEMPLATES: readonly string[] = ['A3', 'A5', 'A7'];

interface QuickFillProps {
  templateId: string;
  /** 页面参数表的当前值（用来初始化，之后不再反向同步，免得覆盖手改）。 */
  values: Record<string, ParamValue>;
  /** 本型参数表真有的键：只写这些，绝不往 URL / 图里塞多余参数。 */
  writableKeys: string[];
  testId?: string;
  onWrite?: (patch: Record<string, number>, keys: string[]) => void;
}

function num(values: Record<string, ParamValue>, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function build(values: Record<string, ParamValue>): QuickState {
  const raw: Partial<QuickValues> = {
    Ic: num(values, 'Ic', 0.001),
    beta: num(values, 'beta', 100),
    VA: num(values, 'VA', 100),
    Vt: num(values, 'Vt', 0.026),
  };
  if (typeof values.gm === 'number' && Number.isFinite(values.gm)) raw.gm = values.gm;
  if (typeof values.ro === 'number' && Number.isFinite(values.ro)) raw.ro = values.ro;
  return { values: initialQuickValues(raw), manual: [] };
}

const defaultMode = (templateId: string): QuickMode => (templateId === 'A5' ? 'fromSmall' : 'fromQ');

export function QuickFill({ templateId, values, writableKeys, testId = 'quickfill', onWrite }: QuickFillProps) {
  const readOnly = templateId === 'A7';
  const [state, setState] = useState<QuickState>(() => build(values));
  const [mode, setMode] = useState<QuickMode>(() => defaultMode(templateId));

  /** 换题型要重建（A3 的 Ic 与 A5 的 gm 不是同一组输入）。 */
  useEffect(() => {
    setState(build(values));
    setMode(defaultMode(templateId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const result = quickDerive(state, mode);

  const patchOf = (computed: QuickResult): { patch: Record<string, number>; keys: string[] } => {
    const patch: Record<string, number> = {};
    const keys: string[] = [];
    for (const key of computed.derivedKeys) {
      if (writableKeys.includes(key)) {
        patch[key] = computed.values[key as keyof QuickValues];
        keys.push(key);
      }
    }
    return { patch, keys };
  };

  const commit = () => {
    const computed = quickCommit(state, mode);
    setState({ ...state, values: computed.values });
    const { patch, keys } = patchOf(computed);
    onWrite?.(patch, keys);
  };

  const reconcile = () => {
    const next = quickReconcile(state);
    setState(next);
    const { patch, keys } = patchOf(quickDerive(next, mode));
    onWrite?.(patch, keys);
  };

  const change = (key: keyof QuickValues, raw: string) => {
    const { factor } = displayUnit(key, state.values[key]);
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setState((current) => ({
      values: { ...current.values, [key]: value / factor },
      manual: [...new Set([...current.manual, key])],
    }));
  };

  return (
    <details data-testid={testId} className="rounded-lg border border-line bg-panel-2 px-2 py-1.5">
      <summary className="cursor-pointer text-[11px] text-cyan">小信号快速输入（填一侧，另一侧自动算出）</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          {([
            ['fromQ', '从工作点推小信号'],
            ['fromSmall', '从小信号倒推'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid="quick-mode"
              onClick={() => setMode(value)}
              className={`focus-ring rounded border px-2 py-0.5 text-[10px] ${
                mode === value
                  ? // W13 顺手二：选中态加左侧 2px 青竖条 + bg-cyan/15，深色底上一眼可辨
                    'border-cyan/60 border-l-2 border-l-cyan bg-cyan/15 font-medium text-cyan'
                  : 'border-line text-muted/70 hover:border-cyan/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {QUICK_KEYS.map((key) => {
            const { unit, factor } = displayUnit(key, state.values[key]);
            const provenance = result.provenance[key];
            return (
              <label key={key} data-testid="quick-row" data-quick-key={key} className="flex items-center gap-1 text-[10px]">
                <span className="w-7 shrink-0 text-ink">{QUICK_UNITS[key].label}</span>
                <input
                  type="number"
                  step="any"
                  value={Number((state.values[key] * factor).toPrecision(8))}
                  onChange={(event) => change(key, event.target.value)}
                  className={`w-full min-w-0 rounded border bg-bg px-1 py-0.5 text-right text-ink ${
                    provenance === '推得' ? 'border-ok/50' : 'border-line'
                  }`}
                  aria-label={`${QUICK_UNITS[key].label}${unit ? `（${unit}）` : ''}`}
                />
                <span className="w-6 shrink-0 text-muted">{unit}</span>
                <span
                  data-testid={provenance === '推得' ? 'quick-derived' : undefined}
                  className={`w-7 shrink-0 text-right ${
                    provenance === '推得' ? 'text-ok' : provenance === '手改' ? 'text-amber' : 'text-muted'
                  }`}
                >
                  {provenance}
                </span>
              </label>
            );
          })}
        </div>

        <p data-testid="quick-summary" className="text-[10px] leading-4 text-muted">{result.summary}</p>
        <p
          data-testid="quick-consistency"
          className={`text-[10px] leading-4 ${result.consistency.ok ? 'text-muted' : 'text-amber'}`}
        >
          {result.consistency.text}
        </p>
        <p className="text-[10px] leading-4 text-muted">
          {mode === 'fromQ'
            ? '本模式推出的是 π 模型内部量（gm / rπ / ro），参数表里没有对应项；切到「从小信号倒推」可反填 Ic / VA。'
            : '本模式推出的 Ic / VA 会写入参数表并标「推得」；gm / ro / rπ 只在块内显示。'}
        </p>

        {readOnly ? (
          <p className="rounded border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] leading-4 text-amber">
            A7 的 β 是反馈系数，不是这里的电流增益 β；本块只做换算演示，不写入 A7 参数表。
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="quick-write"
              onClick={commit}
              className="focus-ring rounded border border-cyan/50 px-2 py-0.5 text-[10px] text-cyan hover:border-cyan"
            >
              写入参数表
            </button>
            {!result.consistency.ok ? (
              <button
                type="button"
                data-testid="quick-reconcile"
                onClick={reconcile}
                className="focus-ring rounded border border-amber/50 px-2 py-0.5 text-[10px] text-amber hover:border-amber"
              >
                回到一致
              </button>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}
