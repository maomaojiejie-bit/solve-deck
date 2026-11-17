# 拆解台 · SolveDeck

纯前端的工科解题拆解台：把一道题拆成「认题 → 建模 → 求解 → 校核」四步，数字由本机求解器现算，不联网、不上传题面。

在线站点：<https://solve-deck-8oaeaejjmx0.qoder.zone>

## 它解决什么

- **按题型解**：28 个已校验题型，覆盖数字逻辑、模拟电路、材料力学、理论力学。
- **按图装配**：可以载入骨架，也可以清空画布，从两个结点、一根构件或几只器件开始自己搭；结构改动逐条记进改动台账。
- **拒绝装懂**：静不定、机构、缺截面、没有接地、导线穿体等场景直接拒答并说明怎么改；不拿默认值硬凑一个答案。
- **数字有出处**：模板解、通用解、图内读数、讲解稿各自标明口径；校核不过不会盖「已验证」章。
- **零运行时请求**：求解、绘图、知识库都在浏览器本地完成；AI 识图默认关闭，只有手动点按钮才会发请求。

## 快速开始

要求 Node.js 20+。

```bash
npm install
npm run dev -- --port 5180
```

打开 `http://localhost:5180/`。

```bash
npm run typecheck     # tsc --noEmit
npm run check         # 所有门禁，不含生产构建
npm run verify        # check:p0 + 完整构建（含门禁）
npm run build         # 门禁 + tsc + vite build
```

生产产物在 `dist/`。站点只上传 `dist/`，不上传源码、巡检报告和过程截图。

## 主要路由

| 路由 | 用途 |
|---|---|
| `#/` | 首页、知识点检索、实时演算 |
| `#/kb`、`#/kb/<id>` | 知识库入口与条目 |
| `#/solve` | 贴题 / 选条件，走判别 |
| `#/wizard` | 选择向导 |
| `#/lab` | 装配台索引 |
| `#/lab/t/<ID>` | 某一型的装配台，例如 `#/lab/t/M3` |
| `#/t/<ID>` | 某一型的标准讲解稿 / 结果页 |
| `#/scope` | 范围与限制判别 |
| `#/about` | 关于、来源与覆盖范围 |
| `#/lab/digital` | 数字求值（门级网表） |

## 目录地图

```text
src/
  pages/                  首页、知识库、贴题、结果、装配台、关于
  core/templates/         28 型求解器与 registry
    analog/               A1–A7（含 MNA、二极管 / BJT / MOS / 运放模型）
    digital/              D1–D6（真值表、卡诺图、门级网表、时序）
    mechanics/            M1–M8（轴力、扭转、弯曲、稳定、组合变形）
    statics/              S1–S7（平面力系、桁架、摩擦、运动学等）
  core/lab/               装配台：图结构、归约、通用求解路由、器件/引脚、分享
  core/statics/           平面刚体与桁架内核
  core/mechanics/         力学通用求解与截面/内力工具
  render/                 SVG 示意、图表、表格、莫尔圆、卡诺图
  ui/                     外壳、参数面板、结果卡、单位、打印样式
  examples/               每型黄金快照（由 build-example 生成，不手改）
  confidence/             构建期校验与置信度
scripts/                  门禁（check-*.mjs）与快照生成脚本
public/kb/                知识库插图
public/shots/             站点用图（About 页的产品图 r32-product.png）
```

## 一条题怎么走

**模板路径**

```text
输入参数 / 题面
→ registry 选型
→ core/templates/<型>.ts
→ Solution（headline、步骤、render_specs、checks、warnings）
→ 结果页 / 讲解稿
```

**装配台路径**

```text
画布图 CanvasGraph
→ reduce() 从图/器件/标注归约参数
→ resolveLabSolve() 判断走模板还是通用
   ├─ 模板：与骨架一致 → 讲解稿
   └─ 通用：netSolve / frameSolve / gateSolve → 按这张图现算
→ GraphMeasures / GenericResult / Result
```

原则：**图是输入，归约是中间真相，结果只认一条路由**。不要让同一屏出现两套互不说明的数字。

## 验证与快照

仓库里的 `src/examples/<ID>.json` 是已校验快照，不是手写数据。

```bash
npm run check:p3                 # 快照 == 实时 solver
node scripts/build-example.mjs M3
node scripts/build-example.mjs M3 --config=cantilever --id=M3-cantilever
node scripts/build-example.mjs A3 --config=CB --id=A3-CB
```

规则：

1. **不要手改快照**；改完求解器后走正规生成链，再跑 `check:p3`。
2. 改布局 / 坐标 / 文案可能触发快照漂移，按 `check:section` 注释里的规则推进 mtime 截断；不要为了过门禁删断言。
3. 新增题型：registry + solver + example +（可装配的）`core/lab/picks.ts` 归约表 + 对应门禁。
4. 交付前至少跑 `npm run verify`；单独门禁可逐项运行，不能跳过。

关键门禁（完整列表见 `package.json`）：

| 门禁 | 检查什么 |
|---|---|
| `check:p3` | 28 型快照与实时求解逐字段一致 |
| `check:assemble` | 装配台动作序列、删/加/连线、自建、拒答 |
| `check:labresolve` | 模板 vs 通用路由；新增器件必须走通用 |
| `check:mech-parity` / `check:statics` | 力学 / 静力学与独立内核对账 |
| `check:chart` / `check:schematic` | 图表与电路图坐标、标记、零轴 |
| `check:labshell` / `check:responsive` | 三栏外壳、断点、无横向溢出 |
| `check:labimport` | 题面草稿两条入口同解 |
| `check:readouts` / `check:paramlab` | 参数实验场、单位、三处同源 |

## 站点发布

- 构建：`npm run build`，产物在 `dist/`。
- 只上传 `dist/`；`README.md` 与本地过程材料（`docs/`、巡检 md）都不会进站点。
- 站点用图放 `public/shots/`，构建时由 Vite 原样拷进 `dist/shots/`（不再走自定义白名单插件）。
- Qoder Sites 发布需要 `prepare_site` 的 `projectRoot` 指向项目根、`webDirectory: "dist"`，然后 `publish_site` 并确认 `published: true`。

## 给 AI / 自动化代理的工作约定

先读本 README，再读 `package.json` 的 scripts 和对应 `scripts/check-*.mjs`。不要凭文件名猜行为。

### 绝不

- 不放宽断言、阈值、容差来让门禁变绿；门禁是产品契约。
- 不手改 `src/examples/*.json`；必须用 `build-example` 生成。
- 不把模板参数硬套到通用求解的图上；确认闸门要跟路由走。
- 不在运行时新增网络请求；AI 识图必须保持默认关、手动触发。
- 不把本地过程材料（`docs/`、巡检 md、过程截图）打进 `dist`。
- 不用未验证的数字写「已验证 / 已通过」。

### 改了这些地方要特别小心

| 区域 | 不变量 |
|---|---|
| `core/lab/resolve.ts` | `unmodeledDevices` 只按器件 id 识别；新增同类器件必须走通用求解，不能按 label 前缀放行 |
| `core/lab/picks.ts` | S5 的 L/H 是 meta 参数；变化时必须同步 C 点几何和杆件标签（`syncS5Geometry`），否则「按图现算」会和讲解稿打架 |
| `pages/Lab.tsx` | 确认闸门分模板 / 通用两条；通用路由不要求确认无关的骨架参数；载荷位置优先最近结点，不能只看 x 投影 |
| `render/SpecGrid.tsx` | 图元数变化后重新 fit；拖动不改数量，不重置缩放；右栏长提示不能用 `flex-1` 覆盖 `basis-full` |
| `core/templates/*` | 求解器只依赖纯输入；结果 / 图表 / 校核同源；单位约定写清楚 |
| `vite.config.ts` | 站点 shots 白名单只保留 `r32-product.png`，不要把巡检证据带上站 |

### 常用任务

- **改一个题型数值 / 公式**：改 `core/templates/<科>/<型>.ts` → 生成 example → `check:p3` → 对应学科门禁。
- **改装配台交互**：`pages/Lab.tsx` + `core/lab/ui.ts` / `ops.ts` → `check:assemble`、`check:paramlab`、`check:labshell`。
- **改画布 / 图表**：`render/*` → `check:chart`、`check:schematic`、`check:readouts`，必要时重建截图快照。
- **新增器件 / 拓扑**：`core/lab/types.ts`、`pins.ts`、`netSolve.ts` / `frameSolve.ts`、`picks.ts`、门禁用例一起改。
- **发布**：先 `npm run verify`，再 `npx vite build`，最后只上传 `dist/`。

### 失败处理

1. 先看门禁输出的第一条 `FAIL`，不要从最后一条猜。
2. 区分「实现错」和「快照旧」；快照问题走正规生成链，不手改 JSON。
3. 修改含中文的源码时用 UTF-8（Node `fs.writeFileSync` / 编辑器 UTF-8），不要用会改编码的 shell 重定向。
4. 发布前核对 `dist` 里没有 `*.md`、`audit-*`、`fix-*` 和源码。

## 已知边界

- 只做静定 / 线弹性 / 小变形；静不定、机构、二次效应直接拒答。
- 没有完整截面时只给反力 / 内力；应力、挠度需要 b/h/E 或 I。
- 通用电路把二极管线性化为 `Vf + 1Ω`，模板口径是 `Vf + I·Rz`；两者同图可能差约 1%，结果卡会标明当前口径。
- 自建图与骨架不一致时会走通用求解，骨架参数表只作参考，不再作为确认闸门。
- 数字求值只做门级网表；不模拟延迟 / 扇出 / 物理布线。

## 许可与第三方

- 依赖许可与源码裸包清单：`LICENSES.md`
- 第三方声明：`THIRD_PARTY_NOTICES.md`
- 本项目为私有仓库；对外发布以 Qoder Sites 的实际站点配置为准。