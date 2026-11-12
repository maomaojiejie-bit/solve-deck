/**
 * 内置复合器件（W13）：写死在代码里的三个模块，不进 localStorage、不进 URL。
 *
 * 局部坐标以模块自身为参考系；展开时整块平移到 composite 节点位置（包围盒
 * 中心对齐），只影响观感、不影响归约。内层 id 是局部 id，展开时统一加前缀
 * `cmp/<compositeId>/`。
 *
 * goldenRefs 指向 check:lab 已逐键校验的快照夹具（不是随手写的字符串）：
 * 分压器 / π 模型对应 A3 的偏置链与晶体管小信号，并联电阻对对应 A5 的 Rd∥Rl。
 */

import type { CompositeDef } from './composite.ts';

export const BUILTIN_COMPOSITES: Record<string, CompositeDef> = {
  'cmp-divider': {
    id: 'cmp-divider',
    title: '分压器',
    note: 'R1 串 R2：Vout = Vin · R2/(R1+R2)',
    ports: [
      { id: 'Vin', nodeId: 'R1', pin: 'a', label: '输入 Vin' },
      { id: 'Vout', nodeId: 'mid', label: '输出 Vout' },
      { id: 'GND', nodeId: 'R2', pin: 'b', label: '地 GND' },
    ],
    inner: {
      nodes: [
        { id: 'R1', x: 0, y: -44, kind: 'res', rot: 90, label: 'R1', value: 10000 },
        { id: 'R2', x: 0, y: 44, kind: 'res', rot: 90, label: 'R2', value: 10000 },
        { id: 'mid', x: 0, y: 0, kind: 'dot' },
      ],
      edges: [{ id: 'e-mid', from: 'R1', to: 'R2', kind: 'wire', points: [[0, -44], [0, 44]] }],
    },
    modelSpec: {
      equations: ['Vout = Vin · R2/(R1+R2)'],
      applicableRange: '直流、线性、R1+R2 ≤ 1 MΩ',
      units: { R: 'Ω', V: 'V' },
    },
    goldenRefs: ['A3'],
    createdAt: '2026-11-11',
  },
  'cmp-parallel': {
    id: 'cmp-parallel',
    title: '并联电阻对',
    note: 'R3 ∥ R4：Req = R3·R4/(R3+R4)',
    ports: [
      { id: 'A', nodeId: 'R3', pin: 'a', label: '端 A' },
      { id: 'B', nodeId: 'R3', pin: 'b', label: '端 B' },
    ],
    inner: {
      nodes: [
        { id: 'R3', x: 0, y: -22, kind: 'res', rot: 0, label: 'R3', value: 20000 },
        { id: 'R4', x: 0, y: 22, kind: 'res', rot: 0, label: 'R4', value: 20000 },
      ],
      // W22-C F6：真并联 = 两只阻的 a 脚并一条汇流边、b 脚并另一条。
      // 旧版只有一条退化边（points 全 0）把 R3.b 接 R4.a —— 实为串联。
      edges: [
        { id: 'e-par-a', from: 'R3', to: 'R4', kind: 'wire', points: [[-44, -22], [-44, 22]] },
        { id: 'e-par-b', from: 'R3', to: 'R4', kind: 'wire', points: [[44, -22], [44, 22]] },
      ],
    },
    modelSpec: {
      equations: ['Req = R3·R4/(R3+R4)'],
      applicableRange: '直流、线性',
      units: { R: 'Ω' },
    },
    goldenRefs: ['A5'],
    createdAt: '2026-11-11',
  },
  'cmp-pi': {
    id: 'cmp-pi',
    title: 'π 模型子块',
    note: 'rπ（B–E）与 ro（C–E）：晶体管小信号等效的电阻部分',
    ports: [
      { id: 'B', nodeId: 'rpi', pin: 'a', label: '基极 B' },
      { id: 'C', nodeId: 'ro', pin: 'a', label: '集电极 C' },
      { id: 'E', nodeId: 'ej', label: '发射极 E' },
    ],
    inner: {
      nodes: [
        { id: 'rpi', x: 0, y: 0, kind: 'res', rot: 0, label: 'rpi', value: 2600 },
        { id: 'ro', x: 132, y: 44, kind: 'res', rot: 90, label: 'ro', value: 100000 },
        { id: 'ej', x: 44, y: 88, kind: 'dot' },
      ],
      edges: [
        { id: 'e-e1', from: 'rpi', to: 'ej', kind: 'wire', points: [[44, 0], [44, 88]] },
        { id: 'e-e2', from: 'ro', to: 'ej', kind: 'wire', points: [[132, 88], [44, 88]] },
      ],
    },
    modelSpec: {
      equations: ['rπ = β/gm', 'ro = VA/Ic'],
      applicableRange: '小信号、线性、Ic > 0',
      units: { R: 'Ω', I: 'A' },
    },
    goldenRefs: ['A3'],
    createdAt: '2026-11-11',
  },
};
