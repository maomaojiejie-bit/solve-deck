/**
 * AI 配置（R3-2 §5）：**全项目唯一允许出现网址与 key 前缀的文件**。
 *
 * 三条硬事实（2026-11-11 探针实测，不是查文档）：
 *  ① `deepseek-flash` 是 multimodal（input_modalities 含 image），`deepseek-v4-pro` 只吃文本；
 *  ② `content` 与 `reasoning_content` 是两个字段，**只读 `content`** —— 一次 87 token 的输出里
 *     80 个是思考，把 thinking 当答案是错的；
 *  ③ `max_tokens` 必须 ≥ 600：thinking 计入预算，设 40 只会吐 reasoning、
 *     `finish_reason=length`、`content` 为空。
 *
 * 这里零 import：配置是常量，不许反过来依赖任何请求模块（门禁会查）。
 *
 * 风险（写在代码里免得以后忘）：前端内嵌 key 等于公开。可接受的前提是**默认关闭** ——
 * 不打开「本场开启 AI 识图」就一次都不发；单一入口、只用 `deepseek-flash`、
 * 每会话最多 3 次、比完赛立刻在控制台轮换这把 key。
 */
export const AI_CONFIG = {
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  /** 赛期固定（本文件是全项目唯一出现该前缀的地方）；比完赛立刻在控制台轮换。 */
  apiKey: 'sk-104edc5bc8cf42f1b7703607467c4238',
  /** 必须 ≥600：thinking 吃掉预算。 */
  maxTokens: 900,
  timeoutMs: 30000,
} as const;

/** 识图的开关与配额：默认关、本次会话有效、刷新即关。 */
export const VISION_CONFIG = {
  defaultOn: false,
  /** 每会话最多几次识图请求（超了按钮置灰）。 */
  maxPerSession: 3,
  /** 会话计数与开关都放 sessionStorage：关掉标签页就没了。 */
  switchKey: 'sd.vision.on',
  countKey: 'sd.vision.used',
} as const;
