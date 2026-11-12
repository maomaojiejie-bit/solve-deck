/**
 * 黄金夹具注册表：每个 ready 题型至少 1 道（T1 ≥3）。
 */

import type { TemplateId } from '../../core/types';
import type { GoldenCase } from './types';
import { D1_GOLDEN } from './d1.ts';
import { D2_GOLDEN } from './d2.ts';
import { D3_GOLDEN } from './d3.ts';
import { D4_GOLDEN } from './d4.ts';
import { D5_GOLDEN } from './d5.ts';
import { D6_GOLDEN } from './d6.ts';
import { A1_GOLDEN } from './a1.ts';
import { A2_GOLDEN } from './a2.ts';
import { A3_GOLDEN } from './a3.ts';
import { A4_GOLDEN } from './a4.ts';
import { A5_GOLDEN } from './a5.ts';
import { A6_GOLDEN } from './a6.ts';
import { A7_GOLDEN } from './a7.ts';
import { M1_GOLDEN } from './m1.ts';
import { M2_GOLDEN } from './m2.ts';
import { M3_GOLDEN } from './m3.ts';
import { M4_GOLDEN } from './m4.ts';
import { M5_GOLDEN } from './m5.ts';
import { M6_GOLDEN } from './m6.ts';
import { M7_GOLDEN } from './m7.ts';
import { M8_GOLDEN } from './m8.ts';
import { S1_GOLDEN } from './s1.ts';
import { S2_GOLDEN } from './s2.ts';
import { S3_GOLDEN } from './s3.ts';
import { S4_GOLDEN } from './s4.ts';
import { S5_GOLDEN } from './s5.ts';
import { S6_GOLDEN } from './s6.ts';
import { S7_GOLDEN } from './s7.ts';

export const GOLDEN_SET: Readonly<
  Partial<Record<TemplateId, readonly GoldenCase<unknown>[]>>
> = Object.freeze({
  D1: D1_GOLDEN,
  D2: D2_GOLDEN,
  D3: D3_GOLDEN,
  D4: D4_GOLDEN,
  D5: D5_GOLDEN,
  D6: D6_GOLDEN,
  A1: A1_GOLDEN,
  A2: A2_GOLDEN,
  A3: A3_GOLDEN,
  A4: A4_GOLDEN,
  A5: A5_GOLDEN,
  A6: A6_GOLDEN,
  A7: A7_GOLDEN,
  M1: M1_GOLDEN,
  M2: M2_GOLDEN,
  M3: M3_GOLDEN,
  M4: M4_GOLDEN,
  M5: M5_GOLDEN,
  M6: M6_GOLDEN,
  M7: M7_GOLDEN,
  M8: M8_GOLDEN,
  S1: S1_GOLDEN,
  S2: S2_GOLDEN,
  S3: S3_GOLDEN,
  S4: S4_GOLDEN,
  S5: S5_GOLDEN,
  S6: S6_GOLDEN,
  S7: S7_GOLDEN,
});

export function goldenCasesFor(templateId: TemplateId): readonly GoldenCase<unknown>[] {
  return GOLDEN_SET[templateId] ?? [];
}

export function goldenCount(): number {
  return Object.values(GOLDEN_SET).reduce(
    (total, cases) => total + (cases?.length ?? 0),
    0,
  );
}