/**
 * 鼠标拖尾（CursorTrail）
 *
 * 一条很轻的粒子尾巴：鼠标经过的地方留下几个钴蓝小点，500ms 内缩小淡出。
 *
 * 三条硬约束（都是踩过的坑）：
 *  ① **不触发 React 重渲**：状态全关在模块里的数组里，页面一次都不 re-render；
 *     之前做「我的」页动效时把 useDecode 状态放顶层，整页每帧重渲直接卡死标签页。
 *  ② **不用 CSS 滤镜/大元素**：只画一个全屏 canvas，`pointer-events: none`，
 *     rAF 在没有粒子时**自己停下**（空闲零开销）。
 *  ③ **该关就关**：`prefers-reduced-motion: reduce`、粗指针（触屏 / 笔）、
 *     以及 `html[data-trail="off"]` 三种情况直接不挂监听。
 *
 * 想临时关掉：`document.documentElement.dataset.trail = 'off'`。
 */

import { useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 → 0
  size: number;
}

const MAX_PARTICLES = 140;
const LIFE_MS = 560;
const MAX_STEP = 6; // 单次 pointermove 最多补几个点（按 8px 一个铺，甩鼠标时尾巴不断）
const SPACING = 8;

export function CursorTrail() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const fine = window.matchMedia?.('(pointer: fine)').matches ?? false;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!fine || still || root.dataset.trail === 'off') return;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.trailCanvas = '1';
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '45', // 压在页面之上、toast(z-50) 之下
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      return;
    }

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const particles: Particle[] = [];
    let frame = 0;
    let last = 0;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const light = () => root.dataset.theme !== 'dark';

    const draw = (now: number) => {
      frame = 0;
      const dt = last === 0 ? 16 : Math.min(now - last, 48);
      last = now;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      if (particles.length === 0) {
        last = 0;
        return;
      }
      const k = dt / LIFE_MS;
      // 亮底用正常混合、暗底用叠加，两种主题下都不糊
      ctx.globalCompositeOperation = light() ? 'source-over' : 'lighter';
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.life -= k;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.vx *= 0.92;
        p.vy *= 0.92;
        const alpha = p.life * (light() ? 0.3 : 0.46);
        const radius = p.size * (0.35 + p.life * 0.65);
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.4);
        gradient.addColorStop(0, `rgba(72, 116, 220, ${alpha})`);
        gradient.addColorStop(1, 'rgba(72, 116, 220, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = window.requestAnimationFrame(draw);
    };

    const kick = () => {
      if (frame === 0) {
        last = 0;
        frame = window.requestAnimationFrame(draw);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const x = event.clientX;
      const y = event.clientY;
      if (lastX === null || lastY === null) {
        lastX = x;
        lastY = y;
        return;
      }
      const dx = x - lastX;
      const dy = y - lastY;
      const distance = Math.hypot(dx, dy);
      if (distance < 2.5) return;
      const steps = Math.min(MAX_STEP, Math.max(1, Math.round(distance / SPACING)));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        particles.push({
          x: lastX + dx * t,
          y: lastY + dy * t,
          // 尾巴往「来向」的反面轻轻飘，并带一点随机，别像一条直线
          vx: -dx * 0.06 + (Math.random() - 0.5) * 0.08,
          vy: -dy * 0.06 + (Math.random() - 0.5) * 0.08,
          life: 1,
          size: 1.3 + Math.random() * 1.0,
        });
      }
      while (particles.length > MAX_PARTICLES) particles.shift();
      lastX = x;
      lastY = y;
      kick();
    };

    const onLeave = () => {
      lastX = null;
      lastY = null;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      canvas.remove();
    };
  }, []);

  return null;
}
