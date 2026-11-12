import type { Netlist } from '../../core/types';
import { D2_NETLIST } from '../../core/templates/digital/D2.ts';
import type { GoldenCase } from './types';

const D2_NAND_NETLIST: Netlist = {
  kind: 'logic',
  devices: [
    { id: 'A', symbolId: 'IN', rotation: 0 },
    { id: 'B', symbolId: 'IN', rotation: 0 },
    { id: 'C', symbolId: 'IN', rotation: 0 },
    { id: 'G1', symbolId: 'NAND', rotation: 0 },
    { id: 'G3', symbolId: 'NAND', rotation: 0 },
    { id: 'F', symbolId: 'OUT', rotation: 0 },
  ],
  connectors: [
    { from: ['A', 'p'], to: ['G1', 'in1'] },
    { from: ['B', 'p'], to: ['G1', 'in2'] },
    { from: ['C', 'p'], to: ['G3', 'in2'] },
    { from: ['G1', 'out'], to: ['G3', 'in1'] },
    { from: ['G3', 'out'], to: ['F', 'p'] },
  ],
};

const D2_XOR4_NETLIST: Netlist = {
  kind: 'logic',
  devices: [
    { id: 'A', symbolId: 'IN', rotation: 0 },
    { id: 'B', symbolId: 'IN', rotation: 0 },
    { id: 'C', symbolId: 'IN', rotation: 0 },
    { id: 'D', symbolId: 'IN', rotation: 0 },
    { id: 'G1', symbolId: 'XOR', rotation: 0 },
    { id: 'F', symbolId: 'OUT', rotation: 0 },
  ],
  connectors: [
    { from: ['A', 'p'], to: ['G1', 'in1'] },
    { from: ['B', 'p'], to: ['G1', 'in2'] },
    { from: ['C', 'p'], to: ['G1', 'in3'] },
    { from: ['D', 'p'], to: ['G1', 'in4'] },
    { from: ['G1', 'out'], to: ['F', 'p'] },
  ],
};

export const D2_GOLDEN: GoldenCase<Netlist>[] = [
  {
    id: 'D2-01',
    templateId: 'D2',
    title: "F = A·B + C' 八行真值表",
    input: D2_NETLIST,
    expected: {
      expression: "F = A·B + C'",
      minterms: 'Σm(0,2,4,6,7)',
      ones: 5,
      zeros: 3,
    },
    residualThreshold: 0,
    handCheck: "按 ABC=000…111 逐行代入 AB+C'；1 的行为 000/010/100/110/111",
    provenance: 'self-authored',
  },
  {
    id: 'D2-02',
    templateId: 'D2',
    title: "与非门实现同一函数：((A·B)'·C)' = AB + C'",
    input: D2_NAND_NETLIST,
    expected: {
      minterms: 'Σm(0,2,4,6,7)',
      ones: 5,
      zeros: 3,
    },
    residualThreshold: 0,
    handCheck:
      "G1=(AB)′，G3=((AB)′·C)′=AB+C′；八行逐行代入与 D2-01 同表。",
    provenance: 'self-authored',
  },
  {
    id: 'D2-03',
    templateId: 'D2',
    title: '4 输入异或：F = A⊕B⊕C⊕D',
    input: D2_XOR4_NETLIST,
    expected: {
      expression: 'F = A⊕B⊕C⊕D',
      minterms: 'Σm(1,2,4,7,8,11,13,14)',
      ones: 8,
      zeros: 8,
    },
    residualThreshold: 0,
    handCheck:
      '四位异或在 1 的个数为奇数时取 1：0001,0010,0100,0111,1000,1011,1101,1110，共 8 行。',
    provenance: 'self-authored',
  },
];