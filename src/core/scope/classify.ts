/**
 * `#/scope` 的判别逻辑：64 组合 → 三档结论。
 *
 * 规则只有一条，写死在这里，页面与门禁共用：
 *  - 出现**任何硬缺口** → 不覆盖（不硬凑近似答案，见任务单「别做」）；
 *  - 只有软缺口 → 要先简化（明说改成什么、且提示「不等价」）；
 *  - 六个全「是」 → 能直接算，给 1–3 个覆盖内的题型卡。
 *
 * 也就是说 64 组合里 1 个「能直接算」、3 个「要先简化」、60 个「不覆盖」。
 * 这个分布本身是结论的一部分：绝大多数真实工程题本来就不在这套工具的范围内。
 */

import { SCOPE_QUESTIONS, type ScopeTier } from './questions.ts';

export interface ScopeVerdict {
  tier: ScopeTier;
  /** 结论档位的中文名。 */
  label: string;
  headline: string;
  /** 所有答「否」的缺口名。 */
  gaps: string[];
  /** 能直接算：1–3 个模板 id（链 #/t/<id>）。 */
  templates: string[];
  /** 要先简化：需要改成什么才算得动。 */
  changes: string[];
  /** 简化 id（会跟着 URL 走到结果页去留痕）。 */
  simplifications: string[];
  /** 不覆盖：该用什么方法。 */
  methods: string[];
  /** 这一档的出口。 */
  exit: string;
  exitLabel: string;
}

/** 六个全是「是」时给的覆盖内题型：1–3 张卡，都是 ready 的静定/线弹性题。 */
const READY_TEMPLATES = ['M3', 'M1', 'S3'] as const;

export function classifyScope(answers: readonly boolean[]): ScopeVerdict {
  if (answers.length !== SCOPE_QUESTIONS.length) {
    throw new Error(`范围判别要 ${SCOPE_QUESTIONS.length} 个答案，收到 ${answers.length} 个`);
  }
  const gaps: string[] = [];
  const methods: string[] = [];
  const changes: string[] = [];
  const simplifications: string[] = [];
  let hard = 0;

  SCOPE_QUESTIONS.forEach((question, index) => {
    if (answers[index] === true) return;
    gaps.push(question.gap);
    if (question.kind === 'hard') {
      hard += 1;
      methods.push(`${question.gap}：${question.method}`);
    } else {
      if (question.change) changes.push(question.change);
      if (question.simplification) simplifications.push(question.simplification);
    }
  });

  if (hard > 0) {
    return {
      tier: 'reject',
      label: '不覆盖',
      headline: '本工具不做这一类 —— 不给近似答案，也不偷偷换模板算。',
      gaps,
      templates: [],
      changes: [],
      simplifications: [],
      methods,
      exit: '#/about',
      exitLabel: '看能力边界',
    };
  }

  if (simplifications.length > 0) {
    return {
      tier: 'simplify',
      label: '要先简化',
      headline: '得先把题改成理想化模型才算得动 —— 简化后的结论与原题不等价。',
      gaps,
      templates: [],
      changes,
      simplifications,
      methods: [],
      exit: `#/solve?simp=${simplifications.join(',')}`,
      exitLabel: '去 #/solve 按这个改写算',
    };
  }

  return {
    tier: 'ok',
    label: '能直接算',
    headline: '六条前提都成立 —— 直接进覆盖内的题型，参数照题面填。',
    gaps: [],
    templates: [...READY_TEMPLATES],
    changes: [],
    simplifications: [],
    methods: [],
    exit: '#/solve',
    exitLabel: '去 #/solve 贴题',
  };
}

/** 门禁用：把 0..63 的位模式翻成答案（第 i 位为 1 = 第 i 问答「是」）。 */
export function answersFromMask(mask: number): boolean[] {
  return SCOPE_QUESTIONS.map((_question, index) => ((mask >> index) & 1) === 1);
}
