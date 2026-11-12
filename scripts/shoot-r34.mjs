/**
 * R3-4 U1 截图：智能选点与「一句话定条件」。
 *
 * 视口用 CDP 的 Emulation.setDeviceMetricsOverride 设（375 那张是真窄屏媒体查询，
 * 不是把 1500 的图裁一刀）。指针用 Input.dispatchMouseEvent 真按真松 ——
 * hover 预告与「按下拖出方向」两条路径都只有真指针才走得通。
 *
 * 产物落 docs/shots/：
 *   lab-40-hover.png  杆上 hover：ghost 箭头 + t 刻度 + 光标旁一行文案
 *   lab-41-drop.png   松手后：力已落、左栏规则说话、选中条显示 t 与方向
 *   lab-42-branch.png 支座工具点杆中：切段 + 新结点挂固定铰
 *   lab-43-375.png    375×812 真视口：工具条折行、画布不横向溢出
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
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5195, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'shoot-r34-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-proxy-server',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=9351',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9351/json/list')).json();
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

/**
 * 全新文档：先跳 about:blank 再进目标 hash。
 * 直接 `navigate('#/lab/t/M3')` 只是同文档 hash 变化 —— 上一场的图（?g= 同步过来的）
 * 会原样留着，截出来的「切段」会混着上一场放的载荷。
 */
async function fresh(hash, ready) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await open(hash, ready);
}

async function open(hash, ready) {
  await send('Page.navigate', { url: `http://127.0.0.1:5195/${hash}` });
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
  writeFileSync(join(shots, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`拍下 ${name}.png`);
}

/** 图元坐标 → 屏幕坐标（用 SVG 的 CTM，不自己推缩放）。 */
const toScreen = (worldX, worldY) =>
  evaluate(`(() => {
    const svg = document.querySelector('svg[role="img"]');
    if (!svg) return null;
    const m = svg.getScreenCTM();
    const p = svg.createSVGPoint();
    p.x = ${worldX};
    p.y = ${worldY};
    const q = p.matrixTransform(m);
    return { x: q.x, y: q.y };
  })()`);

const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });

const READY = "document.querySelectorAll('[data-testid=place-tools] button').length >= 4";

/* ── ① 杆上 hover：ghost + 文案 ───────────────────────────────── */
await viewport(1500, 1000);
await fresh('#/lab/t/M3', READY);

await evaluate("document.querySelector('[data-testid=place-tool-point]')?.click()");
await sleep(300);

// M3 单跨：A(140,250) — B(780,250)，t=0.25 在世界坐标 (300, 250)
{
  const spot = await toScreen(300, 250);
  await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
  await sleep(500);
  const ghost = await evaluate(`({
    hint: document.querySelector('[data-testid=place-hint]')?.innerText ?? '',
    kind: document.querySelector('[data-testid=place-ghost]')?.getAttribute('data-kind') ?? '',
    marks: document.querySelectorAll('[data-testid=place-ghost] *').length,
  })`);
  console.log('① hover：', JSON.stringify(ghost));
  await capture('lab-40-hover');
}

/* ── ② 按下 → 向下拖 40 → 松手：力落在 t=0.25，方向 ↓ ─────────── */
// 先删掉骨架自带的那个集中力：M3 只支持一个集中力，留着它就变成「两个」，
// 截图里该讲的是「一步落了一个力、归约认了」，不是「又超范围了」。
await evaluate("document.querySelector('[data-testid=device-row][data-node=\"n-load-0\"] [data-testid=delete-device]')?.click()");
await sleep(400);
// 删载荷会让 P 缺源 → 先亮一次黄条确认（W14 的老规矩），点「确认删除」。
await evaluate("document.querySelector('[data-testid=delete-confirm-yes]')?.click()");
await sleep(500);
{
  const start = await toScreen(300, 250);
  const end = await toScreen(300, 292);
  await mouse('mousePressed', start.x, start.y);
  await sleep(120);
  await mouse('mouseMoved', start.x, start.y + 12, { button: 'left' });
  await mouse('mouseMoved', end.x, end.y, { button: 'left' });
  await sleep(200);
  await mouse('mouseReleased', end.x, end.y);
  await sleep(700);
  const state = await evaluate(`({
    rules: [...document.querySelectorAll('li')].map((n) => n.innerText).filter((t) => t.includes('载荷落在')).slice(0, 2),
    labels: [...document.querySelectorAll('svg text')].map((n) => n.textContent).filter((t) => t && t.includes('P =')),
    status: document.querySelector('[data-testid=pin-status]')?.innerText ?? '',
  })`);
  console.log('② 松手：', JSON.stringify(state));
  await capture('lab-41-drop');
}

/* ── ③ 支座工具点杆中：切段 + 挂支座（重开一张，互不干扰） ────── */
await fresh('#/lab/t/M3', READY);
await evaluate("document.querySelector('[data-testid=place-tool-support]')?.click()");
await sleep(300);
{
  const spot = await toScreen(407, 250); // t≈0.417
  await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
  await sleep(400);
  const hover = await evaluate("document.querySelector('[data-testid=place-hint]')?.innerText ?? ''");
  await mouse('mousePressed', spot.x, spot.y);
  await sleep(120);
  await mouse('mouseReleased', spot.x, spot.y);
  await sleep(800);
  const after = await evaluate(`({
    rows: [...document.querySelectorAll('[data-testid=device-row], [data-testid=member-row]')].length,
    rules: [...document.querySelectorAll('li')].map((n) => n.innerText).filter((t) => t.includes('切了一刀') || t.includes('固定铰')).slice(0, 2),
    supports: [...document.querySelectorAll('svg text')].map((n) => n.textContent).filter((t) => t === '固定铰').length,
  })`);
  console.log('③ 切段 hover：', JSON.stringify(hover));
  console.log('③ 切段之后：', JSON.stringify(after));
  await capture('lab-42-branch');
}

/* ── ④ 375×812 真视口：工具条不许溢出 ─────────────────────────── */
await viewport(375, 812, true);
await fresh('#/lab/t/M3', READY);
await evaluate("document.querySelector('[data-testid=place-tool-point]')?.click()");
await sleep(400);
const narrow = await evaluate(`({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
  tools: (() => {
    const box = document.querySelector('[data-testid=place-tools]');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  })(),
  hint: document.querySelector('[data-testid=place-mode-hint]')?.innerText ?? '',
})`);
console.log('④ 375 视口：', JSON.stringify(narrow));
await capture('lab-43-375');

// 再窄 55px 看工具条会不会折行（真窄屏媒体查询，不是裁图）
await viewport(320, 720, true);
await sleep(400);
const tighter = await evaluate(`({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
  tools: (() => {
    const box = document.querySelector('[data-testid=place-tools]');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height), scroll: box.scrollWidth };
  })(),
})`);
console.log('④ 320 视口（折行检查）：', JSON.stringify(tighter));

// 240 只是「折行能力」的证据：375 / 320 都还放得下一行，到这里才必须折。
await viewport(240, 720, true);
await sleep(400);
const wrapped = await evaluate(`(() => {
  const box = document.querySelector('[data-testid=place-tools]');
  if (!box) return null;
  const r = box.getBoundingClientRect();
  const rows = new Set([...box.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top)));
  return { width: Math.round(r.width), height: Math.round(r.height), buttonRows: rows.size, doc: document.documentElement.scrollWidth };
})()`);
console.log('④ 240 视口（必须折行）：', JSON.stringify(wrapped));

browser.kill();
server.close();
rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
