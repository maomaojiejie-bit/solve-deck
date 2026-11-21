// 参数化四方塔生成器（PLAN §2.5：真实工程结构走「参数化模板 + 吸附式局部编辑」路线）。
// 拓扑：每层 4 角结点；竖杆（主材）+ 每层水平环（横隔）+ 每立面 X 斜材；
// 底 4 角全锚固 xyz，顶 4 角各受竖向荷载。默认 3 层 = 16 结点 52 杆。
// 生成物是普通 TrussModel，可直接进编辑器做局部修改。

import type { Member, Node3, SolidBody, Support, Load3, TrussModel } from "./types";

export interface TowerParams {
  /** 层数（≥1），默认 3 */
  layers?: number;
  /** 节间宽 m，默认 1 */
  bay?: number;
  /** 层高 m，默认 1 */
  height?: number;
  /** 立面 X 斜材开关，默认开 */
  bracing?: boolean;
  /** 弹性模量 Pa，默认 2.0e11 */
  E?: number;
  /** 截面积 m²，默认 1e-3 */
  A?: number;
  /** 每顶角竖向荷载 kN（正数=向下），默认 10 */
  loadKN?: number;
}

// 方形截面 4 角（俯视逆时针），x/z 均 ±bay/2
const CORNER: ReadonlyArray<[number, number]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export function generateTower(params: TowerParams = {}): TrussModel {
  const layers = Math.max(1, Math.round(params.layers ?? 3));
  const bay = params.bay ?? 1;
  const h = params.height ?? 1;
  const bracing = params.bracing ?? true;
  const E = params.E ?? 2.0e11;
  const A = params.A ?? 1e-3;
  const loadKN = params.loadKN ?? 10;

  const nodes: Node3[] = [];
  const members: Member[] = [];
  const supports: Support[] = [];
  const loads: Load3[] = [];

  const idAt = (level: number, corner: number) => `N${level * 4 + corner + 1}`;
  let mSeq = 0;
  const addMember = (a: string, b: string) => members.push({ id: `M${++mSeq}`, a, b, A, E });

  for (let i = 0; i <= layers; i++) {
    for (let j = 0; j < 4; j++) {
      nodes.push({ id: idAt(i, j), x: (CORNER[j][0] * bay) / 2, y: i * h, z: (CORNER[j][1] * bay) / 2 });
    }
    // 水平环（横隔）
    for (let j = 0; j < 4; j++) addMember(idAt(i, j), idAt(i, (j + 1) % 4));
    if (i < layers) {
      // 竖杆（主材）
      for (let j = 0; j < 4; j++) addMember(idAt(i, j), idAt(i + 1, j));
      // 立面 X 斜材：每个立面两根对角杆
      if (bracing) {
        for (let j = 0; j < 4; j++) {
          const k = (j + 1) % 4;
          addMember(idAt(i, j), idAt(i + 1, k));
          addMember(idAt(i, k), idAt(i + 1, j));
        }
      }
    }
  }

  for (let j = 0; j < 4; j++) supports.push({ node: idAt(0, j), fix: ["x", "y", "z"] });
  for (let j = 0; j < 4; j++) loads.push({ node: idAt(layers, j), fy: -Math.abs(loadKN) * 1e3 });

  return {
    id: "T6",
    name: `参数化四方塔（${layers} 层 · ${bay}m×${h}m · ${bracing ? "X 斜材" : "无斜材"} → ${nodes.length} 结点 ${members.length} 杆）`,
    nodes,
    members,
    supports,
    loads,
  };
}

// ---------- 通用实体框架放置（编辑器「加实体」工具） ----------
// 调研结论（教材/题库交叉验证）：真实题目的空间几何 =
//   ① 棱柱/棱台/棱锥族（n 边形截面 + 顶面缩放收尖）——三棱柱桁架（Cornell 例题 12 杆 6 结点）、
//      四棱锥角锥（屋顶空间桁架）、正四面体（基本稳定单元 m=3n−6）；
//   ② 回转体的多边形近似——圆柱/圆台（输电塔、塔吊塔身为上小下大的四棱台/圆台，理论力学高频）；
//   ③ 楔体（顶面沿一个方向塌成脊线，即横放的三棱柱）；
//   ④ 扭拧塔（顶面绕竖轴旋转，输电杆塔标准形态）。
// 立方体只是 sides=4、顶缩放=1 的特例，故本函数以「底环 + 顶环」参数化取代旧 addCube。
// 拓扑：底环 n 结点 + 顶环 n 结点（收尖/塌脊后重合结点自动合并）；
// 杆 = 底环 + 顶环 + 侧棱 + 面斜杆（所有四边形面各配一根斜杆、多边形环扇形三角化）。
// 该规则使杆数恰满足空间桁架静定条件 m = 3j − 6（立方体 18 杆 8 结点、三棱柱 12 杆 6 结点）。
// 注意：关掉面斜杆的铰接棱柱框架是机构（面可错动、环可剪切），求解会拒答。
// 重合结点（容差 1e-6）自动合并复用 id —— 堆叠/并排/共棱因此天然连通。

export interface SolidConfig {
  /** 放置形式：solid=实体块（填充面 + 框架构件）、frame=只要框架构件（不填面）；缺省 solid */
  form?: "solid" | "frame";
  /** 底面边数 3..16；4=方/矩形截面，3=三角截面，12≈圆截面（圆台/圆柱近似） */
  sides: number;
  /** 底面外接盒 x 向宽 m（sides=4 时即棱长） */
  w: number;
  /** 底面外接盒 z 向深 m */
  d: number;
  /** y 向高 m */
  h: number;
  /** 顶面 x 向缩放：1=棱柱、(0,1)=棱台、0=收尖（棱锥/楔脊） */
  topScaleW?: number;
  /** 顶面 z 向缩放，同上 */
  topScaleD?: number;
  /** 顶面绕 y 轴旋转角（度），扭拧塔用 */
  twist?: number;
  /** 底面标高 m（堆叠时设为下层顶高），默认 0 */
  baseY?: number;
  /** 面斜杆（几何不变所需），默认开 */
  diagonals: boolean;
  /** 底环结点自动球铰（已有支座的结点跳过），默认开 */
  autoSupport: boolean;
}

export interface SolidResult {
  model: TrussModel;
  /** 新增结点数 */
  newNodes: number;
  /** 与既有结构合并的重合结点数 */
  reusedNodes: number;
  /** 新增杆件数 */
  newMembers: number;
  /** 底环 + 顶环最终结点 id（合并后可能含重复项） */
  ringIds: string[];
}

const COORD_TOL = 1e-6;

function nextFreeId(prefix: string, taken: Set<string>): string {
  let k = 1;
  while (taken.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

export function addSolid(
  model: TrussModel,
  cx: number,
  cy: number,
  cz: number,
  cfg: SolidConfig,
  E: number,
  A: number,
): SolidResult {
  const sides = Math.min(16, Math.max(3, Math.round(cfg.sides || 4)));
  const sw = Math.max(0, cfg.topScaleW ?? 1);
  const sd = Math.max(0, cfg.topScaleD ?? 1);
  const twist = ((cfg.twist ?? 0) * Math.PI) / 180;
  // solid = 真正的实体块：内部支撑只参与求解、不画出来；frame = 可见的框架构件
  const asSolid = (cfg.form ?? "solid") === "solid";
  // 实体内部支撑必须几何不变（实体不会“错动”），所以 solid 不受「面斜杆」开关影响
  const withDiagonals = asSolid || cfg.diagonals;
  // sides=4 走「盒角」语义：w/d 即棱长（顶点在 45°+i·90°，半径 √2·半宽）；
  // 其余 n 顶点落在 w×d 外接椭圆的等分角上（π/2 相位，顶点朝 +z）。
  const phase = sides === 4 ? Math.PI / 4 : Math.PI / 2;
  const k = sides === 4 ? Math.SQRT2 : 1;

  const nodes = [...model.nodes];
  const members = [...model.members];
  const supports = [...model.supports];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const memberKeys = new Set(members.map((m) => [m.a, m.b].sort().join("|")));
  const supportedNodes = new Set(supports.map((s) => s.node));
  const created = new Set<string>();

  let newNodes = 0;
  let reusedNodes = 0;
  const place = (x: number, y: number, z: number): string => {
    const hit = nodes.find((n) => Math.abs(n.x - x) < COORD_TOL && Math.abs(n.y - y) < COORD_TOL && Math.abs(n.z - z) < COORD_TOL);
    if (hit) {
      reusedNodes++;
      return hit.id;
    }
    const id = nextFreeId("N", nodeIds);
    nodeIds.add(id);
    nodes.push({ id, x, y, z });
    created.add(id);
    newNodes++;
    return id;
  };
  const ring = (scaleX: number, scaleZ: number, rot: number, y: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < sides; i++) {
      const th = phase + rot + (i * 2 * Math.PI) / sides;
      out.push(place(cx + ((cfg.w / 2) * k * scaleX) * Math.cos(th), y, cz + ((cfg.d / 2) * k * scaleZ) * Math.sin(th)));
    }
    return out;
  };

  const bot = ring(1, 1, 0, cy);
  const top = ring(sw, sd, twist, cy + cfg.h);

  // 实体块：与框架杆件同时存在（求解仍走结点/杆，实体只负责「像个真块」的外观）
  const solid: SolidBody = {
    id: nextFreeId("S", new Set((model.solids ?? []).map((s) => s.id))),
    sides,
    cx,
    cy,
    cz,
    w: cfg.w,
    d: cfg.d,
    h: cfg.h,
    topScaleW: sw,
    topScaleD: sd,
    twist: cfg.twist ?? 0,
    nodes: [...new Set([...bot, ...top])],
  };

  let newMembers = 0;
  const link = (a: string, b: string) => {
    if (a === b) return; // 环退化（收尖/塌脊）产生的零长对
    const key = [a, b].sort().join("|");
    if (memberKeys.has(key)) return;
    memberKeys.add(key);
    // solid 形式：这些构件只是实体内部的“刚性连接”，不在画布/结果里露面
    members.push({ id: nextFreeId("M", new Set(members.map((m) => m.id))), a, b, A, E, ...(asSolid ? { hidden: true } : {}) });
    newMembers++;
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    link(bot[i], bot[j]); // 底环
    link(top[i], top[j]); // 顶环
    link(bot[i], top[i]); // 侧棱
    if (!withDiagonals) continue;
    // 侧面：仅当四点构成真四边形时配一根斜杆（三角面天然几何不变）
    if (bot[i] !== top[i] && bot[j] !== top[j] && top[i] !== top[j]) link(bot[i], top[j]);
    // 多边形环扇形三角化（n=4 各加 1 根、n=3 不加、n=12 各加 9 根）；link 自动跳过退化对
    if (i >= 2 && i <= sides - 2) {
      link(bot[0], bot[i]);
      link(top[0], top[i]);
    }
  }

  // 底环自动球铰——仅限本次新建结点（堆叠时结合面结点复用，不在中间层误加约束）
  if (cfg.autoSupport) {
    for (const id of new Set(bot)) {
      if (!created.has(id) || supportedNodes.has(id)) continue;
      supportedNodes.add(id);
      supports.push({ node: id, fix: ["x", "y", "z"] });
    }
  }

  // 完全重合（零新增）不重复记实体，避免同一位置叠出半透明厚度；
  // frame 形式只放框架构件，不写填面记录
  const solids = asSolid && newMembers > 0 ? [...(model.solids ?? []), solid] : model.solids;

  return {
    model: { ...model, nodes, members, supports, ...(solids?.length ? { solids } : {}) },
    newNodes,
    reusedNodes,
    newMembers,
    ringIds: [...bot, ...top],
  };
}

/** 形状预设：覆盖调研出的全部真实题目形态，参数仍可手改 */
export const SOLID_PRESETS: { label: string; patch: Partial<SolidConfig> }[] = [
  { label: "立方体 / 长方体", patch: { sides: 4, topScaleW: 1, topScaleD: 1, twist: 0 } },
  { label: "四棱台（塔身）", patch: { sides: 4, topScaleW: 0.6, topScaleD: 0.6, twist: 0 } },
  { label: "四棱锥（角锥）", patch: { sides: 4, topScaleW: 0, topScaleD: 0, twist: 0 } },
  { label: "三棱柱", patch: { sides: 3, topScaleW: 1, topScaleD: 1, twist: 0 } },
  { label: "三棱台", patch: { sides: 3, topScaleW: 0.6, topScaleD: 0.6, twist: 0 } },
  { label: "正四面体", patch: { sides: 3, topScaleW: 0, topScaleD: 0, twist: 0 } },
  { label: "圆柱（12 边近似）", patch: { sides: 12, topScaleW: 1, topScaleD: 1, twist: 0 } },
  { label: "圆台（12 边近似）", patch: { sides: 12, topScaleW: 0.6, topScaleD: 0.6, twist: 0 } },
  { label: "楔体（顶塌成脊）", patch: { sides: 4, topScaleW: 1, topScaleD: 0, twist: 0 } },
  { label: "扭拧塔（输电塔）", patch: { sides: 4, topScaleW: 0.7, topScaleD: 0.7, twist: 15 } },
];

/** 当前参数命中的预设名（用于 UI 回显），无命中即「自定义」 */
export function solidPresetLabel(cfg: SolidConfig): string {
  const hit = SOLID_PRESETS.find(
    (p) =>
      p.patch.sides === Math.round(cfg.sides) &&
      (p.patch.topScaleW ?? 1) === (cfg.topScaleW ?? 1) &&
      (p.patch.topScaleD ?? 1) === (cfg.topScaleD ?? 1) &&
      (p.patch.twist ?? 0) === (cfg.twist ?? 0),
  );
  return hit ? hit.label : "自定义";
}
