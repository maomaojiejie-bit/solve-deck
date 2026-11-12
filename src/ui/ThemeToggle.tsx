import { useCallback, useState } from 'react';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * 深色模式切换钮：只做一件事 —— 翻转 <html> 上的 data-theme，
 * 值的替换全部发生在 tokens.css 的 dark 变量层。
 * 首选项落在 localStorage('sd-theme')；初次访问跟随系统 prefers-color-scheme
 * （由 index.html 的内联脚本在渲染前设置，避免首屏闪色）。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem('sd-theme', next);
    } catch {
      /* 存储不可用（隐私模式等）：主题仅本次会话生效 */
    }
    setTheme(next);
  }, [theme]);

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? '切到浅色' : '切到深色'}
      onClick={toggle}
      className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-panel text-muted transition-colors hover:text-ink"
    >
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
    </button>
  );
}
