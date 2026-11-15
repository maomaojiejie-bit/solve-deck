/**
 * W15-S1 电路通用求解：输入画布本身，不是 params。
 *
 * 与模板求解器的关系：模板只负责「讲解稿」；这张图只要拓扑合法（有地、
 * 无悬空子网、无电压源环路 / 短路），MNA 一盘就解，不再因「题库没这一型」拒答。
 *
 * 红线遵守：只 import mna.ts 的 solveMNA（stamp 照抄它的写法），不 import 任何
 * 模板文件 —— npn/nmos 的 π 模型公式（gm=Ic/Vt、rπ=β/gm、ro=VA/Ic）在这里
 * 重复一遍而不从 A3.ts 引：check:runtime 扫闭包，讲解稿不许拖进通用路径。
 *
 * 画法约定（如实，不是猜测）：
 *  - 「横穿的短杠」= 只碰一个器件引脚、不碰任何其他边 / 结点的悬空装饰线；
 *    当画布上有 gnd 符号、且短杠附近有「VCC / 交流地 / 地」标注时，短杠按
 *    交流地处理（A3 的 Rc 顶就是这种画法）。没有 gnd 符号 → 短杠不接地，
 *    电路按无地拒答 —— 地的语义由 gnd 符号定义，不由装饰线定义。
 *  - 运放按理想 nullor 解（V₊ = V₋、输入不吸电流）：用「两次 MNA + 仿射
 *    组合」精确求解 —— 运放输出换成未知电压源 E，解 E=0 与 E=1 两组，
 *    节点电压是 E 的仿射函数，约束 v₊=v₋ 定出 E。A6 节点上虽带
 *    Aol/Rin/Rout，但文档验收 -1.000000000 V 只有理想模型才能给到 1e-12，
 *    与模板讲解稿的语义一致。
 *  - 电容在直流下是开路（不 stamp）；二极管按导通方向线性化为 Vf + 1Ω；
 *    受控源（ctrlsrc）的控制量在画布上没有编码，如实拒答。
 */

import { solveMNA, type AnalogCircuit, type Element } from '../templates/analog/mna.ts';
import { anchorsOfNode, findAnchor } from './pins.ts';
import { SYMBOLS } from '../../render/symbols.ts';
import { unknownDeviceNote, unknownDevices } from './deviceNames.ts';
import type { CanvasEdge, CanvasGraph, CanvasNode } from './types.ts';

/** 变异开关：check:netsolve 第 6 条把它关掉 = 无地不再拒答 → 第 5 条红。 */
export const NETSOLVE_CONFIG = { checkGround: true };

/**
 * 无地拒答的唯一话术。netSolve 与「先于模板早退」的接地判据（resolve.ts）共用
 * —— 同一条规则两条路径不能有两套说法（A1 删 gnd 曾照常出数，就是路径漏了它）。
 */
export const NO_GROUND_REASON =
  '画布上没有接地符号（gnd）：没有电位参考点，解不了 —— 从器件面板加一个「接地」，或恢复骨架。';

/** 端点吸附容差：与 pins.ts 同一档。 */
const TOL = 0.6;
/** stub 接地的标注距离：与 graphFromSpec 的文字归属同一档。 */
const TEXT_TOL = 16;
const GROUNDISH = /交流地|接地|GND|VCC|地/;

export type NetSolveCode =
  | 'noGround'
  | 'floatingNet'
  | 'vSourceLoop'
  | 'shortVSource'
  | 'singular'
  | 'unsupported'
  | 'bodyCross';

export interface CircuitSolution {
  /** 各电气点的电位：键 = 网名 + tag 别名（如 n-vo）+ 'GND'。 */
  nodeVoltages: Record<string, number>;
  /** 流经器件的电流（a→b 方向为正）；npn/nmos 取集电极 / 漏极电流。 */
  branchCurrents: Record<string, number>;
  /** 器件吸收功率（源为负 = 对外供电）。 */
  powers: Record<string, number>;
  residual: { kclMax: number; node: string; mnaMax: number };
  /** W15-S4 增补：逐网 KCL 残差（Σ流出电流），结果页的逐节点残差表直接吃它。 */
  kclByNet: Record<string, number>;
  /** 器件引脚 → 网名（结果页 / 门禁定位用）。 */
  netOfPin: Record<string, string>;
  /**
   * W16：如实报告的物理事实（不拦解，只说话）。目前只有一条：
   * 二极管线性化后电流为负 = 反偏 —— 方向可能接反了（稳压管反偏是本意的除外）。
   */
  notes: string[];
}

export type NetSolveOutcome =
  | { ok: true; solution: CircuitSolution }
  | { ok: false; code: NetSolveCode; reason: string };

export interface NetSolveOptions {
  /** 画布上没标数值的电压源：deviceId → 电压。小信号增益例传 1V 测试源。 */
  vsrcValues?: Record<string, number>;
  /** 热电压（npn π 模型用），默认 26 mV。 */
  vt?: number;
  /**
   * W22-B 交流口径：`dc` = 现状（C 开路、L 短路），工作点 / 偏置类 measure 用；
   * `ac` = 交流小信号增量（C 按短路 → 两端网合并、L 按开路）。
   * 装配台的增益 / Ri / Ro 类 measure 一律走 `ac`（resolve.ts 的 generic 路径）。
   */
  mode?: 'dc' | 'ac';
  /**
   * W23 自动等效电路：在指定电气点与地之间加一支测试电流源，用同一份 MNA 现算
   * 端口的戴维南电阻（V = Vth − I·Rth）。amps > 0 = 从端口抽出电流。
   * 不传时行为与以前逐位一致 —— 通用求解的既有调用方一个都不用改。
   */
  testCurrent?: { net: string; amps: number };
}

/**
 * W22-B 变异位：check:netsolve 把 honorMode 关掉 = ac 退回 dc → 「同图 dc/ac 增益不同」条红。
 */
export const NET_AC_CONFIG = { honorMode: true };

/* ── 并查集 ─────────────────────────────────────────────────────── */

class UnionFind {
  private parent = new Map<string, string>();
  find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cur = key;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/* ── 几何小件 ───────────────────────────────────────────────────── */

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 边的折线：points 优先；否则 from/to 解析节点 id / 引脚键 / 'x,y'。 */
function edgePolyline(edge: CanvasEdge, nodeById: Map<string, CanvasNode>, graph: CanvasGraph): [number, number][] {
  if (edge.points && edge.points.length >= 2) return edge.points;
  const end = (raw: string): [number, number] | null => {
    const node = nodeById.get(raw);
    if (node) return [node.x, node.y];
    if (raw.includes(':')) {
      const anchor = findAnchor(graph, raw);
      if (anchor) return [anchor.x, anchor.y];
    }
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(raw);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = end(edge.from);
  const b = end(edge.to);
  return a && b ? [a, b] : [];
}

function touchesPolyline(points: [number, number][], x: number, y: number, tol = TOL): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (segDist(x, y, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]) <= tol) return true;
  }
  return false;
}

/** 两条折线的最短距离（边-边是否相接）。 */
function polylineDistance(a: [number, number][], b: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i += 1) {
    for (let j = 0; j + 1 < b.length; j += 1) {
      // 线段-线段距离用端点 + 垂足近似即可（教学图都是正交折线，端点相交为主）。
      const seg = b[j];
      const nxt = b[j + 1];
      for (const [px, py] of [a[i], a[i + 1]]) {
        best = Math.min(best, segDist(px, py, seg[0], seg[1], nxt[0], nxt[1]));
      }
      for (const [px, py] of [seg, nxt]) {
        best = Math.min(best, segDist(px, py, a[i][0], a[i][1], a[i + 1][0], a[i + 1][1]));
      }
    }
  }
  return best;
}

/* ── 网表构建 ───────────────────────────────────────────────────── */

interface NetBuild {
  netOfPoint: Map<string, string>;
  netMembers: Map<string, string[]>;
  pins: { deviceId: string; pinId: string; net: string; x: number; y: number }[];
  stubEdges: Set<string>;
  hasGnd: boolean;
  /** W22-B：导线穿过器件本体（S6 同判据）—— netSolve 据此拒答并指路。 */
  crossings: { edgeId: string; deviceId: string; label: string }[];
}

/** 网表构建（导出供门禁 / 调试检查网归并；正常路径只用 netSolve）。 */
export function buildNets(graph: CanvasGraph): NetBuild {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const uf = new UnionFind();
  interface Pt {
    key: string;
    x: number;
    y: number;
    kind: 'pin' | 'dot' | 'vertex';
    deviceId?: string;
    pinId?: string;
  }
  const points: Pt[] = [];
  const gndDevices = graph.nodes.filter((node) => node.kind === 'gnd');

  // 器件引脚点（text/wire 除外；wire 节点自身各脚同电位）
  for (const node of graph.nodes) {
    if (node.kind === 'text') continue;
    const anchors = anchorsOfNode(node, graph.family);
    for (const anchor of anchors) {
      points.push({
        key: `${node.id}:${anchor.kind === 'pin' ? anchor.key.split(':').pop() : anchor.key}`,
        x: anchor.x,
        y: anchor.y,
        kind: node.kind === 'dot' ? 'dot' : 'pin',
        deviceId: node.id,
        pinId: anchor.key.includes(':') ? (anchor.key.split(':').pop() as string) : undefined,
      });
    }
    if (node.kind === 'wire' && anchors.length >= 2) {
      for (let i = 1; i < anchors.length; i += 1) {
        uf.union(`${node.id}:0`, `${node.id}:${i}`);
      }
    }
  }
  // 边顶点点
  const polylines = new Map<string, [number, number][]>();
  for (const edge of graph.edges) {
    const poly = edgePolyline(edge, nodeById, graph);
    if (poly.length < 2) continue;
    polylines.set(edge.id, poly);
    poly.forEach(([x, y], index) => {
      points.push({ key: `${edge.id}#${index}`, x, y, kind: 'vertex' });
    });
  }
  // 每条边：折线上碰到的所有点连成一个电气点（导线是导体）。
  // W22-B：显式端点优先 —— from/to 是 `node:pin` 字符串时，首末顶点直接与该
  // 引脚强制归并（不受容差摆布）；touchesPolyline 只负责中途落点与无显式端点的边。
  for (const [edgeId, poly] of polylines) {
    const pinKeyOf = (end: unknown): string | undefined => {
      if (typeof end !== 'string') return undefined;
      const cut = end.indexOf(':');
      if (cut <= 0) return undefined;
      const nodeId = end.slice(0, cut);
      return nodeById.has(nodeId) ? end : undefined;
    };
    const explicitA = pinKeyOf(graph.edges.find((item) => item.id === edgeId)?.from);
    const explicitB = pinKeyOf(graph.edges.find((item) => item.id === edgeId)?.to);
    if (explicitA) uf.union(`${edgeId}#0`, explicitA);
    if (explicitB) uf.union(`${edgeId}#${poly.length - 1}`, explicitB);
    const touching = points.filter((point) => touchesPolyline(poly, point.x, point.y));
    for (let i = 1; i < touching.length; i += 1) uf.union(touching[0].key, touching[i].key);
    void edgeId;
  }

  // W22-B：导线穿过器件本体 → 记录 crossings，netSolve 顶层拒答并指路。
  // 判据与 check:schematic 的 S6 同源：段与 body 矩形（内缩 5）相交、且线上
  // 没有该 body 的任何引脚落点（引脚落点是合法接点，不算穿）。
  const crossings: { edgeId: string; deviceId: string; label: string }[] = [];
  {
    const bodies = graph.nodes
      .filter((node) => SYMBOLS[node.kind] && node.kind !== 'text' && node.kind !== 'dot')
      .map((node) => {
        const def = SYMBOLS[node.kind];
        const rot = (((node.rot ?? 0) % 360) + 360) % 360;
        const swap = rot === 90 || rot === 270;
        const hw = swap ? def.hh : def.hw;
        const hh = swap ? def.hw : def.hh;
        return {
          id: node.id,
          label: node.label ?? node.kind,
          rect: { x0: node.x - hw, x1: node.x + hw, y0: node.y - hh, y1: node.y + hh },
          pins: anchorsOfNode(node, graph.family).map((anchor) => [anchor.x, anchor.y] as [number, number]),
        };
      });
    const nearPoint = (p: [number, number], q: [number, number], eps = 0.5) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps;
    const pointOnSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const cross = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / length;
      if (cross > 0.5) return false;
      return (
        Math.min(a[0], b[0]) - 0.5 <= p[0] &&
        p[0] <= Math.max(a[0], b[0]) + 0.5 &&
        Math.min(a[1], b[1]) - 0.5 <= p[1] &&
        p[1] <= Math.max(a[1], b[1]) + 0.5
      );
    };
    const segRectHit = (p: [number, number], q: [number, number], rect: { x0: number; x1: number; y0: number; y1: number }, inset = 5) => {
      const x0 = rect.x0 + inset;
      const x1 = rect.x1 - inset;
      const y0 = rect.y0 + inset;
      const y1 = rect.y1 - inset;
      if (x0 >= x1 || y0 >= y1) return false;
      const segIsH = Math.abs(p[1] - q[1]) < 0.6;
      const segIsV = Math.abs(p[0] - q[0]) < 0.6;
      if (segIsH) {
        const y = p[1];
        if (y <= y0 || y >= y1) return false;
        return Math.max(p[0], q[0]) > x0 && Math.min(p[0], q[0]) < x1;
      }
      if (segIsV) {
        const x = p[0];
        if (x <= x0 || x >= x1) return false;
        return Math.max(p[1], q[1]) > y0 && Math.min(p[1], q[1]) < y1;
      }
      return false;
    };
    const seen = new Set<string>();
    for (const [edgeId, poly] of polylines) {
      for (let i = 1; i < poly.length; i += 1) {
        const a = poly[i - 1];
        const b = poly[i];
        for (const body of bodies) {
          const touchesPin =
            body.pins.some((p) => nearPoint(p, a)) ||
            body.pins.some((p) => nearPoint(p, b)) ||
            body.pins.some((p) => pointOnSeg(p, a, b));
          if (touchesPin) continue;
          if (segRectHit(a, b, body.rect, 5)) {
            const key = `${edgeId}:${body.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              crossings.push({ edgeId, deviceId: body.id, label: body.label });
            }
          }
        }
      }
    }
  }
  // gnd 符号：所有 gnd 引脚并到 GND 哨兵（键构造必须与上面点键一致）
  for (const gnd of gndDevices) {
    for (const anchor of anchorsOfNode(gnd, graph.family)) {
      const pinId = anchor.key.includes(':') ? (anchor.key.split(':').pop() as string) : anchor.key;
      uf.union('GND', `${gnd.id}:${pinId}`);
    }
  }

  // stub 识别：只碰 1 个器件引脚、不碰其他边 / 结点的悬空装饰线
  const stubEdges = new Set<string>();
  for (const [edgeId, poly] of polylines) {
    const pinHits = points.filter((point) => point.kind === 'pin' && touchesPolyline(poly, point.x, point.y));
    const dotHits = points.filter((point) => point.kind === 'dot' && touchesPolyline(poly, point.x, point.y));
    const otherEdgeHit = [...polylines.entries()].some(([otherId, other]) => {
      if (otherId === edgeId) return false;
      return polylineDistance(poly, other) <= TOL;
    });
    if (pinHits.length === 1 && dotHits.length === 0 && !otherEdgeHit) stubEdges.add(edgeId);
  }
  // stub 接地：画布上有 gnd（地的语义由 gnd 符号定义）且附近有「地 / VCC」标注
  if (gndDevices.length > 0) {
    for (const edgeId of stubEdges) {
      const poly = polylines.get(edgeId) as [number, number][];
      const labeled = graph.nodes.some(
        (node) =>
          node.kind === 'text' && GROUNDISH.test(node.label ?? '') && touchesPolyline(poly, node.x, node.y, TEXT_TOL),
      );
      if (labeled) {
        for (const [edgeId2, poly2] of polylines) {
          if (edgeId2 !== edgeId) continue;
          for (const point of points) {
            if (touchesPolyline(poly2, point.x, point.y)) uf.union('GND', point.key);
          }
        }
      }
    }
  }

  // 收网
  const netOfPoint = new Map<string, string>();
  const netMembers = new Map<string, string[]>();
  for (const point of points) {
    const root = uf.find(point.key);
    netOfPoint.set(point.key, root);
    if (!netMembers.has(root)) netMembers.set(root, []);
    (netMembers.get(root) as string[]).push(point.key);
  }
  const pins = points
    .filter((point) => point.kind === 'pin')
    .map((point) => ({
      deviceId: point.deviceId as string,
      pinId: (point.pinId ?? point.key.split(':').pop()) as string,
      net: netOfPoint.get(point.key) as string,
      x: point.x,
      y: point.y,
    }));
  return { netOfPoint, netMembers, pins, stubEdges, hasGnd: gndDevices.length > 0, crossings };
}

/* ── 主入口 ─────────────────────────────────────────────────────── */

const refuse = (code: NetSolveCode, reason: string): NetSolveOutcome => ({ ok: false, code, reason });

export function netSolve(graph: CanvasGraph, options: NetSolveOptions = {}): NetSolveOutcome {
  const deviceNodes = graph.nodes.filter((node) => !['text', 'dot', 'wire'].includes(node.kind));
  const unknown = unknownDevices(graph)[0];
  if (unknown) {
    // W20：点名到器件与位置 id，不再只丢一句「暂不支持」。
    return refuse('unsupported', unknownDeviceNote(graph) ?? `画布上有通用求解还不认识的器件「${unknown.id}」（${unknown.kind}）。`);
  }

  // W22-B：导线穿过器件本体 → 并网会把 body 上的引脚误并成一个网，直接拒答并指路。
  const build = buildNets(graph);
  if (build.crossings.length > 0) {
    const first = build.crossings[0];
    const more = build.crossings.length > 1 ? `（共 ${build.crossings.length} 处）` : '';
    return refuse(
      'bodyCross',
      `导线穿过了器件「${first.label}」的本体${more}：导线只能落在引脚上，穿过身体会把不该连的引脚误连成一团 —— 把这条线挪开重画，或恢复骨架。`,
    );
  }
  const netOfDevicePin = new Map<string, Record<string, string>>();
  for (const pin of build.pins) {
    const entry = netOfDevicePin.get(pin.deviceId) ?? {};
    entry[pin.pinId] = pin.net;
    netOfDevicePin.set(pin.deviceId, entry);
  }
  // W22-B 交流口径：ac 下 C 短路 = 两端网合并（见 groundNet 之后的预扫）。
  // netOf 的返回一律过 resolveNet —— 之后所有 stamp / 电压查询都用代表网。
  const mode = NET_AC_CONFIG.honorMode ? (options.mode ?? 'dc') : 'dc';
  const acAliases = new Map<string, string>();
  const resolveNet = (net: string | undefined): string | undefined => {
    if (!net) return net;
    let cur = net;
    while (acAliases.has(cur)) cur = acAliases.get(cur) as string;
    return cur;
  };
  const netOfRaw = (deviceId: string, pinId: string): string | undefined => netOfDevicePin.get(deviceId)?.[pinId];
  const netOf = (deviceId: string, pinId: string): string | undefined => resolveNet(netOfRaw(deviceId, pinId));

  // ① 无地拒答（地的语义 = gnd 符号；stub 只在有 gnd 时跟随）
  if (NETSOLVE_CONFIG.checkGround && !build.hasGnd) {
    return refuse('noGround', NO_GROUND_REASON);
  }

  const vt = options.vt ?? 0.026;
  // 真实的地网：gnd 符号引脚所在的网（root 名是并查集内部键，不一定是 'GND'）
  const gndDevices = deviceNodes.filter((node) => node.kind === 'gnd');
  const groundNet = build.pins.find((pin) => gndDevices.some((gnd) => gnd.id === pin.deviceId))?.net ?? 'GND';
  if (mode === 'ac') {
    const isGroundNet = (net: string) => net === groundNet || net === 'GND';
    for (const node of deviceNodes.filter((item) => item.kind === 'cap')) {
      const a = resolveNet(netOfRaw(node.id, 'a'));
      const b = resolveNet(netOfRaw(node.id, 'b'));
      if (!a || !b || a === b) continue;
      // 地网必须做代表（合并不许把地并进别的网 —— voltageOf 的地特判靠它）。
      if (isGroundNet(a) && !isGroundNet(b)) acAliases.set(b, a);
      else acAliases.set(a, b);
    }
  }
  interface OpampInfo {
    id: string;
    out: string;
    inp: string;
    inm: string;
  }
  const opamps: OpampInfo[] = [];
  const elements: Element[] = [];
  const elementSource: { elementId: string; deviceId: string }[] = [];

  const addElement = (element: Element, deviceId: string) => {
    elements.push(element);
    elementSource.push({ elementId: element.id, deviceId });
  };

  for (const node of deviceNodes) {
    const id = node.id;
    switch (node.kind) {
      case 'gnd':
        break;
      case 'res': {
        const value = node.value;
        if (!(typeof value === 'number' && value > 0)) {
          return refuse('unsupported', `电阻「${node.label ?? id}」没有数值：在参数表里给它一个正值。`);
        }
        addElement({ id: `x:${id}`, kind: 'R', a: netOf(id, 'a') as string, b: netOf(id, 'b') as string, value }, id);
        break;
      }
      case 'vsrc': {
        const value = options.vsrcValues?.[id] ?? node.value;
        if (!(typeof value === 'number' && Number.isFinite(value))) {
          return refuse('unsupported', `电压源「${node.label ?? id}」没有数值：画布上没标，调用方也没给 —— 在参数表里填一个值。`);
        }
        addElement({ id: `x:${id}`, kind: 'V', a: netOf(id, 'p') as string, b: netOf(id, 'n') as string, value }, id);
        break;
      }
      case 'isrc': {
        const value = node.value;
        if (!(typeof value === 'number' && Number.isFinite(value))) {
          return refuse('unsupported', `电流源「${node.label ?? id}」没有数值。`);
        }
        addElement({ id: `x:${id}`, kind: 'I', a: netOf(id, 'p') as string, b: netOf(id, 'n') as string, value }, id);
        break;
      }
      case 'cap':
        // dc（现状）：开路不 stamp（由此浮空的网会按 floatingNet 拒答）。
        // ac（W22-B）：短路 —— 两端网已在上面预合并，同样不 stamp。
        break;
      case 'diode': {
        const vf = node.params?.vf ?? 0.7;
        const mid = `dio-${id}-m`;
        addElement({ id: `x:${id}:v`, kind: 'V', a: netOf(id, 'a') as string, b: mid, value: vf }, id);
        addElement({ id: `x:${id}:r`, kind: 'R', a: mid, b: netOf(id, 'c') as string, value: 1 }, id);
        break;
      }
      case 'npn': {
        const ic = node.value;
        const beta = node.params?.beta;
        const va = node.params?.lambda ?? node.params?.VA;
        if (!(typeof ic === 'number' && ic > 0) || typeof beta !== 'number' || typeof va !== 'number') {
          return refuse('unsupported', `晶体管「${node.label ?? id}」缺工作点参数（Ic / β / VA）：通用解按小信号 π 模型算，需要这三个值 —— 点「恢复编辑，改结构」后选中该器件，在「模型参数」里按题面补上（Ic 就是器件行的数值框）；拒答条下方的补参面板也能一次填完。`);
        }
        const gm = ic / vt;
        const rpi = beta / gm;
        const ro = va / ic;
        addElement({ id: `x:${id}:rpi`, kind: 'R', a: netOf(id, 'b') as string, b: netOf(id, 'e') as string, value: rpi }, id);
        addElement({ id: `x:${id}:ro`, kind: 'R', a: netOf(id, 'c') as string, b: netOf(id, 'e') as string, value: ro }, id);
        addElement({ id: `x:${id}:gm`, kind: 'VCCS', a: netOf(id, 'c') as string, b: netOf(id, 'e') as string, value: gm, control: { a: netOf(id, 'b') as string, b: netOf(id, 'e') as string } }, id);
        break;
      }
      case 'nmos': {
        const gm = node.params?.gm;
        const ro = node.params?.ro;
        if (typeof gm !== 'number' || typeof ro !== 'number') {
          return refuse('unsupported', `MOS 管「${node.label ?? id}」缺小信号参数（gm / ro）：通用解按 π 模型算，需要这两个值 —— 最快是点下方「补模型参数」直接填；也可以点「恢复编辑，改结构」后选中该器件，在「模型参数」里按题面补上。`);
        }
        addElement({ id: `x:${id}:ro`, kind: 'R', a: netOf(id, 'd') as string, b: netOf(id, 's') as string, value: ro }, id);
        addElement({ id: `x:${id}:gm`, kind: 'VCCS', a: netOf(id, 'd') as string, b: netOf(id, 's') as string, value: gm, control: { a: netOf(id, 'g') as string, b: netOf(id, 's') as string } }, id);
        break;
      }
      case 'opamp': {
        const out = netOf(id, 'out');
        const inp = netOf(id, 'inp');
        const inm = netOf(id, 'inm');
        if (!out || !inp || !inm) {
          return refuse('unsupported', `运放「${node.label ?? id}」有引脚没接线：三个脚都要连上。`);
        }
        opamps.push({ id, out, inp, inm });
        break;
      }
      default:
        return refuse('unsupported', `器件「${node.label ?? id}」（${node.kind}）暂不支持通用求解。`);
    }
  }

  // ② 电压源短路 / 环路（把源两端焊死看是否成环）
  const vPairs: [string, string, string][] = [];
  for (const node of deviceNodes) {
    if (node.kind === 'vsrc') vPairs.push([`x:${node.id}`, netOf(node.id, 'p') as string, netOf(node.id, 'n') as string]);
    if (node.kind === 'opamp') vPairs.push([`opamp:${node.id}`, netOf(node.id, 'out') as string, groundNet]);
  }
  for (const [id, a, b] of vPairs) {
    if (a === b) return refuse('shortVSource', `电压源两端接在同一个电气点上（短路）：${id} —— 检查它的连线。`);
  }
  const loopUf = new UnionFind();
  for (const [, a, b] of vPairs) {
    if (loopUf.find(a) === loopUf.find(b)) {
      return refuse('vSourceLoop', '电压源构成了回路（两个源头对头 / 并联在同一对节点上）：节点电压无定义 —— 改掉其中一个源，或在回路里串一个电阻。');
    }
    loopUf.union(a, b);
  }

  // ③ 悬空子网：沿 R / V / 二极管（导电元件）能到地网的才可解
  const condUf = new UnionFind();
  condUf.find(groundNet);
  for (const element of elements) {
    if (element.kind === 'R' || element.kind === 'V') condUf.union(element.a, element.b);
  }
  for (const opamp of opamps) condUf.union(opamp.out, groundNet);
  // W22-B：pinnedNets / netNames 一律用归并后的代表网 —— 否则 ac 短路的旧名网
  // 会以孤立网进 MNA（singular）或被 floatingNet 误拒。
  const pinnedNets = new Set<string>();
  for (const pin of build.pins) {
    const net = resolveNet(pin.net);
    if (net) pinnedNets.add(net);
  }
  for (const net of pinnedNets) {
    if (condUf.find(net) !== condUf.find(groundNet)) {
      const members = (build.netMembers.get(net) ?? []).slice(0, 4).join('、');
      return refuse('floatingNet', `有一个子网没有任何到地的直流通路（悬空）：${members} —— 把它接到地 / 电源轨，或补上偏置电阻。`);
    }
  }

  // ④ 组电路：无运放 → 直接解；有运放 → nullor 两步法（E=0 与 E=1，仿射组合定 E）
  const netNames = [...pinnedNets].filter((net) => net !== groundNet);
  if (opamps.length > 0) {
    for (const opamp of opamps) {
      elements.push({ id: `opamp:${opamp.id}`, kind: 'V', a: opamp.out, b: groundNet, value: 0 });
    }
  }
  // W23：测试电流源只在这里 stamp 一次，与 R / V / VCCS 共用同一个方程，
  // 等效电路的 Vth / Rth 因此不是「另写一套公式估的」，而是这张图的同一份解。
  let testCurrent: { net: string; amps: number } | null = null;
  if (options.testCurrent && Number.isFinite(options.testCurrent.amps) && options.testCurrent.amps !== 0) {
    const net = resolveNet(options.testCurrent.net);
    if (net && net !== groundNet) {
      testCurrent = { net, amps: options.testCurrent.amps };
      elements.push({ id: 'x:equiv-test', kind: 'I', a: net, b: groundNet, value: testCurrent.amps });
    }
  }
  const circuit: AnalogCircuit = { nodes: netNames, ground: groundNet, elements };

  let solves: ReturnType<typeof solveMNA>[];
  try {
    solves = [solveMNA(circuit)];
    for (let j = 0; j < opamps.length; j += 1) {
      const probe = circuit.elements.find((element) => element.id === `opamp:${opamps[j].id}`);
      const saved = opamps.map((opamp) => circuit.elements.find((element) => element.id === `opamp:${opamp.id}`)?.value ?? 0);
      for (let k = 0; k < opamps.length; k += 1) {
        const element = circuit.elements.find((one) => one.id === `opamp:${opamps[k].id}`);
        if (element) element.value = k === j ? 1 : 0;
      }
      solves.push(solveMNA(circuit));
      void probe;
      void saved;
    }
  } catch (error) {
    return refuse('singular', `MNA 矩阵奇异：${error instanceof Error ? error.message : '未知错误'} —— 检查浮空节点或理想源环路。`);
  }

  // 运放约束：v(inp) − v(inm) 是 E 的仿射函数，逐运放解出 E
  const base = solves[0];
  const eValues = new Array<number>(opamps.length).fill(0);
  if (opamps.length > 0) {
    const rows = opamps.map((opamp) => solves.map((solve) => solve.voltage[opamp.inp] - solve.voltage[opamp.inm]));
    const rhs = rows.map((row) => -row[0]);
    // 仿射斜率：f(E) = f(0) + (f(1) − f(0))·E → 矩阵行 = f(1) − f(0)
    const matrix = rows.map((row) => row.slice(1).map((value) => value - row[0]));
    const k = opamps.length;
    const aug = matrix.map((row, index) => [...row, rhs[index]]);
    for (let col = 0; col < k; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < k; row += 1) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
      }
      if (Math.abs(aug[pivot][col]) < 1e-14) {
        return refuse('singular', `运放「${opamps[pivot]?.id ?? ''}」的输入约束退化（没有反馈通路把 V₊ 拉到 V₋）：检查反馈支路是否接到了输出。`);
      }
      if (pivot !== col) [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
      for (let row = col + 1; row < k; row += 1) {
        const factor = aug[row][col] / aug[col][col];
        if (factor === 0) continue;
        for (let term = col; term <= k; term += 1) aug[row][term] -= factor * aug[col][term];
      }
    }
    for (let row = k - 1; row >= 0; row -= 1) {
      let sum = aug[row][k];
      for (let col = row + 1; col < k; col += 1) sum -= aug[row][col] * eValues[col];
      eValues[row] = sum / aug[row][row];
    }
  }

  // 仿射组合：v = base + Σ B·E
  const netVoltages: Record<string, number> = { GND: 0 };
  for (const net of netNames) netVoltages[net] = base.voltage[net] ?? 0;
  for (let j = 0; j < opamps.length; j += 1) {
    const probe = solves[j + 1];
    if (eValues[j] === 0) continue;
    for (const net of netNames) {
      netVoltages[net] += ((probe.voltage[net] ?? 0) - (base.voltage[net] ?? 0)) * eValues[j];
    }
  }
  // V 支路电流同样仿射组合
  const branchById = new Map<string, number>();
  for (const element of elements) {
    if (element.kind === 'V' || element.kind === 'VCVS') {
      let current = base.branchCurrent[element.id] ?? 0;
      for (let j = 0; j < opamps.length; j += 1) {
        if (eValues[j] !== 0) current += ((solves[j + 1].branchCurrent[element.id] ?? 0) - (base.branchCurrent[element.id] ?? 0)) * eValues[j];
      }
      branchById.set(element.id, current);
    }
  }

  /* ── 支路电流 / 功率 / KCL 残差 ── */
  const voltageOf = (deviceId: string, pinId: string): number => {
    const net = netOf(deviceId, pinId);
    if (net === undefined) return 0;
    return net === groundNet ? 0 : (netVoltages[net] ?? 0);
  };
  const branchCurrents: Record<string, number> = {};
  const powers: Record<string, number> = {};
  /** KCL 用：每条 primitive 元件的电流（a→b 为正）。 */
  const elementCurrents: { a: string; b: string; i: number }[] = [];
  // W23：测试源也是真实元件，逐网 KCL 必须把它算进去，否则带测试解会留一个人造残差。
  if (testCurrent) elementCurrents.push({ a: testCurrent.net, b: groundNet, i: testCurrent.amps });
  const deviceById = new Map(deviceNodes.map((node) => [node.id, node]));

  for (const node of deviceNodes) {
    const id = node.id;
    switch (node.kind) {
      case 'res': {
        const value = node.value as number;
        const i = (voltageOf(id, 'a') - voltageOf(id, 'b')) / value;
        branchCurrents[id] = i;
        powers[id] = (voltageOf(id, 'a') - voltageOf(id, 'b')) * i;
        elementCurrents.push({ a: netOf(id, 'a') as string, b: netOf(id, 'b') as string, i });
        break;
      }
      case 'vsrc': {
        const i = branchById.get(`x:${id}`) ?? 0;
        branchCurrents[id] = i;
        powers[id] = (voltageOf(id, 'p') - voltageOf(id, 'n')) * i;
        elementCurrents.push({ a: netOf(id, 'p') as string, b: netOf(id, 'n') as string, i });
        break;
      }
      case 'isrc': {
        const i = node.value as number;
        branchCurrents[id] = i;
        powers[id] = (voltageOf(id, 'p') - voltageOf(id, 'n')) * i;
        elementCurrents.push({ a: netOf(id, 'p') as string, b: netOf(id, 'n') as string, i });
        break;
      }
      case 'diode': {
        const i = branchById.get(`x:${id}:v`) ?? 0;
        branchCurrents[id] = i;
        powers[id] = (voltageOf(id, 'a') - voltageOf(id, 'c')) * i;
        elementCurrents.push({ a: netOf(id, 'a') as string, b: `dio-${id}-m`, i });
        elementCurrents.push({ a: `dio-${id}-m`, b: netOf(id, 'c') as string, i });
        break;
      }
      case 'npn': {
        const ic = node.value as number;
        const va = (node.params?.lambda ?? node.params?.VA) as number;
        const gm = ic / vt;
        const vbe = voltageOf(id, 'b') - voltageOf(id, 'e');
        const vce = voltageOf(id, 'c') - voltageOf(id, 'e');
        branchCurrents[id] = gm * vbe;
        powers[id] = (vbe * vbe) / ((node.params?.beta as number) / gm) + (vce * vce) / (va / ic) + gm * vbe * vce;
        elementCurrents.push({ a: netOf(id, 'b') as string, b: netOf(id, 'e') as string, i: vbe / ((node.params?.beta as number) / gm) });
        elementCurrents.push({ a: netOf(id, 'c') as string, b: netOf(id, 'e') as string, i: vce / (va / ic) + gm * vbe });
        break;
      }
      case 'nmos': {
        const gm = node.params?.gm as number;
        const ro = node.params?.ro as number;
        const vgs = voltageOf(id, 'g') - voltageOf(id, 's');
        const vds = voltageOf(id, 'd') - voltageOf(id, 's');
        branchCurrents[id] = gm * vgs;
        powers[id] = (vds * vds) / ro + gm * vgs * vds;
        elementCurrents.push({ a: netOf(id, 'd') as string, b: netOf(id, 's') as string, i: vds / ro + gm * vgs });
        break;
      }
      case 'opamp': {
        const i = branchById.get(`opamp:${id}`) ?? 0;
        branchCurrents[id] = i;
        powers[id] = (voltageOf(id, 'out') - 0) * i;
        elementCurrents.push({ a: netOf(id, 'out') as string, b: groundNet, i });
        break;
      }
      default:
        break;
    }
  }
  void deviceById;

  // KCL：每个网 Σ(流出电流) = 0
  const netSum = new Map<string, number>();
  for (const { a, b, i } of elementCurrents) {
    netSum.set(a, (netSum.get(a) ?? 0) + i);
    netSum.set(b, (netSum.get(b) ?? 0) - i);
  }
  let kclMax = 0;
  let worstNode = 'GND';
  const kclByNet: Record<string, number> = {};
  for (const [net, sum] of netSum) {
    kclByNet[net] = sum;
    if (Math.abs(sum) > kclMax) {
      kclMax = Math.abs(sum);
      worstNode = net;
    }
  }
  const mnaMax = Math.max(base.residual, ...solves.slice(1).map((solve) => solve.residual));

  // tag 别名（e-out tag=Vo → n-vo）+ 地网 0V + 引脚→网表
  const nodeVoltages: Record<string, number> = { ...netVoltages, GND: 0, [groundNet]: 0 };
  for (const edge of graph.edges) {
    if (!edge.tag) continue;
    nodeVoltages[`n-${edge.tag.toLowerCase()}`] = netVoltages[build.netOfPoint.get(`${edge.id}#0`) ?? ''] ?? 0;
  }
  const netOfPin: Record<string, string> = {};
  // W22-B：ac 短路合并后，被并网的旧名仍要能查到电压（measures 的 pinNet 走 pin.net 旧名）。
  for (const alias of acAliases.keys()) {
    const representative = resolveNet(alias) as string;
    nodeVoltages[alias] = nodeVoltages[representative] ?? 0;
  }
  for (const pin of build.pins) netOfPin[`${pin.deviceId}:${pin.pinId}`] = resolveNet(pin.net) ?? pin.net;

  // W16：二极管反偏如实报告 —— 线性化模型解出的电流为负就是反偏（物理事实），
  // 是「方向接反了」还是「稳压管本意反偏」由人判断，这里只说话不拦解。
  const notes: string[] = [];
  // W22-B：ac 口径且图上真有电容参与合并时，结果卡要说清口径 —— 承诺与实现对齐。
  if (mode === 'ac' && acAliases.size > 0) {
    notes.push('交流小信号口径：C 视为短路（L 开路）。增益 / Ri / Ro 这类小信号量都按这个口径算。');
  }
  for (const node of deviceNodes) {
    if (node.kind !== 'diode') continue;
    const i = branchCurrents[node.id] ?? 0;
    if (i < -1e-9) {
      notes.push(
        `二极管「${node.label ?? node.id}」电流 ${i.toPrecision(3)} A 为负（反偏）：阳极 / 阴极的方向可能接反了 —— 不是本意就在画布上选中它转 180°。`,
      );
    }
  }

  return {
    ok: true,
    solution: { nodeVoltages, branchCurrents, powers, residual: { kclMax, node: worstNode, mnaMax }, kclByNet, netOfPin, notes },
  };
}
