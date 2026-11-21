/**
 * W21-B B3 · 首页「贴一道题」不该先把用户送去选题型。
 *
 * 体验报告 5.8：规则解析明明能认出题型，却藏在「先手选题型 → 再点读题」
 * 后面。这里把首页的那一次判定抽成纯函数（node 门禁可直接真跑）：
 *   - 唯一命中 → 直接进 `#/solve?t=<id>&q=<题面>`，Solve 页预选并自动解析；
 *   - 多条命中 → 给候选卡，每张卡自带 `?t=` 的直达链接；
 *   - 零命中 → 才退回「手动选题型」的 `#/solve?q=<题面>`。
 *
 * 只做**离线规则匹配**（与 `#/solve` 同一份 RULES），不发请求、不读图。
 */

import { getTemplateRoute } from '../templates/registry.ts';
import { ruleMatches } from './rule.ts';

export interface HomeCandidate {
  id: string;
  title: string;
  reason: string;
  hash: string;
}

export type HomeSolveTarget =
  | { kind: 'unique'; templateId: string; hash: string; candidates: [] }
  | { kind: 'multiple'; candidates: HomeCandidate[]; hash: string }
  | { kind: 'none'; hash: string; candidates: [] }
  /** 题面像空间/三维结构 → 三维分区（算例库 + 自由装配台），不占 2D 题型模板位 */
  | { kind: 'space'; hash: string; reason: string; candidates: [] };

/** 空间/三维题面特征（三维分区强关联）：只收复合词与专有名词，避免「空间」单字误伤。 */
const SPACE_TEXT =
  /空间桁架|立体桁架|空间结构|空间力系|空间汇交|空间一般力系|空间受力|空间摩擦|空间支架|球铰|棱台|棱锥|圆台|立方体框架|网架|塔架|输电塔|四面体|三维/;

/** 题面 → 首页该跳的 hash / 该显示的候选。纯同步、无浏览器依赖。 */
export function homeSolveTarget(text: string): HomeSolveTarget {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'none', hash: '#/solve', candidates: [] };
  if (SPACE_TEXT.test(trimmed)) {
    return {
      kind: 'space',
      hash: `#/space?q=${encodeURIComponent(trimmed)}`,
      reason: '题面像空间/三维结构 → 三维分区（E1 杆系 · E2 刚体 · E3 机构，可进自由装配台搭完即解）',
      candidates: [],
    };
  }
  const q = encodeURIComponent(trimmed);
  const hits = ruleMatches(trimmed).filter((hit) => getTemplateRoute(hit.templateId));
  // 「唯一命中」= 最具体那一层（分数最低）只有一型。宽泛规则陪跑不算歧义：
  // 例如报告 5.8 的题面同时碰到 M3:26 与 S3:28，判 M3 直达才是用户预期。
  // 只有同分的不同型并列（如 A1/A2/A6 都是 38）才给候选卡。
  const topScore = hits.length > 0 ? hits[0].score : undefined;
  const top = hits.filter((hit) => hit.score === topScore);
  const unique = [...new Map(top.map((hit) => [hit.templateId, hit])).values()];
  const candidates: HomeCandidate[] = unique.map((hit) => ({
    id: hit.templateId,
    title: getTemplateRoute(hit.templateId)?.entry.title ?? hit.templateId,
    reason: hit.reason,
    hash: `#/solve?t=${encodeURIComponent(hit.templateId)}&q=${q}`,
  }));
  if (candidates.length === 1) {
    return { kind: 'unique', templateId: candidates[0].id, hash: candidates[0].hash, candidates: [] };
  }
  if (candidates.length > 1) {
    return { kind: 'multiple', candidates, hash: `#/solve?q=${q}` };
  }
  return { kind: 'none', hash: `#/solve?q=${q}`, candidates: [] };
}
