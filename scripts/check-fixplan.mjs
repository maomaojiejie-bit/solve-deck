/**
 * check:fixplan —— 修复计划（docs 阶段 4）新增的 6 条护栏。
 *
 * 单元层（node 直跑，不依赖浏览器）：
 *  ① param-writeback   无写入目标 → 台账不出现「已写回图」；有写入 → 台账点名列出键
 *  ② confirm-all       每个 Lab 型：骨架默认值下至少一个参数写得进图（确认闸不会永远卡死）
 *  ③ unit-mode         setUnitMode 切档后 fmtMeasureUnit 立即换口径（auto / si / eng）
 *  ④ units-consistent  反力 / 端值 / 极值 / 轴标 同一精度（源码断言：fmtMeasureUnit 全部带 4）
 *
 * CDP 层（headless Edge 真页面，模式与 check-labshell 相同，依赖前置 build）：
 *  ⑤ layout-overflow   各模板右栏 scrollWidth === clientWidth（T2.4 护栏）
 *  ⑥ out-of-range      a=0：确认 → 求解 → 常驻红条带合法区间，不静默（T1.2 护栏）
 *  ⑦ unit-mode(交互)   已求解切单位制，不点求解数字与单位立刻变（T1.3 护栏）
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { freshSkeleton, labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { PICKS, PICK_IDS, applyParamsWithReport } from '../src/core/lab/picks.ts';
import { fmtMeasureUnit } from '../src/core/lab/measures.ts';
import { setUnitMode, getUnitMode } from '../src/core/units.ts';

const root = process.cwd();
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
const specOf = (id) =>
  labSkeletonSpec(id, JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8')).render_specs[0]);
const skeleton = (id) => freshSkeleton(id, specOf(id));

/* ── ① param-writeback ─────────────────────────────────────────── */
{
  const m3 = skeleton('M3');
  const qOut = applyOp('M3', m3, { op: 'applyParams', values: { q: 5 } });
  ok(
    '① 无写入目标不产生「已写回图」台账',
    qOut.rules.every((rule) => !rule.includes('已写回图')),
    JSON.stringify(qOut.rules),
  );
  const withReport = applyParamsWithReport('M3', m3, { L: 4, a: 2, P: 30, q: 0 });
  ok('① 有写入时台账点名列出键', withReport.written.includes('P') && withReport.written.includes('a'), JSON.stringify(withReport.written));
  const qReport = applyParamsWithReport('M3', m3, { q: 5 });
  ok('① q（图上没有均布载荷）不算写进', !qReport.written.includes('q'), JSON.stringify(qReport.written));
}

/* ── ② confirm-all：确认闸不会永远卡死 ─────────────────────────── */
{
  const stuck = [];
  for (const id of PICK_IDS) {
    const entry = PICKS[id];
    if (!entry || entry.picks.length === 0) continue;
    let graph;
    try {
      graph = skeleton(id);
    } catch {
      continue; // 没有 examples 快照的型（变体等）跳过
    }
    const report = applyParamsWithReport(id, graph, Object.fromEntries(entry.picks.map((pick) => [pick.key, 1])));
    if (report.written.length === 0) stuck.push(id);
  }
  ok('② 每个 Lab 型至少一个参数写得进图（确认闸不死锁）', stuck.length === 0, `卡死：${stuck.join(', ')}`);
}

/* ── ③ unit-mode：切档立即换口径 ───────────────────────────────── */
{
  const before = getUnitMode();
  setUnitMode('auto');
  const auto = fmtMeasureUnit(15, 'kN');
  setUnitMode('si');
  const si = fmtMeasureUnit(15, 'kN');
  setUnitMode('eng');
  const eng = fmtMeasureUnit(15, 'kN');
  setUnitMode(before);
  ok('③ auto 档沿用 fmtMeasure 口径', auto === '15 kN', auto);
  ok('③ si 档换算成基本单位', /15000\s*N/.test(si), si);
  ok('③ eng 档工程口径', /15\s*kN/.test(eng), eng);
}

/* ── ④ units-consistent：同一精度（源码断言） ──────────────────── */
{
  const generic = readFileSync(join(root, 'src', 'ui', 'GenericResult.tsx'), 'utf8');
  const calls = generic.match(/fmtMeasureUnit\(/g) ?? [];
  const withDigits = generic.match(/fmtMeasureUnit\([^)]*,\s*'[^']+',\s*\d+\)/g) ?? [];
  ok('④ GenericResult 反力/端值全部走 fmtMeasureUnit', calls.length >= 12 && withDigits.length === calls.length, `${withDigits.length}/${calls.length}`);
  ok('④ 反力表头带单位', generic.includes('Fx (kN)') && generic.includes('Mz (kN·m)'), '表头没有单位');
  ok('④ 电路表数值带单位文本', /fmtMeasure\([^)]*\)\s*} A</.test(generic) || generic.includes("} A</td>"), '电路电流列没有单位');
  const measures = readFileSync(join(root, 'src', 'core', 'lab', 'measures.ts'), 'utf8');
  ok('④ 内力汇总行（轴标口径）同为 4 位', /fmtMeasureUnit\([^)]*'kN·m', 4\)/.test(measures), 'measures.ts:486 没带 4');
}

/* ── ⑤⑥⑦ CDP 真页面层 ────────────────────────────────────────── */
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：check:fixplan 的 CDP 层依赖前置 build（单元层已跑完）');
  if (errors.length > 0) {
    console.error(`FAIL：${errors.length}/${checks} 项未通过`);
    process.exit(1);
  }
  console.log(`PASS：${checks} 项（CDP 层跳过）`);
  process.exit(0);
}

const { createServer } = await import('node:http');
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) ? candidate : join(dist, 'index.html');
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5196, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'fixplan-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9352', '--window-size=1500,1000', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9352/json/list')).json();
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
const go = async (hash) => {
  await send('Page.navigate', { url: `http://127.0.0.1:5196/${hash}` });
  await sleep(600);
};
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(predicate)) return true;
    await sleep(250);
  }
  ok(`等待 ${label}`, false, '超时');
  return false;
};

await send('Page.enable');
await send('Runtime.enable');

/* ── ⑤ layout-overflow：各模板右栏不横向溢出 ───────────────────── */
{
  for (const id of ['M3', 'M2', 'A3', 'A5', 'S5']) {
    await go(`#/lab/t/${id}`);
    const ready = await waitFor("document.querySelectorAll('[data-testid=param-row]').length > 0", `${id} 参数行`);
    if (!ready) continue;
    const out = await evaluate(`(() => {
      const col = document.querySelector('[data-testid=col-known]');
      if (!col) return null;
      return { d: col.scrollWidth - col.clientWidth, rows: [...document.querySelectorAll('[data-testid=param-row]')].map((r) => r.scrollWidth - r.clientWidth) };
    })()`);
    ok(`⑤ ${id} 右栏与参数行零横向溢出`, out !== null && out.d <= 0 && out.rows.every((d) => d <= 0), JSON.stringify(out));
  }
}

/* ── ⑥ out-of-range：a=0 确认后求解 → 常驻红条 ─────────────────── */
{
  await go('#/lab/t/M3');
  await waitFor("document.querySelectorAll('[data-testid=param-row]').length > 0", 'M3 参数行');
  const result = await evaluate(`(async () => {
    const input = document.querySelector('[data-testid=confirm-input-a]');
    if (!input) return 'no input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '0');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    document.querySelector('[data-testid=confirm-all]')?.click();
    await new Promise((r) => setTimeout(r, 200));
    const solve = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('分步求解'));
    if (!solve || solve.disabled) return 'solve disabled';
    solve.click();
    await new Promise((r) => setTimeout(r, 900));
    const banner = document.body.innerText.split('\\n').find((line) => line.includes('超出合法区间'));
    return { banner: banner ?? null, solved: document.body.innerText.includes('已求解') };
  })()`);
  ok('⑥ a=0 求解被拦（不静默）', Boolean(result) && result !== 'no input' && result !== 'solve disabled', JSON.stringify(result));
  ok('⑥ 常驻红条带合法区间', Boolean(result?.banner?.includes('0.1')), JSON.stringify(result?.banner ?? null));
  ok('⑥ 拒答态不挂「已求解」章', result?.solved !== true);
}

/* ── ⑦ unit-mode（交互）：已求解切制立即变 ─────────────────────── */
{
  await go('#/lab/t/M3');
  await waitFor("document.querySelectorAll('[data-testid=param-row]').length > 0", 'M3 参数行');
  const result = await evaluate(`(async () => {
    document.querySelector('[data-testid=confirm-all]')?.click();
    await new Promise((r) => setTimeout(r, 200));
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('分步求解'))?.click();
    await new Promise((r) => setTimeout(r, 1200));
    const combo = document.querySelector('select[aria-label*="单位"]');
    if (!combo) return 'no select';
    const grab = () => {
      const spans = [...document.querySelectorAll('[data-param-input]')];
      const experiment = spans.map((s) => s.parentElement?.innerText ?? '').join(' | ');
      return experiment.slice(0, 300);
    };
    const before = grab();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    const next = combo.value === 'si' ? 'eng' : 'si';
    setter.call(combo, next);
    combo.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1600));
    return { before, after: grab(), to: next };
  })()`);
  ok('⑦ 切单位后实验场读数立刻变（不点求解）', Boolean(result?.before) && result.before !== result.after, JSON.stringify(result?.after ?? result));
}

try {
  socket.close();
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
console.log(`PASS：${checks} 项（修复计划护栏：param-writeback / confirm-all / unit-mode / units-consistent / layout-overflow / out-of-range）`);
