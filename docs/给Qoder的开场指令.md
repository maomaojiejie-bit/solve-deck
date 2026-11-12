# 给 Qoder 的开场指令（可直接粘贴）

你先读这两份文档，再动手：

- `docs/电路接线守则.md` —— 画电路图 + 推导小信号的经验（十节，含 14 条已落成门禁的断言）
- `docs/交接-P45数值加固.md` —— 这一轮做到哪、错在哪、接下来做什么

## 第一步：让仓库回到绿的（别在红的基础上叠功能）

上一轮我把 `src/core/templates/analog/A5.ts` 里的 `solveA5PortTest` 和 `parallel` 误删了，tsc 现在不通过：

```
src/confidence/buildtime/a5Paths.ts(7,3): error TS2305: Module '.../A5.ts' has no exported member 'solveA5PortTest'.
src/core/templates/analog/A5.ts(157,15): error TS2304: Cannot find name 'parallel'.
```

`交接-P45数值加固.md` §2 第一节有这两段原样代码，粘回去，`npx tsc --noEmit` 回到 0 再往下做。

## 铁律（违反任何一条都算没做完）

1. **容差不能替近似背书**：不许为了让门禁变绿去调 `VA`、容差、期望值。这一轮的病根就是 `VA=2000V`。
2. 不许改 `scripts/check-schematic.mjs` 的断言来让代码通过；要放宽必须先在交接文档写清理由。
3. 改布局/图形后必须 `node scripts/build-example.mjs <ID>` 重建快照，否则门禁读旧快照给假绿。
4. 改含中文的源码只用 node `fs.writeFileSync(p, s, 'utf8')`。PowerShell 的 `Get-Content`/`Set-Content` 会把 UTF-8 文件整篇弄乱（已经踩过两次）。
5. 改代码用 `write` 写 `.mjs` 脚本再 `node <file>` 跑，不要内联 `node -e`（引号和 `[` 必炸）。

## 已完成（别重复做，只需验证）

- A3 三组态（CE/CB/CC）的手推解析式已改成**含 ro 闭式**，与 MNA 残差 1e-14 以内。
- A5 三组态（CS/CG/CD）同理。
- 新增 `solveA3NoRo` / `solveA5NoRo`，只用来算「忽略 ro 的百分比误差」，不作答案。
- `A3_DEFAULT.VA` 已从 `2000` 改为 `100`。
- 因此**所有 golden 与快照都失效了**，必须重算（见待办 4、5）。

## 待办（按顺序）

1. 还原 `solveA5PortTest` 与 `parallel` → `npx tsc --noEmit` 回 0。
2. `src/core/templates/analog/registry.ts`：`SMALL_SIGNAL_PATHS` 第三项去掉 `tolerance: 1e-3` 与 `approximation`，回默认 `1e-6`。
3. A7 的 `asymptotic` 路径：加 `T < 100` 适域拒绝（报「超出深度负反馈近似域」），`AfDeep` 只作参照、不作答案位。
4. 重算 golden：`src/confidence/goldenSet/a3.ts` 的期望值用**闭式**重算（不要用 MNA 算，否则 golden 失去独立性）；`residualThreshold` 收到 `1e-9`。
5. 重建快照：`node scripts/build-example.mjs A3 A5 A6 A7`。
6. **新增配置扫描门禁**（这轮最该做的）：现在 `check:p3` 只验默认组态（CE/CS），CB/CC/CG/CD 的式子写错了构建照样绿。做法：遍历每个模板的所有组态，各跑一遍 MNA vs 闭式，残差 > `1e-9` 即 FAIL。
7. 变异测试：把 CB 的 `k` 改回漏乘 `RcL`（就是那个 1667 倍的错），确认新门禁变红，再改回来。
8. 文档改名：`registry.ts` 里的「回路电流法」→「端口测试法」（VCCS/CCCS 不是平面网络，通用 mesh 未实现），并在交接文档记一条债。
9. 收尾：`npm run verify` 全绿。

## 画图时最容易被忽略的三条

- **三端器件的引脚不在中心**：npn 是 `c(8.8,-44)`、`e(8.8,44)`；配 Rc/Re 时 x 要 `+10`，写成中心会得到一条 10 单位的斜线（肉眼几乎看不出，但读者会觉得「哪不对劲」）。
- **标签间距 ≥150**：`gm·vbe (38.5mS)` 约 110 单位宽，两个器件贴近必然叠字。
- **控制量用 `dashed` 且端点悬空**：vbe/vgs 是控制量不是电流通路，受控源输入端不接线；接成实线图就变成短路。

## 守则第十节最值钱的一句

测输出电阻时**受控源也在出力**：

```ts
I_test = (v_c - v_e) / ro;               // ❌ 只算无源支路
I_test = (v_c - v_e) / ro - gm * v_e;    // ✅ 受控源在抽电流
```

漏掉后一项会得到 `ro·A/(A-1) ≈ ro`，看起来几乎对（1998.002 vs 1999.9305，相对 9.6e-4），这是最难发现的错。化简后的统一式：`Ro_partial = ro + Rp(1 + gm·ro)`。

另一个自查法：**残差如果是「一个干净的数」而不是 1e-3 零头，先回式子找漏乘的并联项**——CB 的增益差 1667 倍，正好就是 `Rc∥Rl`。

## 验收

`npx tsc --noEmit` = 0；`npm run build` = 0（含 `check:schematic` 14/14、`check:p3` 35/35）；变异测试全部拦下；A3/A5/A6/A7 快照 `allPassed=true`。
