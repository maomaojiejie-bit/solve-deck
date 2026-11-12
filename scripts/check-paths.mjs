/** 路径门禁：28 型 × 3 条路径，id / principle / intermediate 各自两两不同。 */

import { TEMPLATES, getTemplate } from '../src/core/templates/registry.ts';
import { D2_NETLIST } from '../src/core/templates/digital/D2.ts';
import { runPaths } from '../src/confidence/buildtime/paths.ts';
import { runD1Paths } from '../src/confidence/buildtime/d1Paths.ts';
import { runD3Paths } from '../src/confidence/buildtime/d3Paths.ts';
import { runD4Paths } from '../src/confidence/buildtime/d4Paths.ts';
import { runD5Paths } from '../src/confidence/buildtime/d5Paths.ts';
import { runD6Paths } from '../src/confidence/buildtime/d6Paths.ts';
import { runA1Paths } from '../src/confidence/buildtime/a1Paths.ts';
import { runA2Paths } from '../src/confidence/buildtime/a2Paths.ts';
import { runA3Paths } from '../src/confidence/buildtime/a3Paths.ts';
import { runA4Paths } from '../src/confidence/buildtime/a4Paths.ts';
import { runA5Paths } from '../src/confidence/buildtime/a5Paths.ts';
import { runA6Paths } from '../src/confidence/buildtime/a6Paths.ts';
import { A3_PATH_TOLERANCE } from '../src/confidence/buildtime/a3Paths.ts';
import { A5_PATH_TOLERANCE } from '../src/confidence/buildtime/a5Paths.ts';
import { A6_PATH_TOLERANCE } from '../src/confidence/buildtime/a6Paths.ts';
import { A7_PATH_TOLERANCE } from '../src/confidence/buildtime/a7Paths.ts';
import { runA7Paths } from '../src/confidence/buildtime/a7Paths.ts';
import { runMechPaths } from '../src/core/templates/mechanics/paths.ts';
import { runStaticsPaths } from '../src/core/templates/statics/paths.ts';
import {
  a3Params,
  solveA3Analytic,
  solveA3MNA,
} from '../src/core/templates/analog/A3.ts';
import {
  a5Params,
  solveA5Analytic,
  solveA5MNA,
} from '../src/core/templates/analog/A5.ts';

const errors = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`[ok]   ${name}`);
  } catch (error) {
    errors.push({ name, message: error instanceof Error ? error.message : String(error) });
    console.log(`[FAIL] ${name}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

check('路径：28 型 × 3 条，id / principle / intermediate 均两两不同', () => {
  must(TEMPLATES.length === 28, `题型数 ${TEMPLATES.length}`);
  for (const entry of TEMPLATES) {
    must(entry.paths.length === 3, `${entry.id} 路径数 ${entry.paths.length}`);
    for (const key of ['id', 'principle', 'intermediate']) {
      const values = entry.paths.map((path) => path[key]);
      must(values.every((value) => typeof value === 'string' && value.length > 0), `${entry.id} ${key} 为空`);
      must(new Set(values).size === values.length, `${entry.id} ${key} 未两两不同`);
    }
  }
});

check('路径：D2 三条 intermediate 与执行器返回值一致', () => {
  const d2 = getTemplate('D2');
  const declared = d2.paths.map((path) => path.intermediate);
  must(
    JSON.stringify(declared) === JSON.stringify(['truth-rows', 'node-levels', 'sop-terms']),
    `D2 声明为 ${declared.join(', ')}`,
  );
  const result = runPaths(D2_NETLIST);
  must(result.pathAIntermediate === 'truth-rows', '路径 A intermediate 不符');
  must(result.pathBIntermediate === 'node-levels', '路径 B intermediate 不符');
  must(result.pathCIntermediate === 'sop-terms', '路径 C intermediate 不符');
  must(result.levels.length > 0, 'digitaljs 未产出 node-levels');
  must(result.terms.length > 0, 'QMC 未产出 sop-terms');
});

function expectIntermediates(templateId, result, expected) {
  const actual = [result.pathAIntermediate, result.pathBIntermediate, result.pathCIntermediate];
  const declared = getTemplate(templateId).paths.map((path) => path.intermediate);
  must(JSON.stringify(declared) === JSON.stringify(expected), `${templateId} 声明 ${declared.join(', ')}`);
  must(JSON.stringify(actual) === JSON.stringify(expected), `${templateId} 执行器返回 ${actual.join(', ')}`);
  must(new Set(actual).size === 3, `${templateId} intermediate 不互异`);
  must(result.ok, `${templateId} 三路径未通过：${result.detail}`);
  must(Number.isFinite(result.maxResidual), `${templateId} maxResidual 非有限值`);
}

check('路径：D1/D3/D4/D5/D6 的 intermediate 与执行器一致', () => {
  expectIntermediates(
    'D1',
    runD1Paths({ variables: 'ABCD', minterms: '0,1,2,3,4,6' }),
    ['truth-rows', 'prime-rectangles', 'sop-terms'],
  );
  expectIntermediates(
    'D3',
    runD3Paths({ op: 'mux2' }),
    ['truth-rows', 'node-levels', 'sop-terms'],
  );
  expectIntermediates(
    'D4',
    runD4Paths({ ff: 'JK', q0: 0, j: '1011', k: '0101' }),
    ['characteristic-rows', 'timing-traces', 'excitation-rows'],
  );
  expectIntermediates(
    'D5',
    runD5Paths({ kind: 'seq-detector', pattern: '101', input: '1011010' }),
    ['state-table-rows', 'state-traces', 'direct-sequence'],
  );
  expectIntermediates(
    'D6',
    runD6Paths({ op: 'convert', value: 172, bits: 8 }),
    ['place-value-digits', 'radix-remainders', 'code-bitops'],
  );
});

check('容差来源唯一：runner 门槛 == registry 声明的最松容差', () => {
  const loosest = (id) => Math.max(...getTemplate(id).paths.map((p) => p.tolerance ?? 1e-6));
  for (const [id, value] of [
    ['A3', A3_PATH_TOLERANCE],
    ['A5', A5_PATH_TOLERANCE],
    ['A6', A6_PATH_TOLERANCE],
    ['A7', A7_PATH_TOLERANCE],
  ]) {
    const declared = loosest(id);
    must(value === declared, `${id}: runner 用 ${value}，registry 声明 ${declared}——两处容差漂移了`);
    if (declared > 1e-6) {
      must(
        getTemplate(id).paths.some(
          (path) => (path.tolerance ?? 1e-6) === declared && path.approximation?.trim(),
        ),
        `${id}: 容差放宽了但没写 approximation`,
      );
    }
  }
});

check('配置扫描：A3/A5 每个组态的闭式 vs MNA 都过 1e-6', () => {
  const relative = (a, b) => {
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
    return Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
  };
  const tolerance = getTemplate('A3').paths.find((path) => path.id === 'symbolic-equiv').tolerance ?? 1e-6;
  must(tolerance === 1e-6, `A3 symbolic-equiv tolerance=${tolerance}，应为 1e-6`);

  for (const config of ['CE', 'CB', 'CC']) {
    const params = a3Params({ config });
    const mna = solveA3MNA(params);
    const closed = solveA3Analytic(params);
    for (const key of ['Av', 'Ri', 'Ro']) {
      const residual = relative(mna[key], closed[key]);
      must(residual <= tolerance, `A3/${config} ${key} 残差 ${residual.toExponential(3)} 超过 ${tolerance}`);
    }
  }

  const a5Tolerance = getTemplate('A5').paths.find((path) => path.id === 'symbolic-equiv').tolerance ?? 1e-6;
  must(a5Tolerance === 1e-6, `A5 symbolic-equiv tolerance=${a5Tolerance}，应为 1e-6`);
  for (const config of ['CS', 'CG', 'CD']) {
    const params = a5Params({ config });
    const mna = solveA5MNA(params);
    const closed = solveA5Analytic(params);
    for (const key of ['Av', 'Ri', 'Ro']) {
      const residual = relative(mna[key], closed[key]);
      must(residual <= a5Tolerance, `A5/${config} ${key} 残差 ${residual.toExponential(3)} 超过 ${a5Tolerance}`);
    }
  }
});

check('路径：M1–M8（含 M3 悬臂变体）的 intermediate 与执行器一致', () => {
  const expectMech = (id, input, expected) => {
    const result = runMechPaths(id, input);
    const actual = [result.pathAIntermediate, result.pathBIntermediate, result.pathCIntermediate];
    must(JSON.stringify(actual) === JSON.stringify(expected), `${id} 执行器返回 ${actual.join(', ')}`);
    must(JSON.stringify(getTemplate(id).paths.map((p) => p.intermediate)) === JSON.stringify(expected), `${id} 声明与执行器不一致`);
    must(result.ok, `${id} 三路径未通过：${result.detail}`);
    must(result.maxResidual <= 1e-9, `${id} maxResidual=${result.maxResidual}`);
    return result;
  };
  expectMech('M1', { L: 1, A: 200, P: 40, E: 200, allow: 160 }, [
    'mech-internal-force', 'axial-closed', 'axial-integrated',
  ]);
  expectMech('M2', { L: 1, d: 40, T: 1, G: 80, allow: 40 }, [
    'mech-torque', 'torsion-closed', 'torsion-integrated',
  ]);
  expectMech('M3', { L: 4, a: 2, P: 20, q: 0 }, ['mech-diagrams', 'beam-closed', 'beam-integrated']);
  expectMech('M4', { L: 4, a: 2, P: 20, b: 100, h: 200, allow: 160 }, [
    'mech-stresses', 'bending-closed', 'section-integrated',
  ]);
  // 参数一改，三路径仍然一致（人工确认那句「参数改了仍过 parity」的机器版）
  expectMech('M3', { L: 6.5, a: 1.7, P: 45, q: 3 }, ['mech-diagrams', 'beam-closed', 'beam-integrated']);
  // 悬臂变体：同一套求解器、换支承条件，路径也必须跟着换（闭式 R=P+qL、M_A=Pa+qL²/2）
  expectMech('M3', { config: 'cantilever', L: 2, a: 1, P: 10, q: 0 }, [
    'mech-diagrams',
    'beam-closed',
    'beam-integrated',
  ]);
  expectMech('M5', { L: 4, a: 2, P: 20, b: 100, h: 200, E: 200 }, [
    'mech-deflection',
    'deflection-closed',
    'deflection-virtual-work',
  ]);
  expectMech('M5', { L: 6.5, a: 1.7, P: 45, b: 60, h: 120, E: 210 }, [
    'mech-deflection',
    'deflection-closed',
    'deflection-virtual-work',
  ]);
  expectMech('M6', { sx: 100, sy: 20, txy: 40, allow: 160 }, [
    'principal-search',
    'principal-closed',
    'principal-invariant',
  ]);
  expectMech('M6', { sx: -60, sy: -20, txy: 35, allow: 160 }, [
    'principal-search',
    'principal-closed',
    'principal-invariant',
  ]);
  expectMech('M7', { L: 2, b: 60, h: 60, E: 200, mu: 1, P: 150, sp: 200 }, [
    'euler-critical',
    'energy-rayleigh',
    'energy-integrated',
  ]);
  expectMech('M8', { L: 2, d: 120, Pn: 50, Pt: 10, T: 0.5, allow: 160 }, [
    'mech-combined',
    'combined-closed',
    'combined-integrated',
  ]);
  expectMech('M8', { L: 1.5, d: 60, Pn: 80, Pt: 20, T: 1.2, allow: 160 }, [
    'mech-combined',
    'combined-closed',
    'combined-integrated',
  ]);
  expectMech('M4', { L: 3.2, a: 2.4, P: 12, b: 60, h: 120, allow: 160 }, [
    'mech-stresses', 'bending-closed', 'section-integrated',
  ]);
});

check('路径：S1–S7 的 intermediate 与执行器一致', () => {
  const expectStatics = (id, input, expected) => {
    const result = runStaticsPaths(id, input);
    const actual = [result.pathAIntermediate, result.pathBIntermediate, result.pathCIntermediate];
    must(JSON.stringify(actual) === JSON.stringify(expected), `${id} 执行器返回 ${actual.join(', ')}`);
    must(
      JSON.stringify(getTemplate(id).paths.map((p) => p.intermediate)) === JSON.stringify(expected),
      `${id} 声明与执行器不一致`,
    );
    must(result.ok, `${id} 三路径未通过：${result.detail}`);
    must(result.maxResidual <= 1e-9, `${id} maxResidual=${result.maxResidual}`);
    return result;
  };
  expectStatics('S1', { L: 4, a: 2, P: 10, config: 'static' }, [
    'rank-criterion', 'count-criterion', 'load-projection',
  ]);
  expectStatics('S2', { F1: 100, th1: 30, F2: 100, th2: 150 }, [
    'component-sum', 'rotated-frame', 'cosine-law',
  ]);
  expectStatics('S3', { L: 3, x1: 1, P1: 10, x2: 2, P2: 20 }, [
    'rigid2d-solve', 'moment-closed', 'force-sum',
  ]);
  expectStatics('S4', { mu: 0.3, W: 200, alpha: 30, beta: 10 }, [
    'friction-closed', 'friction-bisection', 'friction-angle',
  ]);
  expectStatics('S5', { L: 2, H: 1, P: 10 }, ['node-method', 'section-method', 'joint-residual']);
  expectStatics('S6', { bf: 100, tf: 20, bw: 20, hw: 100 }, [
    'block-sum', 'height-integral', 'first-moment-zero',
  ]);
  expectStatics('S7', { a: 0.4, b: 0.6, W: 100 }, [
    'virtual-work', 'moment-balance', 'displacement-ratio',
  ]);
  // 参数一改，三路径仍然一致
  expectStatics('S3', { L: 6, x1: 1.5, P1: 8, x2: 4.5, P2: 30 }, [
    'rigid2d-solve', 'moment-closed', 'force-sum',
  ]);
  expectStatics('S5', { L: 4, H: 1.5, P: 24 }, ['node-method', 'section-method', 'joint-residual']);
  expectStatics('S6', { bf: 160, tf: 12, bw: 10, hw: 180 }, [
    'block-sum', 'height-integral', 'first-moment-zero',
  ]);
  // 拒绝态：静不定必须如实 fail（不是 pass、也不是抛异常）
  const refused = runStaticsPaths('S1', { L: 4, a: 2, P: 10, config: 'indeterminate' });
  must(!refused.ok, 'S1 静不定居然通过了三路径');
  must(refused.detail.includes('静不定'), `S1 静不定文案不含「静不定」：${refused.detail}`);
});

check('路径：A1–A7 的 intermediate 与执行器一致', () => {
  expectIntermediates('A1', runA1Paths({ mode: 'series', Vs: 5, R: 1000 }), [
    'load-line-intersection', 'piecewise-states', 'ideal-bounds',
  ]);
  expectIntermediates('A2', runA2Paths({}), ['node-voltages', 'loop-currents', 'zone-residuals']);
  expectIntermediates('A3', runA3Paths({ config: 'CE' }), [
    'small-signal-params', 'port-test-results', 'symbolic-residuals',
  ]);
  expectIntermediates('A4', runA4Paths({}), ['node-voltages', 'loop-currents', 'zone-residuals']);
  expectIntermediates('A5', runA5Paths({ config: 'CS' }), [
    'small-signal-params', 'port-test-results', 'symbolic-residuals',
  ]);
  expectIntermediates('A6', runA6Paths({}), ['node-equations', 'finite-gain-mna', 'limit-sweep']);
  expectIntermediates('A7', runA7Paths({}), ['loop-gain', 'closed-loop-mna', 'asymptotic-error']);
});

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项（路径门禁）`);