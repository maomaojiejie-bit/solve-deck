/**
 * 骨架装载的单一入口：页面打开、换题型、以及「恢复骨架」都走它。
 * 页面与门禁共用同一份函数，所以「恢复后与打开时完全一致」是可证的。
 */

import type { RenderSpec } from '../types.ts';
import type { ParamValue } from '../templates/registry.ts';
import { getTemplateRoute } from '../templates/registry.ts';
import { graphFromSpec } from './graphFromSpec.ts';
import { PICKS, seedGraph, skeletonOptions } from './picks.ts';
import type { CanvasGraph } from './types.ts';

export function defaultValues(templateId: string): Record<string, ParamValue> {
  const route = getTemplateRoute(templateId);
  if (!route) return {};
  const baseline = route.variant?.params ?? {};
  return Object.fromEntries(
    (route.entry.params ?? []).map((param) => [param.key, baseline[param.key] ?? param.defaultValue]),
  );
}

/**
 * M7 的快照主图是 λ–σcr 曲线（零图元）：**快照里没有几何**。
 * 题面本身是「两端铰压杆」，所以按参数生成一根杆作为装配骨架 —— 这是
 * 参数化示意，不冒充快照原图；页面的角标与 about 都写明这一点。
 * 其余 15 个入口一律原样用快照 render_specs[0]，不编任何几何。
 */
export const PARAMETRIC_SKELETON_IDS = ['M7'] as const;

export function isParametricSkeleton(templateId: string): boolean {
  return (PARAMETRIC_SKELETON_IDS as readonly string[]).includes(templateId);
}

function m7BeamSpec(): RenderSpec {
  return {
    id: 'main',
    role: 'primary',
    type: 'freebody',
    nodes: [
      { id: 'n-end-a', x: 140, y: 250, kind: 'pin', label: '' },
      { id: 'n-end-b', x: 780, y: 250, kind: 'pin', label: '' },
      { id: 'n-sup-0', x: 140, y: 250, kind: 'pinSupport', label: '固定铰', labelSide: 'down' },
      { id: 'n-sup-1', x: 780, y: 250, kind: 'pinSupport', label: '固定铰', labelSide: 'down' },
      { id: 'n-load-0', x: 822, y: 250, kind: 'arrow', rot: 270, label: 'P = 150 kN', labelSide: 'up' },
      { id: 'n-span', x: 460, y: 336, kind: 'text', label: 'L = 2 m', labelSide: 'up' },
    ],
    edges: [
      { id: 'e-member', from: 'n-end-a', to: 'n-end-b', kind: 'beam', weight: 2, points: [[140, 250], [780, 250]] },
    ],
    frames: [],
  } as RenderSpec;
}

/** 页面 / 门禁取骨架规格的唯一入口：只有 M7 需要参数化示意。 */
export function labSkeletonSpec(templateId: string, snapshotSpec: RenderSpec): RenderSpec {
  return isParametricSkeleton(templateId) && snapshotSpec.nodes.length === 0 ? m7BeamSpec() : snapshotSpec;
}

/** 「恢复骨架」语义：与打开时完全一致（含种子值、meta、剥掉反力箭头）。 */
export function freshSkeleton(
  templateId: string,
  spec: RenderSpec,
  defaults: Record<string, ParamValue> = defaultValues(templateId),
): CanvasGraph {
  const picks = PICKS[templateId];
  const seeded = seedGraph(templateId, defaults);
  return graphFromSpec(labSkeletonSpec(templateId, spec), templateId, picks.family, {
    ...(picks.family === 'beam' ? skeletonOptions(templateId) : {}),
    seeds: seeded.seeds,
    meta: seeded.meta,
  });
}
