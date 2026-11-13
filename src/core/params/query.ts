/**
 * 参数 URL 契约：只认 registry 里声明过的 key。
 * 非法 / 越界值回落到默认值；normalized 是纠正后的查询串。
 */

import type {
  ParamSpec,
  ParamValue,
  SolverInput,
  TemplateEntry,
} from '../templates/registry.ts';

export interface ParsedParamQuery {
  values: Record<string, ParamValue>;
  normalized: string;
  corrected: boolean;
  /** URL 里越界被拒的参数（key + 原始串），页面要红条点名，不许静默回默认。 */
  outOfRange: { key: string; raw: string }[];
}

export function cloneDefault(value: ParamValue): ParamValue {
  return Array.isArray(value) ? [...value] : value;
}

export function defaultParamValues(
  params: readonly ParamSpec[],
  baseline?: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const values = Object.fromEntries(
    params.map((param) => [param.key, cloneDefault(param.defaultValue)]),
  );
  for (const key of Object.keys(baseline ?? {})) {
    if (key in values) values[key] = cloneDefault(baseline![key]);
  }
  return values;
}

export function bitsToValue(bits: readonly number[]): number {
  return bits.reduce((value, bit) => value * 2 + (bit ? 1 : 0), 0);
}

export function bitsToString(bits: readonly number[]): string {
  return bits.map((bit) => (bit ? '1' : '0')).join('');
}

function sameParam(
  param: ParamSpec,
  value: ParamValue,
  baseline?: Record<string, ParamValue>,
): boolean {
  const base = baseline?.[param.key] ?? param.defaultValue;
  if (Array.isArray(base)) {
    const bits = Array.isArray(value) ? value : [];
    return bitsToString(bits) === bitsToString(base as number[]);
  }
  return Number(value) === Number(base);
}

export function buildParamQuery(
  params: readonly ParamSpec[],
  values: Record<string, ParamValue>,
  baseline?: Record<string, ParamValue>,
): string {
  const search = new URLSearchParams();
  for (const param of params) {
    const value = values[param.key];
    if (value === undefined || sameParam(param, value, baseline)) continue;
    if (param.kind === 'bits') {
      const bits = Array.isArray(value) ? value : param.defaultValue;
      search.set(param.key, bitsToString(bits as number[]));
    } else {
      search.set(param.key, String(Number(Number(value).toPrecision(12))));
    }
  }
  return search.toString();
}

export function parseParamQuery(
  params: readonly ParamSpec[],
  search: string,
  baseline?: Record<string, ParamValue>,
): ParsedParamQuery {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const values = defaultParamValues(params, baseline);
  const known = new Set(params.map((param) => param.key));
  let corrected = false;
  /** W22-R P0：URL 里越界的参数（拒绝静默回默认不说话——红条要点名）。 */
  const outOfRange: { key: string; raw: string }[] = [];
  for (const key of query.keys()) {
    if (!known.has(key)) corrected = true;
  }
  for (const param of params) {
    const raw = query.get(param.key);
    if (raw === null) continue;
    if (param.kind === 'bits') {
      const defaults = param.defaultValue as number[];
      if (!/^[01]+$/.test(raw) || raw.length !== defaults.length) {
        corrected = true;
        continue;
      }
      values[param.key] = [...raw].map((bit) => (bit === '1' ? 1 : 0));
      continue;
    }
    const value = raw.trim() === '' ? Number.NaN : Number(raw);
    if (
      !Number.isFinite(value) ||
      (param.min !== undefined && value < param.min) ||
      (param.max !== undefined && value > param.max)
    ) {
      corrected = true;
      // Number.isFinite 但越界 = 用户真的带了一个数来，点名；NaN/空串不算。
      if (Number.isFinite(value)) outOfRange.push({ key: param.key, raw });
      continue;
    }
    values[param.key] = value;
  }
  const normalized = buildParamQuery(params, values, baseline);
  if (normalized !== (search.startsWith('?') ? search.slice(1) : search)) corrected = true;
  return { values, normalized, corrected, outOfRange };
}

/**
 * 把参数值组装成 solver 输入。D2 是网表，由调用方注入；这里返回 fixedInput。
 * D4/D5/D6 的 bits 会转成 j/k/input/value，而不是原样传 bits。
 */
export function buildSolverInput(
  entry: TemplateEntry,
  variantConfig: string | undefined,
  values: Record<string, ParamValue>,
): SolverInput {
  const base = { ...(entry.fixedInput ?? {}) };
  if (entry.id === 'D4') {
    return {
      ...base,
      j: bitsToString((values.jBits as number[]) ?? []),
      k: bitsToString((values.kBits as number[]) ?? []),
    };
  }
  if (entry.id === 'D5') {
    return { ...base, input: bitsToString((values.inputBits as number[]) ?? []) };
  }
  if (entry.id === 'D6') {
    const bits = (values.bits as number[]) ?? [];
    return { ...base, value: bitsToValue(bits), bits: bits.length };
  }
  if (entry.id === 'D1' || entry.id === 'D2' || entry.id === 'D3') {
    return base;
  }
  const input: Record<string, number | string> = { ...base };
  for (const param of entry.params ?? []) {
    if (param.kind === 'number') input[param.key] = Number(values[param.key]);
  }
  if (entry.id === 'A3' || entry.id === 'A5') {
    input.config =
      variantConfig ?? String(base.config ?? (entry.id === 'A3' ? 'CE' : 'CS'));
  }
  // M3 的悬臂变体只换支承条件，参数仍从滑杆来
  if (entry.id === 'M3' && variantConfig) input.config = variantConfig;
  // S1 的三个组态（静定 / 静不定 / 机构）只能靠变体切，滑杆造不出机构
  if (entry.id === 'S1' && variantConfig) input.config = variantConfig;
  return input;
}