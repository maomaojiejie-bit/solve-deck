/**
 * W19 通用结果面板：**先给「这张图问什么」**，再给引擎原始量。
 *
 * 以前这里只有 netSolve / frameSolve 的原始表（节点电位、N/Q/M 三联图）——
 * 于是 M5 加一个力就只剩内力图，δmax 没了；M7 加一个力只剩一张全 0 内力图。
 * 现在主内容是 `interpretQuestion` 的 Measure 卡（δmax / Pcr / Av / 工作区…），
 * 原始量退进折叠区（真要核对残差时再看）。
 *
 * 横幅三态（W19 §P4）：
 *  - 骨架不符 / 有未建模元件 / 删器件已合并 → 各自说清为什么不用讲解稿；
 *  - measures 为空 → 明说「这张图问什么还认不出来，只给引擎原始量」。
 */

import { useState } from 'react';
import { Chart } from '../render/Chart';
import { SpecGrid } from '../render/SpecGrid';
import { fmtMeasure, type Measure } from '../core/lab/measures';
import type { CircuitSolution } from '../core/lab/netSolve';
import type { FrameSolution } from '../core/lab/frameSolve';
import { fmtAmp, fmtOhm, fmtVolt, type CircuitEquivalent } from '../core/lab/equivalent.ts';
import type { AcEquivalentResult } from '../core/lab/acEquivalent';
import type { RenderSpec } from '../core/types';

interface GenericResultProps {
  family: 'circuit' | 'beam';
  circuit?: CircuitSolution;
  frame?: FrameSolution;
  /** 这张图问什么（interpretQuestion 的产出）。 */
  measures: Measure[];
  /** 为什么落到通用求解。 */
  reason: 'skeleton' | 'unmodeled' | 'healed';
  /** resolve 层的如实说明（如「未标数值的源按 1V 测试源求值」）。 */
  notices?: string[];
  /** 自建图的只读图解：通用求解没有讲解稿，但至少要把「刚搭的这张图」画出来。 */
  graphSpec?: RenderSpec | null;
  /** W23：由这张图 + 这份解现算的端口等效电路 / 器件级 π 模型。 */
  equivalent?: CircuitEquivalent | null;
  /** 整图微变等效（单管最小版）：直流置地 / 电容短路 / 管子换 π，其余图元原位。 */
  acEquivalent?: AcEquivalentResult | null;
  /**
   * P0：内部 id → 人话（`n-sup-0` → `END-A · 固定铰`、`n-end-a` → `END-A`）。
   * 求解层只认 id，结果区不该把 id 直接摆给用户看；这张表由图上标签现算，
   * 缺项就退回 id（宁可难看，也不猜人名）。
   */
  labels?: Record<string, string>;
}

// R3 修复：去掉 uppercase —— 卡片标题里会出现物理符号（「弯曲正应力 σ = M / W」），
// CSS 大写化把 σ 渲染成 Σ（求和号），DOM 文本没错、屏幕上全错。中文标题不受影响。
const EYEBROW = 'text-[10px] font-semibold tracking-wide text-muted';

const REASON: Record<GenericResultProps['reason'], string> = {
  skeleton: '这张图与骨架不一致：讲解稿对不上，按图求解',
  unmodeled: '图上有归约表没覆盖的元件：讲解稿算不到它，按图求解',
  healed: '删掉的器件两端已合并：讲解稿按它还在推导，按图求解',
};

export function MeasureCard({ measure }: { measure: Measure }) {
  const tone = measure.tone === 'bad' ? 'border-danger/40' : measure.tone === 'warn' ? 'border-amber/40' : 'border-line';
  return (
    <section data-testid="measure-card" data-measure={measure.id} className={`rounded-xl border ${tone} bg-panel/40 p-3`}>
      <p className={EYEBROW}>{measure.title}</p>
      {measure.missing ? (
        <p className="mt-1 text-[12px] leading-5 text-amber">做不了：{measure.missing}</p>
      ) : (
        <>
          {measure.headline && (
            <p className="mt-1 font-mono text-[15px] leading-6 text-ink" data-testid="measure-headline">
              {measure.headline}
            </p>
          )}
          {measure.rows.length > 0 && (
            <table className="mt-2 w-full text-left font-mono text-[11px]">
              <tbody>
                {measure.rows.map((row) => (
                  <tr key={row.label} className="border-b border-line/40">
                    <td className="py-0.5 pr-2 text-muted">{row.label}</td>
                    <td className="py-0.5 pr-2">{typeof row.value === 'number' ? fmtMeasure(row.value) : row.value}</td>
                    <td className="py-0.5 text-muted">{row.unit ?? row.hint ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {measure.chart && (
            <div className="mt-2">
              <Chart spec={measure.chart} />
            </div>
          )}
        </>
      )}
      {measure.note && <p className="mt-1 text-[10px] leading-4 text-muted">{measure.note}</p>}
    </section>
  );
}

/* ── 原始量（折叠区） ─────────────────────────────────────────── */

function CircuitPanels({ solution }: { solution: CircuitSolution }) {
  const pinsByNet = new Map<string, string[]>();
  for (const [pinKey, net] of Object.entries(solution.netOfPin)) {
    const list = pinsByNet.get(net) ?? [];
    list.push(pinKey);
    pinsByNet.set(net, list);
  }
  const powerSum = Object.values(solution.powers).reduce((sum, value) => sum + value, 0);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>节点电位（合并接点已标出）</p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-1 py-0.5 font-medium">电气点</th>
              <th className="px-1 py-0.5 font-medium">电位 (V)</th>
              <th className="px-1 py-0.5 font-medium">所连引脚</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(solution.nodeVoltages).map(([net, voltage]) => {
              const pins = pinsByNet.get(net) ?? [];
              return (
                <tr key={net} className="border-b border-line/40">
                  <td className="px-1 py-0.5">
                    {net}
                    {pins.length > 1 && <span className="ml-1 text-amber">（合并 {pins.length} 点）</span>}
                  </td>
                  <td className="px-1 py-0.5">{fmtMeasure(voltage)}</td>
                  <td className="px-1 py-0.5 text-muted">
                    {pins.length > 0 ? pins.slice(0, 4).join('、') + (pins.length > 4 ? ` 等 ${pins.length}` : '') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>支路电流（a→b 为正）</p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <tbody>
            {Object.entries(solution.branchCurrents).map(([id, current]) => (
              <tr key={id} className="border-b border-line/40">
                <td className="px-1 py-0.5">{id}</td>
                <td className="px-1 py-0.5">{fmtMeasure(current)} A</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>功率（器件吸收；源为负 = 供电）</p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <tbody>
            {Object.entries(solution.powers).map(([id, power]) => (
              <tr key={id} className="border-b border-line/40">
                <td className="px-1 py-0.5">{id}</td>
                <td className="px-1 py-0.5">{fmtMeasure(power)} W</td>
              </tr>
            ))}
            <tr>
              <td className="px-1 py-0.5 text-muted">合计（应 ≈ 0）</td>
              <td className="px-1 py-0.5">{fmtMeasure(powerSum)} W</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>
          KCL 逐网残差（Σ流出电流；最差 {solution.residual.node} = {solution.residual.kclMax.toExponential(2)}）
        </p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <tbody>
            {Object.entries(solution.kclByNet)
              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
              .map(([net, sum]) => (
                <tr key={net} className="border-b border-line/40">
                  <td className="px-1 py-0.5">{net}</td>
                  <td className="px-1 py-0.5">{sum.toExponential(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-muted">MNA 残差 {solution.residual.mnaMax.toExponential(2)}</p>
      </div>
    </div>
  );
}

function FramePanels({ frame, labels }: { frame: FrameSolution; labels?: Record<string, string> }) {
  const shown = (id: string): string => (labels?.[id] ?? '').trim() || id;
  /** 构件名用「两端结点」写，多杆图里 `e-member` / `e-member-add-0` 才不会都叫「构件」。 */
  const memberName = (edgeId: string): string => {
    const info = frame.members.find((member) => member.edgeId === edgeId);
    if (!info) return shown(edgeId);
    return `${shown(info.fromNodeId)}–${shown(info.toNodeId)}`;
  };
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>支座反力（全局坐标，y 向上；力偶逆时针为正）</p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-1 py-0.5 font-medium">支座</th>
              <th className="px-1 py-0.5 font-medium">Fx</th>
              <th className="px-1 py-0.5 font-medium">Fy</th>
              <th className="px-1 py-0.5 font-medium">Mz</th>
            </tr>
          </thead>
          <tbody>
            {frame.reactions.map((reaction) => (
              <tr key={reaction.nodeId} className="border-b border-line/40">
                <td className="px-1 py-0.5" data-testid="reaction-row">{shown(reaction.nodeId)}</td>
                <td className="px-1 py-0.5">{fmtMeasure(reaction.fx)}</td>
                <td className="px-1 py-0.5">{fmtMeasure(reaction.fy)}</td>
                <td className="px-1 py-0.5">{fmtMeasure(reaction.mz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-line bg-panel/40 p-3">
        <p className={EYEBROW}>极值与残差</p>
        <p className="mt-2 font-mono text-[11px]">
          |M|max = {fmtMeasure(frame.extremes.Mmax)} @ 全局 x = {fmtMeasure(frame.extremes.atX)}
        </p>
        <p className="font-mono text-[11px]">|Q|max = {fmtMeasure(frame.extremes.Qmax)}</p>
        <p className="mt-1 font-mono text-[11px] text-muted">
          ΣFx = {frame.residual.sumFx.toExponential(2)} · ΣFy = {frame.residual.sumFy.toExponential(2)} · ΣM ={' '}
          {frame.residual.sumM.toExponential(2)}
        </p>
      </div>
      <div className="rounded-xl border border-line bg-panel/40 p-3 xl:col-span-2">
        <p className={EYEBROW}>每个构件内力端值（N 拉 / Q 顺时针 / M 下侧受拉 为正）</p>
        <table className="mt-2 w-full text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-1 py-0.5 font-medium">构件</th>
              <th className="px-1 py-0.5 font-medium">N(0) / N(L)</th>
              <th className="px-1 py-0.5 font-medium">Q(0) / Q(L)</th>
              <th className="px-1 py-0.5 font-medium">M(0) / M(L)</th>
            </tr>
          </thead>
          <tbody>
            {frame.memberEndForces.map((member) => (
              <tr key={member.edgeId} className="border-b border-line/40">
                <td className="px-1 py-0.5">{memberName(member.edgeId)}</td>
                <td className="px-1 py-0.5">
                  {fmtMeasure(member.N[0])} / {fmtMeasure(member.N[1])}
                </td>
                <td className="px-1 py-0.5">
                  {fmtMeasure(member.Q[0])} / {fmtMeasure(member.Q[1])}
                </td>
                <td className="px-1 py-0.5">
                  {fmtMeasure(member.M[0])} / {fmtMeasure(member.M[1])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── W23 自动等效电路：端口戴维南 + 器件级 π 小信号模型 ────────── */

function EquivalentSection({
  equivalent,
  acEquivalent,
}: {
  equivalent: CircuitEquivalent;
  acEquivalent?: AcEquivalentResult | null;
}) {
  const [portNet, setPortNet] = useState<string | null>(null);
  const selected = equivalent.ports.find((port) => port.net === portNet) ?? equivalent.ports[0];
  return (
    <section data-testid="equivalent-circuit" className="mb-3 rounded-xl border border-line bg-panel-2 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-ink">等效电路</p>
        <p className="text-[10px] text-muted"></p>
      </div>

      {/* 整图微变等效（单管最小版）：先给「重画一遍」的图，再给端口戴维南。 */}
      {acEquivalent ? (
        <div data-testid="equivalent-ac" className="mb-3 rounded-lg border border-line/70 bg-bg/40 p-2.5">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-ink">整图微变等效</p>
            <p className="text-[10px] text-muted">直流置地 · 电容短路 · 管子换 π</p>
          </div>
          {acEquivalent.available ? (
            <>
              <p className="mb-1.5 font-mono text-[11px] text-muted" data-testid="ac-equivalent-values">
                {acEquivalent.model.rows.map((row) => `${row.label} = ${row.value}`).join('　·　')}
              </p>
              <SpecGrid specs={[acEquivalent.model.spec]} stepIndex={-1} />
              <ul className="mt-1.5 space-y-0.5 text-[10px] leading-4 text-muted">
                {acEquivalent.model.actions.map((action) => (
                  <li key={action} data-testid="ac-equivalent-action">· {action}</li>
                ))}
              </ul>
              {acEquivalent.model.notes.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-amber">
                  {acEquivalent.model.notes.map((note) => (
                    <li key={note}>· {note}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] leading-5 text-amber" data-testid="ac-equivalent-reason">
              不展开微变等效：{acEquivalent.reason}
            </p>
          )}
        </div>
      ) : null}

      {selected ? (
        <>
          {equivalent.ports.length > 1 ? (
            <label className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              等效端口
              <select
                data-testid="equivalent-port-select"
                value={selected.net}
                onChange={(event) => setPortNet(event.target.value)}
                className="focus-ring rounded border border-line bg-bg px-2 py-1 text-[11px] text-ink"
              >
                {equivalent.ports.map((port) => (
                  <option key={port.net} value={port.net}>
                    {port.label} · Vth {fmtVolt(port.vth)} · Rth {fmtOhm(port.rth)}
                  </option>
                ))}
              </select>
              <span></span>
            </label>
          ) : null}

          <SpecGrid specs={[selected.spec]} stepIndex={-1} />

          <div data-testid="equivalent-values" className="mt-2 grid gap-1 font-mono text-[11px]">
            <p>Vth（开路电压）= {fmtVolt(selected.vth)}</p>
            <p>Rth（等效内阻）= {fmtOhm(selected.rth)}</p>
            <p>
              I_N（诺顿电流）= {selected.inorton === null ? '不适用（Rth ≈ 0，理想电压源）' : fmtAmp(selected.inorton)}
            </p>
            <p className="text-muted">
              口径 {selected.mode} · 线性自检残差 {selected.linearResidual.toExponential(2)} V · 所连引脚{' '}
              {selected.pinKeys.slice(0, 4).join('、') || '—'}
            </p>
          </div>
          {selected.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-amber">
              {selected.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-[11px] text-amber">端口加不上测试电流，暂不给等效。</p>
      )}

      <ul className="mt-2 space-y-0.5 text-[10px] leading-4 text-muted">
        {equivalent.notes.map((note) => (
          <li key={note}>· {note}</li>
        ))}
      </ul>

      {equivalent.smallSignal.length > 0 ? (
        <div data-testid="equivalent-small-signal" className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-[11px] font-medium text-ink">器件 π 模型</p>
          <p className="mb-2 text-[10px] leading-4 text-muted">
            单管的模型，不是整图。
          </p>
          {equivalent.smallSignal.map((model) => (
            <div key={model.deviceId} className="mb-3">
              <p className="text-[11px] text-ink">{model.title}</p>
              <p className="font-mono text-[11px] text-muted">
                {model.rows.map((row) => `${row.label} = ${row.value}`).join('　·　')}
              </p>
              <SpecGrid specs={[model.spec]} stepIndex={-1} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GenericResult({ family, circuit, frame, measures, reason, notices = [], graphSpec, equivalent, acEquivalent, labels }: GenericResultProps) {
  const solverNotes = family === 'beam' ? frame?.notes ?? [] : circuit?.notes ?? [];
  return (
    <div data-testid="generic-solution" className="rounded-2xl border border-line bg-bg p-4">
      <div className="mb-3 rounded-xl border border-amber/50 bg-amber/10 p-3">
        <p className="text-xs font-medium text-amber" data-testid="generic-reason">
          {measures.length > 0 ? REASON[reason] : '这张图问什么还认不出来：先给引擎原始量'}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          数值由通用求解器对这张图现算 —— 结构、单位与符号约定仍与题库一致；没有讲解稿，就不假装有。
        </p>
        {notices.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-amber">
            {notices.map((notice) => (
              <li key={notice}>· {notice}</li>
            ))}
          </ul>
        )}
      </div>

      {      /* 从零自建 / 结构改到讲解稿不适用时，通用结果以前只剩数值表 —— 连一张
          刚搭出来的图都没有。这里把当前画布按同一份 RenderSpec 只读重画一遍，
          并如实说明这是「原图」；W23 之后等效电路由下方的自动推导现算给出，
          题库讲解稿的预置辅图仍只在骨架一致 + 关键语义标全（F 档）时随解出现。 */}
      {graphSpec && graphSpec.nodes.length > 0 ? (
        <section data-testid="generic-graph-diagram" className="mb-3 rounded-xl border border-line bg-panel-2 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-ink">原图</p>
            <p className="text-[10px] text-muted">
              {family === 'beam' ? '受力 / 构件图（按图现算）' : '电路原图（不是等效电路）'}
            </p>
          </div>
          <SpecGrid specs={[graphSpec]} stepIndex={-1} />
          <p className="mt-2 text-[10px] leading-4 text-muted">
            {family === 'circuit'
              ? '原图。等效电路在下方按端口现算。'
              : '原图与现算数值。剪力图 / 弯矩图随讲解稿，仅在原图未被改动时给出。'}
          </p>
        </section>
      ) : null}

      {family === 'circuit' && equivalent ? (
        <EquivalentSection equivalent={equivalent} acEquivalent={acEquivalent} />
      ) : null}

      <div className="flex flex-col gap-3">
        {measures.map((measure) => (
          <MeasureCard key={measure.id} measure={measure} />
        ))}
      </div>

      <details data-testid="raw-panels" className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
        <summary className="cursor-pointer text-[11px] text-muted">
          引擎原始量（{family === 'beam' ? '反力 / 内力表 / 残差' : '节点电位 / 支路电流 / 功率 / KCL'}）
        </summary>
        <div className="mt-3">
          {family === 'beam' && frame ? <FramePanels frame={frame} labels={labels} /> : null}
          {family === 'circuit' && circuit ? <CircuitPanels solution={circuit} /> : null}
        </div>
      </details>

      {solverNotes.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber/50 bg-amber/10 p-3">
          <p className={EYEBROW}>求解器的如实说明</p>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-amber">
            {solverNotes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
