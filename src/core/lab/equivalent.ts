/**
 * W23 自建电路「自动等效电路」：不套题库讲解稿，从这张图现算。
 *
 * 题库的 π 图 / 戴维南图是模板预置的 render_specs（derivedFrom: main），
 * 骨架改过之后再挂上是假图 —— 所以通用求解以前只给原图。这里补的是另一条
 * 真路子：**端口等效**。对任意线性电路，从某个电气点看进去都严格等价于
 * 「Vth 电压源 + 串联 Rth」；两者由同一份 MNA 用 ±1A 测试电流解出：
 *
 *   V(I) = Vth − I·Rth   ⇒   Rth = [V(−1A) − V(+1A)] / 2
 *
 * 测试源直接 stamp 进 netSolve 的元件表（不是另写一套方程），因此 Vth / Rth
 * 与结果页的数值同源；两种 mode 都试一遍，取与当前解最自洽的那一个，残差
 * 如实报出来。受控源 / 运放 / 二极管线性化模型都是线性的，结论照样成立，
 * 只是 Rth 可能为负（负阻）—— 如实显示，不擅自取绝对值。
 *
 * 另外，图里若有晶体管，再给一张「器件级 π 小信号模型」：数值用与 netSolve
 * 同一套公式（gm=Ic/Vt、rπ=β/gm、ro=VA/Ic；MOS 直接读 gm/ro），并把三件套
 * 画出来。它是器件模型，不是「整图重画成 π 等效电路」—— 卡片里会写明。
 */

import { pinAt } from '../../render/symbols.ts';
import type { RenderSpec } from '../types.ts';
import { netSolve, buildNets, type CircuitSolution } from './netSolve.ts';
import { netSolveOptionsFor } from './resolve.ts';
import type { CanvasGraph } from './types.ts';

/** 与 netSolve 的 vt 默认值同一档（热电压 26 mV）。 */
const VT = 0.026;
/** 一次最多给几个端口做等效，避免大图把结果区堆满。 */
const MAX_PORTS = 6;
/** 小信号模型最多画几个器件。 */
const MAX_SMALL_SIGNAL = 3;

export interface EquivalentPort {
  /** 网名（netSolve 的并查集代表名）。 */
  net: string;
  /** 端口的人话名字：tag → tag；否则列所连引脚。 */
  label: string;
  pinKeys: string[];
  /** 开路电压（直接取当前解，与结果表逐位一致）。 */
  vth: number;
  /** 等效内阻（Ω，可为负）。 */
  rth: number;
  /** 诺顿电流 = Vth / Rth；Rth≈0 时为 null（理想电压源无诺顿等效）。 */
  inorton: number | null;
  /** 与当前解自洽的求解口径。 */
  mode: 'dc' | 'ac';
  /** |(V(+1)+V(−1))/2 − Vth|：线性/口径自检残差。 */
  linearResidual: number;
  /** 戴维南等效电路图（可渲染的 RenderSpec）。 */
  spec: RenderSpec;
  notes: string[];
}

export interface SmallSignalModel {
  deviceId: string;
  kind: 'npn' | 'nmos';
  title: string;
  rows: { label: string; value: string }[];
  spec: RenderSpec;
}

export interface CircuitEquivalent {
  ports: EquivalentPort[];
  smallSignal: SmallSignalModel[];
  notes: string[];
}

/* ── 数值排版 ─────────────────────────────────────────────────── */

function num(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const a = Math.abs(value);
  if (a >= 1e6 || a < 1e-3) return value.toExponential(3);
  return String(Number(value.toPrecision(5)));
}

function ohms(value: number): string {
  if (!Number.isFinite(value)) return '— Ω';
  const a = Math.abs(value);
  if (a >= 1e6) return `${num(value / 1e6)} MΩ`;
  if (a >= 1e3) return `${num(value / 1e3)} kΩ`;
  return `${num(value)} Ω`;
}

function amps(value: number): string {
  if (!Number.isFinite(value)) return '— A';
  const a = Math.abs(value);
  if (a !== 0 && a < 0.1) return `${num(value * 1e3)} mA`;
  if (a !== 0 && a < 1e-4) return `${num(value * 1e6)} µA`;
  return `${num(value)} A`;
}

function siemens(value: number): string {
  if (!Number.isFinite(value)) return '— S';
  return `${num(value * 1e3)} mS`;
}

/** 结果卡复用同一套单位排版，避免图上写 500 Ω、表里写 0.5k 这种两套口径。 */
export const fmtVolt = (value: number): string => `${num(value)} V`;
export const fmtOhm = ohms;
export const fmtAmp = amps;

/* ── 小工具：RenderSpec 积木（不依赖 render/templates，避免把讲解稿拖进通用路径） ── */

type Pt = [number, number];

interface Draft {
  nodes: RenderSpec['nodes'];
  edges: RenderSpec['edges'];
}

function part(draft: Draft, id: string, kind: string, at: Pt, label: string, labelSide: RenderSpec['nodes'][number]['labelSide'], rot = 0): void {
  draft.nodes.push({ id, x: at[0], y: at[1], kind, label, labelSide, ...(rot ? { rot } : {}) });
}

function text(draft: Draft, id: string, at: Pt, label: string, labelSide: RenderSpec['nodes'][number]['labelSide'] = 'up'): void {
  draft.nodes.push({ id, x: at[0], y: at[1], kind: 'text', label, labelSide });
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

function finish(draft: Draft, id: string): RenderSpec {
  return { id, role: 'secondary', derivedFrom: 'main', type: 'schematic', nodes: draft.nodes, edges: draft.edges, frames: [] };
}

/* ── 端口选择 ─────────────────────────────────────────────────── */

interface PortCandidate {
  net: string;
  pinKeys: string[];
  label: string;
  score: number;
}

function portCandidates(graph: CanvasGraph, solution: CircuitSolution): PortCandidate[] {
  const byNet = new Map<string, string[]>();
  for (const [pinKey, net] of Object.entries(solution.netOfPin)) {
    if (!net) continue;
    const list = byNet.get(net) ?? [];
    list.push(pinKey);
    byNet.set(net, list);
  }

  const groundNets = new Set<string>(['GND']);
  for (const node of graph.nodes) {
    if (node.kind !== 'gnd') continue;
    const net = solution.netOfPin[`${node.id}:t`];
    if (net) groundNets.add(net);
  }
  // 独立源 / 运放输出所在的网是「驱动端」，做输出端口的意义不如无源结点。
  const sourceNets = new Set<string>();
  for (const node of graph.nodes) {
    if (!['vsrc', 'isrc', 'opamp'].includes(node.kind)) continue;
    for (const [pinKey, net] of Object.entries(solution.netOfPin)) {
      if (pinKey.startsWith(`${node.id}:`)) sourceNets.add(net);
    }
  }
  // 画布上打了 tag（Vo / Vi…）的导线端点所在网，最像人想看的那个端口。
  const tagNets = new Map<string, string>();
  const built = buildNets(graph);
  for (const edge of graph.edges) {
    if (!edge.tag) continue;
    // 边的端点可能是 `n-r1:b`，也可能是绝对坐标串 `144,56`；两种都要认。
    const fromPoint = built.netOfPoint.get(`${edge.id}#0`);
    if (fromPoint) tagNets.set(fromPoint, edge.tag);
    for (const end of [edge.from, edge.to]) {
      const net = solution.netOfPin[end];
      if (net) tagNets.set(net, edge.tag);
    }
  }

  const shortPin = (pinKey: string) => {
    const [id, pin] = pinKey.split(':');
    const node = graph.nodes.find((item) => item.id === id);
    return `${node?.label || id}:${pin ?? ''}`;
  };
  const candidates: PortCandidate[] = [];
  for (const [net, pinKeys] of byNet) {
    if (groundNets.has(net)) continue;
    // 只连 gnd / 装饰图元的网不是端口。
    const real = pinKeys.filter((key) => {
      const id = key.split(':')[0];
      const node = graph.nodes.find((item) => item.id === id);
      return node && !['gnd', 'dot', 'text', 'pin'].includes(node.kind);
    });
    if (real.length === 0) continue;
    const tag = tagNets.get(net);
    const voltage = Math.abs(solution.nodeVoltages[net] ?? 0);
    const score =
      (tag ? 100 : 0) +
      (sourceNets.has(net) ? 0 : 20) +
      (pinKeys.length >= 2 ? 8 : 0) +
      (voltage > 1e-9 ? 2 : 0) +
      Math.min(real.length, 6) * 0.1;
    const label = tag ? `${tag}（画布标注）` : real.slice(0, 2).map(shortPin).join(' · ');
    candidates.push({ net, pinKeys, label, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.net.localeCompare(b.net));
  return candidates.slice(0, MAX_PORTS);
}

/* ── 单个端口的等效参数 ───────────────────────────────────────── */

interface PortSolve {
  mode: 'dc' | 'ac';
  rth: number;
  center: number;
  residual: number;
}

function solvePort(graph: CanvasGraph, net: string, vth: number): { best: PortSolve | null; reason: string } {
  const { options } = netSolveOptionsFor(graph);
  let best: PortSolve | null = null;
  let bestNorm = Number.POSITIVE_INFINITY;
  let lastReason = '';
  for (const mode of ['ac', 'dc'] as const) {
    const plus = netSolve(graph, { ...options, mode, testCurrent: { net, amps: 1 } });
    const minus = netSolve(graph, { ...options, mode, testCurrent: { net, amps: -1 } });
    if (!plus.ok || !minus.ok) {
      lastReason = !plus.ok ? plus.reason : !minus.ok ? minus.reason : '';
      continue;
    }
    const vp = plus.solution.nodeVoltages[net];
    const vm = minus.solution.nodeVoltages[net];
    if (!Number.isFinite(vp) || !Number.isFinite(vm)) continue;
    const rth = (vm - vp) / 2;
    const center = (vm + vp) / 2;
    const residual = Math.abs(center - vth);
    const normalized = residual / Math.max(1, Math.abs(vth), Math.abs(center));
    if (normalized < bestNorm) {
      bestNorm = normalized;
      best = { mode, rth, center, residual };
    }
    // 与当前解逐位自洽就不用再试另一种口径。
    if (normalized < 1e-9) break;
  }
  return { best, reason: lastReason };
}

/* ── 戴维南等效电路图 ─────────────────────────────────────────── */

function theveninSpec(port: Pick<EquivalentPort, 'vth' | 'rth' | 'inorton' | 'label'>): RenderSpec {
  const draft: Draft = { nodes: [], edges: [] };
  const gndAt: Pt = [240, 470];
  const srcAt: Pt = [240, 350];
  const resAt: Pt = [400, 306];
  const portAt: Pt = [580, 306];
  const gndT = pinAt('gnd', gndAt, 0, 't');
  const srcP = pinAt('vsrc', srcAt, 0, 'p');
  const srcN = pinAt('vsrc', srcAt, 0, 'n');
  const resA = pinAt('res', resAt, 0, 'a');
  const resB = pinAt('res', resAt, 0, 'b');

  part(draft, 'eq-n-gnd', 'gnd', gndAt, '', 'right');
  part(draft, 'eq-n-vth', 'vsrc', srcAt, `Vth ${num(port.vth)} V`, 'left');
  wire(draft, 'eq-e-gnd', [gndT, srcN]);

  const ideal = Math.abs(port.rth) < 1e-6;
  if (ideal) {
    part(draft, 'eq-n-port', 'pin', portAt, '', 'up');
    wire(draft, 'eq-e-src-port', [srcP, portAt]);
    text(draft, 'eq-t-rth', [400, 270], 'Rth ≈ 0 Ω：理想电压源，端口直连', 'up');
  } else {
    part(draft, 'eq-n-rth', 'res', resAt, `Rth ${ohms(port.rth)}`, 'up');
    part(draft, 'eq-n-port', 'pin', portAt, '', 'up');
    wire(draft, 'eq-e-src-rth', [srcP, resA]);
    wire(draft, 'eq-e-rth-port', [resB, portAt]);
  }
  text(draft, 'eq-t-port', [580, 264], `端口 ${port.label}`, 'up');
  text(draft, 'eq-t-method', [400, 418], 'V = Vth − I·Rth；±1A 测试电流由同一份 MNA 现算', 'up');
  text(
    draft,
    'eq-t-norton',
    [400, 444],
    port.inorton === null
      ? 'Rth ≈ 0：诺顿等效不适用（理想电压源）'
      : `诺顿写法：I_N = ${amps(port.inorton)} 并联同一 Rth`,
    'up',
  );
  if (Math.abs(port.rth) > 1e12) {
    text(draft, 'eq-t-open', [400, 236], 'Rth 极大：近似开路，端口近似理想电流源', 'up');
  }
  return finish(draft, 'equiv-thevenin');
}

/* ── 器件级 π 小信号模型 ──────────────────────────────────────── */

function smallSignalSpec(node: CanvasGraph['nodes'][number]): SmallSignalModel | null {
  const kind = node.kind === 'npn' ? 'npn' : node.kind === 'nmos' ? 'nmos' : null;
  if (!kind) return null;
  const isBjt = kind === 'npn';
  const name = node.label || node.id;
  let gm = 0;
  let rpi: number | null = null;
  let ro = 0;
  if (isBjt) {
    const ic = Number(node.value);
    const beta = Number(node.params?.beta);
    const va = Number(node.params?.lambda ?? node.params?.VA);
    if (!Number.isFinite(ic) || ic <= 0 || !Number.isFinite(beta) || !Number.isFinite(va) || beta === 0 || va === 0) return null;
    gm = ic / VT;
    rpi = beta / gm;
    ro = va / ic;
  } else {
    gm = Number(node.params?.gm);
    ro = Number(node.params?.ro);
    if (!Number.isFinite(gm) || !Number.isFinite(ro) || ro === 0) return null;
  }
  if (!Number.isFinite(gm) || !Number.isFinite(ro)) return null;

  const draft: Draft = { nodes: [], edges: [] };
  const y = 300;
  const inAt: Pt = [160, y];
  const outAt: Pt = [620, 105];
  const comAt: Pt = [620, 420];
  const rpiAt: Pt = [300, y];
  const gmAt: Pt = [460, y];
  const roAt: Pt = [560, y];
  const gmP = pinAt('ctrlsrc', gmAt, 0, 'p');
  const gmN = pinAt('ctrlsrc', gmAt, 0, 'n');
  const roA = pinAt('res', roAt, 90, 'a');
  const roB = pinAt('res', roAt, 90, 'b');

  part(draft, `eq-${node.id}-in`, 'pin', inAt, '', 'up');
  part(draft, `eq-${node.id}-out`, 'pin', outAt, '', 'up');
  part(draft, `eq-${node.id}-com`, 'pin', comAt, '', 'up');
  // 受控源与 ro 只隔 100px：两枚标签都朝右必然叠字（实测「gm·vbe 38.462 mS」压住
  // 「ro 100 kΩ」）。控制量走上方、ro 走下方，两条都不会再横穿母线。
  part(draft, `eq-${node.id}-gm`, 'ctrlsrc', gmAt, `gm·${isBjt ? 'vbe' : 'vgs'} ${siemens(gm)}`, 'up');
  part(draft, `eq-${node.id}-ro`, 'res', roAt, `ro ${ohms(ro)}`, 'down', 90);

  // 顶 / 底两条母线：D(C) 与 S(E)。顶母线抬到 105：实测 up 标签落在约 y=150，母线必须让开这一带。
  wire(draft, `eq-${node.id}-e-top`, [gmP, [gmP[0], 105], outAt], { weight: 2 });
  wire(draft, `eq-${node.id}-e-ro-top`, [roA, [roA[0], 105]]);
  wire(draft, `eq-${node.id}-e-bottom`, [[300, 420], comAt], { weight: 2 });
  wire(draft, `eq-${node.id}-e-gm-bottom`, [gmN, [gmN[0], 420]]);
  wire(draft, `eq-${node.id}-e-ro-bottom`, [roB, [roB[0], 420]]);

  if (isBjt && rpi !== null) {
    const rpiA = pinAt('res', rpiAt, 90, 'a');
    const rpiB = pinAt('res', rpiAt, 90, 'b');
    part(draft, `eq-${node.id}-rpi`, 'res', rpiAt, `rπ ${ohms(rpi)}`, 'left', 90);
    wire(draft, `eq-${node.id}-e-in-rpi`, [[160, y], [240, y], [240, rpiA[1]], rpiA]);
    wire(draft, `eq-${node.id}-e-rpi-bottom`, [rpiB, [rpiB[0], 420]]);
    // 控制量是电压，不取电流：虚线只表示「量」，不是导线。
    wire(draft, `eq-${node.id}-e-vbe`, [[240, y], [400, y]], { dashed: true, tag: 'vbe' });
  } else {
    wire(draft, `eq-${node.id}-e-vgs`, [inAt, [400, y]], { dashed: true, tag: 'vgs' });
  }

  text(draft, `eq-${node.id}-t-in`, [160, 270], isBjt ? 'B 基极' : 'G 栅极', 'up');
  text(draft, `eq-${node.id}-t-out`, [620, 73], isBjt ? 'C 集电极' : 'D 漏极', 'up');
  text(draft, `eq-${node.id}-t-com`, [620, 450], isBjt ? 'E 发射极' : 'S 源极', 'up');
  text(
    draft,
    `eq-${node.id}-t-note`,
    [400, 52],
    isBjt
      ? `gm = Ic/Vt，rπ = β/gm，ro = VA/Ic（Vt = ${VT * 1e3} mV）`
      : 'gm / ro 取自该管的参数表；栅极不取电流（虚线为控制量）',
    'up',
  );

  const rows = [
    ...(isBjt && rpi !== null ? [{ label: 'rπ（β / gm）', value: ohms(rpi) }] : []),
    { label: 'gm', value: siemens(gm) },
    { label: 'ro', value: ohms(ro) },
  ];
  return {
    deviceId: node.id,
    kind,
    title: `${name} · ${isBjt ? 'BJT' : 'MOS'} π 小信号模型（器件级）`,
    rows,
    spec: finish(draft, `equiv-pi-${node.id}`),
  };
}

/* ── 主入口 ───────────────────────────────────────────────────── */

/**
 * 只用「当前这张图 + 当前这份解」推导，不读模板、不读骨架。
 * 任何一步算不动都在 notes 里如实说明，绝不返回一个看着像等效电路的假图。
 */
export function deriveCircuitEquivalent(graph: CanvasGraph, solution: CircuitSolution | undefined): CircuitEquivalent {
  const notes: string[] = [];
  if (!solution || graph.family !== 'circuit') return { ports: [], smallSignal: [], notes };

  const ports: EquivalentPort[] = [];
  for (const candidate of portCandidates(graph, solution)) {
    const vth = solution.nodeVoltages[candidate.net];
    if (!Number.isFinite(vth)) continue;
    const { best, reason } = solvePort(graph, candidate.net, vth);
    if (!best) {
      notes.push(`端口「${candidate.label}」加测试电流后 MNA 没解出来${reason ? `：${reason}` : ''}，该端口不给等效图。`);
      continue;
    }
    const portNotes: string[] = [];
    const relative = best.residual / Math.max(1, Math.abs(vth), Math.abs(best.center));
    if (relative > 1e-6) {
      portNotes.push(
        `口径自检：±1A 测试解的均值 ${num(best.center)} V 与当前开路电压 ${num(vth)} V 相差 ${num(best.residual)} V —— 这个端口可能处在非线性/不同口径下，Rth 只作参考。`,
      );
    }
    if (best.rth < 0) {
      portNotes.push('Rth 为负：网络里有受控源，这是负阻，不是算错。');
    }
    const inorton = Math.abs(best.rth) > 1e-9 ? vth / best.rth : null;
    const head = { vth, rth: best.rth, inorton, label: candidate.label };
    const port: EquivalentPort = {
      net: candidate.net,
      label: candidate.label,
      pinKeys: candidate.pinKeys,
      vth,
      rth: best.rth,
      inorton,
      mode: best.mode,
      linearResidual: best.residual,
      spec: theveninSpec(head),
      notes: portNotes,
    };
    ports.push(port);
  }

  if (ports.length > 0) {
    notes.push(
      `Vth = 开路电压，Rth = [V(−1A) − V(+1A)] / 2（口径 ${ports[0].mode}）。`,
    );
  }

  const smallSignal: SmallSignalModel[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'npn' && node.kind !== 'nmos') continue;
    const model = smallSignalSpec(node);
    if (model) smallSignal.push(model);
    if (smallSignal.length >= MAX_SMALL_SIGNAL) break;
  }
  if (smallSignal.length > 0) {
  }
  return { ports, smallSignal, notes };
}
