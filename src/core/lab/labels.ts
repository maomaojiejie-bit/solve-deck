/**
 * 器件标签的唯一实现：从标签里剥出「名字」，数值尾巴另行格式化。
 *
 * 为什么单开一个文件：`applyParams`（picks.ts）也要写标签，而 ops.ts 反过来
 * import 了 picks.ts —— 把 deviceName 留在 ops.ts 会绕成模块环。这里只放纯字符串
 * 处理，不 import 任何 lab 模块，ops.ts 与 picks.ts 都从这里取同一份规则。
 */

/**
 * 'Rc 2.0k' → 'Rc'；'P1 = 10 kN' → 'P1'；'Vs -5V' → 'Vs'；无标签用 kind。
 *
 * R-39：以前用 `text.split(/[\d.]/)[0]`，负号不是数字也不是点，于是
 * `Vs -5V` 会被切成 `Vs -`（负号留在名字里）。连续改值就一路累积成
 * `Vs - -0.5V` / `Vs - - 3V`，还会被写进 ?g= 分享与收藏的图里。
 * 现在改成剥掉「第一个空白 + 可选符号 + 数字」起的整段数值尾巴，
 * 既不会把负号当成名字，也能把历史上已污染的标签自愈回来。
 */
export function deviceName(label: string | undefined, kind: string): string {
  const text = (label ?? '').trim();
  if (!text) return kind;
  const eq = text.indexOf('=');
  if (eq >= 0) return text.slice(0, eq).trim() || kind;
  const head = text
    // 「空白 + 任意个（符号 + 可选空白）+ 数字」起的整段都是数值尾巴：
    // 允许 `Vs -5V`，也允许历史脏标签 `Vs - - -2V`，一路剥回 `Vs`。
    .replace(/\s+(?:[+-]\s*)*[\d.].*$/, '')
    .replace(/[+-]+\s*$/, '')
    .trim();
  return head || kind;
}
