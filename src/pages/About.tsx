import { TEMPLATES } from '../core/templates/registry';
import { LAB_LEDGER, LAB_LEDGER_COUNTS, type Subject } from '../core/lab/coverage';
import { ThemeToggle } from '../ui/ThemeToggle';

interface AboutProps {
  onBack: () => void;
}

// base './' 时 BASE_URL 是 './'；子路径部署后仍是相对路径。
const SHOT_BASE = `${import.meta.env.BASE_URL}shots/`;

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
  '超静定直接拒绝：S1 的两个反例（pin+pin、双平行辊）让你亲眼看它拒绝 —— 页头红条写明「反例」，结果位一个反力数字都不印。',
  '机构（几何可变）靠约束矩阵的秩判据识别，同样拒绝；不是「算出来一个很大的数」蒙过去。',
  'M7 压杆稳定只在 λ ≥ λp 时给数；λ < λp 一律黄底拒绝作答，但会在 λ 轴上标出当前位置。',
  '每个结论都带六项校验；校验不过就不给结论。',
  '装配台只支持骨架 + 白名单器件：可装配的 16 个入口（含 M3 悬臂变体）逐型列在下面的覆盖账本里。',
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
      <header className="no-print sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-6">
          <button
            type="button"
            onClick={onBack}
            className="focus-ring text-[13px] text-muted transition-colors hover:text-ink"
          >
            ← 返回
          </button>
          <span className="text-[13px] text-muted">关于</span>
          <a href="#/" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            返回首页
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] space-y-12 px-6 pb-16 pt-10">
        {/* 第一屏先讲装配台，再讲 28 型样例 */}
        <section data-testid="about-prime">
          <p className="id-mono text-[12px] tracking-[0.14em] text-faint">定位</p>
          <h1 className="mt-3 max-w-[640px] font-serif text-[32px] leading-[1.25] text-ink">
            主角是装配台：先给你一张对的图，再让你改它
          </h1>
          <p className="mt-4 max-w-[600px] text-[15px] leading-[1.85] text-muted">
            打开就是一张结构正确的图 —— 支座挂在结点上、载荷有自己的位置与方向、器件连着该连的脚；
            删器件会合并串联，删结点会连带清掉支座与载荷。改完结构，右侧逐项确认已知量，
            再由同一个求解内核算出结果与六项校核；改到讲解稿装不下的程度，就按你改的那张图现算（电路现算按交流小信号口径：C 视为短路、L 视为开路）。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <a
              href="#/lab"
              className="focus-ring inline-flex h-11 items-center rounded-lg bg-cyan px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
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

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm text-ink">技术与边界</h2>
          <p className="mt-2 text-[12px] text-ink">
            它不假装什么都能算。超静定、空间力系、动力冲击、塑性大变形这类题，本工具直接说「不覆盖」；
            不确定自己那道题在不在范围内，去 <a href="#/scope" className="text-cyan hover:underline">#/scope 六问判别</a> 走一遍。
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
    </div>
  );
}
