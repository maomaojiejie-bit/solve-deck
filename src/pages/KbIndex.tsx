/**
 * #/kb · 知识库索引（K4）：四科 × 章节；每行标 有图 / 有思路 / 可解题。
 * 纯读物页：不挂解题逻辑，只把人送到条目页。
 */
import { useState } from 'react';
import { SITE_LINK, SiteHeader } from '../ui/SiteHeader';
import { KB } from '../kb/index.ts';
import type { Subject } from '../kb/types.ts';

const SUBJECT_LABEL: Record<Subject, string> = {
  circuit: '电路 · 模电',
  digital: '数字逻辑',
  mechanics: '材料力学',
  statics: '理论力学',
  physics: '大学物理',
  math: '高等数学',
  programming: '程序设计 · C',
};
const SUBJECT_ORDER: Subject[] = ['circuit', 'digital', 'mechanics', 'statics', 'physics', 'math', 'programming'];

export function KbIndex() {
  /* 59 条摊在四科里，首页有搜索、这里却没有 —— 想找「卡诺图」只能靠滚。
     给一个就地过滤：标题 / 一句话 / 章节 / id 都参与匹配，不改变分组结构。 */
  const [keyword, setKeyword] = useState('');
  const query = keyword.trim().toLowerCase();
  const hits = query
    ? KB.filter((entry) =>
        [entry.title, entry.oneLine, entry.chapter, entry.id].join(' ').toLowerCase().includes(query),
      )
    : KB;
  return (
    <div className="min-h-screen">
      <SiteHeader
        page="kb"
        title="知识库"
        note={`共 ${KB.length} 条`}
        onBack={() => {
          window.location.hash = '#/';
        }}
        backLabel="首页"
        extra={
          <a href="#/solve" className={SITE_LINK}>
            去解题 →
          </a>
        }
      />

      <main className="mx-auto w-full max-w-[1120px] px-6 pb-16 pt-10">
        <p className="kicker">先看懂，再算出来</p>
        <h1 className="mt-3 text-[26px] font-bold tracking-[-0.02em] text-ink">
          知识库 · {KB.length} 条知识点
        </h1>
        <p className="mt-3 max-w-[52ch] text-[14px] leading-[1.6] text-muted">
          每条给：怎么下手、用哪几个公式、一张图、容易踩的坑。
          能算的题型可直接点进去算。
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按标题 / 章节 / 关键词过滤，如「卡诺图」「莫尔圆」"
            aria-label="过滤知识库条目"
            data-testid="kb-filter"
            className="focus-ring w-full max-w-[420px] rounded border border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-cyan/60"
          />
          <span className="text-[12px] text-faint" data-testid="kb-filter-count">
            {query ? `匹配 ${hits.length} / ${KB.length} 条` : `共 ${KB.length} 条`}
          </span>
          {query ? (
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-cyan/60"
            >
              清空
            </button>
          ) : null}
        </div>

        {query && hits.length === 0 ? (
          <p data-testid="kb-filter-empty" className="mt-8 rounded border border-line bg-panel px-4 py-3 text-[13px] text-muted">
            没有匹配「{keyword.trim()}」的条目。换个词试试（比如公式名、器件名、章节名），或者清空过滤看全部 {KB.length} 条。
          </p>
        ) : null}

        {SUBJECT_ORDER.map((subject) => {
          const entries = hits.filter((entry) => entry.subject === subject);
          if (entries.length === 0) return null;
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
