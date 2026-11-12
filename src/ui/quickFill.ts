/**
 * 小信号快速输入（W12）：同一份数据的两个方向，纯函数，门禁直接用它验数。
 *
 *   Ic / β / VA  →  gm = Ic/Vt,  rπ = β/gm,  ro = VA/Ic
 *   gm / ro / β  →  Ic = gm·Vt,  VA = ro·Ic
 *
 * 规矩：
 *  - 推出来的项标「推得」，并写清「由 Ic=1 mA、β=100 推得」；
 *  - 手改过的项永不被覆盖（写入时改 gm 就把 Ic 变成「推得」，改 Ic 反过来）；
 *  - 常驻一致性提示：预览阶段照实报偏差（改 gm 而 Ic 没动 → 相差 30%），
 *    点「回到一致」把 gm 重算为 Ic/Vt；
 *  - Vt 每次参与重算，不缓存 gm。
 *
 * 为什么「反推」只在 quickCommit（写入）里做：若在预览里就把 Ic 反推成
 * gm·Vt，用户刚手改 gm 的那一刻偏差就是 0，不自洽提示永远不会出现 ——
 * 这等于把题面里 1 mA 的 Ic 偷偷改掉。预览只推输出侧，写入才动输入侧。
 */

export type QuickMode = 'fromQ' | 'fromSmall';

export interface QuickValues {
  /** 集电极电流，A。 */
  Ic: number;
  /** 电流增益 β（注意：A7 的 β 是反馈系数，不是这个）。 */
  beta: number;
  /** 厄利电压，V。 */
  VA: number;
  /** 热电压，V（默认 26 mV）。 */
  Vt: number;
  /** 跨导，S。 */
  gm: number;
  /** 输出电阻，Ω。 */
  ro: number;
  /** 输入电阻 rπ，Ω。 */
  rpi: number;
}

export interface QuickState {
  values: QuickValues;
  /** 被用户手改过的键：后续推导不许覆盖。 */
  manual: string[];
}

/** 变异测试开关：把它关掉就等于「快填每次覆盖手改值」，check:pins 第 4 条必须红。 */
export const QUICKFILL_CONFIG = { respectManual: true };

export type Provenance = '输入' | '推得' | '手改';

export interface QuickResult {
  values: QuickValues;
  provenance: Record<keyof QuickValues, Provenance>;
  /** 推得项的人话依据。 */
  reason: Record<string, string>;
  derivedKeys: string[];
  /** 一行汇总：`由 Ic=1 mA、β=100 推得 gm / rπ / ro`。 */
  summary: string;
  consistency: { diff: number; text: string; ok: boolean };
}

export const QUICK_KEYS: readonly (keyof QuickValues)[] = ['Ic', 'beta', 'VA', 'Vt', 'gm', 'ro', 'rpi'];

export function initialQuickValues(input: Partial<QuickValues> = {}): QuickValues {
  const Ic = input.Ic ?? 0.001;
  const beta = input.beta ?? 100;
  const VA = input.VA ?? 100;
  const Vt = input.Vt ?? 0.026;
  const gm = input.gm ?? Ic / Vt;
  const ro = input.ro ?? VA / Ic;
  return { Ic, beta, VA, Vt, gm, ro, rpi: input.rpi ?? beta / gm };
}

function fmt(value: number, digits = 4): string {
  return Number(value.toPrecision(digits)).toString();
}

interface Draft {
  v: QuickValues;
  manual: Set<string>;
  derived: Set<string>;
  reason: Record<string, string>;
}

function blank(state: QuickState): Draft {
  return { v: { ...state.values }, manual: new Set(state.manual), derived: new Set(), reason: {} };
}

/** 手改保护：变异测试把 QUICKFILL_CONFIG.respectManual 关掉就会覆盖手改值。 */
function put(draft: Draft, key: keyof QuickValues, value: number, why: string) {
  if (QUICKFILL_CONFIG.respectManual && draft.manual.has(key)) return;
  draft.v[key] = value;
  draft.derived.add(key);
  draft.reason[key] = why;
}

function finalize(draft: Draft, mode: QuickMode): QuickResult {
  const { v, manual, derived, reason } = draft;
  const provenance = {} as Record<keyof QuickValues, Provenance>;
  for (const key of QUICK_KEYS) {
    if (manual.has(key)) provenance[key] = '手改';
    else if (derived.has(key)) provenance[key] = '推得';
    else provenance[key] = '输入';
  }
  const expected = v.Vt > 0 ? v.Ic / v.Vt : 0;
  const diff = expected > 0 ? (Math.abs(v.gm - expected) / expected) * 100 : 0;
  const ok = diff < 0.5;
  return {
    values: v,
    provenance,
    reason,
    derivedKeys: [...derived],
    summary:
      mode === 'fromQ'
        ? `由 Ic=${fmt(v.Ic * 1e3)} mA、β=${fmt(v.beta)} 推得 gm / rπ / ro`
        // W13 顺手一：Vt 是常数、不是被推出来的 —— 来源判定与文案对齐
        // （表里 Vt 恒标「输入」），所以这里只说推得 Ic / VA，Vt 写「取」。
        : `由 gm=${fmt(v.gm * 1e3)} mS、ro=${fmt(v.ro / 1e3)} kΩ 推得 Ic / VA（Vt 取 ${fmt(v.Vt * 1e3)} mV）`,
    consistency: {
      diff,
      ok,
      text: ok
        ? `gm 与 Ic 一致（Vt=${fmt(v.Vt * 1e3)} mV 时 gm=Ic/Vt）`
        : `gm 与 Ic 不一致（相差 ${Number(diff.toFixed(1))}%），Vt=${fmt(v.Vt * 1e3)} mV 时 gm=Ic/Vt`,
    },
  };
}

/** 预览 / 每次渲染：只推输出侧，输入侧一个字都不动。 */
export function quickDerive(state: QuickState, mode: QuickMode): QuickResult {
  const draft = blank(state);
  const { v } = draft;
  if (mode === 'fromQ') {
    put(draft, 'gm', v.Ic / v.Vt, `由 Ic=${fmt(v.Ic * 1e3)} mA、Vt=${fmt(v.Vt * 1e3)} mV 推得`);
    put(draft, 'ro', v.VA / v.Ic, `由 VA=${fmt(v.VA)} V、Ic=${fmt(v.Ic * 1e3)} mA 推得`);
    put(draft, 'rpi', v.beta / v.gm, `由 β=${fmt(v.beta)}、gm=${fmt(v.gm * 1e3)} mS 推得`);
  } else {
    put(draft, 'Ic', v.gm * v.Vt, `由 gm=${fmt(v.gm * 1e3)} mS、Vt=${fmt(v.Vt * 1e3)} mV 推得`);
    put(draft, 'VA', v.ro * v.Ic, `由 ro=${fmt(v.ro / 1e3)} kΩ、Ic=${fmt(v.Ic * 1e3)} mA 推得`);
    put(draft, 'rpi', v.beta / v.gm, `由 β=${fmt(v.beta)}、gm=${fmt(v.gm * 1e3)} mS 推得`);
  }
  return finalize(draft, mode);
}

/** 「写入参数表」：在预览之上把被手改的输出侧反推回输入侧，标「推得」。 */
export function quickCommit(state: QuickState, mode: QuickMode): QuickResult {
  const base = quickDerive(state, mode);
  const draft: Draft = {
    v: { ...base.values },
    manual: new Set(state.manual),
    derived: new Set(base.derivedKeys),
    reason: { ...base.reason },
  };
  const { v, manual } = draft;
  if (mode === 'fromQ') {
    if (manual.has('gm') && !manual.has('Ic')) {
      put(draft, 'Ic', v.gm * v.Vt, `由 gm=${fmt(v.gm * 1e3)} mS、Vt=${fmt(v.Vt * 1e3)} mV 反推得`);
    }
    if (manual.has('ro') && !manual.has('VA')) {
      put(draft, 'VA', v.ro * v.Ic, `由 ro=${fmt(v.ro / 1e3)} kΩ、Ic=${fmt(v.Ic * 1e3)} mA 反推得`);
    }
  } else {
    if (manual.has('Ic') && !manual.has('gm')) {
      put(draft, 'gm', v.Ic / v.Vt, `由 Ic=${fmt(v.Ic * 1e3)} mA、Vt=${fmt(v.Vt * 1e3)} mV 反推得`);
    }
    if (manual.has('VA') && !manual.has('ro')) {
      put(draft, 'ro', v.VA / v.Ic, `由 VA=${fmt(v.VA)} V、Ic=${fmt(v.Ic * 1e3)} mA 反推得`);
    }
  }
  return finalize(draft, mode);
}

/** 「回到一致」：清掉 gm 的手改标记，按 Ic / Vt 重算一次。 */
export function quickReconcile(state: QuickState): QuickState {
  return {
    values: { ...state.values, gm: state.values.Ic / state.values.Vt },
    manual: state.manual.filter((key) => key !== 'gm'),
  };
}

/** 单位换算（内部一律 SI，UI 显示 mA / mS / kΩ / MΩ）。 */
export const QUICK_UNITS: Record<keyof QuickValues, { label: string; unit: string; factor: number }> = {
  Ic: { label: 'Ic', unit: 'mA', factor: 1e3 },
  beta: { label: 'β', unit: '', factor: 1 },
  VA: { label: 'VA', unit: 'V', factor: 1 },
  Vt: { label: 'Vt', unit: 'mV', factor: 1e3 },
  gm: { label: 'gm', unit: 'mS', factor: 1e3 },
  ro: { label: 'ro', unit: 'kΩ', factor: 1e-3 },
  rpi: { label: 'rπ', unit: 'kΩ', factor: 1e-3 },
};

/** ro 大到 MΩ 量级时换显示单位（数值不变）。 */
export function displayUnit(key: keyof QuickValues, value: number): { unit: string; factor: number } {
  const base = QUICK_UNITS[key];
  if (key === 'ro' && Math.abs(value) >= 1e6) return { unit: 'MΩ', factor: 1e-6 };
  return { unit: base.unit, factor: base.factor };
}
