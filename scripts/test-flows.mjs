// 端到端点一遍真实用户路径（CDP，零依赖）。
// node scripts/test-flows.mjs http://127.0.0.1:5184
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5184';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 300);
const PROFILE = path.join(process.env.TEMP || '.', `edge-flow-${Date.now()}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(b));
        } catch (e) {
          reject(e);
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
  '--window-size=1400,1000',
  'about:blank',
], { stdio: 'ignore' });

await sleep(2200);
const list = await getJson(`http://127.0.0.1:${PORT}/json`);
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) return `EXC: ${r.exceptionDetails.text}`;
  return r?.result?.value;
};

const results = [];
const check = (name, pass, extra = '') => {
  results.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const goto = async (hash) => {
  await send('Page.navigate', { url: `${BASE}/${hash}` });
  await sleep(1200);
};

const click = (text) =>
  ev(`(() => {
    const el = [...document.querySelectorAll('button,a')].find((n) => n.textContent.replace(/\\s+/g,'').includes(${JSON.stringify(
      text.replace(/\s+/g, ''),
    )}));
    if (!el) return 'not-found';
    el.click();
    return 'ok';
  })()`);

// ── 1. 首页 ─────────────────────────────────────────────
await goto('#/');
const home = await ev(`({
  cards: [...document.querySelectorAll('a[href^="#/t/"], button')].filter((n)=>/#\\/t\\//.test(n.getAttribute('href')||n.dataset.href||'')||/已就绪/.test(n.textContent)).length,
  has28: document.body.innerText.includes('28'),
  roadmap: document.body.innerText.includes('路线图'),
})`);
check('首页渲染', Boolean(home?.has28), JSON.stringify(home));

// ── 2. #/solve 规则解析（无 key） ────────────────────────
await goto('#/solve');
const chip = await click('共源放大器');
const typed = await ev(`(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '共源放大器 gm=1mS，Rd=2kΩ，Rl=10kΩ，求电压增益');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return ta.value.slice(0, 12);
})()`);
await sleep(300);
const parsed = await click('AI 解析');
await sleep(1500);
const afterParse = await ev(
  `({ text: document.body.innerText.replace(/\\s+/g,' ').slice(0, 420), hash: location.hash })`,
);
const sawDraft = /待确认|确认为|A5|Rd/.test(afterParse.text);
check('贴例句后点 AI 解析', parsed === 'ok' && sawDraft, `chip=${chip} typed=${typed} hash=${afterParse.hash}`);
const buttons = await ev(
  `[...document.querySelectorAll('button')].map((n) => n.textContent.replace(/\\s+/g,'').slice(0,14)).filter(Boolean)`,
);
console.log(
  '  confirm:',
  await ev(`(() => {
    const el = [...document.querySelectorAll('button')].find((n) => n.textContent.includes('确认无误'));
    if (!el) return 'no-confirm-button';
    return JSON.stringify({ disabled: el.disabled, html: el.outerHTML.slice(0, 180) });
  })()`),
);
console.log('  text:', (afterParse.text || '').slice(0, 300));

const jump = await click('确认');
await sleep(1200);
const hashAfter = await ev('location.hash');
check('确认后跳转到模板页', /#\/t\//.test(hashAfter), hashAfter);

const tpl = await ev('document.body.innerText.replace(/\\s+/g," ").slice(0, 200)');
check('模板页有内容', tpl.length > 40, tpl.slice(0, 80));

// ── 3. #/wizard ─────────────────────────────────────────
await goto('#/wizard');
const c1 = await click('材料力学');
await sleep(400);
const c2 = await click('画剪力图');
await sleep(500);
const cards = await ev(`document.body.innerText.includes('M3-cantilever') || document.body.innerText.includes('M3 · 悬臂梁')`);
check('向导两级点击到候选', c1 === 'ok' && c2 === 'ok' && Boolean(cards));
const c3 = await click('M3弯曲内力');
await sleep(700);
const hash3 = await ev('location.hash');
check('向导点卡即跳转', /#\/t\/M3/.test(hash3), hash3);

// ── 4. 直达 + 参数 URL ──────────────────────────────────
await goto('#/t/A5-CG');
await sleep(800);
const cg = await ev('document.body.innerText.replace(/\\s+/g," ").slice(0,120)');
check('变体直达 A5-CG', /共栅|CG|Av/.test(cg), cg.slice(0, 60));

await goto('#/t/M3?L=6&a=3');
await sleep(900);
const m3 = await ev('document.body.innerText.replace(/\\s+/g," ")');
check('URL 参数生效（L=6,a=3）', /6|13\.33|15\.00|RB/.test(m3), (m3.match(/R_A|RA/g) || []).length + ' hits');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAIL`);
ws.close();
browser.kill();
process.exit(failed === 0 ? 0 : 1);
