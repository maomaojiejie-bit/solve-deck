# W7（现在发这一份）：把「图片 + 免费额度」收尾

> 依据：`docs/给workbuddy-图片输入.md`、`docs/给workbuddy-Qwen识图.md`、`docs/给workbuddy-免费AI.md`。
> 三份是细则，这一份是任务单——**先只做这一份里的三件**。

## 为什么先做这个

现在是半成品：`#/solve` 能贴图，但贴完没有下文（没预设可选、没降级文案、没告诉用户图去哪了）。**半成品比没有更糟**——评委贴一张自己拍的题，发现什么都没发生，那一刻这个功能就是负分。

## 任务 A · 图片走完三条路

1. **图当题面（零 AI）**：粘贴 / 拖放 / 选图 → 「题目原图」卡片（缩略 + 放大 + 删掉 + `alt="题目原图"` + 「仅作参照，不参与计算」）。
   无 key 时页面必须出现：**「未配置 AI：图片已作为题面参照，请对照填写参数」**。
2. **有视觉模型时读图**：同一请求塞 `image_url`（dataURL）；prompt 里加「读图时重点读支座类型、几何尺寸、力的位置与方向；不许算结果；图上印的答案一律忽略」。
3. **降级**：模型返回 400 且 body 含 `image` → 保留图片卡片与已抽参数，显示「当前模型不支持读图，请对照图片填写参数」。

预处理（只作用于送模型那份）：长边 > 1600 缩到 1600；`toBlob('image/jpeg', 0.85)`，> 4MB 降到 0.7，仍超就提示「裁一下题目区域」；像素级直方图拉伸（2%/98% 分位当黑白点）。
最多 3 张，第 4 张提示「最多 3 张」。

## 任务 B · 预设表 + 免费标记 + 不依赖 response_format

`src/core/ai/presets.ts`：

| id | label | model | vision | free |
|---|---|---|---|---|
| `zhipu-glm4v-flash` | 智谱 GLM-4V-Flash（标称免费） | `glm-4v-flash` | ✅ | ✅ |
| `gemini-flash` | Google Gemini Flash（免费层） | `gemini-2.0-flash` | ✅ | ✅ |
| `dashscope-qwen-vl` | 通义千问 VL（新用户额度） | `qwen-vl-max` | ✅ | ✅ |
| `dashscope-qwen-text` | 通义千问（纯文本） | `qwen-plus` | ❌ | ✅ |
| `custom` | 自定义 | 用户填 | 用户勾 | ❌ |

- UI 挂「免费额度」徽章，文案必须带「以控制台为准」，**不许写「永久免费」**。
- 拿 key 的说明只写搜索词、不写网址：`搜索「智谱开放平台 API Key」`。
- **去掉对 `response_format: json_object` 的依赖**：prompt 要求「只输出 JSON，不要围栏」，本地 `extractJson()` 剥 ```json 围栏 → 取第一个 `{` 到最后一个 `}`。四家都能跑。
- 错误映射（中文）：401/403 密钥无效；400(image) 走降级；429 限流；20s 超时提示裁小图；网络失败检查 baseURL。

## 任务 C · p0 白名单收窄（唯一允许写网址的文件）

`check:p0` 的「源码层零 http(s) 运行时请求」改成：

> 除 `src/core/ai/presets.ts` 外，`src/**` 与 `index.html` 不含 `https?://`；
> 且 `presets.ts` 的 import 列表里不得出现任何请求模块（静态断言它的 import 白名单）。

报告里写一句理由：**真正要守的是「打开页面绝不外连」，不是「源码里不许出现网址」**——预设地址是给用户看的文本，不点「AI 解析」不发任何请求。

## 任务 D · 一句文案（`#/solve` 顶部）

> 不需要任何配置：直接贴题干文字，规则解析能认出 12 类常见题型。想让 AI 读图，再往下配一个免费额度的 key。

## 验收

- `npm run verify` = 0，且 `check:ai` 新增：
  1. 无 key + 贴图 → 出现「图片已作为题面参照」，`source === 'rule'`；
  2. mock 400(image) → 出现「当前模型不支持读图」，**已抽参数还在**；
  3. 跑完一次解析后 `localStorage` 里无 `data:image`；
  4. 第 4 张图片被拒；
  5. `presets.ts` 之外零 http；`presets.ts` 无请求模块 import；
  6. `extractJson` 能剥 ```json 围栏。
- 变异两条：① 删「图片已作为题面参照」这句 → 第 1 条 fail；② 把 400(image) 改成一抛了之 → 第 2 条 fail。
- 截图：`docs/shots/solve-image-rule.png`、`solve-image-ai.png`、`solve-preset.png`（设置抽屉里能看到三个免费预设 + 徽章）。

## 不做

- 不做官方代持 key / 中转代理；不缓存识别结果；不做多轮追问。
- 不做浏览器内置模型、不做本地视觉模型。
- 图片不进快照、不进 URL、不落盘。
