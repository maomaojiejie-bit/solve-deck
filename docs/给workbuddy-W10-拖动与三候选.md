# W10 · 拼接台加两件：自由拖动 + 一键生成三个候选电路

> 前置：W8（`#/lab` 已上线，骨架来自 `render_specs[0]`，归约器 7 型）。
> 两件事都不引新依赖：拖动用现有 SVG 上的 pointer 事件，"生成三个"用已有的三份快照。

---

## A. 自由拖动

### A.1 为什么可以不做成 `@xyflow/react`

拖动需要的是「命中测试 + 坐标更新 + 导线跟随」，这三件在现有渲染器上都能做：

- 现有 `AnalogSchematic` / `Schematic` 已经把每个图元画成 `<g transform="translate(x,y) rotate(r)">`；
- `SYMBOLS[kind].pins` 给了每个引脚的局部坐标，`pinAt(kind, at, rot, pin)` 已经是现成的世界坐标函数；
- 导线端点本来就是"引脚世界坐标"，`schematicBoard.link()` 的单折规则也在。

**所以拖动 = 改节点坐标 + 重算导线折点**，不需要第二个画布库，也不需要把 SVG 换成 div 节点。

### A.2 实现

**新 prop**（只影响 lab，不影响结果页）：

```tsx
// src/render/SpecGrid.tsx / AnalogSchematic.tsx
interface SpecGridProps {
  /* …现有… */
  editable?: boolean;                        // 默认 false：结果页行为完全不变
  onNodeMove?: (id: string, x: number, y: number) => void;
}
```

**交互**：

| 动作 | 行为 |
|---|---|
| `pointerdown` 在图元（`<g>` 有 `data-node-id`） | 记录起点、`setPointerCapture`、图元加 `.dragging`（提亮 + 投影） |
| `pointermove` | 坐标增量为 `(dx, dy)`，**吸附 8px 网格**；实时更新该节点 transform |
| `pointerup` | 调 `onNodeMove(id, x, y)` → 写回 `CanvasGraph` → **重算所有导线折点** |
| 拖到面板外 | 夹回 `[0, panelW/H]`，不跑丢 |
| 双击图元 | 该节点「自动整理」到最近的布局位（调用现有布局函数重排整张图） |
| `Esc` 或面板「撤销拖动」 | 回到拖动前坐标（保留一次 undo 栈） |

**导线跟随的做法**（关键）：拖动过程中**不重算整图**（会抖）；`pointerup` 之后统一跑一次

```ts
// src/core/lab/relayout.ts
export function relayout(g: CanvasGraph): CanvasGraph;   // 只重算 edge.points，不动节点坐标
```

规则：对每条导线 `[pinA(x,y) → pinB(x,y)]`，若已水平或垂直对齐则直连；否则取中点折一次（沿用 `link()` 的 `bend` 规则）。**拓扑不变，所以归约结果不变**——这也是一条门禁。

**拖动不许做的事**：不许改 `rot`（旋转仍走属性面板）、不许拖动到别的图元身上时自动"吸附成堆叠"（重叠就重叠，`check:schematic` 的 S7 只约束结果页快照，lab 的图不进快照）。

### A.3 门禁

| # | 断言 |
|---|---|
| 1 | 拖动任意节点后，`reduce()` 出的 `params` **逐键不变**（坐标不是模型，不许影响解） |
| 2 | 拖动后每条导线的端点仍在引脚上（误差 < 0.6，与 `check:schematic` 的 END_EPS 同口径） |
| 3 | 拖动并把图元挪到边界外 → 坐标被夹住，不出画布 |
| 4 | `editable=false`（结果页）时 pointer 事件不绑定，DOM 里无 `data-draggable` |

变异：把 `onNodeMove` 写成也改 `params` → 第 1 条 exit 1。

---

## B. 「一键生成三个候选电路」

### B.1 语义

在 lab 顶栏加一个按钮 **「生成 3 个候选电路」**（力学页显示「生成 3 个候选结构」）。点一下，弹出三张卡片，每张是一张**能直接求解的图**，选一张就载入画布。

候选来自**同一题型的三个族**，而这三份图**仓库里已经有快照**，所以每一张都能立刻验证"可解且与既有结果一致"：

| 题型 | 三个候选 | 依据 |
|---|---|---|
| `A3` BJT | 共射 CE / 共基 CB / 共集 CC | `A3`、`A3-CB`、`A3-CC` 三份快照已在 |
| `A5` MOS | 共源 CS / 共栅 CG / 共漏 CD | `A5`、`A5-CG`、`A5-CD` |
| `A1` | 整流（半波） / 稳压（齐纳）/ 限幅 | `A1` 的两种 mode + 候选图 |
| `A6` 运放 | 反相 / 同相 / 跟随器 | `A6` 两种 topology + 跟随（R1→∞ 极限） |
| `M3` 梁 | 简支 / 悬臂 / 带外伸 | `M3`、`M3-cantilever` + 外伸变体 |
| `S5` 桁架 | 三角 / 双三角 / 加竖杆 | `S5` + 两种扩展 |

**卡片内容**（每张）：缩略图（用现有渲染器画 240×140）、标题（共射放大器）、一句「改了什么/为什么选它」、两个按钮「载入画布 / 只看看」。

### B.2 为什么这样做比"AI 生成拓扑"稳

- 三个候选都是**确定性构造**（固定拓扑 + 参数从当前图继承），不是模型生成，不会出现"图是错的但看着像对"。
- 每个候选都有既有快照背书，所以门禁是"逐位相等"，不是"看起来对"。
- 用户从"我想改结构"变成"我想换成另一种接法"——这正是工程题里最常发生的改法（共射算出来不合适，换共集看输入阻抗）。

### B.3 数据

```ts
// src/core/lab/candidates.ts
export interface LabCandidate {
  id: string;                 // 'A3-CB'
  title: string;              // '共基放大器（CB）'
  why: string;                // '输入电阻低、高频好；输出与输入同相'
  graph: CanvasGraph;         // 完整可解图
  baseTemplateId: string;     // 归约用哪张 pick 表：'A3'
  snapshotId: string;         // 用来做同解门禁：'A3-CB'
}
export function candidatesOf(templateId: string, base: CanvasGraph): LabCandidate[];
```

`graph` 由 `seedGraph(snapshotId)` 生成，然后把**与 base 相同的参数**（`Rc/Rl/Rs/beta/Ic/VA`）继承过去——同一道题的三种接法，数值不该变。

### B.4 门禁

| # | 断言 |
|---|---|
| 1 | 每个候选 `reduce()` → solver → `values` 与对应快照**逐位相等**（≤1e-12），覆盖上表 6 型共 18 张 |
| 2 | 候选载入后 `CanvasGraph.baseTemplateId` 正确，归约走对 pick 表 |
| 3 | 参数继承：base 改 `Rc=3300` 后生成候选，三个候选的 `Rc` 都是 3300 |
| 4 | 「只看看」不改当前 `CanvasGraph`（`dirty` 不变） |

变异：把 CB 候选的 pick 表指向 `A3`（用 CE 的表）→ 第 1 条 exit 1。

---

## B2. 顺带修一个真缺口：语义标签不全

我扫了 lab 的 DOM，下拉只有 5 个值：

```
bias, bypass, coupling, supply, unknown
```

规格里是 7 个（少了 **`load`**、**`feedback`**、**`stage_link`**）。这不是小事：

- A3 的 `Rl` 只能标 `unknown` → `semantic` 永远不过 → **A3 在 lab 里几乎必然落 N 档**，用户会以为"这工具只能说数值"。
- A7 的反馈电阻同理，标不了 `feedback`，"反馈环"这条硬闸门也就永远不触发。

改法：

1. `SemanticTag` 补三个值，下拉补齐；
2. 「关键标签」按题型声明，不要全局一刀切：

| 题型 | 必须确认的标签 |
|---|---|
| A3 / A5 | `bias`（偏置电阻）、`coupling`（耦合电容）、`load`（负载） |
| A7 | `feedback`（反馈电阻）、`load` |
| A1 | `supply`、`load` |
| 数字 / 力学 | 无（`semantic` 恒 skipped，不降档） |

3. 门禁补一条：对 A3 把 `Rl` 标 `load`、`Rc` 标 `bias`、`Rs` 标 `coupling` 后，`semantic` 必须 pass 且 tier 升到 F。

---

## B3. 顺带修第二个真缺口：S5 的杆件根本不在装配列表里

我 dump 了 `#/lab/t/S5` 的「画布器件」，只有三条：

```
n-sup-A  固定铰   [固定铰/可动铰/固定端]
n-sup-B  可动铰   [固定铰/可动铰/固定端]
n-load   P = 10 kN  [删]
```

**三根杆（AC / AB / BC）一条都不在。**「加入器件」里也只有支座和载荷，没有杆。

于是 W8 宣传的那条装配用例 ——「删一根杆 → `m≠2j-3` → 拒绝并建议加一根杆」——**在界面上根本走不到**。`check:assemble` 第六个用例之所以绿，是因为它直接调 `reduce()`，绕过了 UI。门禁绿了，用户做不到，这比红更糟。

改法：

1. 力学族把 **member（梁段/杆件）也列进「画布器件」**，每行可删、可改截面（`A/I/E`）、可改两端连接（铰接/刚接）；
2. 「加入器件」补 `+ 杆件`（在现有两个节点之间连一根）；
3. `check:assemble` 的第六个用例改成**走 UI 动作序列**（点删杆 → 读页面判据），不是直接调 `reduce()`；
4. 这条也顺带解决 M 系：删一段梁应当同样被 `m`/静定性判据挡住。

---

## C. UI 位置

lab 顶栏从

```
[A3 · BJT 三种组态]                 [分享此图] [分步求解]
```

改成

```
[A3 · BJT 三种组态]   [生成 3 个候选]  [自动整理]  [分享此图] [分步求解]
```

- 「生成 3 个候选」→ 抽屉/弹层，三张卡片横排（窄屏竖排）
- 「自动整理」→ 调现有布局函数重排整图（拖动乱了的救援按钮）

---

## D. DoD

- [ ] 结果页不受影响：`editable` 默认 false，DOM 无拖动绑定，`check:schematic` 的 16 项照旧
- [ ] 图元可拖、吸附 8px、出界夹住、拖动后导线仍接在引脚上
- [ ] 拖动**不改变任何求解结果**（门禁 1）
- [ ] 「生成 3 个候选」对 A3/A5/A1/A6/M3/S5 都能出三张，每张可载入可求解
- [ ] 18 张候选全部与既有快照逐位相等
- [ ] `npm run verify` = 0（新增 `check:lab` 扩展项，不新增脚本）
- [ ] 零新依赖、不改 solver、不加容差

---

## 一句要你确认的话

"自动生成 3 电路"我按**「同一题型的三个组态/接法」**理解（A3 → CE/CB/CC、A5 → CS/CG/CD、梁 → 简支/悬臂/外伸）。

如果你要的是别的意思——比如**从一段网表自动画出三种布局**、或者**从表达式自动生成门级电路**——说一句我就改，代价是候选表要重写。
