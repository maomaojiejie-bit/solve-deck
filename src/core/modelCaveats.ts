/**
 * R-38 · 模型前提提示（纯函数，门禁可断言）。
 *
 * 有些题的求解器刻意用「理想元件 + 无限电源轨」的简化模型，图上因此不画
 * 供电结点。学生看到「没有 Vcc 却求出静态工作点」会以为程序算错了 —— 与其
 * 藏起来，不如把模型假设和适用边界写在结果页上，并在数值逼近真实电源轨时
 * 主动点名。这里只做说明，不改任何求解数值（golden 快照不受影响）。
 */
export interface ModelCaveat {
  title: string;
  body: string;
  /** 数值逼近真实器件极限时的额外提醒。 */
  warning?: string;
}

/** 常见双电源运放轨 ±15 V，留 3 V 余量后开始预警。 */
export const OPAMP_RAIL_HINT = 12;

export function modelCaveatFor(
  templateId: string,
  result?: Record<string, number | string>,
): ModelCaveat | null {
  if (templateId !== 'A6') return null;
  const vout = Number(result?.Vout);
  const warning = Number.isFinite(vout) && Math.abs(vout) > OPAMP_RAIL_HINT
    ? `本次 |Vout| = ${Number(Math.abs(vout).toPrecision(4))} V 已逼近常见 ±15 V 供电轨；真实运放会进入饱和 / 削波，这个线性解不再适用。`
    : undefined;
  return {
    title: '模型前提 · 理想运放不画供电轨',
    body: '图上只有输入信号源与地，没有 ±Vcc 结点：这里把运放输出建模为受控电压源 Vout = Aol·(Vp − Vn)，假设供电轨无限、输入电流为零，所以不需要电源符号也能解出线性静态工作点。该模型不判断饱和、不限制输出摆幅 —— 真实电路请自行把 |Vout| 与实际电源轨比较。',
    warning,
  };
}
