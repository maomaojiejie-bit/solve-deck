/**
 * W18 截图：变体参数生效 + 参数徽标三态。
 *  - url-variant-cantilever.png  #/t/M3-cantilever?L=3&a=3&P=12 → 显示 36（不是快照的 10）
 *  - url-badge-override.png      同 URL，点开参数徽标的「题面给的 / 默认推的」两列
 *  - url-badge-default.png       #/t/M3（无覆盖）→ 灰「默认参数」徽标
 */
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：先 npm run build');
  process.exit(1);
}
const shotsDir = resolve('docs', 'shots');
mkdirSync(shotsDir, { recursive: true });

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5195, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'w18-shoot-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9351', '--window-size=1600,1200', 'about:blank'],
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

async function shoot(name, url, { scrollY = 0, expandBadge = false } = {}) {
  await send('Page.navigate', { url: `http://127.0.0.1:5195/${url}` });
  // 等结果面板出现（live 求解完成 / 快照渲染）
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "Boolean(document.querySelector('[data-testid=param-badge]')) && Boolean(document.querySelector('main, .result-grid'))",
    );
    if (ready) break;
    await sleep(250);
  }
  // 徽标要等 values 状态填上（solve 后）
  await sleep(1200);
  if (expandBadge) {
    await evaluate("document.querySelector('[data-testid=param-badge-toggle]')?.click()");
    await sleep(300);
    await evaluate("document.querySelector('[data-testid=param-badge]')?.scrollIntoView({ block: 'start' })");
    await sleep(300);
  } else if (scrollY > 0) {
    await evaluate(`window.scrollTo(0, ${scrollY})`);
    await sleep(200);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
}

import { writeFileSync } from 'node:fs';

try {
  // 结果区在右栏：滚到能看到结果数字与顶部徽标的位置
  await shoot('url-variant-cantilever', '#/t/M3-cantilever?L=3&a=3&P=12', { scrollY: 240 });
  const sanity = await evaluate(
    "document.querySelector('main, .result-grid')?.innerText?.match(/M\\\\s*max[^\\\\n]*/)?.[0] ?? document.body.innerText.slice(0, 200)",
  );
  console.log('cantilever 面板文本抽样:', String(sanity).slice(0, 120));
  await shoot('url-badge-override', '#/t/M3-cantilever?L=3&a=3&P=12', { expandBadge: true });
  await shoot('url-badge-default', '#/t/M3');
  console.log('DONE');
} finally {
  browser.kill();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {}
}
