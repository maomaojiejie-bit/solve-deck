/**
 * 子路径部署自检：node scripts/serve-subpath.mjs
 *
 * 把 dist 挂在 /solve-deck/ 下（端口 5199），headless 打开
 * /solve-deck/#/t/A3 与 /solve-deck/#/about，断言页面真的渲染出内容，
 * 并把截图落到 docs/shots/deploy-A3.png / deploy-about.png。
 * 这条能挡住「部署到子路径后白屏」。
 *
 * 前置：npm run build（dist 已生成）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const shots = join(root, 'docs', 'shots');
mkdirSync(shots, { recursive: true });
const PREFIX = '/solve-deck';
const PORT = 5199;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const server = createServer((request, response) => {
  const raw = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0]);
  if (raw === PREFIX) {
    response.writeHead(302, { location: `${PREFIX}/` });
    response.end();
    return;
  }
  if (!raw.startsWith(`${PREFIX}/`)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`只挂载在 ${PREFIX}/ 下`);
    return;
  }
  const pathname = raw.slice(PREFIX.length);
  const candidate = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const file =
    candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});

await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));
console.log(`serving ${dist} at http://127.0.0.1:${PORT}${PREFIX}/`);

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => existsSync(candidate));
if (!browser) throw new Error('找不到 Edge/Chrome');
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-subpath-'));
const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=9227',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitJson(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // not ready
    }
    await new Promise((ready) => setTimeout(ready, 250));
  }
  throw new Error(`调试端口未就绪：${url}`);
}

const version = await waitJson('http://127.0.0.1:9227/json/version');
const created = await fetch(
  `http://127.0.0.1:9227/json/new?${encodeURIComponent(
    `http://127.0.0.1:${PORT}${PREFIX}/#/t/A3`,
  )}`,
  { method: 'PUT' },
).then((response) => response.json());
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((ready, reject) => {
  ws.addEventListener('open', ready, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: done, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else done(message.result);
  }
});
function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((done, reject) => {
    pending.set(id, { resolve: done, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
  return result.result.value;
}
const wait = (ms) => new Promise((ready) => setTimeout(ready, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

async function capture(label, hash, mustContain, file) {
  await evaluate(`window.location.hash = '${hash}'`);
  await wait(1800);
  const text = await evaluate('document.body.innerText');
  const rootChildren = await evaluate("document.querySelector('#root')?.children.length ?? 0");
  const ok = rootChildren > 0 && mustContain.every((token) => text.includes(token));
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const out = join(shots, file);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: root=${rootChildren} ` +
      `tokens=${mustContain.map((token) => `${token}:${text.includes(token)}`).join(', ')} ` +
      `shot=${out} (${statSync(out).size} bytes)`,
  );
  if (!ok) throw new Error(`${label} 子路径渲染断言失败`);
}

try {
  await capture('结果页', '#/t/A3', ['A3', '参数实验场', '已校验'], 'deploy-A3.png');
  await capture('about 页', '#/about', ['关于', '做出来的过程', '技术与边界'], 'deploy-about.png');
  console.log('子路径自检通过：结果页与 about 页都渲染成功。');
} finally {
  ws.close();
  child.kill();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    // profile cleanup is best-effort
  }
}