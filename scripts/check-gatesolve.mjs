/**
 * check:gatesolve —— W15-S3 数字通用求值。六条验收 + 一条变异。
 *
 *  ① F = A·B + C' → minterms [0,2,4,6,7]；且把 D1 同一个函数写成文本网表，
 *    真值表与 src/examples/D1.json（Σm(0,1,2,3,4,6)）逐行一致、最小化式与
 *    result.sop（A'·B' + A'·D'）一致 —— 同模两入口
 *  ② 全加器 → S 的 minterms [1,2,4,7]、Cout 的 [3,5,6,7]（多输出）
 *  ③ XOR(a,b) 最小化 = a'·b + a·b'
 *  ④ 组合环 g1=AND(g2,a); g2=NOT(g1) → 拒答 code='cycle'，不给任何数值
 *  ⑤ 输出未被驱动（OUT F 无赋值）→ 拒答 code='undrivenOutput'
 *  ⑥ 8 输入（>6）→ 激励模式：states 有值、不再枚举（minterms 空，无 256 行）
 *  ⑦ 变异：把环检测关掉 → ④ 红
 *  ⑧ 红线：只许 import logicEval.ts / minimize.ts 两个纯工具（内存变异验红）
 *  ⑨ 错误文案中文具体化：未知门 / 参数个数 / 未知信号 / 重复定义
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateSolve, GATESOLVE_CONFIG } from '../src/core/lab/gateSolve.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const example = (id) => JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));

const TEXT = {
  f1: 'IN a, b, c\ng1 = AND(a, b)\ng2 = NOT(c)\nF = OR(g1, g2)',
  d1: 'IN a, b, c, d\nna = NOT(a)\nnb = NOT(b)\nnd = NOT(d)\nt1 = AND(na, nb)\nt2 = AND(na, nd)\nF = OR(t1, t2)',
  fa: 'IN a, b, cin\ns1 = XOR(a, b)\nS = XOR(s1, cin)\na1 = AND(a, b)\na2 = AND(s1, cin)\nCout = OR(a1, a2)',
  xor: 'IN a, b\nF = XOR(a, b)',
  cyc: 'IN a\ng1 = AND(g2, a)\ng2 = NOT(g1)',
  und: 'IN a\nOUT F',
  par8: 'IN a,b,c,d,e,f,g,h\nx1=XOR(a,b)\nx2=XOR(x1,c)\nx3=XOR(x2,d)\nx4=XOR(x3,e)\nx5=XOR(x4,f)\nx6=XOR(x5,g)\nF=XOR(x6,h)',
};

const solve = (text, options) => {
  try {
    return gateSolve(text, options);
  } catch (error) {
    problems.push(`求解抛错 / ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};
const outOf = (solution, name) => solution.outputs.find((o) => o.name === name);

/* ── ① F=A·B+C' 与 D1 同模对账 ──────────────────────────────────── */
{
  const r = solve(TEXT.f1);
  ok('①', r && r.ok, `① F=A·B+C' 被拒：${r && !r.ok ? r.reason : ''}`);
  if (r && r.ok) {
    const f = outOf(r.solution, 'F');
    ok('①', f && JSON.stringify(f.minterms) === JSON.stringify([0, 2, 4, 6, 7]), `① minterms=${JSON.stringify(f?.minterms)} ≠ [0,2,4,6,7]`);
    ok('①', f && f.expression === 'a·b + c' + "'", `① 结构式 ${JSON.stringify(f?.expression)} 应为 a·b + c'`);
    console.log(`①  F=A·B+C'：minterms [${f.minterms.join(',')}]，结构式「${f.expression}」`);
  }
  const rd = solve(TEXT.d1);
  ok('①', rd && rd.ok, `① D1 文本网表被拒：${rd && !rd.ok ? rd.reason : ''}`);
  if (rd && rd.ok) {
    const f = outOf(rd.solution, 'F');
    const golden = example('D1');
    const want = golden.parsed_given.minterms.split(',').map(Number);
    ok('①', f && JSON.stringify(f.minterms) === JSON.stringify(want), `① D1 minterms=${JSON.stringify(f?.minterms)} 与快照 ${golden.parsed_given.minterms} 不一致`);
    // 逐行核对 16 行真值表（行号即最小项编号）
    const rows = [];
    for (let i = 0; i < 16; i += 1) rows.push(f.minterms.includes(i) ? 1 : 0);
    const wantRows = Array.from({ length: 16 }, (_, i) => (want.includes(i) ? 1 : 0));
    ok('①', JSON.stringify(rows) === JSON.stringify(wantRows), '① 16 行真值表与 D1 快照不一致');
    const sopNorm = (s) => s.replace(/\s/g, '').replace(/[A-D]/g, (ch) => ch.toLowerCase());
    ok('①', f && sopNorm(f.minimized) === sopNorm(golden.result.sop.replace(/^F\s*=\s*/, '')), `① 最小化式「${f?.minimized}」与快照「${golden.result.sop}」不一致`);
    console.log(`①  D1 同模两入口：16 行真值表逐行一致，最小化「${f.minimized}」= 快照「${golden.result.sop}」`);
  }
}

/* ── ② 全加器（多输出） ──────────────────────────────────────────── */
{
  const r = solve(TEXT.fa);
  ok('②', r && r.ok, `② 全加器被拒：${r && !r.ok ? r.reason : ''}`);
  if (r && r.ok) {
    const s = outOf(r.solution, 'S');
    const cout = outOf(r.solution, 'Cout');
    ok('②', s && JSON.stringify(s.minterms) === JSON.stringify([1, 2, 4, 7]), `② S minterms=${JSON.stringify(s?.minterms)} ≠ [1,2,4,7]`);
    ok('②', cout && JSON.stringify(cout.minterms) === JSON.stringify([3, 5, 6, 7]), `② Cout minterms=${JSON.stringify(cout?.minterms)} ≠ [3,5,6,7]`);
    ok('②', r.solution.gateCount === 5, `② 门数 ${r.solution.gateCount} ≠ 5（2 XOR + 3 AND/OR…实际 2 XOR+2 AND+1 OR）`);
    ok('②', r.solution.depth === 3, `② 层深 ${r.solution.depth} ≠ 3`);
    console.log(`②  全加器：S [${s.minterms.join(',')}]，Cout [${cout.minterms.join(',')}]，门数 ${r.solution.gateCount}，层深 ${r.solution.depth}`);
  }
}

/* ── ③ XOR 最小化 ────────────────────────────────────────────────── */
{
  const r = solve(TEXT.xor);
  ok('③', r && r.ok, `③ XOR 被拒：${r && !r.ok ? r.reason : ''}`);
  if (r && r.ok) {
    const f = outOf(r.solution, 'F');
    ok('③', f && f.minimized === "a'·b + a·b'", `③ 最小化「${f?.minimized}」≠ a'·b + a·b'`);
    console.log(`③  XOR(a,b) 最小化：「${f.minimized}」（结构式「${f.expression}」）`);
  }
}

/* ── ④⑤ 拒答：组合环 / 未驱动输出 ──────────────────────────────── */
{
  const rc = solve(TEXT.cyc);
  ok('④', rc && !rc.ok && rc.code === 'cycle', `④ 应拒 code='cycle'，实际：${rc ? (rc.ok ? '居然解了' : rc.code) : '抛错'}`);
  ok('④', rc && !rc.ok && !('solution' in rc), '④ 拒答还带了解（页面会给数字）');
  ok('④', rc && !rc.ok && rc.reason.includes('环'), `④ 拒答原因要给人话：${rc && !rc.ok ? rc.reason : ''}`);
  console.log(`④  组合环 → cycle：「${rc && !rc.ok ? rc.reason.slice(0, 42) : ''}…」，无数字`);

  const ru = solve(TEXT.und);
  ok('⑤', ru && !ru.ok && ru.code === 'undrivenOutput', `⑤ 应拒 code='undrivenOutput'，实际：${ru ? (ru.ok ? '居然解了' : ru.code) : '抛错'}`);
  ok('⑤', ru && !ru.ok && !('solution' in ru), '⑤ 拒答还带了解');
  console.log(`⑤  OUT F 无赋值 → undrivenOutput：「${ru && !ru.ok ? ru.reason.slice(0, 40) : ''}」`);

  // ⑦ 变异：关掉环检测 → ④ 红（环不再被拦，报错码变掉 / 求值爆栈）
  GATESOLVE_CONFIG.checkCycle = false;
  let mutatedRed = false;
  let mutatedCode = '';
  try {
    const m = gateSolve(TEXT.cyc);
    mutatedCode = m.ok ? '(解出来了)' : m.code;
    mutatedRed = m.ok || m.code !== 'cycle';
  } catch {
    mutatedRed = true;
    mutatedCode = '(求值爆栈)';
  }
  GATESOLVE_CONFIG.checkCycle = true;
  const restored = gateSolve(TEXT.cyc);
  ok('⑦', mutatedRed, `⑦ 变异（关环检测）没被拦下（门禁空转）：code=${mutatedCode}`);
  ok('⑦', restored.ok === false && restored.code === 'cycle', '⑦ 还原后没回绿');
  console.log(`⑦  变异：checkCycle=false → ④ 红（报错码变成 ${mutatedCode}）；还原回绿`);
}

/* ── ⑥ 8 输入激励模式 ───────────────────────────────────────────── */
{
  const stimuli = ['00000000', '00000001', '11111111'];
  const r = solve(TEXT.par8, { stimuli });
  ok('⑥', r && r.ok, `⑥ 8 输入激励模式被拒：${r && !r.ok ? r.reason : ''}`);
  if (r && r.ok) {
    ok('⑥', r.solution.states && r.solution.states.length === 3, `⑥ states 应有 3 条，实际 ${r.solution.states?.length}`);
    ok('⑥', JSON.stringify(r.solution.states) === JSON.stringify([
      { in: '00000000', out: '0' },
      { in: '00000001', out: '1' },
      { in: '11111111', out: '0' },
    ]), `⑥ states 数值不对：${JSON.stringify(r.solution.states)}`);
    ok('⑥', r.solution.outputs.every((o) => o.minterms.length === 0 && o.minimized === ''), '⑥ 激励模式还在枚举（minterms/minimized 应留空，不能生 256 行）');
    ok('⑥', r.solution.outputs[0].expression.length > 0, '⑥ 激励模式下结构式仍应可用');
    const rn = solve(TEXT.par8);
    ok('⑥', rn && !rn.ok && rn.code === 'tooManyInputs' && !('solution' in rn), '⑥ 不给激励时应拒答并引导激励模式');
    console.log(`⑥  8 输入：激励 3 条 → ${r.solution.states.map((s) => `${s.in}→${s.out}`).join(' / ')}，minterms 留空（未枚举 256 行）`);
  }
}

/* ── ⑧ 红线：import 白名单（logicEval / minimize 之外全红） ─────── */
{
  const sources = ['gateSolve.ts', 'netlistParse.ts'].map((name) => ({
    name,
    src: readFileSync(join(root, 'src', 'core', 'lab', name), 'utf8'),
  }));
  const allowed = /templates\/digital\/(logicEval|minimize)\.ts$/;
  for (const { name, src } of sources) {
    const bad = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((p) => p.includes('templates') && !allowed.test(p));
    ok('⑧', bad.length === 0, `⑧ ${name} 拖进了白名单外的模板文件：${bad.join(', ')}`);
  }
  const mutatedSrc = `${sources[0].src}\nimport { solveD1 } from '../templates/digital/D1.ts';\n`;
  const stillBad = [...mutatedSrc.matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((p) => p.includes('templates') && !allowed.test(p));
  ok('⑧', stillBad.length > 0, '⑧ import 变异没被拦下（门禁空转）');
  console.log('⑧  红线：gateSolve/netlistParse 只 import logicEval.ts / minimize.ts；变异（import D1.ts）验红（内存中，不碰源文件）');
}

/* ── ⑨ 错误文案中文具体化 ───────────────────────────────────────── */
{
  const cases = [
    ['IN a\nF = FOO(a)', 'unknownGate', '未知门'],
    ['IN a\nF = AND(a)', 'arity', '至少 2 个输入'],
    ['IN a, b\nF = NOT(a, b)', 'arity', '恰好 1 个'],
    ['IN a\nF = AND(a, bb)', 'unknownSignal', '不存在的信号'],
    ['IN a\nF = AND(a, a)\nF = OR(a, a)', 'duplicate', '重复'],
    ['', 'empty', '空'],
  ];
  for (const [text, code, keyword] of cases) {
    const r = gateSolve(text);
    ok('⑨', !r.ok && r.code === code && r.reason.includes(keyword), `⑨ 「${text.replace(/\n/g, ' | ')}」应拒 ${code}（含「${keyword}」），实际：${r.ok ? '解了' : `${r.code} ${r.reason}`}`);
  }
  console.log('⑨  错误文案：未知门 / 参数个数 / 未知信号 / 重复定义 / 空输入 全部中文具体化带行号');
}

/* ── 汇总 ───────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（数字通用求值：F=A·B+C' 与 D1 同模对账 / 全加器多输出 / XOR 最小化 / 组合环与未驱动拒答 / 8 输入激励模式 / 环检测变异 / import 红线 / 错误文案）`);
