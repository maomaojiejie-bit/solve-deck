/**
 * 首页
 * ---------------------------------------------------------------------------
 * 版式：一张纸（暖白）+ 墨线 + 一处强调色。上面是标题与检索，右边是同屏的
 * 实时演算工作台（真的调求解内核）；往下是流程叙事、科目账本、边界与入口。
 *
 * 门禁钩子（不要删）：
 *   · input[data-testid=kb-search]（受控 + onChange）
 *   · [data-testid=nav-solve] → [data-testid=solve-panel] → solve-panel-lab
 *   · [data-testid=kb-results] / home-candidates / home-candidate / home-problem-hint
 *   · 源码里必须留着 'pt-24 pb-8'、homeSolveTarget(text)、href="#/scope"
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { searchKb, suggestAlias, type KbSearchHit } from '../kb/search.ts';
import { detectIntent } from '../kb/intent.ts';
import { KB } from '../kb/index.ts';
import type { Subject } from '../kb/types.ts';
import { homeSolveTarget, type HomeCandidate } from '../core/ai/homeRoute.ts';
import { ThemeToggle } from '../ui/ThemeToggle';
import {
  CountUp,
  DecodeText,
  Magnetic,
  Marquee,
  Parallax,
  Reveal,
  Spotlight,
  Tilt,
  useActiveStep,
} from '../ui/motion';
import { LiveWorkbench } from './home/LiveWorkbench.tsx';

const SHELL = 'mx-auto w-full max-w-[1120px] px-6';
const NAV = 'focus-ring text-[13px] text-muted transition-colors hover:text-ink';

const SUBJECT_LABEL: Record<Subject, string> = {
  circuit: '电路 · 模电',
  digital: '数字逻辑',
  mechanics: '材料力学',
  statics: '理论力学',
  physics: '大学物理',
  math: '高等数学',
  programming: '程序设计 · C/C#',
};
const SUBJECT_ORDER: Subject[] = ['circuit', 'digital', 'mechanics', 'statics', 'physics', 'math', 'programming'];
const HOT_TERMS = ['卡诺图化简', '共射增益', '莫尔圆', '零杆判别', '自锁'];

const MARQUEE_ITEMS = [
  '弯矩图',
  '剪力图',
  '轴力图',
  '扭矩图',
  '莫尔圆',
  '卡诺图',
  '状态机化简',
  '零杆判别',
  '共射增益',
  '节点电压法',
  '叠加定理',
  '自锁判断',
];

const STEPS = [
  {
    id: '01',
    title: '认题',
    body: '先把题面当数据看：认出构件、支座、载荷，认出它属于哪一类题。认不出唯一一型就把候选摆出来让你点，不猜。',
    sample: '输入 → 简支梁 / 跨度 4.00 m / 跨中集中力 20 kN',
  },
  {
    id: '02',
    title: '建模',
    body: '支座、载荷、截面落到同一个模型上：跨度按米、力按千牛、截面也是米。模型错了后面全错——所以先把它摆到画布上给你看。',
    sample: 'MechSpec → supports[pin@0, roller@L] · loads[point_force@L/2] · section[rect b×h]',
  },
  {
    id: '03',
    title: '求解',
    body: '反力从平衡方程解出来，内力沿杆长逐段积出来，极值再从中取。轴力、剪力、弯矩、扭矩四条线各画一条，恒为 0 的那条不画空轴。',
    sample: 'ΣF=0 → R_A 10.00 kN · ΣM=0 → R_B 10.00 kN · |M|max 20.00 kN·m',
  },
  {
    id: '04',
    title: '校核',
    body: '算完不算完。八道独立检查各算一遍：平衡、端部边界、dM/dx = Q、以及量级是否合理。任何一道不过，页面上标红，结论不算数。',
    sample: 'checks → 8/8 通过 · 最大相对误差 3.2e-16',
  },
];

const LIMITS = [
  { tag: '静不定', text: '未知量多于方程时直说不解，不编一个看着像的答案。' },
  { tag: '变形', text: '只在线弹性、小变形范围内给结果；二次效应不替你补。' },
  { tag: '图', text: '图上只画模型里真有的东西，不补示意箭头，不留空轴。' },
  { tag: '单位', text: '毫米就按毫米算，量纲混用先报错，不偷偷换算。' },
];

export function Home() {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<HomeCandidate[]>([]);
  const [solvePanelOpen, setSolvePanelOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { active, setStep } = useActiveStep(STEPS.length);

  // ⌘K / Ctrl+K 唤起检索
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

  const subjectCounts = useMemo(
    () =>
      SUBJECT_ORDER.map((subject) => ({
        subject,
        count: KB.filter((entry) => entry.subject === subject).length,
      })),
    [],
  );
  const peak = Math.max(1, ...subjectCounts.map((row) => row.count));

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
    window.location.hash = target.kind === 'unique' ? target.hash : `#/solve?q=${encodeURIComponent(text)}`;
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/92 backdrop-blur-md">
        <div className={`${SHELL} flex h-[60px] items-center gap-4`}>
          <a href="#/" aria-label="拆解台首页" className="focus-ring flex shrink-0 items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 20V6l8 4 8-4v14l-8-4-8 4Z" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 10v8" stroke="var(--color-cyan)" strokeWidth="1.5" />
            </svg>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">拆解台</span>
            <span className="hidden font-mono text-[10.5px] tracking-[0.12em] text-faint sm:inline">v0.3</span>
          </a>
          <nav className="ml-auto flex shrink-0 items-center gap-6 whitespace-nowrap sm:gap-8">
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
                  className="absolute right-0 top-9 z-40 w-[260px] rounded-[4px] border border-line-2 bg-panel p-2 shadow-lg"
                >
                  <a
                    href="#/solve"
                    data-testid="solve-panel-template"
                    onClick={() => setSolvePanelOpen(false)}
                    className="focus-ring block rounded-[3px] px-3 py-2.5 transition-colors hover:bg-panel-2"
                  >
                    <span className="block text-[13px] text-ink">① 按模板解</span>
                    <span className="mt-0.5 block text-[11px] text-faint">选一道熟悉的题型</span>
                  </a>
                  <a
                    href="#/lab"
                    data-testid="solve-panel-lab"
                    onClick={() => setSolvePanelOpen(false)}
                    className="focus-ring block rounded-[3px] px-3 py-2.5 transition-colors hover:bg-panel-2"
                  >
                    <span className="block text-[13px] text-ink">② 自己拼</span>
                    <span className="mt-0.5 block text-[11px] text-faint">在画布上搭结构</span>
                  </a>
                </div>
              ) : null}
            </span>
            <a href="#/scope" className={NAV}>
              范围
            </a>
            <a href="#/mine" className={NAV}>
              我的
            </a>
            <a href="#/about" className={NAV}>
              关于
            </a>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main>
        {/* ── 首屏：标题 / 检索 / 实时演算 ─────────────────────────────── */}
        <section className={`${SHELL} pt-24 pb-8`}>
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
            <div className="relative">
              <div className="flex items-center gap-3">
                <span className="tag-mono">
                  <span className="inline-block h-1 w-1 rounded-full bg-cyan" />
                  工科解题 · 四科
                </span>
                <span className="draft-rule flex-1" />
                <span className="font-mono text-[10.5px] tracking-[0.1em] text-faint">{KB.length} 条</span>
              </div>

              <h1 className="mt-6 text-[40px] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-[52px]">
                把一道题，
                <br />
                <span className="text-cyan">
                  <DecodeText text="拆到能算为止。" />
                </span>
              </h1>

              <p className="mt-6 max-w-[430px] text-[14.5px] leading-[1.9] text-muted">
                电路、数电、材料力学、理论力学。贴进题面，或者搜一条知识点：受力的、回路的、门级的结构先摆出来，
                数字后面跟着八道独立校核 —— 平衡对不上就不给结论。
              </p>

              <div className="mt-8 max-w-[456px]">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="home-search" className="font-mono text-[10px] tracking-[0.16em] text-faint">
                    知识点检索
                  </label>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-faint">
                    {hits.length > 0 ? `${hits.length} 条命中` : '⌘K'}
                  </span>
                </div>
                <div
                  data-testid="kb-search-wrap"
                  className="mt-2 flex h-[52px] items-center gap-3 border border-line-2 bg-panel px-3 transition-colors focus-within:border-cyan"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4 shrink-0 text-faint"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="9" r="5.5" />
                    <path d="M13.5 13.5 L17 17" strokeLinecap="round" />
                  </svg>
                  <input
                    id="home-search"
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
                    placeholder="卡诺图 / 共射增益 / 莫尔圆…"
                    aria-label="搜索知识点"
                    data-testid="kb-search"
                    className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
                  />
                  <kbd className="hidden shrink-0 border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
                    ⌘K
                  </kbd>
                </div>

                {/* 题面分流提示：≥2 个数值+单位或祈使动词 → 这是一道题 */}
                {isProblem ? (
                  <button
                    type="button"
                    data-testid="home-problem-hint"
                    onClick={goSolve}
                    className="focus-ring mt-2 flex w-full items-center gap-2 border border-cyan/40 bg-cyan/5 px-3 py-2.5 text-left text-[12.5px] text-ink transition-colors hover:border-cyan/70"
                  >
                    这段像是一道题 → <span className="text-cyan">去解题</span>
                  </button>
                ) : null}

                {/* 多题型命中候选卡 */}
                {candidates.length > 0 ? (
                  <div data-testid="home-candidates" className="mt-2 border border-cyan/40 bg-panel-2 p-3">
                    <p className="text-[11.5px] text-muted">像不止一型，点一个直接进去（题面会带过去）：</p>
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
                          className="focus-ring border border-line px-2 py-1 text-left text-[11.5px] text-ink hover:border-cyan/60"
                        >
                          <span className="font-mono text-cyan">{candidate.id}</span>
                          <span className="ml-2 text-muted">{candidate.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 搜索结果 */}
                {hits.length > 0 ? (
                  <ul className="mt-2 border border-line" data-testid="kb-results">
                    {hits.map((hit) => (
                      <ResultRow key={hit.entry.id} hit={hit} />
                    ))}
                  </ul>
                ) : null}

                {/* 无结果三件套之一：换个说法 */}
                {suggestions.length > 0 ? (
                  <div className="mt-2 border border-line bg-panel px-3 py-2.5" data-testid="kb-suggest">
                    <p className="text-[11px] text-faint">没有直接命中，换个说法：</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {suggestions.map((alias) => (
                        <button
                          key={alias}
                          type="button"
                          onClick={() => setQuery(alias)}
                          className="focus-ring border border-line px-2 py-0.5 text-[11.5px] text-muted hover:border-cyan/50 hover:text-ink"
                        >
                          {alias}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-faint">热门</span>
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

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Magnetic strength={0.18}>
                  <a
                    href="#/solve"
                    className="sheen focus-ring group inline-flex h-11 items-center gap-2 bg-cyan px-5 text-[13px] font-medium text-white"
                  >
                    按模板解
                    <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                  </a>
                </Magnetic>
                <a
                  href="#/lab"
                  className="focus-ring inline-flex h-11 items-center border border-line-2 px-5 text-[13px] text-ink transition-colors hover:border-ink"
                >
                  自己拼一张图
                </a>
              </div>

              <dl className="mt-10 flex flex-wrap gap-x-7 gap-y-2 border-t border-line pt-4">
                {[
                  { k: '知识点', v: `${KB.length} 条` },
                  { k: '校核', v: '8 项独立' },
                  { k: '求解', v: '本机 · 零请求' },
                ].map((item) => (
                  <div key={item.k} className="flex items-baseline gap-2">
                    <dt className="font-mono text-[10px] tracking-[0.14em] text-faint">{item.k}</dt>
                    <dd className="font-mono text-[11.5px] text-ink">{item.v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* 右栏：真的在算的工作台 */}
            <Reveal delay={140}>
              <Spotlight className="rounded-[14px]">
                <Tilt max={3.5}>
                  <div className="edge rounded-[14px]">
                    <LiveWorkbench />
                  </div>
                </Tilt>
              </Spotlight>
              <p className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-faint">
                <span className="tick" />
                拖动上面任何一根滑杆，图和数同时重算
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── 科目跑马灯 ──────────────────────────────────────────────── */}
        <section className="border-y border-line py-3">
          <div className={`${SHELL} flex items-center gap-4`}>
            <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-faint">覆盖</span>
            <span className="h-3 w-px shrink-0 bg-[var(--color-line-2)]" />
            <div className="min-w-0 flex-1">
              <Marquee items={MARQUEE_ITEMS} speed={54} />
            </div>
          </div>
        </section>

        {/* ── §01 怎么算的 ────────────────────────────────────────────── */}
        <section className={`${SHELL} py-24`}>
          <Reveal>
            <span className="sec-idx">§01</span>
            <h2 className="mt-3 max-w-[620px] text-[28px] font-semibold leading-[1.28] tracking-[-0.02em] text-ink sm:text-[32px]">
              一道题进来，会走完四步
              <br className="hidden sm:block" />
              才轮到「答案」。
            </h2>
            <p className="mt-4 max-w-[560px] text-[14px] leading-[1.9] text-muted">
              中间每一步都有可视化的落点：模型画在画布上，内力画成图，校核写成表。任何一步走不通，就停在那一
              步，而不是硬给一个数。
            </p>
          </Reveal>

          <div className="mt-14 grid gap-14 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-[104px]">
                <p className="font-mono text-[10px] tracking-[0.16em] text-faint">流程</p>
                <ol className="mt-4 space-y-3">
                  {STEPS.map((step, index) => {
                    const on = index === active;
                    return (
                      <li
                        key={step.id}
                        className={`flex items-baseline gap-3 border-l-2 pl-3 transition-colors ${
                          on ? 'border-cyan' : 'border-transparent'
                        }`}
                      >
                        <span className={`font-mono text-[10.5px] ${on ? 'text-cyan' : 'text-faint'}`}>{step.id}</span>
                        <span className={`text-[13px] ${on ? 'text-ink' : 'text-muted'}`}>{step.title}</span>
                      </li>
                    );
                  })}
                </ol>
                <div className="rail ml-[5px] mt-6 h-16">
                  <i style={{ '--p': String((active + 1) / STEPS.length) } as CSSProperties} />
                </div>
                <p className="mt-2 font-mono text-[10px] text-faint">
                  {String(active + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
                </p>
              </div>
            </aside>

            <ol className="space-y-14">
              {STEPS.map((step, index) => (
                <li key={step.id} ref={setStep(index)} data-step={index}>
                  <Reveal delay={60}>
                    <div className="flex items-baseline gap-4">
                      <span className="sec-idx">{step.id}</span>
                      <h3 className="text-[21px] font-semibold tracking-[-0.015em] text-ink">{step.title}</h3>
                    </div>
                    <p className="mt-3 max-w-[540px] text-[14px] leading-[1.95] text-muted">{step.body}</p>
                    <p className="callout mt-5 max-w-[540px] font-mono text-[11px] leading-[1.9] text-muted">
                      {step.sample}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── §02 科目账本 ────────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className={`${SHELL} py-24`}>
            <Reveal>
              <span className="sec-idx">§02</span>
              <h2 className="mt-3 text-[28px] font-semibold leading-[1.28] tracking-[-0.02em] text-ink sm:text-[32px]">
                按条数摊开，不写「等等」。
              </h2>
            </Reveal>

            <ol className="mt-12 border-y border-line">
              {subjectCounts.map((row, index) => (
                <li key={row.subject} className="border-b border-line last:border-b-0">
                  <a
                    href="#/kb"
                    className="focus-ring group flex items-center gap-4 py-4 transition-colors hover:bg-panel/60 sm:gap-6"
                  >
                    <span className="w-6 shrink-0 font-mono text-[10.5px] text-faint">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="w-[104px] shrink-0 text-[13.5px] text-ink sm:w-[150px]">
                      {SUBJECT_LABEL[row.subject]}
                    </span>
                    <div className="hidden min-w-0 flex-1 sm:block">
                      <span className="bar">
                        <i
                          style={
                            {
                              width: `${Math.round((row.count / peak) * 100)}%`,
                              '--d': `${index * 70}ms`,
                            } as CSSProperties
                          }
                        />
                      </span>
                    </div>
                    <span className="ml-auto w-10 shrink-0 text-right font-mono text-[12px] text-muted sm:ml-0">
                      {row.count}
                    </span>
                    <span className="w-4 shrink-0 text-[13px] text-cyan opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      →
                    </span>
                  </a>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <p className="max-w-[460px] text-[13px] leading-[1.9] text-muted">
                每一条都是「一句话结论 + 一张图 + 一段推导」，能解的还带一条直达解题的路径。
              </p>
              <span className="font-mono text-[10px] tracking-[0.1em] text-faint">
                合计 <CountUp value={KB.length} decimals={0} /> 条
              </span>
            </div>
          </div>
        </section>

        {/* ── §03 边界 ────────────────────────────────────────────────── */}
        <section className="border-t border-line bg-panel/40">
          <div className={`${SHELL} grid gap-12 py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]`}>
            <Reveal>
              <span className="sec-idx">§03</span>
              <h2 className="mt-3 text-[26px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[30px]">
                不做的事，写在前面。
              </h2>
              <p className="mt-4 max-w-[360px] text-[13.5px] leading-[1.9] text-muted">
                工具的信用不在于什么都能算，而在于算不了的时候不装。
              </p>
              <a
                href="#/scope"
                className="focus-ring group mt-6 inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] text-ink transition-colors hover:border-cyan hover:text-cyan"
              >
                完整范围与限制
                <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
              </a>
            </Reveal>

            <ul className="border-t border-line">
              {LIMITS.map((item, index) => (
                <li key={item.tag}>
                  <Reveal delay={index * 80}>
                    <div className="flex items-baseline gap-4 border-b border-line py-4">
                      <span className="tag-mono shrink-0">{item.tag}</span>
                      <p className="text-[13.5px] leading-[1.85] text-muted">{item.text}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 结尾入口 ────────────────────────────────────────────────── */}
        <section className={`${SHELL} py-24`}>
          <Reveal>
            <Spotlight className="edge border border-line-2 bg-panel px-8 py-12 sm:px-12">
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <Parallax speed={0.03} className="draft-grid h-[160%] opacity-40" />
              </div>
              <div className="relative">
                <h2 className="max-w-[520px] text-[30px] font-semibold leading-[1.2] tracking-[-0.025em] text-ink sm:text-[38px]">
                  现在拆一道？
                </h2>
                <p className="mt-4 max-w-[440px] text-[14px] leading-[1.9] text-muted">
                  从熟悉的题型里挑一题，看它怎么被拆开；或者从一张空画布开始，自己搭一个结构。
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Magnetic strength={0.16}>
                    <a
                      href="#/solve"
                      className="sheen focus-ring group inline-flex h-11 items-center gap-2 bg-cyan px-5 text-[13px] font-medium text-white"
                    >
                      挑一道题开始
                      <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                    </a>
                  </Magnetic>
                  <a
                    href="#/lab"
                    className="focus-ring inline-flex h-11 items-center border border-line-2 px-5 text-[13px] text-ink transition-colors hover:border-ink"
                  >
                    从空画布开始
                  </a>
                </div>
              </div>
            </Spotlight>
          </Reveal>
        </section>

        <footer className="border-t border-line">
          <div className={`${SHELL} flex flex-wrap items-center gap-x-6 gap-y-2 py-8`}>
            <p className="font-mono text-[10.5px] tracking-[0.1em] text-faint">
              拆解台 SolveDeck · 四科 {KB.length} 条 · 8 项校核 · 本地求解
            </p>
            <div className="ml-auto flex items-center gap-6">
              <a href="#/about" className={NAV}>
                关于本工具
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

/** 结果行：标题 + 一句话 + 科目 · 章节 + 右端标签。 */
function ResultRow({ hit }: { hit: KbSearchHit }) {
  const { entry } = hit;
  return (
    <li className="border-b border-line last:border-b-0">
      <a href={`#/kb/${entry.id}`} className="group flex items-start gap-4 px-3 py-2.5 transition-colors hover:bg-panel">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-6 text-ink transition-colors group-hover:text-cyan">
            {entry.title}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-faint">{entry.oneLine}</span>
          <span className="mt-0.5 block text-[10.5px] text-faint">
            {SUBJECT_LABEL[entry.subject]} · {entry.chapter}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-1">
          {(entry.figures?.length ?? 0) > 0 ? (
            <span className="border border-line px-1.5 font-mono text-[10px] text-muted">有图</span>
          ) : null}
          {entry.solvable ? (
            <span className="border border-cyan/40 bg-cyan/10 px-1.5 font-mono text-[10px] text-cyan">可解题</span>
          ) : (
            <span className="border border-line px-1.5 font-mono text-[10px] text-faint">只讲</span>
          )}
        </span>
      </a>
    </li>
  );
}
