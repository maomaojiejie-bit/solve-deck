/**
 * #/kb/:id · 知识条目页（K4）：骨架顺序按设计稿 §5，不许变 ——
 * 思路 → 知识点 → 公式 → 图 → 坑 → 去解题 → 关联。
 */
import { ThemeToggle } from '../ui/ThemeToggle';
import { Formula } from '../render/Formula.tsx';
import { KB_BY_ID } from '../kb/index.ts';
import { getTemplateRoute } from '../core/templates/registry';
import type { KbFigure, Subject } from '../kb/types.ts';

const SUBJECT_LABEL: Record<Subject, string> = {
  circuit: '电路 · 模电',
  digital: '数字逻辑',
  mechanics: '材料力学',
  statics: '理论力学',
  physics: '大学物理',
  math: '高等数学',
  programming: '程序设计 · C/C#',
};

function Figure({ figure }: { figure: KbFigure }) {
  if (figure.kind === 'svg') {
    return (
      <figure className="mt-4">
        <img
          src={figure.src.replace('public/', `${import.meta.env.BASE_URL}`)}
          alt={figure.alt}
          loading="lazy"
          className="w-full rounded-[10px] border border-line bg-panel p-2"
        />
        <figcaption className="mt-2 text-[12px] text-faint">{figure.caption}</figcaption>
      </figure>
    );
  }
  if (figure.kind === 'photo') {
    return (
      <figure className="mt-4">
        <img
          src={figure.src.replace('public/', `${import.meta.env.BASE_URL}`)}
          alt={figure.alt}
          loading="lazy"
          className="w-full rounded-[10px] border border-line"
        />
        <figcaption className="mt-2 text-[12px] text-faint">
          {figure.caption} · 来源：{figure.credit}
        </figcaption>
      </figure>
    );
  }
  // live：形状由求解器渲染 —— 条目页放跳转卡，真正的活图在解题台。
  return (
    <figure className="mt-4">
      <a
        href={`#/t/${figure.templateId}`}
        data-testid="kb-live-figure"
        className="focus-ring flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[10px] border border-cyan/40 bg-cyan/5 px-4 py-3 transition-colors hover:border-cyan/70"
      >
        <span className="id-mono text-[12px] text-cyan">{figure.templateId}</span>
        <span className="text-[13px] text-ink">{figure.caption}</span>
        <span className="ml-auto text-[12px] text-cyan">去解题台看活图 →</span>
      </a>
      <figcaption className="mt-2 text-[12px] text-faint">活图：图中数字由求解器算出，本条目不写答案。</figcaption>
    </figure>
  );
}

export function KbEntry({ id }: { id: string }) {
  const entry = KB_BY_ID[id];
  if (!entry) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[900px] items-center gap-4 px-6">
            <a href="#/kb" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
              ← 知识库
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[900px] px-6 py-20 text-center">
          <p className="text-[15px] text-muted">没有这条知识点（id：{id}）。</p>
          <a href="#/kb" className="focus-ring mt-4 inline-block text-[13px] text-cyan">
            回知识库索引 →
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[900px] items-center gap-4 px-6">
          <a href="#/kb" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
            ← 知识库
          </a>
          <span className="hidden text-[13px] text-faint sm:inline">
            {SUBJECT_LABEL[entry.subject]} / {entry.chapter}
          </span>
          <a href="#/solve" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            去解题 →
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[900px] px-6 pb-20 pt-10">
        {/* 面包屑 + 标题 + 一句话 */}
        <p className="id-mono text-[12px] text-faint">知识库 / {SUBJECT_LABEL[entry.subject]} / {entry.chapter}</p>
        <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-ink">{entry.title}</h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-muted">{entry.oneLine}</p>
        {!entry.solvable ? (
          <p className="mt-4 rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px] text-muted">
            这条只讲思路，不动手算——求解器还没覆盖这一型。
          </p>
        ) : null}

        {/* ① 解题思路 */}
        <section className="mt-10" data-testid="kb-approach">
          <h2 className="text-[15px] font-semibold text-ink">① 解题思路</h2>
          <ol className="mt-3 space-y-2">
            {entry.approach.map((step, index) => (
              <li key={index} className="flex gap-3 text-[14px] leading-[1.7] text-muted">
                <span className="id-mono shrink-0 text-faint">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ② 知识点 */}
        <section className="mt-10" data-testid="kb-points">
          <h2 className="text-[15px] font-semibold text-ink">② 知识点</h2>
          <ul className="mt-3 space-y-2">
            {entry.points.map((point, index) => (
              <li key={index} className="flex gap-3 text-[14px] leading-[1.7] text-muted">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ③ 关键公式（≥1 条才显示） */}
        {entry.formulas.length > 0 ? (
          <section className="mt-10" data-testid="kb-formulas">
            <h2 className="text-[15px] font-semibold text-ink">③ 关键公式</h2>
            <div className="mt-3 space-y-3 overflow-x-auto rounded-lg border border-line bg-panel px-4 py-4">
              {entry.formulas.map((formula, index) => (
                <div key={index} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Formula tex={formula.tex} block className="text-ink" />
                  {formula.note ? <span className="text-[12px] text-faint">{formula.note}</span> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ④ 图（0–3 张） */}
        {(entry.figures?.length ?? 0) > 0 ? (
          <section className="mt-10" data-testid="kb-figures">
            <h2 className="text-[15px] font-semibold text-ink">④ 图</h2>
            {entry.figures?.map((figure, index) => (
              <Figure key={index} figure={figure} />
            ))}
          </section>
        ) : null}

        {/* ⑤ 常见坑（0–3 条） */}
        {(entry.pitfalls?.length ?? 0) > 0 ? (
          <section className="mt-10" data-testid="kb-pitfalls">
            <h2 className="text-[15px] font-semibold text-ink">⑤ 常见坑</h2>
            <ul className="mt-3 space-y-2">
              {entry.pitfalls?.map((pitfall, index) => (
                <li
                  key={index}
                  className="border-l-2 border-amber-500/70 pl-3 text-[14px] leading-[1.7] text-muted"
                >
                  {pitfall}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ⑥ 去解题：v2 的核心交接 —— 知识库不承接解题，只把人送过去 */}
        <section className="mt-12 rounded-lg border border-line bg-panel px-5 py-4" data-testid="kb-gosolve">
          {entry.solvable ? (
            <>
              <a
                href={`#/solve?t=${entry.solvable.templateId}`}
                data-testid="kb-solve-link"
                className="focus-ring inline-flex h-10 items-center rounded-lg bg-cyan px-4 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
              >
                去解：{getTemplateRoute(entry.solvable.templateId)?.entry.title ?? entry.solvable.templateId} →
              </a>
              <p className="mt-2 text-[12px] text-faint">点过去题型已经替你选好，参数是默认值，改改数字就能出结构。</p>
            </>
          ) : null}
          <p className={`text-[13px] text-muted ${entry.solvable ? 'mt-3' : ''}`}>
            想自己改结构？<a href="#/lab" className="focus-ring text-cyan hover:underline">去装配台 →</a>
            （拼图对所有题型都开着，不挑条目。）
          </p>
        </section>

        {/* ⑦ 关联条目（2–4 个 chip） */}
        {(entry.related?.length ?? 0) > 0 ? (
          <section className="mt-10" data-testid="kb-related">
            <h2 className="text-[15px] font-semibold text-ink">⑦ 关联条目</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.related?.map((relatedId) => {
                const related = KB_BY_ID[relatedId];
                if (!related) return null;
                return (
                  <a
                    key={relatedId}
                    href={`#/kb/${relatedId}`}
                    className="focus-ring rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-cyan/50 hover:text-ink"
                  >
                    {related.title}
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
