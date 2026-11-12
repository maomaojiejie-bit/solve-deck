/**
 * R3-1 验收截图：
 *  - r3-attach.png          M3 选中结点 B → 左栏「将加在结点 B 上」+ 加支座按钮可用 + 支座是结点子行
 *  - r3-load-t-dir.png      选中载荷 → 方向 → + t=0.25 → 画布标签带 t=0.25、归约 a=1
 *  - r3-delete-cascade.png  选中结点 A → 删 → 确认条亮出「连带 1 根杆、支座（固定铰）」
 */
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：先 build');
  process.exit(1);
}
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5199, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'r3-shoot-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9356', '--window-size=1500,1150', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9356/json/list')).json();
    page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) break;
  } catch {}
  await sleep(200);
}
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
const capture = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(resolve('docs', 'shots'), `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5199/#/lab/t/M3' });
for (let i = 0; i < 40; i += 1) {
  if (await evaluate("document.querySelectorAll('[data-testid=device-row]').length >= 3")) break;
  await sleep(250);
}
await sleep(600);

// ① 选中结点 B：行里点名字 → 左栏目标提示 + 加支座可用 + 支座子行
await evaluate("document.querySelector('[data-testid=device-row][data-node=\"n-end-b\"] button')?.click()");
await sleep(500);
const shot1 = await evaluate(`(() => ({
  hint: document.querySelector('[data-testid=add-target-hint]')?.innerText ?? '',
  addEnabled: !document.querySelector('[data-testid=add-support-fixed]')?.disabled,
  supportRows: document.querySelectorAll('[data-support-row]').length,
  bar: document.querySelector('[data-testid=selection-bar]')?.innerText?.replace(/\\s+/g, ' ') ?? '',
  hasSupportSelect: Boolean(document.querySelector('[data-testid=selection-support]')),
}))()`);
console.log('① 选中 n-end-b：', JSON.stringify(shot1));
await capture('r3-attach');

// ② 选中载荷 → 方向 → t=0.25（真指针 + 真键盘：number 输入要先全选再键入）
await evaluate("document.querySelector('[data-testid=device-row][data-node=\"n-load-0\"] button')?.click()");
await sleep(400);
await evaluate("document.querySelector('[data-testid=selection-dir-90]')?.click()");
await sleep(350);
const tBox = await evaluate("(() => { const r = document.querySelector('[data-testid=load-t]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tBox.x, y: tBox.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tBox.x, y: tBox.y, button: 'left', clickCount: 1 });
await sleep(150);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await sleep(100);
await send('Input.insertText', { text: '0.25' });
const tSet = await evaluate("document.querySelector('[data-testid=load-t]')?.value");
await sleep(700);
const shot2 = await evaluate(`(() => ({
  t: ${JSON.stringify(tSet)},
  labels: [...document.querySelectorAll('svg text')].map((node) => node.textContent).filter((text) => text && text.includes('t=')),
  preview: [...document.querySelectorAll('p')].map((node) => node.innerText).find((text) => text.startsWith('params：')) ?? '',
  bar: document.querySelector('[data-testid=selection-bar]')?.innerText?.replace(/\\s+/g, ' ') ?? '',
}))()`);
console.log('② 载荷方向 + t：', JSON.stringify(shot2));
await capture('r3-load-t-dir');

// ③ 选中结点 A → 删 → 连带清单
await evaluate("document.querySelector('[data-testid=device-row][data-node=\"n-end-a\"] button')?.click()");
await sleep(300);
await evaluate("document.querySelector('[data-testid=selection-delete]')?.click()");
await sleep(600);
const shot3 = await evaluate("document.querySelector('[data-testid=delete-confirm]')?.innerText?.replace(/\\s+/g, ' ') ?? '(无确认条)'");
console.log('③ 删结点 A 的确认条：', shot3);
await capture('r3-delete-cascade');

try {
  browser.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}
console.log('DONE');
