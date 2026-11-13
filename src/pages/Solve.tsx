/**
 * `#/solve` —— 我有道题：手填参数 + 离线读题（R3-2：AI 从这页撤走）。
 *
 * 三块从上到下：
 *  ① 题型选择器（按科目分组，28 型 ready + 常驻变体）
 *  ② 参数表单（ParamSpec 全部列出、默认值预填、**越界标红给区间、不夹取**）
 *  ③ 贴题：文字走规则解析（离线、零请求），图片只作参照
 *
 * 两个出口（N-01）：主 = 看结构（进装配台，带着当前这张图），次 = 看讲解（进五步推导）。
 * 别处不再有第三个前进键。
 *
 * 红线：这一页不出现任何由本页算出来的数值结论。屏幕上的数字只有两种来源 ——
 * 用户填的 / 从 registry 抄的默认值与区间。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { READY_SUBJECTS } from '../core/subjects';
import {
  TEMPLATES,
  getTemplateRoute,
  type ParamSpec,
  type ParamValue,
  type TemplateEntry,
} from '../core/templates/registry';
import { buildParamQuery, cloneDefault, defaultParamValues } from '../core/params/query';
import { draftUrl, parseProblem } from '../core/ai/parse';
import {
  IMAGE_CAPTION,
  IMAGE_REJECTED,
  MAX_IMAGES,
  formatBytes,
  removeImage,
  type ProblemImage,
} from '../core/ai/image';
import { prepareImages } from '../ui/imagePipeline';
import { takeSolveSeed } from '../ui/solveSeed';
import { QuickFill, QUICKFILL_TEMPLATES } from '../ui/QuickFill.tsx';
import { ThemeToggle } from '../ui/ThemeToggle';
import { parseSimplifications, simplificationNotice } from '../core/scope/simplifications';
import { labDraftFromAIDraft, LAB_DRAFT_DISCLAIMER } from '../core/ai/labDraft';
import { imageRefNotice } from '../core/ai/imgref';
import { labSkeletonSpec } from '../core/lab/skeleton';
import { structureHrefFromDraft } from '../core/lab/shareLink';
import { getExample } from '../examples';
import type { AIParseOutcome } from '../core/ai/types';

interface SolveProps {
  onBack: () => void;
  onStart: (hash: string) => void;
  onToast: (message: string) => void;
}

/** 统一外壳：一列 1120、发丝线卡片。 */
const SHELL = 'mx-auto w-full max-w-[1120px] px-6';
const CARD = 'rounded-xl border border-line bg-panel';
const FIELD =
  'w-full rounded-lg border bg-bg px-2 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-line-2';
/** 主操作：全站唯一的高对比块。 */
const PRIMARY =
  'focus-ring inline-flex h-11 items-center rounded-lg bg-cyan px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30';
/** 次操作：纯文字链接，不带边框。 */
const QUIET =
  'focus-ring inline-flex h-11 items-center text-[14px] text-muted transition-colors hover:text-ink disabled:opacity-30';

const GROUPS = READY_SUBJECTS.map((subject) => ({
  ...subject,
  entries: TEMPLATES.filter((entry) => entry.subject === subject.key && entry.status === 'ready'),
}));

const EXAMPLES = [
  { label: '悬臂梁 L=2m 端部 10kN', text: '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力与弯矩图' },
  { label: '共源放大器 gm=1mS Rd=2kΩ', text: '共源放大器 gm=1mS，Rd=2kΩ，Rl=10kΩ，求电压增益' },
  { label: 'σx=100 σy=-20 τ=40 求主应力', text: 'σx=100MPa，σy=-20MPa，τxy=40MPa，求主应力' },
];

function rangeText(param: ParamSpec): string {
  const min = param.min ?? '−∞';
  const max = param.max ?? '+∞';
  return `${min} ~ ${max}${param.unit ? ` ${param.unit}` : ''}`;
}

function fieldError(param: ParamSpec, value: ParamValue): string | null {
  if (param.kind === 'bits') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return '要一个数字';
  if (param.min !== undefined && number < param.min) return `小于下限（合法 ${rangeText(param)}）`;
  if (param.max !== undefined && number > param.max) return `大于上限（合法 ${rangeText(param)}）`;
  return null;
}

/** 来源四值（N-02）：题面 / 图 / 默认 / 用户。 */
type Source = '题面' | '图' | '默认' | '用户';

export function Solve({ onBack, onStart, onToast }: SolveProps) {
  const [pickId, setPickId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [derivedKeys, setDerivedKeys] = useState<string[]>([]);
  /** 用户手动改过的键：来源列写「用户」。 */
  const [touchedKeys, setTouchedKeys] = useState<string[]>([]);
  /** 首页 hero 的交接（?q= 文字 / sessionStorage 一次性图片）+ 从 #/scope 带来的 simp。 */
  const [boot] = useState(() => {
    const query = window.location.hash.split('?')[1] ?? '';
    const q = new URLSearchParams(query).get('q') ?? '';
    const t = new URLSearchParams(query).get('t') ?? '';
    const stored = takeSolveSeed();
    return {
      text: stored?.text?.trim() ? stored.text : q,
      image: stored?.image ?? null,
      simp: new URLSearchParams(query).get('simp') ?? '',
      t,
    };
  });
  const [text, setText] = useState(boot.text);
  const [images, setImages] = useState<ProblemImage[]>(boot.image ? [boot.image] : []);
  const [imageBusy, setImageBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [outcome, setOutcome] = useState<AIParseOutcome | null>(null);
  /** 从知识条目/带 ?t= 进来时，横幅交代一句「题型已经替你选好」。 */
  const [presetTitle, setPresetTitle] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 从 #/scope 的「要先简化」带过来的简化 id，必须一路跟到结果页去留痕。 */
  const simp = boot.simp;
  const simplifications = parseSimplifications(simp);

  const route = pickId ? getTemplateRoute(pickId) : undefined;
  const entry = route?.entry;
  const params = entry?.params ?? [];

  const pick = useCallback((id: string, prefill?: Record<string, number | string>) => {
    const next = getTemplateRoute(id);
    if (!next) return;
    const base = defaultParamValues(next.entry.params ?? [], next.variant?.params);
    for (const [key, value] of Object.entries(prefill ?? {})) {
      if (key in base) base[key] = value;
    }
    setPickId(id);
    setValues(base);
    setDerivedKeys([]);
    setTouchedKeys([]);
  }, []);

  const errorKeys = useMemo(
    () => params.filter((param) => fieldError(param, values[param.key]) !== null).map((param) => param.key),
    [params, values],
  );

  const changeParam = (param: ParamSpec, raw: string) => {
    setDerivedKeys((current) => current.filter((key) => key !== param.key));
    setTouchedKeys((current) => (current.includes(param.key) ? current : [...current, param.key]));
    setValues((current) => ({
      ...current,
      [param.key]: param.kind === 'bits' ? current[param.key] : raw.trim() === '' ? Number.NaN : Number(raw),
    }));
  };

  const onQuickWrite = (patch: Record<string, number>, keys: string[]) => {
    setValues((current) => ({ ...current, ...patch }));
    setDerivedKeys(keys);
  };

  const toggleBit = (param: ParamSpec, index: number) => {
    setTouchedKeys((current) => (current.includes(param.key) ? current : [...current, param.key]));
    setValues((current) => {
      const bits = Array.isArray(current[param.key])
        ? [...(current[param.key] as number[])]
        : [...((param.defaultValue as number[]) ?? [])];
      bits[index] = bits[index] ? 0 : 1;
      return { ...current, [param.key]: bits };
    });
  };

  const withSimp = (hash: string) =>
    simp ? `${hash}${hash.includes('?') ? '&' : '?'}simp=${encodeURIComponent(simp)}` : hash;

  const runParse = async () => {
    if (text.trim() === '' && images.length === 0) {
      onToast('先把题面贴进来（或点下面三个例子）');
      return;
    }
    setParsing(true);
    setOutcome(null);
    try {
      const result = await parseProblem({ text, images: images.map((item) => item.send) });
      setOutcome(result);
      if (result.blocked) {
        setPickId(null);
        setValues({});
      } else if (result.draft) {
        pick(result.draft.templateId, result.draft.params);
      }
    } catch (error) {
      setOutcome({
        draft: null,
        issues: [`解析失败：${error instanceof Error ? error.message : String(error)}`],
        notes: [],
        outOfRange: [],
        jumpable: false,
        attempts: 0,
      });
    } finally {
      setParsing(false);
    }
  };

  /**
   * W21-B B3：首页贴题直达（URL 带 ?t=）→ 预选题型，横幅交代一句「选好了哪型」。
   * 有题面（?q= / sessionStorage 带来）就顺手解析一次；空手来的只选题型、不弹
   * 「先把题面贴进来」——从知识条目点过来的人要看的是这道题长什么样。
   * 规则解析仍是唯一真相：它若认出别的型，runParse 会把题型改过去。
   */
  useEffect(() => {
    if (!boot.t || !getTemplateRoute(boot.t)) return;
    pick(boot.t);
    setPresetTitle(getTemplateRoute(boot.t)?.entry.title ?? null);
    if (boot.text.trim() || boot.image) void runParse();
    // 只在首屏 boot 上跑一次；boot 由 useState 初始化器固定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useExample = (exampleText: string) => {
    setText(exampleText);
    window.setTimeout(() => {
      const run = async () => {
        setParsing(true);
        try {
          const result = await parseProblem({ text: exampleText });
          setOutcome(result);
          if (result.draft) pick(result.draft.templateId, result.draft.params);
        } finally {
          setParsing(false);
        }
      };
      void run();
    }, 0);
  };

  const acceptFiles = async (incoming: readonly File[]) => {
    const picked = incoming.filter((file) => file.type.startsWith('image/'));
    if (picked.length === 0) {
      onToast('只能放图片（截图 / 拍照都行）');
      return;
    }
    if (images.length >= MAX_IMAGES) {
      onToast(IMAGE_REJECTED);
      return;
    }
    setImageBusy(true);
    try {
      const { list, errors } = await prepareImages(picked, images);
      setImages(list);
      for (const message of errors) onToast(message);
    } finally {
      setImageBusy(false);
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void acceptFiles(files);
  };

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropping(false);
    void acceptFiles([...event.dataTransfer.files]);
  };

  const draftRoute = outcome?.draft ? getTemplateRoute(outcome.draft.templateId) : undefined;
  const draftSpecs = draftRoute?.entry.params ?? [];
  /** R2-T2：解析产物 → 结构草稿（只描述结构，不出数值）。 */
  const labDraft = useMemo(
    () => (outcome?.draft ? labDraftFromAIDraft(outcome.draft) : null),
    [outcome],
  );
  const outOfRange = new Set((outcome?.outOfRange ?? []).map((item) => item.key));

  /** 出口一：看结构 —— 带着这张图进装配台（?g= 同分享编码，&from=题面 挂来源徽标）。 */
  const goStructure = useCallback(async () => {
    if (!entry) return;
    if (!labDraft?.ok) {
      // 拿不到结构草稿：退到「手动参数 → ?p= 覆盖」
      const pairs = params
        .filter((param) => param.kind === 'number' && Number.isFinite(Number(values[param.key])))
        .map((param) => `${param.key}:${values[param.key]}`);
      onStart(withSimp(`#/lab/t/${entry.id}${pairs.length > 0 ? `?p=${pairs.join(',')}` : ''}`));
      return;
    }
    const targetId = labDraft.draft.templateId;
    const example = await getExample(targetId);
    if (!example) {
      onStart(`#/lab/t/${targetId}`);
      return;
    }
    const spec = labSkeletonSpec(targetId, example.render_specs[0]);
    // 与 `check:imgref` 同一个函数：草稿相同 → 链接逐字符相同，图不参与。
    onStart(withSimp(structureHrefFromDraft(labDraft.draft, spec).href));
  }, [labDraft, entry, onStart, withSimp, params, values]);

  /** 出口二：看讲解 —— 五步推导（draft 优先，否则用表单值）。 */
  const goExplain = useCallback(() => {
    if (!entry) return;
    if (outcome?.draft && outcome.jumpable) {
      const url = draftUrl(outcome.draft);
      if (url) {
        onStart(withSimp(url));
        return;
      }
    }
    const query = buildParamQuery(params, values, route?.variant?.params);
    onStart(withSimp(`#/t/${entry.id}${query ? `?${query}` : ''}`));
  }, [entry, outcome, onStart, withSimp, params, values, route]);

  const explainReady = Boolean(entry) && errorKeys.length === 0 && (!outcome?.draft || outcome.jumpable);
  const structureReady = Boolean(entry) && errorKeys.length === 0;

  /** 合并表（N-02）：一行一个参数，四列。来源按「用户 > 推得 > 题面/图 > 默认」定。 */
  const mergedRows = draftSpecs.length > 0 && outcome?.draft
    ? draftSpecs
        .filter((param) => param.kind === 'number')
        .map((param) => {
          const field = labDraft?.ok ? labDraft.draft.fields[param.key] : undefined;
          const inDraft = param.key in (outcome.draft?.params ?? {});
          const source: Source = touchedKeys.includes(param.key)
            ? '用户'
            : derivedKeys.includes(param.key)
              ? '题面'
              : field?.from === '图'
                ? '图'
                : field?.from === '题面' || inDraft
                  ? '题面'
                  : '默认';
          const value = field?.value ?? (inDraft ? outcome.draft!.params[param.key] : cloneDefault(param.defaultValue));
          return { param, value, source };
        })
    : [];

  return (
    <div className="min-h-screen">
      <header className="toolbar no-print sticky top-0 z-20">
        <div className={`${SHELL} flex h-[52px] items-center gap-3`}>
          <span className="traffic hidden shrink-0 sm:inline-flex" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button type="button" onClick={onBack} className="focus-ring rounded-[6px] border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-line-2 hover:text-ink">
            ← 返回
          </button>
          <span className="font-serif text-[13px] text-ink">我有道题</span>
          <a href="#/kb" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">知识库</a>
          <a href="#/wizard" className="focus-ring ml-auto text-[11px] text-muted transition-colors hover:text-ink">
            不知道选哪个？走选型向导
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className={`page-enter ${SHELL} pb-32 pt-12`}>
        <h1 className="text-[28px] font-normal leading-[1.2] text-ink sm:text-[32px]">贴题、给数，然后看结构</h1>
        <p className="mt-3 max-w-[620px] text-[15px] leading-[1.5] text-muted">
          题型决定用哪套求解器。参数默认值可以照抄，越界会当场标红、不夹取。读题走本地规则，不发任何请求。
        </p>

        {presetTitle ? (
          <div
            data-testid="solve-preset"
            className="mt-6 flex items-center gap-3 rounded-lg border border-cyan/40 bg-cyan/5 px-4 py-3 text-[13px] text-ink"
          >
            <span>
              题型已经替你选好：<span className="font-medium text-cyan">{presetTitle}</span>
              （参数用的默认值，改改数字就能出结构）。
            </span>
            <button
              type="button"
              onClick={() => setPresetTitle(null)}
              aria-label="收起提示"
              className="focus-ring ml-auto shrink-0 rounded px-1.5 text-[15px] text-faint transition-colors hover:text-ink"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="mt-9 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(380px,0.6fr)] lg:items-start">
          {/* ① 题型 */}
          <section className={`${CARD} lg:col-start-1 lg:row-start-1`}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[20px] font-medium text-ink">选题型</h2>
            <span className="text-[13px] text-muted">28 型全部就绪 · 点一下就填默认值</span>
          </header>
          <div className="grid gap-4 p-5">
            {GROUPS.map((group) => (
              <div key={group.key} className="grid gap-2">
                <p className="text-[13px] text-muted">
                  <span className="id-mono text-faint">{group.code}</span> {group.label} · {group.hint}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.entries.map((item) => (
                    <TemplateChip
                      key={item.id}
                      entry={item}
                      active={pickId === item.id}
                      onPick={() => pick(item.id)}
                      onPickVariant={(id) => {
                        const next = getTemplateRoute(id);
                        if (!next) return;
                        const base = defaultParamValues(next.entry.params ?? [], next.variant?.params);
                        const query = buildParamQuery(next.entry.params ?? [], base, next.variant?.params);
                        onStart(withSimp(`#/t/${id}${query ? `?${query}` : ''}`));
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ② 参数 */}
        <section className={`${CARD} lg:col-start-1 lg:row-start-2`} id="solve-params">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[20px] font-medium text-ink">填参数</h2>
            {entry ? (
              <span className="text-[13px] text-muted">
                {entry.id} · {entry.title}
              </span>
            ) : (
              <span className="text-[13px] text-muted">还没选题型</span>
            )}
          </header>
          {entry ? (
            <>
              {QUICKFILL_TEMPLATES.includes(entry.id) ? (
                <div className="px-5 pt-4">
                  <QuickFill
                    templateId={entry.id}
                    values={values}
                    writableKeys={params.map((param) => param.key)}
                    testId="quickfill-solve"
                    onWrite={onQuickWrite}
                  />
                </div>
              ) : null}
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                {params.map((param) => {
                  const value = values[param.key] ?? cloneDefault(param.defaultValue);
                  const error = fieldError(param, value);
                  if (param.kind === 'bits') {
                    const bits = Array.isArray(value) ? (value as number[]) : [];
                    return (
                      <div key={param.key} className="sm:col-span-2">
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-[13px] text-ink">{param.label}</span>
                          <span className="text-[13px] text-muted">逐位点选 · {bits.length} 位</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {bits.map((bit, index) => (
                            <button
                              key={`${param.key}-${index}`}
                              type="button"
                              onClick={() => toggleBit(param, index)}
                              className={`focus-ring rounded border px-2 py-0.5 text-[13px] tabular-nums transition-colors ${
                                bit ? 'border-line-2 bg-elev text-ink' : 'border-line text-muted'
                              }`}
                            >
                              {(param.bitLabels ?? [])[index] ?? `b${index}`}={bit}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <label key={param.key} className="grid gap-1">
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="text-ink">
                          {param.label}
                          {derivedKeys.includes(param.key) ? (
                            <span data-testid="derived-source" className="ml-1 rounded border border-line px-1 text-[12px] text-muted">
                              推得
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[12px] text-faint">{rangeText(param)}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={Number.isFinite(Number(value)) ? String(value) : ''}
                          step={param.step ?? 'any'}
                          onChange={(event) => changeParam(param, event.target.value)}
                          className={`${FIELD} ${error ? 'border-danger text-danger' : 'border-line'}`}
                          aria-invalid={error ? true : undefined}
                          aria-label={`${param.label}${param.unit ? `（${param.unit}）` : ''}`}
                        />
                        {param.unit ? <span className="shrink-0 text-[12px] text-faint">{param.unit}</span> : null}
                      </span>
                      {error ? <span className="text-[12px] text-danger">{error}，不会自动夹到边界</span> : null}
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">
              先在上面点一个题型。不确定该选哪个？走 <a href="#/wizard" className="text-ink underline-offset-2 hover:underline">选型向导</a>。
            </p>
          )}
        </section>

        {/* ③ 贴题 */}
        <section
          className={`${CARD} lg:sticky lg:top-16 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${dropping ? 'border-line-2' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[20px] font-medium text-ink">贴题（可选）</h2>
            <span className="text-[13px] text-muted">文字走规则解析 · 图片只作参照</span>
          </header>

          <div className="grid gap-3 p-5">
            {simplifications.length > 0 ? (
              <div className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] leading-6 text-amber">
                <p>{simplificationNotice(simplifications)}</p>
                <p className="mt-1 text-amber/80">
                  简化前提：{simplifications.map((item) => item.name).join(' + ')} · 这条会随链接带到结果页并印进 PDF。
                </p>
              </div>
            ) : null}
            <textarea
              id="solve-problem-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={onPaste}
              rows={6}
              placeholder="把题目原文贴进来，例如：悬臂梁 L=2m，自由端集中力 10kN，求固定端反力与弯矩图"
              className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-6 text-ink outline-none focus:border-line-2"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="solve-parse"
                onClick={() => void runParse()}
                disabled={parsing}
                className="focus-ring rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-line-2 disabled:opacity-40"
              >
                {parsing ? '解析中…' : '读题'}
              </button>
              <button
                type="button"
                data-testid="solve-pick-image"
                onClick={() => fileInputRef.current?.click()}
                disabled={imageBusy || images.length >= MAX_IMAGES}
                className="focus-ring rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink transition-colors hover:border-line-2 disabled:opacity-40"
              >
                加一张图（参照）
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  const picked = [...(event.target.files ?? [])];
                  event.target.value = '';
                  void acceptFiles(picked);
                }}
              />
              <span className="text-[12px] text-faint">
                {imageBusy ? '正在预处理图片（缩放 / 压 jpeg）…' : `Ctrl+V 粘贴 · 拖到这里 · 最多 ${MAX_IMAGES} 张`}
              </span>
            </div>

            {/* U2：图片区必须有一句话把「不参与计算」说死（门禁 check:imgref ④ 钉这句） */}
            <p data-testid="image-ref-note" className="text-[12px] leading-5 text-muted">
              {imageRefNotice(images.length)}
            </p>

            {images.length > 0 ? (
              <div className="grid gap-2 rounded-lg border border-line bg-panel-2 p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <span className="text-[13px] text-ink">
                    题目原图 · {images.length}/{MAX_IMAGES}
                  </span>
                  <span className="text-[12px] text-amber">{IMAGE_CAPTION}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {images.map((item) => (
                    <figure key={item.id} className="w-[140px] rounded-lg border border-line bg-bg p-1">
                      <img src={item.src} alt="题目原图" className="h-20 w-full rounded object-contain" />
                      <figcaption className="mt-1 flex items-center justify-between gap-1 text-[12px]">
                        <button type="button" onClick={() => setZoom(item.src)} className="text-ink hover:underline">
                          放大
                        </button>
                        <span className="text-faint">{formatBytes(item.bytes)}</span>
                        <button
                          type="button"
                          onClick={() => setImages((current) => removeImage(current, item.id))}
                          className="text-muted hover:text-danger"
                        >
                          删掉
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <p className="px-1 text-[12px] leading-5 text-muted">
                  图只在内存里：不进 URL、不进快照、不写文件、也不发给任何人。
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  data-testid={`solve-example-${EXAMPLES.indexOf(example)}`}
                  onClick={() => useExample(example.text)}
                  className="focus-ring rounded border border-line px-2 py-1 text-[13px] text-muted transition-colors hover:border-line-2 hover:text-ink"
                >
                  {example.label}
                </button>
              ))}
            </div>
            {(outcome?.notes ?? []).map((note) => (
              <p key={note} className="text-[13px] leading-6 text-muted">
                · {note}
              </p>
            ))}
            {(outcome?.issues ?? []).map((issue) => (
              <p key={issue} className="text-[13px] leading-6 text-danger">
                · {issue}
              </p>
            ))}

            {outcome?.blocked ? (
              <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
                <p className="text-[13px] text-danger">不覆盖 · 题面出现「{outcome.blocked.term}」</p>
                <p className="mt-1 text-[13px] leading-6 text-ink">{outcome.blocked.message}</p>
                <p className="mt-1 text-[13px] leading-6 text-muted">
                  该用什么方法：{outcome.blocked.method}。
                  {outcome.blocked.templateId ? (
                    <>
                      {' '}题面本来会落到 <span className="id-mono text-ink">{outcome.blocked.templateId}</span>，
                      但已在这里停下，不预填任何参数。
                    </>
                  ) : null}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <a href="#/scope" className="focus-ring text-[13px] text-ink underline-offset-2 hover:underline">
                    去 #/scope 走一遍判别
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setOutcome(null);
                      document.getElementById('solve-problem-text')?.focus();
                    }}
                    className="focus-ring text-[13px] text-muted transition-colors hover:text-ink"
                  >
                    改写成覆盖内的题
                  </button>
                  <a href="#/about" className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
                    看能力边界
                  </a>
                </div>
              </div>
            ) : null}
          </div>

          {outcome?.draft ? (
            <div className="border-t border-line px-5 py-4">
              <p className="text-[13px] text-muted">
                待确认 · {outcome.draft.source === 'ai' ? '读图' : '规则解析'} · 题型{' '}
                <span className="id-mono text-ink">{outcome.draft.templateId}</span> {draftRoute?.entry.title ?? ''}
              </p>
              <p className="mt-1 text-[13px] leading-6 text-muted">理由：{outcome.draft.reason}</p>

              {/* W20 §3-3：N-02 已把两份参数并成一张表，这里把「结构草稿」那张独立卡片
                  也收进表格的 caption —— 页面只剩一张表，四列（含来源）不变。 */}
              {mergedRows.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table data-testid="draft-table" className="w-full text-left text-[13px]">
                    {labDraft ? (
                      <caption data-testid="lab-draft" className="caption-bottom pt-2 text-left text-[12px] leading-5 text-muted">
                        结构草稿：{labDraft.ok ? `按 ${labDraft.draft.templateId} 的骨架族映射，结构可在装配台改` : labDraft.reason}
                        <span className="mt-0.5 block text-amber">{LAB_DRAFT_DISCLAIMER}</span>
                      </caption>
                    ) : null}
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-2 font-normal">参数</th>
                        <th className="py-1 pr-2 font-normal">值</th>
                        <th className="py-1 pr-2 font-normal">单位</th>
                        <th className="py-1 font-normal">来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mergedRows.map(({ param, value, source }) => {
                        const bad = outOfRange.has(param.key);
                        return (
                          <tr key={param.key} className="border-t border-line/60">
                            <td className="py-1 pr-2 text-ink">{param.label}</td>
                            <td className={`py-1 pr-2 tabular-nums ${bad ? 'text-danger' : 'text-ink'}`}>
                              {String(value)}
                              {bad ? `（越界，合法 ${rangeText(param)}）` : ''}
                            </td>
                            <td className="py-1 pr-2 text-muted">{param.unit ?? '—'}</td>
                            {/* 默认值必须显眼：合并成一张表也不许把「默认」伪装成题面 */}
                            <td className={`py-1 ${bad ? 'text-danger' : source === '默认' ? 'text-amber' : 'text-ink'}`}>
                              {bad ? '越界' : source}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : labDraft ? (
                // 没有参数行时（解析不出参数表），说明仍要有地方落，但不另起一张表。
                <p data-testid="lab-draft" className="mt-3 text-[12px] leading-5 text-muted">
                  结构草稿：{labDraft.ok ? `按 ${labDraft.draft.templateId} 的骨架族映射，结构可在装配台改` : labDraft.reason} · {LAB_DRAFT_DISCLAIMER}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
        </div>
      </main>

      {/* 两个出口（N-01）：主看结构、次看讲解；这里以外没有第三个前进键 */}
      <div className="glass-bar sticky bottom-0 z-20 border-t border-line">
        <div className={`${SHELL} flex flex-wrap items-center gap-5 py-3`}>
          <span className="text-[13px] text-muted">
            {entry
              ? `${entry.id} · ${errorKeys.length > 0 ? `${errorKeys.length} 项待改` : '参数就绪'}`
              : '还没选题型'}
          </span>
          <div className="ml-auto flex items-center gap-5">
            <button
              type="button"
              data-testid="go-explain"
              onClick={goExplain}
              disabled={!explainReady}
              className={QUIET}
            >
              看讲解 →
            </button>
            <button
              type="button"
              data-testid="go-lab-structure"
              onClick={() => void goStructure()}
              disabled={!structureReady}
              title={structureReady ? '带着这张图进装配台：改结构、改参数，同一个求解器' : '先选一个题型'}
              className={PRIMARY}
            >
              看结构 →
            </button>
          </div>
        </div>
      </div>

      {zoom ? (
        <div
          role="presentation"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 p-6"
        >
          <img src={zoom} alt="题目原图" className="max-h-full max-w-full rounded-lg border border-line object-contain" />
          <span className="absolute bottom-6 text-[13px] text-muted">点任意处关闭</span>
        </div>
      ) : null}
    </div>
  );
}

function TemplateChip({
  entry,
  active,
  onPick,
  onPickVariant,
}: {
  entry: TemplateEntry;
  active: boolean;
  onPick: () => void;
  onPickVariant: (id: string) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={onPick}
        title={entry.title}
        className={`focus-ring rounded-lg border px-2 py-1 text-[13px] transition-colors ${
          active ? 'border-line-2 bg-elev text-ink' : 'border-line text-muted hover:border-line-2 hover:text-ink'
        }`}
      >
        {entry.id}
      </button>
      {(entry.variants ?? []).map((variant) => (
        <button
          key={variant.id}
          type="button"
          onClick={() => onPickVariant(variant.id)}
          title={variant.title}
          className="focus-ring rounded border border-line px-1.5 py-0.5 text-[12px] text-muted transition-colors hover:border-line-2 hover:text-ink"
        >
          {variant.short}
        </button>
      ))}
    </span>
  );
}
