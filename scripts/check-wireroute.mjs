/**
 * R-36d · 连线绕障门禁（单元级，node --experimental-strip-types 直跑 TS）。
 *
 * 场景：三只电阻排一行，直连两端引脚。
 *  - 中间电阻 0°：引脚总线穿过中间本体，但引脚落点在线上 → 合法直连，不绕（骨架外观不变）；
 *  - 中间电阻转 90°：引脚朝上下，直连横穿本体且不碰引脚 → 真 bodyCross 场景，
 *    addEdge 必须自动绕行（3 段车道），不把 bodyCross 拒答甩给用户。
 * 拒答口径与 netSolve 同源（同一份 crossings 判据）。
 */
import { applyOp } from '../src/core/lab/ops.ts';

let checks = 0;
const failures = [];
function ok(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

const mk = (id, x, rot = 0) => ({ id, kind: 'res', x, y: 560, rot, label: 'R', value: 1000 });
const graphOf = (rotB) => ({
  family: 'circuit',
  nodes: [mk('n-a', 100, 0), mk('n-b', 210, rotB), mk('n-c', 320, 0)],
  edges: [],
  meta: {},
});

/* ① 合法总线（中间电阻引脚落在线上）：直连不绕，外观稳定 */
{
  const out = applyOp('', graphOf(0), { op: 'addEdge', from: 'n-a:a', to: 'n-c:a', kind: 'wire' });
  ok('① 合法总线不拒答', !out.refused, out.refused ?? '');
  const points = out.graph.edges[0]?.points ?? [];
  ok('① 直连 2 段不绕行', points.length === 3, JSON.stringify(points));
  const straight = Math.abs(points[points.length - 1][1] - points[0][1]) < 0.6;
  ok('① 直连仍走原高度（外观不变）', straight, JSON.stringify(points));
}

/* ② 真穿体（中间电阻转 90°）：自动绕行，不甩 bodyCross 拒答 */
{
  const out = applyOp('', graphOf(90), { op: 'addEdge', from: 'n-a:a', to: 'n-c:a', kind: 'wire' });
  ok('② 穿体场景不拒答', !out.refused, out.refused ?? '');
  const points = out.graph.edges[0]?.points ?? [];
  ok('② 绕行至少 3 段', points.length >= 4, JSON.stringify(points));
  const laneY = points[1]?.[1];
  const away = Math.abs(laneY - 560) >= 28;
  ok('② 绕行车车道离开器件带 ≥28', away, `laneY=${laneY}`);
  const orthogonal = points.slice(1).every(
    (p, i) => p[0] === points[i][0] || p[1] === points[i][1],
  );
  ok('② 绕行折线全程正交', orthogonal, JSON.stringify(points));
  // 端点必须仍落在引脚上
  const head = points[0];
  const tail = points[points.length - 1];
  ok('② 端点仍在引脚（56,560）/（276,560）', Math.hypot(head[0] - 56, head[1] - 560) < 0.6 && Math.hypot(tail[0] - 276, tail[1] - 560) < 0.6, JSON.stringify([head, tail]));
}

/* ③ 变异：绕行车车道生成坏了（这里模拟 —— 禁用方式是核对函数存在性） */
{
  // 结构护栏：addEdge 里必须有车道生成与 crossings 打分（防回退成「两条 L 择优」）
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/lab/ops.ts', import.meta.url), 'utf8');
  ok('③ ops.ts 保留车道生成（detourLanes）', src.includes('detourLanes'));
  ok('③ ops.ts 保留穿体一票否决打分（* 1e6）', src.includes('* 1e6'));
}

if (failures.length > 0) {
  console.error('FAIL：以下项未通过');
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（连线绕障：合法总线直连外观不变 / 穿体自动绕行 ≥28 车道 / 正交折线 / 端点仍在引脚 / 源码护栏）`);
