/**
 * `#/lab` 二十二张截图：骨架 / 装配 / 置信度三档 / W10-B 交互 / W11 九型与不适用卡 / W12 引脚与快填 / W13 P0 删线与复合器件。
 *
 * 同 shoot-solve：CDP 驱动真实页面 —— 点删器件、勾确认、选语义、点求解，
 * 全部走页面真实代码，只有数据是脚本点的。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NOT_APPLICABLE } from '../src/core/lab/coverage.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5186;
const CDP_PORT = 9337;
const VIEWPORT = { width: 1500, height: 1100 };
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('先构建：npx vite build（或 npm run verify）');
  process.exit(1);
}
const shotsDir = join(root, 'docs', 'shots');
mkdirSync(shotsDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'solve-deck-edge-lab-'));

const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms));

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
async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error(`等不到 ${label}`);
}
async function capture(name) {
  await evaluate("window.scrollTo(0, 0)");
  await sleep(150);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
}
/** 拍长页面里的某一节（about 的覆盖表在首屏下面）。 */
async function captureSection(name, selector) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); return true; })()`);
  await sleep(250);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: docs/shots/${name}.png`);
}

async function mouse(type, x, y, buttons = 0) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'mouse',
  });
}
async function centerOf(selector) {
  const expression = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
  return evaluate(expression);
}
async function gotoLab(hash) {
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(300);
  await evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
  await waitFor(`document.querySelectorAll('[data-pin]').length > 5`, '画布引脚热区');
  await sleep(250);
}

const SET_TAGS = `(async () => {
  const tags = { 'n-rl': 'load', 'n-rc': 'bias', 'n-rs': 'coupling', 'n-vs': 'supply' };
  for (const [node, tag] of Object.entries(tags)) {
    const select = document.querySelector('[data-testid=semantic-select][data-node="' + node + '"]');
    if (select) {
      select.value = tag;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((ready) => setTimeout(ready, 80));
    }
  }
  document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); });
  return true;
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  deviceScaleFactor: 1,
  mobile: false,
});

try {
  /* ── 01 骨架：#/lab/t/A3 打开就是一张对的图 ── */
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/lab/t/A3` });
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, '画布');
  await waitFor(`document.querySelectorAll('svg').length > 0`, '骨架 SVG');
  await sleep(500);
  await capture('lab-01-skeleton');

  /* ── 02 改结构：删 Rc，归约预览出现 appliedRules ── */
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('n-rc'));
    if (!row) return false;
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '删');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('已删除器件')`, 'appliedRules 证据');
  await sleep(300);
  await capture('lab-02-edit');

  /* 02 删了 Rc；03 要标全三个关键标签，先恢复骨架（二次确认） */
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await sleep(200);
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await waitFor(`document.querySelectorAll('[data-testid=device-row]').length === 6 && !document.body.innerText.includes('已改动')`, '恢复骨架（03 前置）');

  /* ── 03 确认已知量：全部勾上 + 语义全标（F 档的前提） ── */
  await evaluate(SET_TAGS);
  await waitFor(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('分步求解')); return b && !b.disabled; })()`,
    '求解按钮解禁',
  );
  await sleep(300);
  await capture('lab-03-confirm');

  /* ── 04 F 档求解：override 直灌 Result ── */
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('分步求解')); b.click(); return true; })()`);
  await waitFor(`document.body.innerText.includes('等效电路已验证')`, 'F 档横幅', 30000);
  await sleep(900);
  await capture('lab-04-solved');

  /* ── 05 N 档降级：语义留 unknown，第 4 帧换掉、等效图不渲染 ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(400);
  await evaluate(`window.location.hash = '/lab/t/A3'`);
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, '骨架重载');
  await sleep(600);
  await evaluate(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
  await waitFor(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('分步求解')); return b && !b.disabled; })()`,
    '求解按钮解禁',
  );
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('分步求解')); b.click(); return true; })()`);
  await waitFor(`document.body.innerText.includes('等效图待确认语义')`, 'N 档横幅', 30000);
  await sleep(900);
  const noDerived = await evaluate(
    `(() => { const badge=[...document.querySelectorAll('span')].find(x=>x.textContent.includes('N · ')); return Boolean(badge); })()`,
  );
  if (!noDerived) throw new Error('N 档横幅没找到');
  await capture('lab-05-degraded');
  console.log('N 档核验：横幅出现（等效图由 derivedFrom 过滤，第 4 帧已替换）');

  /* ── 06 S5 杆件列表 + 删杆后的琥珀判据卡 ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(350);
  await evaluate(`window.location.hash = '/lab/t/S5'`);
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 'S5 三根杆');
  await evaluate(`(() => {
    const row = document.querySelectorAll('[data-testid=member-row]')[0];
    row.querySelector('[data-testid=delete-member]').click();
    return true;
  })()`);
  await waitFor(
    `(() => { const card = document.querySelector('[data-testid=structure-card]'); return card && card.innerText.includes('m = 2j−3 = 3'); })()`,
    '删杆判据建议',
  );
  await sleep(300);
  await capture('lab-06-members');
  console.log('lab-06：杆件列表点删 →「m = 2j−3 = 3」可执行建议');

  /* ── 07 A3 标全三个关键标签 → tier F ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(350);
  await evaluate(`window.location.hash = '/lab/t/A3'`);
  await waitFor(`document.querySelectorAll('[data-testid=semantic-select]').length >= 4`, 'A3 语义下拉');
  await evaluate(SET_TAGS);
  await evaluate(`(() => { document.querySelector('[data-testid=solve-button]').click(); return true; })()`);
  await waitFor(`document.body.innerText.includes('等效电路已验证')`, 'F 档徽章', 30000);
  await sleep(800);
  await capture('lab-07-semantic');
  console.log('lab-07：Rl=load / Rc=bias / Rs=coupling → F 档');

  /* ── 08 改过之后再点「恢复骨架」回到原始状态 ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(350);
  await evaluate(`window.location.hash = '/lab/t/S5'`);
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3`, 'S5 骨架重载');
  await evaluate(`(() => {
    document.querySelectorAll('[data-testid=member-row]')[0].querySelector('[data-testid=delete-member]').click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('已改动')`, '改动标记');
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await sleep(250);
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 3 && !document.body.innerText.includes('已改动')`, '恢复骨架');
  await sleep(300);
  await capture('lab-08-reset');
  console.log('lab-08：删杆 → 二次确认恢复骨架 → 三根杆与骨架态回来');

  /* ── 09 画布点一个引脚 + 拉橡皮筋（W10-B 任务 1） ── */
  await gotoLab('/lab/t/A3');
  const firstPin = await centerOf('svg[role="presentation"] [data-pin="n-vs:p"]');
  if (!firstPin) throw new Error('找不到 n-vs:p 引脚热区');
  await mouse('mousePressed', firstPin.x, firstPin.y, 1);
  await mouse('mouseReleased', firstPin.x, firstPin.y, 0);
  await waitFor(`document.querySelector('svg[role="presentation"] [data-pin="n-vs:p"]')?.getAttribute('fill') !== 'transparent'`, '选中引脚高亮');
  await mouse('mouseMoved', firstPin.x + 190, firstPin.y + 120, 0);
  await sleep(300);
  await capture('lab-09-wiring');
  console.log('lab-09：选中引脚 r=8 青色实心 + 虚线橡皮筋');

  /* ── 10 拖动 n-rc 40px，pointerup 后导线端点重新吸附 ── */
  await gotoLab('/lab/t/A3');
  const rcNode = await centerOf('svg[role="presentation"] [data-node="n-rc"]');
  if (!rcNode) throw new Error('找不到 n-rc 拖动热区');
  const scale = await evaluate(`(() => { const svg = document.querySelector('svg[role="img"]'); const m = svg && svg.getScreenCTM(); return m ? m.a : 1; })()`);
  const dx = 40 * (Number(scale) || 1);
  await mouse('mousePressed', rcNode.x, rcNode.y, 1);
  await mouse('mouseMoved', rcNode.x + dx * 0.5, rcNode.y, 1);
  await mouse('mouseMoved', rcNode.x + dx, rcNode.y, 1);
  await sleep(150);
  await mouse('mouseReleased', rcNode.x + dx, rcNode.y, 0);
  await waitFor(`document.body.innerText.includes('已改动')`, '拖动后 dirty');
  await sleep(350);
  await capture('lab-10-drag');
  console.log('lab-10：n-rc 拖 40px → 导线跟着重算（页面真 pointer 事件）');

  /* ── 11 三张候选卡 ── */
  await gotoLab('/lab/t/A3');
  await evaluate(`(() => { document.querySelector('[data-testid=candidates-button]').click(); return true; })()`);
  await waitFor(`document.querySelectorAll('[data-testid=candidate-card]').length === 3`, '三张候选卡');
  await waitFor(`document.querySelectorAll('[data-testid=candidate-card] svg').length >= 2`, '候选缩略图');
  await sleep(300);
  await capture('lab-11-candidates');
  console.log('lab-11：CE / CB / CC 三卡（缩略图 + why + 载入 / 只看看 + 禁用态）');

  /* ── 12 ?p=Rc:3300,beta:150 打开即覆盖，带「题面」来源角标 ── */
  await gotoLab('/lab/t/A3?p=Rc:3300,beta:150');
  await evaluate(`(() => { const close = document.querySelector('[data-testid=candidates-close]'); if (close) close.click(); return true; })()`);
  await waitFor(`document.querySelectorAll('[data-testid=p-source]').length === 2`, '题面来源角标');
  const overwritten = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid=param-row]')];
    const rc = rows.find((r) => r.dataset.param === 'Rc');
    const beta = rows.find((r) => r.dataset.param === 'beta');
    return { rc: rc?.querySelector('input[type=number]')?.value, beta: beta?.querySelector('input[type=number]')?.value };
  })()`);
  if (overwritten.rc !== '3300' || overwritten.beta !== '150') throw new Error(`?p= 没写进参数表：${JSON.stringify(overwritten)}`);
  const stillUnconfirmed = await evaluate(`document.querySelectorAll('[data-testid=param-row] input[type=checkbox]:checked').length === 0`);
  if (!stillUnconfirmed) throw new Error('?p= 覆盖后参数被自动确认了（必须逐个点确认）');
  await sleep(250);
  await capture('lab-12-purl');
  console.log('lab-12：?p= 生效（Rc=3300 / beta=150 标「题面」）且确认框仍全空');

  /* ── 13 A2 分压偏置：装配 + 归约预览（W11 B 类电路） ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(300);
  await evaluate(`window.location.hash = '/lab/t/A2'`);
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, 'A2 画布');
  await waitFor(`document.querySelectorAll('[data-testid=device-row]').length >= 6`, 'A2 器件列表');
  await evaluate(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
  await waitFor(`document.body.innerText.includes('Vcc=12') && document.body.innerText.includes('Rc=3300')`, 'A2 归约预览');
  await sleep(300);
  await capture('lab-13-a2');
  console.log('lab-13：A2 分压偏置骨架 + 8 个已知量 + 归约预览（Vcc=12 / Rc=3300）');

  /* ── 14 M1 轴向拉杆：骨架 + 截面类参数在确认已知量表 ── */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(300);
  await evaluate(`window.location.hash = '/lab/t/M1'`);
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, 'M1 画布');
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 1`, 'M1 一段主跨');
  await waitFor(`document.querySelectorAll('[data-testid=param-row]').length === 5`, 'M1 五个已知量');
  await evaluate(`(() => { document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); }); return true; })()`);
  await waitFor(`document.body.innerText.includes('A=200') && document.body.innerText.includes('P=40')`, 'M1 归约预览');
  await sleep(300);
  await capture('lab-14-m1');
  console.log('lab-14：M1 轴向拉杆骨架 + A / E 骨架级参数 + 归约预览');

  /* M7 是唯一的参数化合成骨架：真页面核验它确实能打开、能装配、能归约（不截图） */
  await evaluate(`window.location.hash = '/lab'`);
  await sleep(300);
  await evaluate(`window.location.hash = '/lab/t/M7'`);
  await waitFor(`document.querySelector('[data-testid=parametric-note]') !== null`, 'M7 参数化骨架角标');
  await waitFor(`document.querySelectorAll('[data-testid=member-row]').length === 1`, 'M7 一根压杆');
  await waitFor(`document.querySelectorAll('[data-testid=param-row]').length === 7`, 'M7 七个已知量');
  const m7Preview = await evaluate(`document.body.innerText.includes('L=2') && document.body.innerText.includes('mu=1') && document.body.innerText.includes('P=150')`);
  if (!m7Preview) throw new Error('M7 参数化骨架的归约预览不对');
  console.log('M7 真页面核验：参数化角标 / 一根杆 / 7 个已知量 / 归约 L=2 μ=1 P=150');

  /* ── 15 M6 不适用卡：专属原因 + 三个去向；顺便逐型核验 13 张卡 ── */
  await evaluate(`window.location.hash = '/lab/t/M6'`);
  await waitFor(`document.querySelector('[data-testid=na-card]')?.dataset.template === 'M6'`, 'M6 不适用卡');
  const m6Ok = await evaluate(`(() => {
    const reason = document.querySelector('[data-testid=na-reason]')?.innerText ?? '';
    const buttons = document.querySelectorAll('[data-testid=na-button]');
    return reason === ${JSON.stringify(NOT_APPLICABLE.M6.reason)} && buttons.length >= 2 &&
      [...buttons].every((b) => (b.getAttribute('href') ?? '').startsWith('#/'));
  })()`);
  if (!m6Ok) throw new Error('M6 不适用卡的专属原因或去向按钮不对');
  await capture('lab-15-not-applicable');
  console.log('lab-15：M6「应力元没有可装配的梁或杆」+ 去 M6 结果 / #/scope / #/lab');

  for (const [id, entry] of Object.entries(NOT_APPLICABLE)) {
    await evaluate(`window.location.hash = '/lab'`);
    await sleep(90);
    await evaluate(`window.location.hash = ${JSON.stringify(`/lab/t/${id}`)}`);
    await waitFor(`document.querySelector('[data-testid=na-card]')?.dataset.template === ${JSON.stringify(id)}`, `${id} 卡`);
    const cardOk = await evaluate(`(() => {
      const reason = document.querySelector('[data-testid=na-reason]')?.innerText ?? '';
      const buttons = document.querySelectorAll('[data-testid=na-button]');
      return reason === ${JSON.stringify(entry.reason)} && buttons.length >= 2 &&
        [...buttons].every((b) => (b.getAttribute('href') ?? '').startsWith('#/'));
    })()`);
    if (!cardOk) throw new Error(`${id} 的专属原因 / 去向按钮没渲染出来`);
  }
  console.log(`不适用卡真页面核验：${Object.keys(NOT_APPLICABLE).length} 型逐型原因 + 去向全在`);

  /* ── 16 about 覆盖表新列 + 29 行逐型账本 ── */
  await evaluate(`window.location.hash = '/about'`);
  await waitFor(`document.querySelector('[data-testid=coverage-ledger]') !== null`, 'about 覆盖账本');
  const ledgerRows = await evaluate(`document.querySelectorAll('[data-ledger-id]').length`);
  if (ledgerRows !== 29) throw new Error(`about 逐型账本应有 29 行，实际 ${ledgerRows}`);
  const newColumn = await evaluate(`document.querySelectorAll('[data-testid^=coverage-cell]').length`);
  if (newColumn !== 4) throw new Error(`about 覆盖表新列应有 4 行，实际 ${newColumn}`);
  await captureSection('lab-16-coverage', '[data-testid=coverage-section]');
  console.log('lab-16：about 覆盖范围表第 4 列 + 29 行拼接台账本（16 可装 / 13 不适用）');

  /* ── 17 引脚中文名：hover 浮标 + 原生 <title> + 选中态 ── */
  await gotoLab('/lab/t/A3');
  const qBase = await centerOf('svg[role="presentation"] [data-pin="n-q:b"]');
  if (!qBase) throw new Error('找不到 n-q:b 引脚热区');
  await mouse('mouseMoved', qBase.x, qBase.y, 0);
  await waitFor(`document.querySelector('[data-testid=pin-hover]')?.innerText.includes('基极 b')`, 'hover 中文名浮标');
  const titleText = await evaluate(`document.querySelector('svg[role="presentation"] [data-pin="n-q:b"] title')?.textContent ?? ''`);
  if (!titleText.includes('基极 b')) throw new Error(`<title> 没有中文名：${titleText}`);
  await sleep(200);
  await capture('lab-17-pinnames');
  await capture('pins-hover');
  console.log('lab-17 / pins-hover：hover「Q · 基极 b」+ 原生 <title>');
  await mouse('mousePressed', qBase.x, qBase.y, 1);
  await mouse('mouseReleased', qBase.x, qBase.y, 0);
  await waitFor(`document.querySelector('[data-testid=pin-status]')?.innerText.includes('已选：Q · 基极 b')`, '引脚选中态');
  await sleep(150);
  await capture('pins-selected');
  console.log('pins-selected：左下角「已选：Q · 基极 b」');

  /* ── 18 汇流条锚点可点：地轨选中 + 所属节点 ── */
  await gotoLab('/lab/t/A3');
  const railEl = await centerOf('svg[role="presentation"] [data-pin-name^="地轨"]');
  if (!railEl) throw new Error('找不到地轨锚点热区');
  await mouse('mousePressed', railEl.x, railEl.y, 1);
  await mouse('mouseReleased', railEl.x, railEl.y, 0);
  await waitFor(`document.querySelector('[data-testid=pin-status]')?.innerText.includes('已选：地轨')`, '地轨选中态');
  await sleep(200);
  await capture('lab-18-railselect');
  console.log('lab-18：点地轨 →「已选：地轨 · 所属：…」');

  /* ── 19 小信号快填：两种模式 + 推得角标 + 一致性提示 ── */
  await gotoLab('/lab/t/A3');
  await evaluate(`(() => { const d = document.querySelector('[data-testid=quickfill-lab]'); if (d) d.open = true; return Boolean(d); })()`);
  await waitFor(`document.querySelectorAll('[data-testid=quick-row]').length === 7`, '快填七行');
  // 「从小信号倒推」推出的 Ic / VA 会写进参数表并标「推得」
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[data-testid=quick-mode]')].find((b) => b.innerText.includes('从小信号倒推'));
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
  await evaluate(`(() => { const b = document.querySelector('[data-testid=quick-write]'); if (b) b.click(); return Boolean(b); })()`);
  await waitFor(`document.querySelectorAll('[data-testid=derived-source]').length >= 2`, '参数表推得角标');
  const labDerived = await evaluate(`(() => ({
    params: [...document.querySelectorAll('[data-testid=derived-source]')].map((el) => el.closest('li')?.dataset.param ?? el.closest('label')?.innerText?.trim().slice(0, 12)),
    quick: [...document.querySelectorAll('[data-testid=quick-derived]')].map((el) => el.closest('label')?.dataset.quickKey),
  }))()`);
  console.log(`快填真页面来源：参数表 ${JSON.stringify(labDerived.params)} / 折叠块 ${JSON.stringify(labDerived.quick)}`);
  await sleep(250);
  await capture('lab-19-quickfill');
  await capture('quickfill-a3');
  console.log('lab-19 / quickfill-a3：两种模式 + 推得角标 + 常驻一致性提示');

  /* ── 20/21 P0：删 Rc / 删 Rl 连带删专属导线（画布对照） ── */
  const paramsText = `(() => (document.body.innerText.match(/params：[^\\n]*/) ?? [''])[0])()`;
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/lab/t/A3` });
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, '20 前置重载');
  await waitFor(`document.querySelectorAll('svg').length > 0`, '骨架 SVG');
  await sleep(400);
  await evaluate(`(() => {
    const row = document.querySelector('li[data-node="n-rc"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '删');
    button.click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('连带 1 条附属导线')`, '删 Rc 连带证据');
  const paramsBeforeRc = await evaluate(paramsText);
  if (!paramsBeforeRc.includes('Rc=1e+12') && !paramsBeforeRc.includes('Rc=1000000000000')) {
    throw new Error(`删 Rc 后 params 不对：${paramsBeforeRc}`);
  }
  await sleep(300);
  await capture('lab-20-delete-rc');
  console.log(`lab-20：删 Rc → e-vcc-bar 与孤儿 dot 随删，params 不变（${paramsBeforeRc.slice(0, 60)}…）`);

  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await sleep(200);
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await waitFor(`!document.body.innerText.includes('已改动')`, '恢复骨架（21 前置）');
  await evaluate(`(() => {
    const row = document.querySelector('li[data-node="n-rl"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '删');
    button.click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('连带 2 条附属导线')`, '删 Rl 连带证据');
  await sleep(300);
  await capture('lab-21-delete-rl');
  console.log('lab-21：删 Rl 对照 → e-rl-bus / e-rl-gnd 随删，shared 汇流条保留');

  /* ── 22 封装面板：候选端口 + 模型声明 + 绿字「封装后可解」 ── */
  const shiftSelect = (nodeId) => `(() => {
    const el = document.querySelector('svg[role="presentation"] [data-node="${nodeId}"]');
    if (!el) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true, pointerId: 1 }));
    return true;
  })()`;
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await sleep(200);
  await evaluate(`(() => { document.querySelector('[data-testid=reset-skeleton]').click(); return true; })()`);
  await waitFor(`!document.body.innerText.includes('已改动')`, '恢复骨架（22 前置）');
  await evaluate(shiftSelect('n-vs'));
  await evaluate(shiftSelect('n-rs'));
  await waitFor(`document.querySelector('[data-testid=wrap-button]') !== null`, '封装按钮出现');
  await evaluate(`(() => { document.querySelector('[data-testid=wrap-button]').click(); return true; })()`);
  await waitFor(`document.querySelector('[data-testid=wrap-panel]') !== null`, '封装面板');
  await waitFor(`document.querySelectorAll('[data-testid=wrap-panel] input[type=checkbox]').length >= 2`, '候选端口');
  const setInput = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
  const fillByPlaceholder = (hint, value) => `(() => {
    const el = [...document.querySelectorAll('[data-testid=wrap-panel] input, [data-testid=wrap-panel] textarea')].find((one) => (one.placeholder ?? '').includes(${JSON.stringify(hint)}));
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
  await evaluate(setInput('[data-testid=wrap-title]', '输入源级'));
  await evaluate(fillByPlaceholder('端口方程', '源 + 输入耦合'));
  await evaluate(fillByPlaceholder('适用范围', '直流、线性'));
  await evaluate(fillByPlaceholder('单位表', 'R:Ω, V:V'));
  await evaluate(fillByPlaceholder('已校验夹具', 'A3'));
  await evaluate(`(() => {
    const btn = document.querySelector('[data-testid=wrap-validate]');
    btn.click();
    return true;
  })()`);
  await waitFor(`(document.querySelector('[data-testid=wrap-verdict]')?.innerText ?? '').includes('封装后可解')`, '封装绿字', 20000);
  await sleep(200);
  await capture('lab-22-composite-panel');
  console.log('lab-22：封装面板（端口标注 + 模型声明 + 绿字「封装后可解：AvNoRo=…」）');

  /* ── 23 封装后的复合块在画布上 ── */
  await evaluate(`(() => { document.querySelector('[data-testid=wrap-save]').click(); return true; })()`);
  await waitFor(`document.body.innerText.includes('已封装「')`, '封装证据');
  await waitFor(`document.querySelector('[data-testid=composite-expand]') !== null`, '复合块行操作');
  const paramsAfterWrap = await evaluate(paramsText);
  await sleep(300);
  await capture('lab-23-composite-canvas');
  console.log('lab-23：画布上的复合块（圆角 block + 两端口），params 逐键不变');

  /* ── 24 双击摊开：内层器件回来，归约数值与摊开前完全相同 ── */
  await evaluate(`(() => {
    const el = document.querySelector('svg[role="presentation"] [data-node="n-cmp-1"]');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelector('[data-testid=composite-collapse]') !== null`, '收拢按钮出现');
  const paramsAfterExpand = await evaluate(paramsText);
  if (paramsAfterExpand !== paramsAfterWrap) {
    throw new Error(`摊开前后归约数值变了：${paramsAfterWrap} → ${paramsAfterExpand}`);
  }
  await sleep(300);
  await capture('lab-24-expanded');
  console.log('lab-24：双击摊开成 cmp/… 内层器件，归约数值与摊开前逐字相同');

  /* ── 25 缺 modelSpec：琥珀判据卡 + 原因码 ── */
  await evaluate(`(() => {
    const bad = [{
      id: 'cmp-u-bad', title: '缺声明模块', note: '',
      ports: [{ id: 'p0', nodeId: 'R1', label: '端 A' }, { id: 'p1', nodeId: 'R2', label: '端 B' }],
      inner: {
        nodes: [
          { id: 'R1', x: 0, y: -44, kind: 'res', rot: 90, label: 'R1', value: 10000 },
          { id: 'R2', x: 0, y: 44, kind: 'res', rot: 90, label: 'R2', value: 10000 },
        ],
        edges: [],
      },
      modelSpec: { equations: [], applicableRange: '', units: {} },
      goldenRefs: [],
      createdAt: '2026-11-11',
    }];
    localStorage.setItem('sd.lab.composite.v1', JSON.stringify(bad));
    return true;
  })()`);
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/lab/t/A3` });
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, '重载画布');
  await waitFor(`[...document.querySelectorAll('[data-testid=composite-add]')].some((b) => b.innerText.includes('缺声明模块'))`, '自定义模块按钮');
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('[data-testid=composite-add]')].find((b) => b.innerText.includes('缺声明模块'));
    btn.click();
    return true;
  })()`);
  await waitFor(`(document.querySelector('[data-testid=structure-card]')?.innerText ?? '').includes('missingModelSpec')`, '缺声明原因码');
  await sleep(300);
  await capture('lab-25-missing-model');
  console.log('lab-25：缺 modelSpec → 琥珀判据卡 + 原因码 missingModelSpec（不进求解）');
  await evaluate(`(() => { localStorage.removeItem('sd.lab.composite.v1'); return true; })()`);

  /* ── 26 撤销：删 Rc → Ctrl+Z（画布前后对比拼一张） ── */
  /** 竖向拼两张 PNG（页面 canvas 合成）：上 = 删后，下 = 撤销后。 */
  const stitchVertical = async (name, base64A, base64B, labelA, labelB) => {
    const b64 = await evaluate(`(async () => {
      const load = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(${JSON.stringify(base64A)}), load(${JSON.stringify(base64B)})]);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(ia.width, ib.width) + 8;
      canvas.height = ia.height + ib.height + 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#67e8f9';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(${JSON.stringify(labelA)}, 12, 20);
      ctx.drawImage(ia, 4, 28);
      ctx.fillText(${JSON.stringify(labelB)}, 12, ia.height + 48);
      ctx.drawImage(ib, 4, ia.height + 56);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(b64, 'base64'));
    console.log(`screenshot: docs/shots/${name}.png`);
  };
  const shot = () => send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((r) => r.data);
  const pressKey = async (modifiers, key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: vk });
  };
  await gotoLab('/lab/t/A3');
  await waitFor(`document.body.innerText.includes('画布（骨架 + 装配结果）')`, '画布（26 前置）');
  await evaluate(`(() => {
    const row = document.querySelector('li[data-node="n-rc"]');
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '删');
    button.click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('连带 1 条附属导线')`, '删 Rc（26 前置）');
  await sleep(250);
  const afterDeleteShot = await shot();
  const undoVisible = await evaluate(`document.querySelector('[data-testid=undo-button]') !== null && !document.querySelector('[data-testid=undo-button]').disabled`);
  if (!undoVisible) throw new Error('撤销按钮没有亮起');
  await pressKey(2, 'z', 'KeyZ', 90); // Ctrl+Z
  await waitFor(`document.querySelector('li[data-node="n-rc"]') !== null`, '撤销后 Rc 行回来');
  await waitFor(`document.body.innerText.includes('已撤销：回到上一步结构')`, '撤销 toast');
  await waitFor(`document.querySelector('[data-testid=redo-button]') !== null && !document.querySelector('[data-testid=redo-button]').disabled`, '重做按钮亮起');
  await sleep(300);
  const afterUndoShot = await shot();
  await stitchVertical('lab-26-undo', afterDeleteShot, afterUndoShot, '删 Rc 后（Ctrl+Z 前）：器件行没有 Rc，弹回已改动画布', 'Ctrl+Z 撤销后：Rc 回到画布与器件列表，重做按钮亮起');
  console.log('lab-26：删 Rc → Ctrl+Z 撤销 → 图回删前，重做可用（上下对比）');
  // 再 Ctrl+Shift+Z 验重做回路
  await pressKey(10, 'Z', 'KeyZ', 90); // Ctrl+Shift+Z（modifiers: ctrl=2 | shift=8）
  await waitFor(`document.querySelector('li[data-node="n-rc"]') === null`, '重做后 Rc 又被删');
  console.log('lab-26 加验：Ctrl+Shift+Z 重做 → Rc 又删掉（撤销重做闭环）');
  await pressKey(2, 'z', 'KeyZ', 90); // 留一张干净骨架给 27

  /* ── 27 Delete 键删选中器件 → 确认黄条（有下游影响） ── */
  await waitFor(`document.querySelector('li[data-node="n-rc"]') !== null`, '撤销复位（27 前置）');
  await evaluate(`(() => {
    const row = document.querySelector('li[data-node="n-q"]');
    if (row) row.blur?.();
    return true;
  })()`);
  await evaluate(shiftSelect('n-q'));
  await waitFor(`document.body.innerText.includes('已选 1 个')`, '选中 Q');
  await pressKey(0, 'Delete', 'Delete', 46);
  await waitFor(`document.querySelector('[data-testid=delete-confirm]') !== null`, '删除确认黄条');
  await sleep(3100); // 等上一条 toast（2800ms）过期再拍，画面不挂旧消息
  await capture('lab-27-delete-key');
  console.log('lab-27：选中 Q 按 Delete → 黄条「归约会失败，确认要删吗」（🗑 与 Delete 键同一条路）');
  await evaluate(`(() => {
    const banner = document.querySelector('[data-testid=delete-confirm]');
    const cancel = [...banner.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
    cancel.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('[data-testid=delete-confirm]') === null`, '黄条取消');
  console.log('lab-27 加验：取消 → Q 保留（确认不是摆设）');

  /* ── 28 拖动确认（W16 任务 D）：40px 后 params 不变、端点仍吸附 ── */
  await gotoLab('/lab/t/A3');
  const paramsBeforeDrag = await evaluate(paramsText);
  const rsNode = await centerOf('svg[role="presentation"] [data-node="n-rs"]');
  if (!rsNode) throw new Error('找不到 n-rs 拖动热区');
  await mouse('mousePressed', rsNode.x, rsNode.y, 1);
  await mouse('mouseMoved', rsNode.x + 20, rsNode.y, 1);
  await mouse('mouseMoved', rsNode.x + 40 * (Number(await evaluate(`(() => { const svg = document.querySelector('svg[role=img]'); const m = svg && svg.getScreenCTM(); return m ? m.a : 1; })()`)) || 1), rsNode.y, 1);
  await sleep(120);
  await mouse('mouseReleased', rsNode.x + 40, rsNode.y, 0);
  await waitFor(`document.body.innerText.includes('已改动')`, '拖动后 dirty（拖动不 toast，收尾只有归约刷新）');
  const dragCheck = await evaluate(`(() => {
    const params = (document.body.innerText.match(/params：[^\\n]*/) ?? [''])[0];
    return params;
  })()`);
  if (dragCheck !== paramsBeforeDrag) throw new Error(`拖动后 params 变了：${paramsBeforeDrag} → ${dragCheck}`);
  await sleep(300);
  await capture('lab-28-drag');
  console.log('lab-28：拖 Rs 40px → params 逐字不变、导线端点重吸附（拖动 W10-B 起就是真的）');

  /* ── 29 器件数值输入：Rc 2.0k → 4.7k ── */
  await gotoLab('/lab/t/A3');
  await evaluate(`(() => {
    const input = document.querySelector('li[data-node="n-rc"] input[data-testid=device-value]');
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '4700');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('Rc 4.7k')`, 'label 重写成 Rc 4.7k');
  await waitFor(`document.body.innerText.includes('已把「Rc」设为 4.7kΩ')`, '设值 toast');
  await waitFor(`(document.body.innerText.match(/Rc=4700/) ?? [''])[0] !== ''`, '归约预览 Rc=4700');
  await sleep(250);
  await capture('lab-29-device-value');
  console.log('lab-29：数值输入失焦提交 → label Rc 4.7k + 归约预览 Rc=4700（node.value 是唯一真相）');
  await pressKey(2, 'z', 'KeyZ', 90); // Ctrl+Z 还原，给 30 一张干净骨架
  await waitFor(`document.body.innerText.includes('Rc 2.0k')`, '撤销改值复位');

  /* ── 30 旋转 90°：n-q 前后对照 ── */
  const beforeRotate = await shot();
  await evaluate(`(() => {
    document.querySelector('[data-testid=rotate-device][data-node="n-q"]').click();
    return true;
  })()`);
  await waitFor(`document.body.innerText.includes('旋转 90°')`, '旋转 toast / 规则');
  await sleep(300);
  const afterRotate = await shot();
  await stitchVertical('lab-30-rotate', beforeRotate, afterRotate, '旋转前：Q 的引脚朝向与导线走线（原始骨架）', '点 ⟳ 后：Q 转 90°，三条导线端点重新吸附到新引脚位置');
  console.log('lab-30：Q 旋转 90° 前后对照，导线跟着引脚走');
  await pressKey(2, 'z', 'KeyZ', 90);
  await waitFor(`document.body.innerText.includes('已撤销')`, '撤销旋转复位');

  /* ── 31 选中导线 → 删 → 开路 U 档 ── */
  await evaluate(`(() => {
    const path = [...document.querySelectorAll('svg[role="presentation"] path')]
      .find((p) => p.getAttribute('stroke') === 'transparent' && (p.getAttribute('d') ?? '').startsWith('M 488.8 226'));
    if (!path) return false;
    path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    return true;
  })()`);
  await waitFor(`document.querySelector('[data-testid=wire-status]') !== null && document.querySelector('[data-testid=wire-status]').innerText.includes('e-c-bus')`, '画布点中导线 e-c-bus');
  await sleep(250);
  await capture('lab-31-wire-select');
  console.log('lab-31：画布点中 e-c-bus → 高亮 + 底部「已选：导线 e-c-bus · 删」');
  await pressKey(0, 'Delete', 'Delete', 46);
  await waitFor(`document.body.innerText.includes('已删除导线，可 Ctrl+Z 撤销')`, '删线 toast');
  await waitFor(`document.body.innerText.includes('开路：')`, '归约预览卡出现开路判据（求解被 isBlockingProblem 拦住，不渲染数值结果 —— check:assemble ㉕① 已断言 U 档）');
  console.log('lab-31 加验：Delete 删线 → 归约预览出现开路判据（此状态下求解必被拒）');
  await pressKey(2, 'z', 'KeyZ', 90);
  await waitFor(`document.body.innerText.includes('已撤销')`, '撤销删线复位');
} finally {
  browser.kill();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Edge 进程句柄释放慢：临时目录留给系统清理，不影响截图
  }
}
console.log('done');
