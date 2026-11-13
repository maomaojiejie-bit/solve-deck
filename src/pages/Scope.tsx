/**
 * `#/scope` —— 六问判别「这道题到底在不在工具范围内」。
 *
 * 页头那句「它不假装什么都能算。」是这一页的全部立场：
 * 六个前提但凡有一条不成立，就老实说算不了 / 得改写，不硬凑一个答案。
 *
 * 结论三档、64 组合、模板卡出口全由 `src/core/scope/` 算，页面只负责渲染与点击。
 * 每问两个原生 button（aria-pressed），tab 能走到、enter 能选中，不依赖鼠标。
 */

import { useMemo, useState } from 'react';
import { SCOPE_QUESTIONS } from '../core/scope/questions';
import { ThemeToggle } from '../ui/ThemeToggle';
import { answersFromMask, classifyScope, type ScopeVerdict } from '../core/scope/classify';
import { getTemplateRoute } from '../core/templates/registry';
import { assumptionNoticeTitle } from '../core/scope/simplifications';

export const SCOPE_HEADLINE = '它不假装什么都能算。';

interface ScopeProps {
  onBack: () => void;
}

const TIER_STYLE: Record<ScopeVerdict['tier'], { border: string; text: string; chip: string }> = {
  ok: {
    border: 'border-ok/40',
    text: 'text-ok',
    chip: 'border-ok/40 bg-ok/10 text-ok',
  },
  simplify: {
    border: 'border-amber/50',
    text: 'text-amber',
    chip: 'border-amber/50 bg-amber/10 text-amber',
  },
  reject: {
    border: 'border-danger/50',
    text: 'text-danger',
    chip: 'border-danger/50 bg-danger/10 text-danger',
  },
};

export function Scope({ onBack }: ScopeProps) {
  const [answers, setAnswers] = useState<boolean[]>(() => SCOPE_QUESTIONS.map(() => true));
  const verdict = useMemo(() => classifyScope(answers), [answers]);
  const style = TIER_STYLE[verdict.tier];

  const setAnswer = (index: number, value: boolean) => {
    setAnswers((current) => current.map((item, at) => (at === index ? value : item)));
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-6">
          <button
            type="button"
            onClick={onBack}
            className="focus-ring text-[13px] text-muted transition-colors hover:text-ink"
          >
            ← 返回
          </button>
          <span className="text-[13px] text-muted">范围判别 · 六问</span>
          <a href="#/kb" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">知识库</a>
          <a href="#/about" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            能力边界 →
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1120px] gap-4 px-6 pb-20 pt-8">
        <section className="card elev rounded-2xl p-4">
          <p className="kicker">SCOPE / 能力边界</p>
          <p className="mt-2 text-lg text-ink">{SCOPE_HEADLINE}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            下面六个前提只要有一条不成立，结论就不是「算不出来」，而是「这题本来就不该用这套工具算」。
            六问各选是 / 否，结论实时更新；64 种组合全部有明确档位与出口。
          </p>
        </section>

        <section className="grid gap-2 sm:grid-cols-2" aria-label="六个范围前提">
          {SCOPE_QUESTIONS.map((question, index) => (
            <fieldset key={question.id} className="card elev rounded-2xl p-3">
              <legend className="kicker px-1">
                <span className="id-mono text-cyan">Q{index + 1}</span> · 答「否」→ {question.gap}
              </legend>
              <p className="mt-1 text-[12px] leading-5 text-ink">{question.text}</p>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    { value: true, label: '是' },
                    { value: false, label: '否' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    data-scope-q={index}
                    data-scope-v={option.value ? 'yes' : 'no'}
                    aria-pressed={answers[index] === option.value}
                    onClick={() => setAnswer(index, option.value)}
                    className={`focus-ring rounded-lg border px-3 py-1 text-[11px] ${
                      answers[index] === option.value
                        ? 'border-cyan/60 bg-cyan/10 text-cyan'
                        : 'border-line text-muted hover:border-cyan/40 hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </section>

        {/* 结论卡：三档共用一块，颜色与出口随档位变 */}
        <section
          id="scope-verdict"
          data-scope-tier={verdict.tier}
          className={`card elev rounded-2xl border p-4 ${style.border}`}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="kicker">当前结论</p>
            <span className={`id-mono rounded-lg border px-2 py-1 ${style.chip}`}>
              {verdict.label}
            </span>
          </div>
          <p className={`mt-2 text-sm ${style.text}`}>{verdict.headline}</p>

          {verdict.gaps.length > 0 ? (
            <p className="mt-2 text-[11px] leading-5 text-muted">
              不成立的缺口：{verdict.gaps.join(' / ')}
            </p>
          ) : null}

          {verdict.tier === 'ok' ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {verdict.templates.map((id) => {
                const entry = getTemplateRoute(id)?.entry;
                return (
                  <a
                    key={id}
                    href={`#/t/${id}`}
                    className="focus-ring card elev rounded-xl p-3 hover:border-cyan/40"
                  >
                    <span className="id-mono text-cyan">{id}</span>
                    <p className="mt-1 text-[11px] leading-4 text-ink">{entry?.title ?? id}</p>
                    <p className="mt-1 text-[10px] text-faint">直接进结果页 →</p>
                  </a>
                );
              })}
            </div>
          ) : null}

          {verdict.tier === 'simplify' ? (
            <>
              <div className="mt-3 rounded-xl border border-amber/40 bg-amber/10 p-3">
                <p className="text-[11px] text-amber">需要改成什么才算得动：</p>
                <ul className="mt-1 space-y-1 text-[11px] leading-5 text-ink">
                  {verdict.changes.map((change) => (
                    <li key={change}>· {change}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-5 text-amber">
                  {assumptionNoticeTitle()}，结果页会挂 amber 条并印进 PDF。
                </p>
              </div>
            </>
          ) : null}

          {verdict.tier === 'reject' ? (
            <div className="mt-3 rounded-xl border border-line-2 bg-bg p-3">
              <p className="text-[11px] text-ink">这一类该用什么方法：</p>
              <ul className="mt-1 space-y-1 text-[11px] leading-5 text-muted">
                {verdict.methods.map((method) => (
                  <li key={method}>· {method}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={verdict.exit}
              className="focus-ring rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-white"
            >
              {verdict.exitLabel} →
            </a>
            <a href="#/about" className="focus-ring rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:border-cyan/50">
              能力边界
            </a>
            <button
              type="button"
              onClick={() => setAnswers(answersFromMask(63))}
              className="focus-ring rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-cyan/50"
            >
              六个全选「是」
            </button>
          </div>
        </section>

        <p className="px-1 text-[10px] leading-4 text-faint">
          64 种组合的分布：<span className="id-mono text-ok">1 档能直接算</span> ·{' '}
          <span className="id-mono text-amber">3 档要先简化</span> ·{' '}
          <span className="id-mono text-danger">60 档不覆盖</span>。硬缺口（超静定 / 空间 / 动力 / 塑性）
          一律不覆盖；只有变截面与非线性可以先简化，且必须留痕。
        </p>
      </main>
    </div>
  );
}
