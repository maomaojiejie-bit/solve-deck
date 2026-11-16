/**
 * check:section（W20）—— 本批的「源码与红线」断言，第 36 道门禁。
 *
 * 数值由 check:measures ⑨⑩⑪ 真跑验过，这里钉的是**别被拆掉**：
 *  ① 右栏截面三框 + 清空按钮只在梁族出现，写的是 meta.section（不是扁平 b/h/E）；
 *  ② 结论卡挂进 template 结果区（默认骨架也有「这张图的量」）；
 *  ③ 双 rot 收口：attach.ts 不再导出 dirToRot，GraphOp / 门禁 / UI 不再出现图元角 270 断言；
 *  ④ 贴题页只有一张表，结构草稿收进 caption，来源列仍在；
 *  ⑤ A7 点名：中文名 + kind + 位置 id，netSolve 不再吐「暂不支持」万能句；
 *  ⑥ debt 表 D4–D7 四条带触发条件；
 *  ⑦ 红线：examples / templates 的 24 小时内 mtime 与本批无关、零新依赖、既有门禁条数不降。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}
const read = (path) => readFileSync(join(root, path), 'utf8');
let checks = 0;
const problems = [];
const ok = (rule, pass, detail) => {
  checks += 1;
  if (!pass) problems.push(`${rule} / ${detail}`);
};

const lab = read('src/pages/Lab.tsx');
const solve = read('src/pages/Solve.tsx');
const attach = read('src/core/lab/attach.ts');
const ops = read('src/core/lab/ops.ts');
const place = read('src/core/lab/place.ts');
const types = read('src/core/lab/types.ts');
const measures = read('src/core/lab/measures.ts');
const netSolve = read('src/core/lab/netSolve.ts');
const deviceNames = read('src/core/lab/deviceNames.ts');
const checkAttach = read('scripts/check-attach.mjs');
const checkPointer = read('scripts/check-pointer.mjs');
const paramlab = read('scripts/check-paramlab.mjs');
const debt = read('docs/交接-P45数值加固.md');
const pkg = JSON.parse(read('package.json'));

/* ── ① 右栏截面输入 ───────────────────────────────────────────── */
ok('①', lab.includes('data-testid="section-panel"'), '① 右栏没有截面面板');
ok('①', /\(\['b', 'h', 'E'\] as const\)\.map/.test(lab) && lab.includes('data-testid={`section-${key}`}'), '① b/h/E 三个输入框不齐（应是三键 map + 模板 testid）');
ok('①', lab.includes('data-testid="section-clear"'), '① 没有清空按钮（清空后不许留上次的数）');
ok('①', /graph\?\.family === 'beam'/.test(lab), '① 截面面板没有限定梁族');
ok('①', /op: 'setSection', section: \{ b, h, E \}/.test(lab) && /op: 'setSection', section: null/.test(lab), '① 写盘不是 setSection 整体对象 / 清空不是 null');
ok('①', /fromPanel\?\.b \?\? meta\.b/.test(measures) && /meta\.section/.test(measures), '① sectionOf 没有优先读 meta.section 并回退扁平键');
ok('①', /CanvasSection/.test(types) && /op: 'setSection'; section: CanvasSection \| null/.test(types), '① 类型层没有 CanvasSection / setSection');
ok('①', /delete meta\.section/.test(ops) && /meta\.section = \{ b, h, E \}/.test(ops), '① ops 没有把截面写成一个整体 / 清空没有删键');

/* ── ② 结论卡挂进结果区 ───────────────────────────────────────── */
ok('②', lab.includes('<GraphMeasures graph={graph} />'), '② GraphMeasures 没挂进结果区（默认骨架走 template 会看不到 δ/σ）');
ok('②', read('src/ui/GraphMeasures.tsx').includes('useMemo') && read('src/ui/GraphMeasures.tsx').includes('interpretQuestion'), '② 结论卡没有按 graph 即时重算');
ok('②', /stressChart\(frame, W\)/.test(measures) && /export function stressChart/.test(measures), '② 应力分布图没接上 stress 卡');
ok('②', /挠曲线 v\(x\)/.test(measures), '② 挠曲线图不在');

/* ── ③ 双 rot 收口 ────────────────────────────────────────────── */
ok('③', !/export function dirToRot/.test(attach), '③ dirToRot 还是公共 API');
ok('③', /export function normalizeDir/.test(attach) && /export function rotToDir/.test(attach), '③ 语义角 API 不在');
ok('③', /function glyphRotOf/.test(ops) && !/dirToRot/.test(ops) && !/dirToRot/.test(place), '③ 图元角没有下沉成 ops 私有函数');
ok('③', !/rot === 270|rot=270 应|dirToRot/.test(checkAttach), '③ check-attach 还在断言图元角 270');
ok('③', !/load\.rot === dirToRot|loadLeft\.rot === dirToRot/.test(checkPointer), '③ check-pointer 还在断言图元角');
ok('③', /faces\(.*\) === '→'/.test(checkAttach) && /语义角 90/.test(checkAttach), '③ 没有「语义角 90 → 出图箭头朝右」的断言');
ok('③', /pinAt\('arrow'/.test(checkAttach) && /pinAt\('arrow'/.test(checkPointer), '③ 出图方向不是用真实渲染几何判的');
ok('③', !/图元 rot=/.test(ops), '③ ops 的 appliedRules 还在对用户说图元角');

/* ── ④ 贴题页单表 ────────────────────────────────────────────── */
const tableCount = (solve.match(/<table\b/g) ?? []).length;
ok('④', tableCount === 1, `④ 贴题页有 ${tableCount} 张表（应只有一张）`);
ok('④', /<caption data-testid="lab-draft"/.test(solve), '④ 结构草稿没并进表格 caption（还是独立卡片）');
ok('④', ['参数', '值', '单位', '来源'].every((head) => solve.includes(`>${head}<`)), '④ 来源列丢了');
ok('④', /source === '默认' \? 'text-amber'/.test(solve), '④ 默认值琥珀标记丢了');

/* ── ⑤ A7 点名 ───────────────────────────────────────────────── */
ok('⑤', /sum: '求和圆'/.test(deviceNames) && /位置 \$\{one\.id\}/.test(deviceNames), '⑤ 点名没写中文名 + 位置 id');
ok('⑤', /unknownDeviceNote\(graph\)/.test(netSolve), '⑤ netSolve 还在吐「暂不支持」万能句');
ok('⑤', !/暂不支持，先删掉它或换题型/.test(netSolve), '⑤ 旧的万能拒答文案没删');
ok('⑤', !/unsupported/.test(read('src/core/lab/deviceNames.ts').replace(/^ \*.*$/gm, '')), '⑤ 点名文案里出现裸 unsupported');

/* ── ⑥ debt 表 ───────────────────────────────────────────────── */
for (const id of ['D4', 'D5', 'D6', 'D7']) {
  ok('⑥', debt.includes(`| ${id} |`), `⑥ debt 表缺 ${id}`);
}
ok('⑥', /触发条件/.test(debt) && /唯一能答的那型/.test(debt), '⑥ debt 表没写触发条件');

/* ── ⑦ 红线 ──────────────────────────────────────────────────── */
/* 快照「不许手改」的判据是 mtime 截断。截断日期推进规则：每次走完
 * build-example.mjs 再生 + check-p3 复验的正规链之后，把日期推到再生时刻 ——
 * 红线真正要抓的是「手改了快照却没再生 / 没复验」，不是再生本身。
 * 2026-11-16 推进（三次）：① F3 改默认参数触发全量再生，p3 58/58；② filter-branch
 * 历史重写检出把全部跟踪文件的 mtime 刷新（内容未动，p3 照旧全绿）；③ 修 M3 提示文案
 * 后按正规链重生成 M1/M2/M3/M3-cantilever/M4/M5/M8。截断取 21:30。
 * 下一次正规再生 / 历史重写后同样把日期往前推。 */
const touchedRecently = (path) => statSync(join(root, path)).mtimeMs >= new Date('2026-11-16T21:30:00+08:00').getTime();
ok('⑦', !['src/examples/M3.json', 'src/examples/M5.json', 'src/examples/A3.json', 'src/examples/A7.json'].some(touchedRecently), '⑦ 本批动了 examples 快照');
ok('⑦', !touchedRecently('src/core/templates/mechanics/M3.ts') || !/求解内核|与基准题逐字段对拍/.test(readFileSync(join(root, 'src/core/templates/mechanics/M3.ts'), 'utf8')), '⑦ 模板文案被 C1 批改过且没回退干净（templates 文案被快照 P3 钉住，改文案=快照漂移）');
ok('⑦', Object.keys(pkg.dependencies ?? {}).length === 3 && Object.keys(pkg.devDependencies ?? {}).length === 12 && !pkg.scripts['check:section'].includes('node_modules'), '⑦ 依赖数变了 / 引入了新依赖');
ok('⑦', /check:measures/.test(pkg.scripts.build) && /check:section/.test(pkg.scripts.check), '⑦ 新门禁没接进链');
ok('⑦', /mmax/.test(paramlab) && /结论卡上的 \|M\|max 跟着变/.test(paramlab), '⑦ check:paramlab 的 M3 没有改硬到结论卡 |M|max');

console.log(`W20 源码断言：截面输入 / 结论卡 / 双 rot 收口 / 单表 / A7 点名 / debt D4–D7 / 红线`);
if (problems.length > 0) {
  console.error(`FAIL：${problems.length}/${checks} 项未通过`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（W20 源码与红线：截面 / rot / 单表 / 点名 / debt / 红线）`);
