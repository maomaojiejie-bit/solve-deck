/**
 * R3-2 截图：外壳重做后的五个页面 + 一张产品图 + 一张 375 宽真视口。
 *
 * 视口用 CDP 的 Emulation.setDeviceMetricsOverride 设（不是 `--window-size` 裁），
 * 所以 375 那张是**真窄屏布局**：media query 按 375 生效，不是把 1500 的图切一刀。
 *
 * 产物落 docs/shots/：
 *   r32-home.png / r32-solve.png / r32-lab.png / r32-about.png / r32-digital.png（1500×1000）
 *   r32-product.png（装配台主区，给首页产品图用）
 *   r32-home-375.png（375×812 真视口）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const dist = resolve(root, 'dist');
const shots = resolve(root, 'docs', 'shots');
mkdirSync(shots, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：先 npm run build');
  process.exit(1);
}

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  const type = file.endsWith('.js')
    ? 'text/javascript'
    : file.endsWith('.css')
      ? 'text/css'
      : file.endsWith('.png')
        ? 'image/png'
        : 'text/html; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5194, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'shoot-r32-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9350', '--hide-scrollbars', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9350/json/list')).json();
    page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) break;
  } catch {}
  await sleep(200);
}
if (!page) throw new Error('headless 浏览器没起来');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((open, reject) => {
  socket.addEventListener('open', open, { once: true });
  socket.addEventListener('error', reject);
});
let seq = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((done) => {
    seq += 1;
    pending.set(seq, done);
    socket.send(JSON.stringify({ id: seq, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function open(hash, ready) {
  await send('Page.navigate', { url: `http://127.0.0.1:5194/${hash}` });
  for (let i = 0; i < 60; i += 1) {
    if (ready ? await evaluate(ready) : true) break;
    await sleep(250);
  }
  await sleep(700);
}

async function capture(name, clip) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  const file = join(shots, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`拍下 ${name}.png`);
}

/* ── 1500×1000 五张 ───────────────────────────────────────────── */
await viewport(1500, 1000);
await open('#/', "document.querySelector('[data-testid=home-product]') !== null");
await capture('r32-home');

await open('#/solve', "document.querySelector('[data-testid=go-lab-structure]') !== null");
await evaluate("document.querySelector('[data-testid=solve-example-0]')?.click()");
await sleep(900);
await capture('r32-solve');

await open('#/lab/t/M3', "document.querySelectorAll('[data-testid=param-row]').length > 0");
await capture('r32-lab');

// 产品图：装配台主区（不带页头，给首页当产品图）
{
  const rect = await evaluate(`(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const box = main.getBoundingClientRect();
    return { x: box.x, y: box.y + window.scrollY, width: box.width, height: Math.min(box.height, 780) };
  })()`);
  if (rect) await capture('r32-product', { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

await open('#/about', "document.querySelector('[data-testid=about-prime]') !== null");
await capture('r32-about');

await open('#/lab/digital', "document.querySelector('textarea') !== null");
await capture('r32-digital');

/* ── 375×812 真视口 ───────────────────────────────────────────── */
await viewport(375, 812, true);
await open('#/', "document.querySelector('[data-testid=home-product]') !== null");
await capture('r32-home-375');

// 375 下也确认一下没有被顶宽（内容宽度 ≤ 375）
const overflow = await evaluate(`({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
  main: Math.round(document.querySelector('main')?.getBoundingClientRect().width ?? 0),
})`);
console.log('375 视口：', JSON.stringify(overflow));

try {
  browser.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}

if (overflow.doc > overflow.win + 1) {
  console.error(`FAIL：375 视口横向溢出 ${overflow.doc} > ${overflow.win}`);
  process.exit(1);
}
console.log('PASS：6 张截图（1500×1000 五张 + 产品图 + 375 真视口）');
