/**
 * check:report —— 三档置信度文案与渲染纪律。
 *
 *  ① tierOf 三档判定 + 文案互斥（F/N/U 三句 headline 两两不同）
 *  ② structure fail 必须落 U：真实坏骨架（M3 简支改固定端）→ reduce problems 非空
 *     → withLabChecks structure fail → allPassed=false → tierOf=U → 替代入口含 #/scope
 *  ③ N 档纪律（静态）：Lab.tsx 里第 4 帧替换用 N_TIER_STEP4_TITLE、
 *     等效图被 `!spec.derivedFrom` 滤掉、且只在 tier==='F' 给全量渲染
 *  ④ withLabChecks 只追加两项、重算汇总，不动 contractVersion / 原六项
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { graphFromSpec } from '../src/core/lab/graphFromSpec.ts';
import { seedGraph, skeletonOptions } from '../src/core/lab/picks.ts';
import { reduce } from '../src/core/lab/reduce.ts';
import { applyOp } from '../src/core/lab/ops.ts';
import { tierOf, withLabChecks, N_TIER_STEP4_TITLE } from '../src/core/lab/tiers.ts';
import { formatCompact, formatScalar } from '../src/core/format.ts';
import { validateLive } from '../src/confidence/live.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};

/* ── ① 三档判定 + 文案互斥 ──────────────────────────────────────── */

const f = tierOf({ outOfScope: false, scopeOk: 'pass', problems: [], semantic: 'pass' });
const n = tierOf({ outOfScope: false, scopeOk: 'pass', problems: [], semantic: 'skipped' });
const u = tierOf({ outOfScope: true, scopeOk: 'pass', problems: ['白名单外器件'], semantic: 'pass' });
ok('①', f.tier === 'F' && n.tier === 'N' && u.tier === 'U', `三档映射错：${f.tier}/${n.tier}/${u.tier}`);
const headlines = [f.headline, n.headline, u.headline];
ok('①', new Set(headlines).size === 3, `三档 headline 不互斥：${headlines.join(' | ')}`);
ok('①', f.headline.includes('等效电路已验证'), `F 文案不符：${f.headline}`);
ok('①', n.headline.includes('等效图未核对'), `N 文案不符：${n.headline}`);
ok('①', u.headline.includes('不适用') && u.headline.includes('替代入口'), `U 文案不符：${u.headline}`);
ok('①', (u.substitute ?? []).some((item) => item.hash === '#/scope'), 'U 档替代入口没有 #/scope');
ok('①', (u.substitute ?? []).length >= 3, `U 档替代入口不足三个：${(u.substitute ?? []).length}`);

/* ── ② 坏骨架 → structure fail → U ─────────────────────────────── */

const snap = JSON.parse(readFileSync(join(root, 'src', 'examples', 'M3.json'), 'utf8'));
const route = getTemplateRoute('M3');
const defaults = Object.fromEntries((route.entry.params ?? []).map((p) => [p.key, p.defaultValue]));
const seeded = seedGraph('M3', defaults);
const graph = graphFromSpec(snap.render_specs[0], 'M3', 'beam', {
  ...skeletonOptions('M3'),
  seeds: seeded.seeds,
  meta: seeded.meta,
});
// R3-1 A1：支座是结点属性 —— 找到挂可动铰的那个结点，再改类型（不再改图元 kind）
const rollerJoint = graph.nodes.find((node) => node.support?.type === 'roller');
const broken = applyOp('M3', graph, { op: 'setSupport', nodeId: rollerJoint.id, type: 'fixed' }).graph;
const bad = reduce('M3', broken, ['「可动铰」改为 固定端']);
ok('②', bad.outOfScope && bad.problems.length > 0, `坏骨架归约应拒：outOfScope=${bad.outOfScope}`);
ok('②', bad.params.P === 20, '② 归约即使在拒答档也应把能拿到的参数给出（不撒谎也不丢数）');

const baseConfidence = {
  scopeOk: 'pass',
  inputOk: 'pass',
  pathsConsistent: 'pass',
  residualOk: 'pass',
  boundaryOk: 'pass',
  goldenOk: 'skipped',
  maxResidual: 0,
  checks: [
    { name: 'scope', state: 'pass', detail: 'in scope' },
    { name: 'golden', state: 'skipped', detail: 'live params', skipReason: 'live params' },
  ],
  failedCount: 0,
  skippedCount: 1,
  allPassed: true,
};
const report = withLabChecks(
  baseConfidence,
  { state: bad.problems.length > 0 ? 'fail' : 'pass', detail: bad.problems[0] ?? 'ok' },
  { state: 'skipped', detail: '本型不涉及语义标签' },
);
ok('②', report.checks.length === baseConfidence.checks.length + 2, `② 应追加两项，实际 ${report.checks.length}`);
ok('②', report.checks.some((item) => item.name === 'structure' && item.state === 'fail'), '② structure 项没落到 fail');
ok('②', report.failedCount === 1 && report.allPassed === false, `② 汇总没重算：failed=${report.failedCount} allPassed=${report.allPassed}`);
const tierFromBroken = tierOf({ outOfScope: bad.outOfScope, scopeOk: 'pass', problems: bad.problems, semantic: 'pass' });
ok('②', tierFromBroken.tier === 'U', `② 坏骨架应落 U，实际 ${tierFromBroken.tier}`);
ok('②', (tierFromBroken.substitute ?? []).some((item) => item.hash === '#/scope'), '② U 档没有 #/scope 出口');

// 力学 semantic 恒 skipped 但带理由：不进 failedCount，也不该把 allPassed 打翻（别的全绿时）
const mechReport = withLabChecks(
  baseConfidence,
  { state: 'pass', detail: '骨架未改动，归约逐键一致' },
  { state: 'skipped', detail: '本型不涉及语义标签' },
);
ok('②', mechReport.failedCount === 0, `② 力学 semantic skipped 不该算 fail：${mechReport.failedCount}`);
ok('②', mechReport.allPassed === true, '② 全绿骨架的 allPassed 不该被有理由的 skipped 打翻');
console.log('②  坏骨架 → structure fail → U（替代入口含 #/scope）；力学 skipped 带理由不翻车');

/* ── ③ N 档纪律（静态扫 Lab.tsx） ──────────────────────────────── */

const labSource = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
ok('③', labSource.includes(N_TIER_STEP4_TITLE), 'Lab.tsx 没用 N_TIER_STEP4_TITLE 替换第 4 帧');
ok('③', /\.i === 3/.test(labSource), 'Lab.tsx 没有按 stepIndex=3 替换');
ok('③', labSource.includes("!spec.derivedFrom"), 'Lab.tsx 没有滤掉等效图（derivedFrom）');
ok('③', /verdict\.tier === 'N'/.test(labSource) && labSource.includes('nTier ? base.render_specs.filter'), 'N 档的等效图过滤没有跟 tier 挂钩');
ok('③', /tier === 'F'/.test(labSource) || /verdict\.tier === 'F'/.test(labSource), 'Lab.tsx 没有 F 档分支（三档必须显式分开）');
// U 档拒绝页：不出现任何数值结果区
ok('③', labSource.includes("stage === 'refused'"), 'Lab.tsx 没有 refused 状态的独立渲染分支');
ok('③', !/refused[\s\S]{0,600}DataPanel|refused[\s\S]{0,600}override=\{solution\}/.test(labSource), 'U 档拒绝了却还渲染结果区');
console.log('③  N 档：第 4 帧替换 + 等效图过滤 + F 档显式分支，静态断言全过');

/* ── ⑤ A1 截止态：0 电流不能被相对误差判成“两条路径不一致” ─────── */
{
  const a1Route = getTemplateRoute('A1');
  const a1Input = { mode: 'series', Vs: 0.2, R: 1000, Vf: 0.7, Vz: 5.1, Rz: 10 };
  const a1Solution = a1Route ? (await a1Route.entry.solver()).default(a1Input) : null;
  const live = a1Route && a1Solution ? await validateLive(a1Route.entry, undefined, a1Solution, a1Input) : null;
  ok('⑤', Boolean(live) && live.confidence.pathsConsistent === 'pass', `⑤ A1 截止态两条路径应一致，实际 ${live?.confidence.pathsConsistent} / ${live?.confidence.checks.find((c) => c.name === 'pathsConsistent')?.detail}`);
  ok('⑤', Boolean(live) && live.confidence.failedCount === 0, `⑤ A1 截止态不应有 fail，实际 ${live?.confidence.failedCount} 项`);
  console.log(`⑤  A1 截止态：路径 ${live?.confidence.pathsConsistent} · fail ${live?.confidence.failedCount}`);
}

/* ── W21-B B5：数值只有一种写法（体验报告 5.9） ─────────────────── */
{
  ok('B5', formatCompact(100000) === '100k', `画布数字应写 100k，实际 ${formatCompact(100000)}`);
  ok('B5', formatScalar(100000, 'Ω') === '100kΩ', `左栏 / 右栏应写 100kΩ，实际 ${formatScalar(100000, 'Ω')}`);
  ok('B5', formatScalar(2, 'm') === '2.00 m', `跨度应写 2.00 m，实际 ${formatScalar(2, 'm')}`);
  ok('B5', formatScalar(30, 'MPa') === '30.0 MPa', `应力应写 30.0 MPa，实际 ${formatScalar(30, 'MPa')}`);
  ok('B5', formatScalar(0.001, 'A') === '1mA', `小电流应写 1mA，实际 ${formatScalar(0.001, 'A')}`);
  const picks = readFileSync(join(root, 'src', 'core', 'lab', 'picks.ts'), 'utf8');
  const panel = readFileSync(join(root, 'src', 'ui', 'ParamPanel.tsx'), 'utf8');
  const lab = readFileSync(join(root, 'src', 'pages', 'Lab.tsx'), 'utf8');
  ok(
    'B5 源码：画布 / 左栏 / 右栏都调同一个格式器',
    /formatCompact/.test(picks) && /formatScalar/.test(panel) && /formatScalar/.test(lab) && /device-value-formatted/.test(lab),
    '有一处还在自己拼数字写法',
  );
  console.log('B5  统一格式器：100k / 100kΩ / 2.00 m / 30.0 MPa / 1mA');
}

/* ── W21-C C1-1/C1-3：内部名不外泄、术语统一（源码层扫描） ────────── */
{
  // 扫描范围＝用户可见层（pages / ui / lab core / ai / templates 的非注释行）。
  // templates 讲解稿正文里的「杆」是教材用词（压杆 / 斜杆是 legit 物理名），
  // 不在扫描内；扫描钉的是 UI 呈现层的统一词「构件」。
  // C1-1 的「库 → 求解内核」只落在 pages / ui / lab 层：模板讲解文案被 35 份
  // 快照逐字节钉住（check:p3 deepStrictEqual），改模板文案 = 快照漂移，红线
  // 不允许 —— 模板层只扫术语，内部名规则对它豁免（改动需官方 build-example 再生）。
  const layers = ['src/pages', 'src/ui', 'src/core/lab', 'src/core/templates'];
  // 巡检 D3（2026-11-16）修订：弯曲题（M3/M4/M5）自建构件叫「梁段」更准，
  // 梁段从禁用表移除（构件仍是统称）；杆件 / 加杆 / 删杆等照旧禁用。
  const banned = /杆件|加杆|删杆|选杆|一根杆|\d 根杆|杆行|杆线/;
  const jargon = /check:mech-parity|dsh-mech-workbench|库 checks\[\]|render_spec 单/;
  const libWord = /(?<![题素材词数求仓内核识])库(?!（dsh)/;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const isTemplate = dir.startsWith('src/core/templates');
        const lines = readFileSync(join(root, rel), 'utf8').split('\n');
        lines.forEach((line, index) => {
          const stripped = line.trim();
          if (stripped.startsWith('//') || stripped.startsWith('/*') || stripped.startsWith('*')) return;
          const cleaned = line
            .replace(/题库|素材库|词库|数据库|仓库|求解内核|样例库|词法/g, '')
            .replace(/杠杆|压杆|拉杆|斜杆|导杆|连杆|杆件/g, (m) => (m === '杆件' ? '' : m));
          if (banned.test(line) && !/构件/.test(line.replace(/构件/g, ''))) offenders.push(`${rel}:${index + 1} 术语 ${banned.exec(line)?.[0]}`);
          else if (banned.test(cleaned)) offenders.push(`${rel}:${index + 1} 术语 ${banned.exec(cleaned)?.[0]}`);
          if (!isTemplate) {
            if (jargon.test(line)) offenders.push(`${rel}:${index + 1} 内部名 ${jargon.exec(line)?.[0]}`);
            else if (libWord.test(cleaned)) offenders.push(`${rel}:${index + 1} 裸「库」`);
          }
        });
      }
    }
  };
  for (const layer of layers) walk(layer);
  ok(
    'C1 源码：UI 层不再出现「杆件 / 加杆 / 删杆」（弯曲构件可叫梁段）',
    offenders.filter((one) => one.includes('术语')).length === 0,
    offenders.filter((one) => one.includes('术语')).slice(0, 6).join(' | '),
  );
  ok(
    'C1 源码：check:mech-parity / dsh-mech-workbench / 库 checks[] 不在用户可见层',
    offenders.filter((one) => one.includes('内部名')).length === 0,
    offenders.filter((one) => one.includes('内部名')).slice(0, 6).join(' | '),
  );
  ok(
    'C1 源码：用户可见层不再有裸「库」（一律「求解内核」）',
    offenders.filter((one) => one.includes('裸「库」')).length === 0,
    offenders.filter((one) => one.includes('裸「库」')).slice(0, 6).join(' | '),
  );
  console.log('C1  术语与内部名：构件统一 / 求解内核改名（源码扫描）');
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（三档报告门禁：tierOf 互斥 / structure fail → U / N 档不渲染等效图 / withLabChecks 只加两项 / A1 截止态 / B5 统一格式器 / C1 构件与求解内核改名扫描）`);
