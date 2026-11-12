# W10-A：把拼接台「用户真能做的动作」补齐

> 只做这一批。拖动、三候选、22 型覆盖都不在这份里（下一批）。
> 依据与证据：`docs/拼接台-功能缺口清单.md`。

## 背景（三行）

1. 拼接台现在能跑通「选型 → 骨架 → 删/加器件 → 改参数 → 确认 → 求解 → 分享」，覆盖 7 型。
2. 但有三处会让用户当场踩空：**A3 的语义永远标不全**（源码里 `SEMANTICS` 只有 5 个，缺 `load/feedback/stage_link`，A3 必然掉 N 档）；**S5 的杆件不在装配列表里**（「删一根杆 → 拒绝」在界面上走不到）；**结果页没有去拼接台的入口**。
3. 这批就是把这三处补平，顺带补「恢复骨架」和「改器件种类」。

---

## 任务 1 · 语义标签 8 个 + 关键标签表

`src/pages/Lab.tsx:32` 现在是：

```ts
const SEMANTICS = ['unknown', 'bias', 'coupling', 'bypass', 'supply'];
```

改成 8 个：

```ts
const SEMANTICS = ['unknown', 'bias', 'coupling', 'bypass', 'supply', 'load', 'feedback', 'stage_link'];
```

并加一张**按题型声明关键标签**的表（不是全局一刀切）：

| 题型 | 必须确认的标签 |
|---|---|
| A3 / A5 | `bias`（偏置电阻）、`coupling`（耦合）、`load`（负载） |
| A7 | `feedback`（反馈电阻）、`load` |
| A1 | `supply`、`load` |
| 数字 / 力学 | 无（`semantic` 恒 skipped，不降档） |

语义判据改成：**该题型声明的关键标签全部非 `unknown` 才 pass**（现在只要"没有 unknown 器件"就 pass，等于没判关键项）。

下拉每一行显示中文，别只显英文：

`unknown 未标 / bias 偏置 / coupling 耦合 / bypass 旁路 / supply 供电 / load 负载 / feedback 反馈 / stage_link 级间`

## 任务 2 · 力学杆件进「画布器件」

现在 `#/lab/t/S5` 的「画布器件」只有三条（`n-sup-A` / `n-sup-B` / `n-load`），杆件在 `graph.edges` 里，UI 从来没渲染过。

1. 力学族（`family === 'beam'`）在「画布器件」下面加一节 **「杆件 / 梁段」**，逐条列出 `graph.edges`：

   ```
   AC  桁架杆  [删]
   AB  桁架杆  [删]
   BC  桁架杆  [删]
   ```

2. 新增两个 op（签名照抄，别改形状）：

```ts
| { op: 'deleteMember'; edgeId: string }
| { op: 'addMember'; from: string; to: string; kind: 'frame' | 'truss' }
```

3. 「加入器件」补一个 `+ 杆件`：先点两个节点（复用现有「两次点击」的选择器状态），再插入一条边。**不要**让用户在输入框里手打节点 id。

4. 删杆后 `reduce` 会因为 `m ≠ 2j−3` 判 `structure fail`，页面必须给**可执行的建议**，不是只说"不通过"：

   > 杆数 2，节点 3：静定桁架需要 m = 2j−3 = 3。少一根杆，这个三角形闭合不了 —— 补一根（比如 A–C）或用「恢复骨架」回到原始结构。

5. 加杆后必须立刻能解（`m = 3` 回到静定），数值与 S5 快照逐位一致。

## 任务 3 · 结果页与读题页的入口

- `src/pages/Result.tsx` 顶栏（「复制链接 / 导出 PDF」那排）补一个次要按钮：**「改结构 →」**，指向 `#/lab/t/<templateId>`。
- `src/pages/Solve.tsx` 的确认卡下方，在「确认无误 → 开始拆解」旁边补一行小字链接：**「这题的结构和模板不太一样？去拼接台改结构 →」**。
- 只有 `SUPPORTED_IDS` 里的 7 型才显示这个按钮；其余型不要显示（避免点进去是空页）。

## 任务 4 · 恢复骨架

lab 顶栏加一个 `恢复骨架` 按钮：

```ts
setGraph(seedGraph(templateId));  // 与打开时完全一致
```

同时清 `dirty`、清掉 `appliedRules`、清掉 `problems`。加了确认（`window.confirm` 或二次点击），因为会丢掉所有改动。

## 任务 5 · 改器件种类

`changeKind` 这个 op 已经存在，但 UI 只给支座用了下拉。给电路族的 `res / cap / vsrc / diode` 也加一个下拉（`电阻 / 电容 / 电压源 / 二极管`），切换时保留 `value`、把不兼容的 `params` 丢掉。

---

## 门禁（`scripts/check-assemble.mjs` 补四条）

1. **走 UI 动作序列**：在 `#/lab/t/S5` 点掉一根杆 → 页面出现「静定桁架需要 m = 2j−3 = 3」；再点「恢复骨架」→ 页面回到可解状态。**不许直接调 `reduce()`**。
2. 语义：A3 把 `Rl` 标 `load`、`Rc` 标 `bias`、`Rs` 标 `coupling` → `semantic` pass 且 tier 升到 **F**（现在最多到 N）。
3. 语义负例：只标 `Rl` 一个 → 仍然 N 档（证明判据没有放水）。
4. 恢复骨架：改动后点恢复 → `graph` 与 `seedGraph` 逐字段相等、`dirty === false`。

变异测试两条：
- 把关键标签表里 A3 的 `load` 删掉 → 第 2 条必须红；
- 把 `deleteMember` 改成静默 return → 第 1 条必须红。

---

## 验收

```
npm run verify                 # = 0
node scripts/check-assemble.mjs # 新四条 PASS
```

截图三张，落 `docs/shots/`：

- `lab-06-members.png`：S5 的杆件列表 + 删杆后的琥珀判据卡（带 `m = 2j−3` 那句建议）
- `lab-07-semantic.png`：A3 标全三个关键标签后 tier 徽章变 **F**
- `lab-08-reset.png`：改过两张图之后点「恢复骨架」回到原始状态

## 不做（这批别碰）

- 拖动节点、生成 3 个候选、`?p=` 参数覆盖（W10-B）
- 22 型覆盖补齐（W11）
- 截面 `A/I/E` 输入口（等 M1/M2/M7 进 lab 时一起做）
- 别为了绿而放宽既有断言；语义判据只能变严，不能变松
