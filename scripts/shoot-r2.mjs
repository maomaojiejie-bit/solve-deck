/**
 * R2 验收截图：
 *  - r2-solve-dual.png        #/solve 贴例句 → 解析 → 结构草稿块 + 双出口按钮
 *  - r2-lab-from-problem.png  点「进装配台看结构 →」→ #/lab/t/<id>?g=…&from=题面 + 青徽标
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

const profile = mkdtempSync(join(tmpdir(), 'r2-shoot-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9355', '--window-size=1500,1150', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9355/json/list')).json();
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

// ① #/solve：贴共源例句 → AI 解析 → 结构草稿
await send('Page.navigate', { url: 'http://127.0.0.1:5199/#/solve' });
await sleep(1500);
await evaluate(`(() => {
  const ta = document.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '共源放大器 gm=1mS，Rd=2kΩ，Rl=10kΩ，求电压增益');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
await evaluate("[...document.querySelectorAll('button')].find((n) => n.textContent.includes('AI 解析'))?.click()");
for (let i = 0; i < 30; i += 1) {
  const ready = await evaluate("Boolean(document.querySelector('[data-testid=lab-draft]'))");
  if (ready) break;
  await sleep(250);
}
await sleep(500);
await evaluate("document.querySelector('[data-testid=lab-draft]')?.scrollIntoView({ block: 'center' })");
await sleep(300);
await capture('r2-solve-dual');
const dualText = await evaluate("document.querySelector('[data-testid=lab-draft]')?.innerText?.slice(0, 200)");
console.log('草稿块文本抽样:', String(dualText).replace(/\\s+/g, ' ').slice(0, 150));

// ② 点主按钮 → 装配台 + 来自题面徽标
const hashBefore = await evaluate('location.hash');
await evaluate("document.querySelector('[data-testid=go-lab-structure]')?.click()");
let fromBadge = false;
for (let i = 0; i < 30; i += 1) {
  fromBadge = await evaluate("Boolean(document.querySelector('[data-testid=badge-source]'))");
  if (fromBadge) break;
  await sleep(250);
}
await sleep(600);
await capture('r2-lab-from-problem');
console.log('双出口跳转：', hashBefore, '→', await evaluate('location.hash'), '| 徽标:', fromBadge);

try {
  browser.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}
console.log('DONE');
