/**
 * check:r37 — R-37 功能批次门禁。
 *
 * ① 导出：viewBox / 文件名纯函数 + 白底与样式内联哨兵
 * ② 收藏：改名、标签解析、三种排序、旧数据（无 tags）兼容
 * ③ 单位：auto 档读数逐字不变（最要紧）、si / eng 换算、全局偏好生效
 * ④ 零杆：相对阈值、全零荷载、空输入
 * ⑤ 步骤导出：LaTeX / Markdown 内容、空步骤
 * ⑥ 知识库联动：solvable 优先、依据命中、去重、同学科补位
 * ⑦ 参数扫描：等距 / 对数 / 非法区间、极值、yDomain 覆盖采样点
 * ⑧ 源码哨兵：每个入口确实接在页面上（不是只有孤儿模块）
 *
 * 先装 mock localStorage 再动态 import —— units.ts / library.ts 会在模块加载时读偏好。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
};

const [fmt, units, lib, sweep, latex, kb, kbIndex, zero, exp] = await Promise.all([
  import('../src/core/format.ts'),
  import('../src/core/units.ts'),
  import('../src/core/lab/library.ts'),
  import('../src/core/parameterSweep.ts'),
  import('../src/core/latexExport.ts'),
  import('../src/kb/related.ts'),
  import('../src/kb/index.ts'),
  import('../src/core/lab/zeroForce.ts'),
  import('../src/ui/exportGraph.ts'),
]);

let checks = 0;
const problems = [];
function ok(rule, condition, detail) {
  checks += 1;
  if (!condition) problems.push(`${rule} ${detail}`);
}
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ① 导出 ───────────────────────────────────────────────────────── */
const vb = exp.parseViewBox('10 20 300 150');
ok('①', vb.x === 10 && vb.y === 20 && vb.w === 300 && vb.h === 150, 'viewBox 解析');
ok('①', exp.parseViewBox(null).w === 800 && exp.parseViewBox(null).h === 600, '坏 viewBox 回退');
ok('①', exp.parseViewBox('0 0 0 0').w === 800, '零尺寸不生成 0 宽 SVG');
ok('①', exp.parseViewBox('0 0 -5 0').w > 0, '负尺寸取绝对值后仍为正');
ok('①', exp.graphFileName('A1', 'svg') === 'SolveDeck-A1-装配图.svg', 'SVG 文件名');
ok('①', !exp.graphFileName('a/../b', 'png').includes('/'), '文件名不含路径分隔符');
const exportSrc = read('src/ui/exportGraph.ts');
ok('①', exportSrc.includes('LIGHT_VARS') && exportSrc.includes('getComputedStyle'), '样式内联');
ok('①', exportSrc.includes("fill', '#ffffff'") || exportSrc.includes("'#ffffff'"), '导出白底');
ok('①', exportSrc.includes('XMLSerializer'), '序列化独立 SVG');

/* ② 收藏 ───────────────────────────────────────────────────────── */
const base = (id, title, at) => ({ id, templateId: 'A1', title, payload: 'p', at, dirty: true });
ok('②', JSON.stringify(lib.parseTags('分压, 作业，实验 分压')) === JSON.stringify(['分压', '作业', '实验']), '标签分隔与去重');
ok('②', lib.parseTags('a,b,c,d,e,f,g').length === 6, '标签上限 6');
const lib0 = { history: [], favorites: [base('1', '甲', 100)] };
ok('②', lib.renameFavorite(lib0, '1', '  乙  ').favorites[0].title === '乙', '改名去空白');
ok('②', lib.renameFavorite(lib0, '1', '   ').favorites[0].title === '甲', '空名不收');
ok('②', JSON.stringify(lib.setFavoriteTags(lib0, '1', ['x']).favorites[0].tags) === '["x"]', '写标签');
const many = { history: [], favorites: [base('1', '丙', 100), base('2', '甲', 300), base('3', '乙', 200)] };
const byName = lib.sortFavorites(many.favorites, 'name');
ok('②', byName.every((item, i) => i === 0 || byName[i - 1].title.localeCompare(item.title, 'zh-CN') <= 0), '按名称排序单调');
ok('②', lib.sortFavorites(many.favorites, 'recent').map((i) => i.id).join('') === '231', '按时间倒序');
ok('②', lib.sortFavorites(many.favorites, 'template').length === 3, '按题型排序稳定');
ok('②', many.favorites[0].title === '丙', '排序不改原数组');
mem.set(lib.LIBRARY_STORAGE_KEY, JSON.stringify({ history: [], favorites: [base('old', '旧记录', 1)] }));
ok('②', lib.loadLibrary().favorites.length === 1, '旧数据（无 tags）仍可载入');
ok('②', lib.loadLibrarySort() === 'recent', '排序偏好默认最近');

/* ③ 单位 ───────────────────────────────────────────────────────── */
ok('③', fmt.formatScalar(100000, 'Ω') === '100kΩ', 'auto 逐字不变：大电阻');
ok('③', fmt.formatScalar(0.001, 'A') === '1mA', 'auto 逐字不变：小电流');
ok('③', fmt.formatScalar(2, 'm') === '2.00 m', 'auto 逐字不变：长度');
ok('③', fmt.formatScalar(30, 'MPa') === '30.0 MPa', 'auto 逐字不变：应力');
ok('③', units.forceUnitText(1, '', 'auto') === null, 'auto 不改写');
ok('③', fmt.formatScalar(100000, 'Ω', 'si') === '100000 Ω', 'si 去前缀');
ok('③', fmt.formatScalar(2, 'kN', 'si') === '2000 N', 'si kN→N');
ok('③', fmt.formatScalar(30, 'MPa', 'si') === '30 MPa', 'si 应力保持 MPa（全覆盖 F1：不折回生 Pa）');
ok('③', fmt.formatScalar(2000, 'N', 'eng') === '2 kN', 'eng N→kN');
ok('③', fmt.formatScalar(0.002, 'm', 'eng') === '2.0 mm', 'eng 小长度→mm');
ok('③', units.forceUnitText(1, 'V', 'eng') === null, 'eng 电气量交回 auto');
units.setUnitMode('si');
ok('③', units.getUnitMode() === 'si' && fmt.formatScalar(100000, 'Ω') === '100000 Ω', '全局偏好即时生效');
ok('③', mem.get(units.UNIT_MODE_KEY) === 'si', '单位偏好落盘');
units.setUnitMode('auto');
ok('③', fmt.formatScalar(100000, 'Ω') === '100kΩ', '切回 auto 完全复原');

/* ④ 零杆 ───────────────────────────────────────────────────────── */
const frame = (forces) => ({ memberEndForces: forces });
const z1 = zero.zeroForceMembers(frame([
  { edgeId: 'a', N: [0, 0] }, { edgeId: 'b', N: [100, 100] }, { edgeId: 'c', N: [1e-12, -1e-12] },
]));
ok('④', z1.ids.length === 2 && z1.ids.includes('a') && z1.ids.includes('c'), '相对阈值判零杆');
ok('④', z1.total === 3 && z1.scale === 100, '尺度与总数');
ok('④', zero.zeroForceMembers(frame([{ edgeId: 'a', N: [0, 0] }])).noLoad === true, '全零荷载不误判');
ok('④', zero.zeroForceMembers(null).ids.length === 0, '空输入不炸');
ok('④', zero.zeroForceMembers(frame([{ edgeId: 'a', N: [1e-3, 1e-3] }, { edgeId: 'b', N: [1e6, 1e6] }])).ids.join('') === 'a', '相对判据跨量级');

/* ⑤ 步骤导出 ───────────────────────────────────────────────────── */
const steps = [{ i: 0, title: '列 KVL', formula_tex: 'V_{out}=V_s', substitution: '5-2', value: '3 V', basis: '基尔霍夫电压定律', highlight: [] }];
const tex = latex.stepsToLatex('分压电路', steps);
const md = latex.stepsToMarkdown('分压电路', steps);
ok('⑤', tex.includes('\\begin{enumerate}') && tex.includes('\\end{enumerate}'), 'LaTeX 列表');
ok('⑤', tex.includes('V_{out}=V_s') && tex.includes('3 V'), '公式与得数不丢');
ok('⑤', md.includes('$$V_{out}=V_s$$') && md.includes('## 分压电路'), 'Markdown 公式');
ok('⑤', latex.stepsToLatex('x', []) === '' && latex.stepsToMarkdown('x', []) === '', '空步骤返回空串');

/* ⑥ 知识库联动 ─────────────────────────────────────────────────── */
const solvable = kbIndex.KB.find((entry) => entry.solvable);
ok('⑥', Boolean(solvable), 'KB 有 solvable 挂接');
if (solvable) {
  const links = kb.kbLinksFor({ templateId: solvable.solvable.templateId, subject: solvable.subject, bases: [], limit: 5 });
  ok('⑥', links.length > 0 && links[0].reason === '本题对应的知识点', '直接挂接优先');
  ok('⑥', links.every((link) => link.href.startsWith('#/kb/')), '链接指向知识库');
  ok('⑥', new Set(links.map((link) => link.id)).size === links.length, '结果去重');
  ok('⑥', links.length <= 5, 'limit 生效');
}
const byBasis = kb.kbLinksFor({ templateId: '不存在的题型', subject: 'circuit', bases: [kbIndex.KB[0].title], limit: 5 });
ok('⑥', byBasis.some((link) => link.reason.startsWith('步骤依据')), '依据命中知识点');
ok('⑥', kb.kbLinksFor({ templateId: 'X', bases: [], limit: 3 }).length === 0, '无映射不硬凑');
const analogLinks = kb.kbLinksFor({ templateId: 'A1', subject: 'analog', bases: [], limit: 5 });
ok('⑥', analogLinks.length > 0 && analogLinks[0].reason === '本题对应的知识点', 'analog 别名映射到 circuit 学科');

/* ⑦ 参数扫描 ───────────────────────────────────────────────────── */
ok('⑦', JSON.stringify(sweep.sweepAxis(0, 10, 3)) === '[0,5,10]', '等距采样');
const logAxis = sweep.sweepAxis(1, 100, 3, true);
ok('⑦', Math.abs(logAxis[1] - 10) < 1e-9, '对数采样');
ok('⑦', sweep.sweepAxis(5, 5, 3).length === 0 && sweep.sweepAxis(1, 0, 3).length === 0, '非法区间返回空');
ok('⑦', sweep.sweepAxis(0, 1, 999).length === 81, '采样数上限');
const ext = sweep.sweepExtrema([[0, 1], [1, 5], [2, -3]]);
ok('⑦', ext.max.y === 5 && ext.max.x === 1 && ext.min.y === -3, '极值如实取采样点');
ok('⑦', sweep.sweepExtrema([]) === null, '空点集');
const chart = sweep.buildSweepChart({ key: 'R', xLabel: 'R (Ω)', yLabel: 'Vout', unit: 'Ω', title: '扫描', points: [[0, -3], [1, 5]] });
ok('⑦', chart && chart.yDomain[0] <= -3 && chart.yDomain[1] >= 5, 'yDomain 覆盖全部采样点');
ok('⑦', chart.series[0].points.length === 2, 'series 点数');
ok('⑦', sweep.buildSweepChart({ key: 'R', xLabel: '', yLabel: '', unit: '', title: '', points: [[0, 1]] }) === null, '单点不成图');

/* ⑧ 源码哨兵 ───────────────────────────────────────────────────── */
const lab = read('src/pages/Lab.tsx');
const result = read('src/pages/Result.tsx');
const grid = read('src/render/SpecGrid.tsx');
const okIn = (file, text, rule, detail) => ok(rule, text.includes(file), detail);
okIn('export-toggle', lab, '⑧', '导出按钮接在装配台');
okIn('export-svg', lab, '⑧', 'SVG 入口');
okIn('export-png', lab, '⑧', 'PNG 入口');
okIn('library-sort', lab, '⑧', '收藏排序');
okIn('favorite-edit-form', lab, '⑧', '收藏编辑表单');
okIn('unit-mode-lab', lab, '⑧', '装配台单位切换');
okIn('zero-member-toggle', lab, '⑧', '零杆开关');
okIn('highlightWires: showZeroMembers', lab, '⑧', '零杆高亮传到画布');
okIn('zero-member-highlight', grid, '⑧', '画布渲染零杆高亮');
okIn('copy-steps-latex', result, '⑧', 'LaTeX 复制入口');
okIn('copy-steps-markdown', result, '⑧', 'Markdown 复制入口');
okIn('kb-links', result, '⑧', '知识库联动面板');
okIn('unit-mode-result', result, '⑧', '结果页单位切换');
okIn('sweep-run', result, '⑧', '扫描运行按钮');
okIn('sweep-extrema', result, '⑧', '扫描极值读数');
okIn('buildSweepChart', result, '⑧', '扫描走纯函数建图');

/* ── 汇总 ─────────────────────────────────────────────────────── */
if (problems.length > 0) {
  console.log(`FAIL：${problems.length} / ${checks} 项`);
  for (const problem of problems) console.log('  ✗', problem);
  process.exit(1);
}
console.log(`PASS：${checks} 项（R-37：导出 / 收藏管理 / 单位制 / 零杆 / 步骤导出 / KB 联动 / 参数扫描 / 源码哨兵）`);
