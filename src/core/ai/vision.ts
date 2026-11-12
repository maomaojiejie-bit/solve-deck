/**
 * 识图入口（R3-2 §5 / AI-1~AI-3）：AI 只剩这一件事，而且**默认关**。
 *
 * 三条不变式：
 *  ① 开关没开 → 一次请求都不发（`readStructure` 第一步就返回，不碰 fetch）；
 *  ② 每会话最多 `VISION_CONFIG.maxPerSession` 次，超了如实说「用完了」，不偷偷扣额度；
 *  ③ 失败不阻断：调用方拿 `keepOnFailure()` 把失败折成一行提示，原有结构 / 规则结果原样留着。
 *
 * 「只读不算」的规矩沿用 R2-T2 的契约：模型只回 templateId / params / reason / unsure，
 * 数值结论一律作废（validate.ts 的 checkDraft），结构草稿本身不改求解器。
 */

import { VISION_CONFIG } from './config.ts';
import {
  buildStructurePrompt,
  describeProviderError,
  extractJson,
  makeVisionProvider,
  type Generate,
} from './provider.ts';
import { checkDraft } from './validate.ts';
import type { AIDraft } from './types.ts';

function store(): Storage | null {
  try {
    const scope = globalThis as { sessionStorage?: Storage };
    return scope.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** 开关：只存 sessionStorage —— 刷新即关，这是「默认关」的落到实处。 */
export function isVisionEnabled(): boolean {
  const box = store();
  if (!box) return VISION_CONFIG.defaultOn;
  try {
    return box.getItem(VISION_CONFIG.switchKey) === '1';
  } catch {
    return VISION_CONFIG.defaultOn;
  }
}

export function setVisionEnabled(on: boolean): void {
  const box = store();
  if (!box) return;
  try {
    if (on) box.setItem(VISION_CONFIG.switchKey, '1');
    else box.removeItem(VISION_CONFIG.switchKey);
  } catch {
    // 隐私模式：开关只在本页内存里生效（调用方自己记状态）
  }
}

export function visionUsed(): number {
  const box = store();
  if (!box) return 0;
  try {
    const raw = Number(box.getItem(VISION_CONFIG.countKey) ?? '0');
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

export function visionUsesLeft(): number {
  return Math.max(0, VISION_CONFIG.maxPerSession - visionUsed());
}

function noteUse(): number {
  const next = visionUsed() + 1;
  const box = store();
  if (box) {
    try {
      box.setItem(VISION_CONFIG.countKey, String(next));
    } catch {
      // 存不下就只在本次调用里算一次，不阻断
    }
  }
  return next;
}

export interface VisionOutcome {
  ok: boolean;
  draft: AIDraft | null;
  /** 失败原因（成功时为空串）。页面的「AI 这次没帮上：…」由 keepOnFailure 拼。 */
  reason: string;
  /** 这次之后本会话还剩几次。 */
  left: number;
}

export interface VisionDeps {
  /** 注入假 provider（门禁用）；默认走固定配置的真 provider。 */
  generate?: Generate;
  /** 覆盖开关（默认读 sessionStorage）。 */
  enabled?: boolean;
}

/**
 * 把图读成结构草稿。**没开开关就零请求**。
 * 不做重试：一次失败就把原因说清楚，用户自己决定要不要再点。
 */
export async function readStructure(images: readonly string[], deps: VisionDeps = {}): Promise<VisionOutcome> {
  const enabled = deps.enabled ?? isVisionEnabled();
  const left = visionUsesLeft();
  if (!enabled) {
    return { ok: false, draft: null, reason: 'AI 识图默认关闭：先打开「本场开启 AI 识图」（刷新即关）。', left };
  }
  if (left <= 0) {
    return { ok: false, draft: null, reason: `本次会话的 ${VISION_CONFIG.maxPerSession} 次已用完（刷新页面重置）。`, left };
  }
  const pictures = images.filter((item) => item.startsWith('data:image/'));
  if (pictures.length === 0) {
    return { ok: false, draft: null, reason: '没有图可读：先选一张题目截图。', left };
  }

  // 扣额度在请求**之前**：失败也算用过一次，不许免费重试刷额度
  const used = noteUse();
  const after = Math.max(0, VISION_CONFIG.maxPerSession - used);

  const generate = deps.generate ?? makeVisionProvider();
  try {
    const raw = await generate({ prompt: buildStructurePrompt(), images: pictures });
    const checked = checkDraft(extractJson(raw), '', 'ai');
    if (!checked.draft) {
      return { ok: false, draft: null, reason: checked.issues[0] ?? '读数不合格', left: after };
    }
    return { ok: true, draft: checked.draft, reason: '', left: after };
  } catch (error) {
    return { ok: false, draft: null, reason: describeProviderError(error), left: after };
  }
}

/**
 * 失败不阻断：把失败折成一行提示，草稿原样返回。
 * 页面只调这个函数，所以「AI 挂了会把已有结果清空」这类事故在类型上就写不出来。
 */
export function keepOnFailure<T>(existing: T, reason: string): { draft: T; note: string } {
  return { draft: existing, note: `AI 这次没帮上：${reason}` };
}
