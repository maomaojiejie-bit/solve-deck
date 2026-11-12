/**
 * check:vision（R3-2 §5 新增）：识图这条路只在开关打开、用户点按钮时才走。
 *
 * 六条：
 *  ① 开关关着 → 零请求（fetch 调用次数 = 0），并如实说「默认关闭」；
 *  ② 请求体三条硬事实：model = deepseek-flash、max_tokens ≥ 600、image_url 是 data:image/；
 *  ③ 只读 content：构造一个「content 空、reasoning_content 里塞 JSON」的假响应，
 *     断言不会把思考当答案（draft 必须为 null）；
 *  ④ 失败不阻断：调用失败时 keepOnFailure 把原结果原样留下，只多一行「AI 这次没帮上：…」；
 *  ⑤ 每会话上限 3 次：第 4 次不再发请求，如实说「用完了」；
 *  ⑥ 模型回数值结论 → 整份作废（R2-T2 的铁律，撤掉 BYOK 也没松）。
 *
 * 零网络：全部走注入的假 fetch。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_CONFIG, VISION_CONFIG } from '../src/core/ai/config.ts';
import { isVisionEnabled, keepOnFailure, readStructure, setVisionEnabled, visionUsesLeft } from '../src/core/ai/vision.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let checks = 0;
const ok = (rule, condition, detail) => {
  checks += 1;
  if (!condition) problems.push(`${rule} / ${detail}`);
};
const read = (relative) => readFileSync(join(root, relative), 'utf8');

/* ── 会话存储桩（Node 里没有 sessionStorage） ─────────────────── */
const box = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (box.has(key) ? box.get(key) : null),
  setItem: (key, value) => box.set(key, String(value)),
  removeItem: (key) => box.delete(key),
  clear: () => box.clear(),
  key: (index) => [...box.keys()][index] ?? null,
  get length() {
    return box.size;
  },
};

/* ── 假 fetch ─────────────────────────────────────────────────── */
let calls = [];
let responder = () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ choices: [] }) });
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init?.body ?? '{}') });
  return responder();
};
const resetQuota = () => box.delete(VISION_CONFIG.countKey);
const IMAGE = 'data:image/jpeg;base64,/9j/AAAA';

const GOOD = {
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({ choices: [{ message: { content: '{"templateId":"M3-cantilever","params":{"L":2,"a":2,"P":10},"reason":"悬臂梁端部集中力","unsure":[]}' } }] }),
};

/* ── ① 关着 → 零请求 ─────────────────────────────────────────── */
resetQuota();
box.delete(VISION_CONFIG.switchKey);
calls = [];
const off = await readStructure([IMAGE]);
ok('①', isVisionEnabled() === false, '默认态 isVisionEnabled() 不是 false');
ok('①', calls.length === 0, `开关关着却发了 ${calls.length} 次请求`);
ok('①', off.ok === false, '关着的时候不该出结果');
ok('①', off.reason.includes('默认关闭'), `关着时的原因不明确：${off.reason}`);

/* ── ② 打开 → 请求体三条硬事实 ───────────────────────────────── */
setVisionEnabled(true);
resetQuota();
calls = [];
responder = () => GOOD;
const on = await readStructure([IMAGE]);
ok('②', calls.length === 1, `应只发 1 次请求，实际 ${calls.length}`);
ok('②', calls[0]?.url === `${AI_CONFIG.baseURL}/chat/completions`, `端点不对：${calls[0]?.url}`);
ok('②', calls[0]?.body.model === 'deepseek-flash', `model 应为 deepseek-flash，实际 ${calls[0]?.body.model}`);
ok('②', calls[0]?.body.max_tokens >= 600, `max_tokens 必须 ≥600，实际 ${calls[0]?.body.max_tokens}`);
ok('②', calls[0]?.body.temperature === 0, `temperature 应为 0，实际 ${calls[0]?.body.temperature}`);
const content = calls[0]?.body.messages?.[0]?.content;
const imagePart = Array.isArray(content) ? content.find((part) => part.type === 'image_url') : null;
ok('②', Boolean(imagePart), '请求体里没有 image_url 段');
ok('②', String(imagePart?.image_url?.url ?? '').startsWith('data:image/'), `image_url 不是 data:image/ 开头：${imagePart?.image_url?.url?.slice(0, 24)}`);
ok('②', Array.isArray(content) && content.some((part) => part.type === 'text' && part.text.includes('禁止计算')), 'prompt 没带上「禁止计算」');
ok('②', on.ok === true, `合法的识图结果应成功：${on.reason}`);
ok('②', on.draft?.templateId === 'M3-cantilever', `题型读错：${on.draft?.templateId}`);
ok('②', on.draft?.params.P === 10, `参数读错：${JSON.stringify(on.draft?.params)}`);
console.log(`② 一次成功识图：model=${calls[0]?.body.model} max_tokens=${calls[0]?.body.max_tokens} → ${on.draft?.templateId}（剩 ${on.left} 次）`);

/* ── ③ 只读 content：reasoning_content 里的 JSON 不算答案 ──────── */
resetQuota();
calls = [];
responder = () => ({
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({
    choices: [
      {
        message: {
          content: '',
          reasoning_content: '{"templateId":"A3","params":{"beta":100},"reason":"思考里猜的"}',
        },
      },
    ],
  }),
});
const trap = await readStructure([IMAGE]);
ok('③', calls.length === 1, `应发 1 次请求，实际 ${calls.length}`);
ok('③', trap.ok === false, 'content 为空时却出了结果（把 thinking 当答案了）');
ok('③', trap.draft === null, '把 reasoning_content 当成了 draft');
ok('③', /思考|没有给出答案/.test(trap.reason), `没解释为什么空：${trap.reason}`);
ok('③', !/A3/.test(JSON.stringify(trap)), 'reasoning 里的内容漏进了结果');
console.log(`③ 只回思考时的说法：「${trap.reason.slice(0, 40)}…」`);

/* ── ④ 失败不阻断：原结果原样留着 ─────────────────────────────── */
resetQuota();
calls = [];
responder = () => {
  throw new Error('network down');
};
const failed = await readStructure([IMAGE]);
ok('④', failed.ok === false, '网络失败应判失败');
ok('④', /网络|没发出去/.test(failed.reason), `失败原因不具体：${failed.reason}`);
const existing = { templateId: 'M3', params: { L: 4 }, note: '规则解析出来的' };
const kept = keepOnFailure(existing, failed.reason);
ok('④', kept.draft === existing, 'keepOnFailure 没把原结果原样留下');
ok('④', kept.note.startsWith('AI 这次没帮上：'), `失败提示格式不对：${kept.note}`);
ok('④', kept.note.includes(failed.reason), '失败提示没带原因');
ok('④', read('src/pages/Lab.tsx').includes('keepOnFailure'), '装配台没用 keepOnFailure（失败可能清空结果）');

/* ── ⑤ 每会话 3 次 ───────────────────────────────────────────── */
resetQuota();
calls = [];
responder = () => GOOD;
const used = [];
for (let index = 0; index < VISION_CONFIG.maxPerSession; index += 1) {
  const round = await readStructure([IMAGE]);
  used.push({ ok: round.ok, left: round.left });
}
const fourth = await readStructure([IMAGE]);
ok('⑤', calls.length === VISION_CONFIG.maxPerSession, `上限 ${VISION_CONFIG.maxPerSession} 次，实际发了 ${calls.length} 次`);
ok('⑤', used.every((item) => item.ok), `前 ${VISION_CONFIG.maxPerSession} 次应都成功：${JSON.stringify(used)}`);
ok('⑤', used.map((item) => item.left).join(',') === '2,1,0', `剩余次数不对：${JSON.stringify(used.map((item) => item.left))}`);
ok('⑤', fourth.ok === false, '超出上限后仍然出了结果');
ok('⑤', /用完/.test(fourth.reason), `超出上限的说法不对：${fourth.reason}`);
ok('⑤', visionUsesLeft() === 0, `visionUsesLeft 应为 0，实际 ${visionUsesLeft()}`);
console.log(`⑤ 配额：${VISION_CONFIG.maxPerSession} 次用完后第 4 次零请求，说法「${fourth.reason.slice(0, 24)}…」`);

/* ── ⑥ 数值结论 → 整份作废 ───────────────────────────────────── */
resetQuota();
calls = [];
responder = () => ({
  ok: true,
  status: 200,
  text: async () => '',
  json: async () => ({ choices: [{ message: { content: '{"templateId":"A3","params":{"beta":100},"reason":"Av=-46.25"}' } }] }),
});
const bare = await readStructure([IMAGE]);
ok('⑥', bare.ok === false, '带数值结论的结果没被作废');
ok('⑥', bare.draft === null, '作废不彻底，还给了一份 draft');
ok('⑥', !JSON.stringify(bare).includes('46.25'), '答案漏进了结果');

/* ── 源码：识图模块不许自己写网址 / 不许读 reasoning ──────────── */
const visionSource = read('src/core/ai/vision.ts');
ok('src', !/https?:\/\//.test(visionSource), 'vision.ts 里写了网址（只该在 config.ts）');
ok('src', !/reasoning_content/.test(visionSource.replace(/^\s*\*.*$/gm, '')), 'vision.ts 直接碰 reasoning_content');
ok('src', /VISION_CONFIG/.test(visionSource), 'vision.ts 没用 VISION_CONFIG（配额与开关各写一份？）');

console.log('');
if (problems.length > 0) {
  console.error(`FAIL：${problems.length}/${checks} 项未通过`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`PASS：${checks} 项（识图：默认关零请求 / 请求体三条硬事实 / 只读 content / 失败不阻断 / 3 次上限 / 数值结论作废）`);
