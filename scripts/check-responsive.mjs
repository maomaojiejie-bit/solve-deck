/**
 * 响应式静态门禁：不跑浏览器，只查「写死的宽度」和「没带断点的多列网格」。
 *
 * 起因：整站是给手机拍题用的，但一路加功能时很容易写出 `min-w-[720px]` 或
 * `grid-cols-4` 这种在 360px 屏上直接把页面顶出去的东西 —— 视觉复核看不出来
 * （截图都是 1440 宽），于是单独立一道。
 *
 *  ① 固定宽度：`w-[Npx]` / `min-w-[Npx]` / 内联 `width: Npx`，N > 320 必须在白名单里
 *  ② 多列网格：`grid-cols-N`（N ≥ 2）必须带断点前缀（sm:/md:/lg:/xl:/2xl:），
 *     或该元素本身是 `hidden … sm:grid`（窄屏不显示，多列只在宽屏生效）
 *  ③ 白名单必须活着：条目对不上任何一处 = 过期白名单，报错（防止改了宽度忘了删条目）
 *
 * 322px 这条线不是拍的：iPhone SE 视口 320，加 1px 边框余量，写死 321 就已经会横向滚动。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(root, 'src');
const EXTENSIONS = new Set(['.tsx', '.ts', '.css']);
/** 窄屏视口宽（iPhone SE）—— 超过这个数的「固定宽度」就会横向滚动。 */
const NARROW = 320;

/**
 * 白名单：只放「表格类必须横向滚动才能读」的场合，每条都要写清为什么。
 * 每条还会被反过来校验：必须真的存在、且外层确实是 overflow-x-auto。
 */
const WHITELIST = [
  {
    file: 'src/render/Matrix.tsx',
    token: 'min-w-[720px]',
    why: 'W21-A：校验栈 7 列把「结论」列挪到最右、固定 72px 并 sticky；窄屏仍靠外层 overflow-x-auto 滚',
  },
];

const problems = [];
let checks = 0;

function fail(rule, detail) {
  problems.push(`${rule} / ${detail}`);
}

function walk(dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(path));
    else if (EXTENSIONS.has(item.name.slice(item.name.lastIndexOf('.')))) out.push(path);
  }
  return out;
}

const files = walk(SRC).sort();
const rel = (path) => path.slice(root.length).replace(/\\/g, '/');

const found = new Map(); // `${file}|${token}` → 行号列表
let widthScanned = 0;
let gridScanned = 0;

for (const file of files) {
  const name = rel(file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    /* ① 固定宽度 */
    for (const hit of line.matchAll(/(?<![-\w])(?:min-)?w-\[(\d+(?:\.\d+)?)px\]/g)) {
      widthScanned += 1;
      const px = Number(hit[1]);
      if (px <= NARROW) continue;
      const token = hit[0];
      const key = `${name}|${token}`;
      if (!found.has(key)) found.set(key, []);
      found.get(key).push(lineNo);
      if (!WHITELIST.some((entry) => entry.file === name && entry.token === token)) {
        fail('①', `${name}:${lineNo} 写死 ${token}（> ${NARROW}px），窄屏会横向滚动；要横向滚动请放 overflow-x-auto 并加白名单`);
      }
    }
    for (const hit of line.matchAll(/style=\{\{[^}]*?\bwidth:\s*(\d+)/g)) {
      widthScanned += 1;
      if (Number(hit[1]) > NARROW) fail('①', `${name}:${lineNo} 内联 width: ${hit[1]}px（> ${NARROW}px）`);
    }
    if (file.endsWith('.css')) {
      for (const hit of line.matchAll(/(?:^|[^-])width:\s*(\d+)px/g)) {
        widthScanned += 1;
        if (Number(hit[1]) > NARROW) fail('①', `${name}:${lineNo} CSS width: ${hit[1]}px（> ${NARROW}px）`);
      }
    }

    /* ② 多列网格 */
    for (const hit of line.matchAll(/(^|[^-\w])grid-cols-(\d+)/g)) {
      const columns = Number(hit[2]);
      if (columns < 2) continue;
      gridScanned += 1;
      const prefix = line.slice(0, hit.index + hit[1].length);
      // 断点前缀：紧挨着 className 里的 sm:/md:/lg:/xl:/2xl:
      if (/(?:sm|md|lg|xl|2xl):$/.test(prefix)) continue;
      // `hidden grid-cols-2 … sm:grid`：窄屏整个不显示，多列只在宽屏生效
      if (/\bhidden\b/.test(line) && /\b(?:sm|md|lg|xl|2xl):grid\b/.test(line)) continue;
      fail('②', `${name}:${lineNo} grid-cols-${columns} 没有断点前缀（窄屏 ${NARROW}px 会挤成一列字）`);
    }
  });
}

/* ③ 白名单不许过期 */
for (const entry of WHITELIST) {
  const hits = found.get(`${entry.file}|${entry.token}`);
  checks += 1;
  if (!hits) {
    fail('③', `白名单条目过期：${entry.file} 里已经没有 ${entry.token}（改完宽度记得删条目）`);
    continue;
  }
  // 白名单里的写死宽度，外层必须是横向滚动容器，否则「白名单」就只是免死金牌
  const lines = readFileSync(join(root, entry.file), 'utf8').split(/\r?\n/);
  const near = lines
    .slice(Math.max(0, hits[0] - 4), hits[0])
    .join('\n');
  checks += 1;
  if (!/overflow-x-auto/.test(near)) {
    fail('③', `白名单条目 ${entry.file}:${hits[0]} 外层没有 overflow-x-auto —— 那就不是「横向滚动」，是「横向溢出」`);
  }
  checks += 1;
  if (!entry.why || entry.why.length < 8) fail('③', `白名单条目 ${entry.file} 没写理由`);
}

checks += widthScanned + gridScanned;

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems.slice(0, 30)) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `PASS：${checks} 项（响应式门禁：${files.length} 个源文件 / ${widthScanned} 处宽度 / ${gridScanned} 处多列网格 / ${WHITELIST.length} 条白名单均带 overflow-x-auto）`,
);
