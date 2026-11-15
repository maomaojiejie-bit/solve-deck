/**
 * R-37 · 解题步骤导出为可粘贴的 LaTeX / Markdown。
 *
 * 纯函数：门禁可直接断言，不依赖 DOM / 剪贴板。
 * `Step.formula_tex` 已是 KaTeX 源码，`substitution` / `value` 也用数学写法，
 * 所以两者都放进数学定界符里；中文正文交给调用方的 XeLaTeX/ctex 或 Markdown 渲染器。
 * 只做空白规整，不改公式里的任何一个字符 —— 学生要能对得上页面上的式子。
 */
import type { Step } from './types.ts';

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** 用拼接而不是 `$$${...}$$`：模板字符串里 `$${` 会被当成「字面 $ + 插值」，
 *  写出来的定界符会一多一少。这里显式拼，门禁 ⑤ 盯着这件事。 */
const inlineMath = (text: string): string => '$' + text + '$';
const displayMath = (text: string): string => '$$' + text + '$$';

export function stepsToLatex(title: string, steps: readonly Step[]): string {
  if (steps.length === 0) return '';
  const lines: string[] = [
    `% SolveDeck · ${tidy(title) || '解题步骤'}`,
    '% 中文正文请用 XeLaTeX + ctex 编译；公式可直接粘贴。',
    '\\begin{enumerate}',
  ];
  for (const step of steps) {
    lines.push(`\\item \\textbf{${tidy(step.title)}}`);
    if (tidy(step.basis)) lines.push(`  \\emph{依据：${tidy(step.basis)}}`);
    if (tidy(step.formula_tex)) {
      lines.push('  \\[', `    ${tidy(step.formula_tex)}`, '  \\]');
    }
    const sub = tidy(step.substitution);
    const val = tidy(step.value);
    if (sub || val) {
      lines.push(`  代入 ${inlineMath(sub)}${val ? `，得 ${inlineMath(val)}` : ''}。`);
    }
  }
  lines.push('\\end{enumerate}');
  return lines.join('\n');
}

export function stepsToMarkdown(title: string, steps: readonly Step[]): string {
  if (steps.length === 0) return '';
  const lines: string[] = [`## ${tidy(title) || '解题步骤'}`, ''];
  steps.forEach((step, index) => {
    const basis = tidy(step.basis);
    lines.push(`${index + 1}. **${tidy(step.title)}**${basis ? `（${basis}）` : ''}`);
    if (tidy(step.formula_tex)) lines.push(`   - 公式：${displayMath(tidy(step.formula_tex))}`);
    const sub = tidy(step.substitution);
    const val = tidy(step.value);
    if (sub || val) lines.push(`   - 代入：${displayMath(sub)}${val ? ` → ${displayMath(val)}` : ''}`);
  });
  return lines.join('\n');
}
