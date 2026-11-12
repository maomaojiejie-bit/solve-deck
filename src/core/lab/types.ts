/**
 * 拼接台 v2 的四个自有类型；其余全部复用 `src/core/types.ts` 的既有契约
 * （SymbolDef / Netlist / BeamModel / Solution / ConfidenceReport）。
 *
 * 设计底线：骨架不改时，reduce 出的 params 与快照 parsed_given 逐键相同，
 * 于是既有 solver 逐位复现 —— 本模块只搬运，不发明任何求解逻辑。
 */

import type { BeamModel, Netlist, RenderSpec } from '../types.ts';
import type { ParamValue } from '../templates/registry.ts';

/** 刚性支座三型（力学族；缆索 / 光滑面只在静力学快照里出现，不进装配台）。 */
export type SupportType = 'pin' | 'roller' | 'fixed';

/**
 * R3-1 A1：支座挂在这个结点上（**不是**独立图元）。坐标只有一份 = 结点的 x/y，
 * 所以「支点在哪」永远有唯一答案：拖结点支座跟着走、删结点支座随之消失、
 * 一个结点最多一个支座。id / label 只为渲染与证据保留（旧快照的 id 是 n-sup-A）。
 */
export interface NodeSupport {
  type: SupportType;
  id?: string;
  label?: string;
  labelSide?: 'up' | 'down' | 'left' | 'right';
  /**
   * 折叠前它在图元数组里的位置。只服务渲染顺序：graphToSpec 按它把支座插回去，
   * 于是「折叠 → 展开」连图层顺序都与快照逐字一致（check:lab ① 的往返判据）。
   */
  order?: number;
}

/** 画布节点 = 快照节点 + 器件承载的数值（电阻 Ω / 电源 V / 晶体管参数…）。 */
export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  kind: string;
  label?: string;
  /** 图元旋转（度，0/90/180/270）。 */
  rot?: number;
  labelSide?: 'up' | 'down' | 'left' | 'right';
  /** 两端器件的值：res → Ω，vsrc → V，载荷 → 题面单位。 */
  value?: number;
  /** 晶体管 / 运放的多参数（beta、lambda、gm、ro、Aol…）。 */
  params?: Record<string, number>;
  /** 电路语义标签（bias / coupling / bypass / supply / unknown）；力学恒缺省。 */
  semantic?: string;
  /**
   * W13 P0：这个 dot 归谁（端点落在哪个器件引脚上就是谁；跨器件 / 悬空记
   * 'shared'）。deleteDevice 按它连带删孤儿结点；渲染与归约不读它。
   */
  owner?: string;
  /** 复合器件实例：指向 CompositeDef.id；给了这个就忽略 kind 的器件语义。 */
  compositeId?: string;
  /** R3-1 A1：结点上的支座（固定铰 / 可动铰 / 固定端）。 */
  support?: NodeSupport;
  /** R3-1 A3：结点载荷挂在哪个结点上（跨内载荷没有它，用 x/y 投影出 t）。 */
  atJoint?: string;
  /**
   * R3-4 U1：跨内载荷落在**哪一根杆**上。单跨图不需要（t 按 x 投影到唯一主跨），
   * 但「点杆中切段」之后梁变成两段，投影到第一段会算出 t=1 这种假位置 ——
   * 记下 edgeId，loadT 才有唯一答案。快照里没有这个字段，行为不变。
   */
  atMember?: string;
}

/**
 * 画布连线 = 快照边 + 归属。owner 是 W13 P0 的关键：快照里 from/to 是坐标
 * 字符串、点击连线存引脚 id，两种都匹配不到节点 id —— 所以删器件必须按
 * 「这条线归谁」删，不能按端点字符串比较。graphFromSpec 生成时打标：
 * 恰好落在一个器件上 → 该器件 id；跨器件 / 悬空（汇流条、地轨、输出端）→
 * 'shared'。可选字段，往返无损，旧图没有 owner 时 deleteDevice 保守不删。
 */
export type CanvasEdge = RenderSpec['edges'][number] & {
  owner?: string;
  /**
   * W17-C：杆 / 梁的截面属性（杆行与选中条可改）。数值按**相对比例**参与
   * 求解：frameSolve 取 EA = E·A、EI = E·I，缺省全 1（内力只依赖刚度比）。
   * 往返无损：多余字段随 spread 保留，旧图没有时行为不变。
   */
  A?: number;
  I?: number;
  E?: number;
};

/**
 * W20：用户在装配台右栏手填的矩形截面。输入单位 b/h = mm、E = GPa，
 * 量纲换算（mm⁴→m⁴、GPa→kN/m²）只在 measures 里做一次，这里存的是**原值**。
 */
export interface CanvasSection {
  b: number;
  h: number;
  E: number;
}

/**
 * 一张可装配的图：快照 render_specs[0] 的 nodes/edges 原样保留（保证
 * graphFromSpec 往返无损），加上器件数值与骨架级参数。
 */
export interface CanvasGraph {
  templateId: string;
  /** circuit → 走 reduceNetlist；beam/truss/freebody → 走 reduceBeam。 */
  family: 'circuit' | 'beam';
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** 不落在器件上的骨架级参数（config / Vt / mode / L / H…）；W20 起可放 section 对象。 */
  meta: Record<string, number | string | CanvasSection>;
}

/** 装配操作：只允许这几种；拖坐标不允许（布局由既有布局函数给）。 */
export type GraphOp =
  | { op: 'deleteDevice'; nodeId: string }
  | {
      op: 'addDevice';
      kind: string;
      label: string;
      value?: number;
      params?: Record<string, number>;
      /** 放置坐标：白名单器件给一个画布空位，不拖拽。 */
      x: number;
      y: number;
      /** 可选：新器件接到这两个已有端点（电路两次点击连线）。 */
      connect?: [string, string];
      /** W13：加一个复合器件实例（指向 CompositeDef.id）。 */
      compositeId?: string;
    }
  | { op: 'addEdge'; from: string; to: string; kind?: string }
  /** 力学杆件 / 梁段：从「杆件 / 梁段」列表逐条删。 */
  | { op: 'deleteMember'; edgeId: string }
  /** 两次点击两个节点后插一根杆；kind 决定当梁段还是桁架杆算。 */
  | { op: 'addMember'; from: string; to: string; kind: 'frame' | 'truss' }
  /**
   * R3-4 U1：在空白处放一个结点（坐标已吸附网格）。结点没有种类可选 ——
   * 它就是自由度载体，支座靠 setSupport 挂上去。
   */
  | { op: 'addNode'; x: number; y: number }
  /**
   * R3-4 U1：在杆的 t 处切一刀 —— 插一个结点、原杆拆成两段（kind 与 A/I/E 沿给）。
   * 「点杆中切段加支座」就是它：`support` 给了就顺手把支座挂到新结点上（新 id 只有
   * 切完才知道，所以合在一条 op 里，别让调用方去猜）。
   */
  | { op: 'splitMember'; edgeId: string; t: number; support?: SupportType }
  | { op: 'addSupport'; atNodeId: string; type: SupportType }
  /** 改 / 删某个结点上的支座（type=null → 摘掉支座）。 */
  | { op: 'setSupport'; nodeId: string; type: SupportType | null }
  /**
   * R3-1 A3：载荷落在结点（atNodeId）或跨内（atMember + t∈(0,1)）；dir 是方向
   * 枚举 ↓0 / →90 / ↑180 / ←270（缺省 0=↓）。t 会换算成坐标 → reduce 的 loadAt
   * 得到 a=t·L —— 位置不是画上去的箭头，是真的进求解。
   */
  | {
      op: 'addLoad';
      atNodeId?: string;
      atMember?: { edgeId: string; t: number };
      type: 'point' | 'udl' | 'moment' | 'torque';
      value: number;
      dir?: number;
    }
  /** 改载荷方向（↓→↑←）。 */
  | { op: 'setLoadDir'; nodeId: string; dir: number }
  /** 把载荷挪到跨内 t（0/1 = 端点 → 变回结点载荷）。 */
  | { op: 'setLoadT'; nodeId: string; t: number }
  | { op: 'changeKind'; nodeId: string; kind: string }
  | { op: 'setSemantic'; nodeId: string; semantic: string }
  /** 参数表改动写回图（位置类参数挪载荷、数值类改器件 value/label）。 */
  | { op: 'applyParams'; values: Record<string, ParamValue> }
  /**
   * W20：右栏「截面」三个框。section=null 表示清空 —— 清掉后 stress/deflection
   * 必须退回 missing，不许留着上次的数（门禁 ③ 钉住）。
   */
  | { op: 'setSection'; section: CanvasSection | null }
  /** W13 复合器件：把选中的一组器件封成一个带端口的模块。 */
  | {
      op: 'wrapComposite';
      nodeIds: string[];
      title: string;
      note?: string;
      /** 端口标注：勾选的边界节点 + 用户改的名（nodeId ∈ nodeIds）。 */
      ports: { nodeId: string; label: string }[];
      /** 封装面板里补的模型声明（缺了按 missingModelSpec 判 U，不假装已建模）。 */
      modelSpec?: { equations: string[]; applicableRange: string; units: Record<string, string> };
      /** 已校验夹具（面板里填，缺了按 missingGoldenCase 判 U）。 */
      goldenRefs?: string[];
    }
  /** 双击复合器件：摊开成内层器件（保留 cmp/ 前缀 id，可再收拢）。 */
  | { op: 'expandComposite'; nodeId: string }
  /** 收拢：把同一前缀的一组内层器件收回复合块。 */
  | { op: 'collapseComposite'; nodeId: string }
  /** 拆开：摊开并去掉前缀（永久解散这个实例；定义保留）。 */
  | { op: 'ungroupComposite'; nodeId: string }
  /** 编辑复合器件：改标题 / 说明 / 端口（改名、删端口、追加端口）与模型声明。 */
  | {
      op: 'editCompositePorts';
      nodeId: string;
      title: string;
      note?: string;
      /** 完整新端口表（幸存端口保留原 id；新端口新 id）。 */
      ports: { id: string; nodeId: string; label: string }[];
      modelSpec?: { equations: string[]; applicableRange: string; units: Record<string, string> };
      goldenRefs?: string[];
    }
  /** W16：改任何器件的数值（node.value 是唯一真相，label 按 kind 重写成显示格式）。 */
  | { op: 'setDeviceValue'; nodeId: string; value: number }
  /** W17-C：改杆的截面属性（A 截面积 / I 惯性矩 / E 弹性模量，相对比例）。 */
  | { op: 'setMemberProps'; edgeId: string; A?: number; I?: number; E?: number }
  /** W16：器件转 90°（delta 缺省 90）；导线端点重新吸附到新引脚并 relayout。 */
  | { op: 'rotateDevice'; nodeId: string; delta?: 90 | -90 }
  /** W16：删一条导线（删后回缩空头端点 / 复查孤立 dot；开路由归约判据说话）。 */
  | { op: 'deleteEdge'; edgeId: string };

/** 归约结果：直接喂给既有 entry.solver()。 */
export interface ReduceResult {
  params: Record<string, number | string>;
  /** 结构改动带来的换算，逐条给人看（删 Rc → 输出短接…）。 */
  appliedRules: string[];
  /** 归约不唯一 / 不可解，人话 + 怎么改；非空 → 拒答。 */
  problems: string[];
  /** true → 置信度 U 档，不求解。 */
  outOfScope: boolean;
}

/** 装配后的模型（graph → model 产物，reduce 的输入）。 */
export type LabModel = Netlist | BeamModel;

/** 三档置信度。 */
export type LabTier = 'F' | 'N' | 'U';
