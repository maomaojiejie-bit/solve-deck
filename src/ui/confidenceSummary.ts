/**
 * W21-A A4 · 校验口径只有一个。
 *
 * 体验报告 5.5：同一屏上「六项全部通过」「4 通过 · 2 跳过」「校验通过 ·
 * 允许播放」三种说法并存，而且跳过的项藏在绿章里。顶部徽标、结论横幅、
 * 播放条页脚一律读这一个函数；跳过的项另外单独列明细。
 */

import type { ConfidenceReport } from '../core/types';

/** 通过 / 跳过 / 未通过 按 checks[] 实数计，不拿 6 去减。 */
export function confidenceSummary(report: ConfidenceReport): string {
  const checks = report.checks ?? [];
  const pass = checks.filter((item) => item.state === 'pass').length;
  const skip = checks.filter((item) => item.state === 'skipped').length;
  const fail = checks.filter((item) => item.state === 'fail').length;
  const parts = [`${pass} 通过`, `${skip} 跳过`];
  if (fail > 0) parts.push(`${fail} 未通过`);
  return parts.join(' · ');
}

/** 跳过项明细：名字 + 原因，展开给用户看，不混在绿章里。 */
export function skippedChecks(report: ConfidenceReport): { name: string; reason: string }[] {
  return (report.checks ?? [])
    .filter((item) => item.state === 'skipped')
    .map((item) => ({ name: item.name, reason: item.skipReason ?? '这一项没有适用的夹具' }));
}

/**
 * W21-A A5 · 展示层数值：4 位有效数字，整数原样保留（黑盒 #23：表内 4 位，
 * 与读数体检的 4 位对齐；完整精度不丢，只进「自检」抽屉）。
 */
const SIGNIFICANT = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 4,
  maximumSignificantDigits: 4,
  useGrouping: false,
});

export function formatDisplayValue(value: number | string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e6) return String(value);
  return SIGNIFICANT.format(value);
}
