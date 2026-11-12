import type { GoldenCase } from './types';

type D6Input = Record<string, number | string>;

export const D6_GOLDEN: GoldenCase<D6Input>[] = [
  {
    id: 'D6-01',
    templateId: 'D6',
    title: '-13 的 8 位与 16 位补码',
    input: { op: 'complement', value: -13, bits: 8 },
    expected: {
      decimal: -13,
      ones: '11110010',
      twos: '11110011',
      twos16: '1111111111110011',
      readBack: -13,
      range: '[-128, 127]',
    },
    residualThreshold: 0,
    handCheck: '13=00001101；反码 11110010；加 1 得 11110011；16 位符号扩展补 8 个 1。',
    provenance: 'self-authored',
  },
  {
    id: 'D6-02',
    templateId: 'D6',
    title: '172 转二/八/十六进制与 BCD、格雷码回验',
    input: { op: 'convert', value: 172, bits: 8 },
    expected: {
      decimal: 172,
      binary: '0b10101100',
      octal: '0o254',
      hex: '0xAC',
      bcd: '0001 0111 0010',
      gray: '11111010',
      grayBack: '0b10101100',
      roundTrip: '172/172/172',
    },
    residualThreshold: 0,
    handCheck:
      '172=128+32+8+4=10101100₂；分组 010 101 100=254₈；1010 1100=AC₁₆；BCD 每十进制位 4 位；g=10101100⊕01010110=11111010，级联逆变换回 10101100。',
    provenance: 'self-authored',
  },
  {
    id: 'D6-03',
    templateId: 'D6',
    title: '4 位补码 1011(-5) + 0110(6)：carryOut=1 但无溢出',
    input: { op: 'add', a: -5, b: 6, bits: 4 },
    expected: {
      aBits: '1011',
      bBits: '0110',
      sumBits: '0001',
      sumSigned: 1,
      carryOut: 1,
      overflow: '否',
      rule: 'Cin=1, Cout=1',
    },
    residualThreshold: 0,
    handCheck:
      '1011+0110=10001₂：Cout=1，但符号位进位 Cin=1，V=Cin⊕Cout=0；按补码回读 0001=+1，即 -5+6=1。只看 carryOut 会误判溢出。',
    provenance: 'self-authored',
  },
];