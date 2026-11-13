// check:palette —— 面板与引擎必须对得上
// ① 引擎能 stamp 的每个 kind，面板上至少有一个按钮（防「能解但加不进去」）
// ② 面板上每个按钮的 kind 必须是引擎能 stamp 的（防点了等于没加）
// 纯文本解析，不 import .ts（与其它门禁同风格）。
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(`${root}/${p}`, 'utf8');

const netSolve = read('src/core/lab/netSolve.ts');
const lab = read('src/pages/Lab.tsx');

// 引擎：stamp 段里出现的 case 'x'（两段 DC/AC 各一次，去重）
const stampable = new Set([...netSolve.matchAll(/case '([a-z0-9]+)':/g)].map((m) => m[1]));

// 面板：CIRCUIT_ADDS 里的 kind
const addBlock = lab.slice(lab.indexOf('const CIRCUIT_ADDS'), lab.indexOf('const BEAM_SUPPORTS'));
const onPanel = [...addBlock.matchAll(/kind: '([a-z0-9]+)'/g)].map((m) => m[1]);

// 面板不该放的（非器件 / 需先行建模的），显式记账，不许偷偷扩
const NOT_ON_PANEL = { ctrlsrc: '受控源无 stamp', zener: '无 stamp', pnp: '无 stamp', pmos: '无 stamp' };

let fails = 0;
const log = (ok, msg) => { if (!ok) fails += 1; console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${msg}`); };

log(stampable.has('gnd'), `引擎可 stamp 的集合含 gnd：${[...stampable].sort().join(',')}`);
log(addBlock.includes("kind: 'gnd'"), '面板上有「接地」按钮（无地整图拒答，这是 P0）');

for (const kind of stampable) {
  log(onPanel.includes(kind), `引擎可 stamp 的 ${kind} 在面板上有按钮`);
}

for (const kind of onPanel) {
  log(stampable.has(kind), `面板按钮 ${kind} 在引擎里有 stamp`);
}

const bad = onPanel.filter((k) => NOT_ON_PANEL[k]);
log(bad.length === 0, `面板未混入无 stamp 的器件${bad.length ? `：${bad.join(',')}` : ''}`);

const total = stampable.size;
console.log(fails === 0 ? `PASS：全绿（引擎 ${total} 种 / 面板 ${onPanel.length} 个）` : `FAIL：${fails} 项未通过`);
process.exit(fails === 0 ? 0 : 1);
