/**
 * #/mine · 我的：收藏 / 最近使用 / 题型覆盖 / 本机数据。
 *
 * 数据链和装配台是同一条，不是第二套：
 *   · 存储仍是 core/lab/library.ts 的 sd.lab.library.v1（同一把键、同一批纯函数改它）
 *   · 打开仍是 libraryHref() → #/lab/t/<id>?g=…，与「分享此图 / 刷新恢复」同一解码分支
 *   · 排序仍是 loadLibrarySort / sortFavorites，题型标题仍取 getTemplateRoute().entry.title
 *
 * 视觉走站内那一套（跟主页同一套 token / 同一批动效原语）：card + elev + kicker + 1px 墨线 + 青色强调，
 * 动效全部取 ui/motion.tsx 的 Reveal / Spotlight / Tilt / Magnetic / Marquee / Typewriter / DecodeText / CountUp，
 * 不另起一套玻璃样式。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { getTemplateRoute } from '../core/templates/registry';
import { PICKS } from '../core/lab/picks.ts';
import {
  FAVORITE_LIMIT,
  HISTORY_LIMIT,
  LIBRARY_STORAGE_KEY,
  clearHistory,
  libraryHref,
  loadLibrary,
  loadLibrarySort,
  parseTags,
  relativeTime,
  removeFavorite,
  renameFavorite,
  saveLibrary,
  saveLibrarySort,
  setFavoriteTags,
  sortFavorites,
  type LabLibrary,
  type LibrarySort,
  type SavedGraph,
} from '../core/lab/library';
import { copyText } from '../ui/clipboard.ts';
import { downloadBlob } from '../ui/exportGraph';
import { SiteNav } from '../ui/SiteNav';
import { ThemeToggle } from '../ui/ThemeToggle';
import {
  CountUp,
  DecodeText,
  Marquee,
  Magnetic,
  Spotlight,
  Tilt,
  Typewriter,
} from '../ui/motion';

/** 错峰用：把第 n 个元素的延迟写成 CSS 变量（站内 .rv / .marquee 都读 --d）。 */
function revealDelay(ms: number): CSSProperties {
  return { '--d': `${ms}ms` } as CSSProperties;
}

/** 滚动显现：样式用站内 motion.css 的 .rv，这里只负责进视口时把 data-in 置 1（一次）。 */
function useRevealAll(signature: string) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.rv:not([data-in="1"])'));
    if (nodes.length === 0) return;
    if (!('IntersectionObserver' in window)) {
      for (const node of nodes) node.dataset.in = '1';
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.dataset.in = '1';
          io.unobserve(el);
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    for (const node of nodes) io.observe(node);
    return () => io.disconnect();
  }, [signature]);
}

/** 带倾斜 + 聚光灯的卡片（hooks 不能在 map 里调，所以包成组件）。 */
function TiltBox({
  children,
  className = '',
  delay = 0,
  max = 4,
  as = 'div',
  testId,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  max?: number;
  as?: 'div' | 'article';
  testId?: string;
}) {
  const inner = as === 'article' ? 'article' : 'div';
  const Inner = inner;
  return (
    <Spotlight className={`rv ${className}`} style={revealDelay(delay)}>
      <Tilt max={max} className="h-full">
        <Inner className="flex h-full flex-col" data-testid={testId}>
          {children}
        </Inner>
      </Tilt>
    </Spotlight>
  );
}

/** 题型标题：变体 id（M3-cantilever 之类）也能取到，取不到就退回 id。 */
function titleOf(templateId: string): string {
  return getTemplateRoute(templateId)?.entry.title ?? templateId;
}

/**
 * 覆盖统计只认装配台真能打开的那 16 型（`PICKS` 白名单）。
 * 注册表里另有数字逻辑 D1–D6 等不进装配台的题型 —— 摆在这儿会让「点一下进装配台」变成死链。
 * 顺序按 A / M / S 分组、组内数字序，读起来和装配台索引页一致。
 */
function labTemplateIds(): string[] {
  const rank = (id: string) => {
    const head = id[0];
    const order = head === 'A' ? 0 : head === 'M' ? 1 : 2;
    const num = Number(/(\d+)/.exec(id.slice(1))?.[1] ?? 0);
    return order * 1000 + num + (id.includes('-') ? 0.5 : 0);
  };
  /* 放在函数里而不是模块顶层：顶层 IIFE 会在循环依赖里撞上 TDZ（PICKS 还没初始化）。 */
  return Object.keys(PICKS).sort((a, b) => rank(a) - rank(b));
}

type EditState = { id: string; name: string; tags: string } | null;


export function Mine({
  onBack,
  onStart,
  onToast,
}: {
  onBack: () => void;
  onStart: (hash: string) => void;
  onToast?: (message: string) => void;
}) {
  const [library, setLibrary] = useState<LabLibrary>(() => loadLibrary());
  const [sort, setSort] = useState<LibrarySort>(() => loadLibrarySort());
  const [keyword, setKeyword] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(null);
  /** 清空是破坏性动作：两个入口各自要先「按下一次」，第二次才真的清。 */
  const [armed, setArmed] = useState<'all' | 'history' | null>(null);

  /** 所有写入都过这里：先落内存再落盘，和装配台用的同一个 saveLibrary。 */
  const commit = useCallback((next: LabLibrary) => {
    setLibrary(next);
    saveLibrary(next);
  }, []);

  /** 别的标签页（或者装配台那段代码）改了同一个键，这一页要跟着变。 */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LIBRARY_STORAGE_KEY) setLibrary(loadLibrary());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const favorites = useMemo(() => sortFavorites(library.favorites, sort), [library.favorites, sort]);

  const allTags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const item of library.favorites) {
      for (const entry of item.tags ?? []) counter.set(entry, (counter.get(entry) ?? 0) + 1);
    }
    return [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [library.favorites]);

  const query = keyword.trim().toLowerCase();
  const match = useCallback(
    (item: SavedGraph) => {
      if (tag && !(item.tags ?? []).includes(tag)) return false;
      if (!query) return true;
      return [item.title, item.templateId, titleOf(item.templateId), ...(item.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(query);
    },
    [query, tag],
  );

  const shownFavorites = favorites.filter(match);
  const shownHistory = library.history.filter(match);

  /** 覆盖统计：最近使用 ∪ 收藏 里出现过的题型。 */
  const touched = useMemo(() => {
    const map = new Map<string, { count: number; at: number }>();
    for (const item of [...library.favorites, ...library.history]) {
      const prev = map.get(item.templateId);
      map.set(item.templateId, {
        count: (prev?.count ?? 0) + 1,
        at: Math.max(prev?.at ?? 0, item.at),
      });
    }
    return map;
  }, [library.favorites, library.history]);

  const LAB_TEMPLATES = useMemo(() => labTemplateIds(), []);
  const totalTemplates = LAB_TEMPLATES.length;
  const lastAt = useMemo(
    () => [...library.favorites, ...library.history].reduce((max, item) => Math.max(max, item.at), 0),
    [library.favorites, library.history],
  );

  const open = (entry: SavedGraph) => onStart(libraryHref(entry));

  const copyLink = async (entry: SavedGraph) => {
    const url = `${window.location.origin}${window.location.pathname}${libraryHref(entry)}`;
    const ok = await copyText(url);
    onToast?.(ok ? `已复制「${entry.title}」的链接` : '浏览器没给剪贴板权限 —— 链接是：' + url);
  };

  const exportJson = () => {
    const body = JSON.stringify(
      { exportedAt: new Date().toISOString(), storageKey: LIBRARY_STORAGE_KEY, ...library },
      null,
      2,
    );
    downloadBlob(new Blob([body], { type: 'application/json' }), '拆解台-我的记录.json');
    onToast?.('已导出 JSON（含每张图的完整 ?g= 载荷）');
  };

  const commitEdit = () => {
    if (!edit) return;
    const entry = library.favorites.find((item) => item.id === edit.id);
    if (!entry) return;
    /* 与装配台同一路径：改名走 renameFavorite（空名不收），标签走 setFavoriteTags（去重最多 6 个）。 */
    let next = renameFavorite(library, edit.id, edit.name);
    next = setFavoriteTags(next, edit.id, parseTags(edit.tags));
    commit(next);
    setEdit(null);
  };

  /* 过滤 / 排序 / 增删都会换一批节点，signature 变了就重新接管显现 */
  useRevealAll(`${sort}|${query}|${tag ?? ''}|${library.favorites.length}|${library.history.length}`);

  return (
    <div className="min-h-screen" data-testid="mine-stage">

      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-6">
          <button
            type="button"
            onClick={onBack}
            className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink shrink-0"
            aria-label="返回上一页"
          >
            ← 返回
          </button>
          <span className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink shrink-0">我的</span>
          <span className="kicker hidden shrink-0 sm:inline">存这台浏览器</span>
          <SiteNav current="mine" />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] px-6 pb-20 pt-10">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="rv pt-16 sm:pt-24" style={revealDelay(0)}>
          <div className="flex items-center gap-3">
            <span className="tag-mono">
              <span className="inline-block h-1 w-1 rounded-full bg-cyan" />
              <Typewriter text="LOCAL ARCHIVE · 存这台浏览器" speed={34} delay={140} />
            </span>
            <span className="draft-rule flex-1" />
            <span className="id-mono text-faint tabular-nums">
              {library.favorites.length + library.history.length} 条
            </span>
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-[52px] mt-6" data-testid="mine-title">
            <DecodeText text="我的" />
          </h1>
          <p className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-5 tabular-nums" data-testid="mine-lead">
            <span className="text-cyan">
              <CountUp value={library.favorites.length} decimals={0} />
            </span>{' '}
            份收藏 · <CountUp value={library.history.length} decimals={0} /> 条最近 · 碰过{' '}
            <span className="text-cyan">
              <CountUp value={touched.size} decimals={0} />
            </span>{' '}
            / {totalTemplates} 型
          </p>
          <p className="text-[14.5px] leading-[1.9] text-muted mt-5 max-w-[64ch]">
            这里每一条都是装配台上的一整张图（连改动一起编码在链接里），点开就回到原样、可以接着改。
            记录只写在这台浏览器（<span className="id-mono">{LIBRARY_STORAGE_KEY}</span>），
            换设备、清缓存都不会跟着走 —— 要带走就用下面的「导出 JSON」。
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Magnetic>
              <button
                type="button"
                data-testid="mine-cta-lab"
                onClick={() => onStart('#/lab')}
                className="sheen focus-ring group inline-flex h-11 items-center gap-2 bg-cyan px-5 text-[13px] font-medium text-white"
              >
                去装配台挑一张骨架
                <span aria-hidden="true">→</span>
              </button>
            </Magnetic>
            <span className="text-[11.5px] leading-5 text-muted">
              最近一次 · <span className="text-ink">{lastAt ? relativeTime(lastAt) : '还没动过'}</span>
            </span>
          </div>
        </section>

        {/* ── 跑马灯：16 型骨架长什么样，先扫一眼（纯装饰，真正的入口在下面） ── */}
        <div className="rv mt-24 border-y border-line py-3" style={revealDelay(80)}>
          <Marquee items={LAB_TEMPLATES.map((id) => `${id} · ${titleOf(id)}`)} speed={64} />
        </div>

        {/* ── 概览：四个数，都是从上一次渲染结果现算的 ──────────────── */}
        <section
          data-testid="mine-stats"
          className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="概览"
        >
          {[
            {
              label: '收藏',
              count: library.favorites.length,
              note: `上限 ${FAVORITE_LIMIT} 份`,
            },
            {
              label: '最近使用',
              count: library.history.length,
              note: `每型只留最新 · 上限 ${HISTORY_LIMIT}`,
            },
            {
              label: '碰过的题型',
              count: touched.size,
              note: touched.size > 0 ? `共 ${totalTemplates} 型` : '还没碰过任何题型',
            },
            {
              label: '最近一次',
              text: lastAt ? relativeTime(lastAt) : '—',
              note: lastAt ? '按本机时间算' : '还没动过',
            },
          ].map((tile, index) => (
            <TiltBox
              key={tile.label}
              className="card elev rounded-2xl"
              delay={120 + index * 70}
              max={4}
            >
              <p className="kicker">{tile.label}</p>
              <p className="text-[32px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums mt-2">
                {'text' in tile && tile.text ? tile.text : <CountUp value={tile.count ?? 0} decimals={0} />}
              </p>
              <p className="text-[11.5px] leading-5 text-muted mt-2">{tile.note}</p>
            </TiltBox>
          ))}
        </section>

        {/* ── 过滤 + 标签 ──────────────────────────────────────────── */}
        <section className="card elev rounded-2xl rv mt-16 px-6 py-6 sm:px-8" style={revealDelay(0)}>
          <div className="flex flex-wrap items-center gap-4">
            <label className="kicker shrink-0" htmlFor="mine-filter-input">
              过滤
            </label>
            <input
              id="mine-filter-input"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="名称、题型 id、标签都参与，如「分压」「M3」"
              aria-label="过滤我的记录"
              data-testid="mine-filter"
              className="focus-ring h-9 border border-line-2 bg-panel px-3 text-[13px] text-ink outline-none transition-colors focus:border-cyan max-w-[420px] flex-1"
            />
            <span className="text-[11.5px] leading-5 text-muted tabular-nums" data-testid="mine-filter-count">
              收藏 {shownFavorites.length}/{library.favorites.length} · 最近 {shownHistory.length}/
              {library.history.length}
            </span>
            {query || tag ? (
              <button
                type="button"
                onClick={() => {
                  setKeyword('');
                  setTag(null);
                }}
                className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink"
              >
                清过滤
              </button>
            ) : null}
          </div>

          {allTags.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="kicker">标签</span>
              {allTags.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  data-testid="mine-tag"
                  data-on={tag === name ? '1' : '0'}
                  aria-pressed={tag === name}
                  onClick={() => setTag(tag === name ? null : name)}
                  className={`focus-ring inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11.5px] transition-colors ${
                    tag === name
                      ? 'border-cyan bg-cyan/10 text-cyan'
                      : 'border-line text-muted hover:border-cyan/50 hover:text-ink'
                  }`}
                >
                  #{name}
                  <span className="text-faint tabular-nums">{count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {/* ── 我的收藏 ─────────────────────────────────────────────── */}
        <section data-testid="mine-favorites" className="mt-32">
          <div className="rv flex flex-wrap items-end gap-x-4 gap-y-2" style={revealDelay(0)}>
            <div>
              <p className="kicker">favorites</p>
              <h2 className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-1">我的收藏</h2>
            </div>
            <p className="text-[11.5px] leading-5 text-muted pb-1">同一个题型可以存多份；在装配台点「☆ 收藏」存的就是这里</p>
            <label className="ml-auto flex items-center gap-2 pb-1">
              <span className="kicker whitespace-nowrap">排序</span>
              <select
                data-testid="mine-sort"
                aria-label="收藏排序"
                value={sort}
                onChange={(event) => {
                  const next = event.target.value as LibrarySort;
                  setSort(next);
                  saveLibrarySort(next);
                }}
                className="focus-ring h-9 border border-line-2 bg-panel px-3 text-[13px] text-ink outline-none transition-colors focus:border-cyan w-[132px] py-2 text-[14px]"
              >
                <option value="recent">最近收藏</option>
                <option value="name">按名称</option>
                <option value="template">按题型</option>
              </select>
            </label>
          </div>

          {library.favorites.length === 0 ? (
            <div
              className="card elev rounded-2xl rv mt-6 px-8 py-12 text-center"
              style={revealDelay(60)}
              data-testid="mine-favorites-empty"
            >
              <p className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink">还没有收藏</p>
              <p className="text-[14.5px] leading-[1.9] text-muted mt-2">在装配台把图改到能算，点右上「☆ 收藏」就能存一份。</p>
              <button
                type="button"
                data-testid="mine-go-lab"
                onClick={() => onStart('#/lab')}
                className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink mt-6"
              >
                去装配台挑一张骨架 →
              </button>
            </div>
          ) : shownFavorites.length === 0 ? (
            <p className="card elev rounded-2xl mt-6 px-6 py-6 text-[11.5px] leading-5 text-muted" data-testid="mine-favorites-filtered">
              当前过滤条件下没有收藏。
            </p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shownFavorites.map((item, index) => {
                // 收藏时存下来的名字常是「M3 · 弯曲内力…」这种带题型前缀的写法，
                // 上面一行已经印了 templateId，这里把前缀剥掉再比一次，避免同一句话出现两遍。
                const bare = titleOf(item.templateId);
                const prefix = `${item.templateId} · `;
                const shownTitle = item.title.startsWith(prefix) ? item.title.slice(prefix.length) : item.title;
                return (
                  <TiltBox
                    key={item.id}
                    as="article"
                    className="card elev rounded-2xl flex flex-col p-6"
                    delay={index * 60}
                    testId="mine-favorite-card"
                  >
                    <button type="button" onClick={() => open(item)} className="block w-full text-left">
                      <p className="kicker tabular-nums">
                        {item.templateId} · {relativeTime(item.at)}
                      </p>
                      <p className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-2 truncate" style={{ fontSize: 18 }}>
                        {shownTitle}
                      </p>
                      {shownTitle === bare ? null : <p className="text-[11.5px] leading-5 text-muted mt-1 truncate">{bare}</p>}
                      <p className="text-[11.5px] leading-5 text-muted mt-2 opacity-80">
                        {item.dirty ? '已改动 · 带回装配图' : '骨架 · 干净链接'}
                      </p>
                    </button>

                    {item.tags && item.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.map((name) => (
                          <span key={name} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink px-2 py-0.5 text-[11px]">
                            #{name}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-auto flex flex-wrap gap-2 pt-5">
                      <button
                        type="button"
                        data-testid="mine-favorite-edit"
                        aria-label={`改名或加标签 ${item.title}`}
                        onClick={() => setEdit({ id: item.id, name: item.title, tags: (item.tags ?? []).join(', ') })}
                        className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink"
                      >
                        改名 / 标签
                      </button>
                      <button
                        type="button"
                        data-testid="mine-favorite-link"
                        aria-label={`复制 ${item.title} 的链接`}
                        onClick={() => void copyLink(item)}
                        className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink"
                      >
                        取链接
                      </button>
                      <button
                        type="button"
                        data-testid="mine-favorite-remove"
                        aria-label={`取消收藏 ${item.title}`}
                        onClick={() => {
                          commit(removeFavorite(library, item.id));
                          onToast?.(`已取消收藏「${item.title}」`);
                        }}
                        className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-danger/60 hover:text-danger"
                      >
                        取消收藏
                      </button>
                    </div>

                    {edit?.id === item.id ? (
                      <div data-testid="mine-edit-form" className="mt-4 space-y-2 border-t pt-4">
                        <input
                          type="text"
                          aria-label="收藏名称"
                          value={edit.name}
                          onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                          className="focus-ring h-9 border border-line-2 bg-panel px-3 text-[13px] text-ink outline-none transition-colors focus:border-cyan"
                        />
                        <input
                          type="text"
                          aria-label="收藏标签"
                          placeholder="标签用逗号分隔，如 分压, 作业"
                          value={edit.tags}
                          onChange={(event) => setEdit({ ...edit, tags: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitEdit();
                            if (event.key === 'Escape') setEdit(null);
                          }}
                          className="focus-ring h-9 border border-line-2 bg-panel px-3 text-[13px] text-ink outline-none transition-colors focus:border-cyan"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            data-testid="mine-edit-save"
                            onClick={commitEdit}
                            className="focus-ring inline-flex items-center gap-1.5 border border-cyan bg-cyan/10 px-2.5 py-1 text-[11.5px] text-cyan transition-colors hover:bg-cyan/15"
                          >
                            保存
                          </button>
                          <button type="button" onClick={() => setEdit(null)} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </TiltBox>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 最近使用 ─────────────────────────────────────────────── */}
        <section data-testid="mine-history" className="mt-32">
          <div className="rv flex flex-wrap items-end gap-x-4 gap-y-2" style={revealDelay(0)}>
            <div>
              <p className="kicker">recent</p>
              <h2 className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-1">最近使用</h2>
            </div>
            <p className="text-[11.5px] leading-5 text-muted pb-1">改过的图自动记一条（每型只留最新）</p>
            {library.history.length > 0 ? (
              <button
                type="button"
                data-testid="mine-clear-history"
                onClick={() => setArmed(armed === 'history' ? null : 'history')}
                className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-danger/60 hover:text-danger ml-auto mb-1"
              >
                清空
              </button>
            ) : null}
          </div>

          {/* 破坏性动作：先说清后果，再给「确认 / 取消」两个键 */}
          {armed === 'history' ? (
            <div
              data-testid="mine-confirm-history"
              className="card elev rounded-2xl rv mt-5 flex flex-wrap items-center gap-3 px-5 py-4"
              style={revealDelay(0)}
            >
              <span className="text-[11.5px] leading-5 text-muted">
                会清掉 {library.history.length} 条最近使用（收藏不受影响，链接也不受影响）—— 确认吗？
              </span>
              <button
                type="button"
                data-testid="mine-confirm-history-yes"
                onClick={() => {
                  commit(clearHistory(library));
                  setArmed(null);
                  onToast?.('已清空最近使用');
                }}
                className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-danger/60 hover:text-danger"
              >
                确认清空
              </button>
              <button type="button" onClick={() => setArmed(null)} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
                取消
              </button>
            </div>
          ) : null}

          {library.history.length === 0 ? (
            <p className="card elev rounded-2xl mt-6 px-6 py-10 text-center text-[11.5px] leading-5 text-muted" data-testid="mine-history-empty">
              还没有记录 —— 在装配台上改动一张图就会出现在这里。
            </p>
          ) : shownHistory.length === 0 ? (
            <p className="card elev rounded-2xl mt-6 px-6 py-6 text-[11.5px] leading-5 text-muted">当前过滤条件下没有最近记录。</p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shownHistory.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid="mine-history-card"
                  onClick={() => open(item)}
                  className="card elev rv block p-6 text-left"
                  style={revealDelay(index * 55)}
                >
                  <p className="kicker tabular-nums">
                    {item.templateId} · {relativeTime(item.at)}
                  </p>
                  <p className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-2 truncate" style={{ fontSize: 18 }}>
                    {item.title}
                  </p>
                  <p className="text-[11.5px] leading-5 text-muted mt-2 opacity-80">{item.dirty ? '已改动 · 带回装配图' : '骨架'}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── 题型覆盖 ─────────────────────────────────────────────── */}
        <section data-testid="mine-coverage" className="mt-32">
          <div className="rv" style={revealDelay(0)}>
            <p className="kicker">coverage</p>
            <h2 className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-1">
              题型覆盖{' '}
              <span className="ml-3 text-[11.5px] font-normal leading-5 text-muted tabular-nums">
                碰过{' '}
                <span className="text-cyan">
                  <CountUp value={touched.size} decimals={0} />
                </span>{' '}
                / {totalTemplates} 型
              </span>
            </h2>
          </div>
          <div className="rv mt-6 flex flex-wrap gap-2" style={revealDelay(60)}>
            {LAB_TEMPLATES.map((id) => {
              const hit = touched.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  data-testid="mine-coverage-chip"
                  data-touched={hit ? '1' : '0'}
                  data-on={hit ? '1' : '0'}
                  onClick={() => onStart(`#/lab/t/${encodeURIComponent(id)}`)}
                  title={titleOf(id)}
                  className={`focus-ring id-mono inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11.5px] transition-colors ${
                    hit
                      ? 'border-cyan/40 bg-cyan/5 text-ink hover:border-cyan'
                      : 'border-line text-faint hover:border-cyan/50 hover:text-ink'
                  }`}
                >
                  {id}
                  {hit && hit.count > 1 ? <span className="text-faint tabular-nums">×{hit.count}</span> : null}
                </button>
              );
            })}
            {touched.size < totalTemplates ? (
              <button type="button" onClick={() => onStart('#/lab')} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
                还有 {totalTemplates - touched.size} 型没碰过 →
              </button>
            ) : null}
          </div>
        </section>

        {/* ── 本机数据 ─────────────────────────────────────────────── */}
        <section
          data-testid="mine-data"
          className="card elev rv mt-32 px-8 py-8"
          style={{ ...revealDelay(0), borderRadius: 32 }}
        >
          <p className="kicker">on this device</p>
          <h2 className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink mt-1">本机数据</h2>
          <p className="text-[14.5px] leading-[1.9] text-muted mt-3 max-w-[62ch]">
            收藏与最近使用都在这台浏览器的 localStorage 里，键是{' '}
            <span className="id-mono">{LIBRARY_STORAGE_KEY}</span>。导出的 JSON 里每条都带完整载荷，
            换设备后仍可用同样的 <span className="id-mono">?g=</span> 链接打开。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" data-testid="mine-export" onClick={exportJson} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
              导出 JSON
            </button>
            <button
              type="button"
              data-testid="mine-clear-all"
              onClick={() => setArmed(armed === 'all' ? null : 'all')}
              className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-danger/60 hover:text-danger"
            >
              清空全部
            </button>
            <button type="button" onClick={() => setLibrary(loadLibrary())} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
              重新读取
            </button>
          </div>

          {armed === 'all' ? (
            <div
              data-testid="mine-confirm-all"
              className="card elev rounded-2xl mt-5 flex flex-wrap items-center gap-3 px-5 py-4"
            >
              <span className="text-[11.5px] leading-5 text-muted">
                会清掉 {library.favorites.length} 份收藏 + {library.history.length} 条最近使用（链接不受影响）
                —— 确认吗？
              </span>
              <button
                type="button"
                data-testid="mine-confirm-all-yes"
                onClick={() => {
                  commit({ history: [], favorites: [] });
                  setArmed(null);
                  onToast?.('已清空本机的收藏与最近使用');
                }}
                className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-danger/60 hover:text-danger"
              >
                确认清空
              </button>
              <button type="button" onClick={() => setArmed(null)} className="focus-ring inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-cyan/50 hover:text-ink">
                取消
              </button>
            </div>
          ) : null}
        </section>

        <p className="text-[11.5px] leading-5 text-muted rv mt-24 opacity-80" style={revealDelay(0)}>
          这一页的数据就是装配台首页那两块（最近使用 / 我的收藏）的同一份，改动在两边即时一致；
          清空只影响本机，不影响你发出去的链接。
        </p>
      </main>
    </div>
  );
}
