# 交给 Qoder：接手「拆解台 SolveDeck」并部署上线

> 这份文件是给 Qoder 的交接单。把 §0 到 §3 直接粘进 Qoder，让它按步骤做。

---

## §0 一句话（可直接粘）

> 这是一个纯前端静态站（Vite + React 19 + TypeScript + Tailwind，运行时只依赖 react/react-dom/katex），仓库在 `C:\Users\17897\Desktop\qoder`。它把 28 类工科题拆成「题目 → 五步 → 图 → 六项校核 → 结论」，每个数字都由仓库内的求解器算出来并逐条校核，不接任何后端。
> 任务：**先跑通并验证（`npm run verify` 必须 exit 0），再部署到 Qoder Sites 拿到公网链接，最后按 §5 交回证据。** 不要改求解结果、不要为了变绿调容差。

---

## §1 这个站在干嘛

| | |
|---|---|
| 名字 | 拆解台 · SolveDeck |
| 一句话 | 工科在读生做题 / 复习时，把一道题拆成 5 步、每步配一张图、并给出 6 项校核的拆解台 |
| 覆盖 | 28 型：数电 D1–D6、模电 A1–A7（A3/A5 另有 4 个组态变体）、材料力学 M1–M8、理论力学 S1–S7 |
| 不覆盖 | 超静定、刚架、大变形、塑性、变截面、动力/振动/冲击、疲劳/断裂、热应力、空间力系 |
| 关键特征 | ①每题一主图 + 一辅图（原电路/等效、受力图/内力图）②参数实验场（拖滑杆重算）③六项独立校核逐条显示 ④题目卡可进 URL 分享 ⑤导出 PDF ⑥贴题干/贴图让规则或 AI 抽出参数 |

---

## §2 现在跑到哪了

**代码状态：绿的。** 最后一次实跑（我这边的机器）：

```
npm run verify  → exit 0

模板 28 / 图元 44 / 夹具 60 / scope 放行 28
PASS：13/13 项                          （契约与产物）
PASS：App 路由闭包 122 个文件            （运行时边界）
PASS：physicsValidator.ts 零 import
PASS：15 个声明依赖均非 GPL/AGPL/LGPL/EPL
PASS：8/8 项（路径门禁）                 （每题三条独立路径互校）
PASS：37/37 项（URL 参数门禁）
PASS：4/4 项（卡诺图矩形）
PASS：58/58 项（P3 校验栈）
PASS：16/16 项（电路图门禁）
PASS：24 项（响应式门禁）
PASS：8 份 fixture / 933 个字段，相对误差 < 1e-9
PASS：8 份自算 fixture / 60 个字段
PASS：1103 项（坐标图门禁）
PASS：184 项（静力学 + 材料力学受力图门禁）
PASS：254 项（读题门禁）
```

**已经做好的**（P0–P7 里 P0/P1/P2/P3 全绿，P4 参数实验、P5 导出与读题、P6 about 与部署就绪也都做了）：

- 求解层：`src/core/templates/` 下 28 型 + `mna.ts`（模电 MNA）+ 力学适配层（复用 `dsh-mech-workbench` 的 `MechSpec` schema）
- 绘图层：`src/render/` 通用 SVG 引擎 + `public/symbols/electronics/*.svg` 27 个符号 + `symbolArt.generated.ts`
- 工作台：`src/pages/Result.tsx`（步进 + 双图 + 参数实验场 + 六项校核 + 导出 PDF + 复制链接）
- 读题：`src/core/ai/`（12 条规则解析 + BYOK 直连任意 OpenAI 兼容端点 + 图片三条路）
- 入口：`#/` 首页、`#/solve` 我有道题、`#/wizard` 选型向导、`#/about` 关于
- 门禁：16 道，全部接进 `npm run build`

**截图（47 张）在 `docs/shots/`**，包括 `home-ready.png`、`M3.png`、`M3-cantilever.png`、`A3.png`、`A3-CB/CC.png`、`A5-CG/CD.png`、`S5.png`、`S1-indeterminate.png`、`solve-*.png`、`about.png`、`A3.pdf`。

**文档（33 份）在 `docs/`**，其中对你有用的四份：
- `docs/部署清单.md` —— 部署相关
- `docs/作品帖-StudyHack.md` —— 作品帖五段式草稿（5 处待填）
- `docs/电路接线守则.md` —— 画图与推导的规矩（说明为什么图长这样）
- `docs/下一步-scope.md` —— 还没做的那件事

---

## §3 你要做的四步

### 第 1 步 · 跑起来（3 分钟）

```powershell
cd C:\Users\17897\Desktop\qoder
node -v                    # 需要 Node 22+（脚本里用了内置 WebSocket）
npm ci                     # 若没有 lock 就用 npm install
npm run verify             # 期望 exit 0，并看到上面那 16 行 PASS
```

本地看站（两种都行）：

```powershell
.\启动工作台.cmd            # 默认打开首页
.\启动工作台.cmd solve      # 打开 #/solve
.\启动工作台.cmd t/M3       # 打开 #/t/M3
# 或者：node scripts/serve-local.mjs 5180
```

**验收**：浏览器能打开，首页显示「点开就能算的 28 型（+ 4 组态变体）」，点任意卡片能进题目页，页面上能看到五步、双图、六项校核。

### 第 2 步 · 五条路径各点一遍（5 分钟，边点边截图）

1. `#/` 首页 → 28 张卡 + 折叠的路线图
2. `#/t/M3` → 简支梁：拖「集中力位置 a」，看剪力图/弯矩图与 Mmax 跟着变
3. `#/t/A3-CB` → 共基：主图是交流通路、辅图是 π 模型
4. `#/solve` → 贴「悬臂梁 L=2m，自由端集中力 10kN，求固定端反力与弯矩图」→ 点「AI 解析」→ 待确认表出现 → 点「确认无误 → 开始拆解」
5. `#/wizard` → 选「材料力学」→ 选「求内力图」→ 点候选卡

**验收**：5 条都能走通；第 4 条最终跳到 `#/t/M3-cantilever` 且参数是 L=2 / P=10。

也可以一条命令跑完这 5 条（需要先起服务）：

```powershell
$env:SD_NO_OPEN=1; node scripts/serve-local.mjs 5186   # 另开一个窗口
node scripts/test-flows.mjs http://127.0.0.1:5186       # 期望 8 条 ok + ALL PASS
```

### 第 3 步 · 部署到 Qoder Sites

这个站是**纯静态**，`vite.config.ts` 里已经 `base: './'`（相对路径），所以放在任意子路径下都能用。

```powershell
npm run build        # 产物在 dist/（含 index.html、assets/、shots/）
```

上传 / 发布 `dist/` 整个目录到 Qoder Sites。**注意三件事**：

1. 要保留 `dist/shots/`（about 页与作品帖的图在那儿）；
2. 不要开「仅根路径可访问」或自定义 404 页面拦截 —— 这是 hash 路由（`#/t/M3`），服务器只需要能返回 `index.html`；
3. 部署完**必须用真实公网链接**再点一遍 §2 那五条路径。

部署后自检（把生成物挂到子路径上验证相对路径没写错）：

```powershell
node scripts/serve-subpath.mjs      # 期望：PASS 结果页 / PASS about 页 / subpath=0
```

### 第 4 步 · 交回证据

按 §5 的清单交回来。**没有公网链接就等于没提交。**

---

## §4 部署相关的已知事实

- 构建产物：`dist/index.html` + `dist/assets/*` + `dist/shots/*`（约 47 张图 + `A3.pdf`）
- `base: './'` 已设，`index.html` 里是 `./assets/...`，不是 `/assets/...`
- 站内无任何运行时外连：唯一出现网址的文件是 `src/core/ai/presets.ts`（给用户看的预设地址文本），`check:p0` 专门钉住「除它之外零 http(s)」，且它零 import、零 fetch
- 无后端、无数据库、无 cookie；用户填的 key 只存在浏览器 `localStorage`（`sd.ai.v1`，四个字段），图片不落盘

---

## §5 交回清单

1. **公网链接**（Qoder Sites）
2. `npm run verify` 的完整输出截图（要能看到 16 行 PASS + exit 0）
3. 部署后五条路径的截图（`#/`、`#/t/M3`、`#/t/A3-CB`、`#/solve`、`#/about`）
4. 部署时间（年月日 时:分）与部署人
5. 如果这轮改了什么，附一句「改了什么、为什么」

---

## §6 作品帖怎么写（`docs/作品帖-StudyHack.md` 已有草稿）

必需五段：**自我介绍 / 作品是什么（一句话说清谁在什么场景下用）/ 为什么做 / 怎么用（5 步以内）/ 用 Qoder 做出来的过程（多截图）**，另附 Qoder 账号。

5 处占位符必须填：`{{姓名}}`、`{{学校/专业}}`、`{{Qoder 账号}}`、`{{公网站点链接}}`、`{{分享链接}}`。

**如实写。** 帖子里描述的过程要是真的发生过的：谁写的、用哪个工具写的、哪一步是 Qoder 做的、部署是谁点的。评审看的是「过程讲得清楚」，不是「全程只用了一个工具」。已经写好的部分可以直接用，涉及分工的句子按实际情况改。

---

## §7 红线（改了就等于把作品做废）

1. **不许改求解结果去凑合结论**。所有标准答案在 `docs/短令-F力学.md`、`scripts/check-*.mjs` 里钉着，改一处要重建快照并说明。
2. **不许为了让门禁变绿而放宽容差**。`check-paths` 里有专门一条断言「runner 门槛 == registry 声明」，就是为了防这个。
3. **不许删测试、不许关断言、不许把 `check:*` 从 `build` 里摘掉**。
4. **不许把「降级」写成像「成功」**。无 key 就是无 key，模型不支持读图就说不支持。
5. 改任何布局/图形后必须重建对应快照，否则门禁读的是旧快照（会给假绿）。

---

## §8 还没做的活（不急，但知道一下）

| 事 | 文件 | 量 |
|---|---|---|
| `#/scope` 六问判别器 + 16 关键词硬拦截 + 简化留痕 | `docs/下一步-scope.md` | 半天 |
| `#/lab` 通用工作台（静力/电路/数字三个 tab，共用壳） | `docs/给workbuddy-通用工作台-三学科.md` | 4 天，建议提交后再做 |
| about 页 8 个时间线节点的截图去重（现在 4 张循环引用） | — | 半小时 |

这三件都不影响提交。**先部署，再谈它们。**
