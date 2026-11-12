/**
 * 站内读题的数据契约（W6 §2）。
 *
 * 三条不变式写在这里，页面与门禁都读同一份定义：
 *  ① AI 不产生任何数值结论 —— `AIDraft` 里只有题型、参数、理由，没有「答案」字段；
 *  ② 不静默降级 —— 解析走的是规则还是 AI，`source` 必须如实写，`notes` 必须给人看；
 *  ③ 抽出来的参数一律「待确认」 —— `unsure` 里的 key、越界值，都不许默认放行。
 */

/** 解析结果卡的数据：屏幕上每个数字只能来自「用户确认过的题面」或 solver。 */
export interface AIDraft {
  /** registry 里的路由 id（模板本体或常驻变体，如 M3-cantilever）。 */
  templateId: string;
  /** key ⊆ 该模板的 ParamSpec.key；这里只放**题面里抽到的**，缺的由表单补默认值。 */
  params: Record<string, number | string>;
  /** ≤40 字，中文，只讲「为什么是这一型」，不许出现数值结论。 */
  reason: string;
  /** 题面原文（用户可改）。 */
  given: string;
  source: 'ai' | 'rule';
  /** 待确认的 key（值合法也只是「待确认」）。 */
  unsure: string[];
}

export interface OutOfRange {
  key: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
}

/** 一次解析的完整结果（页面拿它渲染，门禁拿它断言）。 */
export interface AIParseOutcome {
  draft: AIDraft | null;
  /** 硬错误（模板不在 registry / 参数越界 / 裸结果 / 单位识别不了）。 */
  issues: string[];
  /** 给人看的说明：走了哪条路、为什么降级。 */
  notes: string[];
  /** 越界参数（不夹取，原样保留 + 标红）。 */
  outOfRange: OutOfRange[];
  /** true = 可以点「确认无误 → 开始拆解」（无硬错误、无越界）。 */
  jumpable: boolean;
  /** 调用了几次 provider（无 key 时是 0）。 */
  attempts: number;
  /**
   * 范围闸命中：题面出现「超静定 / 刚架 / 振动 …」这类词，直接出「不覆盖」卡。
   * 一旦有它，页面**不进参数表单**（任务单 §2）；手选模板不经过这里，不受影响。
   */
  blocked?: {
    term: string;
    method: string;
    message: string;
    /** 题面本来会命中的题型（只用来说明「认出了但不算」，不进参数表单）。 */
    templateId?: string;
  };
}

/** AI 只回这三样东西（+ 题面由页面带回来）。 */
export interface AIRawDraft {
  templateId?: unknown;
  params?: unknown;
  reason?: unknown;
  unsure?: unknown;
}
