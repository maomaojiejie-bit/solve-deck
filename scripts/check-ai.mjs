/**
 * check:ai（R3-2 §5 改写）：AI 只剩识图，且默认关。
 *
 * 这一道守的是「不该发请求的地方一次都不发」：
 *  ① 源码里 `https?://` **只许**出现在 `src/core/ai/config.ts`；
 *  ② 该文件零 import（配置是常量，不许反过来依赖请求模块）；
 *  ③ `sk-` 全项目只出现 1 次（那把 key）；
 *  ④ 页面默认态零 fetch：`#/solve` 里没有请求代码、也没 import 识图模块；
 *  ⑤ 设置抽屉（BYOK）的 DOM / storage key 全部不存在；
 *  ⑥ 规则解析照旧（12 例）—— 撤掉 AI 不等于降级读题能力。
 *
 * 变异（写进报告）：把 config.ts 的 `maxTokens: 900` 改成 400 → ⑦ 必红；
 * 往 Solve.tsx 塞一句 `fetch(` → ④ 必红。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftUrl, parseProblem } from '../src/core/ai/parse.ts';
import { parseByRule, unknownUnits } from '../src/core/ai/rule.ts';
import { checkDraft, hasBareResult } from '../src/core/ai/validate.ts';
import { AI_CONFIG, VISION_CONFIG } from '../src/core/ai/config.ts';
import { buildStructurePrompt, describeProviderError, extractJson, ProviderError } from '../src/core/ai/provider.ts';
import { isVisionEnabled, visionUsesLeft } from '../src/core/ai/vision.ts';
import { getTemplateRoute, TEMPLATES } from '../src/core/templates/registry.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const REL = 1e-12;

const problems = [];
let checks = 0;

function fail(id, rule, detail) {
  problems.push(`${id} / ${rule} / ${detail}`);
}

function ok(id, rule, condition, detail) {
  checks += 1;
  if (!condition) fail(id, rule, detail);
}

function near(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= REL * scale;
}

const read = (relative) => readFileSync(join(root, relative), 'utf8');

/* ── ① 网址只许在 config.ts ─────────────────────────────────────── */

const walk = (dir) => {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|css|html|json)$/.test(item.name)) out.push(path);
  }
  return out;
};

const files = [...walk(join(root, 'src')), join(root, 'index.html')];
const leaky = [];
const skHits = [];
for (const file of files) {
  const name = file.slice(root.length).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  if (/https?:\/\//.test(text) && name !== 'src/core/ai/config.ts') leaky.push(name);
  const count = (text.match(/sk-/g) ?? []).length;
  if (count > 0) skHits.push({ name, count });
}
ok('url', '①', leaky.length === 0, `config.ts 之外还有网址：${leaky.join(', ')}`);
ok('url', '①', /https:\/\//.test(read('src/core/ai/config.ts')), 'config.ts 里没有 baseURL');

const configSource = read('src/core/ai/config.ts');
ok('url', '②', !/^\s*import\s/m.test(configSource), 'config.ts 出现了 import（它只能是常量）');
ok('url', '②', !/fetch\s*\(|XMLHttpRequest|axios/.test(configSource), 'config.ts 里有请求代码');

const skTotal = skHits.reduce((sum, item) => sum + item.count, 0);
ok('key', '③', skTotal === 1, `sk- 出现 ${skTotal} 次（应为 1）：${JSON.stringify(skHits)}`);
ok('key', '③', skHits[0]?.name === 'src/core/ai/config.ts', `那把 key 不在 config.ts：${skHits[0]?.name}`);

/* ── ④ 页面默认态零 fetch ──────────────────────────────────────── */

const solveSource = read('src/pages/Solve.tsx');
const labSource = read('src/pages/Lab.tsx');
const homeSource = read('src/pages/Home.tsx');

ok('fetch', '④', !/\bfetch\s*\(/.test(solveSource), '#/solve 里出现了 fetch（这一页不该有请求代码）');
ok('fetch', '④', !/core\/ai\/vision/.test(solveSource), '#/solve import 了识图模块（默认关就不该连代码路径）');
ok('fetch', '④', !/\bfetch\s*\(/.test(homeSource), '首页出现了 fetch');
ok(
  'fetch',
  '④',
  /isVisionEnabled/.test(labSource) && /data-testid="vision-switch"/.test(labSource),
  '装配台的「高级」里没有识图开关',
);
ok('fetch', '④', /data-testid="vision-read"/.test(labSource), '装配台没有「让 AI 看一眼」按钮（点了才发请求）');
ok('fetch', '④', /keepOnFailure/.test(labSource), '失败路径没走 keepOnFailure（AI 挂了可能清空结果）');
ok('fetch', '④', !/makeChatProvider|loadSettings|saveSettings|presets/.test(solveSource + labSource), '页面还引着 BYOK 的旧模块');

// 默认关：没有开关时 isVisionEnabled() === false，且配额是满的
ok('fetch', '④', VISION_CONFIG.defaultOn === false, `VISION_CONFIG.defaultOn 应 false，实际 ${VISION_CONFIG.defaultOn}`);
ok('fetch', '④', isVisionEnabled() === false, '默认态 isVisionEnabled() 返回了 true');
ok(
  'fetch',
  '④',
  visionUsesLeft() === VISION_CONFIG.maxPerSession,
  `默认态配额应 ${VISION_CONFIG.maxPerSession}，实际 ${visionUsesLeft()}`,
);

/* ── ⑤ BYOK 的痕迹全部不存在 ───────────────────────────────────── */

const aiSettingsHits = files.filter((file) => readFileSync(file, 'utf8').includes('data-testid="ai-settings"'));
ok('byok', '⑤', aiSettingsHits.length === 0, `还有设置抽屉：${aiSettingsHits.map((f) => f.slice(root.length)).join(', ')}`);
for (const word of ['sd.ai.v1', 'apiKey（可选）', '自带 key', 'BYOK', 'proxyURL']) {
  const hits = files.filter((file) => readFileSync(file, 'utf8').includes(word));
  ok('byok', '⑤', hits.length === 0, `源码里还有「${word}」：${hits.map((f) => f.slice(root.length)).join(', ')}`);
}
// 地址/密钥只许在 ai/ 目录里（页面与求解器不该知道这些字段名）
const baseUrlOutside = files
  .filter((file) => !file.slice(root.length).replace(/\\/g, '/').startsWith('src/core/ai/'))
  .filter((file) => /baseURL|apiKey/.test(readFileSync(file, 'utf8')));
ok(
  'byok',
  '⑤',
  baseUrlOutside.length === 0,
  `ai/ 之外还有 baseURL/apiKey：${baseUrlOutside.map((f) => f.slice(root.length)).join(', ')}`,
);
ok('byok', '⑤', !/设置/.test(solveSource) || !/localStorage/.test(solveSource), '#/solve 还写着本机存储的配置');

/* ── ⑥ 规则解析照旧（AI 撤走不等于读题变弱） ───────────────────── */

const RULE_CASES = [
  { text: '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力与弯矩图', id: 'M3-cantilever', params: { L: 2, P: 10, a: 2 } },
  { text: '简支梁 L=4m，跨中作用集中力 20kN，画剪力图与弯矩图', id: 'M3', params: { L: 4, P: 20, a: 2 } },
  { text: '轴向拉杆 L=1m，A=200mm²，P=40kN，E=200GPa，求伸长量', id: 'M1', params: { L: 1, A: 200, P: 40, E: 200 } },
  { text: '圆轴 d=40mm，传递扭矩 T=1.0kN·m，G=80GPa，求最大切应力', id: 'M2', params: { d: 40, T: 1, G: 80 } },
  { text: '矩形截面梁 b=100mm，h=200mm，简支跨中受 20kN，求最大弯曲正应力', id: 'M4', params: { b: 100, h: 200, P: 20 } },
  { text: '简支梁 L=4m，跨中集中力 20kN，E=200GPa，求最大挠度', id: 'M5', params: { L: 4, E: 200, P: 20, a: 2 } },
  { text: 'σx=100MPa，σy=-20MPa，τxy=40MPa，求主应力', id: 'M6', params: { sx: 100, sy: -20, txy: 40 } },
  { text: '两端铰支压杆 L=2m，b=60mm，h=60mm，E=200GPa，压力 150kN，校核稳定', id: 'M7', params: { L: 2, b: 60, h: 60, E: 200, P: 150 } },
  { text: '共源放大器 gm=1mS，Rd=2kΩ，Rl=10kΩ，求电压增益', id: 'A5', params: { Rd: 2000, Rl: 10000 } },
  { text: '三角桁架 L=2m，H=1m，顶点载荷 10kN，求各杆内力', id: 'S5', params: { L: 2, H: 1, P: 10 } },
  { text: '斜面摩擦 μ=0.3，W=200N，α=30°，求临界拉力', id: 'S4', params: { mu: 0.3, W: 200, alpha: 30 } },
  { text: '静不定梁，两端固定铰，L=4m，P=10kN，判断能否求解', id: 'S1-indeterminate', params: { L: 4, P: 10 } },
];

let rulePass = 0;
for (const item of RULE_CASES) {
  const parsed = parseByRule(item.text);
  ok('rule', '⑥', parsed !== null, `「${item.text}」一条规则都没命中`);
  if (!parsed) continue;
  ok('rule', '⑥', parsed.templateId === item.id, `「${item.text}」命中 ${parsed.templateId}，应为 ${item.id}`);
  for (const [key, want] of Object.entries(item.params)) {
    ok('rule', '⑥', near(parsed.params[key], want), `「${item.text}」的 ${key} 抽到 ${parsed.params[key]}，应为 ${want}`);
  }
  const specs = new Set((getTemplateRoute(parsed.templateId)?.entry.params ?? []).map((param) => param.key));
  for (const key of Object.keys(parsed.params)) {
    ok('rule', '⑥', specs.has(key), `${parsed.templateId} 的 ${key} 不在 ParamSpec 里`);
  }
  const checked = checkDraft(
    { templateId: parsed.templateId, params: parsed.params, reason: parsed.reason, unsure: parsed.unsure },
    item.text,
    'rule',
  );
  ok('rule', '⑥', checked.draft !== null, `「${item.text}」过不了 checkDraft：${checked.issues.join('；')}`);
  if (checked.draft) {
    const url = draftUrl(checked.draft);
    ok('rule', '⑥', typeof url === 'string' && url.startsWith(`#/t/${item.id}`), `「${item.text}」生成 URL 失败：${url}`);
  }
  rulePass += 1;
}

// 规则路径的编排：零请求、纯本地、有图也只作参照
const noAi = await parseProblem({ text: '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力' });
ok('rule', '⑥', noAi.draft?.source === 'rule', `无 AI 时 source 应为 rule，实际 ${noAi.draft?.source}`);
ok('rule', '⑥', noAi.attempts === 0, `规则路径不该有调用次数，实际 ${noAi.attempts}`);
ok('rule', '⑥', noAi.notes.some((note) => note.includes('规则解析')), `没写明走了规则解析：${noAi.notes.join(' / ')}`);
ok('rule', '⑥', noAi.jumpable === true, `规则结果应可跳转：${noAi.issues.join('；')}`);

const withImage = await parseProblem({
  text: '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力',
  images: ['data:image/jpeg;base64,/9j/AAAA'],
});
ok('rule', '⑥', withImage.notes.some((note) => note.includes('图片只作参照')), `没说明图片只作参照：${withImage.notes.join(' / ')}`);
ok('rule', '⑥', withImage.draft?.params.P === 10, '有图时规则参数丢了');

// 裸结果 / 越界 / 单位：三条老规矩一条没松
ok('rule', '⑥', hasBareResult('Av=-46.25'), 'hasBareResult 没认出 Av=-46.25');
ok(
  'rule',
  '⑥',
  checkDraft({ templateId: 'A3', params: { beta: 100 }, reason: 'Av=-46.25' }, '', 'ai').draft === null,
  '带数值结论的 draft 没被作废',
);
const wide = checkDraft({ templateId: 'A3', params: { Rc: 999999 }, reason: '共射' }, '', 'ai');
ok('rule', '⑥', wide.draft?.params.Rc === 999999, '越界值被夹取了');
ok('rule', '⑥', wide.jumpable === false, '越界却允许跳转');
ok('rule', '⑥', unknownUnits('端部作用 10kgf 的力').includes('kgf'), 'unknownUnits 没抓出 kgf');

/* ── ⑦ 配置本身的三条硬事实 ───────────────────────────────────── */

ok('config', '⑦', AI_CONFIG.model === 'deepseek-flash', `model 应为 deepseek-flash，实际 ${AI_CONFIG.model}`);
ok('config', '⑦', AI_CONFIG.maxTokens >= 600, `maxTokens 必须 ≥600（thinking 吃预算），实际 ${AI_CONFIG.maxTokens}`);
ok('config', '⑦', AI_CONFIG.timeoutMs >= 10000, `timeoutMs 太小：${AI_CONFIG.timeoutMs}`);
ok('config', '⑦', VISION_CONFIG.maxPerSession === 3, `每会话上限应为 3，实际 ${VISION_CONFIG.maxPerSession}`);

const prompt = buildStructurePrompt();
for (const entry of TEMPLATES.filter((one) => one.status === 'ready')) {
  ok('config', '⑦', prompt.includes(`- ${entry.id}: `), `prompt 少了模板 ${entry.id}`);
}
ok('config', '⑦', prompt.includes('禁止计算任何结果'), 'prompt 少了「禁止计算任何结果」');
ok('config', '⑦', prompt.includes('只输出 JSON'), 'prompt 少了「只输出 JSON」');
ok('config', '⑦', extractJson('```json\n{"templateId":"A3"}\n```')?.templateId === 'A3', 'extractJson 没剥掉围栏');
ok(
  'config',
  '⑦',
  !/https?:\/\//.test(describeProviderError(new ProviderError('x', 'network'))),
  '错误话术里出现了网址（地址只该在 config.ts）',
);

// provider 里不许出现「拿 reasoning_content 当答案」的写法
const providerSource = read('src/core/ai/provider.ts');
ok('config', '⑦', /message\?\.content/.test(providerSource), 'provider 没读 message.content');
ok(
  'config',
  '⑦',
  !/return\s+[^;\n]*reasoning_content\s*(?:\?\?|\|\||as)/.test(providerSource),
  'provider 把 reasoning_content 当成了答案',
);

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 项`);
  for (const problem of problems.slice(0, 30)) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `PASS：${checks} 项（AI 收口：网址只在 config.ts / sk- 唯一 / 默认态零 fetch / 设置抽屉不复存在 / 规则解析 ${rulePass} 例 / 配置三条硬事实）`,
);
