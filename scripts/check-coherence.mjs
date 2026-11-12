/**
 * check:coherence（W21-A，第 37 道）—— 一条贯穿的不变式：
 *
 *   **屏幕上同时出现的标题、图、结果，必须来自同一份 {entryId, graph, params}；
 *     任何一处换源都算 bug。**
 *
 * CDP 真页面（headless Edge + 构建产物 dist），逐条：
 *  ① 默认 M3 求解后：标题 / 结果 solver 行 / 归约预览 / 确认栏同源；
 *  ② 换三种结构 → 载入悬臂 → 再求解：标题、装配画布主图、结果页主图、
 *     结果表、结论卡五处同时变成悬臂（报告 5.1 的错数形态一个都不许留）；
 *  ③ skippedCount>0 时页面不出现「六项 + structure / semantic 全部通过」，
 *     徽标 / 结论横幅 / 播放条页脚三处同一个口径，跳过项有独立明细；
 *  ④ M5 页面同时算出 δmax 时，文案里不许再出现「不计算变形」（报告 5.4）；
 *  ⑤ 六项表「结论」列在容器右边界内可见（报告 5.5）；
 *  ⑥ A6 结果表不出现 17 位裸浮点，validatedAt / contract 只在自检抽屉。
 *
 * 依赖前置 build。任何一条断言都是真页面 DOM 实数，不查源码凑数。
 */

import { existsSync, readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在：check:coherence 依赖前置 build');
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

const PORT = 5198;
const CDP = 9354;
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const candidate = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(dist, 'index.html');
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
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));

const profile = mkdtempSync(join(tmpdir(), 'coherence-'));
const browser = spawn(
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, '--window-size=1500,1100', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50; i += 1) {
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
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable');
await send('Runtime.enable');

async function waitFor(expression, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await evaluate(expression)) return true;
    await sleep(200);
  }
  ok(`等待 ${label}`, false, '超时');
  return false;
}

const go = async (hash) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/about:blank` });
  await sleep(150);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` });
  await waitFor("document.querySelectorAll('[data-testid=param-row]').length > 0", hash);
  await sleep(400);
};
/** ⑧⑨ 用：非装配页（首页 / 关于）没有 param-row，等各自的就绪标记。 */
const gotoPage = async (hash, readyExpr) => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/about:blank` });
  await sleep(150);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${hash}` });
  await sleep(700);
  await waitFor(readyExpr, `页面就绪 ${hash}`);
  await sleep(300);
};
const confirmAll = () =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid=param-row]')];
    for (const row of rows) {
      const box = row.querySelector('input[type=checkbox]');
      if (box && !box.checked) box.click();
    }
    return rows.length;
  })()`);
const solve = async () => {
  await evaluate("document.querySelector('[data-testid=solve-button]')?.click()");
  await waitFor("document.querySelector('.print-result') !== null", '结果表出现');
  await sleep(600);
};

/** 一屏的「同源证据」：标题 / 画布 / 结果 / 参数 / 口径 / 表格 / 数值。 */
const snapshot = () =>
  evaluate(`(() => {
    const main = document.querySelector('main');
    const all = main ? main.innerText : '';
    const rowValues = Object.fromEntries(
      [...document.querySelectorAll('[data-testid=param-row]')].map((r) => [
        r.getAttribute('data-param'),
        Number(r.querySelector('input[type=number]')?.value),
      ]),
    );
    const resultTable = document.querySelector('.print-result')?.innerText ?? '';
    // 装配台画布与结果页主图都有 data-spec-id="main"：两处都要是同一道题的图。
    const canvasText = [...document.querySelectorAll('[data-spec-id="main"]')]
      .map((el) => String(el.textContent ?? ''))
      .join(' | ')
      .slice(0, 600);
    const cards = [...document.querySelectorAll('[data-testid=measure-headline]')].map((n) => n.innerText);
    const conclusionCells = [...document.querySelectorAll('[data-testid=matrix-conclusion]')];
    const host = document.querySelector('[data-testid=matrix-table]');
    const hostRight = host?.getBoundingClientRect().right ?? 0;
    return {
      hash: location.hash,
      entryId: document.querySelector('.id-mono')?.innerText ?? '',
      solverLine: (all.match(/solver: [^\\n]*/) ?? [''])[0],
      paramsLine: (all.match(/params：[^\\n]*/) ?? [''])[0],
      rowValues,
      resultTable,
      canvasText,
      cards,
      badge: document.querySelector('[data-tone]')?.innerText ?? '',
      banner: document.querySelector('[data-testid=conclusion-banner]')?.innerText ?? '',
      player: document.querySelector('[data-testid=player-summary]')?.innerText ?? '',
      skippedSummary: document.querySelector('[data-testid=skipped-details]')?.innerText ?? '',
      noDeform: all.includes('不计算变形'),
      sixAllPass: all.includes('六项 + structure / semantic 全部通过') || all.includes('六项全部通过'),
      conclusionCount: conclusionCells.length,
      conclusionVisible:
        conclusionCells.length > 0 &&
        conclusionCells.every((cell) => cell.getBoundingClientRect().right <= hostRight + 1),
      numericTokens: (resultTable.match(/-?\d+(?:\.\d+)?/g) ?? []),
      // C0-2：屏幕结果表单独取 —— 它和打印稿是同一个 DataPanel，但断言各自成立，
      // 屏幕格式化路径（formatDisplayValue）一变宽，这条立刻红。
      screenTable: document.querySelector('[data-testid=result-table]')?.innerText ?? '',
      hasValidatedAt: all.includes('validatedAt:'),
      hasSelfCheck: Boolean(document.querySelector('[data-testid=self-check]')),
    };
  })()`);

const previewPairs = (line) =>
  Object.fromEntries(
    [...line.matchAll(/([A-Za-z_]\w*)=(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g)].map((m) => [m[1], Number(m[2])]),
  );

/* ── ① 默认 M3：同源基线 ───────────────────────────────────────── */
await go('#/lab/t/M3');
const gate = await evaluate(`(() => ({
  disabled: document.querySelector('[data-testid=solve-button]')?.disabled,
  note: document.querySelector('[data-testid=confirm-gate-note]')?.innerText ?? '',
}))()`);
ok('① 未逐项确认时「分步求解」禁用且有红字', gate.disabled === true && /还有 \d+ 项没确认/.test(gate.note), JSON.stringify(gate));
await confirmAll();
await solve();
const m3 = await snapshot();
ok('① 标题 entryId = M3，结果页 solver 行也是 M3', m3.entryId === 'M3' && m3.solverLine.includes('solver: M3'), `${m3.entryId} / ${m3.solverLine}`);
const m3Pairs = previewPairs(m3.paramsLine);
ok(
  '① 归约预览 params 与确认栏逐键一致（同一份 params）',
  Object.keys(m3Pairs).length === 4 && Object.entries(m3Pairs).every(([key, value]) => m3.rowValues[key] === value),
  `预览 ${m3.paramsLine} · 确认栏 ${JSON.stringify(m3.rowValues)}`,
);
ok('① 简支结果表与图一致（RA=10 / RB=10 / Mmax=20）', /RA\n10/.test(m3.resultTable) && /RB\n10/.test(m3.resultTable) && /Mmax\n20/.test(m3.resultTable), m3.resultTable.replace(/\n/g, ' ').slice(0, 120));
ok('① 画布主图与结果页主图都是简支（固定铰 + 可动铰）', m3.canvasText.includes('固定铰') && m3.canvasText.includes('可动铰'), m3.canvasText.slice(0, 120));

/* ── ② 换结构 → 悬臂 → 再求解：五处同源 ──────────────────────────── */
await evaluate("document.querySelector('[data-testid=candidates-button]')?.click()");
await waitFor("document.querySelector('[data-testid=candidate-panel]') !== null", '候选面板');
await evaluate(`(() => {
  const card = [...document.querySelectorAll('[data-testid=candidate-card]')].find((c) => c.getAttribute('data-candidate') === 'M3-CANT');
  card?.querySelector('[data-testid=load-candidate]')?.click();
  return Boolean(card);
})()`);
await waitFor("document.querySelector('.id-mono')?.innerText === 'M3-cantilever'", '换结构路由');
await sleep(500);
const cleared = await evaluate(`(() => ({
  result: Boolean(document.querySelector('.print-result')),
  badge: Boolean(document.querySelector('[data-testid=param-badge]')),
}))()`);
ok('② 载入候选后旧结果 / 旧校验章已清空', cleared.result === false && cleared.badge === false, JSON.stringify(cleared));
await confirmAll();
await solve();
const cant = await snapshot();
ok('② 标题 / 结果 solver 行同为 M3-cantilever', cant.entryId === 'M3-cantilever' && cant.solverLine.includes('solver: M3-cantilever'), `${cant.entryId} / ${cant.solverLine}`);
ok('② 结果表是悬臂（MA=10 / Mmax=10 / x=0）', /MA\n10/.test(cant.resultTable) && /Mmax\n10/.test(cant.resultTable) && /MmaxX\n0/.test(cant.resultTable) && cant.resultTable.includes('@ x=0.000 m'), cant.resultTable.replace(/\n/g, ' ').slice(0, 160));
ok('② 主图是悬臂（固定端，没有可动铰）', cant.canvasText.includes('固定端') && !cant.canvasText.includes('可动铰'), cant.canvasText.slice(0, 160));
ok('② 结论卡按图给出 |M|max=10 @ x=0', cant.cards.some((line) => /\|M\|max = 10(?: |$)/.test(line) && /x = 0/.test(line)), JSON.stringify(cant.cards));
const cantPairs = previewPairs(cant.paramsLine);
ok('② 归约预览与确认栏逐键一致（L=2/a=1/P=10/q=0）', cantPairs.L === 2 && cantPairs.a === 1 && cantPairs.P === 10 && cantPairs.q === 0 && Object.entries(cantPairs).every(([key, value]) => cant.rowValues[key] === value), `${cant.paramsLine} · ${JSON.stringify(cant.rowValues)}`);
ok('② 旧模板的简支数一个都不留', !/RA\n5/.test(cant.resultTable) && !/RB\n5/.test(cant.resultTable) && !cant.canvasText.includes('R_A = 5.00'), cant.resultTable.replace(/\n/g, ' ').slice(0, 120));

/* ── ③ 口径：跳过不记通过、三处一个说法、结论列可见 ───────────────── */
ok('③ skippedCount>0 时页面没有「六项全部通过」字样', cant.sixAllPass === false, '仍出现六项全部通过');
const summary = (text) => (text.match(/\d+ 通过 · \d+ 跳过/) ?? [''])[0];
ok('③ 徽标 / 结论横幅 / 播放条页脚同一个口径', Boolean(summary(cant.badge)) && summary(cant.badge) === summary(cant.banner) && summary(cant.banner) === summary(cant.player), `${cant.badge} | ${cant.banner} | ${cant.player}`);
ok('③ 跳过项有独立明细入口', cant.skippedSummary.includes('跳过'), cant.skippedSummary);
ok('③ 六项表结论列完整可见', cant.conclusionCount > 0 && cant.conclusionVisible === true, `count=${cant.conclusionCount} visible=${cant.conclusionVisible}`);

/* ── ④ M5 文案按能力分支 ─────────────────────────────────────────── */
await go('#/lab/t/M5');
await confirmAll();
await solve();
const m5 = await snapshot();
ok('④ M5 算出 δmax 时页面不再写「不计算变形」', m5.noDeform === false, '仍出现「不计算变形」');
ok('④ M5 结论卡确实给出挠度', m5.cards.some((line) => line.includes('δmax')), JSON.stringify(m5.cards));

/* ── ⑤ 裸浮点与研发信息 ─────────────────────────────────────────── */
await go('#/lab/t/A6');
await confirmAll();
await solve();
const a6 = await snapshot();
const significantDigits = (token) =>
  token.replace(/^[+-]/, '').replace(/\./, '').replace(/^0+/, '').length;
// C0-2 拆两条：屏幕结果表（[data-testid=result-table]）与打印稿各自 ≤6 位有效数字。
const screenMaxSig = Math.max(0, ...(a6.screenTable.match(/-?\d+(?:\.\d+)?/g) ?? []).map(significantDigits));
ok('⑤ A6 屏幕结果表每个数最多 6 位有效数字（无 17 位裸浮点）', a6.screenTable.length > 0 && screenMaxSig <= 6, `最长 ${screenMaxSig} 位：${a6.screenTable.replace(/\n/g, ' ').slice(0, 160)}`);
const printMaxSig = Math.max(0, ...(a6.numericTokens.map(significantDigits)));
ok('⑤ 打印稿结果表每个数最多 6 位有效数字', printMaxSig <= 6, `最长 ${printMaxSig} 位：${a6.resultTable.replace(/\n/g, ' ').slice(0, 160)}`);
ok('⑤ validatedAt / contract 移出主面板，完整精度在自检抽屉', a6.hasValidatedAt === false && a6.hasSelfCheck === true, `validatedAt=${a6.hasValidatedAt} selfCheck=${a6.hasSelfCheck}`);

/* ── ⑥ W21-B B2：打印稿 DOM（只切媒体，绝不真点 window.print） ────── */
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/about:blank` });
await sleep(150);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#/t/M3` });
await waitFor("document.querySelector('.print-result') !== null", '结果页打印稿');
await send('Emulation.setEmulatedMedia', { media: 'print' });
await sleep(250);
const sheet = await evaluate(`(() => {
  const disp = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display : 'missing';
  };
  const noPrint = [...document.querySelectorAll('.no-print')];
  const printOnly = [...document.querySelectorAll('.print-only')];
  return {
    meta: disp('.print-meta'),
    given: disp('.print-given'),
    footer: disp('.print-footer'),
    noPrintHidden: noPrint.length > 0 && noPrint.every((el) => getComputedStyle(el).display === 'none'),
    printOnlyVisible: printOnly.filter((el) => getComputedStyle(el).display !== 'none').length,
    text: document.body.innerText.slice(0, 400),
    hasHeader: document.body.innerText.includes('拆解台'),
    givenText: document.querySelector('.print-given')?.innerText ?? '',
    resultText: document.querySelector('.print-result')?.innerText ?? '',
    buttons: [...document.querySelectorAll('[data-testid=print-button]')].map((b) => b.innerText),
    pdfButtons: [...document.querySelectorAll('button')].map((b) => b.innerText).filter((t) => t.includes('PDF')),
  };
})()`);
await send('Emulation.setEmulatedMedia', { media: 'screen' });
ok('⑥ print 媒体下打印稿可见、屏幕交互层隐藏', sheet.meta !== 'none' && sheet.meta !== 'missing' && sheet.given !== 'none' && sheet.given !== 'missing' && sheet.footer !== 'none' && sheet.noPrintHidden === true && sheet.printOnlyVisible >= 3, JSON.stringify({ meta: sheet.meta, given: sheet.given, footer: sheet.footer, noPrintHidden: sheet.noPrintHidden, printOnlyVisible: sheet.printOnlyVisible }));
ok('⑥ 打印稿含页眉 / 已知量 / 结果文字', sheet.hasHeader === true && sheet.givenText.length > 0 && sheet.resultText.length > 0, `header=${sheet.hasHeader} given=${sheet.givenText.slice(0, 60)} result=${sheet.resultText.slice(0, 60)}`);
ok('⑥ 按钮改叫「打印 / 另存 PDF」，页面不再有「导出 PDF」', sheet.buttons.length >= 1 && sheet.buttons.every((t) => t.includes('打印 / 另存 PDF')) && sheet.pdfButtons.every((t) => !t.includes('导出 PDF')), JSON.stringify(sheet.pdfButtons));
// C0-2：print 媒体下的打印稿也钉一次（与 ⑤ 的屏幕表互为独立证据）。
const sheetMaxSig = Math.max(0, ...(sheet.resultText.match(/-?\d+(?:\.\d+)?/g) ?? []).map(significantDigits));
ok('⑥ print 媒体下打印稿结果 ≤6 位有效数字', sheetMaxSig <= 6, `最长 ${sheetMaxSig} 位：${sheet.resultText.replace(/\n/g, ' ').slice(0, 120)}`);

/* ── ⑦ W21-C C0-1/C0-3：画布够大（可量化）+ 恒零图做全（真页面几何） ── */
await go('#/lab/t/M3');
await confirmAll();
await solve();
const b1 = await evaluate(`(() => {
  const svg = document.querySelector('[data-spec-id="main"] svg[role="img"]');
  const vb = (svg?.getAttribute('viewBox') ?? '').split(/\\s+/).map(Number);
  const frame = svg?.closest('[data-spec-id="main"]');
  const frameRect = frame?.getBoundingClientRect();
  // 主梁像素宽：画布里最宽的 edge（M3 主梁必然是最长的一条水平路径）。
  let beamPx = 0;
  for (const g of document.querySelectorAll('[data-edge-id]')) {
    const r = g.getBoundingClientRect();
    if (r.width > beamPx) beamPx = r.width;
  }
  const all = document.querySelector('main')?.innerText ?? '';
  return {
    ratio: vb.length === 4 && vb[3] > 0 ? vb[2] / vb[3] : 0,
    viewBox: svg?.getAttribute('viewBox') ?? '',
    frameW: frameRect?.width ?? 0,
    beamPx,
    // C0-3：恒零面板不再渲染轴（无 <g data-panel=n>），改出一行灰字。
    axialAxisRendered: Boolean(document.querySelector('g[data-panel="n"]')),
    panelDebug: [...document.querySelectorAll('[data-panel]')].map((el) => {
      const id = el.getAttribute('data-panel');
      const svg = el.closest('svg') ? el.closest('svg').getAttribute('aria-label') : '?';
      return id + '@' + svg;
    }),
    flatZeroNote: document.querySelector('[data-testid=flat-zero-note]')?.textContent ?? '',
    // C0-3 验收原话：M3 无均布载荷时不得出现剪力图空轴 —— 有剪力的题剪力面板必须在。
    shearAxisRendered: Boolean(document.querySelector('[data-panel="q"]')),
  };
})()`);
ok('⑦ freebody 主图按宽扁比例 fit-to-content', b1.ratio >= 1.9, `viewBox 比例 ${b1.ratio.toFixed(2)}（${b1.viewBox}）`);
ok('⑦ 主梁像素宽 ≥ 容器宽 × 0.72 且 ≥ 520px（C0-1 验收，不许再「看着还行」）', b1.frameW > 0 && b1.beamPx >= b1.frameW * 0.72 && b1.beamPx >= 520, `主梁 ${Math.round(b1.beamPx)}px / 容器 ${Math.round(b1.frameW)}px（比值 ${(b1.beamPx / Math.max(b1.frameW, 1)).toFixed(2)}）`);
ok('⑦ 恒零轴力不渲染空轴，出一行灰字「本图该内力恒为 0」', b1.axialAxisRendered === false && b1.flatZeroNote.includes('本图该内力恒为 0'), `axis=${b1.axialAxisRendered} note=「${b1.flatZeroNote.slice(0, 60)}」 panels=${(b1.panelDebug ?? []).join(' ')}`);
ok('⑦ M3 有集中力：剪力面板照画，不是空轴', b1.shearAxisRendered === true, '剪力面板 [data-panel=q] 没渲染');

/* ── ⑧ W21-C C1-1：梁页不讲「等效电路」+ About 页不再漏内部名 ────── */
{
  const beamText = await evaluate(`document.querySelector('main')?.innerText ?? ''`);
  ok('⑧ 梁页（M3）不出现「等效电路」（F/N 档文案按 family 分支）', !beamText.includes('等效电路'), beamText.split('\n').filter((line) => line.includes('等效电路')).slice(0, 2).join(' / ') || '干净');
  await gotoPage('#/', "document.querySelector('textarea') !== null");
  const homeText = await evaluate(`document.querySelector('main')?.innerText ?? document.body.innerText`);
  const libHits = (homeText.match(/.{0,10}库.{0,10}/g) ?? []).filter((one) => !/题库|素材库|词库|数据库|仓库|样例库|求解内核/.test(one));
ok('⑧ 首页不出现裸「库」与 check:mech-parity', libHits.length === 0 && !homeText.includes('check:mech-parity'), JSON.stringify(libHits.slice(0, 5)));
  await gotoPage('#/about', "document.querySelector('[data-testid=about-prime]') !== null");
  const aboutText = await evaluate(`document.body.innerText`);
  ok('⑧ 关于页「库」→「求解内核」，mech-parity 命令名移出可见文案', !aboutText.includes('dsh-mech-workbench') && !aboutText.includes('check:mech-parity') && aboutText.includes('求解内核'), '关于页仍漏内部名');
}

/* ── ⑨ W21-C C1-4：可访问性三条 DOM 断言（M3 / A6 / 首页 / 关于页） ── */
{
  const collect = () =>
    evaluate(`(() => {
      const items = [];
      for (const el of document.querySelectorAll('button, a, input, select, [role=slider], [role=button], textarea')) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const label = el.getAttribute('aria-label') ?? '';
        // select 的 innerText 是全部 option 拼接（会把名字撑到几百字），可访问名只认 label/关联。
        const text = el.tagName === 'SELECT' ? '' : (el.innerText ?? el.textContent ?? '').trim();
        const named = label || text || el.getAttribute('aria-labelledby') || '';
        items.push({ tag: el.tagName.toLowerCase(), label, textLen: text.length, named, namedLen: named.length, emptyAria: el.hasAttribute('aria-label') && (el.getAttribute('aria-label') ?? '').trim() === '' });
      }
      return items;
    })()`);
  const pages = [
    ['#/', "document.querySelector('textarea') !== null"],
    ['#/about', "document.querySelector('[data-testid=about-prime]') !== null"],
    ['#/lab/t/M3', "document.querySelectorAll('[data-testid=param-row]').length > 0"],
    ['#/lab/t/A6', "document.querySelectorAll('[data-testid=param-row]').length > 0"],
  ];
  const offenders = { empty: [], dup: [], long: [] };
  for (const [hash, readyExpr] of pages) {
    await gotoPage(hash, readyExpr);
    const items = await collect();
    for (const item of items) {
      const where = `${hash} ${item.tag}`;
      // 空 aria-label：显式写了 aria-label 但内容是空串（没写的不管）
      if (item.emptyAria) offenders.empty.push(where);
      if (item.namedLen > 80) offenders.long.push(`${where}(${item.namedLen}字)`);
    }
    // 重复 accessible name：同名可交互元素 >1（同页同名按钮读屏无法区分）
    const seen = new Map();
    for (const item of items) {
      if (!item.named || item.namedLen === 0) continue;
      seen.set(item.named, (seen.get(item.named) ?? 0) + 1);
    }
    for (const [name, count] of seen) if (count > 1) offenders.dup.push(`${hash}「${name.slice(0, 24)}」×${count}`);
  }
  ok('⑨ 无空 aria-label（aria-label="" 不允许）', offenders.empty.length === 0, offenders.empty.slice(0, 4).join(' | ') || '干净');
  ok('⑨ 无重复 accessible name（同页同名可交互元素不重叠）', offenders.dup.length === 0, offenders.dup.slice(0, 4).join(' | ') || '干净');
  ok('⑨ 无超长 accessible name（>80 字的可访问名不存在）', offenders.long.length === 0, offenders.long.slice(0, 4).join(' | ') || '干净');
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
console.log(`PASS：${checks} 项（A 批同源与口径 / B 批画布 fit、打印稿 / C0 画布尺寸·屏幕表·恒零做全 / C1 内部名·a11y）`);
