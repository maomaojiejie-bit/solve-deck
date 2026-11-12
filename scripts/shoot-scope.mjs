/**
 * `#/scope` 三档截图 + 一次真正的键盘走查。
 *
 * 三张图：
 *  - scope-ok.png：六问全「是」（默认态）→ 能直接算；
 *  - scope-simplify.png：只把「截面沿长度不变」改成否 → 要先简化；
 *  - scope-reject.png：**用 Tab + Enter 走完六问**，把六问都选「否」→ 不覆盖。
 *
 * 键盘走查不是脚本里直接 .click()：CDP 发的是真实按键事件，脚本每轮只读
 * `document.activeElement` 判断焦点落在哪个选项上，然后按 Enter 选中。
 * 走完会打印一行 `keyboard: 6/6 …`，验收时看这行就知道六问都能用键盘走完。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5184;
const CDP_PORT = 9334;
const VIEWPORT = { width: 1500, height: 1100 };
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('先构建：npx vite build（或 npm run verify）');
  process.exit(1);
}
const shotsDir = join(root, 'docs', 'shots');
mkdirSync(shotsDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-edge-scope-'));
const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));

const browserPath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
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
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 浏览器还没起来
    }
    await sleep(200);
  }
  throw new Error('连不上 CDP');
}

const socket = new WebSocket((await findPageTarget()).webSocketDebuggerUrl);
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
async function waitFor(expression, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error(`等不到 ${label}`);
}
async function capture(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
}
async function press(key, code, vk) {
  /** Enter 要带 text 才能在按钮上合成一次 click（Tab 不需要）。 */
  const text = key === 'Enter' ? '\r' : undefined;
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    ...(text ? { text } : {}),
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  deviceScaleFactor: 1,
  mobile: false,
});

const tierIs = (tier) => `document.getElementById('scope-verdict')?.dataset.scopeTier === '${tier}'`;
const clickNo = (index) => `(() => {
  const hit = document.querySelector('[data-scope-q="${index}"][data-scope-v="no"]');
  if (!hit) return false;
  hit.click();
  return true;
})()`;

try {
  /* ① 六问全是 → 能直接算 */
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?shot=ok#/scope` });
  await waitFor(`Boolean(document.getElementById('scope-verdict'))`, '#/scope 页面');
  await waitFor(tierIs('ok'), '「能直接算」结论');
  await sleep(500);
  await capture('scope-ok');

  /* ② 只把「截面沿长度不变」改成否 → 要先简化 */
  if (!(await evaluate(clickNo(3)))) throw new Error('点不到第 4 问的「否」');
  await waitFor(tierIs('simplify'), '「要先简化」结论');
  await sleep(400);
  await capture('scope-simplify');

  /* ③ 键盘走查：Tab + Enter 把六问逐个选「否」→ 不覆盖 */
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?shot=keyboard#/scope` });
  await waitFor(`Boolean(document.getElementById('scope-verdict'))`, '键盘走查页面');
  await evaluate(`document.body.focus(); window.focus(); true`);
  let answered = 0;
  for (let question = 0; question < 6; question += 1) {
    let found = false;
    for (let step = 0; step < 24; step += 1) {
      await press('Tab', 'Tab', 9);
      const focused = await evaluate(
        `(() => { const el = document.activeElement; return el ? el.getAttribute('data-scope-q') + ':' + el.getAttribute('data-scope-v') : ''; })()`,
      );
      if (focused === `${question}:no`) {
        found = true;
        break;
      }
    }
    if (!found) throw new Error(`第 ${question + 1} 问用 Tab 走不到「否」选项`);
    await press('Enter', 'Enter', 13);
    const selected = await evaluate(
      `document.querySelector('[data-scope-q="${question}"][data-scope-v="no"]')?.getAttribute('aria-pressed')`,
    );
    if (selected !== 'true') throw new Error(`第 ${question + 1} 问按 Enter 没选中「否」`);
    answered += 1;
  }
  await waitFor(tierIs('reject'), '「不覆盖」结论');
  console.log(`keyboard: ${answered}/6 问用 Tab + Enter 选完，结论档位 = reject`);
  await sleep(400);
  await capture('scope-reject');

  /* ④ 顺带实拍「简化留痕」：结果页 amber 条 + assumptions，并模拟打印态确认还在纸上 */
  await send('Page.navigate', {
    url: `http://127.0.0.1:${PORT}/?shot=simp-result#/t/M3?simp=equal-section`,
  });
  await waitFor(`Boolean(document.querySelector('.print-assumption'))`, '结果页的简化 amber 条');
  await waitFor(`Boolean(document.querySelector('.print-assumptions'))`, '结果页的 assumptions 段');
  await sleep(600);
  await capture('scope-simplify-result');
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const printed = await evaluate(`(() => {
    const bar = document.querySelector('.print-assumption');
    const section = document.querySelector('.print-assumptions');
    if (!bar || !section) return 'missing';
    const hidden = (el) => getComputedStyle(el).display === 'none';
    if (hidden(bar) || hidden(section)) return 'hidden';
    return bar.innerText.includes('不等价') && section.innerText.includes('不等价') ? 'ok' : 'no-text';
  })()`);
  if (printed !== 'ok') throw new Error(`打印态留痕不合格：${printed}`);
  console.log('print-media: amber 条与 assumptions 段在打印态都可见，且含「不等价」');
  await send('Emulation.setEmulatedMedia', { media: '' });
} finally {
  try {
    socket.close();
  } catch {
    // 已关闭
  }
  browser.kill();
  server.close();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    // 截图已落盘
  }
}
