/**
 * 复合器件定义的注册表与持久化（W13）。
 *
 * 独立成模块的理由：ops.ts（封装操作）要存定义、pins.ts 要查端口几何，
 * 而 composite.ts 又要 import ops 的白名单 —— 定义存取放在中间层，
 * 让依赖保持单向（ops → store ← composite，pins → store）。
 *
 * 定义来源三处：内置（compositeBuiltin，不进这里）+ 会话注册（分享链接
 * 载入 / 封装保存后立刻注册）+ localStorage（sd.lab.composite.v1，与
 * 与 AI 配置无关，单独一个 key 名空间）。
 */

import { BUILTIN_COMPOSITES } from './compositeBuiltin.ts';
import type { CompositeDef } from './composite.ts';

export const COMPOSITE_STORAGE_KEY = 'sd.lab.composite.v1';

const sessionRegistry = new Map<string, CompositeDef>();

/** 分享链接载入 / localStorage 载入后注册进会话；同名内置定义不让覆盖。 */
export function registerComposites(defs: readonly CompositeDef[]): void {
  for (const def of defs) {
    if (BUILTIN_COMPOSITES[def.id]) continue;
    if (def?.id && Array.isArray(def.ports)) sessionRegistry.set(def.id, def);
  }
}

export function registeredComposites(): CompositeDef[] {
  return [...sessionRegistry.values()];
}

export function forgetComposites(): void {
  sessionRegistry.clear();
}

export function allComposites(): Record<string, CompositeDef> {
  return { ...BUILTIN_COMPOSITES, ...Object.fromEntries(sessionRegistry) };
}

/** localStorage 读取（SSR / 门禁环境静默返回空）。 */
export function loadStoredComposites(): CompositeDef[] {
  try {
    const raw = globalThis.localStorage?.getItem(COMPOSITE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CompositeDef[];
    return Array.isArray(parsed) ? parsed.filter((def) => def?.id && Array.isArray(def.ports)) : [];
  } catch {
    return [];
  }
}

export function storeComposites(defs: readonly CompositeDef[]): void {
  try {
    globalThis.localStorage?.setItem(COMPOSITE_STORAGE_KEY, JSON.stringify(defs));
  } catch {
    /* 存不进去就只在会话内有效 —— 不假装存成功了 */
  }
}
