# AGENTS.md · 给自动化代理的项目地图

> 目标读者：AI / 自动化代理、接手维护的人类工程师。
> 这份文档只回答两件事：**改哪里**、**改完怎么证明没改坏**。
> 全局产品说明与发布方式见 [README.md](./README.md)。

---

## 1. 项目速览

纯前端工科解题站，Vite + React 19 + Tailwind v4 + TypeScript，另含 three.js / R3F 的三维分区。

| 分区 | 入口 | 说明 |
|---|---|---|
| 拆解台（2D） | `#/`、`#/lab`、`#/t/<ID>` | 28 型模板 + 装配台 + 通用求解 |
| 三维力学实验场 | `#/space` | 47 个三维算例（静力 34 + 机构 13） |
| 三维只读详情 | `#/space/t/<ID>` | 画布 + 结果卡，不可改模型 |
| 三维自由装配台 | `#/space/build` | 编辑模型 → 即时重解 |

运行时零外部请求；求解、绘图、知识库全部本地完成。

---

## 2. 命令与门禁

```bash
npm install
npm run dev -- --port 5180      # 端口以终端输出为准（历史会话常用 5174）
npx tsc --noEmit                # 类型门禁，必须 0
npm run check                   # 全量门禁（含三维两项）
npx vite build                  # 生产构建

# 三维专项
npm run check:space-verify      # 手算基准（B3/C7/C12 等）
npm run check:space-solve       # 47 份快照 == 实时解
npm run snapshot:space          # 内核数值口径变化后重生 snapshots-space/*.json
```

**顺序纪律**：

1. 先 `npx tsc --noEmit`；
2. 再 `npm run check`；
3. 最后 `npx vite build`。

不要并行跑 `check*` 与 `vite build`：构建会清空 `dist/`，`check:labshell` 等读 `dist` 的门禁会假失败。

---

## 3. 修改入口索引

### 3.1 三维静力内核 `src/core/space/`

| 想改什么 | 文件 | 关键符号 |
|---|---|---|
| 数据契约（模型/解/实体/隐藏构件） | `types.ts` | `TrussModel`、`Member.hidden`、`SolidBody`、`Solution3D` |
| 总求解入口 | `solve.ts` | `solveTruss(model)`；headline、checks、refusals、internals |
| 刚度矩阵与奇异判据 | `stiffness.ts` | `assembleStiffness`、`condensed`（零刚度自由度） |
| 线性方程 | `linalg.ts` | `solveSquare`（按行尺度部分主元） |
| 静定性判定 | `determinacy.ts` | `analyzeDeterminacy` |
| 梁单元 / 内力截面 | `beam.ts`、`solve.ts#buildInternals` | 12×12 梁、100 段剪力零点扫描 |
| 应力与强度校核 | `stress.ts`、`sections.ts`、`materials.ts` | `computeStress`、`Wt=J/min(b,h)`、σallow=σs/n |
| 稳定（几何刚度） | `buckling.ts` | 横向几何刚度、幂迭代收敛判据 |
| 能量 / 互校 | `verify.ts`、`jointSolve.ts` | `energyResidual`、`springStrainEnergy`、节点法 |
| 实体/框架生成 | `generator.ts` | `addSolid`、`SolidConfig.form`、`SOLID_PRESETS` |
| 刚体静力（E2） | `rigid.ts` | `model.rigid` 路由 |
| 机构运动学/动力学（E3） | `mech.ts`、`kinematics.ts`、`dynamics.ts` | `solveMech` |
| 算例数据 | `examples.ts`、`examples-mech.ts` | `EXAMPLES`、`EXAMPLES_MECH` |

### 3.2 三维画布 `src/scene/space/`

| 组件 | 责任 |
|---|---|
| `Canvas3D.tsx` | 静力画布；相机 `CameraRig`（只在首次/视图按钮时改 position）、轴标签、图例入口 |
| `Members.tsx` | 构件圆柱 + 杆力标签；**过滤 `Member.hidden`**；标签只标 \|N\| 前 8 根 |
| `Solids.tsx` | 实体块几何：环坐标同 generator；半透明填充 + `EdgesGeometry` 棱线；点击拦截地面拾取 |
| `Nodes.tsx` / `Supports.tsx` / `Loads.tsx` | 结点球、支座图元与紧凑标签、荷载箭头 |
| `Deformed.tsx` / `BucklingMode.tsx` | 复用 `Members`，自动继承隐藏过滤 |
| `Reactions.tsx` | E2 刚体受力图层 |
| `MechCanvas.tsx` | E3 动画画布、轨迹、速度/加速度箭头 |
| `palette.ts` | 场景双主题色板（WebGL 吃不了 CSS 变量） |

### 3.3 编辑 UI `src/ui/space/`

| 文件 | 责任 |
|---|---|
| `EditorPanel.tsx` | 工具面板、结点/构件/刚体编辑、材料/截面库、输入单位（工程制↔SI 只影响输入框）、实体/框架参数 |
| `ResultCard.tsx` | 计算假设行、位移/杆力/反力/内力/应力表；行点击选中；只看非零/按 \|N\| 排序；拒答块 |
| `MechPanel.tsx` | 播放条、时程小图、tKey 对账表、参数表 |

### 3.4 页面与状态 `src/pages/`

| 文件 | 责任 |
|---|---|
| `Space.tsx` | 算例库列表（E1/E2/E3 分组、卡片 meta） |
| `SpaceDetail.tsx` | 只读详情；画布用 `.canvas-solid`，布局与装配台同构 |
| `SpaceBuild.tsx` | 自由装配主页面；`TrussBuild` 状态机（工具、选中、撤销/重做、草稿、KPI、底栏、视图请求） |
| `App.tsx` | hash 路由（`space/build` 必须先于 `space/t/` 判定） |

### 3.5 门禁与快照 `scripts/` + `snapshots-space/`

| 文件 | 作用 |
|---|---|
| `build-space-snapshot.mjs` | 重生 47 份快照（静力 34 + 机构 13） |
| `check-space-solve.mjs` | 快照与实时解逐字段一致 |
| `check-space-verify.mjs` | 手算基准（B3、C7、C12、D 系列等） |
| `space-snapshot-lib.mjs` | 快照序列化/比较工具 |
| `check-report.mjs`（C1） | UI 层术语扫描：禁用「杆件 / 加杆 / 删杆 / 选杆…」，统一「构件」 |

---

## 4. 不变量与红线

### 4.1 数值与快照

- `snapshots-space/*.json` **不许手改**；内核口径变化走 `npm run snapshot:space` 重生，再跑 `check:space-solve`。
- `Solution3D` 的缺键口径是红线：纯桁架不得输出 `internals`/`stress`/`buckling`/`energy`/`simplify` 等键，否则快照漂移。
- 静不定必须给「结果依赖 E/A」警告；机构必须拒答并点名结点/自由度。
- 能量互校必须含弹簧应变能；节点法互校只在 `det.m + rTrans === 3·det.n` 时启用。

### 4.2 实体块 vs 框架

- `SolidConfig.form = 'solid'`（默认）：真正的实体块——画布只画填充体 + 棱线，内部刚性连接标记 `Member.hidden`，**照常参与求解但不显示、不进结果表/KPI/headline**。
- `SolidConfig.form = 'frame'`：只生成可见框架构件（按「面斜杆」开关）。
- 实体内部支撑强制几何不变（不受 `diagonals` 开关影响）；只有新增构件时才写 `TrussModel.solids`，避免叠出半透明厚度。
- 删除结点：同步从 `SolidBody.nodes` 摘除；结点删光则实体记录一并消失。
- 不要给实体内部连接加 `sigmaAllow`/截面，它们不应出现在强度校核表里。

### 4.3 单位

- 模型内部一律 SI（m、N、Pa、m²、m⁴）。
- `EditorPanel` 的「材料输入单位」只改输入框显示（GPa/cm²/cm⁴ ↔ Pa/m²/m⁴），**输出永远是 kN / mm / MPa / kN·m**；文案不得写成「模型级单位」。
- 批量材料 E/A 会同时把梁的 G 覆写为 `E/2.6`（ν=0.3），不要退回只改 E/A。

### 4.4 画布与相机

- 相机 `position` 只在「首次挂载」和「点视图预设按钮（nonce 递增）」时改变；模型编辑只更新 `controls.target`，否则连续放点会被拉回默认视角。
- 轴标签用 `CanvasTexture` Sprite，不用 drei `Html`（避免每次挂载多一个 React root）。
- 构件/结点标签走屏幕空间（不加 `distanceFactor`），字号 9.5–10px。
- 变形放大上限 2000×；画布图例必须常驻「×N（真实 … mm）」。

### 4.5 交互

- `Esc`：取消 pending 并退回「选择」工具。
- `Delete/Backspace`：删除选中（结点级联）；输入框聚焦时不生效。
- `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`：撤销/重做；`e.isComposing` 时不响应。
- 「新建」= 清空到空白模型（可撤销）；「复位」在模型与算例一致时禁用。
- 结果表行点击 → 选中对应构件/结点（`ResultCard` 的 `onSelectNode/onSelectMember`）。

### 4.6 文案与可访问性

- UI 层统一用「构件」，禁「杆件 / 加杆 / 删杆 / 选杆 / 一根杆 / N 根杆 / 杆行 / 杆线 / 裸库」（C1 门禁）。
- 不放宽断言/阈值/容差来让门禁变绿。
- 新增工具按钮、图层开关、撤销类动作时补 `data-testid`。

---

## 5. 最近更新记录

### 2026-11-21 · 三维装配台体检修复（本轮）

**数值可信性**

- 结果卡常驻「本结果基于：E / A / I / 材料」；默认截面不再隐形。
- 批量材料同步 G=E/2.6；切梁时提示默认截面。
- KPI 未设 σallow 时显示「强度校核：未设」。
- 「材料口径」改名「材料输入单位」，注明输出固定工程制。
- 变形放大上限 50 → 2000，图例常驻真实位移。

**拒答与文案**

- 拒答 headline 改为概括句，`刚度矩阵奇异…` 只出现一次。
- `Typewriter` 加 `once`，重解不再重播。
- 下拉算例名去掉 QA 括号；移除「Q2」编号。

**交互 / 布局**

- 新增「新建」空白模型；「复位」与「恢复原算例」同状态禁用，去掉矛盾 confirm。
- 结果表行可点选；构件轴力表支持只看非零、按 |N| 排序。
- 标签只标 |N| 前 8 根。
- 右栏结果卡置顶；`<lg` 允许整页滚动；空态卡上移；支座标签压缩。
- 机构模式：去「帧 61」、时间读数与滑杆合并、补充对账时刻说明。
- 无障碍：工具/图层/撤销类 `data-testid`、批量 E/A `aria-label`、快捷键常驻提示。

### 2026-11-21 · 实体块

- 新增 `SolidBody` 与 `TrussModel.solids`（缺键时旧口径完全不变）。
- `addSolid` 支持 `solid`（真实体 + 隐藏内部连接）与 `frame`（可见框架）。
- 新增 `Solids.tsx`：填充体 + 棱线；点击拦截地面拾取并提示堆叠/连件方式。

### 2026-11-21 · 内核加固

- P0-2 零刚度自由度凝聚记录 + 全模型无构件拒答。
- P0-3 位移量级判据（`max|u|/minL > 5e-2` 或 `|θ|>1 rad` 失败）。
- P0-4 桁架几何刚度改横向；幂迭代收敛判据「连续 5 步 λ 相对变化 <1e-5」。
- P0-5 缺 Wy/Wz/Wt 的构件跳过应力并警告，不许按 0。
- P0-6 能量互校计入弹簧应变能。
- P0-7 固定端 6 与节点法计数口径统一（`rTrans`）。
- S2 扫描 100 段剪力零点；M10 `Wt=J/min(b,h)`；M2 按行尺度选主元；M6 计入 `fx2/fy2/fz2`；M7 加绝对底；L5 求解异常转结果卡。

### 更早的 UI 批次（摘要）

- 画布高度链、相机适配、视图预设、空态、KPI、图例会线型。
- 撤销/重做（先捕获 `prevModel.current`）、自动草稿、切模式确认。
- 荷载/E-A/截面失焦提交、单位制切换、暗色下拉、选中态被玻璃按钮规则覆盖。
- 算例详情页改用 `.canvas-solid` 与装配台同构布局。

---

## 6. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| 控制台出现 `ReferenceError` 或旧文案 | dev HMR 残留；硬刷新（Ctrl+Shift+R）再看 |
| `synchronously unmount a root` | drei `Html` + StrictMode 的开发期提示；非空 3D 页面会有，生产不输出 |
| `releasePointerCapture` NotFoundError | three/drei 指针捕获竞态，非功能错误 |
| `check` 在 `vite build` 后失败 | dist 被清空；先 check 后 build |
| `check-space-solve` FAIL | 内核数值变了：重生快照并人工确认变化合理，不许手改 JSON |
| C1 术语失败 | UI 文案里出现了「杆件」等词，改「构件」 |
| 相机每次编辑都跳 | 检查是否在 effect 里改了 `camera.position`，只应更新 `controls.target` |
| 实体块里有可见杆件 | 实体内部构件必须 `hidden: true`；检查 `form` 与过滤逻辑 |

---

## 7. 提交前检查清单

- [ ] `npx tsc --noEmit` = 0
- [ ] `npm run check` 全绿（含 check:space-verify / check:space-solve）
- [ ] 改过内核数值 → 已 `npm run snapshot:space` 并人工核对差异
- [ ] `npx vite build` 成功
- [ ] 浏览器实测目标页：0 error（除上述开发期提示）
- [ ] 新增 UI 文案无「杆件」类术语；新增控件有 `data-testid` / `aria-label`
- [ ] 没有把快照、过程报告、截图打进 `dist`
