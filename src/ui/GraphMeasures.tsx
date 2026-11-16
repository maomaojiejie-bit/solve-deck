/**
 * W20 · 「这张图的量」补充面板。
 *
 * 默认骨架走 template 路径，页面本来只有模板五步讲解稿，右栏填了截面也看不到
 * δmax / σmax。这里把 interpretQuestion 的产出直接挂到结果区：**改动即重算**
 * （useMemo 依赖 graph），缺什么就写「做不了：缺什么」，填了截面立刻出数。
 * generic 路径已有完整的 GenericResult，不重复挂这一块。
 */

import { useMemo } from 'react';
import { frameSolve } from '../core/lab/frameSolve.ts';
import { interpretQuestion } from '../core/lab/measures.ts';
import { MeasureCard } from './GenericResult.tsx';
import type { CanvasGraph } from '../core/lab/types.ts';

export function GraphMeasures({ graph }: { graph: CanvasGraph }) {
  const solved = useMemo(() => {
    if (graph.family !== 'beam') return null;
    try {
      const frame = frameSolve(graph);
      return interpretQuestion(graph, 'beam', { frame });
    } catch {
      // 图还没成形（机构 / 没支座）时如实不渲染，不拿模板的数充数。
      return null;
    }
  }, [graph]);

  if (!solved || solved.length === 0) return null;
  return (
    <section data-testid="graph-measures" className="mb-3 rounded-xl border border-line bg-panel-2 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan">这张图的量（按图现算）</p>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        按当前这张装配图求解，与上方讲解稿无关。缺截面时写清缺什么；在右栏「截面」填上 b / h / E 后，应力与挠度会立刻出数。
      </p>
      <p className="mt-1 text-[10px] leading-4 text-faint">
        这一区固定按题面单位（kN / kN·m / mm / MPa）显示；顶部「单位」只改结论 headline 与讲解稿读数，不改这里的图和表。
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {solved.map((measure) => (
          <MeasureCard key={measure.id} measure={measure} />
        ))}
      </div>
    </section>
  );
}
