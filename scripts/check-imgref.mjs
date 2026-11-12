/**
 * check:imgref（R3-4 U2）—— 把「图片只作参照、不参与计算」从口号变成断言。
 *
 * 四条：
 *  ① **图片不进 `params`**：同一段题面，带 3 张图与不带图各解析一次，
 *     `draft`（题型 / 参数 / 理由 / unsure）、`outOfRange`、`jumpable` 必须逐字段相等；
 *     图里故意埋了 `L=99 / P=999 / Rd=1` 这种「图上印的数」，一个都不许漏进参数。
 *  ② **图片不进 `result`**：用①的两份 draft 各跑一次 solver，`Solution` 逐字节相等
 *     （结果只由「题型 + 参数」决定），且解里不含图字节。
 *  ③ **图片不进分享链接**：`structureHrefFromDraft`（与页面同一个函数）产出的
 *     `#/lab/t/…?g=…` 逐字符相等，且链接里没有 `data:image` / 长 base64 块；
 *     `draftUrl` 的讲解链接同理。
 *  ④ **文案在位**：`#/solve` 图片区那行说明由 `IMGREF_NOTE` 渲染（`data-testid="image-ref-note"`），
 *     页面与门禁共用同一条编码函数（页面里不再自己拼链接）。
 *
 * 变异（真跑）：把 `IMGREF_CONFIG.imageReadsParams` 翻成 true → ① 必红。
 * 这条变异模拟的是「把图上印的答案 / 图注里的数字当题面」，本项目最不能犯的错。
 *
 * 零网络、零浏览器：全部在 node 里跑真实解析 + 真实 solver。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
if (!existsSync(join(root, 'src'))) {
  console.error('请在项目根目录运行');
  process.exit(1);
}

import { parseProblem, draftUrl, NOTE_IMAGE_REFERENCE } from '../src/core/ai/parse.ts';
import { IMGREF_CONFIG, IMGREF_NOTE, linkHasImageBytes, shortenHref } from '../src/core/ai/imgref.ts';
import { getTemplateRoute } from '../src/core/templates/registry.ts';
import { buildParamQuery, buildSolverInput, defaultParamValues } from '../src/core/params/query.ts';
import { labDraftFromAIDraft } from '../src/core/ai/labDraft.ts';
import { structureHrefFromDraft } from '../src/core/lab/shareLink.ts';
import { decodeSharePayload } from '../src/core/lab/composite.ts';
import { labSkeletonSpec } from '../src/core/lab/skeleton.ts';

let checks = 0;
const problems = [];
const ok = (rule, pass, detail) => {
  checks += 1;
  if (!pass) problems.push(`${rule} / ${detail}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const specOf = (id) =>
  labSkeletonSpec(id, JSON.parse(read(join('src', 'examples', `${id}.json`))).render_specs[0]);

/* ── 素材：5 段真题面 + 3 张「带数字的图」 ──────────────────────── */

const CASES = [
  '悬臂梁 L=2m，自由端集中力 10kN，求固定端反力与弯矩图',
  '简支梁 L=4m，跨中作用集中力 20kN，画剪力图与弯矩图',
  'σx=100MPa，σy=-20MPa，τxy=40MPa，求主应力',
  '斜面摩擦 μ=0.3，W=200N，α=30°，求临界拉力',
  '共源放大器 gm=1mS，Rd=2kΩ，Rl=10kΩ，求电压增益',
];

/** 图串里埋的数字就是变异要抓的「图上的数」；正常路径一个都不该被读。 */
const IMAGES = [
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD==?L=99',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD==?P=999&a=0.5',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB==?Rd=1',
];

/* ── ① 图片不进 params ───────────────────────────────────────── */

let solvedCases = 0;
let sharedCases = 0;

for (const text of CASES) {
  const plain = await parseProblem({ text });
  const withImg = await parseProblem({ text, images: IMAGES });
  const tag = text.slice(0, 12);

  ok('①', plain.draft !== null, `「${tag}…」规则解析没认出题型，这条样本没意义`);
  ok('①', same(plain.draft, withImg.draft), `「${tag}…」带图与不带图的 draft 不等：${JSON.stringify(withImg.draft?.params)}`);
  ok('①', same(plain.outOfRange, withImg.outOfRange), `「${tag}…」带图改变了 outOfRange`);
  ok('①', plain.jumpable === withImg.jumpable, `「${tag}…」带图改变了 jumpable`);
  ok('①', withImg.notes.includes(NOTE_IMAGE_REFERENCE), `「${tag}…」有图却没写「本页不读图」`);
  ok('①', !JSON.stringify(withImg).includes('999'), `「${tag}…」图里的数漏进了结果：${JSON.stringify(withImg.draft?.params)}`);

  // 只有图、没有文字：不许凭空产参数
  if (text === CASES[0]) {
    const only = await parseProblem({ text: '', images: IMAGES });
    ok('①', only.draft === null && only.jumpable === false, '只贴图时居然给出了 draft');
    ok('①', /补上|文字/.test(only.issues.join(' ')), `只贴图时的说法不清楚：${only.issues.join(' ')}`);
  }

  if (!plain.draft) continue;

  /* ── ② 图片不进 result ─────────────────────────────────────── */
  const route = getTemplateRoute(plain.draft.templateId);
  if (!route?.entry.solver) continue;
  const runResult = async (draft) => {
    const specs = route.entry.params ?? [];
    const values = defaultParamValues(specs, route.variant?.params);
    for (const [key, value] of Object.entries(draft.params)) if (key in values) values[key] = value;
    const input = buildSolverInput(route.entry, route.variant?.config, values);
    const mod = await route.entry.solver();
    return mod.default(input);
  };
  const resultA = await runResult(plain.draft);
  const resultB = await runResult(withImg.draft);
  solvedCases += 1;
  ok('②', same(resultA, resultB), `「${tag}…」带图的 Solution 与不带图不等`);
  const resultText = JSON.stringify(resultA);
  ok('②', !resultText.includes('data:image') && !resultText.includes('/9j/'), `「${tag}…」Solution 里混进了图字节`);
  ok('②', same(resultA, await runResult(plain.draft)), `「${tag}…」同一个输入两次算出的结果不同（不确定的 solver）`);

  /* ── ③ 图片不进分享链接 ────────────────────────────────────── */
  const labPlain = labDraftFromAIDraft(plain.draft);
  const labImg = labDraftFromAIDraft(withImg.draft);
  ok('③', same(labPlain, labImg), `「${tag}…」结构草稿受图片影响`);
  if (!labPlain.ok) continue;

  let spec;
  try {
    spec = specOf(labPlain.draft.templateId);
  } catch {
    continue;
  }
  const hrefPlain = structureHrefFromDraft(labPlain.draft, spec);
  const hrefImg = structureHrefFromDraft(labImg.draft, spec);
  if (hrefPlain.shared) sharedCases += 1;
  ok('③', hrefPlain.href === hrefImg.href, `「${tag}…」分享链接受图片影响：${shortenHref(hrefImg.href)}`);
  ok('③', !linkHasImageBytes(hrefPlain.href), `「${tag}…」链接里有图字节：${shortenHref(hrefPlain.href, 48)}`);
  ok('③', hrefPlain.href.length < 8000, `「${tag}…」链接 ${hrefPlain.href.length} 字符，长得不像只装结构`);

  // 链接本身是 base64：解出来看内容，才是「有没有图字节」的真证据
  const rawPayload = hrefPlain.href.split('?g=')[1]?.split('&')[0] ?? '';
  const decoded = rawPayload ? decodeSharePayload(decodeURIComponent(rawPayload)) : null;
  ok('③', decoded !== null, `「${tag}…」?g= 解不开，链接不自洽`);
  const decodedText = decoded ? JSON.stringify(decoded) : '';
  ok('③', !linkHasImageBytes(decodedText), `「${tag}…」链接解出来的结构里混着图字节`);
  ok('③', decodedText.length > 0 && decodedText.length < 4000, `「${tag}…」解出来的结构 ${decodedText.length} 字符，超出「只有骨架与参数」的量级`);

  const explainPlain = draftUrl(plain.draft);
  const explainImg = draftUrl(withImg.draft);
  ok('③', explainPlain === explainImg, `「${tag}…」讲解链接受图片影响：${explainPlain} vs ${explainImg}`);
  ok('③', explainPlain !== null && !linkHasImageBytes(explainPlain), `「${tag}…」讲解链接为空或含图字节`);

  const queryPlain = buildParamQuery(route.entry.params ?? [], Object.fromEntries(
    (route.entry.params ?? []).map((p) => [p.key, plain.draft.params[p.key] ?? p.defaultValue]),
  ), route.variant?.params);
  ok('③', !linkHasImageBytes(queryPlain), `「${tag}…」参数串里混进了图字节`);
}

ok('②', solvedCases >= 3, `② 只跑到 ${solvedCases} 条真解，断言没牙齿`);
ok('③', sharedCases >= 3, `③ 只有 ${sharedCases} 条链接真带 ?g=，断言没牙齿`);
console.log(`样本：${CASES.length} 段题面 × 3 张带数字的图 → 真解 ${solvedCases} 条、带 ?g= 链接 ${sharedCases} 条`);

/* ── ④ 文案在位 & 页面与门禁同一条路 ─────────────────────────── */

const solveSource = read('src/pages/Solve.tsx');
const parseSource = read('src/core/ai/parse.ts');
ok('④', IMGREF_NOTE.includes('不参与计算'), `IMGREF_NOTE 没把话说死：${IMGREF_NOTE}`);
ok('④', /data-testid="image-ref-note"/.test(solveSource), '#/solve 图片区没有 image-ref-note 那行说明');
ok('④', /imageRefNotice\(/.test(solveSource), '#/solve 没渲染 imageRefNotice（文案各写一份？）');
ok('④', /structureHrefFromDraft/.test(solveSource), '#/solve 没走共享链接函数');
ok('④', !/encodeSharePayload/.test(solveSource), '#/solve 还在自己拼分享链接（门禁够不着）');
ok('④', /applyImageParams/.test(parseSource), 'parse.ts 没接上图片通道（断言打空）');

console.log(`变异哨兵：IMGREF_CONFIG.imageReadsParams=${IMGREF_CONFIG.imageReadsParams}（翻成 true → ① 必红）`);

if (problems.length > 0) {
  console.error(`FAIL：${problems.length}/${checks} 项未通过`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（图片不进 params / 不进 result / 不进分享链接 / 文案在位）`);
