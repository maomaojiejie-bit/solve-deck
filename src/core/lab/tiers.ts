/**
 * 三档置信度：六项沿用 + structure / semantic 两项可选扩展（不 bump 契约版本）。
 *
 *  U 拒答 —— W15-S4 起 U 只留拓扑非法：通用求解器自己也解不动（noGround /
 *            geometricUnstable / shortVSource / vSourceLoop / floatingNet…）。
 *            「骨架不符 / 归约不唯一」不再是 U —— 走通用求解出 N 档结果。
 *  N 仅数值 —— semantic skipped/fail、structure fail，或**通用求解**（骨架不符
 *              但拓扑合法）：数值照给，讲解稿不渲染（本来就没有）。
 *  F 完整 —— 六项 + 两项全 pass：完整 0–4 帧 + appliedRules 证据卡 + 等效图。
 */

import type { ConfidenceReport, CheckState } from '../types.ts';
import type { LabTier } from './types.ts';

/** 通用求解结果的 semantic skipReason（W15-S4：结果页与置信度卡共用同一句）。 */
export const GENERIC_SKIP_REASON = '无讲解稿，已用通用求解';

/** 克隆报告并追加 structure / semantic 两项，重算三个汇总字段。 */
export function withLabChecks(
  report: ConfidenceReport,
  structure: { state: CheckState; detail: string },
  semantic: { state: CheckState; detail: string; skipReason?: string },
): ConfidenceReport {
  const checks = [
    ...report.checks,
    { name: 'structure', state: structure.state, detail: structure.detail, ...(structure.state === 'skipped' ? { skipReason: structure.detail } : {}) },
    {
      name: 'semantic',
      state: semantic.state,
      detail: semantic.detail,
      ...(semantic.state === 'skipped' ? { skipReason: semantic.skipReason ?? semantic.detail } : {}),
    },
  ];
  const failedCount = checks.filter((item) => item.state === 'fail').length;
  const skippedCount = checks.filter((item) => item.state === 'skipped').length;
  const noFail = failedCount === 0;
  const skipsAllExplained = checks.every((item) => item.state !== 'skipped' || Boolean(item.skipReason));
  return {
    ...report,
    checks,
    failedCount,
    skippedCount,
    allPassed: noFail && skipsAllExplained && skippedCount <= 4,
  };
}

export interface LabVerdict {
  tier: LabTier;
  headline: string;
  detail: string;
  /** U 档替代入口（按钮文案 → hash）。 */
  substitute?: { label: string; hash: string }[];
}

export function tierOf(input: {
  outOfScope: boolean;
  scopeOk: CheckState;
  problems: readonly string[];
  semantic: CheckState;
  /** 复合器件实例数（W13 硬闸门 4：不计入 semantic 正向分，徽章如实说明）。 */
  composites?: number;
  /** W21-C C1-1：梁页不讲「等效电路」——F/N 档文案按图族分支。 */
  family?: 'circuit' | 'beam';
}): LabVerdict {
  // 梁页用词：同一份校验口径，但「等效电路」「等效图」是电路页的话。
  const noun = input.family === 'beam' ? '解析解' : '等效电路';
  const noun2 = input.family === 'beam' ? '结论卡' : '等效图';
  if (input.outOfScope || input.scopeOk === 'fail') {
    return {
      tier: 'U',
      headline: '本题不适用，已给替代入口',
      detail: input.problems.length > 0 ? input.problems.join(' ') : '范围判别未通过：这题不在本工具覆盖内。',
      substitute: [
        { label: '换一个题型', hash: '#/lab' },
        { label: '恢复骨架重试', hash: '' },
        { label: '去 #/scope 走一遍判别', hash: '#/scope' },
      ],
    };
  }
  if (input.semantic === 'skipped' || input.semantic === 'fail') {
    return {
      tier: 'N',
      headline: `数值已验证 · ${noun2}未核对`,
      detail: `器件语义标签未全部确认，${noun}不渲染；数值结果照常给出，第 4 帧用「等价模型 + 方程」代替。${input.family === 'beam' ? '' : `想看题库讲解稿的${noun}：在归约预览点「按拓扑标全」把关键语义标齐，再求解一次即可（F 档）；把图改成骨架不一致时，通用求解会自动按端口推导戴维南等效电路。`}`,
    };
  }
  // W13 硬闸门 4：复合器件不计入 semantic 正向分 —— F 档徽章写明。
  if ((input.composites ?? 0) > 0) {
    return {
      tier: 'F',
      headline: `${noun}已验证（含 ${input.composites} 个自定义模块，未纳入语义评分）`,
      detail: '校验口径见顶部徽标，跳过的项不记为通过；复合器件已摊开归约但语义评分只看原生器件。',
    };
  }
  return {
    tier: 'F',
    // 剩余漏洞 1.8：「解析解已验证」不能让人以为位移也被解析解验过 ——
    // 反力 / 内力走解析互核，位移是刚度法重建值。口径写在 headline 里。
    headline: input.family === 'beam' ? '反力 · 内力已解析验证（位移为刚度法重建）' : `${noun}已验证`,
    detail: input.family === 'beam'
      ? '反力 / 内力经解析路径互核；位移 δ 由框架刚度法重建，不纳入解析校验判据。校验口径见顶部徽标与「自检」，跳过的项不记为通过。'
      : `校验口径见顶部徽标与「自检」，跳过的项不记为通过；完整播放，${noun2}与改动台账证据卡随解给出。`,
  };
}

/** N 档第 4 帧替换标记（渲染层据此把 stepIndex=3 换成「等价模型 + 方程」）。 */
export const N_TIER_STEP4_TITLE = '等价模型 + 方程';

/**
 * W15-S4：骨架不符但拓扑合法 → 通用求解的 N 档结论。
 * 数值是真的（netSolve / frameSolve 现算），只是没有讲解稿 —— 不假装有。
 */
export function genericVerdict(family: 'circuit' | 'beam', detail?: string): LabVerdict {
  const what = family === 'beam' ? '力学通用求解（刚度法）' : '电路通用求解（节点电压法）';
  return {
    tier: 'N',
    headline: '按这张图求解：题库讲解稿对不上它',
    detail: detail ?? `图与骨架不一致，模板讲解不渲染；${what}直接解这张图，被问的量照给。`,
  };
}
