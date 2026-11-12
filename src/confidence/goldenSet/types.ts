/**
 * 黄金夹具类型（设计稿第 5 节 goldenSet）。
 *
 * P0 只落骨架：形状与约束先定，夹具在 P3 按题型补齐。
 * 约束：T1 每题型 ≥3 道，T2 每题型 ≥1–2 道；全部自编 + 人工验算。
 */

import type { TemplateId } from '../../core/types';

export interface GoldenCase<
  Input = Record<string, number | string>,
  Expected = Record<string, number | string>,
> {
  /** 全局唯一，如 'D2-and-or-nand-01'。 */
  id: string;
  templateId: TemplateId;
  title: string;
  /** 结构化输入；不得存原文题面。 */
  input: Input;
  /** 人工验算得到的期望结果。 */
  expected: Expected;
  /** 判定阈值（physicsValidator 的残差上限），默认 1e-6。 */
  residualThreshold: number;
  /** 人工验算依据：公式 / 真值表 / 手算过程摘要。 */
  handCheck: string;
  /** 只允许自编题；教材原题一律不得进入。 */
  provenance: 'self-authored';
}