/**
 * 范围判别门禁（任务单 §4）：零浏览器，四条断言。
 *
 *  ① 64 组合全覆盖：每组合都有结论、结论只落在三档里，且每档的内容/出口都齐；
 *     顺带钉住 1 / 3 / 60 的真实分布（不许偷偷把「不覆盖」放水成「能算」）。
 *  ② 16 个关键词逐个命中：造 16 条题面，每条都出「不覆盖」卡、draft 为空、不调模型。
 *  ③ 留痕三处齐：结果页 amber 条 + assumptions 段 + PDF 里出现「不等价」；
 *     外加 assumptionLine 本身必须带「不等价」与「改动：」。
 *  ④ 三处入口都在：#/scope 路由、#/solve 拦截卡的三个出口、#/about 那句能力边界。
 *
 * 变异两条（写进报告）：① 把某一档结论改错 → ① fail；② 删掉 amber 条 → ③ fail。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answersFromMask, classifyScope } from '../src/core/scope/classify.ts';
import { SCOPE_TIERS, TIER_LABEL } from '../src/core/scope/questions.ts';
import { OUT_OF_SCOPE_TERMS, findScopeKeyword } from '../src/core/scope/keywords.ts';
import { assumptionLine, assumptionLines, parseSimplifications } from '../src/core/scope/simplifications.ts';
import { parseProblem } from '../src/core/ai/parse.ts';
import { getTemplateRoute } from '../src/core/templates/registry.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = (path) => readFileSync(join(root, path), 'utf8');

const problems = [];
let checks = 0;

function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
}

/* ── ① 64 组合 ─────────────────────────────────────────────────── */

const tally = { ok: 0, simplify: 0, reject: 0 };
for (let mask = 0; mask < 64; mask += 1) {
  const answers = answersFromMask(mask);
  ok('①', answers.length === 6, `组合 ${mask} 的答案数不是 6`);
  let verdict;
  try {
    verdict = classifyScope(answers);
  } catch (error) {
    ok('①', false, `组合 ${mask} 抛错：${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  ok('①', SCOPE_TIERS.includes(verdict.tier), `组合 ${mask} 的档位 ${verdict.tier} 不在三档里`);
  ok('①', verdict.label === TIER_LABEL[verdict.tier], `组合 ${mask} 的档位名对不上`);
  ok('①', verdict.headline.length > 8, `组合 ${mask} 没有结论文案`);
  ok('①', verdict.exit.startsWith('#/'), `组合 ${mask} 没有出口：${verdict.exit}`);
  ok('①', verdict.exitLabel.length > 0, `组合 ${mask} 的出口没写标签`);
  tally[verdict.tier] += 1;

  if (verdict.tier === 'ok') {
    ok('①', verdict.templates.length >= 1 && verdict.templates.length <= 3, `组合 ${mask} 的题型卡不是 1–3 张`);
    for (const id of verdict.templates) {
      ok('①', Boolean(getTemplateRoute(id)), `组合 ${mask} 的题型卡 ${id} 不在 registry 里`);
    }
    ok('①', verdict.gaps.length === 0, `组合 ${mask} 全是「是」却报了缺口`);
  }
  if (verdict.tier === 'simplify') {
    ok('①', verdict.changes.length > 0, `组合 ${mask} 没写「需要改成什么」`);
    ok('①', verdict.simplifications.length > 0, `组合 ${mask} 没有简化 id`);
    ok('①', verdict.exit.includes('simp='), `组合 ${mask} 的出口没带简化 id（留痕会断）`);
    ok('①', verdict.gaps.length > 0, `组合 ${mask} 简化了却没写缺口`);
  }
  if (verdict.tier === 'reject') {
    ok('①', verdict.methods.length > 0, `组合 ${mask} 没写「该用什么方法」`);
    ok('①', verdict.headline.includes('本工具不做这一类'), `组合 ${mask} 没明说不做`);
    ok('①', verdict.exit === '#/about', `组合 ${mask} 的不覆盖出口不是 #/about`);
    ok('①', verdict.templates.length === 0, `组合 ${mask} 嘴上说不做，却塞了题型卡`);
  }
}
ok('①', tally.ok === 1, `「能直接算」应有 1 组合，实际 ${tally.ok}`);
ok('①', tally.simplify === 3, `「要先简化」应有 3 组合，实际 ${tally.simplify}`);
ok('①', tally.reject === 60, `「不覆盖」应有 60 组合，实际 ${tally.reject}`);

/* ── ② 16 个关键词 ─────────────────────────────────────────────── */

ok('②', OUT_OF_SCOPE_TERMS.length === 16, `关键词应有 16 个，实际 ${OUT_OF_SCOPE_TERMS.length}`);
for (const term of OUT_OF_SCOPE_TERMS) {
  const text = `简支梁 L=4m，跨中集中力 20kN，涉及${term}，求支座反力`;
  ok('②', findScopeKeyword(text)?.term === term, `findScopeKeyword 没认出「${term}」`);
  const outcome = await parseProblem({ text });
  ok('②', Boolean(outcome.blocked), `题面含「${term}」却没出「不覆盖」卡`);
  ok('②', outcome.blocked?.term === term, `拦下的词不是「${term}」：${outcome.blocked?.term}`);
  ok('②', outcome.blocked?.message.includes('不覆盖') === true, `「${term}」的拦截卡没写「不覆盖」`);
  ok('②', outcome.draft === null, `「${term}」被拦下却还出了 draft（会进参数表单）`);
  ok('②', outcome.jumpable === false, `「${term}」被拦下却允许跳转`);
  ok('②', outcome.attempts === 0, `「${term}」被拦下还调了模型（白烧一次请求）`);
}
// 覆盖内的题不许误拦
const normal = await parseProblem({ text: '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力' });
ok('②', normal.blocked === undefined && normal.draft !== null, '正常题面被范围闸误拦了');

/* ── ③ 留痕三处 ────────────────────────────────────────────────── */

const simplifications = parseSimplifications('equal-section,linear');
ok('③', simplifications.length === 2, '两条简化没都解析出来');
const lines = assumptionLines(simplifications);
ok('③', lines.length === 2, 'assumptions 条数不对');
for (const line of lines) {
  ok('③', line.includes('不等价'), `assumption 没写「不等价」：${line}`);
  ok('③', line.includes('改动：'), `assumption 没写改动：${line}`);
  ok('③', line.startsWith('已按 '), `assumption 没按「已按 <简化名> 计算」开头：${line}`);
}
ok('③', assumptionLine(simplifications[0]).includes('等截面近似'), '简化名没进留痕文案');
ok('③', parseSimplifications('不存在的简化').length === 0, '不认识的简化 id 应该被丢掉');

const resultSource = source('src/pages/Result.tsx');
const appSource = source('src/App.tsx');
const solveSource = source('src/pages/Solve.tsx');
const aboutSource = source('src/pages/About.tsx');
const scopeSource = source('src/pages/Scope.tsx');

// ① 顶部 amber 条：必须存在、必须是 amber、必须不带 no-print
const bar = /<div className="print-assumption[^"]*border-amber[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(resultSource);
ok('③', Boolean(bar), '结果页找不到 print-assumption 的 amber 顶部条');
ok('③', !/no-print/.test(bar?.[0] ?? 'no-print'), 'amber 顶部条带了 no-print（PDF 里会消失）');
ok('③', /assumptions\.map/.test(bar?.[1] ?? ''), 'amber 顶部条没渲染 assumptions 文案');

// ② assumptions 段：必须存在、必须不是 no-print
const section = /<section className="print-assumptions[^"]*"[^>]*>([\s\S]*?)<\/section>/.exec(resultSource);
ok('③', Boolean(section), '结果页找不到 print-assumptions 段');
ok('③', !/no-print/.test(section?.[0] ?? 'no-print'), 'assumptions 段带了 no-print（PDF 里会消失）');
ok('③', /不等价|assumptionLines/.test(resultSource), '结果页没引用带「不等价」的留痕文案');

// ③ PDF：导出走 window.print()，且「不等价」来自留痕文案而不是另写的一句
ok('③', /window\.print\(\)/.test(resultSource), '导出 PDF 没走 window.print()');
ok('③', /assumptions/.test(section?.[1] ?? ''), 'assumptions 段没印出内容');
ok('③', /assumptionLines\(/.test(resultSource), '结果页没调用 assumptionLines（打印的是另一份文案？）');
ok('③', /print-assumption/.test(resultSource) && /print-assumptions/.test(resultSource), '两处留痕类名不齐');

/* ── ④ 三处入口 ────────────────────────────────────────────────── */

ok('④', /hash === 'scope'/.test(appSource), 'App 没有 #/scope 路由');
ok('④', /page: 'scope'/.test(appSource), 'App 的 Route 联合里没有 scope');
ok('④', /href="#\/scope"/.test(scopeSource) || /#\/scope/.test(aboutSource), '#/scope 页没有入口');
ok('④', /href="#\/scope"/.test(solveSource), '#/solve 的拦截卡没有「去 #/scope」出口');
ok('④', /href="#\/about"/.test(solveSource), '#/solve 的拦截卡没有能力边界出口');
ok('④', /改写成覆盖内的题/.test(solveSource), '#/solve 的拦截卡没有「改写成覆盖内的题」出口');
ok('④', /不覆盖/.test(aboutSource) && /超静定/.test(aboutSource), '#/about 没有如实写出能力边界（不覆盖 / 超静定）');
ok('④', scopeSource.includes('它不假装什么都能算。'), '#/scope 页头少了那句「它不假装什么都能算。」');
ok('④', /data-scope-q=/.test(scopeSource) && /data-scope-v=/.test(scopeSource), '六问没有可键盘定位的按钮标记');
ok('④', /aria-pressed=/.test(scopeSource), '六问按钮没有 aria-pressed（键盘/读屏不好判断当前选项）');
ok('④', /href="#\/scope"/.test(source('src/pages/Home.tsx')), '首页没有范围判别入口');
// 375 宽：不靠截图裁，静态判「新页没有写死的宽 / 无断点的多列网格」
ok('④', !/min-w-\\[\d{3,}px\\]|(?:^|[^-\w])w-\\[\d{3,}px\\]/.test(scopeSource), '#/scope 写了固定像素宽（375 屏会横向溢出）');
ok('④', !/(?:^|[^:\w])grid-cols-[2-9]/.test(scopeSource), '#/scope 有不带断点的多列网格');
// 令牌：不硬编码颜色
ok('④', !/#[0-9a-fA-F]{6}/.test(scopeSource), '#/scope 硬编码了十六进制颜色（该用语义令牌）');
// 判据名中文化 + M6 说明（任务 5）
ok('④', /unknownCount: '未知量数'/.test(resultSource), '结果页没把 unknownCount 翻成「未知量数」');
ok('④', /equationCount: '方程数'/.test(resultSource), '结果页没把 equationCount 翻成「方程数」');
ok('④', /rank: '矩阵秩'/.test(resultSource), '结果页没把 rank 翻成「矩阵秩」');
ok('④', /本型无受力图/.test(resultSource), 'M6 没补「本型无受力图」说明');
// S 系标签统一
for (const file of ['S1.ts', 'S3.ts', 'S5.ts']) {
  const text = source(`src/core/templates/statics/${file}`);
  ok('④', /label: `R_A = /.test(text) && /label: `R_B = /.test(text), `${file} 的反力标签不是 R_A / R_B`);
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems.slice(0, 30)) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `PASS：${checks} 项（范围判别门禁：64 组合全覆盖 1/3/60 / 16 个关键词逐一拦截 / 留痕三处齐 / 三处入口在）`,
);
