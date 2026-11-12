# 给 WorkBuddy：SolveDeck 力学接入（第一波 F0）

> 直接把下面「—— 以下是我要说的话 ——」之后的内容整段发给它。

—— 以下是我要说的话 ——

仓库在 `C:\Users\17897\Desktop\qoder`（SolveDeck：工科题目的五步拆解 + 图，纯静态站）。
电路部分已经做完且门禁全绿，现在要接力学。**但模型不许你另造一套，用我指定的库。**

## 开工前按顺序读三份文档

1. `docs\短令-F0适配层.md` —— 这一波的任务书（73 行，就干这个）
2. `docs\短令-F力学.md` —— 15 型的总规格，**§0 是模型来源，必读**
3. `docs\电路接线守则.md` —— 现有门禁的风格与红线（怎么算「过了」）

读完再动手，不要先改代码。

## 这一波的边界（重要）

只做**适配层 + 门禁**，**不碰任何 UI、不画任何图、不动 render_spec**。
力学图、模板卡片、首页入口都是下一波的事。这一波结束就停下来等我确认。

## 模型来源：用它，不要重写

```
C:\Users\17897\.dsh\profiles\desktop\node_modules\dsh-mech-workbench\scripts\analyze.py
python "<上面这个路径>" --spec <spec.json>      # 或 --spec-json '<json>'
```

它吃一份 spec，吐一份 JSON（反力 / 内力 / 极值 / 应力 / 校核 / warnings）。支持的写法：

- `kind`：`bar`｜`beam`｜`shaft`
- `supports`：`{ x, type: 'fixed'|'pin'|'roller' }`
- `loads`：`point_force`｜`distributed`｜`point_moment`｜`point_torque`
- `section`：`{ shape: 'rect'|'circle'|'tube'|'ishape', params, E? }`
- 可选 `stations`、`units`

符号约定（照抄，别改）：

```
N(x) = -Σ_{a<x} Fx        Q(x) = +Σ_{a<x} Fy
M(x) = +Σ_{a<x} [(x-a)·Fy - Mz]        T(x) = -Σ_{a<x} Mx
```

**它的能力边界（我已经核过源码，别指望它算这些）**：不算挠度、没有主应力/莫尔圆、
不做稳定、没有刚体/桁架/摩擦/形心/虚功。也就是说它只覆盖 M1–M4（M8 的 σ 能半用），
其余（M5/M6/M7/S1–S7）是后面几波自己写 —— 这一波不要碰。

## 交付四件

1. `src/core/mechanics/spec.ts`：`MechSpec` 类型，字段名与库**一字不差**，不许改名或加自定义字段。
2. `scripts/export-fixtures.mjs`：对文档里列的 **8 个 spec** 各跑一次库脚本，把 `{ spec, expected }`
   写到 `fixtures/mech/<name>.json`（M1-axial-01、M2-torsion-01、M3-cantilever-01、M3-simple-P-01、
   M3-simple-q-01、M4-rect-01、M4-circle-01、M8-combined-01）。**其余 9 型这波不要造 fixture。**
3. `src/core/mechanics/solve.ts`：按库的算法复刻 M1–M4 与 M8 的应力。静不定时返回
   `{ determinate:false, message:'静不定，当前只解静定' }`，**不许凑答案**。
4. `scripts/check-mech-parity.mjs`：TS 结果 vs fixture，相对误差 **1e-9**，不一致打印
   `型 / 字段 / TS 值 / 库值 / 相对误差` 并 exit 1；接进 `npm run build`。

## 必做的两条变异测试（不做等于门禁是空转）

把 `M3-cantilever-01` 的 `expected.M_max` 改 0.1% → parity 必须 exit 1；
把 `M(x)` 符号反过来 → 必须 exit 1。贴出两条的 exit code 与报错原文。

## 硬约束

- 不许新增依赖；不许改电路求解与绘图；不许动 A 系列 17 份快照。
- **不许 fork 库的公式**：这段 TS 的职责是「复刻 + 被 parity 钉住」，不是「我觉得更对就改」。
  两者不一致时，先怀疑自己的实现，再怀疑 spec 写错，最后才来问我。
- 改含中文的源文件一律用 node 的 `fs.writeFileSync(path, s, 'utf8')` 写，
  **不要用 PowerShell 的 Get-Content/Set-Content**（本机会把 UTF-8 读成 cp936，整篇乱码）。

## 报告给我四行就够

1. `check:mech-parity` 的 PASS 行（几份 fixture / 几个字段比对）；
2. 两条变异测试的 exit code 与报错原文；
3. `npm run verify` 是否仍为 0；
4. 库里有没有「该复用但我没写进文档」的字段（有就列出来，别自己加）。

做完停下，不要自己开 W1。

—— 以上 ——
