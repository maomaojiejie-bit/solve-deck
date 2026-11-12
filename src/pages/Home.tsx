/**
 * 首页（重设计 v3）：一屏只讲一件事 —— 贴一道题，看见它的结构。
 *
 * 设计约束（来自 tokens.css / unslop 的九道 pass）：
 *  · 一个亮点：右侧那张 M3 真算例图（梁 + 支座 + 荷载 + 弯矩三角形 + 三个真读数）
 *  · chrome 安静：页头一条发丝线，导航只在 hover/当前页变亮，不做底色不做阴影
 *  · 一个主操作：「看结构」；次操作是文字链接，不给第二个按钮
 *  · 文字落在留白里：左列 44ch 上限，标题到正文到输入框到按钮的间距按 8px 阶
 *  · 样例库是第二屏的清单（行式），不是一墙等高卡片
 */

import { useRef, useState } from 'react';
import type { TemplateEntry } from '../core/templates/registry';
import { TEMPLATES } from '../core/templates/registry';
import { READY_SUBJECTS } from '../core/subjects';
import { prepareImages } from '../ui/imagePipeline';
import { writeSolveSeed } from '../ui/solveSeed';
import { homeSolveTarget, type HomeCandidate } from '../core/ai/homeRoute.ts';
import { ThemeToggle } from '../ui/ThemeToggle';

interface HomeProps {
  onOpen: (templateId: string) => void;
  onToast: (message: string) => void;
}

const SHELL = 'mx-auto w-full max-w-[1120px] px-6';
const PRIMARY =
  'focus-ring inline-flex h-11 items-center rounded-lg bg-cyan px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90';
const QUIET = 'focus-ring text-[14px] text-muted transition-colors hover:text-ink';
const NAV = 'focus-ring text-[13px] text-muted transition-colors hover:text-ink';
const PRODUCT_SHOT = `${import.meta.env.BASE_URL}shots/r32-product.png`;

export function Home({ onOpen, onToast }: HomeProps) {
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  /** W21-B B3：多条命中时先给候选卡，不把用户丢去手动选题型。 */
  const [candidates, setCandidates] = useState<HomeCandidate[]>([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const readyEntries = TEMPLATES.filter((entry) => entry.status === 'ready');
  const readyCount = readyEntries.length;

  const goSolve = (text = seed) => {
    const target = homeSolveTarget(text);
    if (target.kind === 'multiple') {
      setCandidates(target.candidates);
      return;
    }
    setCandidates([]);
    window.location.hash = target.hash;
  };

  const acceptImage = async (files: readonly File[]) => {
    const picked = files.filter((file) => file.type.startsWith('image/'));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const { list, errors } = await prepareImages(picked.slice(0, 1), []);
      const image = list[0];
      if (image && writeSolveSeed({ text: seed, image })) {
        window.location.hash = '#/solve';
        return;
      }
      onToast(errors[0] ?? '这张图没接住（会话存储不可用）—— 到「看结构」页再贴一次');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="toolbar sticky top-0 z-20">
        <div className={`${SHELL} flex h-[52px] items-center gap-3`}>
          <span className="traffic shrink-0" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <a href="#/" className="focus-ring ml-2 flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-[15px] font-bold text-ink">拆解台</span>
            <span className="id-mono hidden text-faint sm:inline">SolveDeck</span>
            <span className="id-mono hidden text-faint sm:inline">· {readyCount} 型</span>
          </a>
          <nav className="ml-auto flex shrink-0 items-center gap-5 whitespace-nowrap sm:gap-7">
            <a href="#/lab" className={NAV}>
              装配台
            </a>
            <a href="#/lab/digital" className={NAV}>
              数字求值
            </a>
            <a href="#/about" className={NAV}>
              关于
            </a>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-enter">
        {/* 首屏：左列说的是什么，右列是它长什么样 */}
        <section className={`${SHELL} pt-16 pb-8 lg:pt-20`}>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(440px,520px)] lg:gap-16">
            <div>
              <p className="kicker">工科题目 · 结构 → 图 → 数</p>
              <h1 className="mt-4 text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[36px]">
                把一道工科题，
                <br className="hidden sm:block" />
                拆开给你看
              </h1>
              <p className="mt-5 max-w-[44ch] text-[15px] leading-[1.5] text-muted">
                贴一道题，先看清它的结构：受力、回路、门级。每处结构都配一张图，每个数字都由本机求解器算出，再过六道独立校核。
              </p>

              <div className="mt-9 max-w-[520px]">
                <textarea
                  ref={textRef}
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files];
                    if (files.length > 0) {
                      event.preventDefault();
                      void acceptImage(files);
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void acceptImage([...event.dataTransfer.files]);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      goSolve();
                    }
                  }}
                  rows={1}
                  placeholder={busy ? '正在预处理图片…' : '粘贴题面，或把题目截图拖进来'}
                  aria-label="题面"
                  className="focus-ring h-14 w-full resize-none rounded-lg border border-line-2 bg-panel px-4 py-4 text-[15px] leading-6 text-ink outline-none placeholder:text-faint focus:border-muted/50"
                />
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <button
                    type="button"
                    data-testid="home-see-structure"
                    onClick={() => goSolve()}
                    className={PRIMARY}
                  >
                    看结构
                  </button>
                  <a href="#/t/M3" className={QUIET}>
                    看一个例子 →
                  </a>
                </div>
                {/* W21-B B3：规则解析命中多型时，先在这里选一张，不跳去手动选题型。 */}
                {candidates.length > 0 ? (
                  <div data-testid="home-candidates" className="mt-4 rounded-lg border border-cyan/40 bg-panel-2 p-3">
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
                <p className="mt-5 flex items-center gap-2 text-[13px] leading-6 text-faint">
                  <span className="tick" aria-hidden />
                  不需要配置，也不需要联网。求解器在本机跑。
                </p>
              </div>
            </div>

            <SampleCard />
          </div>
        </section>

        {/* 指标先行（design.md KPI 卡）：只放名称、数字、状态芯片三件事 */}
        <section className={`${SHELL} pb-2`} data-testid="home-kpi-row">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['可解题型', String(readyCount), '就绪', 'ok', '覆盖数电 · 模电 · 材料力学 · 理论力学'],
              ['独立校核', '6', '全过', 'ok', '任一项不过就是红牌，不给数'],
              ['快照基线', '35', '钉住', 'cyan', '模板输出逐字节比对'],
              ['联网依赖', '0', '本机', 'muted', '求解器跑在你的浏览器里'],
            ].map(([name, value, chip, tone, note]) => (
              <div key={name} className="card px-5 py-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] text-muted">{name}</p>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                      tone === 'ok'
                        ? 'bg-ok/10 text-ok'
                        : tone === 'cyan'
                          ? 'bg-cyan/10 text-cyan'
                          : 'bg-ink/5 text-muted'
                    }`}
                  >
                    {chip}
                  </span>
                </div>
                <p className="mt-2 text-[36px] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
                  {value}
                </p>
                <p className="mt-1.5 text-[11px] text-faint">{note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 三条能力：编号 + 一段话，不做卡片不做图标 */}
        <section className={`${SHELL} border-t border-line`}>
          <div className="grid gap-x-12 gap-y-10 pt-8 pb-16 sm:grid-cols-3">
            {[
              ['01', '能解什么', '28 型，覆盖数电、模电、材料力学、理论力学。超出范围的当场拒答，并说清该用哪种方法。'],
              ['02', '怎么算的', '求解器是本仓库的代码：MNA、框架刚度法、门级求值。图上的数字不经过任何模型。'],
              ['03', '凭什么可信', '六道独立校核 + 35 份快照基线。任一项不过就是红牌，不给数。'],
            ].map(([index, title, body]) => (
              <div key={index}>
                <p className="kicker">{index}</p>
                <h2 className="mt-3 font-sans text-[17px] font-semibold text-ink">{title}</h2>
                <p className="mt-2.5 max-w-[34ch] text-[13px] leading-[1.5] text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 真产品图：一张，带框，不加阴影不加光 */}
        <section className={`${SHELL} border-t border-line`}>
          <figure className="py-16" data-testid="home-product">
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

        {/* 样例库：行式清单（第二屏），不再是一墙等高卡片 */}
        <section className={`${SHELL} border-t border-line`}>
          <div className="py-16">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="text-[17px] font-medium text-ink">样例库 · {readyCount} 型</h2>
              <p className="text-[13px] text-faint">每型都有独立快照与六项校核；点开看五步推导。</p>
            </div>

            {READY_SUBJECTS.map((subject) => {
              const entries = readyEntries.filter((entry) => entry.subject === subject.key);
              if (entries.length === 0) return null;
              return (
                <div key={subject.key} className="mt-10">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="id-mono text-faint">{subject.code}</h3>
                    <span className="text-[13px] font-medium text-ink">{subject.label}</span>
                    <span className="text-[13px] text-faint">{subject.hint}</span>
                  </div>
                  <ul className="mt-3 border-t border-line">
                    {entries.map((entry) => (
                      <TemplateRow key={entry.id} entry={entry} onOpen={onOpen} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="border-t border-line">
          <div className={`${SHELL} flex flex-wrap items-center gap-x-6 gap-y-2 py-8`}>
            <p className="id-mono text-faint">
              拆解台 SolveDeck · {readyCount} 型 · 6 项校核 · 本地求解器
            </p>
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

/**
 * 右侧那张「真算例」：M3 简支梁跨中集中力，L=4 / P=20。
 * 图是内联 SVG（和 app 里同一套几何），数字是快照里的真值，不是占位。
 */
function SampleCard() {
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <p className="id-mono text-muted">M3 · 简支梁跨中集中力 · 默认算例</p>
        <p className="flex items-center gap-1.5 text-[12px] text-ok">
          <span className="tick" aria-hidden />
          已校验 6/6
        </p>
      </div>

      <svg viewBox="0 0 520 232" className="block w-full" role="img" aria-label="简支梁受力图与弯矩图">
        {/* 梁 */}
        <line x1="60" y1="64" x2="460" y2="64" stroke="var(--color-muted)" strokeWidth="2" />
        {/* 左固定铰 */}
        <path d="M60 64 L46 90 L74 90 Z" fill="none" stroke="var(--color-muted)" strokeWidth="1.6" />
        <line x1="38" y1="90" x2="82" y2="90" stroke="var(--color-muted)" strokeWidth="1.6" />
        {/* 右可动铰 */}
        <path d="M460 64 L446 90 L474 90 Z" fill="none" stroke="var(--color-muted)" strokeWidth="1.6" />
        <circle cx="453" cy="96" r="3" fill="none" stroke="var(--color-muted)" strokeWidth="1.4" />
        <circle cx="467" cy="96" r="3" fill="none" stroke="var(--color-muted)" strokeWidth="1.4" />
        <line x1="434" y1="102" x2="486" y2="102" stroke="var(--color-muted)" strokeWidth="1.6" />
        {/* 跨中集中力 */}
        <line x1="260" y1="12" x2="260" y2="52" stroke="var(--color-ink)" strokeWidth="1.8" />
        <path d="M260 64 L252 48 L268 48 Z" fill="var(--color-ink)" />
        <text x="270" y="24" fill="var(--color-faint)" fontSize="12" fontFamily="var(--font-mono)">
          P = 20 kN
        </text>
        <text x="236" y="88" fill="var(--color-faint)" fontSize="12" fontFamily="var(--font-mono)">
          L = 4 m
        </text>

        {/* 弯矩图：跨中 20 kN·m 的三角形 */}
        <line x1="60" y1="212" x2="460" y2="212" stroke="var(--color-line-2)" strokeWidth="1" />
        <path
          d="M60 212 L260 136 L460 212 Z"
          fill="var(--chart-area-fill)"
          stroke="var(--color-cyan)"
          strokeWidth="1.6"
        />
        <text x="270" y="132" fill="var(--color-cyan)" fontSize="11" fontFamily="var(--font-mono)">
          Mmax 20.00
        </text>
      </svg>

      <dl className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
        {[
          ['R_A', '10.00', 'kN'],
          ['R_B', '10.00', 'kN'],
          ['Mmax', '20.00', 'kN·m'],
        ].map(([label, value, unit]) => (
          <div key={label} className="bg-panel px-4 py-3">
            <dt className="id-mono text-faint">{label}</dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="text-[15px] text-ink">{value}</span>
              <span className="text-[11px] text-faint">{unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="border-t border-line px-4 py-3 text-[12px] leading-6 text-faint">
        六项校核全过：ΣF=0、ΣM=0、dM/dx=Q、端部条件、连续性、量级
      </p>
    </div>
  );
}

/** 样例行：id · 标题 · 路径，一行看完；hover 只换底色。 */
function TemplateRow({ entry, onOpen }: { entry: TemplateEntry; onOpen: (templateId: string) => void }) {
  return (
    <li className="border-b border-line">
      <div className="group flex items-start gap-4 py-3 transition-colors hover:bg-panel">
        <button
          type="button"
          onClick={() => onOpen(entry.id)}
          aria-label={`${entry.id} ${entry.title}`}
          className="focus-ring flex min-w-0 flex-1 cursor-pointer items-baseline gap-4 px-1 text-left"
        >
          <span className="id-mono w-14 shrink-0 text-faint transition-colors group-hover:text-cyan">
            {entry.id}
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-6 text-ink">{entry.title}</span>
          <span className="hidden min-w-0 shrink-0 basis-[40%] truncate text-[12px] text-faint lg:block">
            {entry.paths.map((path) => path.label).join(' / ')}
          </span>
        </button>
        {(entry.variants ?? []).length > 0 ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5 pt-0.5" aria-label={`${entry.id} 组态变体`}>
            {(entry.variants ?? []).map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => onOpen(variant.id)}
                aria-label={`${variant.id} ${variant.title}`}
                className="focus-ring cursor-pointer rounded border border-line px-1.5 text-[12px] text-muted transition-colors hover:border-line-2 hover:text-ink"
              >
                {variant.short}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
