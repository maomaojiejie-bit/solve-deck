# 接 Qwen 识图回传参数（阿里云百炼 / DashScope）

**结论：能接，而且几乎不用改 provider 层。** DashScope 有 OpenAI 兼容端点，我们现有的 BYOK 直连（`fetch` + `chat/completions`，零 SDK）原样就能用。

我实测过端点存在性：`GET https://dashscope.aliyuncs.com/compatible-mode/v1/models` → **401**（未带 key），说明域名与路径是对的，只是要鉴权。

---

## 1. 预设表（新增 `src/core/ai/presets.ts`）

```ts
export type AiPreset = {
  id: string; label: string; baseURL: string; model: string;
  vision: boolean;      // 能不能吃图
  keyHint: string;      // 去哪儿拿 key
};
```

建议四条：

| id | label | baseURL | model | vision |
|---|---|---|---|---|
| `dashscope-qwen-vl` | 通义千问 VL（阿里云百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | ✅ |
| `dashscope-qwen-text` | 通义千问（纯文本） | 同上 | `qwen-plus` | ❌ |
| `openai-vision` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ✅ |
| `custom` | 自定义 | 用户填 | 用户填 | 用户勾 |

规则：**预设只用来填表**。用户没点「AI 解析」之前，一个请求都不会发。`keyHint` 写「去百炼控制台 → API-KEY 管理」，不写链接（链接文案里带 https 会撞门禁，见 §3）。

## 2. 两处必须改的地方

### 2.1 不要依赖 `response_format: json_object`

Qwen 兼容模式对 `response_format` 的支持不完全，DeepSeek/OpenAI 又各自不同。统一改成：

- prompt 末尾写「只输出 JSON，不要解释，不要 ``` 围栏」；
- 本地 `extractJson(text)`：先剥 ```json … ``` 围栏，再取第一个 `{` 到最后一个 `}`，`JSON.parse` 失败就当作一次「重写机会」；
- 这样四家都能跑，也避免「不支持该参数 → 400」这种坑。

### 2.2 图片消息体（Qwen 兼容模式同 OpenAI 格式）

```jsonc
{
  "model": "qwen-vl-max",
  "temperature": 0,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<§4 的 prompt>" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }]
}
```

`Authorization: Bearer <key>`。图片按 `docs/给workbuddy-图片输入.md` §D 预处理（长边 1600、jpeg 0.85、直方图拉伸）。

## 3. 门禁冲突：p0 的「源码零 http(s)」

上次你被这条拦过（设置抽屉里的占位地址）。现在预设表**天生要写四个 https 地址**，硬拼字符串绕过扫描是不允许的（那是绕门禁）。

正解：**把 p0 这条断言收窄成有意的白名单**，并在报告里说明理由——

> `check:p0`「源码层零 http(s) 运行时请求」改为：除 `src/core/ai/presets.ts` 外，`src/**` 与 `index.html` 不含 `https?://`；且 `presets.ts` 只能导出常量与类型，**不得 import 任何 fetch/请求模块**（用一条静态断言查它的 import 列表）。

理由一句话写进报告：**预设地址是用户可见的文本，不点解析不会发生任何请求；真正的约束是「打开页面绝不外连」，不是「源码里不许出现网址」。**

## 4. Prompt（Qwen 版，照抄）

```
你是工科题目结构化器。只做三件事：判断属于哪个模板、抽出参数、给出匹配理由。
硬规则：
1) 禁止计算任何结果。不许输出答案、增益、内力、应力、临界力等数值结论。
2) 图上若印着答案或参考答案，一律忽略，只当它不存在。
3) 读图时重点读：支座类型（铰 / 辊轴 / 固定）、几何尺寸、力的作用位置与方向、连接关系。
4) 参数必须落在给定区间内；不确定的 key 放进 unsure，不要猜。
模板清单（id: 描述）：<28 条 ready 型>
参数约束：<所选模板 ParamSpec：key/label/unit/min/max>
输出：{"templateId":"...","params":{...},"reason":"≤40字","unsure":["key"]}
只输出 JSON。
```

## 5. 错误映射（一律中文、说人话）

| 状态 | 文案 | 之后怎么走 |
|---|---|---|
| 401 / 403 | 密钥无效或没有该模型权限 | 打开设置抽屉，保留已填内容 |
| 400 且 body 含 `image` | 当前模型不支持读图 | **降级**：保留图卡片与已抽参数，提示对照图片手填 |
| 429 | 触发限流，等十几秒再试 | 保留输入，不清空 |
| 超时（20s） | 请求超时（图片太大时更慢） | 提示先裁小图片 |
| 网络失败 | 连不上服务地址 | 检查 baseURL 或代理 |

## 6. 门禁扩展（`check:ai`）

1. **presets 白名单**：`presets.ts` 之外的源码零 http(s)；`presets.ts` 的 import 里没有 fetch/axios/请求模块。
2. **围栏剥离**：mock 返回 ```json{"templateId":"M3"...}``` → `extractJson` 必须成功。
3. **四种错误映射**：401 / 400(image) / 429 / 超时各断言一次文案，且断言「输入不清空、图片卡片还在」。
4. **图片不进存储**：跑完 Qwen mock 后 `localStorage` 里无 `data:image`。
5. **不许出答案**：mock 返回 `{"reason":"按图识别，Av=-46.25"}` → 判定不合格并重写一次；重写仍不合格则只显示错误，**页面不得出现 `-46.25`**。

变异两条：① 把 `extractJson` 的围栏剥离删掉 → 第 2 条 fail；② 把 400(image) 的降级改成抛错 → 第 3 条 fail。

## 7. 不做

- 不做「官方代持 key」（不替用户保管、不设我们自己的中转，隐私与合规都过不去）。
- 不缓存识别结果、不做多轮追问、不做批量多图。
- 不在仓库里写任何真实 key，`sd.ai.v1` 只存用户自己填的。
