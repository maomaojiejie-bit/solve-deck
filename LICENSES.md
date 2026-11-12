# LICENSES — 拆解台 · SolveDeck

本文件记录图元来源、求解思路白名单与实际依赖许可。P0/P1 阶段不引入任何第三方
图元文件或求解引擎；`public/symbols/**` 下全部 SVG 为本项目按 IEC 60617 风格自绘。
P1 只读外壳只增加 UI 运行时（React）与排版/公式依赖（Tailwind、KaTeX），
注册表 D2 的 solver 仍为 null。

## 1. 图元（public/symbols）

- 电子族 25 个、力学族 17 个，共 42 个独立 SVG。
- 全部为自绘实现：`2px` 描边、`#000` 单色、`fill:none`、无内嵌文字、
  端子/锚点由 `symbolRegistry.ts` 写死，不从 SVG 运行时解析。
- 未复制、未改名分发任何第三方库文件。
- `fuse / lamp` 本轮不生成（设计稿 v2 第 7 节）：28 型题目用不到；需要时按
  「注册表加一行 + 一个独立 SVG」补，不进 P0/P1 交付。

## 2. 白名单来源与实际使用情况（构建期参考，运行时零依赖）

| 来源 | 许可（设计稿第 7 节） | 本次使用 | 说明 |
|---|---|---|---|
| circuit-symbol-svg | MIT (A) | 仅形状参照 | 未取得源文件，按 IEC 自绘 R/C/L/D/LED/V/SW/GND |
| KiCad 官方符号库 | CC-BY-SA（仅形状参考） | 仅形状参照 | 未分发、未转换任何原库文件 |
| digitaljs | **BSD-2-Clause（实际包）** | P3 路径 B 门级传播 | devDependency（构建期）；只在 Node 校验脚本中使用，不进客户端 bundle |
| schematic-symbols | MIT (A) | 仅 pins 尺寸归一化参考 | 未引入运行时包 |
| wavedrom | 待人工核实 | 未使用 | 许可未核实，P2 前不引入 |
| MechanicsSketches | (A) | 仅形状参照 | Python 工具未进入运行时 |
| edubeam | (A) | 仅 `BeamModel` 交互范式参考 | 未引入代码 |
| Truss-Analysis- | (B) | 仅算法思路参考 | react-konva 未引入 |
| StructuralForceDiagrams | (B) | 仅结果侧绘图思路参考 | 未引入代码 |
| FrameX | (C) | 仅隔离对照 | 后端与代码均未引入 |
| mohrpy | MIT (A) | 仅 `StressState2D → (center, radius)` 思路 | 未引入代码 |

求解思路白名单（`boolean-minify`、`logi.js`、`circuit-simulator`、
`nerdamer`/`Algebrite`/`math.js`、`Pyodide+SymPy`、`mathsteps`、
`@jtgtools/xbeam`、`FEAScript-core`、`SectionBuilder`）在 P0 均未安装、
未复制源码。第三方引擎只允许出现在 `goldenSet` 或隔离 worker。

## 3. 已安装依赖（P0/P1）

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| react | ^19.3.1 | MIT | UI 运行时（P1） |
| react-dom | ^19.3.1 | MIT | UI 运行时（P1） |
| katex | ^0.19.1 | MIT | 公式渲染；字体随包落盘进 dist，零外部请求 |
| vite | ^8.3.7 | MIT | 构建 |
| @vitejs/plugin-react | ^6.3.0 | MIT | 构建 |
| tailwindcss | ^4.3.5 | MIT | 样式 |
| @tailwindcss/vite | ^4.3.5 | MIT | Tailwind Vite 插件 |
| typescript | ^7.0.2 | Apache-2.0 | 类型检查 |
| @types/react | ^19.3.0 | MIT | 类型 |
| @types/react-dom | ^19.3.0 | MIT | 类型 |
| @types/katex | ^0.16.8 | MIT | 类型 |
| @types/node | ^26.6.6 | MIT | 类型（Node 校验脚本） |

### 3.1 P3 校验栈依赖

| 包 | 版本 | 许可（实际 package.json） | 版权 | 用途 / tier |
|---|---|---|---|---|
| digitaljs | 0.14.2 | **BSD-2-Clause**（指令写 BSD-3，实际为 2 条款；已按原文记录） | Copyright 2018 Marek Materzok | D2 路径 B：门级逐拍传播 / devDependency（构建期） |
| @helander/quine-mccluskey-js | 1.0.0 | MIT | Copyright (c) 2019 Jonah Pierce | D2 路径 C：QMC 化简 / devDependency（构建期） |
| nerdamer | — | Apache-2.0（待启用，未声明） | 见包内 LICENSE.md | 后续符号校核；本轮已从 package.json 删除 |
| 3vl | 1.0.1 | BSD-2-Clause | digitaljs 的传递依赖（已显式声明） | 三值逻辑信号 / devDependency |

> **DECLARED_LICENSE_CONFLICT**：本轮指令 B1 把 `digitaljs` 标为 BSD-3-Clause；`node_modules/digitaljs/package.json` 与 `LICENSE` 实际是 **BSD-2-Clause**。本文件按实际原文登记，未按指令字样改写。BSD-2 不在 GPL/EPL 禁令内，许可门禁放行。

**Apache-2.0 NOTICE**：`nerdamer` 本轮已删除（待启用、未声明），不在产物中；P3 新增的版权/许可声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)，完整许可证原文在 P10 收口时随构建产物落盘。

版本以 `package-lock.json` 为准。KaTeX 的字体文件随构建产物落盘（本地资源，
无 CDN / 无运行时外部请求）。MIT / Apache-2.0 的完整许可原文、版权年份与
NOTICE 在 P10 收口时统一打包进 `THIRD_PARTY_NOTICES`；P1 未引入任何 GPL
系列依赖。

## 4. 禁止清单

GPL/AGPL/LGPL/CC-BY-SA 项目（K-Map-Solver、Stabileo、Logisim.app、
open-logic、KiCad 原库）与需服务端/Python 后端的项目（FrameX 后端、
anaStruct、NGSpice）零引用。未核实许可的项目（truth-table-solver、
beamsjs、`@spice-ts/core`、mohr-circle、Stress_calculator、
beam-deflection-calculator、jsWebSPICE、ngspiceX、WaveDrom LICENSE）
在人工核实 SPDX 前不得引入。