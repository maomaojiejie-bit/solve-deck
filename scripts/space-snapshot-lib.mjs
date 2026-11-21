// P3 快照共享工具：计时归一化 + JSON 安全序列化 + 深度对账。
// build-snapshot.mjs 与 check-solve.mjs 必须使用同一套归一化口径，否则对账失真。

const TIMING_RE = /耗时 \d+ ms/g;

/** 剔除随机器运行波动的字段（solveMs、steps 里的「耗时 N ms」文案），保证快照确定性。 */
export function normalizeSolution(sol) {
  const { solveMs, ...rest } = structuredClone(sol);
  rest.steps = rest.steps.map((s) => ({ ...s, detail: s.detail.replace(TIMING_RE, "耗时 {ms} ms") }));
  return rest;
}

/** 保留 Infinity/NaN 语义的序列化（JSON.stringify 会把它们静默变成 null）。 */
export function serialize(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? { __num: String(v) } : v), 2);
}

export function deserialize(text) {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v.__num === "string" ? Number(v.__num) : v));
}

/** 深度对比：对象忽略键序、数组按下标，返回差异描述（上限 20 条）。 */
export function deepDiff(a, b, path = "$", out = []) {
  if (out.length >= 20) return out;
  if (Object.is(a, b)) return out;
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) out.push(`${path}: 快照 ${a} ≠ 实时 ${b}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length: 快照 ${a.length} ≠ 实时 ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) deepDiff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: 快照缺失`);
      else if (!(k in b)) out.push(`${path}.${k}: 实时结果缺失`);
      else deepDiff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: 快照 ${JSON.stringify(a)} ≠ 实时 ${JSON.stringify(b)}`);
  return out;
}
