/**
 * check:drag（R2-T1）：装配台画布拖动全程不得触发浏览器原生 dragstart
 * （否则松手后浏览器拿选中文字去搜索 —— 用户机器上真留了
 * 「固定铰 P = 150 kN L = 2 m」的 bing 搜索记录）。
 *
 * 走 CDP：页面挂 dragstart 计数 → pointerdown → 移动 40px → pointerup，
 * 断言计数为 0 且器件坐标确实变化；再用一条「变异态」自检（关闭容器拦截
 * 的源码断言 + select-none 类存在），保证这层防线上线后没人能静默拆掉。
 *
 * 零依赖；dist 由 verify 前置 build 产出，这里自己起静态服务器。
 */
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：check:drag 依赖前置 build');
  process.exit(1);
}

let checks = 0;
const errors = [];
const ok = (name, pass, extra = '') => {
  checks += 1;
  if (pass) console.log(`[ok]   ${name}`);
  else {
    errors.push(`${name}${extra ? ` — ${extra}` : ''}`);
    console.log(`[FAIL] ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5197, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'drag-check-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9353', '--window-size=1500,1100', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9353/json/list')).json();
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
const mouse = (type, x, y, buttons) =>
  send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'mouse',
  });

await send('Page.enable');
await send('Runtime.enable');

// 装配台：A3 电路骨架（data-node 拖动圆点齐全）
await send('Page.navigate', { url: 'http://127.0.0.1:5197/#/lab/t/A3' });
for (let i = 0; i < 40; i += 1) {
  const ready = await evaluate("document.querySelectorAll('[data-node]').length");
  if (ready > 0) break;
  await sleep(250);
}
await sleep(600);

const probe = await evaluate(`(() => {
  window.__dragStarts = 0;
  document.addEventListener('dragstart', () => { window.__dragStarts += 1; });
  // 注意：左栏物件列表行也挂 data-node（W17-C），画布热区必须限定在
  // SpecGrid 容器（.select-none）内取，否则 pointerdown 落在列表行上拖了个寂寞。
  const circle = document.querySelector('.select-none [data-node]');
  if (!circle) return null;
  const rect = circle.getBoundingClientRect();
  const node = circle.getAttribute('data-node');
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return { node, cx, cy, containerClass: document.querySelector('.select-none') !== null };
})()`);

ok('拖动前置：画布容器有 select-none', Boolean(probe?.containerClass), JSON.stringify(probe));

if (probe?.node) {
  const before = await evaluate(
    `(() => {
      const g = JSON.parse(decodeShareGraph0());
      return null;
    })()`,
  ).catch(() => null);
  // 坐标变化从 DOM 读：拖完再取同一个 data-node 的中心
  const startX = probe.cx;
  const startY = probe.cy;
  await mouse('mousePressed', startX, startY, 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse('mouseMoved', startX + (step * 40) / 8, startY, 1);
    await sleep(40);
  }
  await mouse('mouseReleased', startX + 40, startY, 0);
  await sleep(500);

  const after = await evaluate(`({
    dragStarts: window.__dragStarts ?? -1,
    moved: (() => {
      const circles = [...document.querySelectorAll('.select-none [data-node]')];
      const hit = circles.find((c) => {
        const r = c.getBoundingClientRect();
        return Math.hypot(r.left + r.width / 2 - ${startX}, r.top + r.height / 2 - ${startY}) <= 24;
      });
      if (hit) {
        const r = hit.getBoundingClientRect();
        return Math.hypot(r.left + r.width / 2 - ${startX}, r.top + r.height / 2 - ${startY});
      }
      // 命中的圆可能被移走了：找任何一个 data-node 中心偏离原位的都算
      return Math.min(...circles.map((c) => {
        const r = c.getBoundingClientRect();
        return Math.hypot(r.left + r.width / 2 - ${startX}, r.top + r.height / 2 - ${startY});
      }));
    })(),
  })`);
  ok('拖动全程 dragstart 计数为 0', after?.dragStarts === 0, `实际 ${JSON.stringify(after)}`);
  ok('器件坐标确实变化（拖动未被拦死）', typeof after?.moved === 'number' && after.moved > 10, `最近偏移 ${after?.moved}`);
  console.log(`拖动 40px：dragstart=${after?.dragStarts}，data-node 最近偏移 ${Number(after?.moved ?? 0).toFixed(1)}px`);
}

// 源码断言（变异哨兵）：三层防线（select-none / onDragStart preventDefault /
// pointerdown preventDefault）任何一层被拆掉门禁都红
{
  const source = readFileSync(join(root, 'src', 'render', 'SpecGrid.tsx'), 'utf8');
  ok('源码：画布容器 select-none', source.includes('select-none'));
  ok('源码：onDragStart preventDefault（容器拦原生拖拽）', source.includes('onDragStart={(event) => event.preventDefault()}'));
  ok('源码：pointerdown 只对画布 preventDefault', source.includes('event.preventDefault();') && source.includes('const target = event.target as Element'));
  ok('源码：touch-action:none + -webkit-user-drag:none', source.includes("touchAction: 'none'") && source.includes("WebkitUserDrag: 'none'"));
  console.log('源码防线：容器 select-none / onDragStart 拦截 / pointerdown preventDefault / touch-action 四层齐');
}

try {
  browser.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（拖动防误触：CDP 真拖 dragstart=0 + 坐标变化 + 源码防线）`);
