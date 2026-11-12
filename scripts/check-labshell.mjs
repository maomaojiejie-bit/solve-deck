/**
 * check:labshell（R3-2 §3 + H-13 / H-04 / N-01 / N-03 / N-04 / H-14 / H-11）
 *
 * 真页面（CDP，headless Edge）逐条钉：
 *  ① 外壳统一：home / solve / lab / about / scope / digital 的页头容器都 ≤1120 且居中收窄
 *  ② #/lab 三栏齐（装配 / 画布 / 已知量），左栏纵向滚动、横向不滚（N-04）
 *  ③ 数字求值两处入口：首页顶栏一键到、索引页卡片一键到（H-13）
 *  ④ 力学页无 `composite-add`，电路页有（H-04）
 *  ⑤ `#/solve` 前进键恰好两个：看结构 / 看讲解（N-01）
 *  ⑥ 来源徽标只有一枚（N-03）：题面进来的写全，且 `badge-*` 计数 = 1
 *  ⑦ 撤销 / 重做 tooltip 文案（H-14）
 *  ⑧ 参数实验场在右栏底部（H-11 的界面那一半；数值那一半在 check:paramlab）
 */

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NOT_APPLICABLE } from '../src/core/lab/coverage.ts';

const root = process.cwd();
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：check:labshell 依赖前置 build');
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
await new Promise((done) => server.listen(5195, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'labshell-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=9351', '--window-size=1500,1000', 'about:blank'],
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
const sleepFor = async (predicate, label) => {
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(predicate)) return true;
    await sleep(250);
  }
  ok(`等待 ${label}`, false, '超时');
  return false;
};
const go = async (hash) => {
  await send('Page.navigate', { url: `http://127.0.0.1:5195/${hash}` });
  await sleep(500);
};

await send('Page.enable');
await send('Runtime.enable');

/* ── ① 外壳统一：读物页 ≤1120、工作面页 ≤1440 ──────────────────────
 * 两类页面的「宽」不是一个意思：首页/贴题/关于/范围判别是读物，窄栏才好读；
 * 装配台是要摆图的工作面 —— 1120 切三栏后画布只剩 500px，图缩到 0.6 倍后
 * 梁只占中间一条带。所以装配台放宽到 1440（与结果页 1600 同属工作面），
 * 但依然要「居中收窄」：宽必须有上限，不是撑满。                        */
{
  const pages = [
    ['#/', '首页', 1120],
    ['#/solve', '我的题', 1120],
    ['#/lab', '装配台索引', 1440],
    ['#/lab/t/M3', '装配台', 1440],
    ['#/about', '关于', 1120],
    ['#/scope', '范围判别', 1120],
    ['#/lab/digital', '数字求值', 1120],
  ];
  const widths = [];
  for (const [hash, label, cap] of pages) {
    await go(hash);
    const width = await evaluate(`(() => {
      const shell = document.querySelector('header > div');
      return shell ? Math.round(shell.getBoundingClientRect().width) : -1;
    })()`);
    widths.push(`${label}=${width}`);
    ok(
      `外壳统一：${label} 页头 ≤${cap} 且收窄`,
      typeof width === 'number' && width > 900 && width <= cap + 1,
      `实测 ${width}px`,
    );
  }
  console.log(`外壳宽度：${widths.join(' / ')}`);
}

/* ── ③ 数字求值两处入口（H-13） ───────────────────────────────── */
{
  await go('#/');
  const homeLinks = await evaluate(`(() => {
    const links = [...document.querySelectorAll('header a')].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href') }));
    return links;
  })()`);
  ok('H-13：首页顶栏有装配台 / 数字求值 / 关于', ['装配台', '数字求值', '关于'].every((text) => homeLinks.some((item) => item.text === text)), JSON.stringify(homeLinks));
  await evaluate("document.querySelector('header a[href=\"#/lab/digital\"]')?.click()");
  await sleep(600);
  const afterHome = await evaluate('location.hash');
  ok("H-13：首页顶栏点击 → location.hash === '#/lab/digital'", afterHome === '#/lab/digital', `实际 ${afterHome}`);

  await go('#/lab');
  const entry = await evaluate("Boolean(document.querySelector('[data-testid=lab-digital-entry]'))");
  ok('H-13：#/lab 索引页有数字求值入口', entry === true, '找不到 [data-testid=lab-digital-entry]');
  await evaluate("document.querySelector('[data-testid=lab-digital-entry]')?.click()");
  await sleep(600);
  const afterIndex = await evaluate('location.hash');
  ok("H-13：索引页点击 → location.hash === '#/lab/digital'", afterIndex === '#/lab/digital', `实际 ${afterIndex}`);
  console.log(`数字求值入口：顶栏 → ${afterHome}；索引页 → ${afterIndex}`);
}

/* ── ② 三栏 / ④ 族隔离 / ⑥ 徽标 / ⑦ tooltip / ⑧ 参数实验场 ───── */
{
  await go('#/lab/t/M3');
  await sleepFor("document.querySelectorAll('[data-testid=param-row]').length > 0", 'M3 装配态');

  const columns = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('main h2')].map((h) => h.innerText.trim());
    return heads;
  })()`);
  ok(
    '#/lab 三栏齐（装配 / 画布 / 已知量）',
    ['装配（白名单内）', '画布（骨架 + 装配结果）', '确认已知量'].every((head) => columns.includes(head)),
    JSON.stringify(columns),
  );

  const overflow = await evaluate(`(() => {
    const left = [...document.querySelectorAll('main section')].find((s) => s.innerText.includes('装配（白名单内）'));
    if (!left) return null;
    return { scrollWidth: left.scrollWidth, clientWidth: left.clientWidth };
  })()`);
  ok(
    'N-04：左栏无横向溢出',
    Boolean(overflow) && overflow.scrollWidth <= overflow.clientWidth + 1,
    JSON.stringify(overflow),
  );

  const tooltips = await evaluate(`(() => ({
    undo: document.querySelector('[data-testid=undo-button]')?.getAttribute('title'),
    redo: document.querySelector('[data-testid=redo-button]')?.getAttribute('title'),
  }))()`);
  ok('H-14：撤销 tooltip = 「撤销 (Ctrl+Z)」', tooltips.undo === '撤销 (Ctrl+Z)', `实际 ${tooltips.undo}`);
  ok('H-14：重做 tooltip = 「重做 (Ctrl+Shift+Z)」', tooltips.redo === '重做 (Ctrl+Shift+Z)', `实际 ${tooltips.redo}`);

  const paramPanel = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid=param-panel]');
    if (!panel) return null;
    const right = [...document.querySelectorAll('main section')].find((s) => s.innerText.includes('确认已知量'));
    return { inRight: Boolean(right && right.contains(panel)) };
  })()`);
  ok('H-11：参数实验场在右栏', paramPanel?.inRight === true, JSON.stringify(paramPanel));

  const compositeBeam = await evaluate("document.querySelectorAll('[data-testid=composite-add]').length");
  ok('H-04：力学页没有 composite-add', compositeBeam === 0, `实际 ${compositeBeam} 个`);

  await go('#/lab/t/A3');
  await sleepFor("document.querySelectorAll('[data-testid=param-row]').length > 0", 'A3 装配态');
  const compositeCircuit = await evaluate("document.querySelectorAll('[data-testid=composite-add]').length");
  ok('H-04：电路页仍有 composite-add', compositeCircuit > 0, `实际 ${compositeCircuit} 个`);
  console.log(`族隔离：力学 composite-add=${compositeBeam}，电路 composite-add=${compositeCircuit}`);
}

/* ── ⑤ 两个出口 + ⑥ 单一徽标（端到端：#/solve → 装配台） ──────── */
{
  await go('#/solve');
  await sleep(400);
  const goButtons = await evaluate(`(() => {
    const list = [...document.querySelectorAll('[data-testid^="go-"]')].map((el) => ({
      testid: el.getAttribute('data-testid'),
      text: el.innerText.replace(/\\s+/g, ' ').trim(),
    }));
    return list;
  })()`);
  ok('N-01：#/solve 前进键恰好 2 个', goButtons.length === 2, JSON.stringify(goButtons));
  ok(
    'N-01：主「看结构 →」、次「看讲解 →」',
    goButtons.some((item) => item.text.startsWith('看结构')) && goButtons.some((item) => item.text.startsWith('看讲解')),
    JSON.stringify(goButtons),
  );
  ok('N-01：底部重复的「开始拆解」已删', !(await evaluate("document.body.innerText.includes('开始拆解 →')")));

  await evaluate("document.querySelector('[data-testid=solve-example-0]')?.click()");
  await sleepFor("document.querySelector('[data-testid=draft-table]') !== null", '待确认表');
  const rows = await evaluate(`(() => {
    const table = document.querySelector('[data-testid=draft-table]');
    if (!table) return null;
    const headers = [...table.querySelectorAll('th')].map((th) => th.innerText.trim());
    const bodyRows = table.querySelectorAll('tbody tr').length;
    return { headers, bodyRows, tables: document.querySelectorAll('[data-testid=draft-table]').length };
  })()`);
  ok(
    'N-02：只剩一张表，四列（参数 / 值 / 单位 / 来源）',
    rows?.tables === 1 && ['参数', '值', '单位', '来源'].every((head) => rows.headers.includes(head)),
    JSON.stringify(rows?.headers),
  );

  await evaluate("document.querySelector('[data-testid=go-lab-structure]')?.click()");
  await sleepFor("document.querySelector('[data-testid=badge-source]') !== null", '来源徽标');
  const badges = await evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-testid^="badge-"]')].map((el) => ({
      testid: el.getAttribute('data-testid'),
      text: el.innerText.replace(/\\s+/g, ' ').trim(),
      source: el.getAttribute('data-source'),
    }));
    return { count: all.length, all, hash: location.hash.slice(0, 24) };
  })()`);
  ok('N-03：来源徽标只有 1 枚', badges?.count === 1, JSON.stringify(badges?.all));
  ok('N-03：徽标写明「来自题面（链接载入）· 结构与参数可改」', /来自题面（链接载入）· 结构与参数可改/.test(badges?.all?.[0]?.text ?? ''), JSON.stringify(badges?.all));
  console.log(`N-01/N-03：${goButtons.map((item) => item.text).join(' | ')} → ${badges?.all?.[0]?.text}`);
}

/* ── H-12：不适用卡文案两两不同（13 型 / 逐型专属） ────────────── */
{
  const ids = Object.keys(NOT_APPLICABLE);
  const reasons = ids.map((id) => NOT_APPLICABLE[id].reason);
  const unique = new Set(reasons);
  ok('H-12：不适用卡条数 = 去重后条数', unique.size === reasons.length, `${reasons.length} 条里只有 ${unique.size} 条不同`);
  ok('H-12：条数与账本一致（29 − 16 = 13）', ids.length === 13, `实际 ${ids.length} 条`);
  ok(
    'H-12：每条都写了属于这一型的东西（≥24 字且含本型 id 或特征词）',
    ids.every((id, index) => reasons[index].length >= 24 && (reasons[index].includes(id) || reasons[index].includes(NOT_APPLICABLE[id].token))),
    '有文案是通用句 / 没提本型特征',
  );
  console.log(`H-12 不适用卡：${reasons.length} 型，去重后 ${unique.size} 条，全部逐型专属`);
}

/* ── 源码哨兵（防止界面被判据替代） ───────────────────────────── */
{
  const solveSource = readFileSync(join(root, 'src', 'pages', 'Solve.tsx'), 'utf8');
  ok('源码：#/solve 里 data-testid^=go- 只有 2 处', (solveSource.match(/data-testid="go-/g) ?? []).length === 2);
  const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok('源码：Lab 只有一个 badge- 徽标', (labSource.match(/data-testid="badge-/g) ?? []).length === 1);
  ok('源码：左栏带 overflow-x-hidden（N-04）', /overflow-x-hidden/.test(labSource));
  ok('源码：tooltip 用半角括号（H-14）', labSource.includes('title="撤销 (Ctrl+Z)"') && labSource.includes('title="重做 (Ctrl+Shift+Z)"'));
  console.log('源码哨兵：go- 2 处 / badge- 1 处 / overflow-x-hidden / 半角 tooltip');
}

/* ── ⑨ W21-B B4 / B6：角色标签默认收起、外壳布局不再互相压 ───── */
{
  await go('#/lab/t/A6');
  await sleepFor("document.querySelectorAll('[data-testid=device-row]').length > 0", 'A6 器件行');
  const before = await evaluate(`document.querySelectorAll('[data-testid=role-chips]').length`);
  ok('B4：A6 左栏角色标签默认不可见', before === 0, `默认就有 ${before} 组`);
  const clicked = await evaluate(`(() => {
    const btn = document.querySelector('[data-testid=device-row] button[title="选中这一行"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const after = await evaluate(`(() => {
    const chips = [...document.querySelectorAll('[data-testid=role-chips]')];
    return { count: chips.length, unknown: chips.some((c) => c.innerText.includes('unknown 未标')) };
  })()`);
  ok('B4：选中器件后才展开角色标签，且不显示「unknown 未标」', clicked && after.count >= 1 && after.unknown === false, JSON.stringify({ clicked, ...after }));
}

{
  const lab = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'src', 'ui', 'ParamPanel.tsx'), 'utf8');
  const home = readFileSync(join(root, 'src', 'pages', 'Home.tsx'), 'utf8');
  const result = readFileSync(join(root, 'src', 'pages', 'Result.tsx'), 'utf8');
  ok('B4 源码：角色标签按选中态条件渲染且过滤 unknown', /selectedIds\.includes\(device\.id\)/.test(lab) && /option\.value !== 'unknown'/.test(lab), '条件 / 过滤被拆掉了');
  ok('B6：「全部恢复默认」不再与「参数实验场」小标题同排', /flex flex-col items-stretch/.test(panel) && /reset-all-params/.test(panel), 'ParamPanel header 仍是 flex-row');
  ok('B6：默认参数键独占一行', /param-badge-defaults[\s\S]{0,120}basis-full/.test(result) && /join\(' · '\)/.test(result), 'LaPq 又挤成一行了');
  ok('B6：Hero 与 01/02/03 间距收成 64px、播放条有底部留白', /pt-16 pb-8 lg:pt-20/.test(home) && /pt-8 pb-16 sm:grid-cols-3/.test(home) && /result-page min-h-screen pb-24/.test(result), '间距 / 留白没落上');
}

/* ── ⑩ W21-C C1-2：力学页不讲电路操作（真页面文本） ─────────────── */
{
  await go('#/lab/t/M3');
  await sleepFor("document.querySelectorAll('[data-testid=param-row]').length > 0", 'M3 参数行');
  const text = await evaluate(`document.querySelector('main')?.innerText ?? ''`);
  ok('C1-2：梁页（M3）不出现「引脚」——左栏提示按 family 分支', !text.includes('引脚'), text.split('\n').filter((line) => line.includes('引脚')).slice(0, 2).join(' / ') || '干净');
  ok('C1-2：梁页左栏提示讲的是力学手势（点节点选物件 / 拖节点改布局）', text.includes('点节点选物件') && text.includes('拖节点改布局'), '提示文案没落上');
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
console.log(`PASS：${checks} 项（外壳：≤1120 统一 / 三栏 / digital 两处入口 / 族隔离 / 两个出口 / 单一徽标 / tooltip / 参数实验场 / B4 角色收起 / B6 布局 / C1-2 梁页不讲电路）`);
