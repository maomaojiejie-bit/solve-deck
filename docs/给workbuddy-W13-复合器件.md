# W13 执行单：复合器件（把一组器件封成带端口的模块）

> 前置自检（不满足就先别开工，回去补 W11/W12）：
> - [ ] `src/core/lab/picks.ts` 的 `PICKS` 含 16 型
> - [ ] `src/render/symbols.ts` 有 `PIN_LABEL`
> - [ ] `npm run verify` = 0
>
> 做完停下等我验收，别自己接 W14。

---

## 0. 为什么这一批值得做

现在拼接台能改**单器件**（删/加/改种类/连线），但用户没法表达"这三个器件其实是一个东西"。

而**我们的架构让这件事很便宜**：复合器件不需要新求解器、不需要 stamp、不需要方程，只要在 `reduce()` 之前把 `composite` 节点**展开成它内部的那几个器件**，然后一切照旧（既有 solver、既有六项校核、既有 F/N/U）。

**不做的**（写死，别自己加）：
- 不让用户写方程/stamp（L3 永不开放）；
- 不支持嵌套超过 2 层；
- 不做"复合器件带自己的求解器"。

---

## 1. 数据模型

新建 `src/core/lab/composite.ts`：

```ts
import type { CanvasEdge, CanvasNode } from './types';

export interface CompositePort {
  /** 对外端口 id（就是 composite 节点的引脚名） */
  id: string;
  /** 对应内层哪个节点（内层局部 id） */
  nodeId: string;
  /** 中文名，显示在引脚 tooltip 与端口标注面板 */
  label: string;
}

export interface CompositeDef {
  id: string;                    // 'cmp-divider'
  title: string;                 // '分压器'
  note?: string;                 // 一句话说明（卡片上显示）
  ports: CompositePort[];
  inner: { nodes: CanvasNode[]; edges: CanvasEdge[] };  // 局部坐标，局部 id
  modelSpec: {
    equations: string[];         // ['Vout = Vin · R2/(R1+R2)']
    applicableRange: string;     // '直流、线性、R1+R2 ≤ 1 MΩ'
    units: Record<string, string>;  // { R: 'Ω', V: 'V' }
  };
  goldenRefs: string[];          // 至少一条已校验夹具，如 ['A1-01']
  createdAt: string;
}
```

`CanvasNode` 加一个可选字段：

```ts
/** 复合器件实例：指向 CompositeDef.id；给了这个就忽略 kind。 */
compositeId?: string;
```

`CanvasNode`/`graphFromSpec`/`graphToSpec` 的往返必须保留它（门禁会验）。

**存放**：内置三个写死在 `src/core/lab/compositeBuiltin.ts`（分压器、并联电阻对、π 模型子块）；用户自定义存 `localStorage['sd.lab.composite.v1']`（JSON 数组，与 `sd.ai.v1` 并列，不进 URL 的 key 名空间）。

---

## 2. 展开（核心算法，约 60 行）

```ts
export function expandComposites(
  graph: CanvasGraph,
  defs: Record<string, CompositeDef>,
): { graph: CanvasGraph; expanded: { compositeId: string; title: string; count: number }[]; problems: string[] }
```

规则：

1. **单层展开**：遇到 `node.compositeId` → 用 `defs[compositeId]` 换掉。内层节点 id 一律重命名为 `cmp/<compositeId>/<nodeId>`，内层边同样加前缀。允许内层再有 composite（深度 ≤ 2），第 3 层出现即 `problems.push('复合器件嵌套超过 2 层')` 并整图判 U。
2. **端口合并**：外层凡是连到 `composite 节点 · portId` 的边，改连到 `cmp/<compositeId>/<port.nodeId>`。即**端口就是内层某个节点**，展开后内外两层是同一个电气节点。
3. **坐标**：内层节点按 `composite` 节点位置偏移（`+x, +y`），保证摊开后图不难看；只影响观感，不影响归约。
4. **未连接端口**：展开后若某端口内层节点在展开结果里度数为 0，`problems.push('复合器件「分压器」的端口 Vout 悬空')`，但**不阻断求解**（悬空端口是合法电路状态），只警告。

调用点：`reduce()` 的第一行，`graph = expandComposites(graph, defs).graph`；`problems` 并入 `ReduceResult.problems`；`expanded` 逐条写进 `appliedRules`（文案：`展开复合器件 分压器（R1+R2，3 器件）`）。

**`picks.ts` 一行都不用改** —— 这是本批的关键收益。

---

## 3. 封装流程（UI）

入口：选中 ≥2 个节点后，画布右上出现「封装为复合器件」按钮（多选：`Shift+点击` 或框选，二选一，优先 `Shift+点击`）。

三步面板：

1. **端口标注**：列出所有"跨边界的节点"（选中集合内部节点中，有边连到外部或连到 vsrc/gnd 的）作为候选端口，每条给一个默认中文名（`节点 A`、`电源正端`…），用户可改名、可勾掉（不勾的端口视为内部，不对外）。
2. **命名与说明**：`title` 必填、`note` 选填。
3. **校验后保存**：点保存前先跑一次 `expandComposites` + `reduce`，
   - 归约失败 → 红字「封装后无法归约：<原因>」，**不许保存**；
   - 归约成功 → 绿字「封装后可解：Av=−46.26」，允许保存。

保存后：画布上那组节点替换成一个 `composite` 节点（`kind: 'block'`，引脚 = 端口）。

---

## 4. 硬闸门（照调研 §3.4 原样接受，写进 `tiers.ts`）

1. `modelSpec` 缺 `equations` 或 `applicableRange` 或 `units` → **判 U**，原因码 `missingModelSpec`，不进求解。
2. `goldenRefs` 为空 → **判 U**，原因码 `missingGoldenCase`。
3. 展开后的内层设备必须全部在白名单里 → 否则判 U，原因码 `compositeOffWhitelist`（**复合器件不能当夹带通道**）。
4. 复合器件**不计入 semantic 正向分**：`semantic` 判据只看原生器件；复合器件存在时，`F` 档徽章文案改成「等效电路已验证（含 1 个自定义模块，未纳入语义评分）」。

---

## 5. 分享

`?g=<base64>` 现在只带 `CanvasGraph`。图里若引用用户自定义复合器件，**必须把用到的 `CompositeDef` 一起塞进去**：

```ts
{ graph, defs: CompositeDef[] }   // 只带本次用到的，不带全部
```

不带就会出现"我分享的图在别人机器上少了一块"。门禁要钉这条。

---

## 6. 门禁（`scripts/check-composite.mjs`，接进 `build`）

1. **展开幂等**：同一张含复合器件的图，展开一次与展开两次结果逐字段相等。
2. **参数不变**：把一个复合器件（分压器）摊开成 R1+R2 后，`reduce().params` 逐键相等（≤1e-12）。
3. **缺 modelSpec → U**：删掉 `equations` → `tierOf` 返回 U + 原因码 `missingModelSpec`。
4. **缺夹具 → U**：`goldenRefs: []` → U + `missingGoldenCase`。
5. **白名单**：把内层一个电阻改成 `opamp`（不在该型白名单）→ U + `compositeOffWhitelist`。
6. **嵌套深度**：构造 3 层嵌套 → `problems` 出现「超过 2 层」，整图 U。
7. **分享携带**：`?g=` 里必须含 `defs`，且接收端能还原同一张图（`graph` 深比较相等）。
8. **悬空端口只警告不阻断**：端口不接东西 → `problems` 有一条，但 `tier` 仍是 F。

变异三条（每条必须 exit 1）：
- 把端口合并写成"新建节点"而不是"合并节点" → 第 2 条红（参数会变）；
- 删掉 `modelSpec` 校验 → 第 3 条红；
- 分享时去掉 `defs` → 第 7 条红。

---

## 7. UI 细节（免得来回问）

- 复合器件在画布上按 `block` 渲染：圆角矩形 + 标题 + 两端引脚（复用现有 `block` 图元，`labelInside`）。
- 双击复合器件 → 「展开」：替换成内层器件（`expanded: true` 状态记在节点上，可再「收拢」）。
- 右键/更多菜单：`编辑端口`、`拆开`、`删除`（删除只删实例，不删定义）。
- 图元面板（「加入器件」）加一组「自定义模块」，列出 `localStorage` 里的 def；空的就显示一行灰字「还没有自定义模块：选中几个器件 → 封装」。
- 复合器件的引脚中文名 = 端口 `label`，接进 W12 的 `PIN_LABEL` 查找链（先查实例端口，再查 `kind:pin`）。

---

## 8. 验收

```
npm run verify           # = 0
node scripts/check-composite.mjs   # 8 条 PASS
```

截图四张：

- `lab-21-composite-panel.png`：封装面板（候选端口 + 命名 + 绿字「封装后可解：Av=−46.26」）
- `lab-22-composite-canvas.png`：封装后的复合器件在画布上（圆角块 + 端口）
- `lab-23-expanded.png`：双击摊开成 R1+R2，结果面板数值与摊开前**完全相同**
- `lab-24-missing-model.png`：缺 `modelSpec` 时判 U 的红卡 + 原因码

## 9. 报告里必须回答的三件事

1. 展开后 `params` 是否逐键相等（贴出两个对象的 diff，允许空）。
2. 摊开前后 `tier` 是否都还是 F（不是"还能解"，是"仍是 F"）。
3. 分享链接里 `defs` 的字节数（让评审知道分享的图是自包含的）。

---

## 顺手两件（W12 验收时发现，随本波一起修，不计入新功能）

1. **快填里 `Vt` 的来源判定和文案对不上**：面板上写「由 gm=38.46 mS，ro=100 kΩ 推得 Ic / VA / Vt」，
   但下面表里 `Vt` 标的是「输入」、`Ic`/`VA` 标「推得」。二者必居其一 —— 建议 `Vt` 永远算「输入」
   （它是常数 26 mV，跟着公式走过来但不是被推出来的），把文案改成「推得 Ic / VA（Vt 取 26 mV）」。

2. **两个模式页签的选中态在深色底上太弱**：`border-cyan/60 bg-cyan/10 text-cyan` 和未选中的差异只有一点点，
   截图里几乎看不出当前是哪个模式。改成 `bg-cyan/15` 加左侧 `2px` 青色竖条（或未选中降到 `text-muted/70`），
   保证一眼能分辨。这两条不新增门禁，但请在报告里说明改了哪行。

---

## P0 必修（先修这个，再做复合器件）：删器件必须连带删掉它的导线

**现象**：`#/lab/t/A3` 删掉 `Rc` 后，画布上留着它那条导线。

**我复现的证据**（脚本跑 `graphFromSpec(main,'A3','circuit')` + `applyOp('A3',g,{op:'deleteDevice',nodeId:'n-rc'})`）：

```
nodes=11 edges=11
edge 端点样例：e-in [160,336 -> 206,270]   e-c-bus [488.8,226 -> 488.8,164]
删 n-rc 后：nodes=10 edges=11 (删前 11)      ← 一条边都没删掉
```

**根因（两层，同一行代码）**：

1. `src/core/lab/ops.ts:53`
   `next.edges = edges.filter((edge) => edge.from !== op.nodeId && edge.to !== op.nodeId);`
   但 `CanvasEdge` 是 `RenderSpec["edges"][number]`，快照里 `from`/`to` 存的是**坐标字符串**（`"488.8,226"`），
   不是节点 id —— 所以这个 filter **永远匹配不到**，11 条边一条不减。
2. 新增的点击连线存的是**引脚 id**（`n-rc:a`），同样不等于 `n-rc`，也匹配不到。

**所以"删器件不删线"不是漏写，是这一行对当前两种端点形态都无效。**

**建议的修法（按 owner 删，而不是按端点比较）**：

- 在 `graphFromSpec()` 生成图时，按「端点是否落在某器件引脚坐标上」给每条边、每个 `dot` 节点记 `owner?: string`；
  bar / rail 这类跨器件共用的边，`owner` 记 `"shared"`；
- `deleteDevice` 改成：`edges.filter(e => e.owner !== op.nodeId)` + 删掉 `owner === op.nodeId` 的 dot，
  再对 `shared` 边做一次「删后吸附检查」：两端都不再吸任何剩余器件引脚 → 一并删；
- 保留 `owner` 为可选字段，不影响 `graphToSpec` 往返（门禁已有的 35 份往返无损必须仍绿）。

**验收（写进 `check:assemble`，走 UI 动作序列，不许直接调 reduce）**：

1. 在 `#/lab/t/A3` 点删 `n-rc` 后：**不存在任何端点落在 `(560,76)` / `(560,164)` 附近 1.0 单位、且另一端不与任何剩余器件相邻的边**；
2. 该器件专属的 AC 地横杠（`e-vcc-bar`）随之消失；
3. 画面里不残留孤立 `dot`（与已删引脚同坐标、且没有边穿过它）；
4. `reduce()` 的 `params` 与修前完全一致（`Rc = 1000000000000`）—— **删的是线，不是语义**；
5. 对照组：删 `Rl` 后同样成立；删 `VCC 汇流条`（shared）**不删**任何器件。

**变异一条**：把 owner 判定改成"永远返回 undefined" → 第 1 条必须变红。

做完把「删 Rc 前后画布截图」与「删 Rl 前后」两对图放进 `docs/shots/`（`lab-20-delete-rc.png` / `lab-21-delete-rl.png`）。

---

## 10. 本波执行顺序（照这个顺序做，不要并行）

1. **P0**（本文档最前面那节）：删器件连带删导线。做完先自测「删 Rc / 删 Rl / 删 shared 汇流条」三组，把 `params` 不变的证据贴进报告。
2. **顺手两件**（`Vt` 来源文案、模式页签选中态）：各改一两行，报告里说明改在哪。
3. **复合器件**（§1–§8）：数据模型 → `expandComposites` → 封装 UI → 四条硬闸门 → 分享带 `defs` → `check:composite`。
4. 跑 `npm run verify`，**停在 0**，别接 W14（撤销重做 / 段内 `t` 载荷）。

**纪律**：不许改求解内核（`src/core/templates/**`、`mna.ts`）、不许改 35 份快照、不许放宽任何门禁阈值；
本波新增的每一条断言都要做一次变异验证（改红再还原），并在报告里写「变异 → 谁红了」。
