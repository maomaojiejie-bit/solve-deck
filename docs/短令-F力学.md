# 短令 · F 批次（全量接入力学：M1–M8 + S1–S7）

> 模型一律用库里的 `MechSpec`（见 §0），不自己发明数据结构。

范围：**15 型全做**，不砍科目。但必须分三波落地，**每波 `npm run verify` 全绿才能进下一波**——
这不是省范围，是省返工（上一批就吃过「改了 spec 没重建快照 → 门禁读旧快照给假绿」的亏）。

| 波次 | 内容 | 估时 |
| --- | --- | --- |
| W1 | 图引擎（坐标图 / 莫尔圆 / 受力图）+ 内力求解族 + M1 M2 M3 M4 | 1 天 |
| W2 | 应力状态 / 变形 / 稳定 / 组合变形 + M5 M6 M7 M8 | 1 天 |
| W0 | 模型适配层（对齐库 schema + fixture 导出 + 一致性门禁） | 0.5 天 |
| W3 | 静力学求解族 + S1–S7 | 1.5 天 |

> **本版已改写**：力学模型**不再自己造**，直接用库里那套 `mech_analyze` 的 spec（下面 §0）。
> 你只负责把它搬进 TS 并把图画出来，公式与符号约定以库为准。

---

## 0. 模型来源：库里的 `MechSpec`

库位置：`C:\Users\17897\.dsh\profiles\desktop\node_modules\dsh-mech-workbench\scripts\analyze.py`
（同目录还有 `presets.py` 画图展开、`symbolic.py` 符号求解，`figure.py` 通用出图。）

调用：`python scripts/analyze.py --spec <file.json>` → 一份 JSON（反力 / 内力 / 极值 / 应力 / 校核 / warnings）。

### 0.1 就是这份 schema（逐字段照抄，不许改名）

```ts
type MechSpec = {
  kind: 'bar' | 'beam' | 'shaft';
  length: number;
  supports: { x: number; type: 'fixed' | 'pin' | 'roller' }[];
  loads: (
    | { type: 'point_force'; x: number; value: number; dir?: 'axial' | 'transverse' }
    | { type: 'distributed'; x0: number; x1: number; q0: number; q1?: number; dir?: 'axial' | 'transverse' }
    | { type: 'point_moment'; x: number; value: number }
    | { type: 'point_torque'; x: number; value: number }
  )[];
  section: {
    shape: 'rect' | 'circle' | 'tube' | 'ishape';
    params: Record<string, number>;   // rect: b,h；circle: d；tube: D,d；ishape: 见库里 _SHAPE_ISHAPE
    E?: number;                       // 只影响变形，静定内力/应力不需要
  };
  stations?: number[];
  // 库里只认对象；传字符串会被静默忽略（F0 实测）
  units?: { length?: string; force?: string; moment?: string; stress?: string };
};
```

约束方提供的未知量个数（库内定死，别自己判）：`fixed` 3（`shaft` 时 4，额外给扭转）、`pin` 2、`roller` 1；
未知量数 > 方程数 → `determinate=false`，**必须原样报「静不定，当前只解静定」**，不许凑答案。

### 0.2 符号约定（库的四条，照搬到 UI 的约定盒里）

```
N(x) = -Σ_{a<x} Fx        Q(x) = +Σ_{a<x} Fy
M(x) = +Σ_{a<x} [(x-a)·Fy - Mz]        T(x) = -Σ_{a<x} Mx
```
自动满足 `dM/dx = Q`、`dQ/dx = q(x)`。每张内力图右上角带一枚「符号约定」小盒（`presets.py` 就是这么做的）。

**载荷正负（库里 `transverse` 向上为正，本文所有算例统一向下取负）**：
`P=10 kN 向下` 写成 `{ type:'point_force', x:1, value:-10 }`；
满跨向下均布 `q=5 kN/m` 写成 `{ type:'distributed', x0:0, x1:L, q0:-5, q1:-5 }`。
照此填，悬臂算例才会得到 `M(0)=-10`（上侧受拉），与本文 §2 的表格一致。

**支承怎么填（F0 实测的坑）**：库里 `pin` 记 2 个未知量，**两端都放 `pin` 就是 4 未知量 > 3 方程，
会被判静不定直接拒绝**。轴向杆件一律 `pin@0 + roller@L`（3 个未知量，正好可解）。

### 0.3 库覆盖到哪（**这一栏是给你划边界的，别越界也别重造**）

| 型 | 用库? | 怎么用 |
| --- | --- | --- |
| M1 轴向拉压 | ✅ 全用 | `kind:'bar'` + `point_force{dir:'axial'}` |
| M2 扭转 | ✅ 全用 | `kind:'shaft'` + `point_torque`（库出 `T(x)`、`τ`、`Ip/Wp`） |
| M3 弯曲内力 | ✅ 全用 | `kind:'beam'` + supports/loads，Q/M 图直接用库的 `internal` 数组 |
| M4 弯曲应力 | ✅ 全用 | 库 `stresses` 给 `σ=N/A+M·y/Iy`，并自带 `∫σdA=N`、`∫yσdA=M` 两条校核 |
| M8 组合变形（偏压/弯扭里的 σ） | ⭕ 半用 | σ 走库（轴向 + 弯矩叠加）；`σr4=√(σ²+3τ²)` 与中性轴自研 |
| M5 弯曲变形 | ❌ 库不算挠度 | 内力取库的 `M(x)`，`EI·v''=M` 的积分自研 |
| M6 应力状态 | ❌ | 主应力 / 莫尔圆自研（库无 mohr） |
| M7 压杆稳定 | ❌ | 欧拉式自研（库限制里明写不做稳定） |
| S1–S7 静力学 | ❌ | 库只有杆梁轴，没有刚体/桁架/摩擦/形心/虚功，全部自研 |

**判定原则**：能用库的必须用库（M1–M4、M8 的 σ），别在 TS 里重写一遍内力积分；
库外的（M5/M6/M7/S1–S7）才自己写，且**每个都要单独在 `check:mechanics` 里挂 golden**。

### 0.4 golden 不再是我手写的表格，而是库导出的 fixture

新增 `fixtures/mech/*.json`（每型一份，内容 = `{ spec, expected }`，`expected` 就是 `analyze.py` 的实跑输出）：

```
M1-axial-01  M2-torsion-01  M3-cantilever-01  M3-simple-P-01  M3-simple-q-01
M4-rect-01   M4-circle-01   M5-defl-01        M6-mohr-01      M7-buckling-01
M8-combined-01  S2-concurrent-01  S3-reactions-01  S4-friction-01
S5-truss-01  S6-centroid-01  S7-virtual-01
```

Qoder 只需 `import { M1 } from '../../fixtures/mech/M1-axial-01.json'`；
**库里能算的那几型，expected 一律以库里导出为准**，本文档 §5 的表格只作为「数量级抽查」的旁证（两者必须一致，不一致＝文档或库有一处错，报错而不是二选一）。

### 0.5 W0 适配层的三件东西

1. `src/core/mechanics/spec.ts`：上面的 `MechSpec`（类型），字段名与库一字不差。
2. `scripts/export-fixtures.mjs`：调 `python <库路径>/analyze.py --spec <临时文件>` 批量导出 17 份 fixture。
3. `scripts/check-mech-parity.mjs`：TS 侧 `solveMech(spec)` 的输出与 fixture 的 `expected` 逐字段比，
   相对误差 **1e-9**（内力/反力/应力），不一致就 `exit 1` 并打印 `哪个型、哪个字段、差多少`。
   接进 `npm run build`，排 `check:p3` 之后。

---

## 0.6 F0 落地后的修正与「库里现成的四样东西」

F0 已跑通（8 份 fixture / 706 字段 / 1e-9）。下面这些是实测确认的事实，**W1 起一律按这版**：

**修正**：① M1 支承改 `pin@0 + roller@L`；② 载荷向下取负（见 §0.2）；③ `units` 只认对象；
④ M4-rect 换悬臂 spec（不与 M3 重复）；⑤ M8 的力偶放 `x=0.5`（跨中会让 `M(1⁻)=+25` 与 `M(1⁺)=-25`
的 `|M|` 完全相等，谁被选中取决于 `lstsq` 的 1e-16 噪声，这种 fixture 会随 LAPACK 版本翻脸）。

**直接拿来用、别重写的四样**：

1. `checks[]`（六项：ΣFx / ΣFy / ΣM、dM/dx=Q、简支端 M=0、∫σdA=N、∫yσdA=M、平衡残差）
   —— 这就是结果页「六项校验」面板的数据源，不要自己再算一遍。
2. `conventions` 的中文符号约定文案 —— 就是内力图右上角那枚小盒的内容。
3. `warnings[]`（「本工具不计算变形」「量级可疑」「超屈服」）—— about 页「边界」直接引用。
4. `Sy`、`t_na`（τ 分布要用）、`extrema._q_zero_x`（「Mmax 出现在 Q=0 处」的标注射线）。

**运维**：本机默认 `python` 是 3.13、**没有 numpy**，直接跑库会崩；用 `py -3.12`。

---

三条铁律贯穿全程（与 A 系列同一套）：

1. **两条独立路径互校**：每型都要有「解析式」与「数值/另一法」两条路，抽样点相对误差 < 1e-9。
2. **静不定必须拒绝**：识别到多余约束就直接说「需要变形协调，当前只解静定」，不许硬算。
3. **图上的每个数字都要能被复算**：极值、标注、结论都来自 solver，不许画图时另估。

---

## 1. 三个新引擎（W1 就要做完，后面全靠它）

### 1.1 `ChartSpec` —— 坐标图（Q/M 图、轴力图、扭矩图、挠曲线）

```ts
type ChartSpec = {
  id: string; title: string; unit: string;
  xLabel: string; yLabel: string;
  xDomain: [number, number]; yDomain: [number, number];
  zeroLine?: boolean;
  series: {
    kind: 'line' | 'step' | 'area';
    points: [number, number][];
    label?: string;
    fill?: boolean;          // area 用
  }[];
  marks?: { x: number; y: number; text: string; side?: 'up' | 'down' | 'left' | 'right' }[];
  panels?: ChartSpec[];      // 双联：共享 x 轴，只有最后一张显示 x 刻度
};
```

- 曲线用采样点画（不拟合），阶梯型内力用 `kind:'step'`。
- 悬臂 / 简支的「上侧受拉」说明写在 `marks` 或 footnote 里，别只给负号。
- 轴标签纯 ASCII（`x (m)`、`M (kN·m)` 用 KaTeX 另外渲染）。

### 1.2 `MohrSpec` —— 莫尔圆

```ts
type MohrSpec = {
  sigmaX: number; sigmaY: number; tauXY: number;   // MPa
  sigma1?: number; sigma2?: number; tauMax?: number; // 由 solver 给，别自己算
  unit: string;
};
```

σ 轴与 τ 轴**比例必须一致**（画出来是圆而不是椭圆），圆心 (σx+σy)/2、半径 R 由图自身校验。

### 1.3 受力图：复用现有 schematic 引擎

只新增三种图元：`fixedSupport`（斜线阴影）、`pinSupport`（三角+铰圆）、`rollerSupport`（三角+小圆），
梁用 `line` 加粗，载荷用 `arrow`。**不要新写一个渲染器。**

---

## 2. M1–M8：模型、图、校核、标准答案

截面与材料默认值统一：`rect b=0.1 m, h=0.2 m`，`circle d=0.1 m`，`E=200 GPa`，`G=80 GPa`。

### M1 轴向拉压
- 模型：`{ L, A, P, E, segments?: {x0,x1,A}[] }`（等截面 + 可选变截面）
- 两条路径：`σ=N/A`、`ΔL=∫N/(EA)dx`；数值侧用 200 段梯形积分
- 图：轴力图 `step` + 应力分布（可选）
- 校核：`ΣFx=0`、`ΔL` 与数值积分一致、量纲
- **标准答案**：`L=1 m, A=2.0e-4 m², P=40 kN, E=200 GPa` → `N=40 kN`，`σ=200 MPa`，`ΔL=1.000 mm`

### M2 扭转
- 模型：`{ L, d, T, G, segments? }`（实心圆轴；空心另开参数 `dInner`）
- 路径：`Wp=πd³/16`、`Ip=πd⁴/32`、`τ=T/Wp`、`φ=TL/(GIp)`；数值侧对分段 T 累积
- 图：扭矩图 `step`、切应力沿半径线性分布
- 校核：`ΣMx=0`、`φ` 与数值积分一致、τ 沿径向线性
- **标准答案**：`d=40 mm, T=1.0 kN·m, G=80 GPa, L=1 m` → `Wp=1.2566e-5 m³`，`Ip=2.5133e-7 m⁴`，`τmax=79.58 MPa`，`φ=0.049736 rad/m`（≈2.85°/m）

### M3 弯曲内力
- 模型：`{ L, supports, loads, section }`，静定梁（悬臂 / 简支 / 外伸）
- 路径 A：分段解析式；路径 B：对 q 累积求 Q、对 Q 累积求 M（200 点）
- 图：`panels` 双联（Q 阶梯线 + M 折线/填充），共享 x 轴
- 校核：`ΣFy=0`、`ΣM(左端)=0`、`dM/dx=Q`（中心差分）、简支端 `M=0`
- **标准答案**（三条，逐位对齐）：
  - 悬臂 `L=2, P=10@x=1`：`R_Ay=10 kN`，`M_A=10 kN·m`(逆时针)，`Q=+10 / 0`，`M(0)=-10`（上侧受拉）、`M(1)=0`，`|M|max=10 @x=0`
  - 简支 `L=4, P=20@x=2`：`R_A=R_B=10 kN`，`Q=+10/-10`，`Mmax=20 @x=2`
  - 简支 `L=4, q=5 全跨`：`R=10/10`，`Q=10-5x`，`M=5x(4-x)/2`，`Mmax=10 @x=2`

### M4 弯曲应力
- 模型（以代码 `M4_DEFAULTS` 为准）：**简支** `L=4, a=2, P=-20 kN`，`rect b=100 h=200 mm`，`allow=160 MPa`；圆截面对照 `d=100 mm`
  —— 不要复用 M3 的 spec（同一份 spec 在两型各钉一遍等于只测了一次，F0 反馈）。
- 路径：`σ=M·y/I`；`W=rect: bh²/6 / circle: πd³/32`；`τ=1.5Q/A`（矩形）`4Q/(3A)`（圆）
- 图：截面正应力线性分布（`dist` 风格：上压下拉，标注 σmax）
- 校核：`∫σdA=0`、`∫yσdA=M`、`σmax=M/W` 与分布图一致
- **标准答案**：`R_A=R_B=10 kN`、`Mmax=20 kN·m @x=2`；矩形 `W=6.6667e-4 m³` → `σ=30.00 MPa`（<160，通过）；圆 `d=100 mm` → `W=9.8175e-5 m³` → `σ=203.7 MPa`（>160，超限）

### M5 弯曲变形
- 模型（以代码 `M5_DEFAULTS` 为准）：**简支集中力** `L=4, a=2, P=-20 kN`，`E=200 GPa`，`rect b=100 h=200`（`I=6.6667e-5 m⁴`）
- 路径 A：`EI·v''=M` 积分 + 边界条件（用解析式）；路径 B：数值双重积分（梯形 + 累积）
- 图：挠曲线（`line`，标注 δmax 位置与数值）
- 校核：`v(0)=v(L)=0`（简支）、`v'(0)=0`（悬臂）、两路径 δ 一致
- **标准答案**：`δmax = PL³/(48EI) = 2.000 mm @x=2`；悬臂对照式 `PL³/(3EI)`（同一 EI 得 8.000 mm）

### M6 应力状态
- 模型：`{ sigmaX, sigmaY, tauXY }`（MPa）
- 路径 A：`σ1,2=(σx+σy)/2 ± R`；路径 B：2×2 应力张量特征值
- 图：莫尔圆（`MohrSpec`，正方形比例）
- 校核：两主应力之和 `=σx+σy`、`σ1σ2 = σxσy-τ²`、`R` 与圆心距离一致
- **标准答案（= 代码默认值，`σy` 取负）**：`σx=100, σy=-20, τxy=40 MPa` → `σ1=112.111 MPa`，`σ2=-32.111 MPa`，`τmax=72.111 MPa`，`θp=16.845°`

### M7 压杆稳定
- 模型（以代码 `M7_DEFAULTS` 为准）：**方柱** `b=h=60 mm, L=2 m, mu=1（两端铰）, E=200 GPa`，工作压力 `P=150 kN`，`sp=200 MPa`
- 路径：`i=√(I/A)`、`λ=μL/i`、`Pcr=π²EI/(μL)²`、`σcr=Pcr/A`；与 `λp=√(π²E/sp)` 分档（`λ≥λp` 用欧拉，`λ<λp` 明确写「超出欧拉适用范围」并在 λ 轴标位置、数字给「—」）
- 图：`λ–σcr` 曲线 + 当前点标记
- 校核：Pcr 与 `π²EI/(μL)²` 一致、λ 的量纲、分档边界处给出提示而不是硬算
- **标准答案**：`A=3.600e-3 m²`、`I=1.0800e-6 m⁴`、`i=17.321 mm`、`λ=115.47`、`λp=99.35`（欧拉适用）、`Pcr=532.96 kN`、`σcr=148.04 MPa`
- 圆杆对照算例（另一组参数）：`d=20 mm, L=1 m, 两端铰` → `A=3.1416e-4`、`I=7.8540e-9`、`i=5.000 mm`、`λ=200`、`Pcr=15.503 kN`、`σcr=49.35 MPa`

### M8 组合变形
- 模型（以代码 `M8_DEFAULTS` 为准）：**悬臂弯扭组合** `L=2 m, d=140 mm`，端部同时作用 `Pn=150 kN`（轴向压）、`Pt=8 kN`（横向）、`T=0.5 kN·m`（扭矩），`allow=160 MPa`
- 路径：`σ = N/A ± M/W`；弯扭用第四强度理论 `σr4=√(σ²+3τ²)`
- 图：截面应力叠加（两分量分别画 + 合成）
- 校核：合力 `=N`、合力矩 `=M`、合成的中性轴位置
- **标准答案**：`A=1.5394e-2 m²`、`σ_N=9.744 MPa`；`W=2.6939e-4 m³`、`M=Pt·L=16 kN·m`、`σ_M=59.39 MPa`；`Wp=5.3878e-4 m³`、`τ_T=0.928 MPa`；`σr4=69.16 MPa < allow`
- 偏压对照算例（另一组参数）：`P=50 kN, e=50 mm, A=0.02 m², W=6.6667e-4 m³` → `P/A=2.500`、`Pe/W=3.750`、`σmax=6.250`、`σmin=-1.250 MPa`

---

## 3. S1–S7：静力学求解族（一个 2D 刚体求解器撑起六型）

共用模型：

```ts
type Rigid2D = {
  bodies: { id: string; points: { id: string; x: number; y: number }[] }[];
  supports: { at: string; kind: 'pin' | 'roller' | 'fixed' | 'cable' }[];
  loads: { at: string; F?: [number, number]; M?: number }[];
};
```

求解：未知量 = 反力分量，方程 = ΣFx、ΣFy、ΣM（外加二力杆方向约束）；用线性方程求解并给残差。

### S1 约束与受力图
- 不做数值求解，做**判据**：给定支座与构件，判断是否为二力杆、反力方向是否定；
- 输出：受力图 + 每个支座的「几个未知量 / 方向是否已知」清单；
- 校核：未知量个数 vs 独立方程个数（静定判据），静不定直接报警。

### S2 平面汇交力系
- 合成与平衡；**标准答案**：`F1=100 N@30°`、`F2=100 N@150°` → 合力 `R=100 N`，方向 `90°`（两力夹角 120°，对称轴即合力方向）

### S3 平面任意力系
- 支座反力、简化（主矢主矩）；
- **标准答案**：`L=3 m`，pin@0 + roller@3，`P1=10 kN@1`、`P2=20 kN@2` → `R_A=13.333 kN`，`R_B=16.667 kN`

### S4 摩擦
- **两个工况，两个角，别混成一个**（代码为准）：
  - 工况甲（水平面斜拉）：`μ=0.3`、`W=200 N`、拉角 `α=30°` → `P_crit=59.05 N`
  - 工况乙（斜面上物块）：斜面倾角 `β=10°`，自锁判据 `β≤φf`（`φf=arctan μ=16.70°`）——此工况只判自锁，不解 `P`
- 校核：把 `P` 代入后摩擦力 `≤ μN`、自锁判据在 `β` 上判（不要拿 `α` 判自锁）
- 页面上必须写明「α 属于工况甲、β 属于工况乙」，两个滑杆各自标注

### S5 桁架
- 节点法（首选）+ 截面法（核验）；零杆判别要写出理由（两杆节点、三杆节点）；
- **范围**：只做**静定三角桁架**（`A(0,0) pin`、`B(L,0) roller`、`C(L/2,H) apex`，`L/H/P` 可调）；任意拓扑（多节点、多跨、杆件增删）不在本波范围，覆盖表要照这个说法写
- **标准答案**：`A(0,0) pin`、`B(2,0) roller`、`C(1,1) apex`，`10 kN` 竖直向下作用于 **C** →
  `R_A=R_B=5 kN`，`N_AC=N_BC=-7.071 kN`（压），`N_AB=+5.000 kN`（拉），零杆 0 根
- 校核：每个节点 `ΣF=0`（逐节点残差）、零杆数与自由度吻合

### S6 重心与形心
- 组合体：矩形/圆/三角的并集与差集（孔）；
- **标准答案**：T 形（翼缘 `100×20` @y=0.11、腹板 `20×100` @y=0.05）→ `A=0.0040 m²`，`ȳ=0.0800 m`
- 校核：`∫y dA = ȳ·A`（数值积分对拍）

### S7 虚位移原理
- 单自由度机构/杠杆：给虚位移 → 虚功方程求平衡力；
- **标准答案**：杠杆支点 O，左臂 `0.4 m` 挂 `100 N`，右臂 `0.6 m` → `F=66.67 N`
- 校核：与静力平衡解（ΣM_O=0）比对

---

## 4. 门禁与变异测试

`scripts/check-mechanics.mjs`，接进 `npm run build`：

1. 上表 15 条标准答案逐位一致（1e-9）；
2. 每型的「两路径互校」抽样 < 1e-9；
3. 各型的校核项全 PASS；
4. 静不定输入被拒绝且文案含「只解静定」（用两端固定梁、三支点连续梁各测一次）；
5. `ChartSpec`：`yDomain` 覆盖全部采样点、`marks` 落在曲线上（1px 容差）、`panels` 的 x 域一致；
6. `MohrSpec`：绘制用比例一致（圆度检测，长短轴比 < 1.001）；
7. `src/examples/` 新增 15 份快照，`check:p3` 覆盖。

变异测试至少 5 条并贴输出：①M 符号取反 → 报 `dM/dx≠Q`；②`Mmax` 改成 21 → 报 golden 不符；③把简支端条件删掉 → 报端部条件；④莫尔圆半径用 `(σx-σy)/2`（漏掉 τ²）→ 报 `σ1+σ2` 不守恒；⑤桁架删一根杆 → 报节点不平衡。

## 5. 界面

- 首页：M1–M8、S1–S7 全部从路线图搬到 `ready`，路线图清空（保留一块「扩展中：结构力学、流体」占位可以，但不得有假卡）。
- 每型 5 步叙事 + 参数实验场（各型参数见 §2/§3 的模型字段）。
- 力学图与电路图共用同一套画布容器与导出 PDF 流程。
- 结论位：`σ_max > [σ]` → 红字「超限 x%」；静不定 → 黄底「当前版本不解静不定」，不给数字。

## 6. 明确不做（写进 about 的「边界」）

超静定解析、弹塑性、大变形、稳定只做欧拉档（不做经验公式分档表）、型钢表查值、
空间力系与三维、动力学（S 系列只到静力学 + 虚位移）、疲劳与断裂。

## 验收

```
W0：npm run check:mech-parity = 0（17 份 fixture 全部 1e-9 对齐；库里能算的 M1–M4 必须逐位一致）
每波：npx tsc --noEmit = 0；npm run verify = 0（含 check:mechanics + check:mech-parity）
W1 截图：M1.png M2.png M3.png（Q/M 双联）M4.png
W2 截图：M5.png M6.png（莫尔圆）M7.png M8.png
W3 截图：S3.png S5.png S7.png
人工确认：双联图共用一条 x 轴；莫尔圆是圆不是椭圆；受力图支座画对；超限与静不定文案到位；
         内力图右上角有「符号约定」小盒；M1–M4 的参数改了数值仍过 parity
```

不许改电路求解与绘图、不许动 A 系列 17 份快照、不许新增依赖、
**不许 fork 库的公式**（M1–M4、M8 的 σ 一律以库里算法为准，TS 只是复刻 + 被 parity 门禁盯着）。
