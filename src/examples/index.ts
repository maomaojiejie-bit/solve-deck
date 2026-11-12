import type { Solution } from '../core/types';
import { assertSolutionContract } from '../core/templates/registry';

/**
 * 预置示例加载器：JSON 由 build-example.mjs 生成。
 * F8 的延伸：示例也懒载，避免主包随题型数线性膨胀。
 */
const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  D1: () => import('./D1.json'),
  D2: () => import('./D2.json'),
  D3: () => import('./D3.json'),
  D4: () => import('./D4.json'),
  D5: () => import('./D5.json'),
  D6: () => import('./D6.json'),
  A1: () => import('./A1.json'),
  A2: () => import('./A2.json'),
  A3: () => import('./A3.json'),
  A4: () => import('./A4.json'),
  A5: () => import('./A5.json'),
  A6: () => import('./A6.json'),
  A7: () => import('./A7.json'),
  'A3-CB': () => import('./A3-CB.json'),
  'A3-CC': () => import('./A3-CC.json'),
  'A5-CG': () => import('./A5-CG.json'),
  'A5-CD': () => import('./A5-CD.json'),
  M1: () => import('./M1.json'),
  M2: () => import('./M2.json'),
  M3: () => import('./M3.json'),
  M4: () => import('./M4.json'),
  M5: () => import('./M5.json'),
  M6: () => import('./M6.json'),
  M7: () => import('./M7.json'),
  M8: () => import('./M8.json'),
  'M3-cantilever': () => import('./M3-cantilever.json'),
  S1: () => import('./S1.json'),
  'S1-indeterminate': () => import('./S1-indeterminate.json'),
  'S1-mechanism': () => import('./S1-mechanism.json'),
  S2: () => import('./S2.json'),
  S3: () => import('./S3.json'),
  S4: () => import('./S4.json'),
  S5: () => import('./S5.json'),
  S6: () => import('./S6.json'),
  S7: () => import('./S7.json'),
};

const CACHE = new Map<string, Solution>();

export async function getExample(templateId: string): Promise<Solution | undefined> {
  const cached = CACHE.get(templateId);
  if (cached) return cached;
  const loader = LOADERS[templateId];
  if (!loader) return undefined;
  const module = await loader();
  const solution = module.default as unknown as Solution;
  assertSolutionContract(solution);
  CACHE.set(templateId, solution);
  return solution;
}