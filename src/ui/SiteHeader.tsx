import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

/**
 * 全站唯一表头
 * ---------------------------------------------------------------------------
 * 一眼看过去只有一条 60px 玻璃纸带：
 *   左：[← 返回] │ ◇ 拆解台 / 当前页 ┊注释
 *   右：知识库 · 解题▾ · 数字求值 · 范围 · 我的 · 关于 · 页面专属 · ☀
 *
 * 为什么要收成组件：之前十条 header 各写各的 —— 高度 52 / 56 / 60px 三种、
 * 底色 bg/85 与 bg/92 两种、返回键有纯文字也有描边胶囊、导航顺序每页不一样
 * （装配台在右上、数字求值在左上另一套）。换一页就像换了个站。
 * 现在样式只有这一处：要变体就加 prop，别再抄一份 header；改外观只改这里和
 * tokens.css 的 `.site-header`。
 *
 * 门禁约定（别动）：
 *   · 外层必须还是 <header><div> —— check-labshell 量的是 header > div 的宽度；
 *   · 宽度上限走 style.maxWidth（写成 Tailwind 的固定像素宽类会被响应式门禁判死）；
 *   · 首页那三个 testid（nav-solve / solve-panel / solve-panel-lab）就在下面。
 */

/** 导航链接统一样式：页面专属入口也用这个，别自创一份。 */
export const SITE_LINK = 'focus-ring text-[13px] text-muted transition-colors hover:text-ink';

/** 当前页高亮（不可点的自身链接换成这个）。 */
const SITE_CURRENT = 'text-[13px] text-ink';

/** 导航里出现的页签（比 SitePage 少 lab / solve / wizard / result 这些不在导航里的）。 */
type SitePageBase = 'kb' | 'digital' | 'scope' | 'mine' | 'about';

/** 全站导航顺序 —— 所有页面共用一份，改顺序只改这里。 */
const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; page: SitePageBase; clamp?: string }> = [
  { href: '#/kb', label: '知识库', page: 'kb' },
  { href: '#/lab/digital', label: '数字求值', page: 'digital', clamp: 'hidden sm:inline' },
  { href: '#/scope', label: '范围', page: 'scope', clamp: 'hidden sm:inline' },
  { href: '#/mine', label: '我的', page: 'mine' },
  { href: '#/about', label: '关于', page: 'about', clamp: 'hidden md:inline' },
];

export type SitePage =
  | 'kb'
  | 'digital'
  | 'scope'
  | 'lab'
  | 'mine'
  | 'about'
  | 'solve'
  | 'wizard'
  | 'result';

type Props = {
  /** 当前页，用来高亮导航（没有对应项就不高亮）。 */
  page?: SitePage;
  /** 品牌后面的当前页名；也可以直接给一段节点（结果页那种密集控制簇）。 */
  title?: ReactNode;
  /** 页名右边的一句话注释，宽屏才出（装配台：改结构，不改求解器）。 */
  note?: string;
  /** 有它就出「← 返回」。 */
  onBack?: () => void;
  backLabel?: string;
  /** 内容区宽度上限：默认 1120，装配台 1440，结果页 1600。 */
  width?: number;
  /** 页面专属入口（看原题 / 装配台 / 去解题 / GitHub），排在统一导航之后。 */
  extra?: ReactNode;
  /** 层级，默认 40（结果页 30）。 */
  z?: string;
  /** 打印时整条隐藏，默认 true。 */
  hideOnPrint?: boolean;
  /** 固定在顶部，默认 true（结果页嵌入讲解稿时给 false）。 */
  sticky?: boolean;
  className?: string;
};

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M4 20V6l8 4 8-4v14l-8-4-8 4Z" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 10v8" stroke="var(--color-cyan)" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * 「解题」二选一面板（就地展开，不是新页面）。
 * 以前只有首页有；现在全站都有 —— 从任意页都能一步到「按模板解 / 自己拼」。
 */
function SolveMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement | null>(null);

  // 点外面收起
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <span className="relative shrink-0" ref={box}>
      <button
        type="button"
        data-testid="nav-solve"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={active ? SITE_CURRENT : SITE_LINK}
      >
        解题
      </button>
      {open ? (
        <div
          data-testid="solve-panel"
          className="absolute right-0 top-9 z-40 w-[260px] rounded-[4px] border border-line-2 bg-panel p-2 shadow-lg"
        >
          <a
            href="#/solve"
            data-testid="solve-panel-template"
            onClick={() => setOpen(false)}
            className="focus-ring block rounded-[3px] px-3 py-2.5 transition-colors hover:bg-panel-2"
          >
            <span className="block text-[13px] text-ink">① 按模板解</span>
            <span className="mt-0.5 block text-[11px] text-faint">选一道熟悉的题型</span>
          </a>
          <a
            href="#/lab"
            data-testid="solve-panel-lab"
            onClick={() => setOpen(false)}
            className="focus-ring block rounded-[3px] px-3 py-2.5 transition-colors hover:bg-panel-2"
          >
            <span className="block text-[13px] text-ink">② 自己拼</span>
            <span className="mt-0.5 block text-[11px] text-faint">在画布上搭结构</span>
          </a>
        </div>
      ) : null}
    </span>
  );
}

export function SiteHeader({
  page,
  title,
  note,
  onBack,
  backLabel = '返回',
  width = 1120,
  extra,
  z = 'z-40',
  hideOnPrint = true,
  sticky = true,
  className = '',
}: Props) {
  /* 窄屏省位：标题和当前页签同名时（知识库页写「知识库」），导航里已经高亮了一个，
     手机上就只留一个，别把 390px 挤成「我的 · 知识库 · 解题 · 我的」。 */
  const duplicatedOnMobile = typeof title === 'string' && NAV_ITEMS.some((item) => item.page === page && item.label === title);
  return (
    <header
      className={['site-header', hideOnPrint ? 'no-print' : '', sticky ? 'sticky top-0' : '', z, className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="mx-auto flex h-full w-full items-center gap-3 px-6 sm:gap-4" style={{ maxWidth: width }}>
        {onBack ? (
          <>
            <button
              type="button"
              onClick={onBack}
              aria-label={`返回上一页（${backLabel}）`}
              className={`${SITE_LINK} shrink-0`}
            >
              ← {backLabel}
            </button>
            <span className="h-4 w-px shrink-0 bg-[var(--color-line-2)]" aria-hidden="true" />
          </>
        ) : null}

        <a href="#/" aria-label="拆解台首页" className="focus-ring flex shrink-0 items-center gap-2.5">
          <BrandMark />
          <span className="hidden text-[15px] font-semibold tracking-[-0.01em] text-ink sm:inline">拆解台</span>
          <span className="hidden font-mono text-[10.5px] tracking-[0.12em] text-faint sm:inline">v0.3</span>
        </a>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {title ? (
            <>
              <span className="hidden text-[13px] text-faint sm:inline" aria-hidden="true">
                /
              </span>
              {typeof title === 'string' ? (
                <span
                  className={`shrink-0 truncate text-[13px] text-muted ${duplicatedOnMobile ? 'hidden sm:inline' : ''}`}
                >
                  {title}
                </span>
              ) : (
                title
              )}
            </>
          ) : null}
          {note ? (
            <span className="hidden shrink-0 font-mono text-[10.5px] tracking-[0.12em] text-faint lg:inline">
              {note}
            </span>
          ) : null}
        </div>

        <nav
          className="ml-auto flex shrink-0 items-center gap-4 whitespace-nowrap sm:gap-6 md:gap-8"
          aria-label="全站导航"
        >
          <a href="#/kb" className={page === 'kb' ? SITE_CURRENT : SITE_LINK} aria-current={page === 'kb' ? 'page' : undefined}>
            知识库
          </a>
          <SolveMenu active={page === 'solve'} />
          {NAV_ITEMS.filter((item) => item.page !== 'kb').map((item) => {
            const body =
              page === item.page ? (
                <span className={SITE_CURRENT} aria-current="page">
                  {item.label}
                </span>
              ) : (
                <a href={item.href} className={SITE_LINK}>
                  {item.label}
                </a>
              );
            return item.clamp ? (
              <span key={item.label} className={item.clamp}>
                {body}
              </span>
            ) : (
              <span key={item.label} className="shrink-0">
                {body}
              </span>
            );
          })}
          {extra ? <span className="shrink-0">{extra}</span> : null}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
