/**
 * R-36 · 做题历史与收藏（localStorage）。
 *
 * 复用分享链接的同一份编码（encodeSharePayload / decodeSharePayload）：
 * 一条记录 = 一整张 CanvasGraph + 它用到的复合器件定义，自包含、不依赖 fixtures。
 * 于是「最近使用」和「收藏」点开就是同一条 `#/lab/t/<id>?g=...` 路径 —— 与
 * 「分享此图」「刷新恢复」走完全相同的解码分支，不新增第二套图还原逻辑。
 *
 * 纯函数 + 薄存储层：SSR / 门禁环境（没有 localStorage）静默返回空库，
 * 写入失败（隐私模式 / 配额满）也静默跳过 —— 不假装存成功了。
 */

import { encodeSharePayload, usedCompositeDefs } from './composite.ts';
import type { CanvasGraph } from './types.ts';

export const LIBRARY_STORAGE_KEY = 'sd.lab.library.v1';
/** 最近使用按题型去重，只留每型最后一次；收藏允许同一题型存多份不同状态。 */
export const HISTORY_LIMIT = 12;
export const FAVORITE_LIMIT = 24;

export interface SavedGraph {
  id: string;
  templateId: string;
  /** 历史自动取题型标题；收藏可由用户改名字。 */
  title: string;
  /** encodeSharePayload 的原始 base64（未 encodeURIComponent），含 defs。 */
  payload: string;
  at: number;
  /** true = 改过图，载入时带 ?g=；false = 骨架，载入干净链接。 */
  dirty: boolean;
  /** R-37 可选标签：旧数据没有这个字段，sanitize 要放行。 */
  tags?: string[];
}

export interface LabLibrary {
  history: SavedGraph[];
  favorites: SavedGraph[];
}

export const emptyLibrary = (): LabLibrary => ({ history: [], favorites: [] });

function isSavedGraph(value: unknown): value is SavedGraph {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SavedGraph>;
  return (
    typeof item.id === 'string' &&
    typeof item.templateId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.payload === 'string' &&
    typeof item.at === 'number' &&
    Number.isFinite(item.at) &&
    typeof item.dirty === 'boolean' &&
    (item.tags === undefined ||
      (Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === 'string')))
  );
}

/** 坏数据不拖垮页面：逐条过滤，字段不全或类型不对的直接丢。 */
function sanitize(raw: unknown): LabLibrary {
  if (!raw || typeof raw !== 'object') return emptyLibrary();
  const lib = raw as Partial<LabLibrary>;
  return {
    history: Array.isArray(lib.history) ? lib.history.filter(isSavedGraph).slice(0, HISTORY_LIMIT) : [],
    favorites: Array.isArray(lib.favorites) ? lib.favorites.filter(isSavedGraph).slice(0, FAVORITE_LIMIT) : [],
  };
}

/** localStorage 读取（SSR / 门禁环境静默返回空库）。 */
export function loadLibrary(): LabLibrary {
  try {
    const raw = globalThis.localStorage?.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return emptyLibrary();
    return sanitize(JSON.parse(raw));
  } catch {
    return emptyLibrary();
  }
}

export function saveLibrary(lib: LabLibrary): void {
  try {
    globalThis.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(lib));
  } catch {
    /* 存不进去就只在本次会话里有效 —— 不假装存成功了 */
  }
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 把一张图打包成一条记录。title 由调用方给（题型标题或用户命名）。 */
export function makeSavedGraph(
  templateId: string,
  graph: CanvasGraph,
  title: string,
  dirty: boolean,
  name?: string,
): SavedGraph {
  return {
    id: newId(),
    templateId,
    title: (name ?? title).trim() || title,
    payload: encodeSharePayload({ graph, defs: usedCompositeDefs(graph) }),
    at: Date.now(),
    dirty,
  };
}

/** 最近使用：同一题型只留最新一条，按时间倒序，超出上限截断。 */
export function touchHistory(lib: LabLibrary, entry: SavedGraph): LabLibrary {
  return {
    ...lib,
    history: [entry, ...lib.history.filter((item) => item.templateId !== entry.templateId)].slice(0, HISTORY_LIMIT),
  };
}

/** 收藏：允许一型多份；同名覆盖旧记录（避免反复点收藏堆出一列重复项）。 */
export function addFavorite(lib: LabLibrary, entry: SavedGraph): LabLibrary {
  return {
    ...lib,
    favorites: [entry, ...lib.favorites.filter((item) => !(item.templateId === entry.templateId && item.title === entry.title))].slice(
      0,
      FAVORITE_LIMIT,
    ),
  };
}

export function removeFavorite(lib: LabLibrary, id: string): LabLibrary {
  return { ...lib, favorites: lib.favorites.filter((item) => item.id !== id) };
}

/** R-37 改名：空名不收（否则卡片会变成没有可访问名的空按钮）。 */
export function renameFavorite(lib: LabLibrary, id: string, name: string): LabLibrary {
  const title = name.trim();
  if (!title) return lib;
  return {
    ...lib,
    favorites: lib.favorites.map((item) => (item.id === id ? { ...item, title } : item)),
  };
}

/** 标签输入串 → 去重去空，最多 6 个；逗号 / 顿号 / 空白都能分。 */
export function parseTags(raw: string): string[] {
  const parts = raw.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 6);
}

export function setFavoriteTags(lib: LabLibrary, id: string, tags: string[]): LabLibrary {
  return {
    ...lib,
    favorites: lib.favorites.map((item) => (item.id === id ? { ...item, tags } : item)),
  };
}

export type LibrarySort = 'recent' | 'name' | 'template';
const SORTS: LibrarySort[] = ['recent', 'name', 'template'];
export const LIBRARY_SORT_KEY = 'sd.lab.library.sort.v1';

export function loadLibrarySort(): LibrarySort {
  try {
    const raw = globalThis.localStorage?.getItem(LIBRARY_SORT_KEY) as LibrarySort | null;
    return raw && SORTS.includes(raw) ? raw : 'recent';
  } catch {
    return 'recent';
  }
}

export function saveLibrarySort(sort: LibrarySort): void {
  try {
    globalThis.localStorage?.setItem(LIBRARY_SORT_KEY, sort);
  } catch {
    /* 存不了就只在本会话有效 */
  }
}

/** 排序是纯函数：不改原数组，门禁可直接断言顺序。 */
export function sortFavorites(items: readonly SavedGraph[], sort: LibrarySort): SavedGraph[] {
  const copy = [...items];
  if (sort === 'name') return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  if (sort === 'template') {
    return copy.sort((a, b) => a.templateId.localeCompare(b.templateId) || b.at - a.at);
  }
  return copy.sort((a, b) => b.at - a.at);
}

export function clearHistory(lib: LabLibrary): LabLibrary {
  return { ...lib, history: [] };
}

/** 记录 → 可 onStart 的 hash。骨架态不带 ?g=，避免载入后出现「已从链接载入」徽标。 */
export function libraryHref(entry: SavedGraph): string {
  const base = `#/lab/t/${encodeURIComponent(entry.templateId)}`;
  return entry.dirty && entry.payload ? `${base}?g=${encodeURIComponent(entry.payload)}` : base;
}

/** 相对时间：不引依赖，不写死语言包。 */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(at).toLocaleDateString('zh-CN');
}
