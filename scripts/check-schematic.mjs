/**
 * 电路图门禁（S1–S15）。
 *
 * 这个文件是「接线守则」的机器版本：凡是靠记住的规矩，都写成了这里的一条断言。
 * 数据来源是 `src/examples/*.json` 的快照（构建时由 check:p3 校验过没漂移），
 * 所以门禁检查的就是**真正会渲染出来的那份 render_spec**，不是另一份平行定义。
 *
 * 通过标准：`npm run check:schematic` 打印 PASS 且退出码 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { SYMBOLS, pinAt } from '../src/render/symbols.ts';
import { SYMBOL_ART } from '../src/render/symbolArt.generated.ts';
import { visiblePanels, isFlatZeroPanel } from '../src/core/chartPanels.ts';
import { freshSkeleton, labSkeletonSpec } from '../src/core/lab/skeleton.ts';
import { frameSolve } from '../src/core/lab/frameSolve.ts';
import { internalChart } from '../src/core/lab/measures.ts';

const EXAMPLES = 'src/examples';

/* ------------------------------------------------------------------ 工具 */

const EPS = 1.6; // 端点吸附容差
const CENTER_EPS = 3; // 「不允许接到器件中心」的判定半径
const LABEL_PAD = 78; // 标签允许超出的画布外扩

const errors = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`[ok]   ${name}`);
  } catch (error) {
    errors.push({ name, message: error.message });
    console.log(`[FAIL] ${name}`);
  }
}

function fail(parts) {
  const shown = parts.slice(0, 6).join('\n    ');
  const more = parts.length > 6 ? `\n    …另有 ${parts.length - 6} 处` : '';
  throw new Error(`\n    ${shown}${more}`);
}

const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => `(${r1(p[0])},${r1(p[1])})`;
const near = (a, b, eps = EPS) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

/** 条目的折线点：优先用显式 points，否则按旧约定 H-V-H 反推 */
function edgePoints(spec, edge) {
  if (Array.isArray(edge.points) && edge.points.length >= 2) return edge.points;
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const resolve = (ref) => {
    if (typeof ref === 'string' && byId.has(ref)) {
      const n = byId.get(ref);
      return [n.x, n.y];
    }
    if (typeof ref === 'string' && /^-?[\d.]+,-?[\d.]+$/.test(ref)) {
      const [x, y] = ref.split(',').map(Number);
      return [x, y];
    }
    return null;
  };
  const a = resolve(edge.from);
  const b = resolve(edge.to);
  if (!a || !b) return null;
  const midX = (a[0] + b[0]) / 2;
  return [a, [midX, a[1]], [midX, b[1]], b];
}

/** 世界坐标下的引脚表 */
function pinMap(node) {
  const def = SYMBOLS[node.kind];
  if (!def) return new Map();
  const map = new Map();
  for (const pin of def.pins) {
    map.set(pin.id, pinAt(node.kind, [node.x, node.y], node.rot ?? 0, pin.id));
  }
  return map;
}

/** 器件包围盒（考虑旋转） */
function box(node) {
  const def = SYMBOLS[node.kind];
  if (!def) return null;
  const rot = ((node.rot ?? 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const hw = swap ? def.hh : def.hw;
  const hh = swap ? def.hw : def.hh;
  return { x0: node.x - hw, x1: node.x + hw, y0: node.y - hh, y1: node.y + hh };
}

/** 估算文字宽度：CJK 按 1em，ASCII 按 0.56em */
function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  return w;
}

/** 标签矩形（与 AnalogSchematic.labelOffset 的偏移量保持一致，fontSize=11） */
function labelBox(node) {
  const text = node.label;
  if (!text) return null;
  const size = node.kind === 'dot' ? 10 : 11;
  const def = SYMBOLS[node.kind];
  const rot = ((node.rot ?? 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const hw = def ? (swap ? def.hh : def.hw) : 0;
  const hh = def ? (swap ? def.hw : def.hh) : 0;
  const w = textWidth(text, size);
  const side = node.labelSide ?? (node.kind === 'text' ? 'right' : 'up');
  let x;
  let y;
  if (node.kind === 'dot') {
    const dside = node.labelSide ?? 'up';
    x = dside === 'left' ? node.x - 10 : dside === 'right' ? node.x + 10 : node.x;
    y = dside === 'down' ? node.y + 18 : node.y - 14;
  } else if (node.kind === 'text') {
    x = node.x;
    y = node.y;
  } else if (def?.labelInside) {
    x = node.x;
    y = node.y + 4;
  } else if (side === 'down') {
    x = node.x;
    y = node.y + hh + 16;
  } else if (side === 'left') {
    x = node.x - hw - 8;
    y = node.y + 4;
  } else if (side === 'right') {
    x = node.x + hw + 8;
    y = node.y + 4;
  } else {
    x = node.x;
    y = node.y - hh - 10;
  }
  const anchor =
    node.kind === 'dot'
      ? node.labelSide === 'left'
        ? 'end'
        : node.labelSide === 'right'
          ? 'start'
          : 'middle'
      : side === 'left'
        ? 'end'
        : side === 'right'
          ? 'start'
          : 'middle';
  const inside = def?.labelInside === true;
  const finalAnchor = inside ? 'middle' : anchor;
  const x0 = finalAnchor === 'start' ? x : finalAnchor === 'end' ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: y - size, y1: y + 3, text };
}

function rectsOverlap(a, b, eps = 2) {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

function pointOnSeg(p, a, b, eps = EPS) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return near(p, a, eps);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
  if (t < -0.02 || t > 1.02) return false;
  const proj = [a[0] + t * dx, a[1] + t * dy];
  return near(p, proj, eps);
}

function segRectHit(p, q, rect, inset = 0) {
  const x0 = rect.x0 + inset;
  const x1 = rect.x1 - inset;
  const y0 = rect.y0 + inset;
  const y1 = rect.y1 - inset;
  if (x0 >= x1 || y0 >= y1) return false;
  // 轴对齐线段：先看是否在带内，再看区间是否重叠
  const segIsH = Math.abs(p[1] - q[1]) < 0.6;
  const segIsV = Math.abs(p[0] - q[0]) < 0.6;
  if (segIsH) {
    const y = p[1];
    if (y <= y0 || y >= y1) return false;
    const lo = Math.min(p[0], q[0]);
    const hi = Math.max(p[0], q[0]);
    return hi > x0 && lo < x1;
  }
  if (segIsV) {
    const x = p[0];
    if (x <= x0 || x >= x1) return false;
    const lo = Math.min(p[1], q[1]);
    const hi = Math.max(p[1], q[1]);
    return hi > y0 && lo < y1;
  }
  return false;
}

/** 器件本体（只对「闭合外形的符号」做穿线检查） */
const BODY_KINDS = new Set([
  'res', 'diode', 'zener', 'vsrc', 'cap', 'npn', 'pnp', 'nmos', 'nmos-r90', 'pmos', 'pmos-r90',
  'ctrlsrc', 'gnd',
]);
/** 允许不接线的引脚（旁路引出等） */
const PIN_EXEMPT = new Set(['block:x']);

/* ------------------------------------------------------------------ 载入 */

function loadSpecs() {
  const dir = path.resolve(EXAMPLES);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const specs = json.render_specs ?? (json.render_spec ? [json.render_spec] : []);
    specs.forEach((spec, index) => {
      if (spec?.type && spec.type !== 'schematic') return;
      if (!Array.isArray(spec?.nodes) || spec.nodes.length === 0) return;
      out.push({ template: id, specId: spec.id ?? `#${index}`, spec, raw: json });
    });
  }
  return out;
}

const SPECS = loadSpecs();

const isAnalog = (spec) => spec.nodes.every((n) => SYMBOLS[n.kind]);

function eachSpec(fn) {
  const problems = [];
  for (const entry of SPECS) {
    if (!isAnalog(entry.spec)) continue;
    try {
      fn(entry);
    } catch (error) {
      problems.push(`${entry.template}/${entry.specId}：${error.message}`);
    }
  }
  if (problems.length > 0) fail(problems);
}

/* ------------------------------------------------------------------ 断言 */

check('S1 同一张图内 node / edge 的 id 不重复', () => {
  eachSpec(({ spec, template, specId }) => {
    const seen = new Set();
    for (const item of [...spec.nodes, ...(spec.edges ?? [])]) {
      if (seen.has(item.id)) throw new Error(`id 重复：${item.id}`);
      seen.add(item.id);
    }
    if (seen.size !== spec.nodes.length + (spec.edges ?? []).length) {
      throw new Error(`${template}/${specId} id 数量不一致`);
    }
  });
});

check('S2 导线几何：≥2 点、无零长段、每段轴对齐', () => {
  eachSpec(({ spec, specId: sid, template }) => {
    for (const edge of spec.edges ?? []) {
      const pts = edgePoints(spec, edge);
      if (!pts) throw new Error(`${edge.id} 无法解析端点`);
      if (pts.length < 2) throw new Error(`${edge.id} 只有 ${pts.length} 个点`);
      for (let i = 1; i < pts.length; i += 1) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) {
          throw new Error(`${template}/${sid} ${edge.id} 有零长段 ${pt(pts[i - 1])}`);
        }
        if (Math.abs(dx) > 0.6 && Math.abs(dy) > 0.6) {
          throw new Error(
            `${template}/${sid} ${edge.id} 第 ${i} 段是斜线 ${pt(pts[i - 1])}→${pt(pts[i])}（拐点必须是 (a.x,b.y) 或 (a.y,b.x)）`,
          );
        }
      }
    }
  });
});

check('S3 端点吸附：导线端点必须落在引脚/结点上（母线·横杠·控制虚线·端口桩除外）', () => {
  eachSpec(({ spec }) => {
    const pins = [];
    for (const node of spec.nodes) {
      for (const [, p] of pinMap(node)) pins.push(p);
    }
    for (const node of spec.nodes) {
      if (node.kind === 'dot' || node.kind === 'pin') pins.push([node.x, node.y]);
    }
    const ends = [];
    for (const edge of spec.edges ?? []) {
      const pts = edgePoints(spec, edge);
      if (!pts) continue;
      ends.push({ id: edge.id, p: pts[0] }, { id: edge.id, p: pts[pts.length - 1] });
    }
    for (const end of ends) {
      // 交流地横杠是一条「开口的杠」，两端不接东西是有意的
      const edgeOf = (spec.edges ?? []).find((e) => e.id === end.id);
      // 横杠（交流地）、母线（weight 2）、控制虚线、带 tag 的端口桩，端点本来就允许开口
      if (/-bar$/.test(end.id) || edgeOf?.tag || edgeOf?.dashed || edgeOf?.weight === 2) continue;
      const onPin = pins.some((p) => near(p, end.p));
      const onOther = ends.some((o) => o.id !== end.id && near(o.p, end.p));
      if (!onPin && !onOther) {
        throw new Error(`${end.id} 端点 ${pt(end.p)} 悬空（既不在引脚上，也不与其他导线相接）`);
      }
    }
  });
});

check('S4 器件中心不得接线（三端器件必须接到引脚）', () => {
  eachSpec(({ spec }) => {
    const centers = spec.nodes
      .filter((n) => ['npn', 'pnp', 'nmos', 'nmos-r90', 'pmos', 'pmos-r90', 'ctrlsrc', 'opamp'].includes(n.kind))
      .map((n) => ({ id: n.id, kind: n.kind, p: [n.x, n.y] }));
    for (const edge of spec.edges ?? []) {
      const pts = edgePoints(spec, edge);
      if (!pts) continue;
      for (const p of pts) {
        for (const c of centers) {
          if (near(c.p, p, CENTER_EPS)) {
            throw new Error(`${edge.id} 接到了 ${c.id}(${c.kind}) 的中心 ${pt(p)}`);
          }
        }
      }
    }
  });
});

check('S5 器件引脚必须接线（旁路引出除外）', () => {
  eachSpec(({ spec }) => {
    const segs = [];
    const pts = [];
    for (const edge of spec.edges ?? []) {
      const ps = edgePoints(spec, edge);
      if (!ps) continue;
      pts.push(...ps);
      for (let i = 1; i < ps.length; i += 1) segs.push([ps[i - 1], ps[i]]);
    }
    for (const node of spec.nodes) {
      const def = SYMBOLS[node.kind];
      if (!def) continue;
      for (const pin of def.pins) {
        if (PIN_EXEMPT.has(`${node.kind}:${pin.id}`)) continue;
        const world = pinAt(node.kind, [node.x, node.y], node.rot ?? 0, pin.id);
        const touched =
          pts.some((p) => near(world, p)) || segs.some(([a, b]) => pointOnSeg(world, a, b));
        if (!touched) throw new Error(`${node.id}(${node.kind}) 的引脚 ${pin.id} ${pt(world)} 没有导线`);
      }
    }
  });
});

check('S6 导线不得穿过器件本体', () => {
  eachSpec(({ spec }) => {
    const bodies = spec.nodes
      .filter((n) => BODY_KINDS.has(n.kind))
      .map((n) => ({ id: n.id, kind: n.kind, rect: box(n), pins: pinMap(n) }));
    for (const edge of spec.edges ?? []) {
      const pts = edgePoints(spec, edge);
      if (!pts) continue;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        if (edge.dashed) continue;
        for (const body of bodies) {
          if (!body.rect) continue;
          const pinValues = [...body.pins.values()];
          const touchesPin =
            pinValues.some((p) => near(p, a)) ||
            pinValues.some((p) => near(p, b)) ||
            pinValues.some((p) => pointOnSeg(p, a, b));
          if (touchesPin) continue;
          if (segRectHit(a, b, body.rect, 5)) {
            throw new Error(`${edge.id} 第 ${i} 段 ${pt(a)}→${pt(b)} 穿过 ${body.id}(${body.kind}) 本体`);
          }
        }
      }
    }
  });
});

check('S7 两个器件的包围盒不得重叠', () => {
  eachSpec(({ spec }) => {
    const parts = spec.nodes
      .filter((n) => SYMBOLS[n.kind] && !['dot', 'text', 'pin', 'sum', 'block'].includes(n.kind))
      .map((n) => ({ id: n.id, kind: n.kind, rect: box(n) }));
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        if (rectsOverlap(parts[i].rect, parts[j].rect, 8)) {
          throw new Error(`${parts[i].id}(${parts[i].kind}) 与 ${parts[j].id}(${parts[j].kind}) 重叠`);
        }
      }
    }
  });
});

check('S8 标签之间不得互相压住', () => {
  eachSpec(({ spec }) => {
    const labels = spec.nodes.map((n) => ({ id: n.id, rect: labelBox(n) })).filter((x) => x.rect);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        if (rectsOverlap(labels[i].rect, labels[j].rect, 2)) {
          throw new Error(`「${labels[i].rect.text}」与「${labels[j].rect.text}」重叠`);
        }
      }
    }
  });
});

check('S9 标签不得压在导线上', () => {
  eachSpec(({ spec }) => {
    const segs = [];
    for (const edge of spec.edges ?? []) {
      const pts = edgePoints(spec, edge);
      if (!pts) continue;
      for (let i = 1; i < pts.length; i += 1) segs.push({ id: edge.id, a: pts[i - 1], b: pts[i] });
    }
    for (const node of spec.nodes) {
      const rect = labelBox(node);
      if (!rect) continue;
      for (const seg of segs) {
        // 标签紧贴自己那条线的端点（导线就是从标签旁边出去的）不算压线
        if (seg.id.startsWith(node.id) || near(seg.a, [node.x, node.y], 16) || near(seg.b, [node.x, node.y], 16)) {
          continue;
        }
        if (segRectHit(seg.a, seg.b, rect, 0)) {
          throw new Error(`「${rect.text}」压在导线 ${seg.id} 上 ${pt(seg.a)}→${pt(seg.b)}`);
        }
      }
    }
  });
});

check('S10 标签不得跑出画布（几何外扩 78 以内）', () => {
  eachSpec(({ spec }) => {
    // 画布由「真正的几何」决定：导线折点 + 有外形的节点；text 节点本身不算，
    // 否则把标签挪到任意远处都会把自己的包围盒撑大，这条断言就成了空转。
    const xs = [];
    const ys = [];
    for (const node of spec.nodes) {
      if (node.kind === 'text') continue;
      xs.push(node.x);
      ys.push(node.y);
    }
    for (const edge of spec.edges ?? []) {
      for (const p of edgePoints(spec, edge) ?? []) {
        xs.push(p[0]);
        ys.push(p[1]);
      }
    }
    if (xs.length === 0) return;
    const gx0 = Math.min(...xs) - LABEL_PAD;
    const gx1 = Math.max(...xs) + LABEL_PAD;
    const gy0 = Math.min(...ys) - LABEL_PAD;
    const gy1 = Math.max(...ys) + LABEL_PAD;
    for (const node of spec.nodes) {
      const rect = labelBox(node);
      if (!rect) continue;
      if (rect.x0 < gx0 || rect.x1 > gx1 || rect.y0 < gy0 || rect.y1 > gy1) {
        throw new Error(`「${rect.text}」跑到画布外（${r1(rect.x0)}..${r1(rect.x1)} / ${r1(rect.y0)}..${r1(rect.y1)}）`);
      }
    }
  });
});

check('S11 虚线（控制量）必须带标注', () => {
  eachSpec(({ spec }) => {
    for (const edge of spec.edges ?? []) {
      if (edge.dashed && !edge.label) throw new Error(`${edge.id} 是虚线但没有 label（读者不知道它标的是什么）`);
    }
  });
});

check('S12 frame 高亮的 id 必须存在于本图', () => {
  eachSpec(({ spec, template, specId }) => {
    const ids = new Set([...spec.nodes.map((n) => n.id), ...(spec.edges ?? []).map((e) => e.id)]);
    for (const frame of spec.frames ?? []) {
      for (const id of frame.activeNodes ?? []) {
        if (!ids.has(id)) throw new Error(`${template}/${specId} frame ${frame.stepIndex} 高亮 ${id} 不存在于本图`);
      }
      for (const id of frame.activeEdges ?? []) {
        if (!ids.has(id)) throw new Error(`${template}/${specId} frame ${frame.stepIndex} 高亮 ${id} 不存在于本图`);
      }
      for (const label of frame.labels ?? []) {
        if (!ids.has(label.id)) throw new Error(`${template}/${specId} frame ${frame.stepIndex} 标签挂在 ${label.id}，本图没有这个 id`);
      }
    }
  });
});

check('S13 每张电路图都必须有接地参考', () => {
  const missing = [];
  for (const entry of SPECS) {
    if (!isAnalog(entry.spec)) continue;
    const hasGnd = entry.spec.nodes.some((n) => n.kind === 'gnd');
    if (!hasGnd) missing.push(`${entry.template}/${entry.specId}`);
  }
  if (missing.length > 0) fail(missing);
});

check('S14 同一张图里所有接地符号必须落在同一条地轨上', () => {
  const bad = [];
  for (const entry of SPECS) {
    if (!isAnalog(entry.spec)) continue;
    const gnds = entry.spec.nodes.filter((n) => n.kind === 'gnd');
    if (gnds.length < 2) continue;
    const ys = [...new Set(gnds.map((n) => Math.round(n.y)))];
    if (ys.length > 1) bad.push(`${entry.template}/${entry.specId}：接地符号在 y=${ys.join(' / ')}`);
  }
  if (bad.length > 0) fail(bad);
});

check('S15 文本/连接点标签不得与器件符号图形相交，且不得占据接地符号的正上/下方', () => {
  eachSpec(({ spec }) => {
    const bodies = spec.nodes
      .filter((n) => SYMBOLS[n.kind] && !['text', 'dot', 'pin'].includes(n.kind))
      .map((n) => ({ id: n.id, kind: n.kind, rect: box(n) }))
      .filter((item) => item.rect);
    const gnds = spec.nodes.filter((n) => n.kind === 'gnd');
    for (const node of spec.nodes) {
      if (node.kind !== 'text' && node.kind !== 'dot') continue;
      const rect = labelBox(node);
      if (!rect) continue;
      for (const body of bodies) {
        if (rectsOverlap(rect, body.rect, 2)) {
          throw new Error(`「${rect.text}」压在 ${body.id}(${body.kind}) 的符号图形上`);
        }
      }
      // A1-1 的形状：注释文字横跨接地符号所在列，地符号的竖杆从字中间穿过。
      // 只检查纵向确实触及地符号（y1 ≥ gnd.y）的文字，避免误伤地轨上方的普通标签。
      if (node.kind !== 'text') continue;
      for (const gnd of gnds) {
        const gndX0 = gnd.x - SYMBOLS.gnd.hw;
        const gndX1 = gnd.x + SYMBOLS.gnd.hw;
        if (rect.y1 >= gnd.y && rect.x0 < gndX1 - 2 && gndX0 < rect.x1 - 2) {
          throw new Error(`「${rect.text}」的 x 区间覆盖接地符号 ${pt([gnd.x, gnd.y])}`);
        }
      }
    }
  });
});

/** 极性箭头的固定坐标串：与资产/生成器逐字对应，不用宽松正则。 */
const POLARITY_ARROW = {
  npn: 'M45 64L41 56M45 64L52 59',
  pnp: 'M44 33L51 36M44 33L49 28',
  nmos: 'M40 50L46 46M40 50L46 54',
  pmos: 'M46 50L40 46M46 50L40 54',
  'nmos-r90': 'M36 72L40 78M36 72L32 78',
  'pmos-r90': 'M36 78L40 72M36 78L32 72',
};

check('S16 带极性器件必须有极性箭头笔画', () => {
  const missing = [];
  for (const [kind, signature] of Object.entries(POLARITY_ARROW)) {
    const art = SYMBOL_ART[kind];
    const overlay = (SYMBOLS[kind]?.artOverlay ?? []).join(' ');
    const haystack = `${art?.inner ?? ''} ${overlay}`;
    if (!haystack.includes(signature)) {
      missing.push(`${kind}：缺少固定箭头笔画 ${signature}`);
    }
  }
  if (missing.length > 0) fail(missing);
});

/* ------------------------------------------------------------------ W21-B B1：N(x)≡0 不出图 */

check('B1 / 恒零面板判定：全 0 判零、有数不判零', () => {
  const zero = {
    id: 'n', title: '轴力图（拉为正）', unit: 'kN', xLabel: 'x (m)', yLabel: 'kN',
    xDomain: [0, 4], yDomain: [-1, 1],
    series: [{ kind: 'line', points: [[0, 0], [2, 0], [4, 0]] }],
  };
  const shear = { ...zero, id: 'q', series: [{ kind: 'line', points: [[0, 10], [4, -10]] }] };
  if (!isFlatZeroPanel(zero)) throw new Error('全 0 的轴力图没判成恒零');
  if (isFlatZeroPanel(shear)) throw new Error('有剪力曲线被误判成恒零');
  const kept = visiblePanels({ ...zero, panels: [zero, shear] });
  if (kept.length !== 1 || kept[0].id !== 'q') throw new Error(`可见面板应只剩 q，实际 ${kept.map((p) => p.id)}`);
  if (visiblePanels({ ...zero, panels: [zero, { ...zero, id: 'm' }] }).length !== 0) {
    throw new Error('所有分量恒 0 时应该一张都不画');
  }
});

check('B1 / M3 真实装配图的内力结论卡不再渲染 N(x)≡0 面板（C0-3：数据全带、渲染层筛）', () => {
  const json = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'M3.json'), 'utf8'));
  const graph = freshSkeleton('M3', labSkeletonSpec('M3', json.render_specs[0]));
  const chart = internalChart(frameSolve(graph));
  if (!chart) throw new Error('M3 明明有弯矩/剪力，却没产内力图');
  // C0-3 之后 spec 恒零面板原样带出（单一真相在渲染层筛），断言改钉「可见面板」。
  const visible = visiblePanels(chart).map((panel) => panel.id);
  const carried = (chart.panels ?? []).map((panel) => panel.id);
  if (visible.includes('n')) throw new Error(`恒零轴力面板仍会渲染：可见 ${visible.join('/')}`);
  if (!carried.includes('n')) throw new Error('恒零轴力面板没带进 spec（渲染层没法给灰字说明）');
  if (!visible.includes('q') || !visible.includes('m')) throw new Error(`剪力/弯矩面板被误删：${visible.join('/')}`);
});

check('B1 / 渲染层与结论卡都接上同一个判据（不是只在门禁里过滤）', () => {
  const chartSrc = fs.readFileSync('src/render/Chart.tsx', 'utf8');
  const measureSrc = fs.readFileSync('src/core/lab/measures.ts', 'utf8');
  if (!/visiblePanels\(spec\)/.test(chartSrc)) throw new Error('Chart.tsx 没用 visiblePanels');
  if (!/isFlatZeroPanel\(one\)/.test(measureSrc)) throw new Error('measures.ts 没过滤恒零面板');
  if (!/flat-zero-chart/.test(chartSrc)) throw new Error('全零时没有「不渲染」的人话');
});

/* ------------------------------------------------------------------ 汇总 */

console.log('');
console.log(`检查范围：${SPECS.length} 张电路图（${[...new Set(SPECS.map((s) => s.template))].join('/')}）`);
console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项（电路图门禁 / B1 N 恒 0 不出图）`);
