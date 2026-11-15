/**
 * check:r39 — bsk 全面检查（R-39）发现的三个问题的防回归门禁。
 *
 * ① 连续改负值标签累积负号：deviceName 不再把负号留在名字里，且能自愈历史脏标签
 * ② S5 骨架看不到零杆判据：模板解分支透出 zeroMembers 结论（只读，不改 solver）
 * ③ 折叠 details 控件仍可交互：收起时移出渲染与可访问性树
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteLabel } from '../src/core/lab/ops.ts';
import { templateZeroForceInfo, zeroForceMembers } from '../src/core/lab/zeroForce.ts';
import { solveS5, s5Params } from '../src/core/templates/statics/S5.ts';
import { slantedMemberNote } from '../src/core/lab/geometry.ts';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
let checks = 0;
const problems = [];
function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} ${detail}`);
}

/* ── ① 标签重写：负值 / 连续改值 / 历史脏标签自愈 ───────────────── */
ok('①', rewriteLabel('vsrc', 'Vs 5V', -5) === 'Vs -5V', '单次改负值不该多出负号');
ok('①', rewriteLabel('vsrc', 'Vs -5V', -0.5) === 'Vs -0.5V', '负值→负值不累积');
ok('①', rewriteLabel('vsrc', 'Vs -0.5V', 3) === 'Vs 3V', '负值→正值不残留负号');
// 用户实测的触发链：-5 → -0.5 → 3 → -2 → -2
let chain = 'Vs 5V';
const chainLabels = [];
for (const value of [-5, -0.5, 3, -2, -2]) {
  chain = rewriteLabel('vsrc', chain, value);
  chainLabels.push(chain);
}
ok('①', chain === 'Vs -2V', `连续改值链被污染：${chainLabels.join(' → ')}`);
ok('①', !chainLabels.some((label) => /-\s*-/.test(label)), '任意一步都不该出现双负号');
// 历史脏标签（已经写进 ?g= 分享 / 收藏的图）要能自愈
for (const dirty of ['Vs - -0.5V', 'Vs - - 3V', 'Vs - - -2V']) {
  ok('①', rewriteLabel('vsrc', dirty, 7) === 'Vs 7V', `脏标签未自愈：${dirty}`);
}
// 原有语义不能坏：名字带编号 / 带等号 / 各种单位后缀 / 无标签
ok('①', rewriteLabel('res', 'Rc 2.0k', 4700) === 'Rc 4.7k', 'Rc 2.0k → Rc 4.7k');
ok('①', rewriteLabel('vsrc', 'P1 = 10 kN', 20) === 'P1 20V', '带等号的标签保留名字');
ok('①', rewriteLabel('vsrc', 'R1 1k', 5) === 'R1 5V', '名字里的数字编号保留');
ok('①', rewriteLabel('vsrc', 'Q1 2mA', 3) === 'Q1 3V', 'Q1 保留');
ok('①', rewriteLabel('vsrc', undefined, 5) === 'vsrc 5V', '无标签回落到 kind');
ok('①', rewriteLabel('cap', 'C 10nF', 1e-8) === 'C 10nF', '电容格式不受影响');

/* ── ② 模板解零杆结论（S5 骨架 F 档） ─────────────────────────── */
// 用真实 solver 输出，而不是手写假数据
const s5 = solveS5(s5Params({ L: 4, H: 2, P: 10 }));
const info = templateZeroForceInfo(s5);
ok('②', info !== null, 'S5 解应透出零杆结论');
ok('②', info?.source === 'template', '来源标记必须是 template');
ok('②', info?.total === 0, `S5 默认工况零杆应为 0 根，实得 ${info?.total}`);
ok('②', Array.isArray(info?.ids) && info.ids.length === 0, '模板分支不假装能高亮（ids 为空）');
ok('②', /零杆/.test(info?.reason ?? ''), '理由里要提到零杆');
ok('②', /两杆节点|外载|支座节点/.test(info?.reason ?? ''), '理由要含课本判据（不是空话）');
ok('②', templateZeroForceInfo(null) === null, '无解时不硬凑');
ok('②', templateZeroForceInfo({ result: { status: 'ok' }, steps: [], confidence: { checks: [] } }) === null,
  '没有 zeroMembers 字段的题型不该出现按钮');
ok('②', templateZeroForceInfo({ result: { zeroMembers: 'NaN' } }) === null, '非法数量要挡住');
ok('②', templateZeroForceInfo({ result: { zeroMembers: -1 } }) === null, '负数量要挡住');
// 与通用解的判据互不干扰
const frame = zeroForceMembers({ memberEndForces: [{ edgeId: 'e-AB', N: [0, 0] }, { edgeId: 'e-AC', N: [10, 10] }] });
ok('②', frame.source === 'frame' && frame.ids.join() === 'e-AB', '通用解仍按相对轴力判定');
ok('②', zeroForceMembers(null).ids.length === 0, '空输入不炸');

/* ── ③ 折叠面板 + 源码哨兵 ───────────────────────────────────── */
const css = read('src/ui/tokens.css');
const lab = read('src/pages/Lab.tsx');
const zeroSrc = read('src/core/lab/zeroForce.ts');
ok('③', /details:not\(\[open\]\) > :not\(summary\)\s*\{\s*display: none/.test(css),
  '折叠内容收起时必须 display:none（含 !important 也允许）');
ok('③', !css.includes('details:not([open]) > :not(summary) {\n  display: block'), '别把规则写反');
ok('③', zeroSrc.includes('templateZeroForceInfo') && zeroSrc.includes('零杆'), '模板零杆纯函数存在');
ok('③', lab.includes('templateZeroForceInfo(solution)'), '装配台接上模板零杆结论');
ok('③', lab.includes('zero-member-note') && lab.includes('zeroFromTemplate'), '模板分支给可见理由');
ok('③', lab.includes("generic?.frame || zeroFromTemplate"), '按钮条件不再只看 generic.frame');
ok('③', lab.includes('零杆判据 · ${zeroInfo.total} 根'), '模板分支文案区分「判据」与「高亮」');
/* deviceName 已抽到 labels.ts（ops.ts 与 picks.ts 共用，避免模块环）。 */
ok('③', /replace\(\/\\s\+\(\?:\[\+-\]\\s\*\)\*\[\\d\.\]\.\*\$/.test(read('src/core/lab/labels.ts')),
  'deviceName 剥数值尾巴（符号+空白可重复，能自愈历史脏标签）');
// 反向断言只看真正的代码行（注释里会引用旧写法，裸 includes 会假红）
const opsCode = read('src/core/lab/ops.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
ok('③', !/split\(\/\[\\d\.\]\/\)\[0\]/.test(opsCode), '旧的会累积负号的切分方式已移除');

/* ── ④ 非水平构件提示不该误报桁架（真机截图发现） ───────────── */
const slanted = (tid, by) => ({
  templateId: tid, family: 'beam', meta: {},
  nodes: [{ id: 'a', x: 0, y: 0, kind: 'pin' }, { id: 'b', x: 0, y: by, kind: 'pin' }],
  edges: [{ id: 'e', from: 'a', to: 'b', kind: 'line' }],
});
ok('④', slantedMemberNote(slanted('M3', 100)) !== null, '单跨梁竖直杆仍要提示');
ok('④', slantedMemberNote(slanted('S5', 100)) === null, 'S5 桁架斜杆是合法构件，不该报不适用');
ok('④', slantedMemberNote(slanted('S3', 100)) === null, 'S3 任意力系不该报不适用');
ok('④', slantedMemberNote(slanted(undefined, 100)) !== null, '无 templateId 的旧图保持原行为');
ok('④', read('src/core/lab/geometry.ts').includes('BEAM_AXIS_TEMPLATES'), '白名单源码哨兵');

/* ── 汇总 ─────────────────────────────────────────────────────── */
if (problems.length > 0) {
  console.log(`FAIL：${problems.length} / ${checks} 项`);
  for (const problem of problems) console.log('  ✗', problem);
  process.exit(1);
}
console.log(`PASS：${checks} 项（R-39：负号标签 / S5 零杆判据 / 折叠面板 a11y / 桁架提示误报）`);
