/**
 * 整图微变等效（单管最小版）：把「这张图」按小信号规则重画一遍。
 *
 * 与 `equivalent.ts` 的分工写清楚，免得以后混：
 *  - `equivalent.ts` 给的是**端口等效**（戴维南 Vth + Rth，任意线性网严格成立）
 *    与**器件级 π**（只把那一只管子的模型画出来，不碰其它图元）。
 *  - 这里给的是**整图重画**：直流电压源交流置地、旁路/耦合电容短路、管子换成
 *    rπ / gm·vbe / ro，**其余图元保留原坐标**，因此导线怎么连、信号怎么流，
 *    一眼就能和原图对上。
 *
 * 三条硬约束（都是为了「不画假图」）：
 *  1. 只展开**单管**图。多管需要逐级重排版面，不是坐标平移能解决的，直接拒绝并说明。
 *  2. 端口锚点必须与器件引脚**逐位重合**：bsk 的导线端点就落在 b/c/e 上，
 *     锚点一挪，整张图立刻断线。所以三件套是「以原引脚为端点」长出来的。
 *  3. 坐标只做**整体平移**（右侧让出 190px 给三件套），不做旋转/缩放/重排；
 *     平移保持正交布线，点怎么连还是怎么连。
 *
 * 数值口径与通用求解器一致：gm = Ic/Vt、rπ = β/gm、ro = VA/Ic（MOS 直接读 gm/ro）。
 */

import { pinAt } from '../../render/symbols.ts';
import type { RenderSpec } from '../types.ts';
import type { CanvasGraph, CanvasNode } from './types.ts';
import { fmtAmp as amps, fmtOhm as ohms } from './equivalent.ts';

/** 与 netSolve 同一档热电压。 */
const VT = 0.026;
/** 右侧图元让出的宽度：三件套从 c/e 引脚向右要长到 ~145px。 */
const SHIFT = 190;
/** 元件自身半高（res/ctrlsrc 的引脚都在 ±44）。 */
const HALF = 44;

export interface AcTransform {
  deviceId: string;
  deviceLabel: string;
  kind: 'npn' | 'nmos';
  /** 图上标注用的器件参数（与卡片里的行同源）。 */
  rows: { label: string; value: string }[];
  spec: RenderSpec;
  /** 逐条「改了什么」，可核对，不是话术。 */
  actions: string[];
  notes: string[];
}

export type AcEquivalentResult =
  | { available: true; model: AcTransform }
  | { available: false; reason: string };

type Pt = [number, number];

interface Draft {
  nodes: RenderSpec['nodes'];
  edges: RenderSpec['edges'];
}

function part(
  draft: Draft,
  id: string,
  kind: string,
  at: Pt,
  label: string,
  labelSide: RenderSpec['nodes'][number]['labelSide'],
  rot = 0,
): void {
  draft.nodes.push({ id, x: at[0], y: at[1], kind, label, labelSide, ...(rot ? { rot } : {}) });
}

function text(
  draft: Draft,
  id: string,
  at: Pt,
  label: string,
  labelSide: RenderSpec['nodes'][number]['labelSide'] = 'up',
): void {
  draft.nodes.push({ id, x: at[0], y: at[1], kind: 'text', label, labelSide });
}

function dot(draft: Draft, id: string, at: Pt): void {
  draft.nodes.push({ id, x: at[0], y: at[1], kind: 'dot', label: '' });
}

function wire(draft: Draft, id: string, pts: Pt[], extra: { dashed?: boolean; tag?: string; weight?: 1 | 2 } = {}): void {
  draft.edges.push({
    id,
    from: pts[0].join(','),
    to: pts[pts.length - 1].join(','),
    kind: 'wire',
    points: pts,
    ...extra,
  });
}

function outputParts(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return String(Number(value.toPrecision(5)));
}

function siemens(value: number): string {
  if (!Number.isFinite(value)) return '— S';
  return `${outputParts(value * 1e3)} mS`;
}

/** 供电轨：语义标了 supply，或标签就是 Vcc/VDD 那一类。信号源（Vs / vi）不算。 */
function isSupplySource(node: CanvasNode): boolean {
  if (node.kind !== 'vsrc') return false;
  if (node.semantic === 'supply') return true;
  return /^(vcc|vdd|vss|vee|v\+|v-|vin_?supply)/i.test((node.label ?? '').trim());
}

/** 该管能不能线性化：给不出 gm/ro 就明确拒绝，不拿假数凑。 */
function deviceModel(node: CanvasNode):
  | { kind: 'npn'; gm: number; rpi: number; ro: number; ic: number }
  | { kind: 'nmos'; gm: number; ro: number }
  | { reason: string } {
  if (node.kind === 'npn') {
    const ic = Number(node.value);
    const beta = Number(node.params?.beta);
    const va = Number(node.params?.lambda ?? node.params?.VA);
    if (!Number.isFinite(ic) || ic <= 0) return { reason: `「${node.label || node.id}」的集电极电流 Ic 缺失或 ≤ 0，给不出 gm` };
    if (!Number.isFinite(beta) || beta <= 0) return { reason: `「${node.label || node.id}」的 β 缺失或 ≤ 0，给不出 rπ` };
    if (!Number.isFinite(va) || va <= 0) return { reason: `「${node.label || node.id}」的 Early 电压 VA 缺失或 ≤ 0，给不出 ro` };
    const gm = ic / VT;
    return { kind: 'npn', gm, rpi: beta / gm, ro: va / ic, ic };
  }
  const gm = Number(node.params?.gm);
  const ro = Number(node.params?.ro);
  if (!Number.isFinite(gm) || gm <= 0) return { reason: `「${node.label || node.id}」的 gm 缺失或 ≤ 0` };
  if (!Number.isFinite(ro) || ro <= 0) return { reason: `「${node.label || node.id}」的 ro 缺失或 ≤ 0` };
  return { kind: 'nmos', gm, ro };
}

/** 最小版不展开的器件：宁可拒绝，也不画一张少了几根线的「等效图」。 */
const UNSUPPORTED: Record<string, string> = {
  pmos: 'P 沟道 MOS',
  diode: '二极管',
  zener: '稳压管',
  opamp: '运放',
  isrc: '独立电流源（交流置开路会改变回路，先手工删掉再展开）',
  block: '增益方框',
  sum: '求和圆',
};

function findUnsupported(graph: CanvasGraph): string | null {
  for (const node of graph.nodes) {
    const label = UNSUPPORTED[node.kind];
    if (label) return `图里有${label}（${node.label || node.id}），最小版只展开「电阻 + 独立电压源 + 电容 + 单管」`;
  }
  return null;
}

/** 三件套的几何：以原引脚为锚点，向右长出来。 */
function buildPiBlock(
  draft: Draft,
  device: CanvasNode,
  model: { kind: 'npn' | 'nmos'; gm: number; ro: number; rpi?: number },
): { rect: { x0: number; y0: number; x1: number; y1: number }; anchors: Record<string, Pt> } {
  const rot = device.rot ?? 0;
  const at: Pt = [device.x, device.y];
  const isBjt = model.kind === 'npn';
  const leftId = isBjt ? 'b' : 'g';
  const topId = isBjt ? 'c' : 'd';
  const botId = isBjt ? 'e' : 's';
  const L = pinAt(device.kind, at, rot, leftId);
  const T = pinAt(device.kind, at, rot, topId);
  const B = pinAt(device.kind, at, rot, botId);
  const cy = (T[1] + B[1]) / 2;
  const railTop = cy - HALF;
  const railBottom = cy + HALF;

  const rpiX = L[0] + 30;
  const gmX = T[0] + 66;
  const roX = T[0] + 156;

  const id = (suffix: string) => `ac-${device.id}-${suffix}`;

  // 三件套：rπ（只有 BJT 有）、gm·vbe、ro。全部竖放，引脚正好落在 ±44 的两条母线上。
  if (isBjt && model.rpi !== undefined) {
    part(draft, id('rpi'), 'res', [rpiX, cy], '', 'up', 90);
  }
  part(draft, id('gm'), 'ctrlsrc', [gmX, cy], '', 'up');
  part(draft, id('ro'), 'res', [roX, cy], '', 'up', 90);

  // 标名单独排一行，不走 labelSide：默认 up 会落到 -60，正好撞上原图的集电极母线（实测 y=164）。
  // 紧贴母线上方 26px 是唯一「母线之上、元件之上、又压不到别的线」的一带。
  if (isBjt && model.rpi !== undefined) text(draft, id('t-rpi'), [rpiX, railTop - 26], 'rπ');
  text(draft, id('t-gm'), [gmX, railTop - 26], `gm·${isBjt ? 'vbe' : 'vgs'}`);
  text(draft, id('t-ro'), [roX, railTop - 26], 'ro');

  // 上下母线：从器件引脚出发向右延伸。BJT 的 c/e 恰在 ±44，母线就是引脚高度；
  // MOS 的 d/s 在 ±50，先补 6px 短桩再拉母线（母线必须落在元件引脚上，否则导线接不上）。
  const topStart: Pt = Math.abs(T[1] - railTop) > 0.5 ? [T[0], railTop] : T;
  const botStart: Pt = Math.abs(B[1] - railBottom) > 0.5 ? [B[0], railBottom] : B;
  if (topStart !== T) wire(draft, id('stub-top'), [T, topStart]);
  if (botStart !== B) wire(draft, id('stub-bottom'), [B, botStart]);
  wire(draft, id('rail-top'), [topStart, [roX, railTop]], { weight: 2 });
  wire(draft, id('rail-bottom'), [botStart, [roX, railBottom]], { weight: 2 });

  // 基极：从 b 引脚竖直抬到母线高度，再横到 rπ 顶端。rπ 顶 = 底 = 母线。
  // 控制量 vbe 标在**竖直段**上：横段只有 30px，标签会把 rπ 的标注挤到一块。
  if (isBjt) {
    wire(draft, id('base-lead'), [L, [L[0], railTop]], { tag: 'vbe' });
    wire(draft, id('base-branch'), [[L[0], railTop], [rpiX, railTop]]);
  } else {
    // MOS 栅极不取电流：只画控制量虚线，不接入回路。
    wire(draft, id('gate-lead'), [L, [gmX - 34, cy]], { dashed: true, tag: 'vgs' });
  }

  // 母线接点：gm 的上下端落在母线上，标一个实心点，读图时能看清是「并联」不是「穿过」。
  dot(draft, id('d-gm-top'), [gmX, railTop]);
  dot(draft, id('d-gm-bottom'), [gmX, railBottom]);
  if (Math.abs(T[0] - roX) > 1) dot(draft, id('d-top-branch'), [T[0], railTop]);

  return {
    rect: { x0: L[0] - 8, y0: railTop - 22, x1: roX + 14, y1: railBottom + 10 },
    anchors: { left: L, top: T, bottom: B },
  };
}

/**
 * 主入口：给这张图，返回重画后的微变等效图；给不出来就如实说原因。
 */
export function deriveAcEquivalent(graph: CanvasGraph): AcEquivalentResult {
  if (graph.family !== 'circuit') return { available: false, reason: '这张图不是电路（力学图没有微变等效）' };

  const devices = graph.nodes.filter((node) => node.kind === 'npn' || node.kind === 'nmos' || node.kind === 'pmos');
  if (devices.length === 0) return { available: false, reason: '这张图里没有晶体管，没有可展开的器件' };
  if (devices.length > 1) {
    return {
      available: false,
      reason: `最小版只展开单管：这张图有 ${devices.length} 个晶体管（${devices.map((d) => d.label || d.id).join('、')}），多管需要逐级重排版面`,
    };
  }
  const device = devices[0];
  if (device.kind === 'pmos') return { available: false, reason: 'P 沟道 MOS 的微变模型还没登记，最小版只展开 npn / nmos' };

  const unsupported = findUnsupported(graph);
  if (unsupported) return { available: false, reason: unsupported };

  const model = deviceModel(device);
  if ('reason' in model) return { available: false, reason: model.reason };

  const rot = device.rot ?? 0;
  const isBjt = model.kind === 'npn';
  const T = pinAt(device.kind, [device.x, device.y], rot, isBjt ? 'c' : 'd');
  const B = pinAt(device.kind, [device.x, device.y], rot, isBjt ? 'e' : 's');
  const boundary = Math.max(T[0], B[0]);
  const shiftX = (x: number) => (x > boundary + 0.5 ? x + SHIFT : x);
  const actions: string[] = [];
  const notes: string[] = [];
  const draft: Draft = { nodes: [], edges: [] };

  if (isBjt) {
    actions.push(
      `${device.label || device.id}（npn）→ rπ / gm·vbe / ro`,
    );
  } else {
    actions.push(`${device.label || device.id}（nmos）→ gm·vgs / ro`);
  }

  // ── 图元：保留原坐标（右侧整体右移），电容短路、供电置地 ──
  let shifted = 0;
  for (const node of graph.nodes) {
    if (node === device) continue;
    const x = shiftX(node.x);
    if (x !== node.x) shifted += 1;

    if (node.kind === 'cap') {
      // 交流下电容是短路：符号换成一段导线，两端仍在原引脚。
      const a = pinAt('cap', [node.x, node.y], node.rot ?? 0, 'a');
      const b = pinAt('cap', [node.x, node.y], node.rot ?? 0, 'b');
      wire(draft, `ac-${node.id}-short`, [a, b], { weight: 1 });
      text(draft, `ac-${node.id}-t`, [node.x, node.y - 22], `${node.label || 'C'} 短路`);
      actions.push(`${node.label || node.id}（电容）→ 交流短路（两端导线直连）`);
      continue;
    }

    if (isSupplySource(node)) {
      // 直流电压源：交流置地 = 两端并为同一个交流节点。
      const p = pinAt('vsrc', [node.x, node.y], node.rot ?? 0, 'p');
      const n = pinAt('vsrc', [node.x, node.y], node.rot ?? 0, 'n');
      wire(draft, `ac-${node.id}-short`, [p, n], { weight: 1 });
      text(draft, `ac-${node.id}-t`, [node.x, node.y - 4], `${node.label || 'Vcc'} 交流置地`);
      actions.push(`${node.label || node.id}（直流供电）→ 交流置地（两端短路）`);
      continue;
    }

    draft.nodes.push({ ...node, x });
  }

  if (shifted > 0) {
    actions.push(`右侧 ${shifted} 个图元右移 ${SHIFT}px`);
  }

  // ── 导线：逐点平移（正交布线在水平平移下保持正交） ──
  for (const edge of graph.edges) {
    const points = (edge.points ?? []).map((p) => [shiftX(p[0]), p[1]] as Pt);
    const next = { ...edge, points: points.length >= 2 ? points : edge.points };
    if (points.length >= 2) {
      next.from = `${points[0][0]},${points[0][1]}`;
      next.to = `${points[points.length - 1][0]},${points[points.length - 1][1]}`;
    }
    draft.edges.push(next);
  }

  // ── 三件套 ──
  const pi = buildPiBlock(draft, device, model);
  // 让出的空间如果仍被图元占住，如实说出来（不静默重叠）。
  const intruders = draft.nodes.filter(
    (node) =>
      !node.id.startsWith('ac-') &&
      !['dot', 'text', 'pin', 'gnd'].includes(node.kind) &&
      node.x > pi.rect.x0 - 30 &&
      node.x < pi.rect.x1 &&
      node.y > pi.rect.y0 &&
      node.y < pi.rect.y1,
  );
  for (const node of intruders) {
    notes.push(`「${node.label || node.id}」落在 π 区内部，标签可能重叠 —— 挪开或删掉后重试。`);
  }

  const rows = [
    ...(model.kind === 'npn' && model.rpi !== undefined ? [{ label: 'rπ（β/gm）', value: ohms(model.rpi) }] : []),
    { label: 'gm', value: siemens(model.gm) },
    { label: 'ro', value: ohms(model.ro) },
    ...(model.kind === 'npn' ? [{ label: 'Ic（用于 gm）', value: amps(model.ic) }] : []),
  ];

  notes.unshift(
    `变换规则：直流独立电压源 → 交流置地；电容 → 短路；晶体管 → π 三件套；电阻 / 信号源原位不动。`,
  );
  notes.push(
    model.kind === 'npn'
      ? `gm = Ic/26mV，rπ = β/gm，ro = VA/Ic。`
      : `gm / ro 取该管参数表；栅极不取电流，vgs 是控制量。`,
  );

  return {
    available: true,
    model: {
      deviceId: device.id,
      deviceLabel: device.label || device.id,
      kind: model.kind,
      rows,
      spec: {
        id: `ac-equiv-${device.id}`,
        role: 'secondary',
        derivedFrom: 'main',
        type: 'schematic',
        nodes: draft.nodes,
        edges: draft.edges,
        frames: [],
      },
      actions,
      notes,
    },
  };
}

/** 卡片标题用：一句话说清这张图跟原图什么关系。 */
export function acEquivalentSummary(model: AcTransform): string {
  return `${model.deviceLabel} 展开为 π · 其余图元原位（右侧让 ${SHIFT}px）`;
}
