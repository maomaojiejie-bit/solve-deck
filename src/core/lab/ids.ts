/**
 * 拼接台已支持装配的题型。零依赖：结果页 / 读题页只用它判断要不要显示
 * 「改结构 →」入口，不该把整张归约表拖进它们的 bundle。
 *
 * W11：16 个装配入口 = 28 道母题里的 15 型 + M3 悬臂这一个组态变体。
 * 剩下 13 型见 coverage.ts 的「不适用」卡，不在这里假装全能。
 */
/**
 * 剩余漏洞 2.1：按学科分组排（模拟电路 A1–A7 → 力学 M1–M7 + M3 悬臂 → 结构 / 数字 S3/S5），
 * 不再 A3/A5/A6/A1 这样随机散排。门禁只校验集合与数量，不依赖顺序。
 */
export const SUPPORTED_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'M1', 'M2', 'M3', 'M3-cantilever', 'M4', 'M5', 'M7',
  'S3', 'S5',
] as const;

export function isLabSupported(templateId: string): boolean {
  return (SUPPORTED_IDS as readonly string[]).includes(templateId);
}

/**
 * W22-A：全图唯一的 id 入口。病根是「id 由 label / length / index 生成」——
 * 连加两个同类器件、删线后再连、展开同一段两次都会撞 id（React 按 key 丢行、
 * `nodes.find(id)` 命中第一个、删除误伤同名）。修法一条：meta.seq 单调计数，
 * 只增不减，随图保存 / 分享；新 id 一律 `${prefix}-${++seq}`。
 */
export function seqOf(graph: import('./types').CanvasGraph): number {
  const saved = graph.meta.seq;
  if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 0) return saved;
  // 旧图缺省：扫现有 id 里的数字后缀取最大值，续着发（不与历史 id 撞）。
  let max = 0;
  for (const id of [...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id)]) {
    for (const m of id.matchAll(/(\d+)/g)) {
      const value = Number(m[1]);
      if (value > max) max = value;
    }
  }
  return max;
}

/** 发一个新 id，并把 seq 写回 graph.meta（调用方用返回的 graph）。 */
export function nextId(
  graph: import('./types').CanvasGraph,
  prefix: string,
): { id: string; graph: import('./types').CanvasGraph } {
  const seq = seqOf(graph) + 1;
  return {
    id: `${prefix}-${seq}`,
    graph: { ...graph, meta: { ...graph.meta, seq } },
  };
}
