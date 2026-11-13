/**
 * 首页（v2 重做）：搜索页 —— 唯一入口。
 *
 * 设计稿 v2 §6：大搜索框 + 热门 + 四科入口 + 去解题；**不再有**示例清单、题型卡、贴题大输入框。
 * 贴题判定保留（intent.ts 只做分流）：粘进题面 → 提示「这是一道题 → 去解题」。
 * 解题是顶栏「解题」的二选一面板：按模板解 / 自己拼。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchKb, suggestAlias, type KbSearchHit } from '../kb/search.ts';
import { detectIntent } from '../kb/intent.ts';
import { KB } from '../kb/index.ts';
import type { Subject } from '../kb/types.ts';
import { homeSolveTarget, type HomeCandidate } from '../core/ai/homeRoute.ts';
import { ThemeToggle } from '../ui/ThemeToggle';

const SHELL = 'mx-auto w-full max-w-[1120px] px-6';
const NAV = 'focus-ring text-[13px] text-muted transition-colors hover:text-ink';
const PRODUCT_SHOT = `${import.meta.env.BASE_URL}shots/r32-product.png`;

const SUBJECT_LABEL: Record<Subject, string> = {
  circuit: '电路 · 模电',
  digital: '数字逻辑',
  mechanics: '材料力学',
  statics: '理论力学',
};
const SUBJECT_ORDER: Subject[] = ['circuit', 'digital', 'mechanics', 'statics'];
const HOT_TERMS = ['卡诺图化简', '共射增益', '莫尔圆', '零杆判别', '自锁'];

export function Home() {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<HomeCandidate[]>([]);
  const [solvePanelOpen, setSolvePanelOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ⌘K / Ctrl+K 唤起搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 点外面收起「解题」二选一面板
  useEffect(() => {
    if (!solvePanelOpen) return;
    const onDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setSolvePanelOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [solvePanelOpen]);

  const hits = useMemo(() => (query.trim() ? searchKb(query).slice(0, 6) : []), [query]);
  const isProblem = query.trim().length > 0 && detectIntent(query) === 'problem';
  const suggestions = useMemo(
    () => (query.trim() && hits.length === 0 ? suggestAlias(query) : []),
    [query, hits.length],
  );

  /** 题面分流：命中题型走 homeSolveTarget（含候选卡），否则进解题台手动选。 */
  const goSolve = () => {
    const text = query.trim();
    if (!text) {
      window.location.hash = '#/solve';
      return;
    }
    const target = homeSolveTarget(text);
    if (target.kind === 'multiple') {
      setCandidates(target.candidates);
      return;
    }
    setCandidates([]);
    // 认不出唯一题型也把题面带过去：解题台拿到 ?q= 会预填题面，不用用户复制粘贴一遍。
    window.location.hash = target.kind === 'unique' ? target.hash : `#/solve?q=${encodeURIComponent(text)}`;
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="toolbar sticky top-0 z-30">
        <div className={`${SHELL} flex h-[52px] items-center gap-3`}>
          <span className="traffic shrink-0" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <a href="#/" className="focus-ring ml-2 flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-[15px] font-bold text-ink">拆解台</span>
            <span className="id-mono hidden text-faint sm:inline">SolveDeck</span>
          </a>
          <nav className="ml-auto flex shrink-0 items-center gap-5 whitespace-nowrap sm:gap-7">
            <a href="#/kb" className={NAV}>
              知识库
            </a>
            {/* 解题：二选一面板（就地展开，不是新页面） */}
            <span className="relative" ref={panelRef}>
              <button
                type="button"
                data-testid="nav-solve"
                aria-haspopup="true"
                aria-expanded={solvePanelOpen}
                onClick={() => setSolvePanelOpen((open) => !open)}
                className={NAV}
              >
                解题
              </button>
              {solvePanelOpen ? (
                <div
                  data-testid="solve-panel"
                  className="absolute right-0 top-8 z-40 w-[248px] rounded-lg border border-line-2 bg-panel p-2 shadow-lg"
                >
                  <a
                    href="#/solve"
                    data-testid="solve-panel-template"
                    onClick={() => setSolvePanelOpen(false)}
                    className="focus-ring block rounded-md px-3 py-2.5 transition-colors hover:bg-panel-2"
                  >
                    <span className="block text-[13px] text-ink">① 按模板解</span>
                    <span className="mt-0.5 block text-[11px] text-faint">选一道熟悉的题型</span>
                  </a>
                  <a
                    href="#/lab"
                    data-testid="solve-panel-lab"
                    onClick={() => setSolvePanelOpen(false)}
                    className="focus-ring block rounded-md px-3 py-2.5 transition-colors hover:bg-panel-2"
                  >
                    <span className="block text-[13px] text-ink">② 自己拼</span>
                    <span className="mt-0.5 block text-[11px] text-faint">在画布上搭结构</span>
                  </a>
                </div>
              ) : null}
            </span>
            <a href="#/about" className={NAV}>
              关于
            </a>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-enter">
        <section className={`${SHELL} pt-24 pb-8`}>
          <p className="kicker">工科四科 · {KB.length} 条知识点</p>
          <h1 className="mt-4 text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[40px]">
            先看懂，再算出来。
          </h1>
          <p className="mt-4 text-[15px] text-muted">搜一个考点，或者直接去解题。</p>

          <div className="mt-8 max-w-[640px]">
            <div className="glass flex h-14 items-center gap-3 rounded-lg px-4" data-testid="kb-search-wrap">
              <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" />
                <path d="M13.5 13.5 L17 17" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCandidates([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (isProblem) goSolve();
                    else if (hits.length > 0) window.location.hash = `#/kb/${hits[0].entry.id}`;
                  }
                }}
                placeholder="搜知识点：卡诺图 / 共射增益 / 莫尔圆…"
                aria-label="搜索知识点"
                data-testid="kb-search"
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
              />
              <kbd className="id-mono hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-faint sm:block">
                ⌘K
              </kbd>
            </div>

            {/* 题面分流提示：≥2 个数值+单位或祈使动词 → 这是一道题 */}
            {isProblem ? (
              <button
                type="button"
                data-testid="home-problem-hint"
                onClick={goSolve}
                className="focus-ring mt-3 flex w-full items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/5 px-4 py-2.5 text-left text-[13px] text-ink transition-colors hover:border-cyan/70"
              >
                这是一道题 → <span className="text-cyan">去解题</span>
              </button>
            ) : null}

            {/* 多题型命中候选卡（题面分流复用 W21-B B3） */}
            {candidates.length > 0 ? (
              <div data-testid="home-candidates" className="mt-3 rounded-lg border border-cyan/40 bg-panel-2 p-3">
                <p className="text-[12px] text-muted">这段题面像不止一型，点一个直接进去（题面会带过去）：</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      data-testid="home-candidate"
                      data-candidate={candidate.id}
                      title={candidate.reason}
                      onClick={() => {
                        window.location.hash = candidate.hash;
                        setCandidates([]);
                      }}
                      className="focus-ring rounded-lg border border-line bg-panel px-2.5 py-1.5 text-left text-[12px] text-ink hover:border-cyan/60"
                    >
                      <span className="id-mono text-cyan">{candidate.id}</span>
                      <span className="ml-2 text-muted">{candidate.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 搜索结果：标题 + 一句话 + 科目 · 章节 + 右端标签 */}
            {hits.length > 0 ? (
              <ul className="mt-3 overflow-hidden rounded-lg border border-line" data-testid="kb-results">
                {hits.map((hit) => (
                  <ResultRow key={hit.entry.id} hit={hit} />
                ))}
              </ul>
            ) : null}

            {/* 无结果三件套：换个说法（编辑距离 ≤2 的别名）/ 四科入口 / 去解题台 */}
            {suggestions.length > 0 ? (
              <div className="mt-3 rounded-lg border border-line bg-panel px-4 py-3" data-testid="kb-suggest">
                <p className="text-[12px] text-faint">没有直接命中，换个说法：</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((alias) => (
                    <button
                      key={alias}
                      type="button"
                      onClick={() => setQuery(alias)}
                      className="focus-ring rounded border border-line px-2 py-1 text-[12px] text-muted hover:border-cyan/50 hover:text-ink"
                    >
                      {alias}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 热门 */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
              <span className="text-faint">热门：</span>
              {HOT_TERMS.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => setQuery(term)}
                  className="focus-ring text-muted transition-colors hover:text-cyan"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 四科入口 + 去解题 */}
        <section className={`${SHELL} pb-16 pt-6`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card px-5 py-5">
              <h2 className="text-[15px] font-semibold text-ink">知识库 · {KB.length} 条</h2>
              <ul className="mt-3 space-y-2">
                {SUBJECT_ORDER.map((subject) => {
                  const count = KB.filter((entry) => entry.subject === subject).length;
                  return (
                    <li key={subject}>
                      <a href="#/kb" className="focus-ring flex items-baseline gap-2 text-[13px] text-muted transition-colors hover:text-ink">
                        <span className="text-ink">{SUBJECT_LABEL[subject]}</span>
                        <span className="id-mono text-faint">{count}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="card px-5 py-5">
              <h2 className="text-[15px] font-semibold text-ink">去解题</h2>
              <div className="mt-3 space-y-2">
                <a href="#/solve" className="focus-ring flex items-baseline gap-2 text-[13px] text-muted transition-colors hover:text-ink">
                  按模板解 <span className="ml-auto text-cyan">→</span>
                </a>
                <a href="#/lab" className="focus-ring flex items-baseline gap-2 text-[13px] text-muted transition-colors hover:text-ink">
                  自己拼（装配台） <span className="ml-auto text-cyan">→</span>
                </a>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-faint">不需要配置，也不需要联网。求解器在本机跑。</p>
            </div>
          </div>
        </section>

        {/* 产品图：一张，带框，不加阴影不加光 */}
        <section className={`${SHELL} border-t border-line`}>
          <figure className="py-14" data-testid="home-product">
            <img
              src={PRODUCT_SHOT}
              alt="装配台：左边装配、中间画布、右边已知量"
              className="product-shot w-full rounded-lg border border-line object-cover"
            />
            <figcaption className="mt-4 flex items-baseline gap-3 text-[13px] text-faint">
              <span className="id-mono">装配台</span>
              <span>改结构，不改求解器 —— 删一个电阻、改一个支座，图和数同时跟着变。</span>
            </figcaption>
          </figure>
        </section>

        <footer className="border-t border-line">
          <div className={`${SHELL} flex flex-wrap items-center gap-x-6 gap-y-2 py-8`}>
            <p className="id-mono text-faint">拆解台 SolveDeck · 知识库 {KB.length} 条 · 6 项校核 · 本地求解器</p>
            <div className="ml-auto flex items-center gap-6">
              <a href="#/about" className={NAV}>
                关于本工具
              </a>
              <a href="#/scope" className={NAV}>
                范围
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

interface HomeProps {
  onOpen: (templateId: string) => void;
  onToast: (message: string) => void;
}
void ({} as HomeProps);

/** 结果行：标题 + 一句话 + 科目 · 章节 + 右端标签（有图 / 可解题）。 */
function ResultRow({ hit }: { hit: KbSearchHit }) {
  const { entry } = hit;
  return (
    <li className="border-b border-line last:border-b-0">
      <a href={`#/kb/${entry.id}`} className="group flex items-start gap-4 px-4 py-2.5 transition-colors hover:bg-panel">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-6 text-ink transition-colors group-hover:text-cyan">{entry.title}</span>
          <span className="mt-0.5 block truncate text-[12px] text-faint">{entry.oneLine}</span>
          <span className="mt-0.5 block text-[11px] text-faint">
            {SUBJECT_LABEL[entry.subject]} · {entry.chapter}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-1">
          {(entry.figures?.length ?? 0) > 0 ? (
            <span className="rounded border border-line px-1.5 text-[11px] text-muted">有图</span>
          ) : null}
          {entry.solvable ? (
            <span className="rounded border border-cyan/40 bg-cyan/10 px-1.5 text-[11px] text-cyan">可解题</span>
          ) : (
            <span className="rounded border border-line px-1.5 text-[11px] text-faint">只讲</span>
          )}
        </span>
      </a>
    </li>
  );
}
