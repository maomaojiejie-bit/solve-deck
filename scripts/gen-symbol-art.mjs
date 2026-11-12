/**
 * 把 public/symbols/electronics/*.svg 编译成 src/render/symbolArt.generated.ts。
 *
 * 为什么要生成：符号库是**资产**（27 个 svg，GB/T 4728 画法），而积木表 symbols.ts 里的
 * 引脚坐标是**几何**。两者必须严格对齐，否则导线接不到器件引脚上。生成器读 svg 的
 * viewBox 与引脚端点，算出「让 svg 的引脚正好落在积木表引脚上」的 transform，
 * 渲染器直接 `<g transform={...} dangerouslySetInnerHTML>` 内联即可。
 *
 * 跑：node scripts/gen-symbol-art.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public', 'symbols', 'electronics');
const SRC_MECH = join(root, 'public', 'symbols', 'mechanics');
const OUT = join(root, 'src', 'render', 'symbolArt.generated.ts');

/**
 * kind → 映射。
 * anchor：svg 坐标里「对应积木表原点」的点（一般是符号中心）。
 * sx/sy：缩放，正负号允许镜像（y 取负 = 上下翻转）。
 * rotate：整符号旋转（用于把横向电源变成竖向）。
 * drop：丢掉 svg 里某些 id 的元素（电源的 +/− 是横向排的，转竖后要自己重画）。
 * extra：追加笔画（svg 坐标），用于库中没有的派生符号（如稳压管）。
 */
const MAP = {
  res: { file: 'resistor', anchor: [50, 20], sx: 0.88, sy: 0.88 },
  diode: { file: 'diode', anchor: [50, 20], sx: 0.68, sy: 0.68 },
  zener: {
    file: 'diode',
    anchor: [50, 20],
    sx: 0.68,
    sy: 0.68,
    extra: ['M58 8 L51 2', 'M58 32 L65 38'],
  },
  npn: { file: 'npn', anchor: [50, 50], sx: 0.88, sy: 0.88 },
  pnp: { file: 'pnp', anchor: [50, 50], sx: 0.88, sy: 0.88 },
  nmos: {
    file: 'nmos',
    anchor: [50, 50],
    sx: 1,
    sy: 1,
    // 衬底引线不进三端符号，但极性箭头必须保留：用一小段沟道引线把箭头接回沟道。
    // N 沟道箭头指向沟道（向左）。
    drop: ['bulk'],
    extra: ['M36 50H40'],
  },
  pmos: {
    file: 'pmos',
    anchor: [50, 50],
    sx: 1,
    sy: 1,
    // P 沟道箭头背离沟道（向右）。
    drop: ['bulk'],
    extra: ['M36 50H46'],
  },
  // 横置 MOSFET：不用整体 rotate(90)，重画 D/S 为直角折线（生成后 g 在上、d 右、s 左）。
  // 引脚见 src/render/symbols.ts 的 nmos-r90 / pmos-r90：g(0,-50) d(50,10) s(-50,10)。
  // 箭头画在源极引线上、保持水平：N 指向沟道（向右），P 背离沟道（向左）。
  'nmos-r90': {
    file: 'nmos',
    anchor: [50, 50],
    sx: 1,
    sy: 1,
    rotate: 90,
    drop: ['bulk', 'drain', 'source', 'arrow'],
    extra: [
      'M36 34 V14 H60 V0',
      'M36 60 V86 H60 V100',
      'M36 72L40 78M36 72L32 78',
    ],
  },
  'pmos-r90': {
    file: 'pmos',
    anchor: [50, 50],
    sx: 1,
    sy: 1,
    rotate: 90,
    drop: ['bulk', 'source', 'drain', 'arrow'],
    extra: [
      'M36 34 V14 H60 V0',
      'M36 60 V86 H60 V100',
      'M36 78L40 72M36 78L32 72',
    ],
  },
  opamp: { file: 'opamp', anchor: [50, 50], sx: 0.85, sy: -0.85 },
  vsrc: {
    file: 'voltage-source',
    anchor: [50, 20],
    sx: 0.88,
    sy: 0.88,
    rotate: 90,
    drop: ['plus', 'minus'],
  },
  ctrlsrc: { file: 'ctrlsrc', anchor: [50, 50], sx: 0.88, sy: 0.88 },
  gnd: { file: 'ground', anchor: [30, 0], sx: 0.45, sy: 0.45 },
  cap: { file: 'capacitor', anchor: [50, 20], sx: 0.88, sy: 0.88 },
};

/**
 * 力学图元（资产在 public/symbols/mechanics/）。
 * 这一波只上三个支座：固定端 / 固定铰 / 可动铰。梁用 line 加粗、载荷用 arrow，
 * 都不另立图元。anchor 取「与梁轴线接触的那个点」，与 symbols.ts 的 pins.n 对齐。
 */
const MECH_MAP = {
  fixedSupport: { file: 'fixed-support', anchor: [30, 50], sx: 0.5, sy: 0.5 },
  pinSupport: { file: 'pin-support', anchor: [50, 0], sx: 0.5, sy: 0.5 },
  rollerSupport: { file: 'roller-support', anchor: [50, 0], sx: 0.5, sy: 0.5 },
};

function inner(svg) {
  const open = svg.indexOf('>');
  const close = svg.lastIndexOf('</svg>');
  return svg.slice(open + 1, close);
}

/** 去掉指定 id 的元素（自闭合或成对），并去掉写死的黑色描边以便继承主题色。 */
function clean(markup, drop) {
  let out = markup;
  for (const id of drop) {
    out = out.replace(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*/>`, 'g'), '');
    out = out.replace(new RegExp(`<g[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</g>`, 'g'), '');
  }
  out = out.replace(/\s*stroke="#000"/g, '');
  out = out.replace(/\s*id="[^"]*"/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function transform({ anchor: [ax, ay], sx, sy, rotate }) {
  const t = [];
  if (rotate) t.push(`rotate(${rotate})`);
  t.push(sy === sx ? `scale(${sx})` : `scale(${sx},${sy})`);
  t.push(`translate(${-ax},${-ay})`);
  return t.join(' ');
}

const lines = [];
for (const [kind, cfg] of Object.entries({ ...MAP, ...MECH_MAP })) {
  const dir = Object.hasOwn(MECH_MAP, kind) ? SRC_MECH : SRC;
  const svg = readFileSync(join(dir, `${cfg.file}.svg`), 'utf8');
  let body = clean(inner(svg), cfg.drop ?? []);
  if (cfg.extra?.length) {
    body += cfg.extra.map((d) => `<path d="${d}"/>`).join('');
  }
  lines.push(
    `  ${JSON.stringify(kind)}: {\n    file: ${JSON.stringify(cfg.file)},\n    transform: ${JSON.stringify(
      transform(cfg),
    )},\n    inner: ${JSON.stringify(body)},\n  },`,
  );
}

const out = `/**
 * 由 scripts/gen-symbol-art.mjs 从 public/symbols/{electronics,mechanics}/*.svg 生成，请勿手改。
 * 重新生成：node scripts/gen-symbol-art.mjs
 */
export interface SymbolArt {
  /** 来源文件名（追溯用）。 */
  file: string;
  /** 把 svg 坐标映射到积木表局部坐标的 transform。 */
  transform: string;
  /** svg 内层 markup（描边继承 currentColor）。 */
  inner: string;
}

export const SYMBOL_ART: Record<string, SymbolArt> = {
${lines.join('\n')}
};
`;

writeFileSync(OUT, out, 'utf8');
console.log(`wrote ${OUT} (${Object.keys(MAP).length} symbols, ${out.length} bytes)`);
