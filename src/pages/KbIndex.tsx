/**
 * #/kb · 知识库索引（K4）：四科 × 章节；每行标 有图 / 有思路 / 可解题。
 * 纯读物页：不挂解题逻辑，只把人送到条目页。
 */
import { ThemeToggle } from '../ui/ThemeToggle';
import { KB } from '../kb/index.ts';
import type { Subject } from '../kb/types.ts';

const SUBJECT_LABEL: Record<Subject, string> = {
  circuit: '电路 · 模电',
  digital: '数字逻辑',
  mechanics: '材料力学',
  statics: '理论力学',
};
const SUBJECT_ORDER: Subject[] = ['circuit', 'digital', 'mechanics', 'statics'];

export function KbIndex() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-6">
          <a href="#/" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
            ← 首页
          </a>
          <span className="text-[13px] text-muted">知识库</span>
          <span className="id-mono text-[13px] text-faint">共 {KB.length} 条</span>
          <a href="#/solve" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            去解题 →
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-6 pb-16 pt-10">
        <p className="kicker">先看懂，再算出来</p>
        <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-ink">
          知识库 · {KB.length} 条知识点
        </h1>
        <p className="mt-3 max-w-[52ch] text-[14px] leading-[1.6] text-muted">
          每条给你四样东西：怎么下手、哪几个公式够用、一张图，还有容易踩的坑。
          能算的题型点过去就替你选好；不能算的只讲，不硬凑。
        </p>

        {SUBJECT_ORDER.map((subject) => {
          const entries = KB.filter((entry) => entry.subject === subject);
          const chapters = [...new Set(entries.map((entry) => entry.chapter))];
          return (
            <section key={subject} className="mt-12">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[17px] font-semibold text-ink">{SUBJECT_LABEL[subject]}</h2>
                <span className="text-[13px] text-faint">{entries.length} 条</span>
              </div>
              {chapters.map((chapter) => (
                <div key={chapter} className="mt-5">
                  <h3 className="id-mono text-[12px] text-faint">{chapter}</h3>
                  <ul className="mt-2 border-t border-line">
                    {entries
                      .filter((entry) => entry.chapter === chapter)
                      .map((entry) => (
                        <li key={entry.id} className="border-b border-line">
                          <a
                            href={`#/kb/${entry.id}`}
                            data-testid="kb-row"
                            className="group flex items-start gap-4 px-1 py-3 transition-colors hover:bg-panel"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] leading-6 text-ink transition-colors group-hover:text-cyan">
                                {entry.title}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-faint">{entry.oneLine}</span>
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-1">
                              {(entry.figures?.length ?? 0) > 0 ? (
                                <span className="rounded border border-line px-1.5 text-[11px] text-muted">有图</span>
                              ) : null}
                              {entry.approach.length > 0 ? (
                                <span className="rounded border border-line px-1.5 text-[11px] text-muted">有思路</span>
                              ) : null}
                              {entry.solvable ? (
                                <span className="rounded border border-cyan/40 bg-cyan/10 px-1.5 text-[11px] text-cyan">可解题</span>
                              ) : (
                                <span className="rounded border border-line px-1.5 text-[11px] text-faint">只讲</span>
                              )}
                            </span>
                          </a>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </main>
    </div>
  );
}
