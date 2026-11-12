/**
 * `?p=` 参数覆盖（W10-B 任务 4）。
 *
 * 格式 `#/lab/t/A3?p=Rc:3300,beta:150`。只认当前题型的 ParamSpec 里的数值键，
 * 越界 / 非法 key 一律忽略并如实报出来（页面 toast），不许白屏。
 * 覆盖只写参数表，**确认框仍然全部未勾** —— 用户照样要逐个点确认。
 */

import type { ParamSpec, ParamValue } from '../templates/registry.ts';

/**
 * R1-F 变异位：`?p=` 覆盖值除了进参数表，还要落到力学族的图元上
 * （载荷值/位置、跨度文字）—— 只种 meta 会被画布来源（spanText / load）
 * 压掉而**静默失效**。关掉它 = 静默失效回归，check:assemble ㉚ 必红。
 */
export const P_OVERRIDE_CONFIG = { applyToGraph: true };

export interface ParamOverrides {
  values: Record<string, number>;
  /** 被忽略的片段（给人看）。 */
  ignored: string[];
  /** 覆盖到的键，页面在参数行上标「题面」来源角标。 */
  keys: string[];
}

export function parseParamOverrides(raw: string, params: readonly ParamSpec[]): ParamOverrides {
  const byKey = new Map(params.map((param) => [param.key, param]));
  const values: Record<string, number> = {};
  const ignored: string[] = [];
  for (const piece of raw.split(',').map((one) => one.trim()).filter(Boolean)) {
    const [key, valueText] = piece.split(':').map((one) => one.trim());
    const spec = byKey.get(key);
    const value = Number(valueText);
    if (!spec || spec.kind !== 'number' || valueText === undefined || valueText === '' || !Number.isFinite(value)) {
      ignored.push(`${piece}（不是本型的数值参数）`);
      continue;
    }
    if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
      ignored.push(`${piece}（超出 ${spec.min ?? '−∞'}…${spec.max ?? '∞'}）`);
      continue;
    }
    values[key] = value;
  }
  return { values, ignored, keys: Object.keys(values) };
}

/** 从 hash 里取 p= 值；没有就返回空串。 */
export function paramOverrideText(hash: string): string {
  const query = hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('p') ?? '';
}

/** 把覆盖值合进骨架默认值，并把当前图里已经改过的共享参数继承下来。 */
export function mergeOverrides(
  defaults: Record<string, ParamValue>,
  overrides: Record<string, number>,
): Record<string, ParamValue> {
  return { ...defaults, ...overrides };
}
