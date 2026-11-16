# SolveDeck · 拆解台

先看懂一道题，再把它算出来 —— 纯前端工科解题工作台：**知识库 · 模板解题 · 装配台**。
28 型模板（材料力学 M1–M8 / 静力学 S1–S7 / 模拟电路 A1–A7 / 数字电路 D1–D6）+ 六项校验 + 三路径交叉对拍。

> GitHub：https://github.com/maomaojiejie-bit/solve-deck

## 运行

```bash
npm install        # 首次
npm run dev        # 开发：http://localhost:5180（源码实时生效）
npm run build      # 全量门禁 + vite build（约 3 分钟）
npm run preview    # 静态预览：http://127.0.0.1:5180（跑的是 dist 产物，改码后需重新 build）
```

⚠️ 两个端口的区别：`localhost:5180` 是 dev server（实时），`127.0.0.1:5180` 是 preview（跑 dist）。改完代码在 preview 里看不到 → 重新 `npm run build` + 强刷（Ctrl+F5）。

纯前端静态站：无后端、无账号、无网络请求；`BASE_URL` 为 `./`，子路径部署可直接用。

## 页面路由

| 路由 | 页面 | 文件 |
|---|---|---|
| `#/` | 首页 | `src/pages/Home.tsx` |
| `#/t/<型号>` | 贴题解题（如 `#/t/M3`） | `src/pages/Solve.tsx` + `Result.tsx` |
| `#/lab` | 装配台索引 / 工作台 | `src/pages/Lab.tsx` |
| `#/lab/digital` | 数字求值 | `src/pages/DigitalLab.tsx` |
| `#/kb` | 知识库 | `src/pages/KbIndex.tsx` / `KbEntry.tsx` |
| `#/scope` | 范围六问判别 | `src/pages/Scope.tsx` |
| `#/about` | 关于 | `src/pages/About.tsx` |

## 目录地图

```
src/
  core/            求解与领域内核（与 UI 无关）
    templates/     28 型模板：mechanics/ analog/ digital/ statics/…（registry.ts 注册）
    lab/           装配台内核：ops（结构操作）/ picks（参数归约）/ measures（读数）
                   frameSolve（梁系求解）/ netSolve（电路求解）/ place（放置器）
    readouts.ts    读数体检（结果页「数字正常吗」层）
    units.ts       单位制（TO_SI 等；改单位口径看这里）
  pages/           页面组件（见上表）
  ui/              通用组件（ParamPanel / GenericResult / SiteNav / 图表…）
  examples/        每型一份骨架快照 JSON（由 scripts/build-example.mjs 再生）
  confidence/      golden 夹具（goldenSet/），钉住模板求解器逐字段正确
  kb/              知识库内容
scripts/           check-*.mjs 门禁脚本（40+ 项）与维护工具
docs/              开发任务书 / 计划书 / 实测报告
fixtures/          机械对拍夹具
public/            符号图元（electronics / mechanics）与知识库静态资源
```

## 常见修改

### 改某型的默认参数（易漏链，按顺序走完）

1. `src/core/templates/<科>/<型>.ts` 的 `DEFAULT`
2. `src/core/templates/registry.ts` 的该型 `defaultValue`（与 `max`）—— **两处真相源都要改**
3. 重算 `src/confidence/goldenSet/` 对应夹具的期望值
4. `node scripts/build-example.mjs <型号>` 再生快照
5. `node scripts/check-p3.mjs` 必须全过；再跑 `npm run check`

### 加一个新题型

在 `src/core/templates/` 实现模板 + 在 `registry.ts` 注册 + `src/core/lab/picks.ts` 加 `PICKS` 条目（参数来源链）+ `examples/` 快照 + golden 夹具 + 对应门禁。

### 改装配台交互 / 读数

交互在 `src/pages/Lab.tsx`（结构操作入 `src/core/lab/ops.ts`，别在页面里直接改图）；
读数表在 `src/core/lab/measures.ts`（改完跑 `check-measures` / `check-readouts`）。

### 改 GitHub 链接 / About 页

`src/pages/About.tsx` 顶部 `GITHUB_URL` 常量（全站唯一写死处）。

## 门禁

`npm run check` = 40+ 个 `scripts/check-*.mjs`，逐条钉住：求解数值（mech-parity 933 字段 / golden 夹具 / 三路径对拍）、拒答口径、文案契约、UI 结构（DOM 断言不挂视口）。**改动的链路有对应门禁，绿了再提交**；门禁失败先看它顶部的注释——每条都写了它在防什么。

`check-section ⑦` 的快照红线按 mtime 截断：走完 `build-example` 再生链后，把脚本里的截断日期推到再生时刻（脚本注释里有规则）。

## 环境

React 19 · TypeScript · Vite 8 · TailwindCSS 4。无运行时后端依赖；开发期 CDP 自动化用 bsk（`scripts/check-labshell.mjs` 等会拉 headless Edge）。
