/**
 * 「小信号快速输入」折叠块（W12）：#/lab 与 #/solve 用同一个组件，不复制逻辑。
 *
 * 内部数值一律 SI（A / S / Ω / V），输入框按 mA / mS / kΩ / MΩ 显示；
 * 换算与手改保护全在 `quickFill.ts`，这里只管交互与展示。
 *
 * 体验口径（W23 难题巡检后）：
 *  - 默认展开、收起态不渲染任何控件（读屏 / 自动化都不会看到隐藏输入框）；
 *  - 「填一侧另一侧自动算出」要兑现：推得项的输入框直接显示 quickDerive 的结果，
 *    而不是等点了写入才变；打字中间态用本地草稿，不把空串 / NaN 写进图；
 *  - 按钮按模式分流：fromQ 推的是 π 模型内部量，参数表没有对应项，不给「写入参数表」，
 *    改成直达「从小信号倒推」的入口；只有 fromSmall 才真的写表。
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
  /** 默认展开：难题里这块是主输入区，藏起来会多一次点击；收起时不渲染控件。 */
  const [open, setOpen] = useState(true);
  /** 打字草稿：清空 / 输「-」「0.」期间别让受控输入框回弹，也别把 0 写进图。 */
  const [draft, setDraft] = useState<Record<string, string>>({});

  /** 换题型要重建（A3 的 Ic 与 A5 的 gm 不是同一组输入）。 */
  useEffect(() => {
    setState(build(values));
    setMode(defaultMode(templateId));
    setDraft({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const result = quickDerive(state, mode);

  const patchOf = (computed: QuickResult): { patch: Record<string, number>; keys: string[] } => {
    const patch: Record<string, number> = {};
    const keys: string[] = [];
    for (const key of computed.derivedKeys) {
      if (writableKeys.includes(key) && Number.isFinite(computed.values[key as keyof QuickValues])) {
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
    if (raw.trim() === '') return;
    const { factor } = displayUnit(key, result.values[key]);
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setState((current) => ({
      values: { ...current.values, [key]: value / factor },
      manual: [...new Set([...current.manual, key])],
    }));
  };

  return (
    <details
      data-testid={testId}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-line bg-panel-2 px-2 py-1.5"
    >
      <summary className="cursor-pointer text-[11px] text-cyan">小信号快速输入（填一侧，另一侧自动算出）</summary>
      {/* 收起态只留一句结果摘要，不渲染任何可聚焦控件。 */}
      {!open ? <p className="mt-1 text-[10px] leading-4 text-muted">{result.summary} · 展开可改</p> : null}
      {open ? (
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

        {/* R-36：两列网格把输入框压到 ~30px，β=100 / gm=38.461538 全部截断看不全 ——
            改单列，右栏 294px 里每个框能拿到 ~180px。 */}
        <div className="grid gap-1.5">
          {QUICK_KEYS.map((key) => {
            const shown = result.values[key];
            const { unit, factor } = displayUnit(key, shown);
            const provenance = result.provenance[key];
            const text = draft[key] ?? (Number.isFinite(shown) ? String(Number((shown * factor).toPrecision(8))) : '0');
            return (
              <label key={key} data-testid="quick-row" data-quick-key={key} className="flex items-center gap-1 text-[10px]">
                <span className="w-7 shrink-0 text-ink">{QUICK_UNITS[key].label}</span>
                <input
                  type="number"
                  step="any"
                  value={text}
                  // 剩余漏洞 1.5：Vt 是热电压常数（≈26 mV），参与 Ic↔gm 换算但不写回求解器；
                  // 做成可编辑框会让人以为能改模型，改成只读展示（Salomon 常数一览）。
                  readOnly={key === 'Vt'}
                  onChange={(event) => {
                    if (key === 'Vt') return;
                    const raw = event.target.value;
                    setDraft((current) => ({ ...current, [key]: raw }));
                    change(key, raw);
                  }}
                  onBlur={() => setDraft((current) => {
                    const copy = { ...current };
                    delete copy[key];
                    return copy;
                  })}
                  onFocus={(event) => { if (key === 'Vt') event.currentTarget.select(); }}
                  className={`w-full min-w-0 rounded border bg-bg px-1 py-0.5 text-right text-ink ${
                    key === 'Vt' ? 'border-line/50 bg-panel-2 text-muted' : provenance === '推得' ? 'border-ok/50 bg-ok/5' : 'border-line'
                  }`}
                  aria-label={`${QUICK_UNITS[key].label}${unit ? `（${unit}）` : ''}${key === 'Vt' ? '，只读常数' : ''}`}
                  title={key === 'Vt' ? '热电压常数，只用于换算，不写回求解器' : provenance === '推得' ? '自动算出；直接改会标成「手改」' : '输入值'}
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

        {/* 剩余漏洞 1.5：快速输入区是「独立换算器」，不写参数表就不影响求解 ——
            把这句提到最显眼处（原来藏在按钮下方），免得改了 Ic 以为 Av 会跟着变。 */}
        <p data-testid="quick-scope-note" className="rounded border border-amber/40 bg-amber/10 px-2 py-1 text-[10px] leading-4 text-amber">
          {mode === 'fromQ'
            ? '仅换算、不参与求解：这里改 Ic 只更新 gm / rπ / ro 的显示，参数表与 Av 不会变；要真改求解请到右侧参数表改 Ic / VA，或点下方「倒推」写入。'
            : '只有点「写入参数表」后，倒推出的 Ic / VA 才会进入求解；在此之前本区数值与结果无关。'}
        </p>
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
            {mode === 'fromSmall' ? (
              <button
                type="button"
                data-testid="quick-write"
                onClick={commit}
                className="focus-ring rounded border border-cyan/50 px-2 py-0.5 text-[10px] text-cyan hover:border-cyan"
              >
                写入参数表
              </button>
            ) : (
              <button
                type="button"
                data-testid="quick-goto-small"
                onClick={() => setMode('fromSmall')}
                className="focus-ring rounded border border-cyan/50 px-2 py-0.5 text-[10px] text-cyan hover:border-cyan"
                title="本模式推出的 gm / rπ / ro 参数表里没有对应项；切过去才能反填 Ic / VA"
              >
                切到倒推模式反填 Ic / VA
              </button>
            )}
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
      ) : null}
    </details>
  );
}
