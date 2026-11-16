/**
 * 每型一张「参数从哪几个器件取」的归约表。
 *
 * 同一张表有三个用途（保证互不漂移）：
 *  ① seedGraph：载入骨架时把模板默认参数种到器件上；
 *  ② reduce：从图 / 模型把参数收回来（骨架不改 → 逐键等于 parsed_given）；
 *  ③ applyParams：用户在参数表里改数 → 写回图（挪载荷 / 改器件值 / 刷新标签）。
 */

import type { ParamValue } from '../templates/registry.ts';
import { formatCompact } from '../format.ts';
import { normalizeDeviceId } from './graphFromSpec.ts';
import { deviceName } from './labels.ts';
import { supportRefs } from './attach.ts';
import { analyzeTruss } from '../statics/truss.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';

export type LoadType = 'point' | 'udl' | 'moment' | 'torque';

export type PickSource =
  | { src: 'meta' }
  | { src: 'device'; device: string }
  | { src: 'deviceParam'; device: string; field: string }
  | { src: 'load'; type: LoadType; index?: number }
  /** 载荷位置 t×L（要求 L 在本表先解析）。 */
  | { src: 'loadAt'; type: LoadType; index?: number }
  /** 骨架上的「L = 4 m」文字。 */
  | { src: 'spanText' }
  /** 骨架上某条标注文字里的第一个数（VCC 12V / VDD 12V / T = 1 kN·m）。 */
  | { src: 'textValue'; nodeId: string };

export interface PickEntry {
  key: string;
  /** 来源链：第一个给出值的来源生效。 */
  sources: PickSource[];
  /** 全部落空时的兜底值（例：删 Rc → 1e12 输出短接；Re 未画 → 旁路接地）。 */
  missing?: number | string;
  /** 兜底生效时的说明，进 appliedRules 给人看。 */
  rule?: string;
  /** true = 兜底不许生效，落空直接进 problems（拒答）。 */
  required?: boolean;
  /** 数值换算（恒等居多）。 */
  transform?: (value: number) => number;
  /** applyParams 刷新载荷标签用的单位。 */
  unit?: string;
}

export interface TemplatePicks {
  family: 'circuit' | 'beam';
  /** 力学构件的真实种类（P0-1）：决定装配台给哪些「加入器件」、构件行摊开哪些参数。
   *  family 只区分「力学 / 电路」这套求解机器的走向，元素种类是另一根轴 ——
   *  M1 轴向拉压 / M7 压杆稳定是 bar，M2 扭转是 shaft，梁/框架才是 beam。 */
  element?: 'beam' | 'bar' | 'shaft' | 'truss';
  picks: PickEntry[];
  /** 器件种类白名单（symbolId）；骨架出现白名单外器件 → 拒。 */
  whitelist?: string[];
  /** 结构判据：返回人话问题；null = 通过。 */
  rejects?: ((graph: CanvasGraph) => string | null)[];
}

/* ── 器件 / 载荷定位 ─────────────────────────────────────────────── */

/** 按标签前缀 → 归一化 id → 图元种类 找器件；三种骨架写法都认。 */
export function findDevice(graph: CanvasGraph, name: string): CanvasNode | undefined {
  const want = name.toUpperCase();
  return graph.nodes.find((node) => {
    if ((node.label ?? '').trim().toUpperCase().startsWith(want)) return true;
    if (normalizeDeviceId(node.id) === want) return true;
    if (node.kind.toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
}

export const LOAD_KIND_OF: Record<string, LoadType> = {
  arrow: 'point',
  udl: 'udl',
  momentArrow: 'moment',
  torqueArrow: 'torque',
};

/** 解出来的反力不是输入：S 系写 R_A/R_B，M 系写 n-reaction-*。 */
export const REACTION_LABEL = /^([RM]_[A-Za-z]|RA|RB)\b/;

export function findLoads(graph: CanvasGraph, type: LoadType): CanvasNode[] {
  return graph.nodes
    .filter(
      (node) =>
        !node.id.startsWith('n-reaction-') &&
        REACTION_LABEL.test((node.label ?? '').trim()) === false &&
        LOAD_KIND_OF[node.kind] === type,
    )
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

/** 骨架装载参数：力学骨架统一剥掉反力箭头（图元 id 有 S/M 两种写法）。 */
export function skeletonOptions(_templateId: string): { stripIdPrefixes: string[] } {
  return { stripIdPrefixes: ['n-reaction-', 'n-RA', 'n-RB', 'n-MA'] };
}

/** 载荷在主跨上的相对位置 t∈[0,1]（无主跨返回 null）。 */
export function loadT(graph: CanvasGraph, node: CanvasNode): number | null {
  // R3-4 U1：载荷自己记着落在哪根杆上（切段之后才有第二段这种东西）；
  // 没记（快照 / 单跨图）就退回「第一根杆」，与以前完全一样。
  const own = node.atMember ? graph.edges.find((edge) => edge.id === node.atMember) : undefined;
  const member =
    own ?? graph.edges.find((edge) => edge.kind === 'beam' || edge.kind === 'shaft' || edge.kind === 'line' || edge.kind === 'trussMember');
  if (!member) return null;
  const a = graph.nodes.find((n) => n.id === member.from);
  const b = graph.nodes.find((n) => n.id === member.to);
  if (!a || !b) return null;
  // R-38：沿构件方向做参数化投影，而不是只看 x。原来 `b.x === a.x` 就返回
  // null，竖直 / 斜杆上所有载荷的 t 全丢，归约读不到力 —— 水平杆时 dy=0，
  // 这里精确退化回原来的 (node.x-a.x)/(b.x-a.x)，逐字兼容既有快照。
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((node.x - a.x) * dx + (node.y - a.y) * dy) / len2;
  return Math.min(1, Math.max(0, t));
}

/** 标注文字里的第一个数（VCC 12V / T = 1 kN·m）；严格模型里对应 meta 兜底。 */
const NUMBER_IN_LABEL = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/**
 * 从器件 / 载荷标签里取数值。有等号时只认等号后面的第一个数：
 * `P1 = 10 kN` 若从头抓数字会抓成 1（P1 的下标），S3 就是这么错的。
 */
export function valueFromLabel(label?: string): number | null {
  const text = label ?? '';
  const eq = text.indexOf('=');
  const numeric = eq >= 0 ? text.slice(eq + 1) : text;
  const value = Number(numeric.match(NUMBER_IN_LABEL)?.[0]);
  return Number.isFinite(value) ? value : null;
}

function spanTextValue(graph: CanvasGraph): number | null {
  const text = graph.nodes.find((node) => node.kind === 'text' && /^L\s*=/.test(node.label ?? ''));
  if (!text) return null;
  return valueFromLabel(text.label);
}

export function labelNumber(graph: CanvasGraph, nodeId: string): number | null {
  const text = graph.nodes.find((node) => node.id === nodeId && node.kind === 'text');
  if (!text) return null;
  return valueFromLabel(text.label);
}

/** reduce 用的跨长文字解析（无则 null）。 */
export function spanTextValueOf(graph: CanvasGraph): number | null {
  return spanTextValue(graph);
}

/* ── 白名单 / 结构判据 ───────────────────────────────────────────── */

const circuitReject = (allowed: string[], extra?: (graph: CanvasGraph) => string | null) => {
  const checks: ((graph: CanvasGraph) => string | null)[] = [
    (graph) => {
      const stray = graph.nodes.filter((node) => node.kind !== 'text' && node.kind !== 'dot' && !(node.kind in LOAD_KIND_OF) && !allowed.includes(node.kind));
      if (stray.length > 0) {
        return `白名单外器件「${stray[0].label ?? stray[0].kind}」：本题型不支持；请删除它，或换成电阻 / 电源等骨架内器件，或改题型。`;
      }
      return null;
    },
  ];
  if (extra) checks.push(extra);
  return checks;
};

const atMostOne = (device: string, note: string) => (graph: CanvasGraph): string | null => {
  const label = (node: CanvasNode) => (node.label ?? '').trim().toUpperCase().startsWith(device.toUpperCase());
  const count = graph.nodes.filter((node) => node.kind !== 'text' && (label(node) || normalizeDeviceId(node.id) === device.toUpperCase())).length;
  return count > 1 ? note : null;
};

/**
 * 支座计数（R3-1 A1 起走 supportRefs：结点属性 + 旧形态图元都算）。
 * 「恰好一个固定铰 + 一个可动铰」这类判据因此对两种存法同判 —— 折叠前后不漂移。
 */
const exactly = (kinds: string[], note: string) => (graph: CanvasGraph): string | null => {
  const count = supportRefs(graph).filter((ref) => kinds.includes(ref.kind)).length;
  return count === kinds.length ? null : note;
};

/** 支座逐类计数（pin+pin / 单个固定端都分得清，比总量判据严）。 */
const supportCount = (want: Record<string, number>, note: string) => (graph: CanvasGraph): string | null => {
  const refs = supportRefs(graph);
  for (const [kind, count] of Object.entries(want)) {
    if (refs.filter((ref) => ref.kind === kind).length !== count) return note;
  }
  return null;
};

/** 恰好一条主跨：删掉梁 / 轴段立刻 structure fail，补回即恢复。 */
const mainSpan = (kinds: string[], note: string) => (graph: CanvasGraph): string | null => {
  const members = graph.edges.filter((edge) => kinds.includes(edge.kind)).length;
  return members === 1 ? null : note;
};

/** 电路：关键器件一个都不能少；删了就明确拒答并给怎么改。 */
const requireDevices = (names: string[], note: string) => (graph: CanvasGraph): string | null => {
  const missing = names.filter((name) => findDevice(graph, name) === undefined);
  return missing.length > 0 ? `${note}（缺 ${missing.join(' / ')}）` : null;
};

/** 集中力个数：一个载荷一个键，多了少了都不硬凑。 */
const pointLoads = (count: number, note: string) => (graph: CanvasGraph): string | null => {
  const got = findLoads(graph, 'point').length;
  return got === count ? null : `${note}（现在 ${got} 个，需要 ${count} 个）`;
};

/* ── 六型 + S5 的归约表 ──────────────────────────────────────────── */

export const PICKS: Record<string, TemplatePicks> = {
  A3: {
    family: 'circuit',
    whitelist: ['vsrc', 'res', 'npn', 'gnd'],
    picks: [
      { key: 'config', sources: [{ src: 'meta' }], missing: 'CE' },
      { key: 'beta', sources: [{ src: 'deviceParam', device: 'Q', field: 'beta' }], required: true },
      { key: 'Ic', sources: [{ src: 'device', device: 'Q' }], required: true },
      { key: 'Rc', sources: [{ src: 'device', device: 'RC' }], missing: 1e12, rule: '已删除集电极电阻 Rc：输出端短接到交流地（Rc→∞）' },
      { key: 'Rl', sources: [{ src: 'device', device: 'RL' }], missing: 1e12, rule: '未接负载 Rl：按空载处理（Rl→∞）' },
      { key: 'Rs', sources: [{ src: 'device', device: 'RS' }], required: true },
      { key: 'Re', sources: [{ src: 'device', device: 'RE' }, { src: 'meta' }], missing: 1000, rule: 'RE 未画出：发射极经 Ce 旁路交流接地，Re 用骨架默认值' },
      { key: 'Vt', sources: [{ src: 'meta' }], missing: 0.026 },
      { key: 'VA', sources: [{ src: 'deviceParam', device: 'Q', field: 'lambda' }], missing: 100 },
    ],
    rejects: circuitReject(['vsrc', 'res', 'npn', 'cap', 'gnd'], (graph) => {
      const q = graph.nodes.filter((node) => node.kind === 'npn').length;
      if (q !== 1) return `需要恰好一个晶体管 Q，现在有 ${q} 个：删掉多余的，或换用完整模型。`;
      return (
        atMostOne('RC', '输出端出现了两个集电极电阻 Rc，本题型不支持；换用拼接台完整模型或改题型')(graph) ??
        atMostOne('RL', '输出端出现了两个负载电阻 Rl：删掉一个，或改题型')(graph)
      );
    }),
  },
  A5: {
    family: 'circuit',
    whitelist: ['vsrc', 'res', 'nmos', 'gnd'],
    picks: [
      { key: 'config', sources: [{ src: 'meta' }], missing: 'CS' },
      { key: 'gm', sources: [{ src: 'deviceParam', device: 'M', field: 'gm' }, { src: 'deviceParam', device: 'Q', field: 'gm' }], required: true },
      { key: 'ro', sources: [{ src: 'deviceParam', device: 'M', field: 'ro' }, { src: 'deviceParam', device: 'Q', field: 'ro' }], required: true },
      { key: 'Rd', sources: [{ src: 'device', device: 'RD' }], required: true },
      { key: 'Rl', sources: [{ src: 'device', device: 'RL' }], missing: 1e12, rule: '未接负载 Rl：按空载处理（Rl→∞）' },
      { key: 'Rs', sources: [{ src: 'device', device: 'RS' }], required: true },
      { key: 'Rss', sources: [{ src: 'device', device: 'RSS' }, { src: 'meta' }], missing: 1000, rule: 'RSS 未画出：源极经旁路电容交流接地，Rss 用骨架默认值' },
    ],
    rejects: circuitReject(['vsrc', 'res', 'nmos', 'cap', 'gnd'], (graph) => {
      const m = graph.nodes.filter((node) => node.kind === 'nmos').length;
      if (m !== 1) return `需要恰好一个 NMOS M，现在有 ${m} 个：删掉多余的，或改题型。`;
      return atMostOne('RD', '漏极出现了两个电阻 Rd，本题型不支持；删掉一个或改题型')(graph);
    }),
  },
  A6: {
    family: 'circuit',
    whitelist: ['opamp', 'res', 'vsrc', 'gnd'],
    picks: [
      { key: 'topology', sources: [{ src: 'meta' }], missing: 'inverting' },
      { key: 'Aol', sources: [{ src: 'deviceParam', device: 'OPAMP', field: 'Aol' }], required: true },
      { key: 'R1', sources: [{ src: 'device', device: 'R1' }], required: true },
      { key: 'R2', sources: [{ src: 'device', device: 'R2' }], required: true },
      { key: 'Rin', sources: [{ src: 'deviceParam', device: 'OPAMP', field: 'Rin' }], missing: 1e7 },
      { key: 'Rout', sources: [{ src: 'deviceParam', device: 'OPAMP', field: 'Rout' }], missing: 50 },
      { key: 'Vin', sources: [{ src: 'device', device: 'VIN' }], required: true },
    ],
    rejects: circuitReject(['opamp', 'res', 'vsrc', 'gnd'], (graph) => {
      const amps = graph.nodes.filter((node) => node.kind === 'opamp').length;
      if (amps !== 1) return `需要恰好一个运放，现在有 ${amps} 个：本题型只支持单运放反相放大。`;
      return null;
    }),
  },
  A1: {
    family: 'circuit',
    whitelist: ['vsrc', 'res', 'diode', 'gnd'],
    picks: [
      { key: 'mode', sources: [{ src: 'meta' }], missing: 'series' },
      { key: 'Vs', sources: [{ src: 'device', device: 'VS' }, { src: 'device', device: 'SRC' }], required: true },
      { key: 'R', sources: [{ src: 'device', device: 'R' }], required: true },
      { key: 'Vf', sources: [{ src: 'deviceParam', device: 'D', field: 'Vf' }], required: true },
      { key: 'Vz', sources: [{ src: 'deviceParam', device: 'D', field: 'Vz' }, { src: 'meta' }], missing: 5.1, rule: '稳压值 Vz 未标在图上，用骨架默认值' },
      { key: 'Rz', sources: [{ src: 'deviceParam', device: 'D', field: 'Rz' }, { src: 'meta' }], missing: 10, rule: '稳压动态电阻 Rz 未标在图上，用骨架默认值' },
    ],
    rejects: circuitReject(['vsrc', 'res', 'diode', 'gnd']),
  },
  M3: {
    family: 'beam',
    element: 'beam',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'a', sources: [{ src: 'loadAt', type: 'point' }], required: true, unit: 'm' },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'q', sources: [{ src: 'load', type: 'udl' }], missing: 0 },
    ],
    rejects: [
      exactly(['pinSupport', 'rollerSupport'], '简支梁需要恰好一个固定铰 + 一个可动铰：支座配置不对（类型或个数），去装配台补回，或换 M3 悬臂 / 用顶部「范围」页走一遍判别。'),
      (graph) => {
        const points = findLoads(graph, 'point');
        if (points.length > 1) {
          return `图上有 ${points.length} 个集中力：本题型只支持跨内一个集中力（均布载荷可以叠加）；删掉多余载荷，或换题型。`;
        }
        const up = points.find((node) => node.rot === 180);
        return up ? '集中力箭头朝上：本题型按向下集中力建模，请把载荷改回向下，或换题型。' : null;
      },
    ],
  },
  'M3-cantilever': {
    family: 'beam',
    element: 'beam',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'a', sources: [{ src: 'loadAt', type: 'point' }], required: true, unit: 'm' },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'q', sources: [{ src: 'load', type: 'udl' }], missing: 0 },
    ],
    rejects: [
      exactly(['fixedSupport'], '悬臂梁需要恰好一个固定端：支座配置不对（类型或个数），去装配台补回，或换 M3 简支。'),
      (graph) => {
        const up = findLoads(graph, 'point').find((node) => node.rot === 180);
        return up ? '集中力箭头朝上：本题型按向下集中力建模，请把载荷改回向下，或换题型。' : null;
      },
    ],
  },
  S5: {
    family: 'beam',
    element: 'truss',
    picks: [
      { key: 'L', sources: [{ src: 'meta' }], required: true, unit: 'm' },
      { key: 'H', sources: [{ src: 'meta' }], required: true, unit: 'm' },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
    ],
    rejects: [
      exactly(['pinSupport', 'rollerSupport'], '三角桁架需要恰好一个固定铰 + 一个可动铰。'),
      (graph) => {
        const joints = graph.nodes.filter((node) => node.kind === 'dot').length;
        const members = graph.edges.filter((edge) => edge.kind === 'line' || edge.kind === 'trussMember').length;
        if (members !== 2 * joints - 3) {
          return `杆数 ${members}，节点 ${joints}：静定桁架需要 m = 2j−3 = ${2 * joints - 3}。${
            members < 2 * joints - 3
              ? '少一根构件，这个三角形闭合不了 —— 补一根（比如 A–C）或用「恢复骨架」回到原始结构。'
              : '多了一根构件，结构变成静不定 —— 删掉多余杆或用「恢复骨架」回到原始结构。'
          }`;
        }
        return null;
      },
    ],
  },

  /* ── W11：B 类 9 型（题面本身就是一个结构，不是编出来的几何） ──── */

  A2: {
    family: 'circuit',
    whitelist: ['res', 'npn', 'gnd', 'vsrc'],
    picks: [
      { key: 'Vcc', sources: [{ src: 'textValue', nodeId: 'n-vcc' }, { src: 'meta' }], required: true, unit: 'V' },
      { key: 'R1', sources: [{ src: 'device', device: 'R1' }], required: true },
      { key: 'R2', sources: [{ src: 'device', device: 'R2' }], required: true },
      { key: 'Rc', sources: [{ src: 'device', device: 'RC' }], required: true },
      { key: 'Re', sources: [{ src: 'device', device: 'RE' }], required: true },
      { key: 'beta', sources: [{ src: 'meta' }], required: true },
      { key: 'VBE', sources: [{ src: 'meta' }], required: true },
      { key: 'VCEsat', sources: [{ src: 'meta' }], required: true },
    ],
    rejects: circuitReject(['res', 'npn', 'gnd', 'vsrc'], (graph) => {
      const q = graph.nodes.filter((node) => node.kind === 'npn').length;
      if (q !== 1) return `分压偏置需要恰好一个 NPN 管 Q，现在有 ${q} 个：删掉多余的，或改题型。`;
      return requireDevices(
        ['R1', 'R2', 'RC', 'RE'],
        '分压偏置的四个电阻（R1 / R2 / Rc / Re）缺了一个：把器件加回来、点「恢复骨架」，或换 A3 小信号模型',
      )(graph);
    }),
  },
  A4: {
    family: 'circuit',
    whitelist: ['res', 'nmos', 'gnd', 'vsrc'],
    picks: [
      { key: 'Vdd', sources: [{ src: 'textValue', nodeId: 'n-vdd' }, { src: 'meta' }], required: true, unit: 'V' },
      { key: 'Rg1', sources: [{ src: 'device', device: 'RG1' }], required: true },
      { key: 'Rg2', sources: [{ src: 'device', device: 'RG2' }], required: true },
      { key: 'Rd', sources: [{ src: 'device', device: 'RD' }], required: true },
      { key: 'Rs', sources: [{ src: 'device', device: 'RS' }], required: true },
      { key: 'Vth', sources: [{ src: 'meta' }], required: true },
      { key: 'Kn', sources: [{ src: 'meta' }], required: true },
      { key: 'lambda', sources: [{ src: 'meta' }], required: true },
    ],
    rejects: circuitReject(['res', 'nmos', 'gnd', 'vsrc'], (graph) => {
      const m = graph.nodes.filter((node) => node.kind === 'nmos').length;
      if (m !== 1) return `NMOS 偏置需要恰好一个管子 M，现在有 ${m} 个：删掉多余的，或改题型。`;
      return requireDevices(
        ['RG1', 'RG2', 'RD', 'RS'],
        'NMOS 偏置的四个电阻（Rg1 / Rg2 / Rd / Rs）缺了一个：把器件加回来、点「恢复骨架」，或换 A5 小信号模型',
      )(graph);
    }),
  },
  A7: {
    family: 'circuit',
    whitelist: ['vsrc', 'res', 'sum', 'block', 'gnd'],
    picks: [
      // A 与 β 是框图的方块值，不是画布器件：按骨架级参数走 meta，不硬塞进器件。
      { key: 'A', sources: [{ src: 'meta' }], required: true },
      { key: 'beta', sources: [{ src: 'meta' }], required: true },
      { key: 'Rin', sources: [{ src: 'device', device: 'RIN' }], required: true },
      { key: 'Rout', sources: [{ src: 'device', device: 'ROUT' }], required: true },
      { key: 'Rl', sources: [{ src: 'device', device: 'RL' }], required: true },
    ],
    rejects: circuitReject(
      ['vsrc', 'res', 'sum', 'block', 'gnd'],
      requireDevices(
        ['RIN', 'ROUT', 'RL'],
        '反馈框图的三个可装配器件（Rin / Rout / Rl）缺了一个：把器件加回来、点「恢复骨架」，或回 A7 结果页改 A / β',
      ),
    ),
  },
  M1: {
    family: 'beam',
    element: 'bar',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'A', sources: [{ src: 'meta' }], required: true },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'E', sources: [{ src: 'meta' }], required: true },
      { key: 'allow', sources: [{ src: 'meta' }], required: true },
      { key: 'kind', sources: [{ src: 'meta' }], missing: 'bar' },
    ],
    rejects: [
      supportCount({ pinSupport: 1, rollerSupport: 1 }, '轴向拉杆需要一个固定铰 + 一个可动铰：支座配置不对（类型或个数），恢复骨架或改题型。'),
      mainSpan(['beam'], '轴向拉杆需要恰好一段主跨：删掉构件后结构不成立，补回这一段或点「恢复骨架」。'),
      pointLoads(1, '轴向拉杆只支持一个轴向集中力：多删少补都要先回到一个 P'),
    ],
  },
  M2: {
    family: 'beam',
    element: 'shaft',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'd', sources: [{ src: 'meta' }], required: true },
      { key: 'T', sources: [{ src: 'load', type: 'torque' }, { src: 'textValue', nodeId: 'n-moment-0' }, { src: 'meta' }], required: true, unit: 'kN·m' },
      { key: 'G', sources: [{ src: 'meta' }], required: true },
      { key: 'allow', sources: [{ src: 'meta' }], required: true },
      { key: 'kind', sources: [{ src: 'meta' }], missing: 'shaft' },
    ],
    rejects: [
      supportCount({ fixedSupport: 1 }, '圆轴扭转需要一个固定端：支座配置不对（类型或个数），恢复骨架或改题型。'),
      mainSpan(['shaft'], '圆轴扭转需要恰好一段轴：删掉轴段后结构不成立，补回这一段或点「恢复骨架」。'),
    ],
  },
  M4: {
    family: 'beam',
    element: 'beam',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'a', sources: [{ src: 'loadAt', type: 'point' }], required: true, unit: 'm' },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'b', sources: [{ src: 'meta' }], required: true },
      { key: 'h', sources: [{ src: 'meta' }], required: true },
      { key: 'allow', sources: [{ src: 'meta' }], required: true },
    ],
    rejects: [
      supportCount({ pinSupport: 1, rollerSupport: 1 }, '简支梁需要一个固定铰 + 一个可动铰：支座配置不对（类型或个数），恢复骨架或改题型。'),
      mainSpan(['beam'], '简支梁需要恰好一段主跨：删掉构件后结构不成立，补回这一段或点「恢复骨架」。'),
      pointLoads(1, '弯曲应力只支持跨内一个集中力：先删掉多余载荷或补回被删的那个'),
    ],
  },
  M5: {
    family: 'beam',
    element: 'beam',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'a', sources: [{ src: 'loadAt', type: 'point' }], required: true, unit: 'm' },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'b', sources: [{ src: 'meta' }], required: true },
      { key: 'h', sources: [{ src: 'meta' }], required: true },
      { key: 'E', sources: [{ src: 'meta' }], required: true },
    ],
    rejects: [
      supportCount({ pinSupport: 1, rollerSupport: 1 }, '简支梁需要一个固定铰 + 一个可动铰：支座配置不对（类型或个数），恢复骨架或改题型。'),
      mainSpan(['beam'], '简支梁需要恰好一段主跨：删掉构件后结构不成立，补回这一段或点「恢复骨架」。'),
      pointLoads(1, '挠度只支持跨内一个集中力：先删掉多余载荷或补回被删的那个'),
    ],
  },
  M7: {
    family: 'beam',
    element: 'bar',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'b', sources: [{ src: 'meta' }], required: true },
      { key: 'h', sources: [{ src: 'meta' }], required: true },
      { key: 'E', sources: [{ src: 'meta' }], required: true },
      { key: 'mu', sources: [{ src: 'meta' }], required: true },
      { key: 'P', sources: [{ src: 'load', type: 'point' }], required: true, unit: 'kN' },
      { key: 'sp', sources: [{ src: 'meta' }], required: true },
    ],
    rejects: [
      supportCount({ pinSupport: 2 }, '两端铰压杆需要两个固定铰（μ=1）：换支座后 μ 也要改，恢复骨架或改回两端铰。'),
      mainSpan(['beam'], '压杆需要恰好一段杆：删掉构件后没有长细比可算，补回这一段或点「恢复骨架」。'),
      pointLoads(1, '两端铰压杆只支持一个轴向压力 P：先删掉多余载荷或补回被删的那个'),
    ],
  },
  S3: {
    family: 'beam',
    picks: [
      { key: 'L', sources: [{ src: 'spanText' }, { src: 'meta' }], required: true, unit: 'm' },
      { key: 'x1', sources: [{ src: 'loadAt', type: 'point', index: 0 }], required: true, unit: 'm' },
      { key: 'P1', sources: [{ src: 'load', type: 'point', index: 0 }], required: true, unit: 'kN' },
      { key: 'x2', sources: [{ src: 'loadAt', type: 'point', index: 1 }], required: true, unit: 'm' },
      { key: 'P2', sources: [{ src: 'load', type: 'point', index: 1 }], required: true, unit: 'kN' },
    ],
    rejects: [
      supportCount({ pinSupport: 1, rollerSupport: 1 }, '简支梁需要一个固定铰 + 一个可动铰：支座配置不对（类型或个数），恢复骨架或改题型。'),
      mainSpan(['beam'], '简支梁需要恰好一段主跨：删掉构件后结构不成立，补回这一段或点「恢复骨架」。'),
      pointLoads(2, '平面任意力系这一型要两个集中力（P1 / P2）：删多了或加了第三个都要先回到两个'),
    ],
  },
};

import { SUPPORTED_IDS } from './ids.ts';

export { SUPPORTED_IDS };
/** 表与常量表不许漂移（check:lab 也会再钉一次）。 */
export const PICK_IDS = Object.keys(PICKS);

/* ── 种子：默认参数 → 器件数值 ───────────────────────────────────── */

export interface SeedOutput {
  seeds: Record<string, { value?: number; params?: Record<string, number> }>;
  meta: Record<string, number | string>;
}

/** ① 载入骨架：把参数种到器件上（骨架不改 = 这些值 = parsed_given）。 */
export function seedGraph(templateId: string, values: Record<string, ParamValue>): SeedOutput {
  const picks = PICKS[templateId];
  const out: SeedOutput = { seeds: {}, meta: {} };
  if (!picks) return out;
  for (const pick of picks.picks) {
    const raw = values[pick.key];
    const value = typeof raw === 'number' ? raw : undefined;
    if (typeof raw === 'string') {
      out.meta[pick.key] = raw;
    }
    if (value === undefined) continue;
    for (const source of pick.sources) {
      if (source.src === 'device') {
        out.seeds[source.device.toUpperCase()] = { ...out.seeds[source.device.toUpperCase()], value };
        break;
      }
      if (source.src === 'deviceParam') {
        const key = source.device.toUpperCase();
        out.seeds[key] = { ...out.seeds[key], params: { ...(out.seeds[key]?.params ?? {}), [source.field]: value } };
        break;
      }
      if (source.src === 'load') {
        const index = source.index ?? 0;
        out.seeds[`LOAD-${index}`] = { ...out.seeds[`LOAD-${index}`], value };
        // 链条后面还有 meta / 标注文字来源时不在这里 break：同一个值再种进 meta，
        // 严格模型入口（BeamModel / Netlist 不带文字图元）才有兜底。
        // 例：M2 的 T 首源是扭矩载荷，骨架里只有「T = 1」那行标注 → 只种 LOAD-0 会让
        // reduceBeam 读不到 T。
        const alsoInMeta = pick.sources.some(
          (other) => other.src === 'meta' || other.src === 'spanText' || other.src === 'textValue',
        );
        if (!alsoInMeta) break;
        continue;
      }
      if (source.src === 'meta' || source.src === 'spanText' || source.src === 'textValue') {
        // 骨架级参数 / 标注文字的数值都种进 meta：严格模型（Netlist / BeamModel）
        // 不带 text 图元，靠同一份 meta 兜底，两种归约入口才不会漂移。
        out.meta[pick.key] = value;
        break;
      }
    }
  }
  return out;
}

/** W21-B B5：画布标签的数字部分与左栏 / 右栏同一个格式器，不再各写一份 fmt。 */
function fmt(value: number): string {
  return formatCompact(value);
}

/**
 * S5：L/H 是 meta 参数，但图内通用求解按坐标几何走。只写 meta 会让
 * 「按图现算」继续用旧矢高，和讲解稿的 H 打架。这里把 C 点（以及挂在
 * C 上的载荷）按 H/L 比例同步到画布，并重算三根杆的轴力标签。
 * 画布只示意比例：A 固定、B/C 按比例缩放，始终留在原可视区内。
 */
function syncS5Geometry(graph: CanvasGraph, moveGeometry: boolean): void {
  const A = graph.nodes.find((node) => node.id === 'n-A');
  const B = graph.nodes.find((node) => node.id === 'n-B');
  const C = graph.nodes.find((node) => node.id === 'n-C');
  const L = Number(graph.meta.L);
  const H = Number(graph.meta.H);
  if (!A || !B || !C || !(L > 0) || !(H > 0)) return;
  if (moveGeometry) {
    const ratio = H / L;
    const maxHeight = Math.max(80, A.y - 40);
    const baseSpan = Math.max(80, B.x - A.x);
    const span = Math.min(baseSpan, maxHeight / ratio);
    const oldCx = C.x;
    const oldCy = C.y;
    B.x = A.x + span;
    C.x = A.x + span / 2;
    C.y = A.y - span * ratio;
    for (const node of graph.nodes) {
      if (node.kind !== 'arrow' || node === C) continue;
      if (Math.hypot(node.x - oldCx, node.y - oldCy) > 12) continue;
      node.x += C.x - oldCx;
      node.y += C.y - oldCy;
    }
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (a && b) edge.points = [[a.x, a.y], [b.x, b.y]];
  }
  const load = graph.nodes.find((node) => node.kind === 'arrow');
  const P = Math.max(0, Number(load?.value ?? graph.meta.P ?? 10));
  if (!(P > 0)) return;
  const analysis = analyzeTruss({
    nodes: [
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: L, y: 0 },
      { id: 'C', x: L / 2, y: H },
    ],
    members: [
      { id: 'AB', a: 'A', b: 'B' },
      { id: 'AC', a: 'A', b: 'C' },
      { id: 'BC', a: 'B', b: 'C' },
    ],
    supports: [
      { at: 'A', kind: 'pin' },
      { at: 'B', kind: 'roller' },
    ],
    loads: [{ at: 'C', F: [0, -P] }],
  });
  if (!analysis.ok) return;
  for (const edge of graph.edges) {
    const member = edge.id.replace(/^e-/, '');
    if (!['AB', 'AC', 'BC'].includes(member)) continue;
    const force = analysis.forces[member] ?? 0;
    const label = Math.abs(force) < 1e-9 ? '零杆' : force > 0 ? '拉' : '压';
    edge.tag = `${member}: ${force >= 0 ? '+' : ''}${force.toFixed(3)} kN（${label}）`;
  }
}

/** ③ 参数表 → 图：挪载荷位置、改器件值、刷新标签。返回新图（不动原骨架）。 */
export function applyParams(templateId: string, graph: CanvasGraph, values: Record<string, ParamValue>): CanvasGraph {
  return applyParamsWithReport(templateId, graph, values).graph;
}

/** 同上，但回报「实际写进图的键」。写入目标不在画布上（例：q —— 图上没有均布
 *  载荷）的键不算写进：ops 的改动台账据此不再宣称假的「已写回图」。 */
export function applyParamsWithReport(
  templateId: string,
  graph: CanvasGraph,
  values: Record<string, ParamValue>,
): { graph: CanvasGraph; written: string[] } {
  const picks = PICKS[templateId];
  const nodes = graph.nodes.map((node) => ({ ...node, ...(node.params ? { params: { ...node.params } } : {}) }));
  const next: CanvasGraph = { ...graph, nodes, meta: { ...graph.meta } };
  const written: string[] = [];
  if (!picks) return { graph: next, written };
  const oldL = graph.meta.L;
  const oldH = graph.meta.H;

  const L = Number(values.L ?? 0);
  const member = graph.edges.find((edge) => ['beam', 'shaft', 'line', 'trussMember'].includes(edge.kind));
  const aNode = member ? nodes.find((n) => n.id === member.from) : undefined;
  const bNode = member ? nodes.find((n) => n.id === member.to) : undefined;

  for (const pick of picks.picks) {
    const raw = values[pick.key];
    if (raw === undefined || Array.isArray(raw)) continue;
    const value: number | string = raw;
    if (typeof value === 'string') {
      next.meta[pick.key] = value;
      written.push(pick.key);
      continue;
    }
    for (const source of pick.sources) {
      if (source.src === 'device' || source.src === 'deviceParam') {
        const device = findDevice(next, source.device);
        /* A3/A5 的 gm / ro 有 M、Q 两个备选器件（sources.length === 2）。
           旧条件写死「只有单源才写」，多源参数被静默丢掉 —— 参数表改了 gm，
           图里没变、求解仍是旧值。多源时找到谁写谁，找不到再试下一个备选。 */
        if (!device && pick.sources.length > 1) continue;
        if (device) {
          written.push(pick.key);
          if (source.src === 'device') {
            device.value = value;
            /* 只换数值，名字照旧：以前写 `${pick.key} …`，于是 A3 的晶体管
               被改名成「VA 100」（pick.key 是参数键，不是器件名），锚点变成
               「VA 基极 b」，还会跟着 ?g= / 导出 / 收藏一起固化。 */
            device.label = `${deviceName(device.label, device.kind)} ${fmt(value)}`;
          } else {
            device.params = { ...(device.params ?? {}), [source.field]: value };
            /* 参数（β / λ / Vth / Kn）不是器件的主数值：**不动 label**。
               主数值由 device.value 那一行走 rewriteLabel，标注里再塞参数名
               只会把「Q」改成「beta 120」。 */
          }
        }
        break;
      }
      if (source.src === 'load') {
        const load = findLoads(next, source.type)[source.index ?? 0];
        if (load) {
          load.value = value;
          load.label = `${pick.key} = ${Number(value.toPrecision(5))}${pick.unit ? ` ${pick.unit}` : ''}`;
          written.push(pick.key);
        }
        break;
      }
      if (source.src === 'loadAt') {
        const load = findLoads(next, source.type)[source.index ?? 0];
        if (load && aNode && bNode && L > 0) {
          load.x = aNode.x + (value / L) * (bNode.x - aNode.x);
          written.push(pick.key);
        }
        break;
      }
      if (source.src === 'spanText') {
        const text = next.nodes.find((node) => node.kind === 'text' && /^L\s*=/.test(node.label ?? ''));
        if (text) {
          text.label = `L = ${Number(value.toPrecision(5))} m`;
        }
        // 没有标注文字时 meta 就是这张图的跨长来源；它确实写进了图，台账要如实记。
        next.meta[pick.key] = value;
        written.push(pick.key);
        break;
      }
      if (source.src === 'textValue' || source.src === 'meta') {
        if (source.src === 'textValue') {
          const text = next.nodes.find((node) => node.id === source.nodeId && node.kind === 'text');
          if (text?.label) text.label = text.label.replace(NUMBER_IN_LABEL, `${Number(value.toPrecision(6))}`);
        }
        next.meta[pick.key] = value;
        written.push(pick.key);
        break;
      }
    }
  }
  if (templateId === 'S5') {
    const geometryChanged = Number(oldL) !== Number(next.meta.L) || Number(oldH) !== Number(next.meta.H);
    syncS5Geometry(next, geometryChanged);
  }
  return { graph: next, written };
}
