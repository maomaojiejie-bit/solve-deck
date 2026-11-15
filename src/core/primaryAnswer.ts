/**
 * 结果页页首只显示一条读数 —— 这条必须是「这道题的答案」，不是中间量。
 *
 * `solution.result` 由各求解器按自己的顺序写入，A3 的第一条是 gm（中间量），
 * 直接取首项会在大字位置摆出 0.0385 这种没人要的数字。所以按题型登记答案键：
 * 表里有的按表取，没有的退回首条有限数值（题型没登记也不会整块消失）。
 */

export const PRIMARY_ANSWER_KEY: Record<string, string> = {
  A1: 'Vout',
  A2: 'VCE',
  A3: 'Av',
  A4: 'VDS',
  A5: 'Av',
  A6: 'Vout',
  A7: 'AfAnswer',
  D1: 'sop',
  D2: 'expression',
  D3: 'expression',
  D4: 'finalQ',
  D5: 'finalState',
  D6: 'hex',
  M1: 'sigmaMax',
  M2: 'tauMax',
  M3: 'Mmax',
  M4: 'sigmaMax',
  M5: 'deltaMax',
  M6: 'tauMax',
  M7: 'pCr',
  M8: 'sigmaMax',
  S1: 'RA',
  S2: 'R',
  S3: 'RA',
  S4: 'Pcrit',
  S5: 'RA',
  S6: 'ybar_mm',
  S7: 'F',
};

export function pickPrimaryAnswer(
  templateId: string,
  result: Record<string, number | string>,
): { key: string; value: number | string } | null {
  const registered = PRIMARY_ANSWER_KEY[templateId];
  if (registered && result[registered] !== undefined) {
    return { key: registered, value: result[registered] };
  }
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && Number.isFinite(value)) return { key, value };
  }
  return null;
}
