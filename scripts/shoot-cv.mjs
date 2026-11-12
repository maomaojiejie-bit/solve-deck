/**
 * R3-2.5 / CV-1 评估集补拍：只截「画布里的那一张图」，并把**坐标变换**一起存下来。
 *
 * 为什么要存变换：真值在 src/examples/<id>.json 的 render_spec 里（user unit 坐标），
 * 要拿它跟 PNG 像素比，必须先知道 u → px 的映射。这里直接读 SVG 的 getScreenCTM()，
 * 它是**唯一权威**（preserveAspectRatio="xMidYMid meet" 的留白、容器高度都含在里面），
 * 不自己拿 viewBox 和 rect 推 —— 推错一次整张表的数就是假的。
 *
 * 视口用 CDP 的 Emulation.setDeviceMetricsOverride 设（不用 --window-size）：
 * `--window-size` 只是窗口大小，截图尺寸与 375 的坑都踩过了。
 *
 * 产物：
 *   docs/shots/<name>.png           评估集（DPR 1，与产品实际显示一致）
 *   docs/shots/<name>.meta.json     图 / 变换 / 主题色 / 来源
 *   docs/shots/cv-2x/<name>.png     对照组（同机 2× 像素密度，只为分辨「分辨率不够」还是「算法不够」）
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const dist = resolve(root, 'dist');
const shots = resolve(root, 'docs', 'shots');
const shots2x = join(shots, 'cv-2x');
mkdirSync(shots2x, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：先 npx vite build');
  process.exit(1);
}

/** 名字 → 路由 + spec id（pi 是同一页的第二张图）。 */
const TARGETS = [
  { name: 'A1', route: '#/t/A1', spec: 'main' },
  { name: 'A2', route: '#/t/A2', spec: 'main' },
  { name: 'A3', route: '#/t/A3', spec: 'main' },
  { name: 'A3-pi', route: '#/t/A3', spec: 'pi' },
  { name: 'A5', route: '#/t/A5', spec: 'main' },
  { name: 'A5-pi', route: '#/t/A5', spec: 'pi' },
  { name: 'A6', route: '#/t/A6', spec: 'main' },
  { name: 'A7', route: '#/t/A7', spec: 'main' },
  // 已在仓库里的四张组态变体，同一套拍法重拍（保证变换与老图对得上）
  { name: 'A3-CB', route: '#/t/A3-CB', spec: 'main' },
  { name: 'A3-CC', route: '#/t/A3-CC', spec: 'main' },
  { name: 'A5-CG', route: '#/t/A5-CG', spec: 'main' },
  { name: 'A5-CD', route: '#/t/A5-CD', spec: 'main' },
];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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
const PORT = 5195;
const CDP = 9351;
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));

const profile = mkdtempSync(join(tmpdir(), 'shoot-cv-'));
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(
  edgePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms));

let page;
for (let i = 0; i < 60; i += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

/**
 * 视口 + 像素密度。DPR 只改渲染密度，不改 CSS 布局（所以 CTM 的 a/d 不变，图更细）。
 *
 * 高度取 1300 而不是 1000：`#/t/<id>` 底部有一条 position:sticky 的播放条（含 4px 高的
 * range），用 captureBeyondViewport 整页截图时它会按**视口位置**画在页面中部，
 * 正好横穿 pi 图 —— 那是页面浮层，不是图纸内容。视口够高时它落在裁剪框之外，
 * 再配合 captureBeyondViewport:false，图里就只有图纸本身。
 */
async function viewport(scale) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1300,
    deviceScaleFactor: scale,
    mobile: false,
    screenWidth: 1500,
    screenHeight: 1300,
  });
}

/**
 * 量一张图：先把页面滚回顶部（让 page 坐标 = viewport 坐标），再读 SVG 的
 * rect（视口系）与 getScreenCTM()（user unit → 视口 CSS px）。
 */
const MEASURE = (specId) => `(() => {
  window.scrollTo(0, 0);
  const figure = document.querySelector('figure[data-spec-id="${specId}"]');
  if (!figure) return { error: 'no-figure' };
  const svg = figure.querySelector('svg[role="img"]');
  if (!svg) return { error: 'no-svg' };
  const box = svg.getBoundingClientRect();
  const ctm = svg.getScreenCTM();
  if (!ctm) return { error: 'no-ctm' };
  const style = getComputedStyle(svg);
  const bodyStyle = getComputedStyle(document.body);
  const figureStyle = getComputedStyle(figure);
  return {
    viewBox: (svg.getAttribute('viewBox') || '').split(/\\s+/).filter(Boolean).map(Number),
    ctm: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f],
    origin: [box.x, box.y],
    box: { width: box.width, height: box.height },
    page: { scrollX: window.scrollX, scrollY: window.scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    colors: {
      bodyBg: bodyStyle.backgroundColor,
      figureBg: figureStyle.backgroundColor,
      svgFill: style.fill,
      stroke: style.stroke,
      color: style.color,
    },
    labels: [...figure.querySelectorAll('svg[role="img"] text')].map((t) => t.textContent).filter(Boolean),
    // 文字包围盒（图元单位）：病灶归因要用它把「文字笔画」和「符号内部」分开。
    // getBoundingClientRect 在视口系，这里用 CTM 的逆变换回 user unit。
    textBoxes: [...figure.querySelectorAll('svg[role="img"] text')]
      .map((t) => {
        const b = t.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return [
          (b.x - ctm.e) / ctm.a,
          (b.y - ctm.f) / ctm.d,
          b.width / ctm.a,
          b.height / ctm.d,
        ].map((v) => Math.round(v * 10) / 10);
      })
      .filter(Boolean),
  };
})()`;

async function open(route) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${route}` });
  for (let i = 0; i < 80; i += 1) {
    const ready = await evaluate("document.querySelector('figure[data-spec-id] svg[role=\"img\"]') !== null");
    if (ready) break;
    await sleep(200);
  }
  await sleep(600);
}

async function capture(file, clip) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

const pad = 6;
const index = [];

for (const target of TARGETS) {
  await viewport(1);
  await open(target.route);
  const meta = await evaluate(MEASURE(target.spec));
  if (meta?.error) {
    console.error(`FAIL ${target.name}：${meta.error}`);
    process.exit(1);
  }
  const clip = {
    x: Math.max(0, meta.origin[0] - pad),
    y: Math.max(0, meta.origin[1] - pad),
    width: meta.box.width + pad * 2,
    height: meta.box.height + pad * 2,
  };
  if (clip.y + clip.height > 1300) throw new Error(`${target.name}：裁剪框越出视口（${clip.y + clip.height} > 1300）`);
  await capture(join(shots, `${target.name}.png`), clip);
  writeFileSync(
    join(shots, `${target.name}.meta.json`),
    `${JSON.stringify(
      {
        name: target.name,
        route: target.route,
        specId: target.spec,
        dpr: 1,
        viewport: { width: 1500, height: 1300 },
        clip,
        /** png 像素 = ctm · (u,v) − origin（origin 是 SVG 左上角在视口里的位置）。 */
        origin: meta.origin,
        ctm: meta.ctm,
        viewBox: meta.viewBox,
        box: meta.box,
        page: meta.page,
        colors: meta.colors,
        labels: meta.labels,
        textBoxes: meta.textBoxes,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  const scale = Math.hypot(meta.ctm[0], meta.ctm[1]);
  index.push({ name: target.name, scale, box: meta.box, labels: meta.labels.length });
  console.log(
    `${target.name.padEnd(7)} ${Math.round(meta.box.width)}×${Math.round(meta.box.height)}px  scale=${scale.toFixed(3)}  labels=${meta.labels.length}`,
  );

  // 对照组：同机 2× 像素密度（CSS 布局不变，只是像素更密）
  await viewport(2);
  await sleep(250);
  const meta2 = await evaluate(MEASURE(target.spec));
  const clip2 = {
    x: Math.max(0, meta2.origin[0] - pad),
    y: Math.max(0, meta2.origin[1] - pad),
    width: meta2.box.width + pad * 2,
    height: meta2.box.height + pad * 2,
  };
  await capture(join(shots2x, `${target.name}.png`), clip2);
  writeFileSync(
    join(shots2x, `${target.name}.meta.json`),
    `${JSON.stringify(
      {
        name: target.name,
        route: target.route,
        specId: target.spec,
        dpr: 2,
        viewport: { width: 1500, height: 1300 },
        clip: clip2,
        origin: meta2.origin,
        ctm: meta2.ctm,
        viewBox: meta2.viewBox,
        box: meta2.box,
        page: meta2.page,
        colors: meta2.colors,
        labels: meta2.labels,
        textBoxes: meta2.textBoxes,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

writeFileSync(join(shots, 'cv-index.json'), `${JSON.stringify({ targets: TARGETS, index }, null, 2)}\n`);

try {
  browser.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}

console.log(`PASS：${TARGETS.length} 张评估图 + ${TARGETS.length} 张 2× 对照组（meta 已落盘）`);
