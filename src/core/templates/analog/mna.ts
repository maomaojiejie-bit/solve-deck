/**
 * 自写改进节点分析（MNA），零第三方依赖。
 *
 * 支持 R / 独立电压源 / 独立电流源 / VCCS / CCCS / VCVS。
 * 非线性器件由调用方在工作区假设下线性化后接入；这里只解线性方程组。
 */

export type ElementKind = 'R' | 'V' | 'I' | 'VCCS' | 'CCCS' | 'VCVS';

export interface Element {
  id: string;
  kind: ElementKind;
  /** 正端 / 流出端。 */
  a: string;
  /** 负端 / 流入端。 */
  b: string;
  value: number;
  /** VCCS / VCVS 的控制电压节点。 */
  control?: { a: string; b: string };
  /** CCCS 的控制支路（必须是 V/VCVS 元件的 id）。 */
  controlBranch?: string;
}

export interface AnalogCircuit {
  nodes: string[];
  ground: string;
  elements: Element[];
}

export interface MNAResult {
  voltage: Record<string, number>;
  branchCurrent: Record<string, number>;
  residual: number;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = matrix.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-14) throw new Error('MNA 矩阵奇异：检查浮空节点或理想源环路');
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];
    for (let col = row + 1; col < n; col += 1) sum -= a[row][col] * x[col];
    x[row] = sum / a[row][row];
  }
  return x;
}

export function solveMNA(circuit: AnalogCircuit): MNAResult {
  const connected = new Set<string>([circuit.ground]);
  for (const element of circuit.elements) {
    connected.add(element.a);
    connected.add(element.b);
    if (element.control) {
      connected.add(element.control.a);
      connected.add(element.control.b);
    }
  }
  const nodes = [...new Set([...circuit.nodes, ...connected])].filter(
    (node) => node !== circuit.ground && connected.has(node),
  );
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const branches = circuit.elements.filter(
    (element) => element.kind === 'V' || element.kind === 'VCVS',
  );
  const branchIndex = new Map(branches.map((element, index) => [element.id, nodes.length + index]));
  const size = nodes.length + branches.length;
  const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const z = new Array<number>(size).fill(0);

  const at = (node: string): number | null => nodeIndex.get(node) ?? null;
  const stampG = (row: string, col: string, value: number) => {
    const r = at(row);
    const c = at(col);
    if (r !== null && c !== null) A[r][c] += value;
  };

  for (const element of circuit.elements) {
    const a = at(element.a);
    const b = at(element.b);
    switch (element.kind) {
      case 'R': {
        if (!(element.value > 0)) throw new Error(`电阻 ${element.id} 必须为正`);
        const g = 1 / element.value;
        stampG(element.a, element.a, g);
        stampG(element.b, element.b, g);
        stampG(element.a, element.b, -g);
        stampG(element.b, element.a, -g);
        break;
      }
      case 'I':
        if (a !== null) z[a] -= element.value;
        if (b !== null) z[b] += element.value;
        break;
      case 'V': {
        const k = branchIndex.get(element.id)!;
        if (a !== null) {
          A[a][k] += 1;
          A[k][a] += 1;
        }
        if (b !== null) {
          A[b][k] -= 1;
          A[k][b] -= 1;
        }
        z[k] = element.value;
        break;
      }
      case 'VCCS': {
        if (!element.control) throw new Error(`VCCS ${element.id} 缺少控制节点`);
        const gain = element.value;
        stampG(element.a, element.control.a, gain);
        stampG(element.a, element.control.b, -gain);
        stampG(element.b, element.control.a, -gain);
        stampG(element.b, element.control.b, gain);
        break;
      }
      case 'CCCS': {
        const control = branchIndex.get(element.controlBranch ?? '');
        if (control === undefined) throw new Error(`CCCS ${element.id} 控制支路不存在`);
        if (a !== null) A[a][control] += element.value;
        if (b !== null) A[b][control] -= element.value;
        break;
      }
      case 'VCVS': {
        if (!element.control) throw new Error(`VCVS ${element.id} 缺少控制节点`);
        const k = branchIndex.get(element.id)!;
        if (a !== null) {
          A[a][k] += 1;
          A[k][a] += 1;
        }
        if (b !== null) {
          A[b][k] -= 1;
          A[k][b] -= 1;
        }
        const ca = at(element.control.a);
        const cb = at(element.control.b);
        if (ca !== null) A[k][ca] -= element.value;
        if (cb !== null) A[k][cb] += element.value;
        break;
      }
      default:
        throw new Error(`MNA 不支持的元件 ${String(element.kind)}`);
    }
  }

  const solution = solveLinear(A, z);
  const voltage: Record<string, number> = { [circuit.ground]: 0 };
  nodes.forEach((node, index) => {
    voltage[node] = solution[index];
  });
  const branchCurrent: Record<string, number> = {};
  branches.forEach((element) => {
    branchCurrent[element.id] = solution[branchIndex.get(element.id)!];
  });

  let residual = 0;
  for (let row = 0; row < size; row += 1) {
    let sum = 0;
    for (let col = 0; col < size; col += 1) sum += A[row][col] * solution[col];
    residual = Math.max(residual, Math.abs(sum - z[row]));
  }
  return { voltage, branchCurrent, residual };
}

export function resistorCurrent(circuit: AnalogCircuit, result: MNAResult, id: string): number {
  const element = circuit.elements.find((item) => item.id === id);
  if (!element || element.kind !== 'R') throw new Error(`没有电阻 ${id}`);
  return (result.voltage[element.a] - result.voltage[element.b]) / element.value;
}

export function maxAbs(values: readonly number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}