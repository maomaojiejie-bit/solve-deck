import { useEffect, useMemo, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import { CONTRACT_VERSION, type CheckState, type Solution } from '../core/types';
import { isLabSupported } from '../core/lab/ids';
import {
  getTemplate,
  getTemplateRoute,
  type ParamSpec,
  type ParamValue,
  type Solver,
} from '../core/templates/registry';
import { getExample } from '../examples';
import { validateLive } from '../confidence/live';
import {
  bitsToValue,
  buildParamQuery,
  buildSolverInput,
  cloneDefault,
  defaultParamValues,
  parseParamQuery,
} from '../core/params/query';
import { ParamPanel } from '../ui/ParamPanel';
import {
  nextSpeed,
  nextStep,
  prevStep,
  stepDurationMs,
  type PlayerSpeed,
} from '../core/player';
import { Formula } from '../render/Formula';
import { SpecGrid } from '../render/SpecGrid';
import { isFullyValidated } from '../confidence/confidence.ts';
import { ConfidenceBadge, confidenceTone } from '../ui/ConfidenceBadge';
import { confidenceSummary, formatDisplayValue, skippedChecks } from '../ui/confidenceSummary';
import { StepPlayer } from '../ui/StepPlayer';
import { ThemeToggle } from '../ui/ThemeToggle';
import { assumptionLines, parseSimplifications } from '../core/scope/simplifications';

/** 结果位只给人话：判据名不许露 unknownCount 这类英文键。 */
const RESULT_KEY_LABELS: Record<string, string> = {
  unknownCount: '未知量数',
  equationCount: '方程数',
  rank: '矩阵秩',
  config: '组态',
  status: '状态',
  conclusion: '结论',
  remedy: '怎么改',
};

function humanizeKeys(data: Record<string, number | string>): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [RESULT_KEY_LABELS[key] ?? key, value]),
  );
}

interface ResultProps {
  templateId: string;
  search: string;
  onBack: () => void;
  onToast: (message: string) => void;
}

const STATE_CLASS: Record<CheckState, string> = {
  pass: 'border-ok/40 text-ok',
  fail: 'border-danger/40 text-danger',
  skipped: 'border-line text-muted',
};

const GRAY_INDEX = [0, 1, 3, 2];

function liveSelectionFor(
  entryId: string,
  params: readonly ParamSpec[],
  values: Record<string, ParamValue>,
  solution: Solution | null,
) {
  if (!solution || !['D1', 'D2', 'D3'].includes(entryId)) return undefined;
  const spec = params.find((param) => param.kind === 'bits');
  const bits = spec && Array.isArray(values[spec.key])
    ? (values[spec.key] as number[])
    : [];
  if (bits.length === 0) return undefined;
  const table = solution.render_specs.find((item) => item.type === 'table')?.table;
  const row = bitsToValue(bits);
  const output = table?.rows[row]?.out[0];
  const active: Record<string, string[]> = {};

  if (entryId === 'D2') {
    const [a, b, c] = bits;
    const g1 = a & b;
    const g2 = c ? 0 : 1;
    const g3 = g1 | g2;
    const f = g3;
    const nodes = ['node-A', 'node-B', 'node-C'];
    const edges = ['edge-A-G1', 'edge-B-G1', 'edge-C-G2'];
    if (g1) nodes.push('node-G1');
    if (g2) nodes.push('node-G2');
    if (g3) nodes.push('node-G3');
    if (f) nodes.push('node-F');
    if (g1) edges.push('edge-G1-G3');
    if (g2) edges.push('edge-G2-G3');
    if (g3) edges.push('edge-G3-F');
    active.main = [...nodes, ...edges];
  }

  if (entryId === 'D3' && bits.length === 3) {
    const [s, a, b] = bits;
    const g1 = s ? 0 : 1;
    const g2 = g1 & a;
    const g3 = s & b;
    const g4 = g2 | g3;
    const f = g4;
    const nodes = ['node-S', 'node-A', 'node-B'];
    const edges = ['edge-S-G1', 'edge-A-G2', 'edge-S-G3', 'edge-B-G3'];
    if (g1) nodes.push('node-G1');
    if (g2) nodes.push('node-G2');
    if (g3) nodes.push('node-G3');
    if (g4) nodes.push('node-G4');
    if (f) nodes.push('node-F');
    if (g1) edges.push('edge-G1-G2');
    if (g2) edges.push('edge-G2-G4');
    if (g3) edges.push('edge-G3-G4');
    if (g4) edges.push('edge-G4-F');
    active.main = [...nodes, ...edges];
  }

  const kmap =
    entryId === 'D1' && bits.length === 4
      ? {
          row: GRAY_INDEX[bits[0] * 2 + bits[1]],
          col: GRAY_INDEX[bits[2] * 2 + bits[3]],
        }
      : undefined;

  return { row, output, active, kmap };
}

function displayResult(
  entryId: string,
  result: Record<string, number | string>,
): Record<string, number | string> {
  if (entryId === 'A7' && Number(result.T) < 100) {
    const rest = { ...result };
    delete rest.AfDeep;
    delete rest.errorAtT1000;
    return humanizeKeys(rest);
  }
  return humanizeKeys(result);
}

function formatPrintTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 力学结论位：σmax 与 [σ] 的对比由 solver 写进 result.status / ratio / conclusion，
 * 这里只决定红/黄/绿，不重算任何数字。
 *
 * 拒绝态（静不定 / 机构 / 超域）分两种：
 * - 刻意拒绝（S1 的两个反例）：结论位只给「为什么拒」+「怎么改」，一个数都不印；
 * - 超域（M7 柔度不足）：λ 这些量本身是有效的，只把 σcr 那条结论挂黄底，不在此列。
 */
function MechVerdict({ result }: { result: Record<string, number | string> }) {
  const status = String(result.status ?? '');
  const conclusion = String(result.conclusion ?? '');
  const remedy = result.remedy === undefined ? '' : String(result.remedy);
  const ratio = Number(result.ratio);
  if (status === 'indeterminate' || status === 'out-of-scope') {
    return (
      <div className="no-print rounded-xl border border-amber/50 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber">
        <p>{conclusion || '当前版本不解静不定 —— 不给数字结论。'}</p>
        {remedy ? <p className="mt-1 text-amber/90">怎么改：{remedy}</p> : null}
      </div>
    );
  }
  if (status === 'over') {
    return (
      <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
        超限 {Number.isFinite(ratio) ? ((ratio - 1) * 100).toFixed(1) : '—'}%
        <span className="ml-1 text-danger/80">{conclusion}</span>
      </div>
    );
  }
  return (
    <div className="no-print rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-[11px] leading-5 text-ok">
      {conclusion || '未超限'}
    </div>
  );
}

/**
 * 拒绝态的「结果」位：不印任何数字，只说明「这里本来就不该有数字」以及判据在哪看。
 * 静不定 / 机构的反力是**解不出来**的，印一组 0 或印个占位符都会被读成「算出来了」。
 */
function RefusedPanel() {
  return (
    <section className="rounded-xl border border-danger/40 bg-danger/5">
      <header className="border-b border-danger/30 px-3 py-2 text-[11px] text-danger">
        拒绝求解 · 不输出数值结论
      </header>
      <p className="px-3 py-2 text-[11px] leading-5 text-muted">
        本页按设计拒绝作答：内力与反力在这里不存在唯一解，所以结果位保持空白。
        判据（未知量数、约束矩阵秩、载荷可平衡性）在左侧步骤与「校验」表里逐条列出，可逐条复核。
      </p>
    </section>
  );
}

/**
 * W18-C 参数徽标：让用户一眼看出「这是不是我的题」。
 *  - URL 里没有覆盖 → 灰「默认参数」；
 *  - 有覆盖 → 青「本次参数 · L=3 a=3 P=12」，点开两列对照（题面给的 / 默认推的）；
 *  - 未在题面出现、仍取默认的参数，逐条标琥珀「默认值，未在题面出现」。
 * 数据源就是 URL 与参数表本身——参数链路以后再坏一次，用户也能当场看出来。
 */
function ParamBadge({
  params,
  values,
  queryKeys,
}: {
  params: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  queryKeys: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  if (params.length === 0) return null;
  const fromQuery = params.filter((param) => queryKeys.has(param.key));
  const fromDefault = params.filter((param) => !queryKeys.has(param.key));
  const show = (param: ParamSpec) => {
    const value = values[param.key];
    return `${param.key}=${Array.isArray(value) ? value.join('') : value}`;
  };
  return (
    <div data-testid="param-badge" className="no-print border-b border-line/60 bg-panel/60">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-1.5 text-[11px]">
        {fromQuery.length > 0 ? (
          <button
            type="button"
            data-testid="param-badge-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="rounded border border-cyan/50 bg-cyan/10 px-2 py-0.5 font-medium text-cyan hover:bg-cyan/20"
          >
            本次参数 · {fromQuery.map(show).join('  ')}
            <span aria-hidden="true" className="ml-1">{open ? '▲' : '▼'}</span>
          </button>
        ) : (
          <span data-testid="param-badge-default" className="rounded border border-line bg-bg px-2 py-0.5 text-faint">
            默认参数
          </span>
        )}
        {fromDefault.length > 0 ? (
          <span data-testid="param-badge-defaults" className="basis-full text-[10px] leading-5 text-amber">
            {fromDefault.map((param) => param.key).join(' · ')} · 默认值，未在题面出现
          </span>
        ) : null}
      </div>
      {open && fromQuery.length > 0 ? (
        <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-x-6 gap-y-1 px-4 pb-2 text-[11px] leading-5 sm:grid-cols-2">
          <div data-testid="param-badge-given">
            <p className="font-medium text-cyan">题面给的（来自 URL / 读题）</p>
            <ul className="mt-0.5 space-y-0.5">
              {fromQuery.map((param) => (
                <li key={param.key} className="text-ink">
                  {param.label}: {show(param)}
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="param-badge-inferred">
            <p className="font-medium text-muted">默认推的（题面没提）</p>
            {fromDefault.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {fromDefault.map((param) => (
                  <li key={param.key} className="text-amber">
                    {param.label}: {show(param)} · 默认值，未在题面出现
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-muted">题面把全部参数都给了。</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DataPanel({
  title,
  data,
  accent,
  className = '',
  testId,
}: {
  title: string;
  data: Record<string, number | string>;
  accent?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-xl border border-line bg-panel elev ${className}`}>
      <header className="border-b border-line px-3 py-2 text-[11px] text-muted">{title}</header>
      <dl className="divide-y divide-line/60">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 px-3 py-2 text-[11px]">
            <dt className="text-muted">{key}</dt>
            <dd
              className={`whitespace-nowrap text-right tabular-nums ${
                accent ? 'text-cyan' : 'text-ink'
              }`}
            >
              {formatDisplayValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Result({ templateId, search, onBack, onToast, override }: ResultProps & { override?: Solution }) {
  /** 从 #/scope 带过来的简化：三处留痕（顶部 amber 条 / assumptions / PDF）共用的数据源。 */
  const simpRaw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('simp') ?? '';
  const simplifications = parseSimplifications(simpRaw);
  const assumptions = assumptionLines(simplifications);
  const canLab = isLabSupported(templateId);
  const routeInfo = getTemplateRoute(templateId);
  const entry = routeInfo?.entry ?? getTemplate(templateId);
  const variant = routeInfo?.variant;
  const displayId = variant?.id ?? entry.id;
  const displayTitle = variant?.title ?? entry.title;
  const params = entry.params ?? [];
  // 变体（如 M3 悬臂）自带默认参数，滑杆基线要用它；否则一开页滑杆值就和图对不上。
  const paramBaseline = variant?.params;
  const [solution, setSolution] = useState<Solution | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [solveMs, setSolveMs] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNotes, setLiveNotes] = useState<string[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlayerSpeed>(1);
  const [checksOpen, setChecksOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * W21-B B2：浏览器在打印前后会派发 beforeprint / afterprint。这里把状态显式
   * 挂到根上，打印态只留打印稿（CSS 的 @media print 与 [data-printing] 双保险）；
   * 不如此则「导出 PDF」点下去屏幕层与打印稿会同时存在。
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const [wizardInfo, setWizardInfo] = useState<{ label: string; targetId?: string } | null>(null);

  const valuesRef = useRef<Record<string, ParamValue>>({});
  const solverRef = useRef<Solver | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setSolution(undefined);
    setStepIndex(0);
    setPlaying(false);
    setChecksOpen(false);
    setMenuOpen(false);
    setLiveError(null);
    setLiveNotes([]);
    setSolveMs(null);
    solverRef.current = null;
    valuesRef.current = {};
    setValues({});
    Promise.all([
      getExample(templateId),
      entry.solver ? entry.solver() : Promise.resolve(null),
    ])
      .then(async ([loaded, solverModule]) => {
        if (!active) return;
        solverRef.current = solverModule?.default ?? null;
        // 装配台 override：solution 由归约 + 既有 solver 现场产出，直接用；参数表照常可改并实时重算
        if (override) {
          const parsed = parseParamQuery(entry.params ?? [], search, paramBaseline);
          valuesRef.current = { ...parsed.values, ...override.parsed_given };
          setValues(valuesRef.current);
          setSolution(override);
          return;
        }
        const parsed = parseParamQuery(entry.params ?? [], search, paramBaseline);
        valuesRef.current = parsed.values;
        setValues(parsed.values);
        if (parsed.corrected) {
          const simpQuery = simpRaw ? `simp=${encodeURIComponent(simpRaw)}` : '';
          const parts = [parsed.normalized, simpQuery].filter(Boolean).join('&');
          const normalizedHash = `#/t/${templateId}${parts ? `?${parts}` : ''}`;
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}${normalizedHash}`,
          );
        }
        const hasNonDefault =
          buildParamQuery(entry.params ?? [], parsed.values, paramBaseline).length > 0;
        if (
          loaded &&
          solverModule?.default &&
          hasNonDefault &&
          entry.id !== 'D1' &&
          entry.id !== 'D2' &&
          entry.id !== 'D3'
        ) {
          try {
            const input = buildSolverInput(entry, variant?.config, parsed.values);
            const base = solverModule.default(input);
            const live = await validateLive(entry, variant, base, input);
            if (!active) return;
            setSolution({
              ...base,
              confidence: live.confidence,
              validatedAt: new Date().toISOString(),
              contractVersion: CONTRACT_VERSION,
              warnings: base.warnings,
            });
            setLiveNotes(live.notes);
            return;
          } catch (error) {
            if (!active) return;
            setLiveError(error instanceof Error ? error.message : String(error));
          }
        }
        setSolution(loaded ?? null);
      })
      .catch(() => {
        if (active) setSolution(null);
      });
    return () => {
      active = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [templateId, entry, search, variant, override]);

  const schedule = (next: Record<string, ParamValue>) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (!solverRef.current) return;
    if (entry.id === 'D1' || entry.id === 'D2' || entry.id === 'D3') {
      setSolveMs(null);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      const started = performance.now();
      try {
        const input = buildSolverInput(entry, variant?.config, next);
        const base = solverRef.current?.(input);
        if (!base) return;
        const live = await validateLive(entry, variant, base, input);
        const elapsed = performance.now() - started;
        setSolution({
          ...base,
          confidence: live.confidence,
          validatedAt: new Date().toISOString(),
          contractVersion: CONTRACT_VERSION,
          warnings: base.warnings,
        });
        setLiveNotes(live.notes);
        setLiveError(null);
        setSolveMs(elapsed);
      } catch (error) {
        setLiveError(error instanceof Error ? error.message : String(error));
      }
    }, 80);
  };

  const syncUrl = (next: Record<string, ParamValue>) => {
    const query = buildParamQuery(params, next, paramBaseline);
    const hash = `#/t/${templateId}${query ? `?${query}` : ''}`;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };

  const changeParam = (key: string, value: ParamValue) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    syncUrl(next);
    schedule(next);
  };

  const resetParam = (key: string) => {
    const param = params.find((item) => item.key === key);
    if (!param) return;
    const base = paramBaseline?.[key] ?? param.defaultValue;
    changeParam(key, cloneDefault(base));
  };

  const resetAll = () => {
    const next = defaultParamValues(params, paramBaseline);
    valuesRef.current = next;
    setValues(next);
    syncUrl(next);
    schedule(next);
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('solve-deck:wizard');
      setWizardInfo(raw ? (JSON.parse(raw) as { label: string; targetId?: string }) : null);
    } catch {
      setWizardInfo(null);
    }
  }, [templateId]);

  const stepCount = solution?.steps.length ?? 0;
  const canPlay = Boolean(solution && isFullyValidated(solution.confidence));

  useEffect(() => {
    if (!solution) return;
    if (stepIndex >= solution.steps.length) {
      setStepIndex(Math.max(0, solution.steps.length - 1));
    }
  }, [solution, stepIndex]);

  const liveSelection = useMemo(
    () => liveSelectionFor(entry.id, params, values, solution ?? null),
    [entry.id, params, values, solution],
  );
  const resultData = useMemo(
    () => (solution ? displayResult(entry.id, solution.result) : {}),
    [entry.id, solution],
  );

  useEffect(() => {
    if (!playing || !solution) return;
    if (stepIndex >= solution.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStepIndex((current) => nextStep(current, solution.steps.length));
    }, stepDurationMs(speed));
    return () => window.clearTimeout(timer);
  }, [playing, stepIndex, speed, solution]);

  if (solution === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        加载已校验快照…
      </div>
    );
  }

  if (!solution) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-line bg-panel/60">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
            <button type="button" onClick={onBack} className="text-xs text-muted hover:text-cyan">
              ← 题库
            </button>
            <span className="text-sm text-cyan">{displayId}</span>
            <span className="truncate text-sm text-ink">{displayTitle}</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl px-4 py-16">
          <div className="rounded-xl border border-line bg-panel elev p-8 text-center">
            <h2 className="text-lg text-ink">施工中</h2>
            <p className="mt-2 text-sm text-muted">
              {displayId} 已登记 {entry.paths.length} 条校验路径，但还没有预置示例。
              当前只开放 D1–D6 / A1–A7 的只读预览。
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-6 rounded-md border border-line px-4 py-2 text-xs text-ink hover:border-cyan/50 hover:text-cyan"
            >
              返回题库
            </button>
          </div>
        </main>
      </div>
    );
  }

  const tone = confidenceTone(solution.confidence);
  const conclusionUnavailable =
    !solution.confidence.allPassed || solution.confidence.failedCount > 0;
  const a7Outside = entry.id === 'A7' && Number(solution.result.T) < 100;
  const teachingNotes = liveNotes.filter(
    (note) => !(a7Outside && note.includes('深度负反馈')),
  );
  const bitLabels = params.find((param) => param.kind === 'bits')?.bitLabels ?? [];
  const syncLabel =
    entry.id === 'D1' ? '真值表行 / 卡诺图单元同步' : '真值表行 / 门级高亮同步';
  const selectStep = (index: number) => {
    setStepIndex(index);
    setPlaying(false);
  };
  const goPrev = () => {
    setStepIndex((current) => prevStep(current, stepCount));
    setPlaying(false);
  };
  const goNext = () => {
    setStepIndex((current) => nextStep(current, stepCount));
    setPlaying(false);
  };
  const togglePlay = () => {
    if (!canPlay) return;
    if (!playing && stepIndex >= stepCount - 1) setStepIndex(0);
    setPlaying((value) => !value);
  };
  const exportPdf = () => {
    setMenuOpen(false);
    // 打印态先于对话框生效；关掉对话框后立刻还原，不依赖 afterprint 是否派发。
    setPrinting(true);
    try {
      window.print();
    } finally {
      setPrinting(false);
    }
  };  const copyLink = async () => {
    const url = window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = url;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        area.remove();
      } catch {
        ok = false;
      }
    }
    setMenuOpen(false);
    onToast(ok ? '链接已复制（含当前参数）' : '复制失败，请手动复制地址栏');
  };
  const printTime = formatPrintTime(solution.validatedAt);
  const printMeta = `拆解台 · SolveDeck ｜ ${displayId} ｜ ${printTime}`;
  /** 刻意拒绝：静不定一律算；out-of-scope 只有在 solver 明确给了「怎么改」时才算反例页。 */
  const refused =
    solution.result.status === 'indeterminate' ||
    (solution.result.status === 'out-of-scope' && solution.result.remedy !== undefined);
  const rejection = variant?.rejection ?? '';

  return (
    <div className="result-page min-h-screen pb-24" data-printing={printing ? '1' : undefined}>
      <header className="result-header toolbar no-print sticky top-0 z-30">
        <div className="mx-auto flex h-[52px] max-w-[1600px] flex-wrap items-center gap-3 px-4">
          <span className="traffic hidden shrink-0 sm:inline-flex" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button
            type="button"
            onClick={onBack}
            className="no-print rounded-[6px] border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-line-2 hover:text-ink"
          >
            ← 题库
          </button>
          <span className="id-mono shrink-0 text-cyan">{displayId}</span>
          <h1 className="min-w-0 flex-1 truncate font-serif text-[13px] font-normal text-ink">{displayTitle}</h1>
          <span className="no-print hidden sm:inline-flex">
            <ConfidenceBadge
              report={solution.confidence}
              validatedAt={solution.validatedAt}
              contractVersion={solution.contractVersion}
              expanded={checksOpen}
              onToggle={() => setChecksOpen((value) => !value)}
            />
          </span>
          <button
            type="button"
            onClick={() => setChecksOpen((value) => !value)}
            className="no-print hidden rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-cyan/50 hover:text-cyan sm:inline-flex"
          >
            查看自检
          </button>
          <div className="no-print relative sm:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label="更多操作"
              className="rounded border border-line px-2 py-1 text-[13px] leading-none text-muted hover:border-cyan/50 hover:text-cyan"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-line bg-panel p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setChecksOpen((value) => !value);
                    setMenuOpen(false);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
                >
                  查看自检
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
                >
                  复制链接
                </button>
                <button
                  type="button"
                  data-testid="print-button"
                  onClick={exportPdf}
                  className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-cyan hover:bg-ink/[0.04]"
                >
                  打印 / 另存 PDF
                </button>
                {canLab ? (
                  <a
                    href={`#/lab/t/${templateId}`}
                    onClick={() => setMenuOpen(false)}
                    className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
                  >
                    改结构 →
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <ThemeToggle />
          <div className="print-only print-meta">
            <span>拆解台 · SolveDeck</span>
            <span>{displayId}</span>
            <span>{printTime}</span>
            <span>#/t/{displayId}</span>
          </div>
        </div>
      </header>

      {solution ? (
        <ParamBadge
          params={params}
          values={values}
          queryKeys={new Set(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).keys())}
        />
      ) : null}

      {assumptions.length > 0 ? (
        <div className="print-assumption border-b border-amber/50 bg-amber/10 px-4 py-2 text-[11px] leading-5 text-amber">
          {assumptions.map((line) => (
            <p key={line}>· {line}</p>
          ))}
        </div>
      ) : null}

      {rejection ? (
        <div className="border-b border-danger/50 bg-danger/10 px-4 py-2 text-center text-[11px] leading-5 text-danger">
          反例：本页故意给一个{rejection}，系统按设计拒绝求解，不输出任何内力数值。
        </div>
      ) : null}

      {wizardInfo && (!wizardInfo.targetId || wizardInfo.targetId === templateId) ? (
        <div className="no-print border-b border-amber/40 bg-amber/10 px-4 py-2 text-center text-[11px] text-amber">
          按你的回答，这是{wizardInfo.label}；如果不对，
          <a href="#/wizard" className="ml-1 underline hover:text-cyan">
            点这里换组态
          </a>
          。
        </div>
      ) : null}

      <div className="result-grid mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 pb-32 pt-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,340px)]">
        <aside className="print-steps min-h-0">
          <section className="rounded-xl border border-line bg-panel elev lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-11rem)] lg:overflow-auto">
            <header className="no-print flex items-center justify-between border-b border-line px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-faint">
              <span>步骤 · {stepCount}</span>
              <span>{playing ? '播放中' : '已暂停'}</span>
            </header>
            <ol className="flex flex-col gap-1.5 p-2">
              {solution.steps.map((step) => {
                const active = step.i === stepIndex;
                return (
                  <li key={step.i}>
                    <button
                      type="button"
                      onClick={() => selectStep(step.i)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'step-active border-cyan/50 bg-cyan/5'
                          : 'border-transparent hover:border-line hover:bg-ink/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px] text-faint">
                        <span className="id-mono">第 {step.i + 1} 步</span>
                        <span className="truncate">{step.basis}</span>
                      </div>
                      <div className="mt-1.5 text-[13px] leading-[1.45] text-ink">{step.title}</div>
                      <Formula
                        tex={step.formula_tex}
                        className="mt-2 block overflow-x-auto overflow-y-hidden text-[13px]"
                      />
                      {active ? (
                        <div className="no-print mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
                          <p className="text-muted">代入：{step.substitution}</p>
                          <p className="text-cyan">{step.value}</p>
                        </div>
                      ) : null}
                      <div className="print-only mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
                        <p className="text-muted">代入：{step.substitution}</p>
                        <p className="text-cyan">{step.value}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>

        <main className="print-canvas min-w-0">
          <div className="no-print mb-2 flex items-center justify-between px-1 text-[11px] text-muted">
            <span>画布 · 多图按 role 排版（主图 / 辅图）</span>
            <span>
              <span className="text-cyan">青</span> = 当前步
            </span>
          </div>
          {liveSelection ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-cyan/30 bg-cyan/5 px-2 py-1 text-[11px] text-cyan">
              <span className="tabular-nums">
                {bitLabels
                  .map((label, index) => `${label}=${(values.bits as number[])?.[index] ?? 0}`)
                  .join(' ')}
              </span>
              <span className="text-muted">→</span>
              <span className="tabular-nums">F={String(liveSelection.output ?? 'x')}</span>
              <span className="text-muted">（{syncLabel}）</span>
            </div>
          ) : null}
          <SpecGrid
            specs={solution.render_specs}
            stepIndex={stepIndex}
            liveSelection={liveSelection}
          />
          <p className="no-print mt-2 px-1 text-[10px] text-muted">
            各图种只读 render_spec 的纯数据；没有题型专属坐标分支。
          </p>
        </main>

        <aside className="print-side flex min-w-0 flex-col gap-3">
          <div className={`no-print hidden gap-2 sm:grid ${canLab ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-xl border border-cyan/40 bg-panel px-2 py-2 text-xs text-cyan transition-colors hover:border-cyan/70"
            >
              复制链接
            </button>
            <button
              type="button"
              data-testid="print-button"
              onClick={exportPdf}
              className="rounded-xl border border-line bg-panel elev px-2 py-2 text-xs text-ink transition-colors hover:border-cyan/50 hover:text-cyan"
            >
              打印 / 另存 PDF
            </button>
            {canLab ? (
              <a
                data-testid="go-lab"
                href={`#/lab/t/${templateId}`}
                className="rounded-xl border border-line bg-panel px-2 py-2 text-center text-xs text-muted transition-colors hover:border-cyan/50 hover:text-cyan"
              >
                改结构 →
              </a>
            ) : null}
          </div>
          <ParamPanel
            params={params}
            values={values}
            solveMs={solveMs}
            error={liveError}
            onChange={changeParam}
            onReset={resetParam}
            onResetAll={resetAll}
          />
          <div className="print-only print-given">
            <DataPanel title="已知量 parsed_given" data={solution.parsed_given} />
          </div>
          {a7Outside ? (
            <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
              回路增益 T={Number(solution.result.T).toFixed(1)} &lt; 100，超出深度负反馈近似域；
              结论位只给 AfLoop / AfMNA，不显示深度负反馈近似值。
            </div>
          ) : null}
          {entry.subject === 'mechanics' || entry.subject === 'statics' ? (
            <MechVerdict result={solution.result} />
          ) : null}
          {conclusionUnavailable ? (
            <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
              {rejection
                ? `反例页：结论不可用是设计结果 —— ${solution.confidence.failedCount} 项校验如实记为未通过（不是算挂了）。`
                : '结论不可用：六项校验未全部通过。'}
            </div>
          ) : (
            <div data-testid="conclusion-banner" className="no-print rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-[11px] leading-5 text-ok">
              结论可用 · {confidenceSummary(solution.confidence)}
            </div>
          )}
          {teachingNotes.length > 0 ? (
            <ul className="no-print space-y-1 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber">
              {teachingNotes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          ) : null}
          {refused ? <RefusedPanel /> : <DataPanel title="结果 result" data={resultData} accent className="print-result" testId="result-table" />}

          {assumptions.length > 0 ? (
            <section className="print-assumptions rounded-xl border border-amber/50 bg-amber/10 p-3">
              <header className="border-b border-amber/30 pb-1 text-[11px] text-amber">
                assumptions · 前提与简化
              </header>
              <ul className="mt-1 space-y-1 text-[11px] leading-5 text-amber">
                {assumptions.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="print-confidence rounded-xl border border-line bg-panel elev">
            <header className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px]">
              <span className="text-muted">校验 confidence</span>
              <span className={tone === 'gray' ? 'text-muted' : 'text-danger'}>
                {tone === 'gray' ? '未校验预览' : tone === 'green' ? '已校验' : '未通过'}
              </span>
            </header>
            <div className="space-y-2 p-3 text-[11px]">
              <p data-testid="confidence-counts" className="text-muted">
                failedCount {solution.confidence.failedCount} · skippedCount{' '}
                {solution.confidence.skippedCount} · allPassed{' '}
                {String(solution.confidence.allPassed)}
              </p>
              {/* W21-A A4：跳过的项单独一行，点开看是哪几项、为什么，不混进绿章。 */}
              {skippedChecks(solution.confidence).length > 0 ? (
                <details data-testid="skipped-details" className="no-print rounded border border-amber/40 bg-amber/5 px-2 py-1">
                  <summary className="cursor-pointer text-amber">
                    跳过 {skippedChecks(solution.confidence).length} 项 · 点开看是哪几项、为什么
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {skippedChecks(solution.confidence).map((item) => (
                      <li key={item.name}>· {item.name}：{item.reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {/*
                W21-A A5：17 位裸浮点只在「自检」里给完整精度；validatedAt /
                contract 这类研发信息也移出主面板，不再压在教学结论旁边。
              */}
              <details data-testid="self-check" className="no-print rounded border border-line px-2 py-1">
                <summary className="cursor-pointer text-muted">完整精度与研发信息（自检）</summary>
                <dl className="mt-1 grid gap-0.5 font-mono text-[10px] leading-4 text-muted">
                  {Object.entries(solution.result).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt>{key}</dt>
                      <dd className="text-right">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">
                  validatedAt: {solution.validatedAt} · contract {solution.contractVersion}
                </p>
              </details>
              {checksOpen ? (
                <div className="no-print space-y-1.5">
                  {solution.confidence.checks.map((item) => (
                    <div key={item.name} className="rounded border border-line p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink">{item.name}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATE_CLASS[item.state]}`}>
                          {item.state}
                        </span>
                      </div>
                      <p className="mt-1 text-muted">{item.detail}</p>
                      {item.skipReason ? (
                        <p className="mt-0.5 text-muted">skipReason: {item.skipReason}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setChecksOpen(true)}
                  className="no-print text-cyan hover:underline"
                >
                  展开六项检查
                </button>
              )}
              <div className="print-only space-y-1.5">
                {solution.confidence.checks.map((item) => (
                  <div key={`print-${item.name}`} className="rounded border border-line p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{item.name}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATE_CLASS[item.state]}`}>
                        {item.state}
                      </span>
                    </div>
                    <p className="mt-1 text-muted">{item.detail}</p>
                    {item.skipReason ? (
                      <p className="mt-0.5 text-muted">skipReason: {item.skipReason}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {solution.warnings.length > 0 ? (
            <section className="print-warnings rounded-xl border border-line bg-panel elev">
              <header className="border-b border-line px-3 py-2 text-[11px] text-muted">
                warnings
              </header>
              <ul className="space-y-1 p-3 text-[11px] leading-5 text-amber">
                {solution.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="no-print px-1 text-[10px] text-muted">warnings: 无</p>
          )}

          {assumptions.length === 0 ? (
            <p className="no-print px-1 text-[10px] text-muted">assumptions: 无</p>
          ) : null}

          {entry.id === 'M6' ? (
            <p className="px-1 text-[10px] leading-4 text-muted">
              本型无受力图（应力状态题只给莫尔圆与单元体）。
            </p>
          ) : null}

          <p className="no-print px-1 text-[10px] leading-4 text-muted">
            solver: {displayId} · 懒载 + 构建期三路径校验 · 页面消费已校验快照
          </p>
          <a
            href="#/about"
            className="no-print px-1 text-[10px] text-muted hover:text-cyan"
          >
            关于 · 过程
          </a>
        </aside>
      </div>

      <div className="print-only print-footer">{printMeta}</div>

      <StepPlayer
        stepIndex={stepIndex}
        stepCount={stepCount}
        playing={playing}
        speed={speed}
        disabled={!canPlay}
        summary={confidenceSummary(solution.confidence)}
        onToggle={togglePlay}
        onPrev={goPrev}
        onNext={goNext}
        onSpeed={() => setSpeed((current) => nextSpeed(current))}
        onSeek={selectStep}
      />
    </div>
  );
}