/**
 * 卡诺图门禁：
 *  - D1 示例的每个 region.cells 必须是格雷码意义下的矩形（1/2/4 × 1/2/4 笛卡尔积，允许环绕）；
 *  - 所有 1 必须被至少一个矩形覆盖，任何矩形不得覆盖 0；
 *  - 故意造 L 形 / 3 列矩形，必须被同一判据拒绝。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKarnaughRegion, minimize } from '../src/core/templates/digital/minimize.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
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

const d1 = JSON.parse(readFileSync(join(root, 'src', 'examples', 'D1.json'), 'utf8'));
const kmap = d1.render_specs.find((spec) => spec.type === 'karnaugh');
const values = {};
for (const node of kmap?.nodes ?? []) {
  if (node.kind === 'kmap-cell') values[`${node.y}${node.x}`] = node.label;
}

check('卡诺图：D1 每个 region 都是合法矩形', () => {
  must(kmap, 'D1 缺少 karnaugh 图');
  must((kmap.regions ?? []).length > 0, 'D1 没有任何分组');
  for (const region of kmap.regions) {
    const verdict = checkKarnaughRegion(region.cells, values);
    must(verdict.ok, `${region.id} ${region.label}：${verdict.detail}`);
  }
});

check('卡诺图：覆盖全部 1 且不碰 0', () => {
  const covered = new Set(kmap.regions.flatMap((region) => region.cells));
  for (const [cell, value] of Object.entries(values)) {
    if (value === '1') must(covered.has(cell), `1 格 ${cell} 未被覆盖`);
    if (covered.has(cell)) must(value !== '0', `0 格 ${cell} 被矩形覆盖`);
  }
});

check('卡诺图：圈的个数必须等于最小化器的最简项数', () => {
  const parse = (raw) =>
    String(raw ?? '')
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value));
  const minterms = parse(d1.parsed_given.minterms);
  const dontCares = parse(d1.parsed_given.dontCares);
  const terms = minimize(minterms, dontCares, 4);
  must(
    (kmap.regions ?? []).length === terms.length,
    `regions=${kmap.regions?.length}，最简项数=${terms.length}`,
  );
});

check('卡诺图：非矩形 / 非 2 的幂必须被拒绝', () => {
  const lShape = checkKarnaughRegion(['00', '01', '10'], { '00': '1', '01': '1', '10': '1' });
  must(!lShape.ok, 'L 形 cells 未被拒绝');
  const threeCols = checkKarnaughRegion(['00', '01', '02'], { '00': '1', '01': '1', '02': '1' });
  must(!threeCols.ok, '3 列矩形未被拒绝');
  const coversZero = checkKarnaughRegion(['00', '01'], { '00': '1', '01': '0' });
  must(!coversZero.ok, '覆盖 0 的矩形未被拒绝');
  const wrap = checkKarnaughRegion(['30', '31', '00', '01'], {
    '30': '1', '31': '1', '00': '1', '01': '1',
  });
  must(wrap.ok, `合法的环绕矩形被误杀：${wrap.detail}`);
});

console.log('');
if (errors.length > 0) {
  console.error(`FAIL：${errors.length}/${checks} 项未通过`);
  for (const error of errors) console.error(`- ${error.name}: ${error.message}`);
  process.exit(1);
}
console.log(`PASS：${checks}/${checks} 项（卡诺图矩形）`);