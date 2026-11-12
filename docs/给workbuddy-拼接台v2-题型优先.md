# 拼接台 v2 · 题型优先的骨架装配台（给 WorkBuddy 的任务单）

> 依据：《自定义拼接台方案.md》（下称"原案"）+ 仓库现状（28 型 + 7 变体、16 道门禁、`render_spec` 渲染器、`ParamSpec` 参数实验）。
> 一句话：**原案的交互顺序是对的，实现路线要换。** 先选题型不是"限制用户"，而是把"猜图"换成"复核"，置信度与计算量同时变好。

---

## 0. 三句话结论

1. **采纳**原案的交互顺序与底线：①选题型 → ②载入骨架 → ③在骨架上增删改 → ④确认已知量 → ⑤分步求解，且"未选题型时求解按钮禁用"。
2. **改造**原案的自由画布：不引 `@xyflow/react`，用现有 `render_spec` 渲染出的图元做"点击式装配"（点图元→右侧属性面板；`+ 构件/器件`→插入；`连线`→两次点击）。**零新依赖**，坐标由布局算法给，用户不拖坐标。
3. **不重写**求解器：题型定了，就不需要通用求解器。原案 W5/W6（自写 MNA + Newton + 工作区判定 + 通用刚度法）**整段砍掉**，改成"画布模型 → 该模板既有 solver 的输入"的适配器。省下约 2.5 天，也避开最大的正确性风险。

---

## 1. 原案逐条处置

| 原案条目 | 处置 | 理由 |
|---|---|---|
| §1 交互五步 + 状态机 | **全采纳** | 这就是"提高置信度、减少计算量"的机制本身 |
| §1「禁止跳过选题型直接让系统猜图」 | **全采纳**，并写成硬门禁 | 未选 `templateId` 时 `solving` 不可达 |
| §2.1 单一画布、按 family 切图元面板 | 采纳（族改为 `electronics` / `mechanics` 两个 tab） | 与现有 D/A/M/S 四科对齐 |
| §2.4 图元一个一 SVG + registry 单一源 | 采纳，但**直接用现有 `public/symbols/electronics/*.svg` 与 `SYMBOLS` 表** | 已有 27 个符号 + 引脚契约，不再造 |
| §2.4 禁 `<img>` 承载、运行时内联 | 采纳 | 现有渲染器已经是内联 svg |
| §2.2 `semanticTag` 默认 `unknown`、禁启发式补 | **采纳**（仅电路） | 这是"等效图能不能出"的关键开关 |
| §3 全套 TS 契约 | **精简采纳**：`CanvasPreset / CanvasGraph / RequiredField / DiffReport / ConfidenceReport`；`CircuitNetlist`、`BeamModel` 只保留最小字段 | 原案字段与既有 `render_spec`/`ParamSpec` 大量重复 |
| §4.2 一个 MNA、两次器件替换（DC→linearize→AC） | **不做**。现有 A 系列已按模板提供 DC 与小信号两条解 | 通用 DC/AC 双模型是 3 天量级的重写，且与"题型优先"相矛盾 |
| §4.3 载荷断点 + 分段积分 | **不复用**（现有 M 系已具备），但**采纳**"力偶致 M 台阶且 V 不变"作为验收项 | |
| §4.4 `ImageImportSession` | 采纳顺序（候选 → 人工确认 → 提交），**候选不计分** | 与现有 `#/solve` 的待确认表同一套规则 |
| §5 置信度六项加权 + 阈值 0.80 | **采纳框架，改为八项**（补 `scope` 的题型优先版、补 `structure`） | 见 §6 |
| §5.2 硬闸门（含"浮空节点/理想电容环路/跨级反馈"） | 采纳电路三项；力学换成"机构/约束不足/孤立支座" | |
| §5.3 三档 F/N/U + `ConfidenceBadge` 两态文案 | **全采纳**，这条最能防"看起来对" | |
| §5.3「残差全绿 ≠ 等效图正确」 | **全采纳**，写成两条独立链 | 与 17 轮门禁哲学一致 |
| §6 Step Player 由 `stepIndex` 统一驱动 | 现有已具备，只补 `stepIndex=3` 在 `N` 档的替换 | |
| §7 可选增强 P1–P3 | 全部标"可选、默认关闭"；只做 P2「用户补标签升档」 | 这条直接兑现"提高置信度" |
| §8 W0–W10 | **重排为 W8a–W8d**（见 §8） | 与既有里程碑对齐 |

---

## 2. 为什么"先选题型"同时降置信度风险、又降计算量

**置信度侧**：题型一旦选定，`scope` 从"猜出来的"变成"声明过的"——
- 求解器只需处理该型的已知模型（共射就是共射、简支就是简支），不存在"这到底是不是反馈放大器"的歧义；
- 语义项也只在该型的器件白名单里问（共射要问 `bias/coupling/bypass/load`，共源才问 `Rss`）；
- 越界题（超静定、反馈环、多级）在选题型那一刻就能拒绝，而不是算完再说。

**计算量侧**：原案要写"通用 MNA + Newton + 判区循环 + 通用 2D 刚度法"，约 2.5 天且极易出隐性错。题型优先后，只需写 **6 个适配器**（每个 60–120 行）：把画布模型翻译成既有 solver 的入参。省下的时间全部投到门禁与降级。

---

## 3. 数据契约（精简版，直接落地）

```ts
export type CanvasFamily = 'electronics' | 'mechanics';
export type Fidelity = 'F' | 'N' | 'U';

/** 骨架来源：由该模板的 render_specs[0] 直接生成，保证"打开就有一张对的图" */
export interface CanvasPreset {
  templateId: string;
  family: CanvasFamily;
  nodes: { id: string; kind: string; x: number; y: number; rot?: 0 | 90 | 180 | 270; label?: string }[];
  edges: { id: string; from: string; to: string; kind: string; points?: [number, number][] }[];
  note: string;             // 「这是共射的器件级交流通路，VCC 已按此处理」
}

/** 用户在骨架上的编辑结果 */
export interface CanvasGraph extends CanvasPreset {
  dirty: boolean;                       // 与 preset 不一致
  removed: string[];                    // 删掉的 nodeId / edgeId
  added: { nodes: CanvasPreset['nodes']; edges: CanvasPreset['edges'] };
  patches: Record<string, Record<string, number>>;   // nodeId → { 参数名: 值 }
  semantic: Record<string, SemanticTag>;             // deviceId → 标签，默认 unknown
}

export type SemanticTag = 'bias' | 'coupling' | 'bypass' | 'load' | 'feedback' | 'stage_link' | 'supply' | 'unknown';

export interface RequiredField { key: string; label: string; unit: string; min?: number; max?: number; required: boolean }

export interface DiffReport {
  structural: boolean;                  // 结构被改过（增删/改连接）
  paramDirty: string[];                 // 被改过的参数 key
  accepted: boolean;                    // 结构改动是否仍在 allowedDevices/允许操作集内
  reason?: string;                      // 超出时的人话 + 怎么办
}
```

**硬约束**：`CanvasGraph` 里**不存**渲染用的像素信息（不用来画图），只存模型。渲染永远是 `CanvasGraph → render_spec → SVG`，一次单向。

---

## 4. 交互五步（顺序固定在状态机里）

```
idle → templateSelected → canvasDirty → awaitingConfirm → solving → solved
```

1. **选题型**：复用首页 28 型 + 7 变体芯片；`?tab=` 不带 `templateId` 时只显示选择器。
2. **载入骨架**：从 `render_specs[0]` 生成 `CanvasPreset`，**打开就是一张对的图**（这是与原案最大的体验差别——原案是空画布）。
3. **装配**：允许的操作集（写死，超出即拒绝并说人话）：
   - 删器件/构件（删了会让模型不可解的，先提示再删）
   - 加器件/构件（只能从 `allowedDevices` 白名单里加）
   - 改连接（两次点击两个引脚/锚点；非法连接当场拒）
   - 改参数（复用 `ParamSpec`，越界标红不夹取）
   - 改支座/载荷类型（力学：`pin/roller/fixed`；载荷 `point/udl/moment`）
   - 标语义（电路：点器件选 `bias/coupling/...`，**默认 unknown**）
   **不允许**：拖动坐标（布局算法给）、改图元样式、改求解结果。
4. **确认已知量**：`RequiredField` 表逐格确认；来源列写 `骨架 / 用户 / 默认`，**默认值也要点一次**。
5. **分步求解**：走该模板既有 solver，`steps` 由 `stepScript` 绑**本次真实值**生成（沿用现有机制）；改参数即时重算。

**换题型**：清空 `CanvasGraph` 并重建骨架，**不叠加**（原案这条是对的，写进状态机）。

---

## 5. 适配器（唯一的"新求解代码"）

每个模板一个，签名统一：

```ts
export type SolverAdapter = (g: CanvasGraph) => {
  input: unknown;                 // 该 solver 的既有入参
  appliedRules: string[];         // 结构改动带来的换算（如"Rc 从 VCC 改挂到交流地"）
  problems: string[];             // 不可解的原因，人话
};
```

首批六个（覆盖两族最常改的场景）：

| 适配器 | 覆盖模板 | 关键换算 |
|---|---|---|
| `frameBeam` | M3 / M3-cantilever | 支座吸附节点、载荷 `t∈[0,1]` → 位置 x；力偶 → `M` 跳变 |
| `trussTriangle` | S5 | 杆件拓扑改动后重算 `m=2j-3`，不等即拒 |
| `bjtPi` | A3 / A3-CB / A3-CC | 删 `Rc` → 输出短接到交流地；删 `Rl` → 空载 |
| `mosPi` | A5 / A5-CG / A5-CD | 同上，另加 `Rss` |
| `opampIdeal` | A6 / A7 | 改 `R1/R2` 位置 → 重路由反馈 |
| `netDc` | A1 / A2 / A4 + 新增分压 | 纯电阻网络直接套 MNA |

**门禁**：每个适配器必须满足「骨架不改 → 结果与既有快照逐位一致」（≤1e-9）。这条比任何新功能都重要，它是"拼接台没有偷偷算错"的唯一证据。

---

## 6. 置信度：八项加权 + 硬闸门 + 三档

**同比分只在同一 `templateId` 内。** 固定 `threshold = 0.80`，页面显式展示总分、阈值线、分项条、扣分原因与关联 id。

| key | w | 计算（全部确定性） |
|---|---:|---|
| `structure` | 0.22 | 1 − 非法操作数/总操作数；结构改动仍在白名单内给 1 |
| `semantic` | 0.22 | `1 − unknown/总数`；关键标签缺一项 −0.15；冲突计数扣分（**仅电路**，力学恒给 1） |
| `residual` | 0.18 | `1 − clamp(maxResidual / tol)`，`tol = 1e-6` |
| `dualPath` | 0.14 | `1 − clamp(两条路径相对差 / 1e-6)`（沿用现有双路径） |
| `boundary` | 0.10 | 端部条件 / 量纲量级 / 单位换算是否全过 |
| `scope` | 0.08 | 题型已选且器件全在白名单内 → 1；出现白名单外器件 → 0 |
| `golden` | 0.06 | 该型夹具数/期望数 × 历史通过率，缺项按中性给分并标「数据不足」 |

### 硬闸门（先于分数，命中即降 U 或 N）

- 电路：关键语义 `unknown > 0`（降 N）/ 浮空节点 / 理想电容环路 / 白名单外器件（降 U）
- 力学：`机构` / 约束不足 / 重复约束 / 孤立支座（降 U）
- 通用：`scope` 越界 / 残差 > 1e-6 / 双路径不一致（降 N）

### 三档

- **U 拒答**：给原因码 + 已完成步骤 + 回退入口（"换题型 / 换个骨架"）
- **N 仅数值**：保留全部数值（反力、`Q/M`、`Av/Ri/Ro`、逐步代入），**绝不渲染等效图**，`stepIndex=3` 换成「等价模型 + 方程」
- **F 完整**：0–4 帧 + `appliedRules` 证据卡 + 等效图

`ConfidenceBadge` 两态文案不许混：`F` =「等效电路已验证」；`N` =「数值已验证，等效图待确认语义」。
**残差全绿不许包装成等效图正确**——数值走残差链，等效图走 `appliedRules` 审计 + 用户语义确认，两条链分开。

---

## 7. 门禁

| 脚本 | 断言 |
|---|---|
| `check:canvas` | 28 型的 `canvasPreset` 都能从 `render_specs[0]` 生成；骨架不改时结果与快照逐位一致（≤1e-9）；换题型不叠加 |
| `check:assemble` | 六个适配器各 3 例（不改 / 删一个元件 / 加一个元件）；非法操作（白名单外器件、孤立支座、悬空引脚）返回原因码；`m=2j-3` 不等即拒 |
| `check:confidence` | 八项单调性（把任一语义改 `unknown`，总分必降且 `F→N`）；阈值 0.80 固定；`N` 档 `stepIndex=3` 必替换；`U` 档必带回退入口 |
| 变异 3 条 | ① 适配器把 `Rc` 极性写反 → `check:assemble` exit 1；② 把 `unknown` 当 `bias` → `check:confidence` 的单调性断言 exit 1；③ `N` 档偷偷渲染等效图 → exit 1 |

---

## 8. 任务卡（顺序不可颠倒）

- **W8a · 骨架与装配**（1.5 天）：`canvasPreset` 生成器（`render_specs[0] → CanvasPreset`）、`#/lab` 三栏壳、点击式装配（选/加/删/连线/改参/标语义）、状态机与"未选题型禁用求解"。门禁 `check:canvas`。
- **W8b · 六个适配器**（1.5 天）：只做上表六个，每个"骨架不改 → 同解"必须过。门禁 `check:assemble`。
- **W8c · 置信度与三档**（1 天）：八项加权、硬闸门、F/N/U、`ConfidenceBadge` 两态、`N` 档第 3 帧替换。门禁 `check:confidence` + 3 条变异。
- **W8d · 壳与打磨**（1 天）：`/lab` 与结果页视觉统一（新令牌 + `.card`/`.elev`/`.kicker`）、URL 分享（`#/lab?t=A3&dirty=1&p=Rc:3000`）、导出 PDF 带 `appliedRules` 与置信度分项、移动端静态门禁、`docs/shots/lab-*.png` 五张。

**先做 W8a+W8b（无置信度也能跑），再 W8c。** 反过来会变成"分数好看但装配不可靠"。

---

## 9. DoD

- [ ] 5 步内跑通：选题型 → 载入骨架 → 增删一个元件 → 确认已知量 → 分步求解；**未选题型时求解放置灰**
- [ ] 骨架不改时，`#/lab` 结果与 `#/t/<id>` 逐位一致（≤1e-9）
- [ ] 非法操作（白名单外器件 / 孤立支座 / 悬空引脚 / 桁架 `m≠2j-3`）**当场拒绝并给人话**
- [ ] 语义标签默认 `unknown`，任何启发式自动补一律视为 bug
- [ ] 置信度八项显式可见、阈值线固定 0.80、每条扣分带关联 id
- [ ] `N` 档**绝不出现等效图**，`stepIndex=3` 换为等价模型 + 方程；`ConfidenceBadge` 两态文案不混
- [ ] 三组门禁 + 3 条变异全绿；`npm run verify` = 0
- [ ] 移动端 500/375 真视口不横向溢出（记：Edge headless 的 375 是裁剪不是重排，用 `check:responsive` 静态断言）

---

## 10. 不做什么（写死）

- 不做自由拖拽画布、不做 CAD、不做 3D、不做动力/瞬态/AC 扫频/噪声/BSIM
- 不写通用求解器（牛顿迭代、工作区判定循环、通用刚度法全部不做）
- 不做 AI 生成拓扑（AI 只能选题型 + 填数，见 W9）
- 不引新依赖（`@xyflow/react`、`elkjs` 都不引；排版继续用现有布局函数）
- 不改任何既有 solver 的结论，不为让门禁变绿调容差
