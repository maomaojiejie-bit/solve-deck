/**
 * check:paramlab（H-11 / W21-A A2）：参数实验场接进装配台 —— 改一个值，归约预览与结果同时变。
 *
 * 真页面真拖（CDP，headless Edge）：
 *  ① 未逐项确认 → 分步求解禁用、红字写明还差几项、页面没有结果（W21-A A2.3 闸门）；
 *  ② 逐个点确认 → 分步求解 → 记下结果读数；
 *  ③ 参数实验场改一个值 → 确认栏 / 归约预览 / 实验场三处数值逐键一致；结果撤下；
 *  ④ 再次逐项确认 → 求解 → 结果读数跟着变（M3 的 |M|max 定点验结论卡）；
 *  ⑤ 同一套在 A3 上按 Rc、M3 上按 a 再来一遍；
 *  ⑥ 源码断言：ParamPanel 真的挂上了、solve 有 force 重算通道。
 *
 * W21-A：确认是真闸门后，③→④ 之间必须补一次确认，标准只升不降。
 * 依赖前置 build（verify 里 build 会先跑）：dist 不在就直接红，不假装通过。
 */

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：check:paramlab 依赖前置 build');
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
  const type = file.endsWith('.js')
    ? 'text/javascript'
    : file.endsWith('.css')
      ? 'text/css'
      : file.endsWith('.png')
        ? 'image/png'
        : 'text/html; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(5196, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'paramlab-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1500,1100', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 端口 0 + DevToolsActivePort：固定端口会被残留 headless 实例抢占 ——
// 旧实例带旧磁盘缓存 ⇒ 假绿；socket 连到别人家的浏览器 ⇒ PASS 后不退、卡死整条 build。
let debugPort = 0;
for (let i = 0; i < 50 && !debugPort; i += 1) {
  try { debugPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
  if (!debugPort) await sleep(200);
}


let page;
for (let i = 0; i < 50; i += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) break;
  } catch {}
  await sleep(200);
}
if (!debugPort || !page) throw new Error('headless 浏览器没起来');

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

/** 等一个选择器出现（最多 ~15s）。 */
async function waitFor(expression, label) {
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  ok(`等待 ${label}`, false, '超时');
  return false;
}

/** 结果区读数（数字签名 + 归约预览行）。 */
const readOutcome = () =>
  evaluate(`(() => {
    const main = document.querySelector('main');
    let text = main ? main.innerText : '';
    // 「结果读数」必须来自结果本体，不能靠顶部参数徽标凑数（那只是把参数回显一遍）
    const badge = document.querySelector('[data-testid=param-badge]');
    if (badge) text = text.split(badge.innerText).join('');
    // 黑盒 #25：预览参数改成键值 chips 后可能软换行 —— 取元素本体并归一换行
    const previewEl = main?.querySelector('[data-testid=preview-params]');
    const previewText = previewEl ? previewEl.innerText : '';
    const preview = previewText ? previewText.replace(/\\s*\\n\\s*/g, '　') : (text.match(/params：[^\\n]*/) ?? [''])[0];
    if (previewText) text = text.replace(previewText, '');
    // 归约预览那一行也剔掉：它本来就跟着参数变，不能替结果读数作证
    const withoutPreview = text
      .split('\\n')
      .filter((line) => !line.startsWith('params：'))
      .join('\\n');
    const numbers = (withoutPreview.match(/-?\\d+(?:\\.\\d+)?/g) ?? []).slice(-40).join(',');
    // W20 §3-2：结论卡里「这张图的量」的 |M|max 单行（不是随便一个数字签名）
    const mmax = document.querySelector('[data-testid=graph-measures] [data-measure=internal] [data-testid=measure-headline]')?.innerText ?? '';
    return { preview, numbers, mmax, len: text.length };
  })()`);

/** 把参数实验场里某个键的数值框改成 value（React 用原生 setter + input 事件）。 */
const setParam = (key, value) =>
  evaluate(`(() => {
    const host = document.querySelector('[data-testid=param-panel]');
    if (!host) return 'no-panel';
    const input = host.querySelector('[data-param-input="${key}"]');
    if (!input) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '${value}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);

/** 参数实验场的「实时」开关：开 = 拖动即重算（改值算已确认），关 = 改值回到未确认。 */
const setLive = (on) =>
  evaluate(`(() => {
    const box = document.querySelector('[data-testid=param-live]');
    if (!box) return 'no-live';
    if (box.checked !== ${on ? 'true' : 'false'}) box.click();
    return box.checked;
  })()`);

/** 逐个点确认（首次求解 / 改动后重算都要过这道闸）。 */
const confirmAll = () =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid=param-row]')];
    for (const row of rows) {
      const box = row.querySelector('input[type=checkbox]');
      if (box && !box.checked) box.click();
    }
    return rows.length;
  })()`);

/** 三处数值 + 闸门状态：确认栏 / 参数实验场 / 归约预览 / 结果是否在屏。 */
const triState = () =>
  evaluate(`(() => {
    const rows = Object.fromEntries(
      [...document.querySelectorAll('[data-testid=param-row]')].map((r) => [
        r.getAttribute('data-param'),
        Number(r.querySelector('input[type=number]')?.value),
      ]),
    );
    const panel = Object.fromEntries(
      [...document.querySelectorAll('[data-testid=param-panel] [data-param-input]')].map((i) => [
        i.getAttribute('data-param-input'),
        Number(i.value),
      ]),
    );
    const all = document.querySelector('main')?.innerText ?? '';
    return {
      rows,
      panel,
      preview: (() => { const el = document.querySelector('[data-testid=preview-params]'); return el ? el.innerText.replace(/\\s*\\n\\s*/g, '　') : (all.match(/params：[^\\n]*/) ?? [''])[0]; })(),
      disabled: document.querySelector('[data-testid=solve-button]')?.disabled,
      note: document.querySelector('[data-testid=confirm-gate-note]')?.innerText ?? '',
      hasResult: Boolean(document.querySelector('.print-result')),
    };
  })()`);

const parsePreviewPairs = (line) =>
  Object.fromEntries(
    [...line.matchAll(/([A-Za-z_]\w*)=(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g)].map((m) => [m[1], Number(m[2])]),
  );

async function runCase(id, paramKey, from, to, label) {
  // 同一 hash 再导航不会重载：先去 about:blank 再回来。
  await send('Page.navigate', { url: 'http://127.0.0.1:5196/about:blank' });
  await sleep(150);
  await send('Page.navigate', { url: `http://127.0.0.1:5196/#/lab/t/${id}` });
  const ready = await waitFor("document.querySelectorAll('[data-testid=param-row]').length > 0", `${id} 参数行`);
  if (!ready) return;

  /* W21-A A2.3：未逐项确认时求解禁用 + 红字 + 不盖章（报告 5.3）。 */
  const gate = await triState();
  ok(`${label}：未逐项确认时「分步求解」禁用`, gate.disabled === true, `disabled=${gate.disabled}`);
  ok(`${label}：未确认时红字写明还差几项`, /还有 \d+ 项没确认/.test(gate.note), `实际「${gate.note}」`);
  ok(`${label}：未确认时页面没有结果`, gate.hasResult === false, '未确认就出了结果表');

  await confirmAll();
  await sleep(300);
  await evaluate("document.querySelector('[data-testid=solve-button]')?.click()");
  const solved = await waitFor("document.querySelector('[data-testid=param-badge]') !== null", `${id} 求解结果`);
  if (!solved) return;

  const panel = await evaluate("Boolean(document.querySelector('[data-testid=param-panel]'))");
  ok(`${label}：右栏底部有参数实验场`, panel === true, 'DOM 里找不到 [data-testid=param-panel]');

  const before = await readOutcome();
  ok(`${label}：求解前归约预览含 ${paramKey}=${from}`, before.preview.includes(`${paramKey}=${from}`), `实际「${before.preview.slice(0, 60)}」`);

  // 严格档（实时关）：改值必须回到未确认、结果撤下 —— 这是「确认闸门」的承诺，不能被实时档顺手废掉。
  await setLive(false);
  await sleep(200);

  const applied = await setParam(paramKey, to);
  await sleep(900);
  const mid = await triState();

  /* W21-A A2 三条：改 a 后确认栏同步 / 未确认按钮禁用 / 确认后三处数值一致。 */
  ok(`${label}：改 ${paramKey} → ${to} 后确认栏同步`, mid.rows[paramKey] === Number(to), `确认栏 ${mid.rows[paramKey]}（setParam=${applied}）`);
  const pairs = parsePreviewPairs(mid.preview);
  // 归约预览里还有归约表专有键（config / Vt…），参数表里没有；只对三处共有的键逐键比。
  const common = Object.keys(pairs).filter((key) => key in mid.rows && key in mid.panel);
  const consistent =
    common.length >= 3 && common.every((key) => mid.rows[key] === pairs[key] && mid.panel[key] === pairs[key]);
  ok(
    `${label}：三处数值一致（确认栏 / 归约预览 / 实验场）`,
    consistent,
    `预览 ${mid.preview.slice(0, 70)} · 确认栏 ${JSON.stringify(mid.rows)} · 实验场 ${JSON.stringify(mid.panel)}`,
  );
  ok(
    `${label}：改动后回到未确认，结果撤下且按钮禁用`,
    mid.disabled === true && mid.hasResult === false && /没确认/.test(mid.note),
    `disabled=${mid.disabled} hasResult=${mid.hasResult} note=${mid.note}`,
  );

  /* 再确认 → 再求解：结果才允许重新出现（force 重算也不绕过闸门）。 */
  await confirmAll();
  await sleep(300);
  await evaluate("document.querySelector('[data-testid=solve-button]')?.click()");
  await waitFor("document.querySelector('[data-testid=param-badge]') !== null", `${label} 确认后求解`);
  await sleep(700);
  const after = await readOutcome();

  ok(`${label}：改 ${paramKey} → ${to} 后归约预览变了`, after.preview.includes(`${paramKey}=${to}`), `实际「${after.preview.slice(0, 60)}」（setParam=${applied}）`);
  ok(`${label}：改 ${paramKey} 后结果读数跟着变`, after.numbers !== before.numbers, `两次读数相同：${before.numbers.slice(0, 60)}`);
  // W20 §3-2（M3 改硬）：不是「数字签名变了」就算过，要定点验结论卡上的 |M|max 跟着 L 变。
  if (id === 'M3' && paramKey === 'L') {
    const mOf = (text) => Number((/\|M\|max\s*=\s*(-?\d+(?:\.\d+)?)/.exec(text) ?? [])[1] ?? NaN);
    ok('M3：结论卡按图给出了 |M|max', Number.isFinite(mOf(before.mmax)) && Number.isFinite(mOf(after.mmax)), `改前「${before.mmax}」改后「${after.mmax}」`);
    ok('M3：改 L → 结论卡上的 |M|max 跟着变', mOf(before.mmax) !== mOf(after.mmax), `|M|max 改前 ${mOf(before.mmax)}、改后 ${mOf(after.mmax)}（没跟着 L 变）`);
    console.log(`M3：结论卡 |M|max ${mOf(before.mmax)} → ${mOf(after.mmax)}（L ${from}→${to}，按图现算）`);
  }

  /* 实时档（默认开）：改值算「你确认过这一项」→ 结果不撤、按钮不禁、数值当场跟着变。 */
  await setLive(true);
  await sleep(200);
  const liveApplied = await setParam(paramKey, from);
  await sleep(900);
  const live = await triState();
  ok(`${label}：实时档改回 ${from} 时值同步`, live.rows[paramKey] === Number(from), `确认栏 ${live.rows[paramKey]}（setParam=${liveApplied}）`);
  ok(
    `${label}：实时档改值不撤结果、不禁按钮`,
    live.hasResult === true && live.disabled === false,
    `hasResult=${live.hasResult} disabled=${live.disabled} note=${live.note}`,
  );
  const liveOutcome = await readOutcome();
  ok(
    `${label}：实时档结果跟着滑杆变回去`,
    live.preview.includes(`${paramKey}=${from}`) && liveOutcome.numbers !== after.numbers,
    `预览「${live.preview.slice(0, 46)}」· 读数 ${liveOutcome.numbers.slice(0, 40)}`,
  );

  console.log(
    `${label}：${paramKey} ${from}→${to} · 预览「${before.preview.slice(0, 34)}」→「${after.preview.slice(0, 34)}」· 读数变化 ${after.numbers.length} 位`,
  );
}

await runCase('M3', 'L', '4', '6', '力学 M3');
await runCase('M3', 'a', '2', '3', '力学 M3 改 a');
await runCase('A3', 'Rc', '2000', '4700', '电路 A3');

/* ── ⑦ W22-R P0：非法参数拒算 / URL 越界黄条 / 悬臂识别 ───────── */
{
  // 7a a≥L 非法组合 → 红条拒算，零结果零绿章（黄金快照不许顶上来）
  await send('Page.navigate', { url: 'http://127.0.0.1:5196/#/t/M5?L=2&a=2&P=10' });
  await waitFor(`document.querySelector('[data-testid=param-error-banner]') !== null`, '参数拒算红条');
  const bad = await evaluate(`(() => ({
    banner: document.querySelector('[data-testid=param-error-banner]')?.textContent ?? '',
    steps: document.body.textContent.includes('过程 1/'),
  }))()`);
  ok(
    '⑦a a≥L 拒算：红条指名 (0,L) 且无结果区',
    bad.banner.includes('拒绝出结果') && bad.banner.includes('(0, L)') && !bad.steps,
    JSON.stringify(bad.banner.slice(0, 60)),
  );

  // 7b URL 越界 → 黄条点名 + 面板默认值 + 结果照出（面板 = 结果同源）
  await send('Page.navigate', { url: 'http://127.0.0.1:5196/#/t/M3?L=0' });
  await waitFor(`document.querySelector('[data-testid=param-range-banner]') !== null`, 'URL 越界黄条');
  const range = await evaluate(`(() => ({
    banner: document.querySelector('[data-testid=param-range-banner]')?.textContent ?? '',
    l: document.querySelector('input[data-param-input=L]')?.value ?? null,
    result: document.body.textContent.includes('Mmax'),
  }))()`);
  ok(
    '⑦b URL 越界黄条点名 + 面板默认值一致',
    range.banner.includes('L=0') && range.l === '4' && range.result,
    JSON.stringify(range).slice(0, 90),
  );

  // 7c 面板越界 → 不夹取，拒算红条点名区间
  await send('Page.navigate', { url: 'http://127.0.0.1:5196/#/t/M3' });
  await waitFor(`document.querySelector('input[data-param-input=L]') !== null`, 'M3 参数面板');
  await evaluate(`(() => {
    const input = document.querySelector('input[data-param-input=L]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '12');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return 'ok';
  })()`);
  await waitFor(`document.querySelector('[data-testid=param-error-banner]') !== null`, '面板越界拒算红条');
  const clamp = await evaluate(`document.querySelector('[data-testid=param-error-banner]')?.textContent?.slice(0, 80) ?? ''`);
  ok('⑦c 面板越界不夹取拒算', clamp.includes('12') && clamp.includes('[1, 8]'), clamp.slice(0, 70));

  // 7d 悬臂题 → M3-cantilever（支承条件优先于题型词）
  await send('Page.navigate', { url: 'http://127.0.0.1:5196/#/solve' });
  await waitFor(`document.querySelector('textarea') !== null`, 'solve 页');
  await evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '悬臂梁 L=2m，自由端受集中力 P=10kN，求固端弯矩与挠度');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '读题')?.click()`);
  await waitFor(`document.body.textContent.includes('M3-cantilever')`, '悬臂判型');
  ok('⑦d 悬臂题判到 M3-cantilever', true);
  console.log('⑦  P0：非法参数拒算 / URL 越界黄条 / 面板不夹取 / 悬臂判型');
}

/* ── 源码断言（重算通道不能被拆成空壳） ───────────────────────── */
{
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('源码：ParamPanel 已挂到装配台', /<ParamPanel/.test(labSource) && /solveMs=\{solveMs\}/.test(labSource));
  ok('源码：改值走 experimentChange（不是直接 onParamChange）', /onChange=\{experimentChange\}/.test(labSource));
  ok('源码：solve 有 force 重算通道', /const solve = async \(force = false\)/.test(labSource));
  ok('源码：改值后自动重算一次', /recomputeArmed/.test(labSource) && /solveRef\.current\?\.\(true\)/.test(labSource));
  ok('源码：参数面板有可测锚点', /data-testid="param-panel"/.test(readFileSync(join(root, 'src', 'ui', 'ParamPanel.tsx'), 'utf8')));
  console.log('源码：ParamPanel 挂载 / experimentChange / force 重算 / param-panel 锚点 全在');
}

try {
  socket.close();
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  // Edge 可能换 PID 重启、脱离 spawn 父子链：按唯一 profile 路径兜底清整棵树，
  // 不留残留实例给下一轮门禁抢端口 / 喂旧缓存。
  spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
} catch {}

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（参数实验场：M3 改 L/a、A3 改 Rc → 确认闸门 / 三处同源 / 结果跟着变）`);
process.exit(0);
