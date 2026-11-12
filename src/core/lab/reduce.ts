/**
 * 归约器：图 / 严格模型 → 既有 solver 的 params。
 *
 * 不写任何求解逻辑 —— 骨架不改时 params 与快照 parsed_given 逐键相同，
 * solver 逐位复现；结构改动时逐条 appliedRules 给人看，归约不唯一就拒。
 */

import type { BeamModel, Netlist } from '../types.ts';
import type { CanvasGraph, CanvasNode, ReduceResult } from './types.ts';

export type { ReduceResult };
import { allComposites, expandComposites, type CompositeDef } from './composite.ts';
import { findDevice, findLoads, labelNumber, loadT, PICKS, spanTextValueOf, valueFromLabel } from './picks.ts';
import { anchorsOfNode, type Anchor } from './pins.ts';
import { anchorDisplay } from './pinNames.ts';

/**
 * W16 变异开关（check:assemble ㉓④）：preferNodeValue=false → 回退「只认
 * label 里的第一个数」。label 是显示格式（Rc 4.7k），valueFromLabel 会读成
 * 4.7 而不是 4700 —— 这正是 node.value 必须是唯一真相的原因。
 */
export const REDUCE_CONFIG = { preferNodeValue: true };

/** 点到线段距离（本文件局部，避免牵连 ops 的内部件）。 */
function segDistReduce(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * W16 开路判据（只对电路、且只在「有导线的画布图」上跑），两级诚实分级：
 *  - 半接半悬（有引脚连线、也有引脚悬空）= 断线：**阻断**。比如删掉集电极
 *    到母线的那根竖线，Q 的基极 / 发射极都还连着、唯独集电极悬空 —— 这就是
 *    「一根该在的线没了」，出数值就是撒谎。
 *  - 整个器件一个引脚都没接 = 还没接进电路：**提醒不阻断**（文案带 W13 的
 *    悬空端口前缀，isBlockingProblem 认它不算硬伤）。装配台的既有工作流允许
 *    「先放器件、值先进参数表、再连线」（W10-A 的加 Rl 就这么走），这时把人
 *    拦死是错的；提醒说清楚「数值进了表但电路里没有它」。
 * 豁免：复合块（compositeId —— 悬空端口由 W13 的警告管，警告不阻断）；
 * 功能块图元 block（A7 的 A/β 块带装饰锚 x，本来就悬空）；严格模型入口
 * （meta.strictModel —— Netlist 反序列化的图没有几何，判不了也不该判）。
 */
function openPinProblems(graph: CanvasGraph): { blocking: string[]; warnings: string[] } {
  if (graph.family !== 'circuit' || graph.edges.length === 0 || graph.meta.strictModel !== undefined) return { blocking: [], warnings: [] };
  const devices = graph.nodes.filter((node) => node.kind !== 'text' && node.kind !== 'dot' && !node.compositeId && node.kind !== 'block');
  if (devices.length === 0) return { blocking: [], warnings: [] };
  const coveredOf = (device: CanvasNode): Anchor[] =>
    anchorsOfNode(device, graph.family).filter((anchor) => {
      if (anchor.kind !== 'pin') return false;
      return graph.edges.some((edge) => {
        if (edge.points && edge.points.length >= 2) {
          for (let i = 0; i + 1 < edge.points.length; i += 1) {
            if (segDistReduce(anchor.x, anchor.y, edge.points[i][0], edge.points[i][1], edge.points[i + 1][0], edge.points[i + 1][1]) <= 0.6) return true;
          }
          return false;
        }
        // 无 points 的边：from/to 是引脚 key（`n-x:p`）或节点 id。
        const hit = (raw: string) => raw === anchor.key || raw === device.id;
        return hit(edge.from) || hit(edge.to);
      });
    });
  const broken: string[] = [];
  const unwired: string[] = [];
  for (const device of devices) {
    const anchors = anchorsOfNode(device, graph.family).filter((anchor) => anchor.kind === 'pin');
    const covered = coveredOf(device);
    if (covered.length === anchors.length) continue;
    const bare = anchors.filter((anchor) => !covered.some((one) => one.key === anchor.key));
    const names = bare.map((anchor) => anchorDisplay(graph, anchor).text);
    if (covered.length > 0) {
      broken.push(`${names.join('、')}（${device.label ?? device.id}）`);
    } else {
      unwired.push(device.label ?? device.id);
    }
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  if (broken.length > 0) {
    problems.push(
      `开路：${broken.slice(0, 3).join('、')}${broken.length > 3 ? ` 等 ${broken.length} 处` : ''}的引脚上没有任何导线 —— 这条连接断了；把导线补回来，或恢复骨架。`,
    );
  }
  if (unwired.length > 0) {
    warnings.push(`悬空端口：「${unwired.slice(0, 3).join('、')}」还没接进电路（所有引脚都没连线）—— 它的数值已进参数表，但当前电路里没有它；连上导线后这条提醒消失。`);
  }
  return { blocking: problems, warnings };
}

/** 从归约表跑一遍：结构判据 → 逐键取数 → 兜底 / 拒答。 */
export function reduce(
  templateId: string,
  graph: CanvasGraph,
  userRules: readonly string[] = [],
  extraDefs?: Record<string, CompositeDef>,
): ReduceResult {
  // W13：复合器件在归约的第一行摊开 —— picks.ts 一行不改，之后一切照旧。
  // 开路判据看的是摊开前的画布（复合块豁免，悬空端口由 W13 警告管）。
  const open = openPinProblems(graph);
  const expansion = expandComposites(graph, extraDefs ? { ...allComposites(), ...extraDefs } : undefined);
  graph = expansion.graph;

  const picks = PICKS[templateId];
  if (!picks) {
    return {
      params: {},
      appliedRules: [...userRules, ...expansion.rules],
      problems: [
        `题型 ${templateId} 还没有装配归约表：换用 D1–D6 / A1–A7 / M1–M8 / S1–S7 里已支持的题型，或回到 #/t/${templateId} 改数值。`,
        ...expansion.problems,
        ...expansion.warnings,
      ],
      outOfScope: true,
    };
  }

  const blocking: string[] = [...open.blocking];
  for (const reject of picks.rejects ?? []) {
    const message = reject(graph);
    if (message) blocking.push(message);
  }
  blocking.push(...expansion.problems);

  const params: Record<string, number | string> = {};
  const appliedRules: string[] = [...userRules, ...expansion.rules];
  let L: number | null = null;

  for (const pick of picks.picks) {
    let value: number | string | undefined;
    for (const source of pick.sources) {
      if (source.src === 'meta') {
        const found = graph.meta[pick.key];
        // W20：meta.section 是截面对象，不是参数；归约只认标量。
        if (typeof found === 'number' || typeof found === 'string') {
          value = found;
          break;
        }
      } else if (source.src === 'device') {
        const device = findDevice(graph, source.device);
        if (device) {
          // W16：node.value 是唯一真相（SI 单位）；label 是显示格式
          // （Rc 4.7k），只读 label 会把 4.7k 读成 4.7 —— 所以 value 优先。
          if (REDUCE_CONFIG.preferNodeValue && device.value !== undefined) {
            value = device.value;
            break;
          }
          const fromLabel = valueFromLabel(device.label);
          if (fromLabel !== null) {
            value = fromLabel;
            break;
          }
        }
      } else if (source.src === 'deviceParam') {
        const device = findDevice(graph, source.device);
        const found = device?.params?.[source.field];
        if (found !== undefined) {
          value = found;
          break;
        }
      } else if (source.src === 'load') {
        const load = findLoads(graph, source.type)[source.index ?? 0];
        if (load) {
          const raw = load.value ?? valueFromLabel(load.label);
          if (raw !== null && Number.isFinite(raw)) {
            value = raw;
            break;
          }
        }
      } else if (source.src === 'loadAt') {
        const load = findLoads(graph, source.type)[source.index ?? 0];
        const t = load ? loadT(graph, load) : null;
        if (load && t !== null && L !== null && L > 0) {
          value = Number((t * L).toPrecision(12));
          break;
        }
      } else if (source.src === 'spanText') {
        const found = spanTextValueOf(graph);
        if (found !== null) {
          value = found;
          break;
        }
      } else if (source.src === 'textValue') {
        const found = labelNumber(graph, source.nodeId);
        if (found !== null) {
          value = found;
          break;
        }
      }
    }

    if (value === undefined) {
      if (pick.required) {
        // W17-A 删除即合并：串联器件删掉、两端网络已由 healTopology 合并
        //（meta.healedSeries 记着被合并的器件名）→ 该参数等价于 0，如实记 0，
        // 不再报「找不到来源」。归约表一行没动 —— 这是拓扑层的事实。
        const healedNames = String(graph.meta.healedSeries ?? '')
          .split(',')
          .filter(Boolean);
        const deviceSource = pick.sources.find((source) => source.src === 'device');
        const healed = deviceSource !== undefined && healedNames.includes(String(deviceSource.device).toUpperCase());
        if (!healed) {
          blocking.push(
            `参数 ${pick.key} 在图上找不到来源${pick.sources.some((s) => s.src === 'device') ? '（对应器件被删了？）' : ''}：把器件加回来，或恢复骨架，或换题型。`,
          );
        } else {
          value = 0;
        }
      } else if (pick.missing !== undefined) {
        value = pick.missing;
        if (pick.rule) appliedRules.push(pick.rule);
      }
    }

    if (value !== undefined) {
      params[pick.key] = typeof value === 'number' && pick.transform ? pick.transform(value) : value;
    }
    if (pick.key === 'L' && typeof params.L === 'number') L = params.L;
  }

  // 悬空端口 / 未接线提醒进 problems 但不阻断（isBlockingProblem 识别）；硬闸门才判 U。
  const problems = [...blocking, ...open.warnings, ...expansion.warnings];
  return { params, appliedRules, problems, outOfScope: blocking.length > 0 || expansion.fatal };
}

/* ── 文档署名的两个入口：严格模型 → 归约 ─────────────────────────── */

const SYMBOL_TO_KIND: Record<string, string> = {
  R: 'res',
  C: 'cap',
  L: 'ind',
  D: 'diode',
  LED: 'led',
  V: 'vsrc',
  NPN: 'npn',
  PNP: 'pnp',
  NMOS: 'nmos',
  PMOS: 'pmos',
  GND: 'gnd',
  OPAMP: 'opamp',
};

const SUPPORT_TO_KIND: Record<string, string> = {
  pin: 'pinSupport',
  roller: 'rollerSupport',
  fixed: 'fixedSupport',
  cable: 'cableSupport',
  smooth: 'smoothSupport',
};

const LOAD_TO_KIND: Record<string, string> = {
  point: 'arrow',
  udl: 'udl',
  moment: 'momentArrow',
  torque: 'torqueArrow',
};

/** Netlist → CanvasGraph（label 用归一化器件名，几何用网格占位 —— 电路归约只认值与种类）。 */
function netlistToGraph(templateId: string, net: Netlist, meta: Record<string, number | string>): CanvasGraph {
  const nodes = net.devices.map((device, index) => ({
    id: device.id,
    x: 100 + index * 120,
    y: 200,
    kind: SYMBOL_TO_KIND[device.symbolId] ?? device.symbolId.toLowerCase(),
    label: device.id.replace(/^n-/, '').replace(/-\d+$/, ''),
    rot: device.rotation,
    ...(device.value !== undefined ? { value: device.value } : {}),
    ...(device.params ? { params: { ...device.params } } : {}),
  }));
  return { templateId, family: 'circuit', nodes, edges: [], meta: { ...meta, strictModel: 'netlist' } };
}

/** BeamModel → CanvasGraph（几何齐全：载荷 t 沿主跨还原成坐标）。 */
function beamToGraph(templateId: string, beam: BeamModel, meta: Record<string, number | string>): CanvasGraph {
  const nodes: CanvasGraph['nodes'] = beam.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, kind: 'dot' }));
  const edges: CanvasGraph['edges'] = beam.members.map((member) => ({
    id: member.id,
    from: member.from,
    to: member.to,
    kind: member.symbolId === 'shaftSegment' ? 'shaft' : member.symbolId === 'beamSegment' ? 'beam' : 'line',
  }));
  for (const support of beam.supports) {
    const at = beam.nodes.find((node) => node.id === support.at);
    nodes.push({
      id: support.id,
      x: at?.x ?? 0,
      y: at?.y ?? 0,
      kind: SUPPORT_TO_KIND[support.type] ?? support.type,
      label: '',
    });
  }
  for (const load of beam.loads) {
    const member = beam.members.find((m) => m.id === load.at);
    const a = member ? beam.nodes.find((node) => node.id === member.from) : undefined;
    const b = member ? beam.nodes.find((node) => node.id === member.to) : undefined;
    const at = beam.nodes.find((node) => node.id === load.at);
    const x = a && b && load.t !== undefined ? a.x + load.t * (b.x - a.x) : (at?.x ?? 0);
    const y = at?.y ?? a?.y ?? 0;
    nodes.push({
      id: load.id,
      x,
      y,
      kind: LOAD_TO_KIND[load.type] ?? load.type,
      label: `${load.id} = ${load.value}`,
      ...(load.type === 'moment' || load.type === 'torque' ? { rot: 0 } : { rot: 0 }),
      value: load.value,
    });
  }
  return { templateId, family: 'beam', nodes, edges, meta: { ...meta } };
}

export function reduceNetlist(
  templateId: string,
  net: Netlist,
  meta: Record<string, number | string> = {},
  userRules: readonly string[] = [],
): ReduceResult {
  return reduce(templateId, netlistToGraph(templateId, net, meta), userRules);
}

export function reduceBeam(
  templateId: string,
  beam: BeamModel,
  meta: Record<string, number | string> = {},
  userRules: readonly string[] = [],
): ReduceResult {
  return reduce(templateId, beamToGraph(templateId, beam, meta), userRules);
}
