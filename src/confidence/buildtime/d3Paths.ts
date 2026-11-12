/**
 * D3 三路径（构建期）：
 *  A 目标函数真值表 → 'truth-rows'
 *  B 生成网表 digitaljs → 'node-levels'
 *  C 第三方 QMC 化简目标 → 'sop-terms'
 *
 * 验的是「生成的网表是否实现目标函数」，不是验卡诺图化简。
 */

import { createRequire } from 'node:module';
import { buildD3 } from '../../core/templates/digital/D3.ts';
import { runDigitalJs } from './paths.ts';

const require = createRequire(import.meta.url);

export interface D3PathsResult {
  ok: boolean;
  maxResidual: number;
  detail: string;
  pathAIntermediate: 'truth-rows';
  pathBIntermediate: 'node-levels';
  pathCIntermediate: 'sop-terms';
  outputA: string;
  outputB: string;
  outputC: string;
  terms: string[];
  levels: number;
}

type Input = Record<string, number | string>;

function rowsToBits(rows: { out: (0 | 1 | 'x')[] }[]): string {
  return rows.map((row) => row.out[0]).join('');
}

export function runD3Paths(input: Input): D3PathsResult {
  const built = buildD3(input);
  const outputA = rowsToBits(built.rows);

  const digital = runDigitalJs(built.netlist);
  const outputB = rowsToBits(digital.rows);

  const QuineMcCluskey = require('@helander/quine-mccluskey-js') as new (
    variables: string,
    values: number[],
  ) => { solve(): { getValue(): string }[] };
  const variables = built.spec.inputs.join('');
  const qmc = new QuineMcCluskey(variables, [...built.minterms]);
  const terms = qmc.solve().map((term) => term.getValue());
  const outputC = built.rows
    .map((row) => {
      const value = terms.some((term) =>
        [...term].every((bit, index) => bit === '-' || Number(bit) === row.in[index]),
      );
      return value ? '1' : '0';
    })
    .join('');

  const ok = outputA === outputB && outputA === outputC;
  return {
    ok,
    maxResidual: ok ? 0 : 1,
    detail: ok
      ? `目标/生成网表/QMC 三路一致：${outputA}`
      : `不一致：目标=${outputA}，生成网表=${outputB}，QMC=${outputC}`,
    pathAIntermediate: 'truth-rows',
    pathBIntermediate: 'node-levels',
    pathCIntermediate: 'sop-terms',
    outputA,
    outputB,
    outputC,
    terms,
    levels: digital.levels.length,
  };
}