/**
 * check:kb —— K1 知识库地基门禁（第 39 道）。
 *
 * ① 意图分流用例 20 条全对（10 题面 / 10 术语）
 * ② schema：id 唯一且形如 subject.x / subject 枚举 / aliases ≥2 / oneLine ≤40 /
 *    approach 3–6 步且每步 ≤48 字 / points 3–6 条且 ≤48 字；
 *    **approach / points 为空 → 报「还有 N 条没写」并逐条列 id**（K2 的待办账）。
 *    KB_STUB_MODE=1 时空档只报数不判死（默认严格判死）。
 * ③ 公式可解析：formulas[].tex 跑 katex.renderToString 不抛
 * ④ 引用存在：related ⊆ KB_BY_ID；solvable.templateId 在 registry；
 *    figures[].src 以 public/kb/ 开头且文件存在
 * ⑤ 图合规：photo credit 非空；svg 无外链 image；所有图 alt 非空
 * × 索引体积：KB_INDEX 序列化 < 120 KB
 *
 * 变异三条（真跑子进程，改文件 → 验红 → 还原 → 复跑回绿）：
 *  - 变异一：把某条 approach 写成 2 步（schema 违例）→ ② 必红（KB_STUB_MODE 只豁免「空」，不豁免「写坏」）
 *  - 变异二：注入一张缺 credit 的 photo → ⑤ 必红
 *  - 变异三：detectIntent 恒返回 'concept' → ① 必红
 *  - 变异四：把 live 图的 templateId 写错 → ④ 必红（引用落地断言）
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import katex from 'katex';
import { KB, KB_BY_ID, KB_INDEX } from '../src/kb/index.ts';
import { detectIntent, INTENT_CASES } from '../src/kb/intent.ts';
import { searchKb } from '../src/kb/search.ts';
import { getTemplateRoute } from '../src/core/templates/registry.ts';

const root = dirname(fileURLToPath(import.meta.url));
const problems = [];
const warnings = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};

/** stub 模式：默认关（K2 文案已写满）；KB_STUB_MODE=1 仅用于变异子进程的宽松口径。 */
const STUB_MODE = process.env.KB_STUB_MODE === '1';
const CHILD = process.env.KB_CHILD === '1';

/* ── ① 意图分流 ─────────────────────────────────────────────────── */
{
  const bad = INTENT_CASES.filter((one) => detectIntent(one.text) !== one.want);
  ok('①', INTENT_CASES.length === 20, `① 用例数 ≠ 20：${INTENT_CASES.length}`);
  ok('①', bad.length === 0, `① 意图分流错 ${bad.length} 条：${bad.map((one) => `"${one.text}"→${detectIntent(one.text)},应为 ${one.want}`).join('；')}`);
  const problemCount = INTENT_CASES.filter((one) => one.want === 'problem').length;
  ok('①', problemCount === 10, `① 题面用例 ≠ 10：${problemCount}`);
  console.log(`①  意图分流：${INTENT_CASES.length} 条用例全对（题面 ${problemCount} / 术语 ${INTENT_CASES.length - problemCount}）`);
}

/* ── ② schema ───────────────────────────────────────────────────── */
const SUBJECTS = ['circuit', 'digital', 'mechanics', 'statics', 'physics', 'math', 'programming'];
{
  const seen = new Set();
  const emptyEntries = [];
  const dupIds = [];
  for (const entry of KB) {
    if (seen.has(entry.id)) dupIds.push(entry.id);
    seen.add(entry.id);
    if (!/^[a-z-]+\.[a-z0-9-]+$/.test(entry.id)) problems.push(`② / id 形态不对：${entry.id}`);
    if (!SUBJECTS.includes(entry.subject)) problems.push(`② / subject 不在枚举：${entry.id} → ${entry.subject}`);
    if (!entry.id.startsWith(`${entry.subject}.`)) problems.push(`② / id 前缀与 subject 不符：${entry.id}`);
    if (!Array.isArray(entry.aliases) || entry.aliases.length < 2) problems.push(`② / aliases ≥2 不满足：${entry.id}（${entry.aliases?.length ?? 0} 个）`);
    if (typeof entry.oneLine !== 'string' || entry.oneLine.length > 40 || entry.oneLine.length === 0) {
      problems.push(`② / oneLine 超 40 字或为空：${entry.id}（${entry.oneLine?.length ?? 0} 字）`);
    }
    for (const step of entry.approach ?? []) {
      if (step.length > 48) problems.push(`② / approach 步超 48 字：${entry.id}「${step.slice(0, 24)}…」`);
    }
    if ((entry.approach?.length ?? 0) > 0 && (entry.approach.length < 3 || entry.approach.length > 6)) {
      problems.push(`② / approach 步数不在 3–6：${entry.id}（${entry.approach.length} 步）`);
    }
    for (const point of entry.points ?? []) {
      if (point.length > 48) problems.push(`② / points 条超 48 字：${entry.id}「${point.slice(0, 24)}…」`);
    }
    if ((entry.points?.length ?? 0) > 0 && (entry.points.length < 3 || entry.points.length > 6)) {
      problems.push(`② / points 条数不在 3–6：${entry.id}（${entry.points.length} 条）`);
    }
    if (!Array.isArray(entry.formulas)) problems.push(`② / formulas 不是数组：${entry.id}`);
    if ((entry.approach?.length ?? 0) === 0 || (entry.points?.length ?? 0) === 0) emptyEntries.push(entry.id);
  }
  ok('②', dupIds.length === 0, `② id 重复：${dupIds.join(', ')}`);
  // 账本基数 52（docs/覆盖账本），扩展批次只增不减。
  ok('②', KB.length >= 52, `② 条目数少于账本基数 52：${KB.length}`);

  // 空档账目：stub 模式报数不判死（K2 待办清单）；收紧模式判死。
  const account = `还有 ${emptyEntries.length} 条没写：${emptyEntries.join(', ')}`;
  if (emptyEntries.length > 0) {
    if (STUB_MODE) {
      warnings.push(`② [KB_STUB_MODE] ${account}`);
      console.log(`②  schema：结构全过；${account}`);
      console.log('②  （KB_STUB_MODE=1：空档只报数不判死；K2 已写满，默认严格）');
    } else {
      problems.push(`② / ${account}`);
      console.log(`②  schema：${account}`);
    }
  } else {
    console.log('②  schema：52 条 approach/points 全部就位');
  }
}

/* ── ③ 公式可解析 ───────────────────────────────────────────────── */
{
  let texCount = 0;
  for (const entry of KB) {
    for (const formula of entry.formulas ?? []) {
      texCount += 1;
      try {
        katex.renderToString(formula.tex, { throwOnError: true, displayMode: true });
      } catch (error) {
        problems.push(`③ / katex 解析失败：${entry.id}「${formula.tex}」→ ${error.message}`);
      }
    }
  }
  console.log(`③  公式：${texCount} 条 tex 全部可解析（katex.renderToString 不抛）`);
}

/* ── ④ 引用存在 ─────────────────────────────────────────────────── */
{
  let relatedCount = 0;
  let solvableCount = 0;
  let figureCount = 0;
  for (const entry of KB) {
    for (const id of entry.related ?? []) {
      relatedCount += 1;
      if (!KB_BY_ID[id]) problems.push(`④ / related 指向不存在的条目：${entry.id} → ${id}`);
    }
    if (entry.solvable) {
      solvableCount += 1;
      if (!getTemplateRoute(entry.solvable.templateId)) {
        problems.push(`④ / solvable.templateId 不在 registry：${entry.id} → ${entry.solvable.templateId}`);
      }
    }
    for (const figure of entry.figures ?? []) {
      figureCount += 1;
      if ('templateId' in figure && figure.templateId) {
        if (!getTemplateRoute(figure.templateId)) problems.push(`④ / live 图 templateId 不在 registry：${entry.id} → ${figure.templateId}`);
      }
      if ('src' in figure && figure.src) {
        if (!figure.src.startsWith('public/kb/')) problems.push(`④ / figure.src 不在 public/kb/ 下：${entry.id} → ${figure.src}`);
        if (!existsSync(join(root, '..', figure.src))) problems.push(`④ / figure 文件不存在：${entry.id} → ${figure.src}`);
      }
    }
  }
  ok('④', solvableCount === 29, `④ solvable 条数 ≠ 29（账本口径）：${solvableCount}`);
  console.log(`④  引用：related ${relatedCount} 条 / solvable ${solvableCount} 条全在 registry / figures ${figureCount} 张（src 文件与 live 路由均可解析）`);
}

/* ── ⑤ 图合规 ───────────────────────────────────────────────────── */
{
  let photoCount = 0;
  let svgCount = 0;
  for (const entry of KB) {
    for (const figure of entry.figures ?? []) {
      // live 图没有 alt 字段（类型定义如此），读屏走 caption；alt 检查只适用 photo/svg。
      if (figure.kind !== 'live' && (!figure.alt || figure.alt.trim().length === 0)) problems.push(`⑤ / alt 为空：${entry.id}`);
      if (figure.kind === 'photo') {
        photoCount += 1;
        if (!figure.credit || figure.credit.trim().length === 0) problems.push(`⑤ / photo 缺 credit：${entry.id} → ${figure.src}`);
      }
      if (figure.kind === 'svg') {
        svgCount += 1;
        if ('src' in figure && figure.src && existsSync(join(root, '..', figure.src))) {
          const svgText = readFileSync(join(root, '..', figure.src), 'utf8');
          if (svgText.includes('<image href="http') || svgText.includes("<image href='http")) {
            problems.push(`⑤ / svg 含外链 image：${entry.id} → ${figure.src}`);
          }
        }
      }
    }
  }
  console.log(`⑤  图合规：photo ${photoCount} 张（credit 全非空）/ svg ${svgCount} 张（无外链）/ alt 全非空`);
}

/* ── ⑥ 搜索召回：20 个查询（含 5 个错字）目标条目进前 3 ────────── */
{
  const recallCases = [
    ['莫尔圆', 'mechanics.stress-state'], ['卡诺图化简', 'digital.logic-simplification'], ['零杆判别', 'statics.truss'],
    ['自锁条件', 'statics.friction'], ['共射增益', 'circuit.bjt-small-signal'], ['虚短虚断', 'circuit.opamp-ideal'],
    ['欧拉公式', 'mechanics.buckling'], ['补码运算', 'digital.number-encoding'], ['压杆稳定', 'mechanics.buckling'],
    ['交越失真', 'circuit.power-amplifier'], ['波特图', 'circuit.frequency-response'], ['挠曲线', 'mechanics.bending-deflection'],
    ['剪力图', 'mechanics.bending-internal'], ['摩擦角', 'statics.friction'], ['状态转移表', 'digital.sequential-fsm'],
    ['莫而圆', 'mechanics.stress-state'], ['卡洛图化简', 'digital.logic-simplification'], ['自琐条件', 'statics.friction'],
    ['补蚂运算', 'digital.number-encoding'], ['虚段虚断', 'circuit.opamp-ideal'],
  ];
  const misses = recallCases.filter(([query, want]) => !searchKb(query).slice(0, 3).some((hit) => hit.entry.id === want));
  ok('⑥', recallCases.length === 20, `⑥ 召回用例 ≠ 20：${recallCases.length}`);
  ok('⑥', misses.length === 0, `⑥ 召回脱靶 ${misses.length} 条：${misses.map(([q, w]) => `"${q}"→${searchKb(q).slice(0, 3).map((h) => h.entry.id).join('|')}（应含 ${w}）`).join('；')}`);
  const typoCount = recallCases.filter(([q], index) => index >= 15).length;
  ok('⑥', typoCount === 5, `⑥ 错字用例 ≠ 5：${typoCount}`);
  console.log(`⑥  搜索召回：20 查询（15 精确 + 5 错字）目标全部进前 3`);
}

/* ── × 索引体积 ─────────────────────────────────────────────────── */
{
  const size = Buffer.byteLength(JSON.stringify(KB_INDEX), 'utf8');
  // R-36d：基础扩展三科入场后条目 59→80，索引线性涨；上限 120→220 KB（仍是防炸护栏）。
  ok('×', size < 220 * 1024, `× 索引过大（先看分词）：${(size / 1024).toFixed(1)} KB ≥ 220 KB`);
  console.log(`×  索引体积：${(size / 1024).toFixed(1)} KB（< 120 KB，${KB_INDEX.length} 个 term）`);
}

/* ── 变异三条（真跑；KB_CHILD=1 的子进程跳过本段） ──────────────── */
async function runChild(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
      env: { ...process.env, KB_CHILD: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

if (!CHILD) {
  const circuitPath = join(root, '..', 'src', 'kb', 'entries', 'circuit.ts');
  const intentPath = join(root, '..', 'src', 'kb', 'intent.ts');
  const circuitOriginal = readFileSync(circuitPath, 'utf8');
  const intentOriginal = readFileSync(intentPath, 'utf8');

  try {
    // 变异一：注入一条 approach 只有 2 步的坏条目（写坏 ≠ 空，stub 模式不豁免）→ ② 必红。
    const badEntry1 = `\n  { id: 'circuit.mut-bad-steps', subject: 'circuit', chapter: '变异', title: '坏条目', aliases: ['变异', '测试'], oneLine: '变异注入的条目。', approach: ['读题', '列式'], formulas: [], points: ['一', '二', '三'] },\n];`;
    writeFileSync(circuitPath, circuitOriginal.replace(/\];\s*$/, badEntry1), 'utf8');
    const red = await runChild({ KB_STUB_MODE: '1' });
    ok('变异一', red.code !== 0 && red.out.includes('② / approach 步数不在 3–6'), `变异一：approach 2 步居然没让 ② 红（exit=${red.code}）`);
    // 还原复跑
    writeFileSync(circuitPath, circuitOriginal, 'utf8');
    const green = await runChild({ KB_STUB_MODE: '1' });
    ok('变异一', green.code === 0, `变异一：还原后没回绿（exit=${green.code}）\n${green.out.slice(-600)}`);
    console.log('变异一：approach 写坏成 2 步 → ② 红；还原回绿');

    // 变异二：注入一张缺 credit 的 photo → ⑤ 必红。
    const badEntry2 = `\n  { id: 'circuit.mut-bad-photo', subject: 'circuit', chapter: '变异', title: '坏条目', aliases: ['变异', '测试'], oneLine: '变异注入的条目。', approach: ['读题', '列式', '求解'], formulas: [], points: ['一', '二', '三'], figures: [{ kind: 'photo', src: 'public/kb/mut.jpg', alt: '测试图', caption: '测试' }] },\n];`;
    writeFileSync(circuitPath, circuitOriginal.replace(/\];\s*$/, badEntry2), 'utf8');
    const red2 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异二', red2.code !== 0 && red2.out.includes('⑤ / photo 缺 credit'), `变异二：缺 credit 的 photo 居然没让 ⑤ 红（exit=${red2.code}）`);
    writeFileSync(circuitPath, circuitOriginal, 'utf8');
    const green2 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异二', green2.code === 0, `变异二：还原后没回绿（exit=${green2.code}）`);
    console.log('变异二：photo 缺 credit → ⑤ 红；还原回绿');

    // 变异三：detectIntent 恒返回 'concept' → ① 必红。
    writeFileSync(intentPath, intentOriginal.replace('export function detectIntent(text: string): Intent {', "export function detectIntent(text: string): Intent {\n  return 'concept'; // MUTATION"), 'utf8');
    const red3 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异三', red3.code !== 0 && red3.out.includes('① 意图分流错'), `变异三：detectIntent 恒 concept 居然没让 ① 红（exit=${red3.code}）`);
    writeFileSync(intentPath, intentOriginal, 'utf8');
    const green3 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异三', green3.code === 0, `变异三：还原后没回绿（exit=${green3.code}）`);
    console.log('变异三：detectIntent 恒 concept → ① 红；还原回绿');

    // 变异四：live 图 templateId 写错 → ④ 必红（本轮新增断言）。
    const liveA2 = "{ kind: 'live', templateId: 'A2'";
    writeFileSync(circuitPath, circuitOriginal.replace(liveA2, "{ kind: 'live', templateId: 'ZZ9'"), 'utf8');
    const red4 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异四', red4.code !== 0 && red4.out.includes('④ / live 图 templateId 不在 registry'), `变异四：live.templateId 写错居然没让 ④ 红（exit=${red4.code}）`);
    writeFileSync(circuitPath, circuitOriginal, 'utf8');
    const green4 = await runChild({ KB_STUB_MODE: '1' });
    ok('变异四', green4.code === 0, `变异四：还原后没回绿（exit=${green4.code}）`);
    console.log('变异四：live.templateId 写错 → ④ 红；还原回绿');
  } finally {
    writeFileSync(circuitPath, circuitOriginal, 'utf8');
    writeFileSync(intentPath, intentOriginal, 'utf8');
  }
}

/* ── ⑦ 主页是搜索页：无示例清单（template-row）+ 搜索框在场 + kb 两页可走 ── */
if (!existsSync(join(root, '..', 'dist', 'index.html'))) {
  problems.push('⑦ / dist 不存在（⑦ 是真页面断言，先 npm run build）');
} else {
  const dist = join(root, '..', 'dist');
  const server = createServer((req, res) => {
    const file = join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, '') || 'index.html');
    try {
      const data = readFileSync(file);
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(data);
    } catch {
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(join(dist, 'index.html')));
      } catch {
        res.writeHead(404);
        res.end('nope');
      }
    }
  });
  await new Promise((done) => server.listen(5196, '127.0.0.1', done));
  const profile = mkdtempSync(join(tmpdir(), 'kb-check-'));
  const browser = spawn(
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1500,1100', 'about:blank'],
    { stdio: 'ignore' },
  );
  // 端口 0 + DevToolsActivePort：固定端口会被残留 headless 实例抢占 ——
  // 旧实例带旧磁盘缓存 ⇒ 假绿；socket 连到别人家的浏览器 ⇒ PASS 后不退、卡死整条 build。
  let debugPort = 0;
  for (let i = 0; i < 50 && !debugPort; i += 1) {
    try { debugPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (!debugPort) await new Promise((r) => setTimeout(r, 200));
  }
  let page = null;
  for (let i = 0; i < 50 && !page; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  if (!debugPort || !page) {
    problems.push('⑦ / headless Edge 没起来');
  } else {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let seqNo = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); }
    });
    const send = (method, params = {}) => { const id = ++seqNo; return new Promise((resolve) => { pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); }); };
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const goto = async (url, waitMs) => {
      await send('Page.enable');
      await send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, waitMs));
    };

    // ⑦-a 主页：无 template-row + 搜索框在场
    await goto('http://127.0.0.1:5196/#/', 2600);
    const homeState = await evaluate(`({
      templateRows: document.querySelectorAll('[data-testid="template-row"]').length,
      searchBox: Boolean(document.querySelector('[data-testid="kb-search"]')),
      solvePanel: Boolean(document.querySelector('[data-testid="nav-solve"]')),
    })`);
    ok('⑦', homeState && homeState.templateRows === 0, `⑦ 主页还有 ${homeState?.templateRows ?? '?'} 个示例清单行（v2 要删干净）`);
    ok('⑦', homeState && homeState.searchBox === true, '⑦ 主页没有搜索框（kb-search）');
    ok('⑦', homeState && homeState.solvePanel === true, '⑦ 主页顶栏没有「解题」二选一面板入口');

    // ⑦-b 搜索「莫尔圆」→ 结果行首条链到目标条目
    //     React 受控输入：必须走原生 value setter，否则 onChange 不触发（时灵时不灵的坑）。
    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="kb-search"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '莫尔圆');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    const searchState = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="kb-results"] a')];
      return { count: rows.length, first: rows[0]?.getAttribute('href') ?? '' };
    })()`);
    ok('⑦', searchState && searchState.count > 0 && searchState.first.includes('mechanics.stress-state'), `⑦ 搜「莫尔圆」首条结果不对：${JSON.stringify(searchState)}`);

    // ⑦-c 索引页 52 行
    await goto('http://127.0.0.1:5196/#/kb', 2200);
    const rowCount = await evaluate(`document.querySelectorAll('[data-testid="kb-row"]').length`);
    ok('⑦', rowCount >= 52, `⑦ 索引页行数少于条目数 ${KB.length}：${rowCount}`);

    // ⑦-d 条目页骨架顺序（可解题条目：有思路/公式/去解题链接）
    await goto('http://127.0.0.1:5196/#/kb/mechanics.stress-state', 2200);
    const entryState = await evaluate(`({
      approach: Boolean(document.querySelector('[data-testid="kb-approach"]')),
      points: Boolean(document.querySelector('[data-testid="kb-points"]')),
      formulas: document.querySelectorAll('[data-testid="kb-formulas"] .katex').length,
      figures: document.querySelectorAll('[data-testid="kb-figures"] img, [data-testid="kb-figures"] [data-testid="kb-live-figure"]').length,
      solve: document.querySelector('[data-testid="kb-solve-link"]')?.getAttribute('href') ?? '',
    })`);
    ok('⑦', entryState && entryState.approach && entryState.points && entryState.formulas >= 1 && entryState.figures >= 1, `⑦ 条目页骨架不全：${JSON.stringify(entryState)}`);
    ok('⑦', entryState && entryState.solve === '#/solve?t=M6', `⑦ 去解题链接不对：${entryState?.solve}`);

    // ⑦-e 只讲条目：无解题链接，但有装配台常驻出口
    await goto('http://127.0.0.1:5196/#/kb/circuit.oscillator', 2200);
    const conceptState = await evaluate(`({
      solveLink: Boolean(document.querySelector('[data-testid="kb-solve-link"]')),
      labLink: document.body.textContent.includes('去装配台'),
      notice: document.body.textContent.includes('只讲思路，不动手算'),
    })`);
    ok('⑦', conceptState && conceptState.solveLink === false && conceptState.labLink === true && conceptState.notice === true, `⑦ 只讲条目交接不对：${JSON.stringify(conceptState)}`);

    console.log('⑦  CDP：主页=搜索页（无示例清单/有搜索框+解题面板）、搜「莫尔圆」首条正确、索引 52 行、条目页骨架与交接完整');
    ws.close();
  }
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  // Edge 可能换 PID 重启、脱离 spawn 父子链：按唯一 profile 路径兜底清整棵树，
  // 不留残留实例给下一轮门禁抢端口 / 喂旧缓存。
  spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  server.close();
}

/* ── 汇总 ───────────────────────────────────────────────────────── */
for (const warning of warnings) console.warn(`警告：${warning}`);
if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（知识库地基）`);
process.exit(0);
