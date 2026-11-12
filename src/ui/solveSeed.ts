/**
 * 首页 hero → `#/solve` 的一次性交接（R3-2 §2）。
 *
 * 跨 hash 跳转不携带表单状态，而 hero 上「贴一句话 / 拖一张图」是承诺过的动作：
 * 写成 sessionStorage 的一次性种子，`#/solve` 打开时取走并清空 —— 刷新不会重复灌入，
 * 也不会把图写进 URL（图只在内存 / 会话里，不进分享链接）。
 */

import type { ProblemImage } from '../core/ai/image';

export const SOLVE_SEED_KEY = 'sd.solve.seed';

export interface SolveSeed {
  text?: string;
  image?: ProblemImage;
}

export function writeSolveSeed(seed: SolveSeed): boolean {
  try {
    const scope = globalThis as { sessionStorage?: Storage };
    const box = scope.sessionStorage;
    if (!box) return false;
    box.setItem(SOLVE_SEED_KEY, JSON.stringify(seed));
    return true;
  } catch {
    // 隐私模式 / 配额满：交接失败就退化成「只带文字进 URL」
    return false;
  }
}

export function takeSolveSeed(): SolveSeed | null {
  try {
    const scope = globalThis as { sessionStorage?: Storage };
    const box = scope.sessionStorage;
    if (!box) return null;
    const raw = box.getItem(SOLVE_SEED_KEY);
    box.removeItem(SOLVE_SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SolveSeed;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
