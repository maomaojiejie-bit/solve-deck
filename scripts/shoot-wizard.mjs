// 用 CDP 点几步向导并截图（Node 22 自带 WebSocket，零依赖）。
// 用法: node scripts/shoot-wizard.mjs <baseUrl> <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const BASE = process.argv[2] || 'http://127.0.0.1:5184';
const OUT = process.argv[3] || 'docs/shots';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = path.join(process.env.TEMP || '.', `edge-wz-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`,
  '--hide-scrollbars',
  '--window-size=1280,900',
  `${BASE}/#/wizard`,
], { stdio: 'ignore' });

await sleep(2500);
const list = await getJson(`http://127.0.0.1:${PORT}/json`);
const page = list.find((t) => t.type === 'page' && t.url.includes('5184')) || list.find((t) => t.type === 'page');
console.log('targets =', JSON.stringify(list.map((t) => [t.type, t.url]).slice(0, 6)));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res?.result?.value;
};

const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button, a')].find((n) => n.textContent.includes(${JSON.stringify(text)}));
    if (!el) return 'not-found: ' + ${JSON.stringify(text)};
    el.click();
    return 'ok';
  })()`);

const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(res.data, 'base64'));
  console.log('shot', name);
};

const steps = [];
await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/#/wizard` });
await sleep(1600);
console.log('href =', await evaluate('location.href'), '| bodyLen =', await evaluate('document.body.innerHTML.length'));
const run = async (label, action) => {
  const out = await action();
  await sleep(450);
  steps.push(`${label} → ${out}`);
};

await run('选课程=材料力学', () => clickText('材料力学'));
await run('选题型=画剪力图', () => clickText('画剪力图'));
await run('步骤检查', () =>
  evaluate(`document.body.innerText.includes('画剪力图 / 弯矩图') ? 'step3 文案在' : 'step3 没出现'`),
);
await shot('wizard-step3.png');
const ids = await evaluate(
  `[...document.querySelectorAll('button')].map((n) => n.textContent.trim().slice(0, 24)).filter(Boolean).slice(0, 12)`,
);
await run('点第一张卡', () => clickText('M3弯曲内力'));
await sleep(600);
const hash = await evaluate('location.hash');
console.log(steps.join('\n'));
console.log('hash =', hash);
console.log('buttons =', JSON.stringify(ids));
await shot('wizard-jump.png');
ws.close();
browser.kill();
