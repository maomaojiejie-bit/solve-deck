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
}

/**
 * 扫出「通用求解会硬拒答、但补几个数就能解」的器件。只认电路族与 required
 * 字段；结构性问题（没接地、源成环）不是补参数能解决的，不在这里列。
 */
export function missingModelParams(graph: CanvasGraph | null): MissingModelParams[] {
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
