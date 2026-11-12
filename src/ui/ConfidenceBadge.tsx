import type { ConfidenceReport } from '../core/types';
import { isFullyValidated } from '../confidence/confidence.ts';
import { confidenceSummary } from './confidenceSummary.ts';

export type ConfidenceTone = 'green' | 'gray' | 'red';

/**
 * 灰牌：stale（参数改过待重算）、或 skipped 未完整校验；
 * 绿牌：六项全 pass 且 paths/residual 都真的 pass；
 * 红牌：有 fail / 无理由 skipped。
 */
export function confidenceTone(
  report: ConfidenceReport,
  stale = false,
): ConfidenceTone {
  if (stale) return 'gray';
  if (report.failedCount > 0) return 'red';
  if (isFullyValidated(report)) return 'green';
  const allSkippedWithReason =
    report.checks.length > 0 &&
    report.checks.every((item) => item.state === 'skipped' && Boolean(item.skipReason));
  if (report.allPassed || allSkippedWithReason) return 'gray';
  return 'red';
}

const TONE_CLASS: Record<ConfidenceTone, string> = {
  green: 'border-ok/40 bg-ok/10 text-ok',
  gray: 'border-line bg-ink/5 text-muted',
  red: 'border-danger/40 bg-danger/10 text-danger',
};

const TONE_LABEL: Record<ConfidenceTone, string> = {
  green: '已校验',
  gray: '未校验预览',
  red: '校验未通过',
};

interface ConfidenceBadgeProps {
  report: ConfidenceReport;
  validatedAt?: string;
  contractVersion?: string;
  stale?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

export function ConfidenceBadge({
  report,
  validatedAt,
  contractVersion,
  stale = false,
  expanded,
  onToggle,
}: ConfidenceBadgeProps) {
  const tone = confidenceTone(report, stale);
  const label = stale ? '已改动，待重算' : TONE_LABEL[tone];
  // W21-A A4：与结论横幅、播放条页脚同一个口径，跳过的项不记成通过。
  const count = confidenceSummary(report);
  const title = validatedAt
    ? `validatedAt: ${validatedAt}${contractVersion ? ` · contract ${contractVersion}` : ''}`
    : undefined;
  return (
    <button
      type="button"
      data-tone={tone}
      onClick={onToggle}
      aria-expanded={expanded}
      title={title}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors hover:brightness-110 ${TONE_CLASS[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
      <span className="opacity-70">· {count}</span>
    </button>
  );
}
