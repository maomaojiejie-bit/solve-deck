/**
 * 拆解台 · SolveDeck —— 公式常量（设计稿第 8.2 节）
 *
 * 写死进自有文件，运行时不查外部资料。这里只存公式文本与适用条件，
 * 不产生正确率；任何数值仍须经过第 5 节双路径 + 残差校验。
 *
 * 许可隔离：本文件仅含公式 / 单位 / 适用条件，不含算法实现。
 */

/** 数电（D1–D6）。 */
export const BOOLEAN = {
  demorgan: "(xy)' = x'+y' ; (x+y)' = x'y'",
  absorption: 'x+xy=x ; x(x+y)=x',
  consensus: "xy + x'z + yz = xy + x'z",
  shannon: "f = x·f(1) + x'·f(0)",
  gray: 'G = B ^ (B>>1)',
  qmcMerge: '两项仅差一位 → 合并并标记无关位',
} as const;

/** 模电（A1–A7）。 */
export const ANALOG = {
  diode: 'I_D = I_S·(exp(V_D/(n·V_T)) − 1)',
  gd: 'g_d ≈ I_D/(n·V_T)',
  bjt:
    'I_C = β·I_B ; I_E = (β+1)·I_B ; V_BE ≈ 0.7 ; ' +
    'V_b = R2/(R1+R2)·V_CC',
  rpi: 'r_π = β/g_m ; g_m = I_C/V_T ; A_v = −g_m(R_C∥R_L)',
  mosTriode:
    'I_D = k[(V_GS−V_T)V_DS − V_DS²/2] 且 V_GS>V_T, V_DS<V_GS−V_T',
  mosSat: 'I_D = (k/2)(V_GS−V_T)² 且 V_GS>V_T, V_DS≥V_GS−V_T',
  gmMos: 'g_m = 2I_D/(V_GS−V_T)',
  opamp:
    'V_p=V_n ; I_p=I_n=0（虚短虚断）；有限增益回检 V_o=A_ol(V_p−V_n)',
  feedback: 'A_f = A/(1+A·T)',
} as const;

/** 材料力学（M1–M8）。 */
export const MECHANICS = {
  beam: "EI·w'''' = q(x) ; V = ∫q dx ; M = ∫V dx ; EI·w'' = −M",
  bending: 'σ = −M·y/I ; τ = V·Q/(I·t)（须确认 Q,I,t 适用条件）',
  axial: 'δ = Σ N·L/(E·A) ; σ = N/A ; ε = σ/E',
  torsion: 'θ = ∫T/(G·J)dx ; τ = T·ρ/J ; J_实心圆 = πd⁴/32',
  mohr:
    'σ_m=(σx+σy)/2 ; R=√((σx−σy)²/4+τxy²) ; σ1,2=σ_m±R ; ' +
    'tan2θp=2τxy/(σx−σy)',
  tresca: 'σ_eq = σ_max − σ_min',
  vonMises: 'σ_eq = √(½[(σ1−σ2)²+(σ2−σ3)²+(σ3−σ1)²])',
  euler: 'P_cr = π²·E·I/(μ·L)²（仅理想轴压、线弹性、小变形）',
  section: 'I = Σ(I_i + A_i·d_i²) ; A=½Σ(x_i y_{i+1} − x_{i+1} y_i)',
  hermiteKe:
    'EI/L³·[[12,6L,−12,6L],[6L,4L²,−6L,2L²],' +
    '[−12,−6L,12,−6L],[6L,2L²,−6L,4L²]]',
} as const;

/** 理论力学（仅静力学，S1–S7）。 */
export const STATICS = {
  equilibrium: 'ΣFx=0 ; ΣFy=0 ; ΣM_O=0',
  reactions:
    'pin→Fx,Fy(2) ; roller→法向(1) ; fixed→Fx,Fy,M(3) ; ' +
    'cable→沿索拉力(1)',
  friction:
    '|F_t|≤μ_s·N 静解；临界 tanφ=μ_s；滑动 F_t=sign(v)·μ_k·N',
  centroid: 'x_c=ΣA_i x_i/ΣA_i ; y_c=ΣA_i y_i/ΣA_i（孔洞取负面积）',
  virtualWork: 'δW = Σ F_i·δr_i = 0',
  trussLocalK:
    '(EA/L)·[[1,0,−1,0],[0,0,0,0],[−1,0,1,0],[0,0,0,0]] ; ' +
    'K_g=TᵀK_lT',
} as const;

/**
 * 适用条件必须随公式写死（第 8.2 节末段）。
 * 求解器引用公式时，必须同时引用这里的条件，不能只取表达式。
 */
export const FORMULA_CONDITIONS = {
  bending:
    'y 相对形心主轴；σ=−My/I 仅在线弹性、小变形、平面弯曲下成立',
  shear:
    'τ=VQ/(It) 要求 Q、I、t 与截面形状的取法一致（矩形/圆/工字形等已定义截面）',
  euler:
    '欧拉临界力仅适用于理想轴压、线弹性、小变形；μ 由两端约束映射决定',
  mosSquareLaw:
    '平方律是器件级假设：强反型、忽略短沟道/速度饱和/亚阈导电',
  shockley:
    'Shockley 方程依赖温度参数 V_T 与 I_S，温度变化后必须重新取值',
  mohr: '主应力公式仅适用于平面应力状态；三维情形须先补 σz',
  tresca: 'Tresca 取 σmax−σmin，必须先对三维主应力排序',
  vonMises: 'vonMises 需要三个主应力；平面应力下取 σ3=0',
  torsion:
    '圆轴扭转 τ=Tρ/J、θ=∫T/(GJ)dx 仅适用于圆截面（实心/空心）',
  axial: 'δ=ΣNL/(EA) 仅适用于等截面段、线弹性、载荷作用于形心',
  section:
    '组合截面惯性矩须先统一到形心主轴；孔洞按负面积处理',
  truss:
    '桁架杆件视为二力杆：节点铰接、载荷只作用于节点、忽略自重与弯曲',
} as const;

export type FormulaGroup = typeof BOOLEAN | typeof ANALOG | typeof MECHANICS | typeof STATICS;