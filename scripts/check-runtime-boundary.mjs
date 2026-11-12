/**
 * 运行时边界门禁：
 *  - 从 src/main.tsx 出发，沿静态/动态相对 import 求 App 路由闭包；
 *  - 闭包内不得出现 src/confidence/buildtime/*、node:*、digitaljs/3vl/QMC；
 *  - physicsValidator.ts 必须保持零 import。
 *
 * 说明：vite build 也会在 node:* 处失败；本门禁把错误提前到 tsc 之前，并给出文件名。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = join(root, 'src', 'main.tsx');
const errors = [];

const NODE_ONLY_PACKAGES = new Set([
  'digitaljs',
  '3vl',
  '@helander/quine-mccluskey-js',
  'nerdamer',
]);

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    `${base}.css`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && extname(candidate) !== '');
}

function specifiers(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (/^\s*import\s+type\b/.test(line)) continue;
    const staticImport = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
    if (staticImport) out.push(staticImport[1]);
    const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (sideEffect) out.push(sideEffect[1]);
    const dynamic = line.match(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamic) out.push(dynamic[1]);
  }
  return out;
}

const reachable = new Set();
const queue = [entry];
while (queue.length > 0) {
  const file = queue.shift();
  if (reachable.has(file)) continue;
  reachable.add(file);
  const rel = relative(root, file).replaceAll('\\', '/');
  if (rel.includes('src/confidence/buildtime/')) {
    errors.push(`运行时代码 import 了构建期模块：${rel}`);
  }
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"]node:/.test(text) || /require\(\s*['"]node:/.test(text)) {
    errors.push(`${rel} import 了 node:*`);
  }
  for (const spec of specifiers(text)) {
    if (NODE_ONLY_PACKAGES.has(spec)) {
      errors.push(`${rel} import 了 Node-only 包 ${spec}`);
    }
    const next = resolveRelative(file, spec);
    if (next) queue.push(next);
  }
}

const validator = join(root, 'src', 'confidence', 'physicsValidator.ts');
const validatorText = readFileSync(validator, 'utf8');
if (/^\s*import\b/m.test(validatorText)) {
  errors.push('src/confidence/physicsValidator.ts 必须零 import');
}

if (errors.length > 0) {
  console.error(`FAIL：${errors.length} 个运行时边界问题`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS：App 路由闭包 ${reachable.size} 个文件；无 buildtime / node:* / Node-only 包`);
console.log('PASS：physicsValidator.ts 零 import');