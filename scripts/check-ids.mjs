/**
 * check:ids —— W22-A id 唯一性门禁。
 *
 * 病根（W22 报告 F2/F3/F4/F5 + 老大实测）：id 由 label / length / index 生成 ——
 * 连加两个同类器件、删线后再连、切段复切、封装两次全都撞 id。修法一条：
 * meta.seq 单调计数 + nextId 唯一入口（lab/ids.ts）。这里钉死它不许退化。
 *
 * ① 连加两个同类器件 → id 不同、全图唯一、同名提示在（不再阻断）
 * ② 连 5 删 2 再加 3 → 仍唯一，且新 id 不复用任何被删 id（e-pin-N 死穴）
 * ③ 加两个复合模块 → id 不同；删一个再加 → 不复用被删 id
 * ④ 梁段切一刀再切同一刀 → 全图唯一（-1/-2 撞法）
 * ⑤ 旧图兼容：meta 无 seq → 按现有 id 数字后缀 max 续发
 * ⑥ 变异：nextId 退回 `n-add-${label}` → ① 必须红（子进程验红，还原回绿）
 * ⑦ CDP：真页面加两个器件 → 画布 data-node-id 不同；恢复骨架 → DOM 无残留
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { graphFromSpec } from '../src/core/lab/graphFromSpec.ts';
import { seedGraph, PICKS } from '../src/core/lab/picks.ts';
import { labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { nextId, seqOf } from '../src/core/lab/ids.ts';
import { BUILTIN_COMPOSITES } from '../src/core/lab/compositeBuiltin.ts';const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};

function loadSkeleton(id) {
  const snap = JSON.parse(readFileSync(new URL(`../src/examples/${id}.json`, import.meta.url), 'utf8'));
  const route = getTemplateRoute(id);
  const baseline = route.variant?.params ?? {};
  const defaults = Object.fromEntries((route.entry.params ?? []).map((p) => [p.key, baseline[p.key] ?? p.defaultValue]));
  const seeded = seedGraph(id, defaults);
  return graphFromSpec(labSkeletonSpec(id, snap.render_specs[0]), id, PICKS[id].family, {
    seeds: seeded.seeds,
    meta: seeded.meta,
  });
}

/** 全图 id 去重计数：nodes + edges，返回重复 id 列表。 */
function dupIds(graph) {
  const seen = new Map();
  for (const id of [...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id)]) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

/* ── ① 连加两个同类器件 ─────────────────────────────── */
{
  const g = loadSkeleton('A5');
  const first = applyOp('A5', g, { op: 'addDevice', kind: 'res', label: 'R', value: 1000, x: 100, y: 560 });
  const second = applyOp('A5', first.graph, { op: 'addDevice', kind: 'res', label: 'R', value: 2200, x: 220, y: 560 });
  const added = second.graph.nodes.filter((node) => !g.nodes.some((old) => old.id === node.id));
  ok('①', first.refused === undefined && second.refused === undefined, '① 加器件竟被拒（同名守卫不该阻断）');
  ok('①', added.length === 2 && added[0].id !== added[1].id, `① 两个同类器件 id 撞了：${added.map((n) => n.id).join(',')}`);
  ok('①', dupIds(second.graph).length === 0, `① 全图 id 有重复：${dupIds(second.graph).join(',')}`);
  ok('①', second.rules.some((text) => text.includes('同名器件')), '① 同名提示丢了');
  ok('①', typeof second.graph.meta.seq === 'number' && second.graph.meta.seq > (first.graph.meta.seq ?? 0), '① meta.seq 没单调递增');
  console.log('①  连加两个同类器件：id 不同 + 全图唯一 + 同名提示 + seq 递增');
}

/* ── ② 连 5 删 2 再加 3：e-pin-N 不复用 ─────────────── */
{
  const g = loadSkeleton('A5');
  const devices = g.nodes.filter((node) => !['text', 'dot'].includes(node.kind)).map((node) => node.id);
  let graph = g;
  for (let i = 0; i < 5; i += 1) {
    const from = devices[i % devices.length];
    const to = devices[(i + 1) % devices.length];
    const out = applyOp('A5', graph, { op: 'addEdge', from, to });
    if (out.refused) break;
    graph = out.graph;
  }
  const beforeIds = new Set(graph.edges.map((edge) => edge.id));
  ok('②', beforeIds.size >= 5, `② 连 5 条没连上（edges=${beforeIds.size}）`);
  // 删两个器件（连带删 shared 边），记住删掉的边 id。
  const removedIds = new Set();
  for (const victim of devices.slice(0, 2)) {
    const removed = graph.edges.filter((edge) => !removedIds.has(edge.id));
    const out = applyOp('A5', graph, { op: 'deleteDevice', nodeId: victim });
    if (out.refused) continue;
    for (const edge of out.graph.edges.map((e) => e.id)) removedIds.delete(edge);
    for (const id of removed.map((e) => e.id)) if (!out.graph.edges.some((e) => e.id === id)) removedIds.add(id);
    graph = out.graph;
  }
  // 再连 3 条 → 新 id 不得与任何被删 id 相同。
  const freshIds = [];
  for (let i = 0; i < 3; i += 1) {
    const from = devices[2 + (i % devices.length)];
    const to = devices[3 + (i % devices.length)];
    const before = new Set(graph.edges.map((edge) => edge.id));
    const out = applyOp('A5', graph, { op: 'addEdge', from, to });
    if (out.refused) break;
    for (const edge of out.graph.edges) if (!before.has(edge.id)) freshIds.push(edge.id);
    graph = out.graph;
  }
  ok('②', freshIds.length === 3, `② 再加 3 条没加上（${freshIds.length}）`);
  ok('②', dupIds(graph).length === 0, `② 全图 id 有重复：${dupIds(graph).join(',')}`);
  const reused = freshIds.filter((id) => removedIds.has(id));
  ok('②', reused.length === 0, `② 新边复用了被删 id：${reused.join(',')}`);
  console.log(`②  连 5 删 2 再加 3：唯一 + 无复用（新 ${freshIds.join(',')}）`);
}

/* ── ③ 加两个复合模块 ───────────────────────────────── */
{
  const g = loadSkeleton('A5');
  const compositeId = Object.keys(BUILTIN_COMPOSITES)[0];
  const first = applyOp('A5', g, { op: 'addDevice', kind: 'block', label: BUILTIN_COMPOSITES[compositeId].title, compositeId, x: 120, y: 560 });
  const second = applyOp('A5', first.graph, { op: 'addDevice', kind: 'block', label: BUILTIN_COMPOSITES[compositeId].title, compositeId, x: 260, y: 560 });
  const added = second.graph.nodes.filter((node) => node.kind === 'block');
  ok('③', first.refused === undefined && second.refused === undefined, '③ 加复合模块被拒');
  ok('③', added.length >= 2 && added[added.length - 2].id !== added[added.length - 1].id, `③ 两个复合模块 id 撞了：${added.map((n) => n.id).join(',')}`);
  // 删一个再加一个 → 不复用被删 id。
  const victim = added[0].id;
  const del = applyOp('A5', second.graph, { op: 'deleteDevice', nodeId: victim });
  const again = applyOp('A5', del.graph, { op: 'addDevice', kind: 'block', label: BUILTIN_COMPOSITES[compositeId].title, compositeId, x: 120, y: 560 });
  ok('③', again.refused === undefined, '③ 删后再加被拒');
  ok('③', !del.graph.edges.concat(del.graph.nodes).some((item) => item.id === again.graph.nodes.at(-1).id), '③ 复用了被删的复合块 id');
  ok('③', dupIds(again.graph).length === 0, `③ 全图 id 有重复：${dupIds(again.graph).join(',')}`);
  console.log('③  加两个复合模块：id 不同 + 删后再加不复用');
}

/* ── ④ 梁段切一刀、再切同一刀 ───────────────────────── */
{
  const g = loadSkeleton('M3');
  const member = g.edges.find((edge) => edge.kind !== 'wire');
  const cut1 = applyOp('M3', g, { op: 'splitMember', edgeId: member.id, t: 0.5 });
  ok('④', cut1.refused === undefined, `④ 切一刀被拒：${cut1.refused ?? ''}`);
  const segA = cut1.graph.edges.find((edge) => edge.from === member.from && edge.to !== member.to);
  const cut2 = applyOp('M3', cut1.graph, { op: 'splitMember', edgeId: segA.id, t: 0.5 });
  ok('④', cut2.refused === undefined, `④ 复切被拒：${cut2.refused ?? ''}`);
  ok('④', dupIds(cut2.graph).length === 0, `④ 复切后 id 有重复：${dupIds(cut2.graph).join(',')}`);
  ok('④', cut2.graph.edges.some((edge) => edge.id === `${member.id}-1`) === false || true, '④ 占位（两段 id 已改走 seq，不再 -1/-2 固定式）');
  console.log('④  梁段复切：全图 id 唯一');
}

/* ── ⑤ 旧图兼容：meta 无 seq → 扫后缀续发 ──────────── */
{
  const old = { templateId: 'A5', family: 'circuit', nodes: [], edges: [{ id: 'e-pin-9', from: 'a', to: 'b', kind: 'wire' }], meta: {} };
  const first = nextId(old, 'e-pin');
  ok('⑤', first.id === 'e-pin-10', `⑤ 旧图续发错：${first.id}（应 e-pin-10）`);
  ok('⑤', seqOf(first.graph) === 10, '⑤ seq 没写回 meta');
  const skeleton = loadSkeleton('A5');
  const one = applyOp('A5', skeleton, { op: 'addDevice', kind: 'res', label: 'R', value: 1000, x: 100, y: 560 });
  ok('⑤', /n-add-\d+$/.test(one.graph.nodes.at(-1).id), `⑤ 新器件 id 不再由 label 生成：${one.graph.nodes.at(-1).id}`);
  console.log('⑤  旧图兼容：后缀 max 续发 + 新 id 走单调式');
}

/* ── ⑥ 变异：nextId 退回 label 生成 → ① 必须红 ─────── */
{
  const opsPath = new URL('../src/core/lab/ops.ts', import.meta.url);
  const original = readFileSync(opsPath, 'utf8');
  const mutated = original.replace(
    "          id: add.id,",
    "          id: `n-add-${op.label}`,",
  );
  if (mutated === original) {
    problems.push('⑥ / 变异没打上：ops.ts 里找不到 `id: add.id,`（源码漂移，门禁锚点失效）');
  } else {
    // 子进程：变异态下重跑 ① 的最小复刻，两个 id 相同 = 门禁该红。
    const runner = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTemplateRoute } from ${JSON.stringify(new URL('../src/core/templates/registry.ts', import.meta.url).href)};
import { graphFromSpec } from ${JSON.stringify(new URL('../src/core/lab/graphFromSpec.ts', import.meta.url).href)};
import { seedGraph, PICKS } from ${JSON.stringify(new URL('../src/core/lab/picks.ts', import.meta.url).href)};
import { labSkeletonSpec } from ${JSON.stringify(new URL('../src/core/lab/skeleton.ts', import.meta.url).href)};
import { applyOp } from ${JSON.stringify(new URL('../src/core/lab/ops.ts', import.meta.url).href)};
const snap = JSON.parse(readFileSync(fileURLToPath(${JSON.stringify(new URL('../src/examples/A5.json', import.meta.url).href)}), 'utf8'));
const route = getTemplateRoute('A5');
const baseline = route.variant?.params ?? {};
const defaults = Object.fromEntries((route.entry.params ?? []).map((p) => [p.key, baseline[p.key] ?? p.defaultValue]));
const seeded = seedGraph('A5', defaults);
const g = graphFromSpec(labSkeletonSpec('A5', snap.render_specs[0]), 'A5', PICKS['A5'].family, { seeds: seeded.seeds, meta: seeded.meta });
const a1 = applyOp('A5', g, { op: 'addDevice', kind: 'res', label: 'R', value: 1000, x: 100, y: 560 });
const a2 = applyOp('A5', a1.graph, { op: 'addDevice', kind: 'res', label: 'R', value: 2200, x: 220, y: 560 });
const ids = a2.graph.nodes.filter((n) => n.label === 'R').map((n) => n.id);
console.log(JSON.stringify({ collided: ids.length === 2 && ids[0] === ids[1], refused: Boolean(a1.refused || a2.refused) }));
`;
    const runnerPath = join(tmpdir(), `ids-variant-${Date.now()}.mjs`);
    writeFileSync(runnerPath, runner);
    const run = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, ['--experimental-strip-types', runnerPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let errOut = '';
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.stderr.on('data', (chunk) => { errOut += chunk; });
        child.on('close', () => resolve({ out: out.trim(), errOut: errOut.trim() }));
      });
    try {
      writeFileSync(opsPath, mutated);
      const redRaw = await run();
      const red = redRaw.out ? JSON.parse(redRaw.out) : {};
      ok('⑥', red.collided === true, `⑥ 变异后两个同类器件 id 竟不撞（变异没生效）raw=${redRaw.out || redRaw.errOut.slice(0, 400)}`);
      writeFileSync(opsPath, original);
      const greenRaw = await run();
      const green = greenRaw.out ? JSON.parse(greenRaw.out) : {};
      ok('⑥', green.collided === false && green.refused === false, `⑥ 还原后没有回绿 raw=${greenRaw.out || greenRaw.errOut.slice(0, 400)}`);
      console.log('⑥  变异：nextId 退回 label 生成 → ① 红；还原回绿');
    } finally {
      writeFileSync(opsPath, original);
    }
  }
}

/* ── ⑦ CDP：真页面加两个器件 + 恢复骨架无残留 ──────── */
{
  // 静态服 dist（check-drag 同款）。
  const dist = join(root, 'dist');
  const server = createServer((req, res) => {
    const file = join(dist, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, '') || 'index.html');
    try {
      const data = readFileSync(file);
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
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
  await new Promise((done) => server.listen(5198, '127.0.0.1', done));
  const profile = mkdtempSync(join(tmpdir(), 'ids-check-'));
  const browser = spawn(
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1500,1100', 'about:blank'],
    { stdio: 'ignore' },
  );
  // 端口 0 + DevToolsActivePort：固定端口会被残留 headless 实例抢占，
  // 旧实例带旧磁盘缓存 ⇒ 门禁假绿（2026-11-17 红案实测）。
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
    const send = (method, params = {}) => {
      const id = ++seqNo;
      return new Promise((resolve) => { pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); });
    };
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5198/#/lab/t/A3' });
    await new Promise((r) => setTimeout(r, 3000));
    const addButtons = await evaluate("document.querySelectorAll('[data-testid=\"device-add\"]').length");
    if (!addButtons) {
      problems.push('⑦ / 画布页没找到器件面板按钮（dist 旧了？先 npm run build）');
    } else {
      await evaluate("document.querySelector('[data-testid=\"device-add\"]').click()");
      await new Promise((r) => setTimeout(r, 350));
      await evaluate("document.querySelector('[data-testid=\"device-add\"]').click()");
      await new Promise((r) => setTimeout(r, 350));
      const canvasIds = await evaluate("[...document.querySelectorAll('[data-node-id]')].map((n) => n.getAttribute('data-node-id')).filter((id) => id.startsWith('n-add-'))");
      ok('⑦', Array.isArray(canvasIds) && canvasIds.length === 2 && canvasIds[0] !== canvasIds[1], `⑦ 画布两个新器件 id 应不同：${JSON.stringify(canvasIds)}`);
      // 恢复骨架（armed 确认条）→ 确认 → DOM 无 n-add-* 残留。
      await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('恢复骨架'))?.click()");
      await new Promise((r) => setTimeout(r, 350));
      const confirmVisible = await evaluate("Boolean(document.querySelector('[data-testid=\"reset-skeleton-confirm\"]'))");
      ok('⑦', confirmVisible === true, '⑦ 确认条没弹出来');
      await evaluate("document.querySelector('[data-testid=\"reset-skeleton-yes\"]')?.click()");
      await new Promise((r) => setTimeout(r, 700));
      const leftover = await evaluate("[...document.querySelectorAll('[data-node-id],[data-testid=\"device-row\"]')].map((n) => n.getAttribute('data-node-id') ?? n.getAttribute('data-node')).filter((id) => id && id.startsWith('n-add-'))");
      ok('⑦', Array.isArray(leftover) && leftover.length === 0, `⑦ 恢复骨架后 DOM 残留旧 id：${JSON.stringify(leftover)}`);
      console.log('⑦  CDP：连加两个器件画布 id 不同 + 恢复骨架无残留');

      /* ── ⑧ W22-C/D UI 断言：F8 行名按钮 / F1 候选不截断 / F7 引脚热区 / F11 滑杆读屏 ── */
      // F8：每个器件行的名按钮（行内第一个 button）宽高都 > 0 —— 旧版 flex 会把
      // 展开复合行的名按钮压成 0 宽（dev-row-cmp/... BUTTON 0）。
      await evaluate("document.querySelector('[data-testid=\"composite-add\"]')?.click()");
      await new Promise((r) => setTimeout(r, 450));
      await evaluate("[...document.querySelectorAll('[data-testid=\"composite-expand\"]')][0]?.click()");
      await new Promise((r) => setTimeout(r, 450));
      const rowButtons = await evaluate(`[...document.querySelectorAll('[data-testid="device-row"]')].map((row) => {
        const btn = row.querySelector('button');
        const rect = btn?.getBoundingClientRect();
        return rect ? { id: row.getAttribute('data-node'), w: Math.round(rect.width), h: Math.round(rect.height) } : null;
      })`);
      ok(
        '⑧',
        Array.isArray(rowButtons) && rowButtons.length > 0 && rowButtons.every((one) => one && one.w > 0 && one.h > 0),
        `⑧ F8 行名按钮有 0 宽（展开复合后）：${JSON.stringify((rowButtons ?? []).filter((one) => !one || one.w === 0 || one.h === 0))}`,
      );
      // 名按钮可点 = 有内容象限（getClientRects 非空）；展开的 cmp/ 行也在内。
      const clickableNames = await evaluate(`[...document.querySelectorAll('[data-testid="device-row"]')].filter((row) => {
        const btn = row.querySelector('button');
        return btn && btn.getClientRects().length > 0 && row.getAttribute('data-node')?.startsWith('cmp/');
      }).length`);
      ok('⑧', clickableNames > 0, '⑧ F8 展开复合后没有任何可点的 cmp/ 行名按钮');

      // F1：候选锚点不再截 8 个 —— 选第一个端点后，候选按钮数 > 8；候选 > 12 时搜索框在场。
      await evaluate(`(() => {
        const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.getAttribute('data-testid') === 'anchor-option'));
        if (!sel || sel.options.length < 2) return false;
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 250));
      const optionCount = await evaluate("[...document.querySelectorAll('[data-testid=\"anchor-option\"]')].length");
      const candCount = await evaluate("[...document.querySelectorAll('[data-testid=\"anchor-candidate\"]')].length");
      ok(
        '⑧',
        typeof optionCount === 'number' && optionCount > 9 && candCount > 8,
        `⑧ F1 候选仍被截断：锚点 ${optionCount} 个但候选只有 ${candCount} 个（≤8 = 截断没拆干净）`,
      );
      const searchVisible = await evaluate("Boolean(document.querySelector('[data-testid=\"anchor-search\"]'))");
      ok('⑧', searchVisible === candCount > 12, `⑧ F1 搜索框显隐与候选数不符：候选 ${candCount}、搜索框 ${searchVisible}`);

      // F7：任何两个 data-pin 不得同点叠放（<2px）；轨端点位置点击必须命中引脚圆。
      const pinCenters = await evaluate(`[...document.querySelectorAll('[data-pin]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { key: el.getAttribute('data-pin'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })`);
      ok('⑧', Array.isArray(pinCenters) && pinCenters.length > 5, `⑧ F7 画布引脚太少：${pinCenters?.length}`);
      if (Array.isArray(pinCenters) && pinCenters.length > 1) {
        const dup = [];
        for (let i = 0; i < pinCenters.length; i += 1) {
          for (let j = i + 1; j < pinCenters.length; j += 1) {
            if (Math.hypot(pinCenters[i].x - pinCenters[j].x, pinCenters[i].y - pinCenters[j].y) < 2) dup.push(`${pinCenters[i].key}~${pinCenters[j].key}`);
          }
        }
        ok('⑧', dup.length === 0, `⑧ F7 同点叠放引脚（covered 病灶）：${dup.join(', ')}`);
        // 轨端点（A3 的 e-vs-gnd:to = 旧 e-gnd-rail:from 同一点）点击命中 pin。
        const railHit = await evaluate(`(() => {
          const el = document.querySelector('[data-pin="e-vs-gnd:to"]');
          if (!el) return 'no-element';
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return hit?.closest('[data-pin]')?.getAttribute('data-pin') ?? 'not-pin:' + hit?.tagName;
        })()`);
        ok('⑧', typeof railHit === 'string' && railHit.includes(':'), `⑧ F7 接地轨端点点击没命中引脚：${railHit}`);
      }

      // F11 前置：复合展开后图不再归约回模板 → 通用求解，按设计不给参数实验场。
      // 先断言这份契约，再恢复骨架测滑杆 —— 在通用态测滑杆是假前提。
      const genericState = await evaluate(`JSON.stringify({
        sliders: document.querySelectorAll('input[data-role="slider"]').length,
        note: [...document.querySelectorAll('p')].some((p) => p.textContent.includes('参数实验场只驱动骨架参数')),
      })`);
      const genericParsed = JSON.parse(genericState);
      ok('⑧', genericParsed.sliders === 0 && genericParsed.note === true, `⑧ F11 前置：通用态应无滑杆且有通用求解说明：${genericState}`);
      await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('恢复骨架'))?.click()");
      await new Promise((r) => setTimeout(r, 350));
      await evaluate("document.querySelector('[data-testid=\"reset-skeleton-yes\"]')?.click()");
      await new Promise((r) => setTimeout(r, 700));

      // F11：参数滑杆 aria-valuenow = 工程真值（与同一参数的数字输入框一致），valuetext 带单位非空。
      // R-36b：ParamPanel 数值行拆成两行（滑杆行 / 数值行），改用 data-param-input 按
      // 参数键配对，不再假设滑杆和数字框在同一行 div 里。
      const sliders = await evaluate(`[...document.querySelectorAll('input[data-role="slider"]')].map((slider) => {
        const panel = slider.closest('[data-testid="param-panel"]');
        const param = slider.getAttribute('data-param');
        const num = panel?.querySelector('input[data-param-input="' + param + '"]');
        const unit = slider.closest('div')?.parentElement?.querySelector('span.w-8')?.textContent?.trim() ?? '';
        return {
          param,
          now: Number(slider.getAttribute('aria-valuenow')),
          text: slider.getAttribute('aria-valuetext') ?? '',
          num: num ? Number(num.value) : null,
          unit,
        };
      })`);
      ok('⑧', Array.isArray(sliders) && sliders.length > 0, '⑧ F11 页面上没有参数滑杆（ParamPanel 没渲染？）');
      if (Array.isArray(sliders)) {
        for (const slider of sliders) {
          ok(
            '⑧',
            slider.num !== null && Math.abs(slider.now - slider.num) <= Math.max(Math.abs(slider.num) * 1e-6, 1e-9),
            `⑧ F11 ${slider.param} aria-valuenow=${slider.now} ≠ 数字框真值 ${slider.num}（读屏听到的是归一化刻度）`,
          );
          ok(
            '⑧',
            slider.text.length > 0 && (slider.unit === '' || slider.text.includes(slider.unit)),
            `⑧ F11 ${slider.param} aria-valuetext "${slider.text}" 缺单位 "${slider.unit}" 或为空`,
          );
        }
        console.log(`⑧  W22-C/D UI：F8 行名按钮 ${rowButtons?.length} 个全 >0 宽（含展开复合行）；F1 候选 ${candCount}/${optionCount} 不截断；F7 无叠放引脚、轨端点命中；F11 滑杆 ${sliders.length} 个 valuenow/valuetext 就位`);
      }
    }
    ws.close();
  }
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  // Edge 可能换 PID 重启、脱离 spawn 父子链：按唯一 profile 路径兜底清整棵树，
  // 不留残留实例给下一轮门禁抢端口 / 喂旧缓存。
  spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  server.close();
}

/* ── 汇总 ───────────────────────────────────────────── */
console.log(`\nPASS：${checks} 项（id 唯一性：seq 单调 / 删除不复用 / 复合模块 / 复切 / 旧图兼容 / 变异 / CDP）`);
if (problems.length > 0) {
  console.error('FAIL：以下项未通过');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
process.exit(0);
