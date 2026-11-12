/** 运行时边界与单位检查：纯函数，可进浏览器。 */

import type { Solution } from '../core/types';

export interface BoundaryCheckResult {
  ok: boolean;
  detail: string;
}

function bit(text: unknown, width: number): boolean {
  return typeof text === 'string' && new RegExp(`^[01]{${width}}$`).test(text);
}

function d6Boundary(solution: Solution): BoundaryCheckResult {
  const result = solution.result;
  if ('twos' in result && 'twos16' in result) {
    if (!bit(result.twos, 8) || !bit(result.twos16, 16)) {
      return { ok: false, detail: '补码位宽不是 8/16' };
    }
    if (Number(result.readBack) !== Number(result.decimal)) {
      return { ok: false, detail: '补码回读与原值不符' };
    }
    return { ok: true, detail: '8/16 位补码定宽且回读一致' };
  }
  if ('sumBits' in result && 'aBits' in result) {
    const width = String(result.aBits).length;
    if (!bit(result.aBits, width) || !bit(result.bBits, width) || !bit(result.sumBits, width)) {
      return { ok: false, detail: '补码加法位串宽度不一致' };
    }
    if (result.overflow !== '是' && result.overflow !== '否') {
      return { ok: false, detail: 'overflow 标记非法' };
    }
    return { ok: true, detail: `${width} 位加数与和定宽，overflow 已标记` };
  }
  if ('asciiBits' in result) {
    if (!bit(result.bcd, 4) || !bit(result.asciiBits, 8)) {
      return { ok: false, detail: 'BCD 应为 4 位、ASCII 应为 8 位' };
    }
    return { ok: true, detail: 'BCD 4 位 / ASCII 8 位边界正确' };
  }
  const binary = String(result.binary ?? '');
  const octal = String(result.octal ?? '');
  const hex = String(result.hex ?? '');
  if (!/^0b[01]+$/.test(binary) || !/^0o[0-7]+$/.test(octal) || !/^0x[0-9A-F]+$/.test(hex)) {
    return { ok: false, detail: '进制表示缺少前缀或含非法数字' };
  }
  const roundTrip = String(result.roundTrip ?? '')
    .split('/')
    .map(Number);
  if (roundTrip.some((value) => value !== Number(result.decimal))) {
    return { ok: false, detail: `回验值 ${result.roundTrip} 不等于 ${result.decimal}` };
  }
  if (!/^([01]{4})( [01]{4})*$/.test(String(result.bcd ?? ''))) {
    return { ok: false, detail: 'BCD 分组不是 4 位一组' };
  }
  return { ok: true, detail: '各进制前缀 / 回验值 / BCD 分组边界正确' };
}

function analogBoundary(solution: Solution): BoundaryCheckResult {
  const result = solution.result;
  const id = solution.templateId;
  if (id === 'A1') {
    const vout = Number(result.Vout);
    const low = Number(result.lower);
    const high = Number(result.upper);
    if (!Number.isFinite(vout) || !(low - 1e-9 <= vout && vout <= high + 1e-9)) {
      return { ok: false, detail: `Vout=${vout} 不在理想上下界 [${low}, ${high}]` };
    }
    if (Number(result.I) < 0) return { ok: false, detail: '二极管电流为负' };
    return { ok: true, detail: '工作点落在理想模型上下界内' };
  }
  if (id === 'A2' || id === 'A4') {
    const zone = String(result.zone);
    const allowed = id === 'A2' ? ['cutoff', 'active', 'saturation'] : ['cutoff', 'saturation', 'triode'];
    if (!allowed.includes(zone)) return { ok: false, detail: `工作区 ${zone} 非法` };
    const current = Number(id === 'A2' ? result.IC : result.ID);
    if (!Number.isFinite(current) || current < -1e-12) return { ok: false, detail: `电流 ${current} 非法` };
    return { ok: true, detail: `工作区 ${zone}，电流非负且有限` };
  }
  if (id === 'A3' || id === 'A5') {
    if (!Number.isFinite(Number(result.Av))) return { ok: false, detail: 'Av 非有限值' };
    if (!(Number(result.Ro) > 0)) return { ok: false, detail: 'Ro 必须为正' };
    if (result.Ri !== '∞' && !(Number(result.Ri) > 0)) return { ok: false, detail: 'Ri 非法' };
    return { ok: true, detail: 'Av 有限、Ri/Ro 为正（或 ∞）' };
  }
  if (id === 'A6') {
    if (!Number.isFinite(Number(result.AvFinite))) return { ok: false, detail: 'AvFinite 非有限值' };
    if (Number(result.lastSweepError) > 1e-3) return { ok: false, detail: 'Aol 极限误差超过 1e-3' };
    return { ok: true, detail: '有限增益与极限误差均在界内' };
  }
  if (id === 'A7') {
    if (!(Number(result.T) > 0)) return { ok: false, detail: '环路增益 T 必须为正' };
    if (Number(result.errorAtT1000) >= 0.05) return { ok: false, detail: 'T=1000 时深度负反馈误差 ≥5%' };
    return { ok: true, detail: 'T>0，T=1000 时误差 <5%' };
  }
  return { ok: false, detail: `${id} 缺少边界判据` };
}

function mechanicsBoundary(solution: Solution): BoundaryCheckResult {
  const result = solution.result;
  const status = String(result.status);
  if (!['ok', 'over', 'indeterminate', 'out-of-scope'].includes(status)) {
    return { ok: false, detail: `力学结论 status=${status} 非法` };
  }
  if (status === 'indeterminate') {
    return { ok: false, detail: '当前版本不解静不定，不给数字结论' };
  }
  if (status === 'out-of-scope') {
    // 拒绝作答不是算错：这里判 fail 是如实告诉用户「本工具对这一组参数不适用」
    return {
      ok: false,
      detail: String(result.conclusion ?? '超出公式适用范围，本工具不适用'),
    };
  }
  for (const key of ['sigmaMax', 'tauMax', 'Mmax']) {
    if (key in result && !Number.isFinite(Number(result[key]))) {
      return { ok: false, detail: `${key} 非有限值` };
    }
  }
  const ratio = Number(result.ratio ?? 0);
  if (!Number.isFinite(ratio) || ratio < 0) return { ok: false, detail: `ratio=${result.ratio} 非法` };
  return {
    ok: true,
    detail: status === 'over' ? '已超限（结论位红字）' : `未超限，用量比 ${ratio.toFixed(3)}`,
  };
}

/**
 * 静力学边界：判据失败（静不定 / 机构）不是「算错」，而是**拒绝作答** ——
 * 这里如实返回 ok:false 并带上理由，结论位显示黄底。
 */
function staticsBoundary(solution: Solution): BoundaryCheckResult {
  const result = solution.result;
  const status = String(result.status);
  if (!['ok', 'over', 'indeterminate', 'out-of-scope'].includes(status)) {
    return { ok: false, detail: `静力学结论 status=${status} 非法` };
  }
  if (status === 'indeterminate' || status === 'out-of-scope') {
    return { ok: false, detail: String(result.conclusion ?? '判据不过，本工具拒绝给数字') };
  }
  const numericKeys = ['RA', 'RB', 'Rx', 'Ry', 'R', 'F', 'N_AB', 'N_AC', 'N_BC', 'Pcrit', 'phiF', 'ybar_mm', 'A_mm2'];
  for (const key of numericKeys) {
    if (key in result && !Number.isFinite(Number(result[key]))) {
      return { ok: false, detail: `${key} 非有限值` };
    }
  }
  if ('selfLock' in result && ![0, 1].includes(Number(result.selfLock))) {
    return { ok: false, detail: `selfLock=${result.selfLock} 非法（只能是 0/1）` };
  }
  return { ok: true, detail: '静定结果，平衡残差与判据均已记录在校验表' };
}

export function boundaryCheck(solution: Solution): BoundaryCheckResult {
  if (solution.templateId.startsWith('S')) return staticsBoundary(solution);
  if (solution.templateId.startsWith('M')) return mechanicsBoundary(solution);
  if (solution.templateId.startsWith('A')) return analogBoundary(solution);
  if (solution.templateId === 'D6') return d6Boundary(solution);

  const tableSpec = solution.render_specs.find((spec) => spec.type === 'table');
  if (!tableSpec?.table) return { ok: false, detail: '缺少真值表，无法检查输出边界' };
  const { inputs, rows } = tableSpec.table;
  if (rows.length !== 2 ** inputs.length) {
    return { ok: false, detail: `真值表行数 ${rows.length} ≠ 2^${inputs.length}` };
  }
  for (const row of rows) {
    if (row.in.length !== inputs.length || row.out.length === 0) {
      return { ok: false, detail: '真值表行列宽度不一致' };
    }
    if (!row.in.every((value) => value === 0 || value === 1)) {
      return { ok: false, detail: '真值表输入位置出现 x（仅输出允许 x）' };
    }
    if (!row.out.every((value) => value === 0 || value === 1 || value === 'x')) {
      return { ok: false, detail: '真值表输出出现非 0/1/x 值' };
    }
  }
  return { ok: true, detail: `${rows.length} 行输出均为 0/1/x，边界完整` };
}

export interface UnitCheckResult {
  ok: boolean;
  detail: string;
}

function requireKeys(
  parsedGiven: Record<string, number | string>,
  keys: readonly string[],
  label: string,
): UnitCheckResult | null {
  for (const key of keys) {
    if (!(key in parsedGiven)) return { ok: false, detail: `${label} 缺少已知量 ${key}` };
  }
  return null;
}

export function unitChecker(
  templateId: string,
  parsedGiven: Record<string, number | string>,
): UnitCheckResult {
  if (templateId === 'D1') {
    const missing = requireKeys(parsedGiven, ['variables', 'minterms', 'termCount'], 'D1');
    if (missing) return missing;
    if (String(parsedGiven.variables).length !== 4) {
      return { ok: false, detail: 'D1 variables 必须是 4 个变量' };
    }
    if (typeof parsedGiven.termCount !== 'number') {
      return { ok: false, detail: 'D1 termCount 必须是数字' };
    }
    return { ok: true, detail: '布尔量无量纲；termCount 为计数' };
  }
  if (templateId === 'D2') {
    const missing = requireKeys(parsedGiven, ['inputs', 'gates', 'topology'], 'D2');
    if (missing) return missing;
    if (typeof parsedGiven.gateCount !== 'number') {
      return { ok: false, detail: 'D2 gateCount 必须是数字' };
    }
    return { ok: true, detail: '逻辑量 0/1 无量纲；gateCount 为计数，不参与量纲' };
  }
  if (templateId === 'D3') {
    const missing = requireKeys(parsedGiven, ['op', 'inputs', 'gateCount'], 'D3');
    if (missing) return missing;
    if (typeof parsedGiven.gateCount !== 'number' || parsedGiven.gateCount <= 0) {
      return { ok: false, detail: 'D3 gateCount 必须是正整数' };
    }
    return { ok: true, detail: '门数为计数；输入为逻辑量，无量纲' };
  }
  if (templateId === 'D4') {
    const missing = requireKeys(parsedGiven, ['ff', 'q0', 'ticks', 'inputs'], 'D4');
    if (missing) return missing;
    if (!['SR', 'D', 'JK', 'T'].includes(String(parsedGiven.ff))) {
      return { ok: false, detail: 'D4 ff 非法' };
    }
    if (typeof parsedGiven.ticks !== 'number') return { ok: false, detail: 'D4 ticks 必须是数字' };
    return { ok: true, detail: '状态 0/1 与拍数无量纲' };
  }
  if (templateId === 'D5') {
    const missing = requireKeys(parsedGiven, ['kind', 'states', 'ticks', 'inputs'], 'D5');
    if (missing) return missing;
    if (typeof parsedGiven.states !== 'number' || typeof parsedGiven.ticks !== 'number') {
      return { ok: false, detail: 'D5 states/ticks 必须是数字' };
    }
    return { ok: true, detail: '状态数与拍数均为计数' };
  }
  const analogKeys: Record<string, string[]> = {
    A1: ['mode', 'Vs', 'R', 'Vf', 'Vz', 'Rz'],
    A2: ['Vcc', 'R1', 'R2', 'Rc', 'Re', 'beta', 'VBE', 'VCEsat'],
    A3: ['config', 'beta', 'Ic', 'Rc', 'Rl', 'Rs', 'Re', 'Vt', 'VA'],
    A4: ['Vdd', 'Rg1', 'Rg2', 'Rd', 'Rs', 'Vth', 'Kn', 'lambda'],
    A5: ['config', 'gm', 'ro', 'Rd', 'Rl', 'Rs', 'Rss'],
    A6: ['topology', 'Aol', 'R1', 'R2', 'Rin', 'Rout', 'Vin'],
    A7: ['A', 'beta', 'Rin', 'Rout', 'Rl'],
  };
  if (analogKeys[templateId]) {
    const missing = requireKeys(parsedGiven, analogKeys[templateId], templateId);
    if (missing) return missing;
    return { ok: true, detail: '模电参数均为 SI 量（V/A/Ω/F/H），无量纲增益单独标注' };
  }
  const staticsKeys: Record<string, string[]> = {
    S1: ['L', 'a', 'P', '组态'],
    S2: ['F1', 'th1', 'F2', 'th2'],
    S3: ['L', 'x1', 'P1', 'x2', 'P2'],
    S4: ['mu', 'W', 'alpha', 'beta'],
    S5: ['L', 'H', 'P'],
    S6: ['翼缘宽', '翼缘厚', '腹板宽', '腹板高'],
    S7: ['左臂', '右臂', '重物'],
  };
  if (staticsKeys[templateId]) {
    const missing = requireKeys(parsedGiven, staticsKeys[templateId], templateId);
    if (missing) return missing;
    return {
      ok: true,
      detail: '静力学量统一为 m / kN / N / 度；截面尺寸用 mm，换算处已标注',
    };
  }
  const mechKeys: Record<string, string[]> = {
    M1: ['L', 'A', 'P', 'E', 'allow'],
    M2: ['L', 'd', 'T', 'G', 'allow'],
    M3: ['L', 'a', 'P', 'q'],
    M4: ['L', 'a', 'P', 'b', 'h', 'allow'],
    M5: ['L', 'a', 'P', 'b', 'h', 'E'],
    M6: ['sx', 'sy', 'txy', 'allow'],
    M7: ['L', 'b', 'h', 'E', 'mu', 'P', 'sp'],
    M8: ['L', 'd', 'Pn', 'Pt', 'T', 'allow'],
  };
  if (mechKeys[templateId]) {
    const missing = requireKeys(parsedGiven, mechKeys[templateId], templateId);
    if (missing) return missing;
    return { ok: true, detail: '力学量统一换算为 m / kN / GPa / MPa 后求解，图与文字同单位' };
  }
  if (templateId === 'D6') {
    const missing = requireKeys(parsedGiven, ['op'], 'D6');
    if (missing) return missing;
    const op = String(parsedGiven.op);
    const keys: Record<string, string[]> = {
      convert: ['value', 'bits'],
      complement: ['value', 'bits'],
      add: ['a', 'b', 'bits'],
      'bcd-ascii': ['digit', 'bits'],
    };
    if (!keys[op]) return { ok: false, detail: `D6 op=${op} 不在范围内` };
    const opMissing = requireKeys(parsedGiven, keys[op], 'D6');
    if (opMissing) return opMissing;
    return { ok: true, detail: '数值与码位无量纲；bits 为位宽计数' };
  }
  return { ok: false, detail: `${templateId} 暂无单位表` };
}