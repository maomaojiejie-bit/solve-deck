/**
 * 三维力学实验场 · 模板库（#/space）
 * ---------------------------------------------------------------------------
 * lab3d-proto 合并进来的分区：47 个三维算例按引擎分三组浏览，
 * 点卡片进 #/space/t/<id> 只读详情，右上「自由装配」进 #/space/build 改模型。
 *
 * 动效口径（全站 motion.css 纪律，这里逐条交代用途）：
 *   鼠标聚光灯 Spotlight / 滚动显现 Reveal / 边缘流光 .edge / 磁吸 Magnetic /
 *   滚动叙事 .rail + useActiveStep / 3D 倾斜 Tilt / 文字解码 DecodeText /
 *   流光扫过 .sheen / 视差滚动 Parallax / 数字递增 CountUp / 悬停上浮 .lift /
 *   错峰动画 Reveal delay / 跑马灯 Marquee —— 弹性与缓动走 --ease-spring / --ease-draft。
 * 3D 画布不在这页（只读详情才有），本页纯 DOM。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES } from '../core/space/examples';
import { EXAMPLES_MECH } from '../core/space/examples-mech';
import type { MechModel, TrussModel } from '../core/space/types';
import { SiteHeader } from '../ui/SiteHeader';
import {
  CountUp,
  DecodeText,
  Magnetic,
  Marquee,
  Parallax,
  Reveal,
  Spotlight,
  Tilt,
  useActiveStep,
  useScrollProgress,
} from '../ui/motion';

const SHELL = 'mx-auto w-full max-w-[1120px] px-6';

/** 算例 meta：与 lab3d 列表同口径（结点数 / 杆数 / 支座 / 荷载，刚体看 bodies） */
function trussMeta(m: TrussModel): string {
  if (m.rigid) {
    return `${m.rigid.bodies.length} 刚体 · ${m.nodes.length} 结点 · ${m.loads.length} 荷载`;
  }
  const beams = m.members.filter((x) => x.kind === 'beam').length;
  return `${m.nodes.length} 结点 · ${m.members.length} 杆${beams ? `（含 ${beams} 梁）` : ''} · ${m.supports.length} 支座 · ${m.loads.length + (m.memberLoads?.length ?? 0)} 荷载`;
}

function mechMeta(m: MechModel): string {
  return `${m.type} 模板 · ${m.nodes.length} 点${m.members?.length ? ` · ${m.members.length} 杆` : ''} · 时长 ${m.duration} s`;
}

/** 数字递增：进入视口才从 0 走到目标值（CountUp 值变化即动画，终值与真值逐位一致） */
function Stat({ value, label, unit }: { value: number; label: string; unit?: string }) {
  const box = useRef<HTMLSpanElement | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !('IntersectionObserver' in window)) {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={box} className="flex items-baseline gap-2">
      <span className="font-mono text-[22px] leading-none text-ink">
        <CountUp value={on ? value : 0} decimals={0} unit={unit} />
      </span>
      <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">{label}</span>
    </span>
  );
}

type CardDef = { id: string; name: string; meta: string; href: string };

function ExampleCard({ card, index }: { card: CardDef; index: number }) {
  return (
    /* 错峰入场：delay 按列序给 --d；聚光灯照亮卡面；3D 倾斜 + 悬停上浮 + 流光扫过 */
    <Reveal delay={(index % 6) * 70}>
      <Tilt max={4}>
        <Spotlight>
          <a
            href={card.href}
            className="card sheen lift relative z-[1] block px-4 py-3.5"
            data-testid={`space-card-${card.id}`}
          >
            <span className="flex items-baseline gap-2.5">
              <span className="id-mono shrink-0 text-cyan">{card.id}</span>
              <span className="min-w-0 truncate text-[13.5px] text-ink">{card.name}</span>
            </span>
            <span className="mt-1.5 block font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-faint">
              {card.meta}
            </span>
          </a>
        </Spotlight>
      </Tilt>
    </Reveal>
  );
}

export function Space() {
  /* 滚动叙事：E1→E2→E3 三段随滚动点亮进度轨 */
  const story = useRef<HTMLDivElement | null>(null);
  const progress = useScrollProgress(story);
  const { active, setStep } = useActiveStep(3);

  const groups = useMemo(() => {
    const e1: CardDef[] = [];
    const e2: CardDef[] = [];
    for (const m of EXAMPLES) {
      const card = { id: m.id, name: m.name, meta: trussMeta(m), href: `#/space/t/${m.id}` };
      if (m.rigid) e2.push(card);
      else e1.push(card);
    }
    const e3: CardDef[] = EXAMPLES_MECH.map((m) => ({
      id: m.id,
      name: m.name,
      meta: mechMeta(m),
      href: `#/space/t/${m.id}`,
    }));
    return { e1, e2, e3 };
  }, []);

  const total = EXAMPLES.length + EXAMPLES_MECH.length;

  return (
    <div className="min-h-screen">
      <SiteHeader
        page="space"
        title={<DecodeText text="三维力学实验场" className="text-[13px] text-ink" />}
        note="E1 杆系 · E2 刚体 · E3 机构"
        onBack={() => {
          window.location.hash = '#/';
        }}
        backLabel="首页"
        extra={
          <Magnetic strength={0.16}>
            <a
              href="#/space/build"
              className="sheen focus-ring inline-flex h-8 items-center bg-cyan px-3.5 text-[12px] font-medium text-white"
            >
              自由装配 →
            </a>
          </Magnetic>
        }
      />

      {/* ── 开篇：视差图纸底 + 聚光灯卡 + 公式跑马灯 + 数字递增 ── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <Parallax speed={0.05} className="draft-grid h-[160%] w-full opacity-40" />
          <Parallax speed={-0.03} className="absolute right-[-10vw] top-[-30vh] h-[60vh] w-[60vh] rounded-full bg-cyan/10 blur-3xl" />
        </div>
        <div className={`${SHELL} relative py-16 sm:py-20`}>
          <Reveal>
            <h1 className="max-w-[560px] text-[34px] font-semibold leading-[1.18] tracking-[-0.025em] text-ink sm:text-[44px]">
              把力学题
              <span className="text-cyan"> 搭 </span>
              出来，算出来。
            </h1>
            <p className="mt-4 max-w-[480px] text-[14px] leading-[1.9] text-muted">
              47 个三维算例：杆系与梁的静力、多刚体系、平面机构运动学与动力学。 点算例进只读详情看三维场景与结果；
              想动手改，去装配台。
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Stat value={total} label="算例" />
              <Stat value={groups.e1.length} label="E1 杆系静力" />
              <Stat value={groups.e2.length} label="E2 刚体" />
              <Stat value={groups.e3.length} label="E3 机构" />
            </div>
          </Reveal>
        </div>

        {/* 跑马灯：公式 ticker，悬停即停 */}
        <div className="border-t border-line bg-panel/50 py-2.5">
          <Marquee
            speed={52}
            items={[
              'K·d = F',
              'σ = N/A ± M·y/I',
              'Pcr = π²EI/(μL)²',
              'δmax = PL³/48EI',
              'ΣF = 0 · ΣM = 0',
              'U = ½dᵀKd',
              'v = r·ω',
              'τ = T·ρ/J',
              'Mises = √(σ₁²+σ₂²+σ₃²−σ₁σ₂−σ₂σ₃−σ₃σ₁)',
              'F = μN 临界',
            ]}
          />
        </div>
      </section>

      {/* ── 滚动叙事：左进度轨，右 E1→E2→E3 三组卡 ── */}
      <div ref={story} className={`${SHELL} grid gap-10 py-16 lg:grid-cols-[24px_minmax(0,1fr)] lg:gap-14`}>
        <div className="hidden lg:block">
          <div className="sticky top-24 h-[70vh]">
            <div className="rail h-full">
              <i style={{ height: '100%', ['--p' as string]: progress }} />
              {[0, 1, 2].map((i) => (
                <span key={i} className="rail-dot" data-on={active >= i ? '1' : '0'} style={{ top: `${(i / 2) * 100}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-16">
          {(
            [
              {
                key: 'E1',
                title: 'E1 · 杆系与梁的静力',
                note: '结点法 / 刚度法双路对拍，拉正压负；梁段出内力、应力、屈曲与应变能。',
                cards: groups.e1,
              },
              {
                key: 'E2',
                title: 'E2 · 刚体静力',
                note: '物体系拆体：约束反力、铰接内力、摩擦锥判别、力系简化与重心。',
                cards: groups.e2,
              },
              {
                key: 'E3',
                title: 'E3 · 机构运动学与动力学',
                note: '解析位姿/速度/加速度时程（K 系）与 RK4 积分（D 系），金色时刻逐位对账。',
                cards: groups.e3,
              },
            ] as const
          ).map((group, gi) => (
            <section key={group.key} data-step={gi} ref={setStep(gi)} className="scroll-mt-24">
              <Reveal>
                <Spotlight className="edge relative border border-line-2 bg-panel px-6 py-5">
                  <span className="sec-idx">§{group.key}</span>
                  <h2 className="mt-2 text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[26px]">
                    {group.title}
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[13px] leading-[1.85] text-muted">{group.note}</p>
                </Spotlight>
              </Reveal>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.cards.map((card, i) => (
                  <ExampleCard key={card.id} card={card} index={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <footer className="border-t border-line">
        <div className={`${SHELL} flex flex-wrap items-center gap-x-6 gap-y-2 py-8`}>
          <p className="font-mono text-[10.5px] tracking-[0.1em] text-faint">
            三维力学实验场 · {total} 算例 · 快照门禁逐位对账 · 本机求解零请求
          </p>
          <a href="#/" className="ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            ← 回拆解台首页
          </a>
        </div>
      </footer>
    </div>
  );
}
