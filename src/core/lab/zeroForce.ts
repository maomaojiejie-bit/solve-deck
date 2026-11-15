/**
 * R-37 · 零杆判定（基于通用 frameSolve 的杆端轴力）。
 *
 * 教学语义：轴力相对全图最大轴力可忽略的杆 = 零杆。用**相对阈值**而不是
 * 绝对 1e-9，因为载荷单位可能是 kN 也可能是 N，写死绝对阈值会把小载荷
 * 工况里的受力杆全判成零杆。全图无有效轴力时返回空，由 UI 说明「无有效荷载」。
 *
 * 纯函数，不碰图、不碰求解；门禁可直接构造 FrameSolution 断言。
 */
import type { FrameSolution } from './frameSolve.ts';
import type { Solution } from '../types.ts';

export interface ZeroForceInfo {
  ids: string[];
  /** 全图最大杆端轴力，供 UI 解释判定尺度。 */
  scale: number;
  /** 参与判定的杆总数。 */
  total: number;
  /** true = 全图轴力都近零，此时「零杆」没有意义。 */
  noLoad: boolean;
  /** 判定来源：通用解 = 轴力相对阈值；模板解 = 课本节点判据。 */
  source: 'frame' | 'template';
  /** 模板解的理由文案（通用解时为空）。 */
  reason: string;
}

function frameInfo(frame: FrameSolution | null | undefined, relativeTolerance: number): ZeroForceInfo {
  const forces = frame?.memberEndForces ?? [];
  const magnitudes = forces.map((member) => {
    const n0 = Number.isFinite(member.N?.[0]) ? Math.abs(member.N[0]) : 0;
    const n1 = Number.isFinite(member.N?.[1]) ? Math.abs(member.N[1]) : 0;
    return Math.max(n0, n1);
  });
  const scale = magnitudes.reduce((max, value) => Math.max(max, value), 0);
  const total = forces.length;
  if (!Number.isFinite(scale) || scale <= 1e-12) {
    return { ids: [], scale, total, noLoad: true, source: 'frame', reason: '' };
  }
  const tol = Math.max(1e-9, scale * Math.max(1e-12, relativeTolerance));
  const ids = forces.filter((_, index) => magnitudes[index] <= tol).map((member) => member.edgeId);
  return { ids, scale, total, noLoad: false, source: 'frame', reason: '' };
}

export function zeroForceMembers(
  frame: FrameSolution | null | undefined,
  relativeTolerance = 1e-6,
): ZeroForceInfo {
  return frameInfo(frame, relativeTolerance);
}

/**
 * R-39 ② 模板解分支的零杆判据。
 *
 * S5 骨架走模板解析解（F 档）时 `generic.frame` 为空，旧的按钮条件
 * `generic?.frame` 让「零杆高亮」在最该用的题型上永远不出现。模板其实已经
 * 把结论写进 `result.zeroMembers` 与步骤 / 校验表里 —— 这里只把它读出来，
 * 不改 solver、不动 golden 快照，UI 拿到与通用解同形状的 ZeroForceInfo。
 *
 * 语义差别如实保留：模板按课本节点判据给「几根 + 理由」，不给可高亮的
 * edgeId（模板的 member 名是 AB/AC/BC，画布边是 e-AB…，不是同一套 id）；
 * 所以 `ids` 恒为空，UI 应显示禁用按钮 + 理由，而不是假装能高亮。
 */
export function templateZeroForceInfo(solution: Solution | null | undefined): ZeroForceInfo | null {
  if (!solution) return null;
  const raw = solution.result?.zeroMembers;
  if (raw === undefined || raw === null) return null;
  const count = Number(raw);
  if (!Number.isFinite(count) || count < 0) return null;

  // 理由优先取步骤里真正写「零杆：…」的那句（标题含零杆但 value 是别的内容时不能误取），
  // 再补课本判据说明（在校验表 matrix 里），最后退回 confidence.checks。
  const stepLine = solution.steps?.find((step) => /零杆[:：]/.test(String(step.value ?? '')));
  const stepReason = String(stepLine?.value ?? '').replace(/^.*?零杆[:：]\s*/, '').trim();
  const matrix = solution.render_specs?.find((spec) => Array.isArray(spec.matrix?.rows))?.matrix;
  const zeroRow = matrix?.rows?.find((row) => /零杆/.test(String(row[0] ?? '')));
  // columns: 校验项 / 期望 / 实际 / 相对误差 / 结论 / 说明 / 来源
  const ruleReason = String(zeroRow?.[5] ?? '').trim();
  const checkItem = solution.confidence?.checks?.find((check) => /零杆/.test(check.name ?? ''));
  const checkReason = String(checkItem?.detail ?? '').trim();
  const parts = [stepReason, ruleReason, checkReason].filter(
    (part, index, all) => part && all.indexOf(part) === index,
  );
  const reason = parts.join('；');

  return {
    ids: [],
    scale: 0,
    total: count,
    noLoad: false,
    source: 'template',
    reason: reason || `零杆 ${count} 根（判据见讲解稿与校验表）`,
  };
}
