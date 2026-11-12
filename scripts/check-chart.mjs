/**
 * 坐标图门禁：ChartSpec / MohrSpec 不是 schematic，S1–S16 管不到，所以单独立六条。
 *
 *  ① yDomain 覆盖全部采样点（xDomain 也顺带查）
 *  ② marks 的 (x, y) 落在对应曲线上（step 按阶梯语义，容差 1e-6）
 *  ③ panels 各子图 xDomain 完全一致（双联共享一条 x 轴）
 *  ④ M4/M8 的 σ 分布里「中性轴」与 σ=0 的交点一致（1e-6）
 *  ⑤ 莫尔圆圆度：σ/τ 两轴每单位长度像素相同（长短轴比 < 1.001）
 *  ⑥ 莫尔圆圆心与半径与 solver 给的一致（1e-6）
 *  ⑦ 「|…|」开头的标注，数值必须 ≥ 0（绝对值里印负号 = 文案错，数值断言抓不到）
 *
 * 数据源：src/examples/M{1..8}.json —— 由 check:p3 先验过「与实时 solver 逐字段一致」，
 * 所以门禁查的就是屏幕真正会画的那份 render_spec，不是另一套描述。
 * ⑤⑥ 用的是渲染器同款 mohrLayout()，不是另写一份几何。
 *
 * 变异测试见 .tmp/mech/mutate-chart.mjs（收窄 yDomain / 改 mark / 改莫尔域）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mohrLayout } from '../src/render/mohrLayout.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// 变体也一起查：M3 悬臂的弯矩标注曾经因为「|M|max 当 y」点到图顶去，只有把变体
// 纳入门禁才发现得了（母题是正弯矩，看不出这个问题）。
const IDS = ['M1', 'M2', 'M3', 'M3-cantilever', 'M4', 'M5', 'M6', 'M7', 'M8'];
const REL = 1e-6;

const problems = [];
let checks = 0;

function fail(id, rule, detail) {
  problems.push(`${id} / ${rule} / ${detail}`);
}

/** 曲线在 x 处的值：line 线性插值，step 取左侧阶跃值。 */
function valueAt(series, x) {
  const pts = series.points;
  if (pts.length === 0) return null;
  if (series.kind === 'step') {
    let value = pts[0][1];
    for (const [px, py] of pts) if (px <= x + 1e-12) value = py;
    return value;
  }
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x >= Math.min(x0, x1) - 1e-12 && x <= Math.max(x0, x1) + 1e-12) {
      if (x1 === x0) return y1;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return null;
}

function near(a, b, scale) {
  return Math.abs(a - b) <= REL * Math.max(1, Math.abs(scale));
}

function panelsOf(spec) {
  return spec.panels && spec.panels.length > 0 ? spec.panels : [spec];
}

for (const id of IDS) {
  const snapshot = JSON.parse(readFileSync(join(root, 'src', 'examples', `${id}.json`), 'utf8'));
  const charts = snapshot.render_specs.filter((spec) => spec.chart);
  const mohrs = snapshot.render_specs.filter((spec) => spec.mohr);
  if (charts.length === 0 && mohrs.length === 0) {
    fail(id, '①', '既没有 chart 也没有 mohr 的 render_spec');
    continue;
  }

  for (const spec of charts) {
    const chart = spec.chart;
    const panels = panelsOf(chart);

    // ① domain 覆盖
    for (const panel of panels) {
      const [y0, y1] = panel.yDomain;
      const [x0, x1] = panel.xDomain;
      if (!(y1 > y0)) fail(id, '①', `${panel.id} yDomain 退化 [${y0}, ${y1}]`);
      for (const series of panel.series) {
        for (const [x, y] of series.points) {
          checks += 1;
          if (y < y0 - 1e-12 || y > y1 + 1e-12) {
            fail(id, '①', `${panel.id} 采样点 y=${y} 超出 yDomain [${y0}, ${y1}]`);
            break;
          }
          if (x < x0 - 1e-12 || x > x1 + 1e-12) {
            fail(id, '①', `${panel.id} 采样点 x=${x} 超出 xDomain [${x0}, ${x1}]`);
            break;
          }
        }
      }
    }

    // ② marks 落在曲线上
    for (const panel of panels) {
      const scale = Math.max(
        1,
        ...panel.series.flatMap((series) => series.points.map(([, y]) => Math.abs(y))),
      );
      for (const mark of panel.marks ?? []) {
        checks += 1;
        const candidates = panel.series
          .map((series) => valueAt(series, mark.x))
          .filter((value) => value !== null);
        if (candidates.length === 0) {
          fail(id, '②', `${panel.id} mark「${mark.text}」的 x=${mark.x} 不在任何曲线区间内`);
          continue;
        }
        const best = candidates.reduce((acc, value) => (Math.abs(value - mark.y) < Math.abs(acc - mark.y) ? value : acc));
        if (!near(best, mark.y, scale)) {
          fail(
            id,
            '②',
            `${panel.id} mark「${mark.text}」y=${mark.y}，曲线在 x=${mark.x} 处 y=${best}（差 ${Math.abs(best - mark.y).toExponential(2)}）`,
          );
        }
      }
    }

    // ⑦ 绝对值标注不许带负号：`|M|max=-10.00` 这种「绝对值印出负号」是纯文案错，
    //    但四条数值断言全绿也照样漏过去（M3 悬臂就漏过一次）。
    for (const panel of panels) {
      for (const mark of panel.marks ?? []) {
        const match = /^[|｜][^=＝]*[=＝]\s*(-?\d+(?:\.\d+)?)/.exec(mark.text);
        if (!match) continue;
        checks += 1;
        if (Number(match[1]) < 0) {
          fail(id, '⑦', `${panel.id} mark「${mark.text}」以绝对值开头，数值却是负的`);
        }
      }
    }

    // ③ panels 共享 x 轴
    if (panels.length > 1) {
      checks += 1;
      const [ax0, ax1] = panels[0].xDomain;
      for (const panel of panels.slice(1)) {
        const [bx0, bx1] = panel.xDomain;
        if (ax0 !== bx0 || ax1 !== bx1) {
          fail(id, '③', `${panels[0].id} xDomain=[${ax0},${ax1}] 与 ${panel.id} xDomain=[${bx0},${bx1}] 不一致`);
        }
      }
      if (chart.xDomain[0] !== ax0 || chart.xDomain[1] !== ax1) {
        fail(id, '③', `父图 xDomain 与子图不一致`);
      }
    }
  }

  // ⑤ 莫尔圆圆度 + ⑥ 圆心/半径（只对带 mohr 的题型）
  for (const spec of mohrs) {
    const mohr = spec.mohr;
    const layout = mohrLayout(mohr);
    checks += 1;
    const axisRatio = layout.scaleX / layout.scaleY;
    if (!(Math.abs(axisRatio - 1) < 1e-3)) {
      fail(
        id,
        '⑤',
        `σ 轴 ${layout.scaleX.toFixed(6)} px/MPa 与 τ 轴 ${layout.scaleY.toFixed(6)} px/MPa 不一致（比 ${axisRatio.toFixed(4)}），画出来是椭圆`,
      );
    }
    const ellipseRatio = layout.rx / layout.ry;
    if (!(Math.abs(ellipseRatio - 1) < 1e-3)) {
      fail(id, '⑤', `长短轴比 ${ellipseRatio.toFixed(6)} ≥ 1.001（rx=${layout.rx} ry=${layout.ry}）`);
    }
    checks += 1;
    const centerFromComponents = (mohr.sigmaX + mohr.sigmaY) / 2;
    const radiusFromComponents = Math.hypot((mohr.sigmaX - mohr.sigmaY) / 2, mohr.tauXY);
    const scaleS = Math.max(1, Math.abs(mohr.sigma1), Math.abs(mohr.sigma2));
    if (!near(mohr.center, centerFromComponents, scaleS)) {
      fail(id, '⑥', `spec.center=${mohr.center}，由分量算得 ${centerFromComponents}`);
    }
    if (!near(mohr.radius, radiusFromComponents, scaleS)) {
      fail(id, '⑥', `spec.radius=${mohr.radius}，由分量算得 ${radiusFromComponents}`);
    }
    if (!near(Number(snapshot.result.center), mohr.center, scaleS)) {
      fail(id, '⑥', `result.center=${snapshot.result.center} 与 spec.center=${mohr.center} 不一致`);
    }
    if (!near(Number(snapshot.result.radius), mohr.radius, scaleS)) {
      fail(id, '⑥', `result.radius=${snapshot.result.radius} 与 spec.radius=${mohr.radius} 不一致`);
    }
    if (!near(mohr.sigma1 - mohr.sigma2, 2 * mohr.radius, scaleS)) {
      fail(id, '⑥', `σ1−σ2=${mohr.sigma1 - mohr.sigma2} ≠ 2R=${2 * mohr.radius}`);
    }
  }

  // ④ M4 / M8 的 σ 分布：中性轴必须是 σ=0 的根
  if (id === 'M4' || id === 'M8') {
    const stress = charts.find((spec) => spec.chart.id === (id === 'M4' ? 'sigma' : 'combined'));
    if (!stress) {
      fail(id, '④', '缺少 σ 分布图（chart.id=sigma）');
    } else {
      checks += 1;
      const series = stress.chart.series[0];
      let crossing = null;
      for (let i = 1; i < series.points.length; i += 1) {
        const [y0, s0] = series.points[i - 1];
        const [y1, s1] = series.points[i];
        if (s0 === 0) {
          crossing = y0;
          break;
        }
        if (s0 * s1 < 0) {
          crossing = y0 + ((y1 - y0) * (0 - s0)) / (s1 - s0);
          break;
        }
      }
      // 曲线极值必须等于 result.sigmaMax：这条以前没有，M4 的 σ 少了 ×1e-3 的换算
      // （图上写着 σ=-30000.0 MPa），四条断言全绿也照样漏过去了。
      checks += 1;
      const peak = series.points.reduce((acc, [, value]) => Math.max(acc, Math.abs(value)), 0);
      const expectedPeak = Number(snapshot.result.sigmaMax);
      if (Number.isFinite(expectedPeak) && !near(peak, expectedPeak, expectedPeak)) {
        fail(id, '④', `σ 曲线极值 ${peak} 与 result.sigmaMax=${expectedPeak} 不一致`);
      }

      const raw = snapshot.result.neutralAxis;
      const expected = Number(raw);
      const half = Math.abs(series.points[0][0]);
      if (crossing === null) {
        // 中性轴落在截面外（全截面同号）时，result 里写的是「截面外」
        if (Number.isFinite(expected)) fail(id, '④', 'σ(y) 未穿过 0，找不到中性轴');
      } else if (Number.isFinite(expected) && !near(crossing, expected, half)) {
        fail(id, '④', `σ=0 交点在 y=${crossing}，result.neutralAxis=${expected}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`FAIL：${problems.length} 处（${checks} 项检查）`);
  for (const item of problems.slice(0, 20)) console.error(`- ${item}`);
  if (problems.length > 20) console.error(`… 其余 ${problems.length - 20} 处省略`);
  process.exit(1);
}
console.log(
  `PASS：${checks} 项（坐标图门禁：domain 覆盖 / marks 落曲线 / panels 同轴 / 中性轴 / 莫尔圆圆度 / 圆心与半径 / 绝对值标注）`,
);
