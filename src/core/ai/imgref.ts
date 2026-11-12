/**
 * R3-4 U2 · 「图片只作参照、不参与计算」的硬规则。
 *
 * 这句话以前只活在注释与文案里，谁也拿不出证据。这里把它落成**唯一入口**：
 * `#/solve` 的规则解析在拿到 draft 之后必须过一遍 `applyImageParams`，
 * 而它在正常配置下是恒等函数 —— 图片字符串对参数一个字节都不影响。
 * 门禁 `check:imgref` 拿同一份函数对比「有图 / 无图」两条链的 params、result、分享链接。
 *
 * 三条不许破：
 *  ① 图片不进 params —— 图不会提供任何数字（本页根本不读图）；
 *  ② 图片不进 result —— 结果只由「题型 + 参数」决定；
 *  ③ 图片不进分享链接 —— 链接里只有结构草稿与参数，没有图字节、没有图指纹。
 *
 * 为什么还要留着 `imageReadsParams` 这个恒假的开关：门禁需要一条**真能红**的变异路径。
 * 翻成 true 后，图串里出现的「键=数值」会被并进 params —— 那是典型的「把图里印的数当题面」，
 * 也是本项目最不能犯的错（图上的答案会被算进题面）。门禁必须当场抓住它。
 */

import type { AIDraft } from './types.ts';

export const IMGREF_CONFIG = {
  /**
   * 变异位：读图里的「键=数值」并进 params。
   * **永假**，不是可用开关 —— 翻成 true 只会让 `check:imgref` 红。
   */
  imageReadsParams: false,
};

/**
 * 屏幕上必须一直看得见的那一句（`#/solve` 图片区、门禁都读它）。
 * 不写成「仅供参考」这种含糊话：说清楚「参数、结果、链接都不会变」才是可核验的承诺。
 */
export const IMGREF_NOTE = '图只作参照、不参与计算：有没有这张图，参数、结果、分享链接都完全一样。';

/** `checkDraft` 的入口形状（只取会被图片影响的那几个字段）。 */
interface DraftLike {
  templateId: string;
  params: Record<string, number | string>;
  reason: string;
  unsure: string[];
}

/**
 * 图片 → 参数的**唯一**通道。正常配置下原样返回（同一个引用，连拷贝都不做）。
 *
 * 变异路径解析的是图串里的「键=数值」（例如 `data:image/...;base64,AAA?P=99`）：
 * 现实里等价于「OCR / 文件名 / 图注里的数字被当成题面」，是这条不变式的经典破法。
 */
export function applyImageParams<T extends DraftLike>(draft: T, images: readonly string[]): T {
  if (!IMGREF_CONFIG.imageReadsParams || images.length === 0) return draft;
  const params = { ...draft.params };
  for (const image of images) {
    for (const match of image.matchAll(/([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
      params[match[1]] = Number(match[2]);
    }
  }
  return { ...draft, params };
}

/** 给页面用的一句话版本（带不带图都一样，所以说的是「不参与」而不是「已忽略」）。 */
export function imageRefNotice(count: number): string {
  return count > 0 ? `${IMGREF_NOTE}（当前 ${count} 张，只用于人眼看）` : IMGREF_NOTE;
}

/** 分享链接/参数串里一旦出现这些片段，就说明图片字节漏进去了。 */
export const IMGREF_FORBIDDEN = ['data:image', 'base64,', '.png', '.jpg', '.jpeg'] as const;

/**
 * 文本里有没有图字节。
 * 只看图特有的记号，**不**用「长 base64 块」当证据：分享链接 `?g=` 本身就是 base64，
 * 拿长度去猜会把正常链接判成漏图（第一次跑就是这么红的）。真要验链接，就把它解出来看内容。
 */
export function linkHasImageBytes(href: string): boolean {
  const lower = href.toLowerCase();
  return IMGREF_FORBIDDEN.some((token) => lower.includes(token));
}

/** 供门禁打印用：把一条链接抹成可读的短摘要（不把长 base64 打到屏幕上）。 */
export function shortenHref(href: string, keep = 72): string {
  return href.length <= keep ? href : `${href.slice(0, keep)}…(${href.length} 字符)`;
}

/** 类型出口：页面与门禁都别自己再写一遍 draft 形状。 */
export type { AIDraft };
