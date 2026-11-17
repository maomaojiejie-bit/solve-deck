/**
 * 器件「模型参数」的单一字段表 —— gm / ro / β / VA / Vf / Ic 这些数既不在
 * CanvasNode.value 里（value 是两端器件的裸数值），也不在参数表里能凭空新增，
 * 以前只有 applyParams 从骨架默认值写回图时才会出现。于是用户一旦拿着一张
 * 没有 params 的 MOS 管（旧分享链接 / 改过种类 / 从零自建），通用求解会拒答
 * 「缺小信号参数 gm / ro」，界面却没有任何地方能填 —— 这条表就是补这个洞。
 *
 * 底线：
 * - example 只作输入框 placeholder 的**参考量级**，绝不自动写进图；
 * - required 只标 netSolve 会硬拒答的项，其它（如二极管 Vf）引擎有缺省，
 *   允许改但不算「缺失」；
 * - 字段表与 netSolve 的判据一一对应，改判据要同步改这里（门禁 ㉟ 钉住）。
 */

import type { CanvasGraph, CanvasNode } from './types.ts';

export interface DeviceParamField {
  key: string;
  /** 中文名 + 符号，输入框旁边直接显示。 */
  label: string;
  unit: string;
  /** 一句话说明这个数进哪条公式，避免用户把 gm 填进 value 框。 */
  hint: string;
  /** 参考量级（placeholder），不是题面值，不自动写入。 */
  example: number;
  /** 'value' 表示这个数落在 CanvasNode.value（npn 的 Ic），缺省落 node.params。 */
  source?: 'value';
  /** netSolve 缺了会硬拒答 —— 进「补模型参数」面板。 */
  required?: boolean;
}

/** 与 netSolve.ts 的 npn / nmos / diode 分支逐键对齐。 */
export const DEVICE_PARAM_FIELDS: Record<string, DeviceParamField[]> = {
  nmos: [
    { key: 'gm', label: '跨导 gm', unit: 'S', hint: 'π 模型受控源系数；通用解按 gm·vgs 算', example: 0.001, required: true },
    { key: 'ro', label: '输出电阻 ro', unit: 'Ω', hint: '漏源间小信号电阻；与 Rd / Rl 并联', example: 5e6, required: true },
  ],
  npn: [
    { key: 'value', label: '静态工作点 Ic', unit: 'A', hint: 'gm = Ic / Vt；这个数就是器件行那个数值框', example: 1e-3, source: 'value', required: true },
    { key: 'beta', label: '电流放大 β', unit: '—', hint: 'rπ = β / gm', example: 100, required: true },
    { key: 'lambda', label: '厄利电压 VA', unit: 'V', hint: 'ro = VA / Ic', example: 100, required: true },
  ],
  diode: [
    { key: 'vf', label: '正向压降 Vf', unit: 'V', hint: '缺省按 0.7 V 恒压降线性化', example: 0.7 },
  ],
};

/** 这个器件当前能编辑的全部模型参数字段（含图上已有、但不在预置表里的 key）。 */
export function deviceParamFields(node: CanvasNode): DeviceParamField[] {
  const preset = DEVICE_PARAM_FIELDS[node.kind] ?? [];
  const known = new Set(preset.map((field) => field.key));
  const extra: DeviceParamField[] = Object.keys(node.params ?? {})
    .filter((key) => !known.has(key))
    .map((key) => ({
      key,
      label: key,
      unit: '',
      hint: '这张图上已有的模型参数',
      example: (node.params ?? {})[key],
    }));
  return [...preset, ...extra];
}

/** 读一个字段的现值；'value' 源读 node.value，其余读 node.params。 */
export function deviceParamValue(node: CanvasNode, field: DeviceParamField): number | undefined {
  const raw = field.source === 'value' ? node.value : node.params?.[field.key];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export interface MissingModelParams {
  nodeId: string;
  label: string;
  kind: string;
  fields: DeviceParamField[];
}/**
 * 扫出「通用求解会硬拒答、但补几个数就能解」的器件。只认电路族与 required
 * 字段；结构性问题（没接地、源成环）不是补参数能解决的，不在这里列。
 */export function missingModelParams(graph: CanvasGraph | null): MissingModelParams[] {
  if (!graph || graph.family !== 'circuit') return [];
  const out: MissingModelParams[] = [];
  for (const node of graph.nodes) {
    if (node.compositeId) continue;
    const fields = deviceParamFields(node).filter(
      (field) => field.required && deviceParamValue(node, field) === undefined,
    );
    if (fields.length === 0) continue;
    out.push({
      nodeId: node.id,
      label: (node.label ?? '').trim() || node.id.replace(/^n-/, '').toUpperCase(),
      kind: node.kind,
      fields,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 从本题解派生模型参数 —— 只给通电动画用，**不写回图**
 *
 * 为什么不写回：骨架校验章有一条「结构改动 通过 · 骨架未改动，参数逐键一致」，
 * 一旦把派生出来的 Ic / β / VA 落进图，这条会立刻变红 —— 用户什么也没改，
 * 却被判成改过骨架。所以派生只做一份内存里的副本（withDerivedModelParams），
 * 图上 params 与骨架一字不动；想真填的人走「补模型参数」面板。
 * ------------------------------------------------------------------ */

export interface DerivedModelParams {
  nodeId: string;
  label: string;
  /** 写进副本的 value（npn 的 Ic）。 */
  value?: number;
  /** 写进副本的 params。 */
  params: Record<string, number>;
  /** 人话：这几个数是怎么来的（挂角标 title）。 */
  how: string;
}

function positive(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record?.[key];
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw.replace(/[^0-9eE+.\-]/g, ''))
          : NaN;
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}

/**
 * 拿本题的直流工作点（parsed_given + result）算小信号参数：
 *   npn  ：Ic、β 直接取，VA 缺省 100 V（与补参面板的参考量级同档）
 *   nmos ：gm = Kn·VOV、ro = 1/(λ·ID)，λ 缺省 0.02
 * 只补「当前缺的」字段；一个都算不出来就返回空数组（那就还是拒答 + 说明原因）。
 */
export function deriveModelParams(
  graph: CanvasGraph | null,
  given: Record<string, number | string> | undefined,
  result: Record<string, number | string> | undefined,
): DerivedModelParams[] {
  if (!graph || graph.family !== 'circuit') return [];
  const out: DerivedModelParams[] = [];
  for (const node of graph.nodes) {
    if (node.compositeId) continue;
    if (node.kind === 'npn') {
      const hasIc = deviceParamValue(node, DEVICE_PARAM_FIELDS.npn[0]) !== undefined;
      const hasBeta = deviceParamValue(node, DEVICE_PARAM_FIELDS.npn[1]) !== undefined;
      const hasVa = deviceParamValue(node, DEVICE_PARAM_FIELDS.npn[2]) !== undefined;
      if (hasIc && hasBeta && hasVa) continue;
      const ic = positive(result as Record<string, unknown>, ['IC', 'Ic']);
      const beta = positive(given as Record<string, unknown>, ['beta', 'β']);
      if (!ic || !beta) continue;
      const va = positive(given as Record<string, unknown>, ['VA', 'V_A']) ?? 100;
      const params: Record<string, number> = {};
      if (!hasBeta) params.beta = beta;
      if (!hasVa) params.lambda = va;
      out.push({
        nodeId: node.id,
        label: (node.label ?? '').trim() || node.id.replace(/^n-/, '').toUpperCase(),
        value: hasIc ? undefined : ic,
        params,
        how: `按本题直流解自动代入 Ic=${(ic * 1e3).toPrecision(3)} mA、β=${beta}${hasVa ? '' : `、VA 缺省 ${va} V`} 算 π 模型`,
      });
      continue;
    }
    if (node.kind === 'nmos') {
      const hasGm = deviceParamValue(node, DEVICE_PARAM_FIELDS.nmos[0]) !== undefined;
      const hasRo = deviceParamValue(node, DEVICE_PARAM_FIELDS.nmos[1]) !== undefined;
      if (hasGm && hasRo) continue;
      const id = positive(result as Record<string, unknown>, ['ID', 'Id']);
      const vov = positive(result as Record<string, unknown>, ['VOV', 'vov']);
      const kn = positive(given as Record<string, unknown>, ['Kn', 'kn']) ?? positive(node.params as Record<string, unknown>, ['Kn', 'kn']);
      const lambda = positive(given as Record<string, unknown>, ['lambda', 'λ']) ?? positive(node.params as Record<string, unknown>, ['lambda', 'λ']) ?? 0.02;
      if (!id || !vov || !kn) continue;
      const gm = kn * vov;
      const ro = 1 / (lambda * id);
      if (!(gm > 0) || !(ro > 0) || !Number.isFinite(ro)) continue;
      const params: Record<string, number> = {};
      if (!hasGm) params.gm = gm;
      if (!hasRo) params.ro = ro;
      out.push({
        nodeId: node.id,
        label: (node.label ?? '').trim() || node.id.replace(/^n-/, '').toUpperCase(),
        params,
        how: `按本题直流解自动代入 ID=${(id * 1e3).toPrecision(3)} mA、VOV=${vov.toPrecision(3)} V，gm=Kn·VOV、ro=1/(λ·ID)`,
      });
      continue;
    }
  }
  return out;
}

/** 派生参数的内存副本：只改 value / params，节点其它字段与坐标一字不动。 */
export function withDerivedModelParams(
  graph: CanvasGraph | null,
  given: Record<string, number | string> | undefined,
  result: Record<string, number | string> | undefined,
): { graph: CanvasGraph | null; derived: DerivedModelParams[] } {
  const derived = deriveModelParams(graph, given, result);
  if (!graph || derived.length === 0) return { graph, derived };
  const byId = new Map(derived.map((item) => [item.nodeId, item]));
  return {
    derived,
    graph: {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const patch = byId.get(node.id);
        if (!patch) return node;
        return {
          ...node,
          value: patch.value ?? node.value,
          params: { ...(node.params ?? {}), ...patch.params },
        };
      }),
    },
  };
}
