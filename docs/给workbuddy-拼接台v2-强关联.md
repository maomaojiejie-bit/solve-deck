# 拼接台 v2 · 强关联现有代码（给 WorkBuddy 的任务单）

> 依据：《自定义拼接台方案.md》（原案）+ 本仓真实代码。
> 前提结论：**原案要的数据契约，这个仓里已经全都有了**——缺的不是类型，是"没有任何东西产出它们、也没有任何东西吃它们"。

---

## 0. 三个已经核实的事实（决定了这一版怎么落）

**事实 1：原案 §3 的契约已经在 `src/core/types.ts` 里。**

| 原案里的名字 | 本仓已有 | 位置 |
|---|---|---|
| `SymbolDef`（含 `pins / anchors / highlightable / params / rotation`） | ✅ 同名同字段 | `src/core/types.ts` `export interface SymbolDef` |
| `Netlist`（`devices[]` + `connectors: [deviceId,pinId] 两段式`） | ✅ 同名 | 同上 `export interface Netlist`（`kind: 'circuit' \| 'logic'`） |
| `BeamModel`（`nodes / members / supports / loads(t∈[0,1]) / section`） | ✅ 同名 | 同上 `export interface BeamModel` |
| `ConfidenceReport`（六项 + `checks[]` + `skipped`） | ✅ 已有，且比原案更细（`CheckState = 'pass'\|'fail'\|'skipped'` + `skipReason`） | 同上 |
| `SolverInput = Record \| Netlist \| BeamModel` | ✅ 已声明 | `src/core/templates/registry.ts` |

**事实 2：`Netlist` 与 `BeamModel` 目前是"死类型"。**

```
Select-String -Path src\**\*.ts,src\**\*.tsx -Pattern '\bNetlist\b|\bBeamModel\b'
# 排除 types.ts 后：0 处
```

也就是说：全仓 28 个模板的 solver 至今只吃 `Record<string, number|string>`；**没有任何代码产出网表，也没有任何代码消费网表**。这是唯一真正的缺口，也是这一版要补的全部。

**事实 3：三件配套已经就位，不用重造。**

- `src/core/symbols/symbolRegistry.ts`：36 条 `SymbolDef`（**19 条 electronics + 17 条 mechanics**），`public/symbols/electronics/` 27 个 SVG、`public/symbols/mechanics/` 17 个 SVG。
- `#/scope` 已经上线：`src/pages/Scope.tsx:41` + `src/App.tsx:18`（`{ page: 'scope' }`）、`App.tsx:27`（`hash === 'scope'`）。**"题型优先"的门本来就是现成的。**
- 渲染/播放/置信度/PDF 全链路：`src/render/SpecGrid.tsx`、`src/ui/StepPlayer.tsx`、`src/ui/ConfidenceBadge.tsx`、`src/ui/ParamPanel.tsx`、`Result.tsx` 的 `exportPdf`。

---

## 1. 核心设计：不写求解器，写「归约器」

原案 §4 要"通用 MNA + Newton + 判区循环 + 通用刚度法"（它的 W5/W6）。**这一版整段不做**，改成一个函数：

```ts
// src/core/lab/reduce.ts
export interface ReduceResult {
  params: Record<string, number | string>;   // 直接喂给既有 entry.solver()
  appliedRules: string[];                    // 结构改动带来的换算，逐条给人看
  problems: string[];                        // 归约不唯一 / 不可解，人话
  outOfScope: boolean;                       // true → 置信度 U 档
}

export function reduceNetlist(templateId: string, net: Netlist): ReduceResult;
export function reduceBeam(templateId: string, beam: BeamModel): ReduceResult;
```

**做法**：对每个模板声明"这个题型的参数从哪几个器件取"：

```ts
// 例：A3（共射/共基/共集）
{
  templateId: 'A3',
  pick: {
    beta: { device: 'Q1', field: 'params.beta' },
    Ic:   { device: 'Q1', field: 'value' },
    Rc:   { device: 'RC', field: 'value', required: true },
    Rl:   { device: 'RL', field: 'value', optional: true, missing: 1e12 },  // 空载 → 取极大值
    Rs:   { device: 'RS', field: 'value' },
    Re:   { device: 'RE', field: 'value', optional: true, missing: 0 },
    VA:   { device: 'Q1', field: 'params.lambda', transform: 'lambda→VA' },
  },
  reject: (net) => {
    const rc = net.devices.filter((d) => d.symbolId === 'resistor' && d.id.startsWith('RC'));
    if (rc.length > 1) return '输出端出现了两个集电极电阻，本题型不支持；换用拼接台完整模型或改题型';
    return null;
  },
}
```

**为什么这样最稳**：骨架不改时，归约出的 `params` 与快照里的 `parsed_given` **逐键相同**，于是既有 solver 给出逐位相同的结果——不需要新写任何求解逻辑，也就没有"通用求解器算错了"的风险。

**什么时候拒绝**（→ `outOfScope`，落 U 档）：出现白名单外器件 / 拓扑与题型对不上 / 归约不唯一（例如两个 `Rc`）。拒绝时必须给"怎么改"，不许只说"不支持"。

---

## 2. 页面：`#/lab`，复用既有四件套

```
#/lab                      → 题型选择器（复用 Home 的卡片数据）
#/lab/t/A3                 → 直接进 A3 的骨架
#/lab/t/A3?g=<base64>      → 分享一个改过的图（复用 src/core/params/query.ts 的编解码）
```

三栏与既有结果页一致（左操作 / 中画布 / 右参数与结论），底部 `StepPlayer`：

| 区域 | 用什么 | 新增量 |
|---|---|---|
| 中间画布 | **现有 `SpecGrid` + `AnalogSchematic` + `Chart`**：把 `CanvasGraph → render_spec` 后照常渲染 | 一个 `graphToSpec()` 纯函数 |
| 右侧参数 | **现有 `ParamPanel`**（吃 `ParamSpec`） | 加一列「来源：骨架/用户/AI」 |
| 右侧结论 | **现有结果面板**（`Result.tsx` 里那块 JSX 抽出来复用） | 抽组件，不重写 |
| 置信度 | **现有 `ConfidenceBadge`** | 文案按 F/N/U 三态扩一档 |
| 播放 | **现有 `StepPlayer`**（`stepIndex` 0–4 已实现） | `N` 档把第 4 帧换成「等价模型 + 方程」 |
| 导出 | **现有 PDF 导出** | 加一页 `appliedRules` |

**关键复用点**：lab 最终产出的是一个**标准 `Solution`**（`templateId / parsed_given / steps / result / render_spec / frames / confidence / warnings`）。因此给 `Result` 加一个可选 prop 即可全量复用：

```ts
// src/pages/Result.tsx
export function Result({ templateId, search, onBack, onToast, override }: ResultProps & { override?: Solution }) {
  // override 存在时跳过 getExample() 与 entry.solver()，直接用
}
```

一处改动，换来：一套渲染、一套播放、一套 PDF、一套分享链接、一套 6 项校验——**都不需要为 lab 重写**。

---

## 3. 交互五步（状态机与 `#/solve` 同源）

```
idle → templateSelected → canvasDirty → awaitingConfirm → solving → solved
```

1. **选题型**（`#/lab` 首页）——未选题型时，「分步求解」按钮 `disabled`。
2. **载入骨架**——由 `src/examples/<id>.json` 的 `render_specs[0]` 反推 `CanvasPreset`（`graphFromSpec()`，纯函数）。**打开就是一张对的图**，不做空画布。
3. **装配**（只允许这几种）：删器件/构件、加器件/构件（限 `SymbolDef` 白名单）、改连接（两次点击两个 `pin/anchor`）、改参数、改支座/载荷类型、标语义（电路专用，默认 `unknown`）。拖坐标不允许——布局由现有布局函数给。
4. **确认已知量**——复用 `ParamSpec` 渲染成表，来源列三态：`骨架 / 用户 / 默认`；**默认值也要点一次**。
5. **求解**——`graph → Netlist|BeamModel → reduce() → entry.solver()(params)`，产物是 `Solution`。

换题型：清空并重建骨架，**不叠加**（写进状态机，`check:lab` 断言）。

---

## 4. 置信度：六项沿用 + 两项可选扩展（不动 contract 版本）

现有 `ConfidenceReport` 六项（`scopeOk / inputOk / pathsConsistent / residualOk / boundaryOk / goldenOk`）**照用**，在 `checks[]` 末尾追加两项（都是可选字段，不 bump `CONTRACT_VERSION`，因此**不必重建 33 份快照**）：

| 追加断言 | 判据 |
|---|---|
| `structure` | `reduce()` 的 `problems` 为空 → pass；非空 → fail 并带上那条人话 |
| `semantic` | 仅电路：关键标签（`bias/coupling/bypass/supply`）有 `unknown` → skipped 并写 `skipReason: '语义未确认，等效图不渲染'`；力学恒 `skipped` 且写明"本型不涉及语义标签" |

三档映射（不改原有语义）：

- **U 拒答**：`scopeOk = fail` 或 `outOfScope` → 不求解，给原因 + 回退（换题型 / 换骨架 / 去 `#/scope`）。
- **N 仅数值**：`semantic` 为 skipped/fail 或 `problems` 非空 → **保留全部数值**，但第 4 帧（`stepIndex=3`）换成「等价模型 + 方程」，**绝不渲染等效图**。
- **F 完整**：六项 + 两项全 pass → 完整 0–4 帧 + `appliedRules` 证据卡 + 等效图。

`ConfidenceBadge` 两态文案保持现有风格，只加一档：
`F` =「等效电路已验证」；`N` =「数值已验证，等效图待确认语义」；`U` =「本题不适用，已给替代入口」。

---

## 5. 门禁（全部复用现有脚本位）

| 脚本 | 断言 | 接进 |
|---|---|---|
| `check:lab`（新） | 28 型 × **骨架不改** → `reduce()` 出的 `params` 与 `<id>.json` 的 `parsed_given` **逐键相等**（数值 ≤1e-12）；换题型不叠加；`graphFromSpec()` 对 33 份快照都能生成 `CanvasPreset` 且 `nodes` 数一致 | `build` |
| `check:assemble`（新） | 六个"改一处"用例：删 `Rc`／加 `Rl`／`Rd=5k`／支座 `pin→fixed`／加集中力 `P=15`／删一根桁架杆（`m≠2j-3` 必须拒）；每个都要么归约成功且结果与手算一致，要么给 `problems` 而不是崩 | `build` |
| `check:report`（新） | 三档文案互斥、`N` 档 `stepIndex=3` 必替换、`U` 档必带替代入口 | `build` |
| 变异 3 条 | ①把 `Rc` 的 `pick` 改到 `R1` 上 → `check:lab` exit 1；②让 `problems` 返回空数组（假装可解）→ `check:report` exit 1；③`N` 档偷偷渲染等效图 → exit 1 | 手动跑一次并记录输出 |

**为什么不用新写"同解"门禁**：`check:lab` 断言的是"归约后的参数等于快照参数"，而"参数相同 → 结果相同"已由现有 `check:p3` 的 58 项保证。两条拼起来就是完整的同解证明。

---

## 6. 任务卡

### W8a · 骨架与画布（1 天）

- `src/core/lab/types.ts`：`CanvasPreset / CanvasGraph / GraphOp / ReduceResult`（就这 4 个，其余复用 `types.ts`）
- `src/core/lab/graphFromSpec.ts`：`render_specs[0] → CanvasPreset`（纯函数；`rot` 从节点带过来，`edges` 带 `points`）
- `src/core/lab/graphToSpec.ts`：`CanvasGraph → RenderSpec`（供 `SpecGrid` 渲染）
- `src/pages/Lab.tsx`：选题型 → 载入骨架 → 增删改 → 确认 → 求解；三栏复用既有组件
- `src/App.tsx`：加 `{ page: 'lab' }` 与 `#/lab`、`#/lab/t/<id>`；Home 加一个入口
- 门禁 `check:lab` 的**前半**（33 份快照都能生成 preset 且节点数一致）

### W8b · 归约器（1.5 天）

- `src/core/lab/reduce.ts`：`reduceNetlist / reduceBeam` + 每型一张 `pick` 表
- 先做 **6 个模板**：`M3`、`M3-cantilever`、`A3`、`A5`、`A6`、`A1`（覆盖两族最常见改动）
- 门禁 `check:lab` 的**后半**（骨架不改 → `params` 逐键相等）
- 门禁 `check:assemble` 六用例

### W8c · 置信度与三档（0.5 天）

- `checks[]` 追加 `structure` / `semantic` 两项
- `ConfidenceBadge` 加 `U` 态；`StepPlayer` 的 `stepIndex=3` 在 `N` 档替换
- 门禁 `check:report` + 变异 1 条

### W8d · 打磨（1 天）

- `Result` 加 `override?: Solution`，`#/lab` 直接复用结果页（若时间紧，先让 lab 内联渲染）
- URL：`#/lab/t/A3?g=<base64>`，复用 `src/core/params/query.ts` 的编码器
- PDF 加一页 `appliedRules`（谁被删、谁被加、谁换算）
- 截图 `docs/shots/lab-01-skeleton.png` / `lab-02-edit.png` / `lab-03-confirm.png` / `lab-04-solved.png` / `lab-05-degraded.png`

---

## 7. DoD

- [ ] `#/lab/t/A3` 打开即是正确骨架；不做任何改动点「求解」，结果与 `#/t/A3` **逐位一致**
- [ ] 删 `Rc` → 输出短接（`Rc → 1e12` 或按题意），页面写明「已删除集电极电阻，输出端短接到交流地」，且 `appliedRules` 有这一条
- [ ] 加白名单外器件 → 当场拒绝并给替换建议，**不进入求解**
- [ ] 桁架删一杆后 `m ≠ 2j-3` → 拒解并给「加一根杆或改题型」
- [ ] 未选题型时「求解」置灰（状态机保证，不靠 `disabled` 巧合）
- [ ] 三档文案互斥；`N` 档不出现任何等效图；`U` 档给替代入口
- [ ] 三条新门禁接进 `build`，`npm run verify` = 0（现 16 道 + 3 道）
- [ ] 不新增运行时依赖；不改任何既有 solver；不为让门禁变绿调容差

---

## 8. 风险与不做

**风险**

1. `pick` 表写错 → 归约出错的参数而结果"看起来很对"。**对策**：`check:lab` 的逐键相等就是为这个准备的，先跑门禁再加模板。
2. 用户删掉关键器件后模型仍有解但物理意义变了（例如删 `Rs`）。**对策**：`appliedRules` 必须逐条显示，并写进导出 PDF。
3. 六项里 `goldenOk` 对新参数可能恒 `skipped`——**接受**（现有 `live.ts` 已是这个行为，`skipped` 带 `skipReason`）。

**不做**：自由拖拽画布、通用求解器（MNA/Newton/刚度法）、AC 扫频/瞬态/噪声、AI 生成拓扑、引 `@xyflow/react` 或 `elkjs`、改既有结论。

---

## 9. 和既有四页的关系（一句话各一句）

- `#/t/<id>`：**题目**（预置 28 型，改数值）
- `#/lab`：**装配台**（同 28 型，改结构 —— 本卡）
- `#/solve`：**入口**（贴题 → 选型 → 跳 `#/t`）
- `#/scope`：**边界**（先问你能不能算，再给出口）

四页共用一个 `Solution`、一个 `StepPlayer`、一个 `ConfidenceBadge`、一个导出。这就是"强关联"的实际含义。
