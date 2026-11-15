/**
 * R-37 · 装配图导出（SVG / PNG）。
 *
 * 画布的绘制层是 `svg[role="img"].canvas-grid`（SpecGrid 的 overlay 交互层是
 * 另一个 svg，导出的图里不该带命中热区）。难点是图里大量用 `var(--xxx)`
 * 引用 CSS 变量，独立打开 SVG 时这些变量全丢 —— 所以导出前把每个图元的
 * computed style 内联，并在临时容器上钉一套浅色变量：无论页面当前是深色还是
 * 浅色主题，导出的都是白底深线、适合贴进实验报告的清晰图。
 *
 * 纯逻辑（viewBox 解析 / 文件名）与 DOM 操作分开，门禁可在 Node 里直接跑。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 浅色制图色卡：与 tokens.css 的 :root 同值，只列画布会引用的几支。 */
const LIGHT_VARS: Record<string, string> = {
  '--schematic-active': '#1b3f9c',
  '--schematic-idle': '#a29b8c',
  '--schematic-text': '#5c574c',
  '--schematic-active-text': '#ffffff',
  '--sch-live': '#a15c14',
  '--sch-label-active': '#1b3f9c',
  '--sch-label-idle': '#857f72',
  '--sch-node-fill': '#fbf8f1',
  '--sch-grid-fill': 'rgba(22, 20, 15, 0.02)',
  '--sch-grid-line': 'rgba(22, 20, 15, 0.2)',
  '--sch-arrow': '#857f72',
  '--color-ink': '#16140f',
  '--color-muted': '#5c574c',
  '--color-faint': '#857f72',
};

/** 导出态统一白底深线，不跟随页面主题。 */
const INLINE_PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'font-size', 'font-family', 'font-weight', 'font-style',
  'opacity', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'color',
] as const;
/** 只写 inline style 不够：React 会把 `color={...}` / `fill={...}` 原样留在
 *  presentation attribute 上（`color="var(--schematic-idle)"`），换个 SVG 渲染器
 *  就可能解析不出变量。逐个属性覆盖成 computed 后的具体值。 */
const PRESENTATION_ATTRS = new Set<string>(INLINE_PROPS);

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 坏 viewBox 不炸：退回 800×600，并且 w/h 恒为正，避免生成 0 尺寸 PNG。 */
export function parseViewBox(raw: string | null): ViewBox {
  const parts = (raw ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { x: 0, y: 0, w: 800, h: 600 };
  }
  const [x, y, w0, h0] = parts;
  const w = Math.abs(w0) > 1 ? Math.abs(w0) : 800;
  const h = Math.abs(h0) > 1 ? Math.abs(h0) : 600;
  return { x, y, w, h };
}

/** 文件名不带路径、不带扩展名以外的标点，Windows / macOS 都能直接存。 */
export function graphFileName(templateId: string, ext: 'svg' | 'png'): string {
  const safe = (templateId || 'graph').replace(/[^A-Za-z0-9_-]/g, '_');
  return `SolveDeck-${safe}-装配图.${ext}`;
}

/** 在容器里找绘制层 svg。找不到就返回 null，调用方负责提示而不是静默给空图。 */
export function findGraphSvg(root: ParentNode): SVGSVGElement | null {
  const exact = root.querySelector('svg[role="img"].canvas-grid');
  if (exact instanceof SVGSVGElement) return exact;
  const fallback = root.querySelector('svg[role="img"]');
  return fallback instanceof SVGSVGElement ? fallback : null;
}

/**
 * 把绘制层克隆成一份自包含 SVG 文本。
 * 必须挂在 document 上读 computed style（游离节点没有层叠上下文）；
 * 临时容器用 inline 变量覆盖 `:root[data-theme='dark']`，导出恒为浅色。
 */
export function buildStandaloneSvg(source: SVGSVGElement): { text: string; box: ViewBox } {
  const box = parseViewBox(source.getAttribute('viewBox'));
  const clone = source.cloneNode(true) as SVGSVGElement;
  const holder = document.createElement('div');
  holder.setAttribute('data-theme', 'light');
  holder.style.cssText = 'position:absolute;left:-100000px;top:0;width:1px;height:1px;overflow:hidden';
  for (const [key, value] of Object.entries(LIGHT_VARS)) holder.style.setProperty(key, value);
  document.body.appendChild(holder);
  try {
    holder.appendChild(clone);
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(box.x));
    bg.setAttribute('y', String(box.y));
    bg.setAttribute('width', String(box.w));
    bg.setAttribute('height', String(box.h));
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    const all: SVGElement[] = [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))];
    for (const el of all) {
      const cs = getComputedStyle(el);
      for (const prop of INLINE_PROPS) {
        const value = cs.getPropertyValue(prop);
        if (!value) continue;
        el.style.setProperty(prop, value);
        if (PRESENTATION_ATTRS.has(prop) && el.hasAttribute(prop)) {
          el.setAttribute(prop, value);
        }
      }
    }
    clone.removeAttribute('class');
    clone.removeAttribute('role');
    clone.removeAttribute('aria-label');
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(Math.round(box.w)));
    clone.setAttribute('height', String(Math.round(box.h)));
    const body = new XMLSerializer().serializeToString(clone);
    return { text: `<?xml version="1.0" encoding="UTF-8"?>\n${body}`, box };
  } finally {
    holder.remove();
  }
}

/** SVG 文本 → PNG Blob（2× 分辨率，贴进文档不会糊）。 */
export async function svgToPngBlob(text: string, box: ViewBox, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 canvas 2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 编码失败');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 触发下载。用完立刻回收 URL，避免每次导出泄漏一个 blob:。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
