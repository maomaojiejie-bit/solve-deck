import { TEMPLATES } from '../core/templates/registry';
import { LAB_LEDGER, LAB_LEDGER_COUNTS, type Subject } from '../core/lab/coverage';
import { SITE_LINK, SiteHeader } from '../ui/SiteHeader';

interface AboutProps {
  onBack: () => void;
}

// base './' 时 BASE_URL 是 './'；子路径部署后仍是相对路径。
const SHOT_BASE = `${import.meta.env.BASE_URL}shots/`;

/** 开源仓库：全站只有这一处写死 GitHub 地址，换仓库改这里即可。 */
const GITHUB_URL = 'https://github.com/maomaojiejie-bit/solve-deck';
const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

/**
 * 数字从哪来（W21-C C1-1 重写版）：只有两种来源 —— 求解内核，或本页自算。
 * 不出现内部命令名、不出现实现目录名；每型在结果页的「自检」抽屉里可核对完整精度。
 */
const PROVENANCE = [
  { scope: 'M1–M4 内力与反力', source: '求解内核', detail: '内力 / 反力 / 应力全部来自求解内核，并与基准题逐字段对拍（933 个字段按 1e-9 钉住）。' },
  { scope: 'M8 组合应力', source: '内核给分量，本页合成', detail: 'σ=N/A+M·y/I 的叠加、σr4、中性轴位置由本页算，内核只给 N/M/T 分量。' },
  { scope: 'M5 变形 / M7 稳定 / M6 应力状态', source: '本页自算', detail: 'EI·v″=M 双积分、欧拉公式与 Rayleigh 商、莫尔圆与强度理论：内核不覆盖这四型的全部内容，每型都有两条以上互不依赖的算法对拍。' },
  { scope: '电路 A1–A7', source: '求解内核', detail: 'MNA 直流 / 增益求解；二极管按 Vf+1Ω 线性化、电容直流开路，页面上写明口径。' },
];

const BOUNDARIES = [
  '纯前端静态站：无后端、无网络请求、无账号。',
  '只解静定 / 可解析题型：小信号 CE/CB/CC、CS/CG/CD，组合逻辑与卡诺图，M1–M8 材料力学，S1–S7 静力学。',
  '不做：超静定解析、弹塑性、大变形、时序仿真、任意网表、三维与动力学。',
  '超静定直接拒绝：反例页只给「为什么拒」，不印反力数字。',
  '机构（几何可变）同样拒绝。',
  'M7 压杆稳定只在 λ ≥ λp 时给数；λ < λp 一律黄底拒绝作答，但会在 λ 轴上标出当前位置。',
  '每个结论都带六项校验；校验不过就不给结论。',
  '装配台只支持骨架 + 受支持的器件：可装配的 16 个入口（含 M3 悬臂变体）逐型列在下面的覆盖账本里。',
  '截面只有矩形 / 圆 / 圆管三类，没有型钢表；A / E / I / b / h / d / G / μ 是骨架级参数，在装配台右侧「确认已知量」里确认。',
];

/** 覆盖表第 4 列：按科目把「可装配 / 不适用」的账算出来，和明细账本同源。 */
function coverageSummary(subject: Subject): string {
  const rows = LAB_LEDGER.filter((row) => row.subject === subject);
  const ok = rows.filter((row) => row.status === 'assemblable').map((row) => row.id);
  const na = rows.filter((row) => row.status === 'na').map((row) => row.id);
  return `可装配 ${ok.length}：${ok.join('、') || '—'}；不适用 ${na.length}：${na.join('、') || '—'}`;
}

export function About({ onBack }: AboutProps) {
  const ready = TEMPLATES.filter((entry) => entry.status === 'ready');
  const analog = ready.filter((entry) => entry.subject === 'analog').length;
  const digital = ready.filter((entry) => entry.subject === 'digital').length;
  const mechanics = ready.filter((entry) => entry.subject === 'mechanics').length;
  const statics = ready.filter((entry) => entry.subject === 'statics').length;
  const variants = TEMPLATES.reduce((sum, entry) => sum + (entry.variants?.length ?? 0), 0);

  return (
    <div className="min-h-screen">
      <SiteHeader
        page="about"
        title="关于"
        note="能力边界 · 校验契约 · 更新记录"
        onBack={onBack}
        extra={
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 仓库（新窗口打开）"
            title="源码在 GitHub 上（新窗口打开）"
            className={`${SITE_LINK} flex items-center gap-1.5`}
          >
            <GitHubIcon />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        }
      />

      <main className="mx-auto w-full max-w-[1120px] space-y-12 px-6 pb-16 pt-10">
        {/* 第一屏：三步流程，与主页「先看懂，再算出来」呼应 */}
        <section data-testid="about-prime">
          <p className="id-mono text-[12px] tracking-[0.14em] text-faint">定位</p>
          <h1 className="mt-3 max-w-[640px] font-serif text-[32px] leading-[1.25] text-ink">
            先看懂一道题，再把它算出来
          </h1>
          <p className="mt-4 max-w-[600px] text-[15px] leading-[1.85] text-muted">
            这个站子分三步走。不熟的知识点，去知识库搜一条，思路、公式、图、坑都给你摆好；
            会做但想省时间，按模板解题——28 型每种都有自己的参数表；想自己动手改结构，
            去装配台：打开就是一张结构正确的图，支座挂在结点上、载荷有自己的位置和方向、器件连着该连的脚。
            删器件会合并串联，删结点会连带清掉支座与载荷。改到讲解稿装不下的程度，就按你改的那张图现算
            （电路现算按交流小信号口径：C 视为短路、L 视为开路）。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <a
              href="#/kb"
              className="focus-ring inline-flex h-11 items-center rounded-lg bg-cyan px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
            >
              去知识库
            </a>
            <a
              href="#/lab"
              className="focus-ring inline-flex h-11 items-center rounded-lg border border-line px-5 text-[14px] text-ink transition-colors hover:border-line-2"
            >
              打开装配台
            </a>
            <a href="#/t/M3" className="focus-ring text-[14px] text-muted transition-colors hover:text-ink">
              看一个例子 →
            </a>
            <span className="id-mono text-[12px] text-faint">纯前端 · 无账号 · 不联网</span>
          </div>
          <figure className="mt-8">
            <img
              src={`${SHOT_BASE}r32-product.png`}
              alt="装配台：左装配 / 中画布 / 右已知量"
              className="product-shot w-full rounded-lg border border-line"
            />
            <figcaption className="mt-2 text-[12px] text-faint">
              装配台 · 左装配 / 中画布 / 右已知量；同一份解、同一套六项校核、同一张打印稿
            </figcaption>
          </figure>
        </section>

        <section data-testid="kb-section">
          <h2 className="mb-2 text-[20px] font-medium text-ink">知识库</h2>
          <p className="max-w-[620px] text-[15px] leading-7 text-muted">
            知识点覆盖电路、数字、材力、理力四科，另有大学物理 / 高数 / C 基础扩展。每条给四样东西：怎么下手（解题思路）、
            哪几个公式够用、一张图、老师嘴上说过但书上不写的那种坑。能算的题型在条目页底部有按钮，
            点过去题型已经替你选好。搜索支持打错字——搜「莫而圆」也找得到莫尔圆。
          </p>
          <p className="mt-2 text-[12px] text-muted">
            <a href="#/kb" className="focus-ring text-cyan hover:underline">打开知识库 →</a>
          </p>
        </section>

        <section data-testid="provenance-section">
          <h2 className="mb-2 text-[20px] font-medium text-ink">数字从哪来</h2>
          <p className="mb-3 max-w-[620px] text-[15px] leading-7 text-muted">
            页面上每个数只有两种来源：求解内核算的，或本页自算的。逐型写清，不混成一套；
            完整精度与研发信息收在结果页的「自检」抽屉里。
          </p>
          <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[320px] text-left text-[12px]">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="w-56 px-3 py-2 font-normal">内容</th>
                  <th className="w-40 px-3 py-2 font-normal">来源</th>
                  <th className="px-3 py-2 font-normal">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {PROVENANCE.map((row) => (
                  <tr key={row.scope}>
                    <td className="px-3 py-2 text-ink">{row.scope}</td>
                    <td className="px-3 py-2 text-cyan">{row.source}</td>
                    <td className="break-words px-3 py-2 text-muted">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section data-testid="coverage-section">
          <h2 className="mb-2 text-[20px] font-medium text-ink">28 型样例与覆盖范围</h2>
          <p className="mb-3 max-w-[620px] text-[15px] leading-7 text-muted">
            装配台是入口，28 型是内容。这张账本逐型写清「装配台装的是什么」或「为什么不适用」。
          </p>
          <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-panel">
            <table data-testid="coverage-table" className="w-full min-w-[320px] table-fixed text-left text-[11px]">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="w-20 px-3 py-2 font-normal">科目</th>
                  <th className="px-3 py-2 font-normal">题目</th>
                  <th className="px-3 py-2 font-normal">组态变体</th>
                  <th className="px-3 py-2 font-normal">拼接台：可装配 / 不适用（原因）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                <tr>
                  <td className="px-3 py-2 text-ink">模拟电路</td>
                  <td className="px-3 py-2 text-ink">A1–A7（{analog} 题）</td>
                  <td className="px-3 py-2 text-muted">A3：CE/CB/CC；A5：CS/CG/CD</td>
                  <td data-testid="coverage-cell-analog" className="px-3 py-2 text-muted">{coverageSummary('模拟电路')}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink">数字电路</td>
                  <td className="px-3 py-2 text-ink">D1–D6（{digital} 题）</td>
                  <td className="px-3 py-2 text-muted">—</td>
                  <td data-testid="coverage-cell-digital" className="px-3 py-2 text-muted">{coverageSummary('数字电路')}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink">材料力学</td>
                  <td className="px-3 py-2 text-ink">M1–M8（{mechanics} 题）</td>
                  <td className="px-3 py-2 text-muted">M3：简支 / 悬臂</td>
                  <td data-testid="coverage-cell-mechanics" className="px-3 py-2 text-muted">{coverageSummary('材料力学')}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink">理论力学</td>
                  <td className="px-3 py-2 text-ink">S1–S7（{statics} 题）</td>
                  <td className="px-3 py-2 text-muted">
                    S1：静定判据（3 个算例：1 正 2 反）；S5：静定三角桁架（L/H/载荷可变）
                  </td>
                  <td data-testid="coverage-cell-statics" className="px-3 py-2 text-muted">{coverageSummary('理论力学')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            当前已就绪 {ready.length} 题 + {variants} 个组态变体；变体与母题共用同一套求解内核与六项校验。
          </p>

          <h3 className="mt-4 text-xs text-ink">逐型账本 · 可装配 {LAB_LEDGER_COUNTS.assemblable} / 不适用 {LAB_LEDGER_COUNTS.notApplicable}</h3>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            28 道母题 + M3 悬臂这一个组态变体 = {LAB_LEDGER_COUNTS.total} 个装配入口。
            「不适用」不是还没做：这一型没有可装配的几何（表达式、截面形状、质点、应力元）。
            每型的专属原因同时写在 <a href="#/lab/t/M6" className="text-cyan hover:underline">装配台的「不适用」卡</a>里，逐型可查。
          </p>
          <div className="mt-2 min-w-0 overflow-x-auto rounded-xl border border-line bg-panel">
            <table data-testid="coverage-ledger" className="w-full min-w-[320px] table-fixed text-left text-[11px] leading-5">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="w-20 px-3 py-2 font-normal">科目</th>
                  <th className="w-32 px-3 py-2 font-normal">型</th>
                  <th className="w-24 px-3 py-2 font-normal">拼接台</th>
                  <th className="px-3 py-2 font-normal">装的是什么 / 为什么不适用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {LAB_LEDGER.map((row) => (
                  <tr key={row.id} data-ledger-id={row.id}>
                    <td className="px-3 py-1.5 text-muted">{row.subject}</td>
                    <td className="id-mono whitespace-nowrap px-3 py-1.5 text-[10px] text-cyan">{row.id}</td>
                    <td className={`px-3 py-1.5 ${row.status === 'assemblable' ? 'text-ok' : 'text-amber'}`}>
                      {row.status === 'assemblable' ? '可装配' : '不适用'}
                    </td>
                    <td className="break-words px-3 py-1.5 text-muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section data-testid="opensource-section">
          <h2 className="mb-2 text-[20px] font-medium text-ink">开源</h2>
          <p className="max-w-[620px] text-[15px] leading-7 text-muted">
            源码在 GitHub 上，纯前端静态站：React + TypeScript + Vite + TailwindCSS，
            求解内核、40 道门禁脚本与三路径交叉校验全部在浏览器里本地运行 —— 没有后端，也没有任何遥测。
            发现算错、看不懂或想加题型，欢迎提 Issue：报错题截图 + 期望值就够定位。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
            >
              <GitHubIcon className="text-bg" />
              查看源码
            </a>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-10 items-center rounded-lg border border-line px-4 text-[13px] text-ink transition-colors hover:border-line-2"
            >
              提问题（Issues）
            </a>
            <a href="#/scope" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
              先看能解什么 →
            </a>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm text-ink">技术与边界</h2>
          <p className="mt-2 text-[12px] text-ink">
            超静定、空间力系、动力冲击、塑性大变形等不覆盖；
            拿不准的题先去 <a href="#/scope" className="text-cyan hover:underline">#/scope 六问判别</a> 走一遍。
          </p>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-muted">
            {BOUNDARIES.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-cyan">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="no-print border-t border-line">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-6 text-[12px] text-muted">
          <span className="id-mono text-faint">solve-deck</span>
          <span className="text-faint">先看懂一道题，再把它算出来</span>
          <span className="flex-1" aria-hidden="true" />
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="focus-ring flex items-center gap-1.5 transition-colors hover:text-ink">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <a href={GITHUB_ISSUES_URL} target="_blank" rel="noreferrer" className="focus-ring transition-colors hover:text-ink">
            反馈问题
          </a>
          <span className="text-faint">纯前端 · 无账号 · 不联网</span>
        </div>
      </footer>
    </div>
  );
}
