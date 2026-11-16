import type { ReactNode } from 'react';

/**
 * 黑盒 #31：全站同一套导航、同一顺序（知识库 · 数字求值 · 范围 · 页面专属）。
 * 以前装配台在右上、数字求值在左上另一套顺序，同一功能换页就搬家。
 * `current` 高亮当前页（aria-current），`children` 放页面专属入口（看原题 / 装配台）。
 */
export function SiteNav({
  current,
  children,
}: {
  current?: 'kb' | 'digital' | 'scope' | 'lab';
  children?: ReactNode;
}) {
  const item = (href: string, label: string, key: 'kb' | 'digital' | 'scope', hiddenOnMobile = false) => {
    const body =
      current === key ? (
        <span className="text-[13px] text-ink" aria-current="page">
          {label}
        </span>
      ) : (
        <a href={href} className="focus-ring text-[13px] text-muted transition-colors hover:text-ink">
          {label}
        </a>
      );
    return hiddenOnMobile ? <span className="hidden sm:inline">{body}</span> : body;
  };
  return (
    <nav className="ml-auto flex shrink-0 items-center gap-5 whitespace-nowrap sm:gap-7" aria-label="全站导航">
      {item('#/kb', '知识库', 'kb')}
      {item('#/lab/digital', '数字求值', 'digital')}
      {item('#/scope', '范围', 'scope', true)}
      {children}
    </nav>
  );
}
