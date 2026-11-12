/**
 * 许可门禁：
 *  - 扫描 dependencies + devDependencies 的 license，GPL/AGPL/LGPL/EPL 一律失败；
 *  - 扫描 src/scripts 里的裸包 import/require，出现未声明依赖一律失败（防幻影依赖）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declared = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

const errors = [];
const rows = [];

for (const name of Object.keys(declared).sort()) {
  const metaPath = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(metaPath)) {
    errors.push(`${name} 未安装或缺少 package.json`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const license =
    meta.license ||
    (Array.isArray(meta.licenses) ? meta.licenses.map((item) => item.type).join(' OR ') : '');
  rows.push({ name, version: meta.version, license });
  if (!license) {
    errors.push(`${name}@${meta.version} 缺少 license 字段`);
    continue;
  }
  if (/GPL|EPL/i.test(license)) {
    errors.push(`${name}@${meta.version} 许可 ${license} 命中 GPL/EPL 禁令`);
  }
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https',
  'module', 'os', 'path', 'process', 'stream', 'url', 'util', 'worker_threads',
]);

function packageNameOf(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  const name = specifier.split('/')[0];
  return NODE_BUILTINS.has(name) ? null : name;
}

const SPECIFIER_PATTERNS = [
  /import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
];

const sourceFiles = [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))];
const usedPackages = new Map();
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const name = packageNameOf(match[1]);
      if (!name) continue;
      if (!usedPackages.has(name)) usedPackages.set(name, new Set());
      usedPackages.get(name).add(relative(root, file));
    }
  }
}

for (const [name, files] of [...usedPackages.entries()].sort()) {
  if (!(name in declared)) {
    errors.push(
      `源码 import/require 了未声明的包 ${name}（${[...files].slice(0, 3).join(', ')}）`,
    );
  }
}

console.log('声明依赖许可：');
for (const row of rows) {
  console.log(`  ${row.name}@${row.version}  ${row.license}`);
}
console.log(`源码裸包：${[...usedPackages.keys()].sort().join(', ') || '无'}`);

if (errors.length > 0) {
  console.error(`\nFAIL：${errors.length} 个许可/依赖问题`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(
  `PASS：${rows.length} 个声明依赖均非 GPL/AGPL/LGPL/EPL；源码裸包全部已声明`,
);