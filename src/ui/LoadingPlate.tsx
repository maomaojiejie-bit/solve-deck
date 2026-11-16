import type { CSSProperties } from 'react';

type Props = {
  /** 主句：正在做什么（一句话，动词开头）。 */
  title: string;
  /** 副句：这一步在等什么。加载态才显示。 */
  detail?: string;
  /** 失败态：一句话说清为什么没载入（不显示内部堆栈）。 */
  error?: string | null;
  /** 失败态的重试入口。 */
  onRetry?: () => void;
  testId?: string;
};

/**
 * 行内载入：只给一句话的位置（画布占位、快照占位）用的小号版本 ——
 * 一支 10px 的转针 + 同一句原文，不占版面、不加高度。
 */
export function LoadingInline({ text }: { text: string }) {
  return (
    <span className="lab-load-inline" role="status" aria-live="polite">
      <span className="lab-load-inline-ring" aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * 载入占位板：装配台 / 懒加载页面共用一套。
 * 只做三件事 —— 一支制图风格的转针、一句正在做什么、三条走光的占位条。
 * 动画全在 motion.css（⑲），prefers-reduced-motion 下整组停住、字还在。
 */
export function LoadingPlate({ title, detail, error = null, onRetry, testId }: Props) {
  const failed = Boolean(error);
  const bars: CSSProperties[] = [
    { width: 248, animationDelay: '0ms' },
    { width: 312, animationDelay: '120ms' },
    { width: 196, animationDelay: '240ms' },
  ];
  return (
    <div
      className="lab-load"
      data-error={failed ? '1' : '0'}
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-busy={failed ? undefined : true}
    >
      <div className="lab-load-mark" aria-hidden="true">
        <span className="lab-load-ring" />
        <span className="lab-load-ring lab-load-ring-in" />
        <span className="lab-load-plumb" />
      </div>
      <p className="lab-load-title">{title}</p>
      {failed ? (
        <>
          <p className="lab-load-sub lab-load-sub-fail">{error}</p>
          {onRetry ? (
            <button type="button" className="lab-chip focus-ring" onClick={onRetry}>
              重新载入
            </button>
          ) : null}
        </>
      ) : (
        <>
          {detail ? <p className="lab-load-sub">{detail}</p> : null}
          <div className="lab-load-bars" aria-hidden="true">
            {bars.map((style, index) => (
              <i key={index} style={style} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
