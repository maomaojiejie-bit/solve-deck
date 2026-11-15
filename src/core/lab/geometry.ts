/**
 * R-38 · 力学构件的几何约束检查（纯函数）。
 *
 * 通用求解器 frameSolve 用「全局 x 当梁轴、荷载沿 −y」建模，水平梁之外的构件
 * 即使能画出来，内力 / 挠度的物理含义也不成立。以前系统静默画出折角图、载荷
 * 标签堆成一个点却不给任何说明；现在把这类构件点名，让页面能如实提示。
 */
import type { CanvasGraph } from './types.ts';

const MEMBER_KINDS = new Set(['beam', 'shaft', 'line', 'trussMember']);
/** y 方向偏差小于这个比例就仍算水平（网格吸附带来的 1~2 px 抖动不算）。 */
const HORIZONTAL_TOLERANCE = 0.02;

export interface SlantedMember {
  id: string;
  dx: number;
  dy: number;
}

/**
 * 「单跨梁」题型：这些题的 frameSolve 按「全局 x 当梁轴、荷载沿 −y」建模，
 * 斜杆 / 竖杆确实不适用，需要提示。桁架（S5）与平面任意力系（S3）不在此列：
 * frameSolve 对 `trussMember` / `line` 会释放杆端转动，斜杆是合法构件，
 * 给它们挂「结果不适用」是误报（R-39 真机截图发现）。
 */
const BEAM_AXIS_TEMPLATES = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'M7', 'M8']);

export function slantedMembers(graph: CanvasGraph): SlantedMember[] {
  if (graph.family !== 'beam') return [];
  // 没带 templateId 的构造图（门禁 / 老分享链接）保持原行为，避免静默放过。
  if (graph.templateId && !BEAM_AXIS_TEMPLATES.has(graph.templateId)) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const out: SlantedMember[] = [];
  for (const edge of graph.edges) {
    if (!MEMBER_KINDS.has(edge.kind)) continue;
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    if (Math.abs(dy) / length > HORIZONTAL_TOLERANCE) out.push({ id: edge.id, dx, dy });
  }
  return out;
}

export function slantedMemberNote(graph: CanvasGraph): string | null {
  const members = slantedMembers(graph);
  if (members.length === 0) return null;
  return `检测到 ${members.length} 根非水平构件（${members.slice(0, 2).map((m) => m.id).join('、')}${members.length > 2 ? ' 等' : ''}）：当前力学求解按水平梁（梁轴 = x、荷载沿 −y）建模，竖直 / 斜杆的内力与挠度结果不适用；请改成水平杆，或回到骨架。`;
}
