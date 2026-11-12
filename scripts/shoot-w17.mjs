/**
 * W17 两张截图：
 *
 *  lab-34-w17-merge.png     —— A3 删 Rs（删除即合并）：通用求解面板 Vo=-63.05、
 *                              notices 解释「已删除 Rs 并合并两端（参数记 0）」，
 *                              画布上基极与源已由 e-heal 导线直连；
 *  lab-35-w17-selection.png —— S5 三角桁架：左栏「物件 / 杆」两组 + 点杆行后
 *                              的选中条（已选：杆 AC + A/I/E + 删）。
 *
 * 改动图用 labUiStep 在脚本侧构造，经分享链接（?g=）预载进真实页面；
 * 选中态通过点真实 DOM 行触发（与用户同一交互路）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freshSkeleton } from '../src/core/lab/skeleton.ts';
import { labUiStep, createUiState } from '../src/core/lab/ui.ts';
import { encodeSharePayload } from '../src/core/lab/composite.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5188;
const CDP_PORT = 9341;
const VIEWPORT = { width: 1500, height: 1100 };
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('先构建：npx vite build（或 npm run verify）');
  process.exit(1);
}
const shotsDir = join(root, 'docs', 'shots');
mkdirSync(shotsDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-edge-w17-'));

const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms));
const example = (id) => JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));

/* ── 构造两张改动图 ─────────────────────────────────────────────── */
const a3 = freshSkeleton('A3', example('A3').render_specs[0]);
const stMerge = labUiStep('A3', createUiState('A3', a3), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });

const s5Spec = example('S5').render_specs[0];
const stS5 = createUiState('S5', freshSkeleton('S5', s5Spec));

const hashOf = (templateId, graph) =>
  `#/lab/t/${templateId}?g=${encodeURIComponent(encodeSharePayload({ graph, defs: [] }))}`;

/* ── 静态服务 ───────────────────────────────────────────────────── */
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browserPath = edgeCandidates.find((candidate) => existsSync(candidate));
if (!browserPath) {
  server.close();
  throw new Error('找不到 Edge/Chrome 可执行文件');
}
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function findPageTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 浏览器还没起来
    }
    await sleep(200);
  }
  throw new Error('连不上 CDP');
}
const target = await findPageTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ready, reject) => {
  socket.addEventListener('open', ready, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: done, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else done(message.result);
  }
});
function send(method, params = {}) {
  sequence += 1;
  const id = sequence;
  return new Promise((done, reject) => {
    pending.set(id, { resolve: done, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }
    }, 20000);
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '页面脚本报错');
  return result.result?.value;
}
async function waitFor(expression, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`等不到 ${label}`);
}
async function capture(name, focusSelector) {
  if (focusSelector) {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(focusSelector)}); if (el) { const r = el.getBoundingClientRect(); window.scrollTo(0, Math.max(0, window.scrollY + r.top - 140)); } return true; })()`);
  } else {
    await evaluate('window.scrollTo(0, 0)');
  }
  await sleep(250);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  deviceScaleFactor: 1,
  mobile: false,
});

try {
  // ① A3 删 Rs（合并）：勾确认 → 求解 → generic-solution（Vo=-63.05 + notices）
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hashOf('A3', stMerge.graph)}` });
  await waitFor(`document.querySelectorAll('[data-pin]').length > 3`, 'A3 合并图画布');
  await sleep(400);
  const fromLink = await evaluate(`Boolean(document.querySelector('[data-testid=badge-source]'))`);
  console.log(`A3 链接载入徽标: ${fromLink}`);
  await evaluate(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
  await sleep(200);
  await evaluate(`document.querySelector('[data-testid=solve-button]').click()`);
  await waitFor(`Boolean(document.querySelector('[data-testid=generic-solution]'))`, 'A3 generic-solution 面板');
  await sleep(600);
  const voText = await evaluate(`document.querySelector('[data-testid=generic-solution]')?.textContent?.match(/-63\\.05[0-9]*/)?.[0] ?? '未找到 Vo'`);
  console.log(`A3 面板 Vo: ${voText}`);
  await capture('lab-34-w17-merge', '[data-testid=generic-solution]');

  // ② S5 桁架：点「杆 AC」行 → 选中条（左栏两组 + 选中互斥的真实交互）
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hashOf('S5', stS5.graph)}` });
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 'S5 杆组三行');
  await sleep(300);
  const groups = await evaluate(`(() => ({
    objects: document.querySelectorAll('section li[data-node]').length,
    members: document.querySelectorAll('[data-testid=member-row]').length,
  }))()`);
  console.log(`S5 两组行数: 物件 ${groups.objects} / 杆 ${groups.members}`);
  await evaluate(`(() => { const row = document.querySelector('[data-testid=member-row][data-edge=e-AC] button'); if (row) row.click(); return true; })()`);
  await waitFor(`Boolean(document.querySelector('[data-testid=selection-bar]'))`, 'S5 选中条');
  await sleep(250);
  const barText = await evaluate(`document.querySelector('[data-testid=selection-bar]')?.textContent?.slice(0, 40) ?? ''`);
  console.log(`S5 选中条: ${barText}`);
  await capture('lab-35-w17-selection', null);
  console.log('DONE');
} finally {
  browser.kill();
  server.close();
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* EBUSY：Crashpad 文件还被占着，忽略 */
  }
}
