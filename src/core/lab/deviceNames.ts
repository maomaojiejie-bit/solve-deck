/**
 * W20 · 「不认识的器件」点名。
 *
 * 以前拒答只说「求解器不支持」/ 一个裸的 `unsupported`，用户不知道是哪一件、
 * 在图上哪个位置。这里把「通用电路求解认得的器件」与「中文名」收在一份，
 * netSolve（判据）与 resolve（人话文案）共用，不许两处各写一套。
 */

import type { CanvasGraph } from './types.ts';

/**
 * 通用电路求解器（MNA）认识的器件。零新模型：加名字等于开新模型，须走 W20 §4 的触发条件。
 * W22-C：加了 `sum` / `block` —— 控制框图的两种图元按理想受控源（VCVS）进网表，
 * 见 netSolve 的对应分支；它们不是电路器件，所以只在「画布上真有」时才参与。
 */
export const CIRCUIT_DEVICE_KINDS = [
  'res', 'vsrc', 'isrc', 'cap', 'diode', 'npn', 'nmos', 'opamp', 'gnd',
  'sum', 'block',
] as const;

/** 图元 kind → 中文名。未列出的用 kind 原文照实写（不瞎猜名字）。 */
export const UNKNOWN_KIND_LABEL: Record<string, string> = {
  sum: '求和圆',
  block: '功能块',
  ctrlsrc: '受控源',
  switch: '开关',
  transformer: '变压器',
  motor: '电动机',
  lamp: '灯泡',
};

/** 图上所有通用电路求解不认识的器件（文字 / 结点 / 导线不算器件）。 */
export function unknownDevices(graph: CanvasGraph): { id: string; kind: string; label: string }[] {
  return graph.nodes
    .filter((node) => !['text', 'dot', 'wire', 'pin'].includes(node.kind))
    .filter((node) => !(CIRCUIT_DEVICE_KINDS as readonly string[]).includes(node.kind))
    .map((node) => ({ id: node.id, kind: node.kind, label: (node.label ?? '').trim() }));
}

/**
 * 拒答/横幅用的人话：**点名到器件与位置 id**。
 * 没有未知器件时返回 null，调用方就该用原来的原因，别硬套这句话。
 */
export function unknownDeviceNote(graph: CanvasGraph): string | null {
  const list = unknownDevices(graph);
  if (list.length === 0) return null;
  const named = list
    .map((one) => `${UNKNOWN_KIND_LABEL[one.kind] ?? one.kind}（${one.kind}${one.label ? ` · ${one.label}` : ''}）（位置 ${one.id}）`)
    .join('、');
  return `这张图里有本工具不认识的器件：${named}。${graph.family === 'circuit' ? '它在电路族里没有对应模型' : '它不在本族的通用求解模型里'}，所以这张图不能按${graph.family === 'circuit' ? '电路' : '本族'}求解。`;
}
