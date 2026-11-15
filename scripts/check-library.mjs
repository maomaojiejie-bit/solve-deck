/**
 * check:library — R-36 做题历史与收藏门禁。
 *
 * ① 记录自包含：payload 解码回来就是原图（含复合器件定义口径）
 * ② 载入链接与 ?g= 同源：脏图带 g、骨架不带，且能从 href 还原出同一张图
 * ③ 历史：同题型去重 / 倒序 / 上限
 * ④ 收藏：一型多份 / 同名覆盖 / 取消 / 上限
 * ⑤ 落盘往返 + 坏数据兜底（非法 JSON / 字段缺失 / 类型不对都不许拖垮页面）
 * ⑥ 无 localStorage（门禁 / 隐私模式）静默降级，不许抛
 * ⑦ 相对时间
 * ⑧ 源码哨兵：首页面板、收藏按钮、自动记录确实接在 Lab 上
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIBRARY_STORAGE_KEY,
  HISTORY_LIMIT,
  FAVORITE_LIMIT,
  emptyLibrary,
  loadLibrary,
  saveLibrary,
  makeSavedGraph,
  touchHistory,
  addFavorite,
  removeFavorite,
  clearHistory,
  libraryHref,
  relativeTime,
} from '../src/core/lab/library.ts';
import { decodeSharePayload } from '../src/core/lab/composite.ts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
let checks = 0;
const problems = [];
function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} ${detail}`);
}

/* ── mock localStorage（可随时摘掉测降级） ───────────────────────── */
const mem = new Map();
const mockStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
};
globalThis.localStorage = mockStorage;

/** 最小可编码图：encodeSharePayload 只做 JSON + base64，不依赖 fixtures。 */
const graph = {
  templateId: 'A1',
  family: 'circuit',
  nodes: [{ id: 'n-vs', x: 0, y: 0, kind: 'vsrc', label: 'Vs 5V', value: 5 }],
  edges: [],
  meta: {},
};
const now = Date.now();

/* ── ① 记录自包含 ─────────────────────────────────────────────── */
{
  const entry = makeSavedGraph('A1', graph, '分压电路', true);
  ok('①', entry.payload.length > 0 && entry.dirty === true && entry.title === '分压电路', '记录字段没落上');
  ok('①', entry.templateId === 'A1' && Number.isFinite(entry.at) && typeof entry.id === 'string', '记录缺题型 / 时间 / id');
  const back = decodeSharePayload(entry.payload);
  ok('①', back?.graph?.nodes?.[0]?.value === 5 && back.graph.nodes[0].id === 'n-vs', 'payload 解不回原图');
  ok('①', Array.isArray(back?.defs), 'payload 没带 defs 口径（分享链接格式漂移）');
  const named = makeSavedGraph('A1', graph, '分压电路', true, '  我的实验一  ');
  ok('①', named.title === '我的实验一', '收藏命名没生效');
  ok('①', makeSavedGraph('A1', graph, '分压电路', true, '   ').title === '分压电路', '空名字没回退到题型标题');
}

/* ── ② 载入链接与 ?g= 同源 ─────────────────────────────────────── */
{
  const dirty = makeSavedGraph('A1', graph, '分压电路', true);
  const href = libraryHref(dirty);
  ok('②', href.startsWith('#/lab/t/A1?g='), `脏图链接没带 ?g=：${href.slice(0, 40)}`);
  const raw = new URLSearchParams(href.split('?')[1]).get('g');
  // Lab.tsx 从 URLSearchParams 拿到的是已解码的 base64；这里手工做同一件事。
  const fromHref = decodeSharePayload(decodeURIComponent(raw));
  ok('②', fromHref?.graph?.nodes?.[0]?.value === 5, '从链接解不回同一张图');
  ok('②', libraryHref({ ...dirty, dirty: false }) === '#/lab/t/A1', '骨架态不该带 ?g=（会误显示「已从链接载入」）');
  ok('②', libraryHref({ ...dirty, templateId: 'M3' }).startsWith('#/lab/t/M3'), '题型 id 没进链接');
}

/* ── ③ 历史：去重 / 倒序 / 上限 ────────────────────────────────── */
{
  let lib = emptyLibrary();
  const a1a = { ...makeSavedGraph('A1', graph, 'A1 第一次', true), at: now };
  const a1b = { ...makeSavedGraph('A1', graph, 'A1 第二次', true), at: now + 1 };
  const m3 = { ...makeSavedGraph('M3', graph, 'M3', false), at: now + 2 };
  lib = touchHistory(touchHistory(touchHistory(lib, a1a), a1b), m3);
  ok('③', lib.history.length === 2, `同题型没去重：${lib.history.length} 条`);
  ok('③', lib.history[0].templateId === 'M3' && lib.history[1].templateId === 'A1', '没按时间倒序');
  ok('③', lib.history[1].title === 'A1 第二次', '同题型留的不是最新一条');
  ok('③', lib.favorites.length === 0, '写历史不该动收藏');
  let big = emptyLibrary();
  for (let i = 0; i < HISTORY_LIMIT + 6; i += 1) {
    big = touchHistory(big, { ...makeSavedGraph(`T${i}`, graph, `图 ${i}`, true), at: now + i });
  }
  ok('③', big.history.length === HISTORY_LIMIT, `历史上限失效：${big.history.length}`);
  ok('③', big.history[0].title === `图 ${HISTORY_LIMIT + 5}`, '超限后最新一条被截掉了');
  ok('③', clearHistory(big).history.length === 0 && clearHistory(big).favorites.length === big.favorites.length, '清空历史误伤收藏');
}

/* ── ④ 收藏：一型多份 / 同名覆盖 / 取消 / 上限 ──────────────────── */
{
  let lib = emptyLibrary();
  const f1 = { ...makeSavedGraph('A1', graph, '方案甲', true), at: now };
  const f2 = { ...makeSavedGraph('A1', graph, '方案乙', true), at: now + 1 };
  lib = addFavorite(addFavorite(lib, f1), f2);
  ok('④', lib.favorites.length === 2, '同一题型不能存两份不同状态');
  ok('④', lib.favorites[0].title === '方案乙', '收藏没按新到旧排');
  const f1b = { ...makeSavedGraph('A1', graph, '方案甲', true), at: now + 2 };
  lib = addFavorite(lib, f1b);
  ok('④', lib.favorites.length === 2 && lib.favorites.some((f) => f.title === '方案甲' && f.at === now + 2), '同名收藏没覆盖旧记录');
  const target = lib.favorites.find((f) => f.title === '方案乙').id;
  lib = removeFavorite(lib, target);
  ok('④', lib.favorites.length === 1 && lib.favorites[0].title === '方案甲', '取消收藏没删对');
  let big = emptyLibrary();
  for (let i = 0; i < FAVORITE_LIMIT + 5; i += 1) {
    big = addFavorite(big, { ...makeSavedGraph('A1', graph, `收藏 ${i}`, true), at: now + i });
  }
  ok('④', big.favorites.length === FAVORITE_LIMIT, `收藏上限失效：${big.favorites.length}`);
}

/* ── ⑤ 落盘往返 + 坏数据兜底 ───────────────────────────────────── */
{
  mem.clear();
  ok('⑤', loadLibrary().history.length === 0 && loadLibrary().favorites.length === 0, '空库读出来不是空库');
  const lib = addFavorite(
    touchHistory(emptyLibrary(), makeSavedGraph('A1', graph, '分压电路', true)),
    makeSavedGraph('M3', graph, '悬臂梁', false),
  );
  saveLibrary(lib);
  ok('⑤', mem.has(LIBRARY_STORAGE_KEY), '没有写进 localStorage');
  const back = loadLibrary();
  ok('⑤', back.history.length === 1 && back.favorites.length === 1, '往返丢记录');
  ok('⑤', back.favorites[0].title === '悬臂梁' && back.history[0].title === '分压电路', '往返字段不符');
  mem.set(LIBRARY_STORAGE_KEY, '{ 这不是 json');
  ok('⑤', loadLibrary().favorites.length === 0, '非法 JSON 没兜住');
  mem.set(LIBRARY_STORAGE_KEY, JSON.stringify({ history: [{ id: 'x' }], favorites: 'nope' }));
  const dirty = loadLibrary();
  ok('⑤', dirty.history.length === 0 && dirty.favorites.length === 0, '字段不全 / 类型不对没被逐条过滤');
  mem.set(LIBRARY_STORAGE_KEY, JSON.stringify({ history: [lib.history[0], { id: 'bad' }], favorites: [] }));
  ok('⑤', loadLibrary().history.length === 1, '混合坏数据没保住合法记录');
  mem.clear();
}

/* ── ⑥ 无 localStorage 静默降级 ───────────────────────────────── */
{
  const saved = globalThis.localStorage;
  delete globalThis.localStorage;
  let threw = false;
  try {
    ok('⑥', loadLibrary().history.length === 0, '无存储时没返回空库');
    saveLibrary(addFavorite(emptyLibrary(), makeSavedGraph('A1', graph, 'x', true)));
  } catch {
    threw = true;
  }
  ok('⑥', !threw, '无存储时 saveLibrary 抛异常了');
  globalThis.localStorage = saved;
}

/* ── ⑦ 相对时间 ───────────────────────────────────────────────── */
{
  ok('⑦', relativeTime(now, now) === '刚刚', '「刚刚」不对');
  ok('⑦', relativeTime(now - 5 * 60_000, now) === '5 分钟前', '分钟档不对');
  ok('⑦', relativeTime(now - 3 * 3_600_000, now) === '3 小时前', '小时档不对');
  ok('⑦', relativeTime(now - 2 * 86_400_000, now) === '2 天前', '天档不对');
  ok('⑦', relativeTime(now + 60_000, now) === '刚刚', '未来时间没夹到 0');
}

/* ── ⑧ 源码哨兵：面板 / 收藏按钮 / 自动记录确实接在 Lab 上 ────── */
{
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  const libSource = readFileSync(join(root, 'src', 'core', 'lab', 'library.ts'), 'utf8');
  ok('⑧', labSource.includes('data-testid="library-panel"') && labSource.includes('data-testid="library-open"'), '首页缺最近使用 / 收藏面板');
  ok('⑧', labSource.includes('data-testid="favorite-toggle"') && labSource.includes('data-testid="favorite-save"') && labSource.includes('data-testid="favorite-name"'), '编辑页缺收藏入口 / 命名 / 保存');
  ok('⑧', labSource.includes('onStart(libraryHref(item))'), '面板不是走既有 ?g= 载入路径');
  ok('⑧', labSource.includes('touchHistory(prev, makeSavedGraph') && labSource.includes('saveLibrary(library)'), '自动记录历史 / 落盘没接上');
  ok('⑧', labSource.includes('data-testid="library-clear-history"') && labSource.includes('data-testid="library-unfavorite"'), '清空历史 / 取消收藏没接上');
  ok('⑧', libSource.includes('encodeSharePayload') && libSource.includes('localStorage'), '数据层没复用分享编码 / 没用 localStorage');
}

/* ── 汇总 ─────────────────────────────────────────────────────── */
if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（历史 / 收藏：编码自包含 · ?g= 同源载入 · 去重与上限 · 落盘与坏数据兜底 · 无存储降级 · 源码哨兵）`);
