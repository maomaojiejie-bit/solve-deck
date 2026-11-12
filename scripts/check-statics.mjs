/**
 * 静力学 + 材料力学受力图门禁（S1–S7 / M1–M8）。坐标图部分由 check:chart 管，
 * 这里管「力学本身 + 受力图」。
 *
 *  ① 七型 golden 逐位（相对 1e-9；字符串结论按字面比）
 *  ② 桁架逐节点 ΣF=0 残差 < 1e-9（三组参数，含扁桁架）
 *  ③ 静不定 / 机构必须被拒：status 正确、result 里**连反力的键都没有**、
 *     文案含判据理由、并给出「怎么改」；反例页（变体）必须与拒绝态快照对得上
 *  ④ 受力图：箭头数 = 载荷数 + 反力数；支座图元与 solver 的 spec 一一对应
 *  ⑤ 图上的每个数字（标注 / 杆件内力 tag）都必须等于 solver 的同一数值
 *  ⑥ M 系受力图与 S 系同一套规矩：力箭头数 = 载荷力数 + 反力力数，
 *     反力偶单独画圆弧箭头，零反力分量不许画，标签数值逐条回代 solver.reactions
 *
 * 数据源：src/examples/S*.json / M*.json —— check:p3 已验过「快照 == 实时 solver」，
 * 所以这里查的就是屏幕上真正会画的那一份。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplate, VARIANT_BY_ID } from '../src/core/templates/registry.ts';
import { goldenCasesFor } from '../src/confidence/goldenSet/index.ts';
import { analyzeTruss } from '../src/core/statics/truss.ts';
import { solveMech } from '../src/core/mechanics/solve.ts';
import { s1Params, s1Spec } from '../src/core/templates/statics/S1.ts';
import { s3Params, s3Spec } from '../src/core/templates/statics/S3.ts';
import { s5Params, s5Spec } from '../src/core/templates/statics/S5.ts';
import { m1Params, m1Spec } from '../src/core/templates/mechanics/M1.ts';
import { m2Params, m2Spec } from '../src/core/templates/mechanics/M2.ts';
import { m3CantileverSpec, m3Params, m3Spec } from '../src/core/templates/mechanics/M3.ts';
import { m4Params, m4Spec } from '../src/core/templates/mechanics/M4.ts';
import { m5Params, m5Spec } from '../src/core/templates/mechanics/M5.ts';
import { m8Params, m8Spec } from '../src/core/templates/mechanics/M8.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
const MECH_IDS = ['M1', 'M2', 'M3', 'M3-cantilever', 'M4', 'M5', 'M8'];
const REL = 1e-9;

const problems = [];
let checks = 0;

function fail(id, rule, detail) {
  problems.push(`${id} / ${rule} / ${detail}`);
}

function readSnapshot(id) {
  const file = join(root, 'src', 'examples', `${id}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

const snapshots = {};
for (const id of [...IDS, ...MECH_IDS]) {
  const snap = readSnapshot(id);
  if (!snap) {
    fail(id, '①', `缺少快照 ${join(root, 'src', 'examples', `${id}.json`)}`);
    continue;
  }
  snapshots[id] = snap;
}

/* ── ① golden 逐位 ─────────────────────────────────────────────── */

for (const id of IDS) {
  const entry = getTemplate(id);
  if (typeof entry.solver !== 'function') {
    fail(id, '①', 'solver 不是懒载函数');
    continue;
  }
  const cases = goldenCasesFor(id);
  if (cases.length === 0) {
    fail(id, '①', '没有黄金夹具');
    continue;
  }
  const module = await entry.solver();
  for (const item of cases) {
    let solution;
    try {
      solution = module.default(item.input);
    } catch (error) {
      fail(id, '①', `${item.id} 求解抛异常：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const [key, expected] of Object.entries(item.expected)) {
      checks += 1;
      const actual = solution.result[key];
      if (typeof expected === 'number' && typeof actual === 'number') {
        const diff = Math.abs(actual - expected);
        if (!(diff <= REL * Math.max(1, Math.abs(expected)))) {
          fail(id, '①', `${item.id}.${key} 期望 ${expected}，实际 ${actual}（差 ${diff.toExponential(2)}）`);
        }
      } else if (String(actual) !== String(expected)) {
        fail(id, '①', `${item.id}.${key} 期望 ${expected}，实际 ${actual}`);
      }
    }
  }
}

/* ── ② 桁架逐节点残差 ───────────────────────────────────────────── */

for (const params of [
  { L: 2, H: 1, P: 10 },
  { L: 4, H: 1.5, P: 24 },
  { L: 3, H: 3, P: 9 },
]) {
  const analysis = analyzeTruss(s5Spec(s5Params(params)));
  checks += 1;
  if (!analysis.ok) {
    fail('S5', '②', `${JSON.stringify(params)} 桁架无解：${analysis.message}`);
    continue;
  }
  for (const node of analysis.nodeResiduals) {
    checks += 1;
    if (!(node.residual < 1e-9)) {
      fail(
        'S5',
        '②',
        `${JSON.stringify(params)} 节点 ${node.node}: ΣFx=${node.sumFx}，ΣFy=${node.sumFy}，残差 ${node.residual.toExponential(2)}`,
      );
    }
  }
  if (!(analysis.unknownCount === analysis.equationCount)) {
    fail('S5', '②', `未知量 ${analysis.unknownCount} ≠ 方程 ${analysis.equationCount}`);
  }
}

/* ── ③ 静不定 / 机构必须被拒 ────────────────────────────────────── */

const s1 = getTemplate('S1');
const s1Module = await s1.solver();
const refusalCases = [
  { config: 'indeterminate', status: 'indeterminate', keyword: '静不定' },
  { config: 'mechanism', status: 'out-of-scope', keyword: '机构' },
];
for (const item of refusalCases) {
  const solution = s1Module.default({ L: 4, a: 2, P: 10, config: item.config });
  checks += 1;
  if (solution.result.status !== item.status) {
    fail('S1', '③', `${item.config} status=${solution.result.status}，应为 ${item.status}`);
  }
  checks += 1;
  const numericKeys = Object.keys(solution.result).filter(
    (key) => typeof solution.result[key] === 'number' && !['unknownCount', 'equationCount', 'rank'].includes(key),
  );
  if (numericKeys.length > 0) {
    fail('S1', '③', `${item.config} 拒绝态却给出了数字：${numericKeys.join(', ')}`);
  }
  checks += 1;
  if (!String(solution.result.conclusion).includes(item.keyword)) {
    fail('S1', '③', `${item.config} 结论文案没有说明「${item.keyword}」：${solution.result.conclusion}`);
  }
  checks += 1;
  if (typeof solution.result.remedy !== 'string' || solution.result.remedy.trim().length === 0) {
    fail('S1', '③', `${item.config} 拒绝态没有给「怎么改」（result.remedy）`);
  }
}

/*
 * 反例**快照**（屏幕上真画的那一份）也要满足同一条：以后有人「把它修好」，
 * 只要快照里冒出反力数字、或者反例变体与拒绝态对不上，这里就响。
 * 白名单只有三个判据计数器 —— 它们是拒绝的**证据**（n=4 > 3），不是解出来的反力。
 */
const REFUSAL_SHOTS = [
  { id: 'S1-indeterminate', variant: 'S1-indeterminate', status: 'indeterminate', keyword: '静不定' },
  { id: 'S1-mechanism', variant: 'S1-mechanism', status: 'out-of-scope', keyword: '机构' },
];
for (const item of REFUSAL_SHOTS) {
  // 反例快照不在 IDS / MECH_IDS 里（它们是变体），单独读；读不到就是缺件，不许静默跳过
  const snap = readSnapshot(item.id);
  checks += 1;
  if (!snap) {
    fail(item.id, '③', `缺少反例快照 src/examples/${item.id}.json`);
    continue;
  }
  checks += 1;
  const numericKeys = Object.keys(snap.result).filter(
    (key) => typeof snap.result[key] === 'number' && !['unknownCount', 'equationCount', 'rank'].includes(key),
  );
  if (numericKeys.length > 0) {
    fail(item.id, '③', `反例快照的 result 里出现了数字：${numericKeys.join(', ')}（拒绝态应当一个反力数字都没有）`);
  }
  checks += 1;
  if (snap.result.status !== item.status) {
    fail(item.id, '③', `status=${snap.result.status}，应为 ${item.status}`);
  }
  checks += 1;
  if (!String(snap.result.conclusion).includes(item.keyword)) {
    fail(item.id, '③', `结论文案没有说明「${item.keyword}」`);
  }
  checks += 1;
  if (typeof snap.result.remedy !== 'string' || snap.result.remedy.trim().length === 0) {
    fail(item.id, '③', '反例快照没有 result.remedy（结果页要显示「怎么改」）');
  }
  // 反例页的页头横幅由变体的 rejection 标签驱动：标签丢了，页头就不再明说「这是故意的」
  checks += 1;
  const routed = VARIANT_BY_ID.get(item.variant);
  if (!routed || typeof routed.variant.rejection !== 'string' || !routed.variant.rejection.trim()) {
    fail(item.id, '③', '变体缺少 rejection 标签，结果页不会挂「反例」横幅');
  }
}

/* ── ④⑤ 受力图：箭头数 / 支座图元 / 图上数字 ───────────────────── */

const SUPPORT_SYMBOL = { pin: 'pinSupport', roller: 'rollerSupport', fixed: 'fixedSupport' };

function supportExpectation(kinds) {
  const out = {};
  for (const kind of kinds) {
    const symbol = SUPPORT_SYMBOL[kind];
    out[symbol] = (out[symbol] ?? 0) + 1;
  }
  return out;
}

/** 每型的期望：箭头总数、支座图元、图上的数字 → solver 字段。 */
const EXPECT = {
  S1: (snap) => {
    const spec = s1Spec(s1Params({ ...snap.parsed_given, config: snap.result.config }));
    const ok = snap.result.status === 'ok';
    return {
      // 载荷 1 个 + 反力 2 个（拒绝态没有反力，所以不画）
      arrows: 1 + (ok ? 2 : 0),
      supports: supportExpectation(spec.supports.map((item) => item.kind)),
      labels: ok
        ? [
            { pattern: /R_A = (-?[\d.]+) kN/, key: 'RA' },
            { pattern: /R_B = (-?[\d.]+) kN/, key: 'RB' },
          ]
        : [],
    };
  },
  S2: (snap) => ({
    // 矢量图是 chart，不是 freebody：没有箭头图元，只有 chart 里的 mark
    arrows: 0,
    supports: {},
    labels: [],
    chartMarks: snap.render_specs.find((spec) => spec.chart)?.chart?.marks?.map((mark) => mark.text) ?? [],
  }),
  S3: (snap) => {
    const spec = s3Spec(s3Params(snap.parsed_given));
    return {
      arrows: 4, // 2 个载荷 + 2 个反力
      supports: supportExpectation(spec.supports.map((item) => item.kind)),
      labels: [
        { pattern: /R_A = (-?[\d.]+) kN/, key: 'RA' },
        { pattern: /R_B = (-?[\d.]+) kN/, key: 'RB' },
      ],
    };
  },
  S4: (snap) => ({
    arrows: 4, // W、P（外载）+ N、f（接触反力）
    supports: {},
    labels: [
      { pattern: /^W = (-?[\d.]+) N/, key: 'W' },
      { pattern: /^N = (-?[\d.]+) N/, key: 'N' },
      { pattern: /^f = (-?[\d.]+) N/, key: 'friction' },
      { pattern: /^P = (-?[\d.]+) N/, key: 'Pcrit' },
    ],
  }),
  S5: (snap) => {
    const spec = s5Spec(s5Params(snap.parsed_given));
    return {
      arrows: 3, // 顶点载荷 + A/B 两个反力
      supports: supportExpectation(spec.supports.map((item) => item.kind)),
      labels: [
        { pattern: /R_A = (-?[\d.]+) kN/, key: 'RA' },
        { pattern: /R_B = (-?[\d.]+) kN/, key: 'RB' },
      ],
      tags: [
        { member: 'AB', key: 'N_AB' },
        { member: 'AC', key: 'N_AC' },
        { member: 'BC', key: 'N_BC' },
      ],
    };
  },
  S6: () => ({ arrows: 0, supports: {}, labels: [] }),
  S7: (snap) => ({
    arrows: 2, // 重物 + 平衡力
    supports: { pinSupport: 1 },
    labels: [
      // parsed_given 用中文键（重物），result 用 F
      { pattern: /^W = (-?[\d.]+) N/, key: 'W', given: '重物' },
      { pattern: /^F = (-?[\d.]+) N/, key: 'F' },
    ],
  }),
};

for (const id of IDS) {
  const snap = snapshots[id];
  if (!snap) continue;
  const expect = EXPECT[id](snap);
  const figures = snap.render_specs.filter((spec) => !spec.chart && spec.mohr === undefined);
  const nodes = figures.flatMap((spec) => spec.nodes);
  const arrows = nodes.filter((node) => node.kind === 'arrow');

  checks += 1;
  if (arrows.length !== expect.arrows) {
    fail(id, '④', `箭头 ${arrows.length} 个，应为载荷+反力 = ${expect.arrows} 个`);
  }

  for (const [symbol, count] of Object.entries(expect.supports)) {
    checks += 1;
    const actual = nodes.filter((node) => node.kind === symbol).length;
    if (actual !== count) {
      fail(id, '④', `支座图元 ${symbol} 画了 ${actual} 个，spec 里是 ${count} 个`);
    }
  }

  const numeric = (value) => Number(value);
  for (const item of expect.labels) {
    checks += 1;
    const texts = nodes.map((node) => String(node.label ?? ''));
    const hit = texts.map((text) => item.pattern.exec(text)).find(Boolean);
    if (!hit) {
      fail(id, '⑤', `图上找不到与 ${item.pattern} 匹配的标注（应为 ${item.key}）`);
      continue;
    }
    const shown = numeric(hit[1]);
    const expected = numeric(
      snap.result[item.key] ?? snap.parsed_given[item.given ?? item.key],
    );
    if (!Number.isFinite(expected) || Math.abs(shown - expected) > 5e-3 * Math.max(1, Math.abs(expected))) {
      fail(id, '⑤', `图上写 ${shown}，solver 给 ${item.key}=${expected}`);
    }
  }

  for (const item of expect.tags ?? []) {
    checks += 1;
    const edges = figures.flatMap((spec) => spec.edges);
    const tag = edges.map((edge) => String(edge.tag ?? '')).find((text) => text.startsWith(`${item.member}:`));
    if (!tag) {
      fail(id, '⑤', `杆件 ${item.member} 没有内力标注`);
      continue;
    }
    const shown = Number(/(-?[\d.]+)/.exec(tag.slice(item.member.length + 1))?.[1]);
    const expected = numeric(snap.result[item.key]);
    if (!Number.isFinite(shown) || Math.abs(shown - expected) > 5e-3 * Math.max(1, Math.abs(expected))) {
      fail(id, '⑤', `杆 ${item.member} 标注 ${shown} kN，solver 给 ${item.key}=${expected} kN`);
    }
    // 拉/压标注必须与内力符号一致
    checks += 1;
    const stated = tag.includes('（压）') ? '压' : tag.includes('（拉）') ? '拉' : '零杆';
    const truth = Math.abs(expected) < 1e-9 ? '零杆' : expected > 0 ? '拉' : '压';
    if (stated !== truth) {
      fail(id, '⑤', `杆 ${item.member} 标注「${stated}」，但内力 ${expected} kN 应为「${truth}」`);
    }
  }

  // S2 的矢量图：chart 的 mark 文本里必须出现合力与方向
  for (const text of expect.chartMarks ?? []) {
    checks += 1;
    const match = /^R=(-?[\d.]+) N ∠(-?[\d.]+)°/.exec(text);
    if (!match) continue;
    if (Math.abs(Number(match[1]) - Number(snap.result.R)) > 5e-3 * Math.max(1, Number(snap.result.R))) {
      fail('S2', '⑤', `mark 写 R=${match[1]}，solver 给 R=${snap.result.R}`);
    }
    if (Math.abs(Number(match[2]) - Number(snap.result.thetaR)) > 5e-2) {
      fail('S2', '⑤', `mark 写方向 ${match[2]}°，solver 给 ${snap.result.thetaR}°`);
    }
  }
}

/* ── ⑥ M 系受力图：力箭头 = 载荷力 + 反力力，反力偶单画圆弧 ───────── */

/**
 * 期望值不抄图，从 spec + solver 独立数一遍：
 *  - 集中力 → 1 根力箭头；分布载荷 → 7 根；集中力偶 / 扭矩 → 只写标注（不是箭头）；
 *  - 每个支座的非零分量各算 1 个：Rx / Ry 是力箭头，Mz / Mx 是圆弧箭头（零分量不许画）。
 */
function mechFigureExpect(spec, sol) {
  let forceArrows = 0;
  let momentArcs = 0;
  for (const load of spec.loads) {
    if (load.type === 'point_force') forceArrows += 1;
    else if (load.type === 'distributed') forceArrows += 7;
  }
  for (const reaction of sol.reactions) {
    if (Math.abs(reaction.Rx ?? 0) > 1e-9) forceArrows += 1;
    if (Math.abs(reaction.Ry ?? 0) > 1e-9) forceArrows += 1;
    if (Math.abs(reaction.Mz ?? 0) > 1e-9) momentArcs += 1;
    if (Math.abs(reaction.Mx ?? 0) > 1e-9) momentArcs += 1;
  }
  return { forceArrows, momentArcs };
}

/** 每型：怎么由快照还原 spec / solver，以及「图上哪个标签 = solver 的哪个分量」。 */
const MECH_FIGURE = {
  M1: (snap) => {
    const spec = m1Spec(m1Params(snap.parsed_given));
    return { spec, sol: solveMech(spec), labels: [{ pattern: /^R_A = (-?[\d.]+) kN$/, at: (sol) => sol.reactions[0].Rx }] };
  },
  M2: (snap) => {
    const spec = m2Spec(m2Params(snap.parsed_given));
    return { spec, sol: solveMech(spec), labels: [{ pattern: /^T_A = (-?[\d.]+) kN·m$/, at: (sol) => sol.reactions[0].Mx }] };
  },
  M3: (snap) => {
    const spec = m3Spec(m3Params(snap.parsed_given));
    const sol = solveMech(spec);
    return {
      spec,
      sol,
      labels: [
        { pattern: /^R_A = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Ry },
        { pattern: /^R_B = (-?[\d.]+) kN$/, at: (s) => s.reactions[1].Ry },
      ],
    };
  },
  'M3-cantilever': (snap) => {
    const spec = m3CantileverSpec(m3Params(snap.parsed_given));
    return {
      spec,
      sol: solveMech(spec),
      // 悬臂固定端两个箭头：R_A（力）+ M_A（力偶圆弧）—— 任务 1 的验收点
      labels: [
        { pattern: /^R_A = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Ry },
        { pattern: /^M_A = (-?[\d.]+) kN·m$/, at: (s) => s.reactions[0].Mz },
      ],
    };
  },
  M4: (snap) => {
    const spec = m4Spec(m4Params(snap.parsed_given));
    const sol = solveMech(spec);
    return {
      spec,
      sol,
      labels: [
        { pattern: /^R_A = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Ry },
        { pattern: /^R_B = (-?[\d.]+) kN$/, at: (s) => s.reactions[1].Ry },
      ],
    };
  },
  M5: (snap) => {
    const spec = m5Spec(m5Params(snap.parsed_given));
    const sol = solveMech(spec);
    return {
      spec,
      sol,
      labels: [
        { pattern: /^R_A = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Ry },
        { pattern: /^R_B = (-?[\d.]+) kN$/, at: (s) => s.reactions[1].Ry },
      ],
    };
  },
  M8: (snap) => {
    const spec = m8Spec(m8Params(snap.parsed_given));
    return {
      spec,
      sol: solveMech(spec),
      // 固定端四个分量：R_Ax / R_Ay（力）、M_A（绕 z）、T_A（绕 x）
      labels: [
        { pattern: /^R_Ax = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Rx },
        { pattern: /^R_Ay = (-?[\d.]+) kN$/, at: (s) => s.reactions[0].Ry },
        { pattern: /^M_A = (-?[\d.]+) kN·m$/, at: (s) => s.reactions[0].Mz },
        { pattern: /^T_A = (-?[\d.]+) kN·m$/, at: (s) => s.reactions[0].Mx },
      ],
    };
  },
};

for (const id of MECH_IDS) {
  const snap = snapshots[id];
  if (!snap) continue;
  const figure = snap.render_specs.find((spec) => spec.type === 'freebody');
  checks += 1;
  if (!figure) {
    fail(id, '⑥', '没有受力图（freebody）—— M 系必须先把受力图画出来');
    continue;
  }
  const { spec, sol, labels } = MECH_FIGURE[id](snap);
  const expect = mechFigureExpect(spec, sol);
  const arrows = figure.nodes.filter((node) => node.kind === 'arrow');
  const arcs = figure.nodes.filter((node) => node.kind === 'momentArrow');

  checks += 1;
  if (arrows.length !== expect.forceArrows) {
    fail(id, '⑥', `力箭头 ${arrows.length} 个，应为 载荷力 + 反力力 = ${expect.forceArrows} 个`);
  }
  checks += 1;
  if (arcs.length !== expect.momentArcs) {
    fail(id, '⑥', `力偶圆弧 ${arcs.length} 个，应为（非零）反力偶 = ${expect.momentArcs} 个`);
  }
  checks += 1;
  const supports = figure.nodes.filter((node) => ['pinSupport', 'rollerSupport', 'fixedSupport'].includes(node.kind));
  if (supports.length !== spec.supports.length) {
    fail(id, '⑥', `支座图元 ${supports.length} 个，spec 里是 ${spec.supports.length} 个`);
  } else {
    const drawn = supports.map((node) => node.kind).sort().join(',');
    const wanted = spec.supports
      .map((item) => SUPPORT_SYMBOL[item.type])
      .sort()
      .join(',');
    if (drawn !== wanted) fail(id, '⑥', `支座图元 ${drawn}，spec 要求 ${wanted}`);
  }

  // 标签数值逐条回代 solver.reactions：图上的每个数都必须有一个解算来源
  // （只查反力图元 n-reaction-*；载荷箭头的标注由各型自己的步骤文案负责）
  const reactionNodes = figure.nodes.filter((node) => node.id.startsWith('n-reaction-'));
  const texts = reactionNodes.map((node) => String(node.label ?? ''));
  if (texts.length !== labels.length) {
    fail(id, '⑥', `反力标签 ${texts.length} 条，期望 ${labels.length} 条`);
  }
  for (const item of labels) {
    checks += 1;
    const hit = texts.map((text) => item.pattern.exec(text)).find(Boolean);
    if (!hit) {
      fail(id, '⑥', `图上找不到与 ${item.pattern} 匹配的反力标签`);
      continue;
    }
    const shown = Number(hit[1]);
    const expected = item.at(sol);
    if (!Number.isFinite(expected) || Math.abs(shown - expected) > 5e-3 * Math.max(1, Math.abs(expected))) {
      fail(id, '⑥', `图上写 ${shown}，solver 给 ${expected}`);
    }
  }

  // 零反力不许画：画一个 0 的箭头会被读成「解出来一个 0」
  checks += 1;
  const zeroLabel = reactionNodes.find((node) => /= -?0(\.0+)? /.test(String(node.label ?? '')));
  if (zeroLabel) fail(id, '⑥', `零反力也画了箭头：${zeroLabel.label}`);
}

/* ── 汇总 ─────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 处（${checks} 项检查）`);
  for (const item of problems.slice(0, 20)) console.error(`- ${item}`);
  if (problems.length > 20) console.error(`… 其余 ${problems.length - 20} 处省略`);
  process.exit(1);
}
console.log(
  `PASS：${checks} 项（静力学 + 材料力学受力图门禁：七型 golden 逐位 / 桁架逐节点残差 / 静不定与机构被拒 / 箭头数与支座图元 / 图上数字回代 / M 系反力箭头）`,
);
