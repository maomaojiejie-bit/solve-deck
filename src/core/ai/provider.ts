/**
 * Provider（R3-2 §5）：固定配置，`fetch` 直调 `chat/completions`，**不引任何 SDK**。
 *
 * 与上一版（每个用户填自己的地址与 key）的区别：
 *  ① 不再有 baseURL / apiKey / model / vision 四个字段 —— 全部来自 `config.ts`；
 *  ② 只发 `max_tokens`（≥600，thinking 计入预算），只读 `choices[0].message.content`；
 *  ③ 失败不再只抛一句 `Error`：带上 HTTP 状态与响应体，由 `describeProviderError()`
 *     翻成中文人话，页面再决定「保留现场 + 多一行提示」。
 *
 * 这里只负责「发一次请求、拿回一段文本」。校验在 validate.ts，编排在 vision.ts，
 * 所以 provider 可以被注入 —— `check:vision` 用假 fetch 跑全链路，零网络。
 */

import { TEMPLATES, getTemplateRoute } from '../templates/registry.ts';
import { AI_CONFIG } from './config.ts';

export interface GenerateRequest {
  prompt: string;
  /** 送模型的图片（已预处理，dataURL）。张数上限由调用方管。 */
  images?: string[];
}

export type Generate = (request: GenerateRequest) => Promise<string>;

/** 端点：固定配置，页面里没有任何可改的地址。 */
export function endpointOf(): string {
  return `${AI_CONFIG.baseURL.replace(/\/+$/, '')}/chat/completions`;
}

const READY = TEMPLATES.filter((entry) => entry.status === 'ready');

/**
 * Prompt：只读结构，不算数。
 *
 * 识图要读的是「支座类型 / 几何尺寸 / 力的位置与方向 / 连接关系」——
 * 这几项恰好也是 R3-1 挂接那批修的东西，所以图读错了在后面看得见（supportOffJoint 等判据会拦）。
 */
export function buildStructurePrompt(): string {
  const lines = READY.map((entry) => `- ${entry.id}: ${entry.title}`);
  const constraints = READY.map((entry) => {
    const route = getTemplateRoute(entry.id);
    if (!route) return '';
    const params = (route.entry.params ?? [])
      .filter((param) => param.kind === 'number')
      .map((param) => `${param.key}(${param.label}${param.unit ? '/' + param.unit : ''},${param.min ?? '-∞'}~${param.max ?? '+∞'})`)
      .join(' ');
    return params ? `${entry.id}: ${params}` : '';
  })
    .filter(Boolean)
    .join('\n');

  return [
    '你是工科题目结构读取器。只做三件事：判断属于哪个模板、读出参数、给出匹配理由。',
    '硬规则：',
    '1) 禁止计算任何结果。不许输出答案、增益、内力、应力、临界力等数值结论。',
    '2) 图上若印着答案或参考答案，一律忽略，只当它不存在。',
    '3) 读图时重点读：支座类型（铰 / 辊轴 / 固定）、几何尺寸、力的作用位置与方向、连接关系。',
    '4) 图里没写清楚的尺寸不要自己编，放进 unsure。',
    '5) 参数必须落在给定区间内；不确定的 key 放进 unsure，不要猜。',
    '模板清单（id: 描述）：',
    ...lines,
    '参数约束：',
    constraints,
    '输出：{"templateId":"...","params":{...},"reason":"≤40字","unsure":["key"]}',
    '只输出 JSON，不要解释，不要 ``` 围栏。',
  ].join('\n');
}

/* ── 失败的类型化（页面靠它决定怎么说人话） ─────────────────────── */

export type ProviderFailureKind = 'http' | 'timeout' | 'network';

export class ProviderError extends Error {
  kind: ProviderFailureKind;
  status?: number;
  body?: string;

  constructor(message: string, kind: ProviderFailureKind, status?: number, body?: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

/** 错误 → 中文人话（不含任何网址：地址只该在 config.ts 里）。 */
export function describeProviderError(error: unknown): string {
  if (error instanceof ProviderError) {
    // 「只回了思考」本身就是完整的一句话，别再套「调用失败（HTTP 200）」
    if (/只回了思考/.test(error.message)) return error.message;
    if (error.kind === 'timeout') {
      return `请求超过 ${Math.round(AI_CONFIG.timeoutMs / 1000)} 秒没回来 —— 图片太大就先裁一下题目区域，或稍后重试。`;
    }
    if (error.kind === 'network') {
      return '请求没发出去：网络不可达，或部署环境拦了跨域请求。';
    }
    if (error.status === 401 || error.status === 403) {
      return `密钥无效或没有权限（HTTP ${error.status}）—— 这把 key 需要在控制台轮换后重新构建。`;
    }
    if (error.status === 400 && /image/i.test(error.body ?? '')) {
      return '这个模型这次没吃下图片。';
    }
    if (error.status === 429) {
      return '被限流了（HTTP 429）—— 等一会儿再试。';
    }
    if (error.status && error.status >= 500) {
      return `服务商那边出错了（HTTP ${error.status}），过一会儿再试。`;
    }
    return `调用失败（HTTP ${error.status ?? '?'}）—— ${error.body?.slice(0, 120) || error.message}`;
  }
  return `调用失败：${error instanceof Error ? error.message : String(error)}`;
}

interface ChatChoice {
  message?: { content?: string; reasoning_content?: string };
}

/**
 * 真 provider：POST `{model, messages, max_tokens}`。
 * **只读 `content`** —— 带 `reasoning_content` 的响应不能被当成答案（探针第 ②③ 条）。
 */
export function makeVisionProvider(fetchImpl?: typeof fetch): Generate {
  return async ({ prompt, images }) => {
    const pictures = (images ?? []).filter((item) => item.startsWith('data:image/')).slice(0, 3);
    const content: unknown =
      pictures.length > 0
        ? [
            { type: 'text', text: prompt },
            ...pictures.map((dataUrl) => ({ type: 'image_url', image_url: { url: dataUrl } })),
          ]
        : prompt;
    const body = {
      model: AI_CONFIG.model,
      messages: [{ role: 'user', content }],
      temperature: 0,
      max_tokens: AI_CONFIG.maxTokens,
    };
    const send = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!send) throw new ProviderError('当前环境没有 fetch，无法调用模型', 'network');

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs) : null;
    let response: Response;
    try {
      response = await send(endpointOf(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_CONFIG.apiKey}` },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new ProviderError(
        aborted ? '请求超时' : `网络错误：${error instanceof Error ? error.message : String(error)}`,
        aborted ? 'timeout' : 'network',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(
        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        'http',
        response.status,
        text,
      );
    }
    const data = (await response.json()) as { choices?: ChatChoice[] };
    const message = data.choices?.[0]?.message;
    const text = message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      // 只回思考、没有答案：如实说，不拿 reasoning_content 顶包
      throw new ProviderError(
        message?.reasoning_content ? '模型只回了思考过程，没有给出答案（max_tokens 被 thinking 吃掉了）' : '模型没有返回内容',
        'http',
        response.status,
        '',
      );
    }
    return text;
  };
}

/** 从模型文本里抠出 JSON（先剥 ```json 围栏，再取第一个 { 到最后一个 }）。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型返回的不是 JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}
