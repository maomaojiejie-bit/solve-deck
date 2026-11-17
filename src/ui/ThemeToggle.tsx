import { useCallback, useRef, useState } from 'react';

type Theme = 'light' | 'dark';

/** View Transitions 还没进 lib.dom 的稳妥写法（不支持时就是 undefined）。 */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * 深色模式切换钮：只做一件事 —— 翻转 <html> 上的 data-theme，
 * 值的替换全部发生在 tokens.css 的 dark 变量层。
 * 首选项落在 localStorage('sd-theme')；**没有显式选择时默认深色**（不再跟随系统）
 * （由 index.html 的内联脚本在渲染前设置，避免首屏闪色）。
 *
 * 动效（motion.css ⑱）：主题是一整页颜色，硬切会像闪一下 —— 所以让新主题
 * 以按钮为圆心铺开。有 View Transitions 就用快照做圆形揭幕（连 body 的径向
 * 渐变一起过渡），没有就在 data-theme-switching 期间挂 320ms 颜色过渡兜底。
 * 两种都尊重 prefers-reduced-motion：那一刻直接换色，不做任何扩散。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;

    const apply = () => {
      root.dataset.theme = next;
      root.style.colorScheme = next;
      try {
        localStorage.setItem('sd-theme', next);
      } catch {
        /* 存储不可用（隐私模式等）：主题仅本次会话生效 */
      }
    };

    const doc = document as ViewTransitionDocument;
    const reduce = prefersReducedMotion();
    const node = buttonRef.current;

    if (reduce) {
      apply();
      setTheme(next);
      return;
    }

    if (node && typeof doc.startViewTransition === 'function') {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      // 圆要盖住最远的那个角，否则揭幕会在屏幕边上留下一条旧色
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.style.setProperty('--theme-x', `${Math.round(x)}px`);
      root.style.setProperty('--theme-y', `${Math.round(y)}px`);
      root.style.setProperty('--theme-r', `${Math.ceil(radius)}px`);
      const transition = doc.startViewTransition(apply);
      void transition.finished.finally(() => {
        root.style.removeProperty('--theme-x');
        root.style.removeProperty('--theme-y');
        root.style.removeProperty('--theme-r');
      });
      setTheme(next);
      return;
    }

    // 兜底：320ms 颜色过渡窗口，窗口一关立刻摘掉，不常驻
    root.dataset.themeSwitching = '1';
    apply();
    window.setTimeout(() => {
      delete root.dataset.themeSwitching;
    }, 340);
    setTheme(next);
  }, [theme]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="theme-toggle"
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? '切到浅色' : '切到深色'}
      onClick={toggle}
      className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-panel text-muted transition-colors hover:text-ink"
    >
      {/* key 换值 → 图标重挂 → 转 60° 落下（.theme-mark，见 motion.css ⑱） */}
      <span key={theme} className="theme-mark inline-flex">
        {theme === 'dark' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        )}
      </span>
    </button>
  );
}
