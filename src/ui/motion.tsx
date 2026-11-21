/**
 * 动效零件（首页专用）
 * ---------------------------------------------------------------------------
 * 每个零件只做一件事，曲线与时长全在 motion.css 里：
 *   Reveal    滚动显现（IntersectionObserver，一次进场不回收）
 *   Spotlight 鼠标聚光灯（把指针位置写进 --mx / --my）
 *   Magnetic  磁吸按钮（指针偏移的 22%，松手走弹性回位）
 *   Tilt      3D 倾斜（±5°，桌面指针才有）
 *   DecodeText 文字解码（乱码 → 落字，一次）
 *   Typewriter 打字机（逐字落，带光标）
 *   CountUp    数字递增（值一变，从旧值滑到新值）
 *   Marquee    跑马灯
 *   Parallax   视差（滚动量写进 --py）
 *
 * 全部遵守 prefers-reduced-motion：关掉时立刻给出终态，不留半截动画。
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

const MQ_REDUCE = '(prefers-reduced-motion: reduce)';
const MQ_FINE = '(hover: hover) and (pointer: fine)';

function queryMatches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

/** 系统是否要求减少动态效果（会跟随系统设置变化）。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => queryMatches(MQ_REDUCE));
  useEffect(() => {
    const mq = window.matchMedia(MQ_REDUCE);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function varStyle(vars: Record<string, string>, extra?: CSSProperties): CSSProperties {
  return { ...(vars as CSSProperties), ...extra };
}

/* ───────────────────────────── ① 滚动显现 ───────────────────────────── */

export function Reveal({
  children,
  delay = 0,
  className = '',
  fade = false,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  fade?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-in={inView ? '1' : '0'}
      className={`rv${fade ? ' rv-fade' : ''} ${className}`}
      style={varStyle({ '--d': `${delay}ms` })}
    >
      {children}
    </div>
  );
}

/* ───────────────────────────── ② 聚光灯 ───────────────────────────── */

export function Spotlight({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(((event.clientX - box.left) / box.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(((event.clientY - box.top) / box.height) * 100).toFixed(1)}%`);
  };

  return (
    <div ref={ref} onPointerMove={onMove} className={`spot ${className}`} style={style}>
      {children}
    </div>
  );
}

/* ───────────────────────────── ③ 磁吸 ───────────────────────────── */

export function Magnetic({
  children,
  strength = 0.22,
  max = 9,
  className = '',
}: {
  children: ReactNode;
  strength?: number;
  max?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  const onMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || !queryMatches(MQ_FINE)) return;
    const box = el.getBoundingClientRect();
    const dx = (event.clientX - (box.left + box.width / 2)) * strength;
    const dy = (event.clientY - (box.top + box.height / 2)) * strength;
    el.dataset.move = '1';
    el.style.transform = `translate3d(${Math.max(-max, Math.min(max, dx)).toFixed(2)}px, ${Math.max(
      -max,
      Math.min(max, dy),
    ).toFixed(2)}px, 0)`;
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.dataset.move = '0';
    el.style.transform = '';
  };

  return (
    <span ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={`magnetic ${className}`}>
      {children}
    </span>
  );
}

/* ───────────────────────────── ④ 3D 倾斜 ───────────────────────────── */

export function Tilt({
  children,
  max = 5,
  className = '',
  style,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || reduced || !queryMatches(MQ_FINE)) return;
    const box = el.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width - 0.5;
    const py = (event.clientY - box.top) / box.height - 0.5;
    el.dataset.move = '1';
    el.style.transform = `perspective(1500px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(
      px * max
    ).toFixed(2)}deg)`;
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.dataset.move = '0';
    el.style.transform = '';
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`tilt ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/* ───────────────────────────── ⑤ 文字解码 ───────────────────────────── */

const POOL = '01<>/#%+=*§¶¦ABCDEF■□';

export function DecodeText({ text, className = '' }: { text: string; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (reduced) {
      setOut(text);
      return;
    }
    const chars = [...text];
    const frames = 16;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      const t = frame / frames;
      setOut(
        chars
          .map((char, i) => {
            if (char === ' ') return ' ';
            const settle = 0.28 + (i / Math.max(chars.length, 1)) * 0.5;
            if (t >= settle) return char;
            return Math.random() < 0.68 ? POOL[Math.floor(Math.random() * POOL.length)] : char;
          })
          .join(''),
      );
      if (frame >= frames) window.clearInterval(timer);
    }, 38);
    return () => window.clearInterval(timer);
  }, [text, reduced]);

  return (
    <span className={`decode ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

/* ───────────────────────────── ⑥ 打字机 ───────────────────────────── */

export function Typewriter({
  text,
  speed = 26,
  delay = 0,
  className = '',
  onDone,
  once = false,
}: {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  onDone?: () => void;
  /** 只在首次出现时打字；后续文本更新直接替换（编辑器里每次重解不重播） */
  once?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text : '');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const played = useRef(false);

  useEffect(() => {
    if (reduced) {
      setShown(text);
      return;
    }
    if (once && played.current) {
      setShown(text);
      doneRef.current?.();
      return;
    }
    played.current = true;
    setShown('');
    const chars = [...text];
    let index = 0;
    let interval = 0;
    const wait = window.setTimeout(() => {
      interval = window.setInterval(() => {
        index += 1;
        setShown(chars.slice(0, index).join(''));
        if (index >= chars.length) {
          window.clearInterval(interval);
          doneRef.current?.();
        }
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(wait);
      window.clearInterval(interval);
    };
  }, [text, speed, delay, reduced]);

  const done = shown.length >= text.length;
  return (
    <span className={`tw-caret ${className}`} data-done={done ? '1' : '0'}>
      {shown}
    </span>
  );
}

/* ───────────────────────────── ⑦ 数字递增 ───────────────────────────── */

export function CountUp({
  value,
  decimals = 2,
  duration = 520,
  className = '',
  unit,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  unit?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (reduced || !Number.isFinite(value) || from === value) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = value;
    };
  }, [value, duration, reduced]);

  const text = Number.isFinite(shown) ? shown.toFixed(decimals) : '—';
  return (
    <span className={`num ${className}`} key={`${value}`}>
      {text}
      {unit ? <span className="ml-1 text-[11px] text-faint">{unit}</span> : null}
    </span>
  );
}

/* ───────────────────────────── ⑧ 跑马灯 ───────────────────────────── */

export function Marquee({ items, speed = 48 }: { items: string[]; speed?: number }) {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track" style={varStyle({ '--speed': `${speed}s` })}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {items.map((item, i) => (
              <span key={`${copy}-${i}`} className="flex shrink-0 items-center">
                <span className="whitespace-nowrap px-5 font-mono text-[11px] tracking-[0.18em] text-muted">
                  {item}
                </span>
                <span className="h-1 w-1 rounded-full bg-[var(--color-line-2)]" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── ⑨ 视差 ───────────────────────────── */

export function Parallax({
  children,
  speed = 0.06,
  className = '',
}: {
  children?: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const centred = box.top + box.height / 2 - window.innerHeight / 2;
      el.style.setProperty('--py', `${(-centred * speed).toFixed(1)}px`);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed, reduced]);

  return (
    <div ref={ref} className={`parallax ${className}`}>
      {children}
    </div>
  );
}

/* ───────────────────────────── ⑩ 叙事步进 ───────────────────────────── */

export function useActiveStep(count: number): {
  active: number;
  setStep: (index: number) => (node: HTMLElement | null) => void;
} {
  const nodes = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.step ?? 0));
        if (visible.length > 0) setActive(Math.min(...visible));
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const node of nodes.current) if (node) io.observe(node);
    return () => io.disconnect();
  }, [count]);

  const setStep = (index: number) => (node: HTMLElement | null) => {
    nodes.current[index] = node;
  };

  return { active, setStep };
}

/** 给「进度轨」用的目标引用（章节容器）。 */
export function useScrollProgress(target: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = target.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const passed = window.innerHeight * 0.55 - box.top;
      setProgress(Math.max(0, Math.min(1, passed / Math.max(box.height, 1))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target]);

  return progress;
}
