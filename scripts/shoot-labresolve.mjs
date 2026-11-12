/**
 * W15-S4 两张截图：通用求解结果面板（骨架不符 → N 档 + generic-solution）。
 *
 *  lab-32-generic-circuit.png —— A3 删掉 Rs（基极开路 → netSolve 如实给零值，
 *                                阻断问题在琥珀区解释）；
 *  lab-33-generic-frame.png  —— M3 改两端固定梁 + q=10（frameSolve 刚度法 +
 *                                N/Q/M 三联内力图）。
 *
 * 改动图用 labUiStep 在脚本侧构造，经分享链接（?g=）预载进真实页面，
 * 勾确认 → 点「分步求解」→ 等 generic-solution → CDP 截图。
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
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-edge-labresolve-'));

const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms));
const example = (id) => JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));

/* ── 构造两张改动图 ─────────────────────────────────────────────── */
const a3 = freshSkeleton('A3', example('A3').render_specs[0]);
const stCircuit = labUiStep('A3', createUiState('A3', a3), { type: 'op', op: { op: 'deleteDevice', nodeId: 'n-rs' } });

let stFrame = createUiState('M3', freshSkeleton('M3', example('M3').render_specs[0]));
for (const op of [
  { op: 'deleteDevice', nodeId: 'n-load-0' },
  // R3-1 A1：支座是结点属性 —— 直接改两端支座类型，不再删 / 加支座图元
  { op: 'setSupport', nodeId: 'n-end-a', type: 'fixed' },
  { op: 'setSupport', nodeId: 'n-end-b', type: 'fixed' },
  { op: 'addLoad', atNodeId: 'n-end-a', type: 'udl', value: 10 },
]) {
  stFrame = labUiStep('M3', stFrame, { type: 'op', op });
}

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
async function capture(name) {
  // 滚到通用结果面板（它在画布/装配区下方），保留页头与琥珀提示入镜
  await evaluate(`(() => { const el = document.querySelector('[data-testid=generic-solution]'); if (el) { const r = el.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 120); } return true; })()`);
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

async function shootGeneric(name, templateId, hash) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` });
  await waitFor(`document.querySelectorAll('[data-pin]').length > 3`, `${templateId} 画布`);
  await sleep(400);
  // 勾掉全部参数确认（分享装载后 confirmed 为空）
  await evaluate(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
  await sleep(200);
  const solveButton = await evaluate(`(() => { const b = document.querySelector('[data-testid=solve-button]'); return b ? !b.disabled : false; })()`);
  if (!solveButton) throw new Error(`${templateId}：求解按钮不可用（参数没确认齐？）`);
  await evaluate(`document.querySelector('[data-testid=solve-button]').click()`);
  await waitFor(`Boolean(document.querySelector('[data-testid=generic-solution]'))`, `${templateId} generic-solution 面板`);
  await sleep(600);
  const verdict = await evaluate(`document.querySelector('[data-testid=generic-solution]')?.textContent?.slice(0, 60) ?? ''`);
  console.log(`${templateId}: ${verdict}…`);
  await capture(name);
}

try {
  await shootGeneric('lab-32-generic-circuit', 'A3', hashOf('A3', stCircuit.graph));
  await shootGeneric('lab-33-generic-frame', 'M3', hashOf('M3', stFrame.graph));
  console.log('DONE');
} finally {
  browser.kill();
  server.close();
  // 浏览器退出可能有延迟：临时目录清不掉就随它去（系统临时目录，不碍事）
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* EBUSY：Crashpad 文件还被占着，忽略 */
  }
}
