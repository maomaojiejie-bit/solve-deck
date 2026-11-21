// 结果卡：headline + 杆力表 + 反力 + 校核 + 拒答。数字与场景图同源（同一个 Solution3D）。
// 自 lab3d-proto src/ui/ResultCard.tsx 迁入；样式已按 solve-deck 图纸口径重写（Tailwind/token，不再依赖 lab3d index.css）。
import { useState } from "react";
import type { Solution3D, StressPoint, TrussModel } from "../../core/space/types";
import { DOFS } from "../../core/space/types";
import { materialById } from "../../core/space/materials";
import { CountUp, Typewriter } from "../../ui/motion";

const KIND_CN = { determinate: "静定", indeterminate: "静不定", mechanism: "机构" } as const;
const FORCE_CN = { tension: "拉", compression: "压", zero: "零杆" } as const;
const FRIC_STATE_CN = { stick: "静止", critical: "临界", slip: "滑动", separate: "脱离" } as const;
const FRIC_STATE_CHIP = { stick: "pass", critical: "warn", slip: "fail", separate: "fail" } as const;

/* ---- solve-deck 图纸口径的样式常量（原 .badge/.chip/.rc-table 等类的 Tailwind 重写） ---- */
const badge = "rounded-[3px] border border-line-2 px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em]";
const chip = "rounded-[3px] border border-line-2 px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em]";
const th = "border-b border-line-2 py-1 pr-3 text-left text-[11px] font-medium text-muted";
const td = "border-b border-line py-1 pr-3 font-mono tabular-nums";
// 语义色：拉=危险红、压=钴蓝、零杆=淡墨（对应原 td.tension/.compression/.zero）
const KIND_TEXT: Record<"tension" | "compression" | "zero", string> = {
  tension: "text-danger",
  compression: "text-cyan",
  zero: "text-faint",
};
// 对应原 .badge.det-*（静定按合并口径给 cyan，静不定=gold、机构=danger）
const DET_TEXT: Record<Solution3D["determinacy"], string> = {
  determinate: "text-cyan",
  indeterminate: "text-gold",
  mechanism: "text-danger",
};
// 对应原 .chip.pass/.fail/.warn/.tension/.compression/.zero
const CHIP_TEXT: Record<string, string> = {
  pass: "text-ok",
  fail: "text-danger",
  warn: "text-amber",
  tension: "text-danger",
  compression: "text-cyan",
  zero: "text-faint",
};

/** ISSUE-16：负零归一——四舍五入后落在 0 的负数一律显示 0，避免「-0.000」 */
const dropNegZero = (v: number, digits: number): number => {
  const p = 10 ** digits;
  return Math.abs(v) < 0.5 / p ? 0 : v;
};

/** kN / kN·m：与画布标签统一两位小数（解决「结果卡 10.000 / 画布 10.00 / 荷载 10.0」三套精度） */
function fmt(v: number): string {
  return dropNegZero(v / 1000, 2).toFixed(2);
}

const fmtMPa = (v: number): string => dropNegZero(v / 1e6, 2).toFixed(2);

/** Q3 刚体区块：力/力矩一律 N / N·m 科学计数法（与画布 FBD 标签同口径），坐标 m 三位小数 */
const fmtN = (v: number): string => (Math.abs(v) < 1e-9 ? "0.00e+0" : v.toExponential(2));
const fmtV3 = (v: [number, number, number]): string => v.map(fmtN).join(" / ");
const fmtXYZ = (v: [number, number, number]): string => `(${v.map((x) => x.toFixed(3)).join(", ")})`;
const mag3 = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);

/** 三圆莫尔图（平面应力口径）：三个主应力圆 + 最危险点 (σ, τ)，坐标 MPa。
 *  线色已映射 solve-deck token 变量（深色主题自动跟随）。 */
function MohrCircle({ p }: { p: StressPoint }) {
  const pairs: [number, number][] = [
    [p.s3 / 1e6, p.s1 / 1e6],
    [p.s3 / 1e6, p.s2 / 1e6],
    [p.s2 / 1e6, p.s1 / 1e6],
  ];
  const lo = Math.min(p.s3, 0, p.sigma) / 1e6;
  const hi = Math.max(p.s1, 0, p.sigma) / 1e6;
  const span = hi - lo || 1;
  const W = 300;
  const pad = 20;
  const sc = (W - 2 * pad) / span;
  const Rmax = Math.max(...pairs.map(([a, b]) => Math.abs(a - b) / 2), Math.abs(p.tau) / 1e6, 1e-9);
  const H = 2 * Rmax * sc + 2 * pad;
  const X = (mpa: number) => pad + (mpa - lo) * sc;
  const Y = (t: number) => H / 2 - t * sc;
  const mpa = (v: number) => v / 1e6;
  return (
    <div className="my-2">
      <svg width={W} height={H} role="img" aria-label="莫尔圆" className="rounded-[4px] border border-line bg-panel-2">
        <line x1={4} y1={Y(0)} x2={W - 4} y2={Y(0)} stroke="var(--color-line-2)" />
        <line x1={X(0)} y1={4} x2={X(0)} y2={H - 4} stroke="var(--color-line-2)" />
        {pairs.map(([a, b], i) => (
          <circle
            key={i}
            cx={X((a + b) / 2)}
            cy={Y(0)}
            r={Math.max((Math.abs(a - b) / 2) * sc, 0.4)}
            fill="none"
            stroke={i === 0 ? "var(--color-cyan)" : "color-mix(in srgb, var(--color-cyan) 45%, white)"}
            strokeWidth={i === 0 ? 1.6 : 1}
            strokeDasharray={i === 0 ? undefined : "4 3"}
          />
        ))}
        <line
          x1={X(mpa(p.sigma))}
          y1={Y(mpa(p.tau))}
          x2={X(mpa(p.sigma))}
          y2={Y(-mpa(p.tau))}
          stroke="var(--color-amber)"
        />
        <circle cx={X(mpa(p.sigma))} cy={Y(mpa(p.tau))} r={3.5} fill="var(--color-danger)" />
        <circle cx={X(mpa(p.sigma))} cy={Y(-mpa(p.tau))} r={3.5} fill="var(--color-danger)" />
        <text x={X(mpa(p.s1))} y={Y(0) - 5} fill="var(--color-muted)" fontSize={10} textAnchor="middle">
          σ₁ {mpa(p.s1).toFixed(0)}
        </text>
        <text x={X(mpa(p.s3))} y={Y(0) - 5} fill="var(--color-muted)" fontSize={10} textAnchor="middle">
          σ₃ {mpa(p.s3).toFixed(0)}
        </text>
        <text x={W - 6} y={Y(0) + 12} fill="var(--color-faint)" fontSize={10} textAnchor="end">
          σ (MPa)
        </text>
        <text x={X(0) + 5} y={12} fill="var(--color-faint)" fontSize={10}>
          τ
        </text>
      </svg>
    </div>
  );
}

/** 结果卡：headline + 杆力表 + 位移 + 反力 + 校核 + 拒答。数字与场景图同源（同一个 Solution3D）。 */
export default function ResultCard({
  model,
  solution,
  deformScale,
  onSelectNode,
  onSelectMember,
}: {
  model: TrussModel;
  solution: Solution3D;
  /** 变形层显示放大系数（编辑器传入，用于摘要条「×N」说明；只读详情不传） */
  deformScale?: number;
  /** I-3：点结果表行 → 选中对应结点/构件（只读详情不传） */
  onSelectNode?: (id: string) => void;
  onSelectMember?: (id: string) => void;
}) {
  const refused = solution.refusals && solution.refusals.length > 0;
  // I-3：构件轴力表支持「只看非零」与按 |N| 排序
  const [forceNonZero, setForceNonZero] = useState(false);
  const [forceSort, setForceSort] = useState(false);

  // ISSUE-14：空模型不再自称「静定/已验证」，改给空态引导
  if (model.nodes.length === 0 && model.members.length === 0) {
    return (
      <div className="card px-3.5 pb-5 pt-3 text-[13px]">
        <h3 className="kicker mb-1.5">空模型</h3>
        <p className="callout leading-[1.5]">还没有结点和构件。用底栏「+结点」在地面放点，再「+构件」连接两点；也可「+实体」一次放下棱柱/圆柱等空间框架。</p>
        <p className="mt-2 text-[12px] leading-[1.5] text-muted">搭出几何后，这里会给出内力、位移与校核结论。</p>
      </div>
    );
  }

  // ---- ISSUE-03：位移/转角摘要与表格（展示层从 solution.displacements 派生，不动内核） ----
  const disp = solution.displacements ?? {};
  const rot = solution.rotations;
  let uMax = 0;
  let uMaxNode = "";
  for (const [id, d] of Object.entries(disp)) {
    const m = Math.hypot(d[0], d[1], d[2]);
    if (m > uMax) {
      uMax = m;
      uMaxNode = id;
    }
  }
  let rMax = 0;
  let rMaxNode = "";
  if (rot)
    for (const [id, r] of Object.entries(rot)) {
      const m = Math.hypot(r[0], r[1], r[2]);
      if (m > rMax) {
        rMax = m;
        rMaxNode = id;
      }
    }
  const dispRows = model.nodes.filter((n) => {
    const d = disp[n.id] ?? [0, 0, 0];
    const r = rot?.[n.id] ?? [0, 0, 0];
    return Math.hypot(d[0], d[1], d[2]) > 1e-9 || Math.hypot(r[0], r[1], r[2]) > 1e-9;
  });
  const springRows = model.supports.filter((s) => s.springs?.length);
  // 实体块内部隐藏刚性连接只参与求解，不进结果表（否则会冒出一堆虚构轴力）
  const hiddenIds = new Set(model.members.filter((m) => m.hidden).map((m) => m.id));
  const visibleForces = solution.memberForces.filter((f) => !hiddenIds.has(f.id));
  const shownForces = (forceNonZero ? visibleForces.filter((f) => f.kind !== "zero") : visibleForces)
    .slice()
    .sort(forceSort ? (a, b) => Math.abs(b.N) - Math.abs(a.N) : () => 0);
  // P0-1：把「结果基于什么」写在结果卡里（用户没选过截面时尤其重要）
  const assumption = (() => {
    const vis = model.members.filter((m) => !m.hidden);
    if (!vis.length) return null;
    const m0 = vis[0];
    const mat = m0.materialId ? materialById(m0.materialId)?.name : undefined;
    const parts = [`E=${(m0.E / 1e9).toFixed(0)} GPa`, `A=${(m0.A * 1e4).toFixed(2)} cm²`];
    if (m0.kind === "beam") {
      if (m0.Iy !== undefined) parts.push(`Iy=${(m0.Iy * 1e8).toFixed(0)} cm⁴`);
      if (m0.Iz !== undefined) parts.push(`Iz=${(m0.Iz * 1e8).toFixed(0)} cm⁴`);
    }
    const uniform = vis.every((m) => Math.abs(m.E - m0.E) < 1e-6 && Math.abs(m.A - m0.A) < 1e-12);
    return `${vis.length} 个构件${uniform ? `统一取 ${m0.id}：` : `以 ${m0.id} 为例：`}${parts.join(" · ")} · 材料 ${mat ?? "未指定"}`;
  })();
  const rowClick = (fn?: () => void) =>
    fn ? { onClick: fn, className: "cursor-pointer transition-colors hover:bg-panel-2", title: "点击在画布中选中" } : {};
  const fmtMM = (v: number) => dropNegZero(v * 1000, 3).toFixed(3);
  /** ISSUE-16：零轴力在梁上不叫「零杆」（零杆是桁架概念），梁显示「轴力 0」 */
  const zeroCn = (id: string) => (model.members.find((m) => m.id === id)?.kind === "beam" ? "轴力 0" : "零杆");
  // ISSUE-15：从内核拒答文案里定位缺约束的结点/方向，转成可操作的语义建议
  const refusalHit = (() => {
    for (const r of solution.refusals ?? []) {
      const m = r.match(/结点\s*([A-Za-z]\w*)\s*的\s*([xyz]|rx|ry|rz)\s*自由度/);
      if (m) return { node: m[1], dof: m[2] };
    }
    return null;
  })();

  return (
    <div className="card px-3.5 pb-5 pt-3 text-[13px]">
      <div className="flex flex-wrap gap-1.5">
        <span className={`${badge} ${DET_TEXT[solution.determinacy]}`}>{KIND_CN[solution.determinacy]}</span>
        {refused ? (
          <span className={`${badge} text-danger`}>拒答</span>
        ) : solution.verified ? (
          <span className={`${badge} text-ok`}>已验证</span>
        ) : (
          <span className={`${badge} text-danger`}>校核未过</span>
        )}
        <span className={`${badge} text-muted`}>
          <CountUp value={solution.solveMs} decimals={0} unit="ms" />
        </span>
      </div>

      {/* P0-1：结果基于什么（E / A / I / 材料）——默认截面不是用户选的，必须写出来 */}
      {assumption && (
        <p className="mt-2 rounded-[3px] border border-line bg-panel-2 px-2 py-1 font-mono text-[10.5px] leading-[1.5] text-muted">
          本结果基于：{assumption}
        </p>
      )}

      {/* ISSUE-03：顶部摘要条——最大位移/转角及所在结点，变形层放大口径一并说明。
          I-9：编辑器顶栏已有 |u|max KPI，这里不再重复（只读详情仍显示） */}
      {!refused && (uMax > 0 || rMax > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {deformScale === undefined && uMax > 0 && (
            <span className={`${chip} text-cyan`}>
              |u|max {fmtMM(uMax)} mm @ {uMaxNode}
            </span>
          )}
          {rMax > 0 && (
            <span className={`${chip} text-cyan`}>
              θmax {fmtMM(rMax)}×10⁻³ rad @ {rMaxNode}
            </span>
          )}
          {deformScale !== undefined && deformScale > 0 && (
            <span className={chip}>变形显示 ×{deformScale >= 100 ? deformScale.toFixed(0) : deformScale.toFixed(1)}</span>
          )}
        </div>
      )}

      <p className="callout mt-2.5 leading-[1.5]">
        {/* P1-1：拒答时 headline 只给一句概括，细节交给下面的拒答块，避免整段重复 */}
        <Typewriter
          text={refused ? "拒答：模型是几何可变体系或约束不足（原因与修法见下）" : solution.headline}
          speed={8}
          once
        />
      </p>

      {refused && (
        <div className="mt-2.5 rounded-[4px] border border-danger/40 bg-danger/5 px-3 py-2.5">
          {solution.refusals!.map((r, i) => (
            <p key={i} className="my-1 text-danger">
              {r}
            </p>
          ))}
          {/* ISSUE-15：内核已给出人话解释，这里只补「画布上在哪、怎么补」这一步 */}
          {refusalHit && (
            <p className="mt-2 border-t border-danger/25 pt-2 text-[12px] leading-[1.6] text-muted">
              画布已用红色标出 <b className="text-ink">{refusalHit.node}</b>（缺 {refusalHit.dof} 向约束）：
              可在支座面板给它勾上 {refusalHit.dof}，或补一根不与该结点现有构件共面的构件。
            </p>
          )}
        </div>
      )}

      {!refused && (
        <>
          {visibleForces.length > 0 && (
            <>
              <div className="mb-1.5 mt-4 flex flex-wrap items-center gap-2">
                <h3 className="kicker">构件轴力（拉正压负）</h3>
                <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-muted">
                  <input type="checkbox" checked={forceNonZero} onChange={(e) => setForceNonZero(e.target.checked)} />
                  只看非零
                </label>
                <button
                  type="button"
                  onClick={() => setForceSort((v) => !v)}
                  aria-pressed={forceSort}
                  className="rounded-[3px] border border-line-2 bg-elev px-1.5 py-0.5 font-mono text-[10.5px] text-muted transition-colors hover:text-ink"
                >
                  {forceSort ? "还原顺序" : "按 |N| 排序"}
                </button>
              </div>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>构件</th>
                    <th className={th}>N (kN)</th>
                    <th className={th}>性态</th>
                  </tr>
                </thead>
                <tbody>
                  {shownForces.map((f) => (
                    <tr key={f.id} {...rowClick(onSelectMember ? () => onSelectMember(f.id) : undefined)}>
                      <td className={td}>{f.id}</td>
                      <td className={`${td} ${KIND_TEXT[f.kind]}`}>{fmt(f.N)}</td>
                      <td className={td}>
                        <span className={`${chip} ${CHIP_TEXT[f.kind]}`}>{f.kind === "zero" ? zeroCn(f.id) : FORCE_CN[f.kind]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ISSUE-03：结点位移表（mm；梁模型附转角 ×10⁻³ rad），只列非零项 */}
          {!refused && dispRows.length > 0 && (
            <>
              <h3 className="kicker mb-1.5 mt-4">结点位移（mm；转角 ×10⁻³ rad）</h3>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>结点</th>
                    <th className={th}>ux</th>
                    <th className={th}>uy</th>
                    <th className={th}>uz</th>
                    <th className={th}>|u|</th>
                    {rot && (
                      <>
                        <th className={th}>θx</th>
                        <th className={th}>θy</th>
                        <th className={th}>θz</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dispRows.map((n) => {
                    const d = disp[n.id] ?? [0, 0, 0];
                    const r = rot?.[n.id];
                    return (
                      <tr key={n.id} {...rowClick(onSelectNode ? () => onSelectNode(n.id) : undefined)}>
                        <td className={td}>{n.id}</td>
                        <td className={td}>{fmtMM(d[0])}</td>
                        <td className={td}>{fmtMM(d[1])}</td>
                        <td className={td}>{fmtMM(d[2])}</td>
                        <td className={`${td} text-cyan`}>{fmtMM(Math.hypot(d[0], d[1], d[2]))}</td>
                        {rot && r && (
                          <>
                            <td className={td}>{fmtMM(r[0])}</td>
                            <td className={td}>{fmtMM(r[1])}</td>
                            <td className={td}>{fmtMM(r[2])}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {!model.rigid && (
            <>
              <h3 className="kicker mb-1.5 mt-4">支座反力 (kN)</h3>
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {model.nodes
                    // ISSUE-04：只列有刚性约束（fix 非空）的结点；纯弹簧结点改由下方弹簧表给 R=−k·u
                    .filter(
                      (n) =>
                        (model.supports.find((s) => s.node === n.id)?.fix.length ?? 0) > 0 ||
                        solution.reactionMoments?.[n.id]?.some((v) => Math.abs(v) > 1e-6),
                    )
                    .map((n) => {
                      const r = solution.reactions[n.id] ?? [0, 0, 0];
                      const rm = solution.reactionMoments?.[n.id];
                      const hasM = rm?.some((v) => Math.abs(v) > 1e-6);
                      return (
                        <tr key={n.id} {...rowClick(onSelectNode ? () => onSelectNode(n.id) : undefined)}>
                          <td className={td}>{n.id}</td>
                          <td className={td}>x {fmt(r[0])}</td>
                          <td className={td}>y {fmt(r[1])}</td>
                          <td className={td}>z {fmt(r[2])}</td>
                          {/* 金色对账量（原 td.mom） */}
                          {hasM && <td className={`${td} whitespace-nowrap text-gold`}>M {rm!.map(fmt).join(" / ")}</td>}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </>
          )}

          {/* ISSUE-04：弹性支座（弹簧）反力在展示层派生 R=−k·u，内核 reactions 不含弹簧 */}
          {!refused && springRows.length > 0 && (
            <>
              <h3 className="kicker mb-1.5 mt-4">弹性支座（弹簧反力 R = −k·u）</h3>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>结点</th>
                    <th className={th}>方向</th>
                    <th className={th}>k</th>
                    <th className={th}>位移 δ</th>
                    <th className={th}>反力 R</th>
                  </tr>
                </thead>
                <tbody>
                  {springRows.flatMap((s) =>
                    (s.springs ?? []).map((sp, i) => {
                      const j = DOFS.indexOf(sp.dof);
                      const u = j < 3 ? disp[s.node]?.[j] ?? 0 : rot?.[s.node]?.[j - 3] ?? 0;
                      const R = -sp.k * u;
                      return (
                        <tr key={`${s.node}:${sp.dof}:${i}`} {...rowClick(onSelectNode ? () => onSelectNode(s.node) : undefined)}>
                          <td className={td}>{s.node}</td>
                          <td className={td}>{sp.dof}</td>
                          <td className={td}>{sp.k >= 1e3 ? `${(sp.k / 1e3).toFixed(0)} kN/m` : `${sp.k.toFixed(0)} N/m`}</td>
                          <td className={td}>{j < 3 ? `${fmtMM(u)} mm` : `${fmtMM(u)}×10⁻³ rad`}</td>
                          <td className={`${td} text-cyan`}>{j < 3 ? `${fmt(R)} kN` : `${fmt(R)} kN·m`}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </>
          )}

          {solution.simplify && (
            <>
              <h3 className="kicker mb-1.5 mt-4">力系简化（主矢 / 主矩）</h3>
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  <tr>
                    <td className={td}>主矢 R (N)</td>
                    <td className={td}>{fmtV3(solution.simplify.R)}</td>
                    {/* |R|/|M| 与重心 Σw 源口径为 toExponential(2)，CountUp 只能 toFixed 渲染，
                        为满足「最终显示逐位一致」这两处保持静态，不接 CountUp */}
                    <td className={td}>|R| = {fmtN(mag3(solution.simplify.R))}</td>
                  </tr>
                  <tr>
                    <td className={td}>对 O={fmtXYZ(solution.simplify.O)} 主矩 M (N·m)</td>
                    <td className={td}>{fmtV3(solution.simplify.M)}</td>
                    <td className={td}>|M| = {fmtN(mag3(solution.simplify.M))}</td>
                  </tr>
                </tbody>
              </table>
              <p className="my-1 text-[12px] text-muted">最简形式：{solution.simplify.formCn}</p>
              {solution.simplify.axis && (
                <p className="my-1 text-[12px] text-muted">
                  {solution.simplify.form === "wrench" ? "力螺旋中心轴" : "合力作用线"}：过点 {fmtXYZ(solution.simplify.axis.p)} m，方向 (
                  {solution.simplify.axis.d.map((x) => x.toFixed(3)).join(", ")})
                  {solution.simplify.axis.pitch !== undefined && <>，螺旋参数 pitch = {solution.simplify.axis.pitch.toFixed(3)} m/rad</>}
                </p>
              )}
            </>
          )}

          {solution.reactionLabels && (
            <>
              <h3 className="kicker mb-1.5 mt-4">约束反力（受力图口径）</h3>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>结点</th>
                    <th className={th}>约束类型</th>
                    <th className={th}>非零分量 (N / N·m)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(solution.reactionLabels).map(([id, lb]) => {
                    const r = solution.reactions[id] ?? [0, 0, 0];
                    const rm = solution.reactionMoments?.[id] ?? [0, 0, 0];
                    const parts: string[] = [];
                    lb.force?.forEach((l, k) => l && Math.abs(r[k]) > 1e-9 && parts.push(`${l}=${fmtN(r[k])}`));
                    lb.moment?.forEach((l, k) => l && Math.abs(rm[k]) > 1e-9 && parts.push(`${l}=${fmtN(rm[k])} N·m`));
                    return (
                      <tr key={id}>
                        <td className={td}>{id}</td>
                        <td className={td}>{lb.type}</td>
                        <td className={td}>{parts.length ? parts.join("　") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {solution.hingeForces && solution.hingeForces.length > 0 && (
            <>
              <h3 className="kicker mb-1.5 mt-4">铰接内力（物体系拆体，f 作用在后一刚体上）</h3>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>铰结点</th>
                    <th className={th}>B1 → B2</th>
                    <th className={th}>f (N)</th>
                    <th className={th}>|f| (N)</th>
                  </tr>
                </thead>
                <tbody>
                  {solution.hingeForces.map((hf) => (
                    <tr key={`${hf.node}:${hf.bodies.join("-")}`}>
                      <td className={td}>{hf.node}</td>
                      <td className={td}>
                        {hf.bodies[0]} → {hf.bodies[1]}
                      </td>
                      <td className={td}>{fmtV3(hf.f)}</td>
                      <td className={td}>{fmtN(mag3(hf.f))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {solution.friction && solution.friction.length > 0 && (
            <>
              <h3 className="kicker mb-1.5 mt-4">摩擦锥判别</h3>
              {solution.friction.map((fr) => (
                <div key={fr.node} className="my-1.5 rounded-[4px] border border-line px-2 py-1.5 text-[12px]">
                  <p className="my-0.5">
                    <b>{fr.node}</b>　Fn={fmtN(fr.Fn)}　Ft={fmtN(fr.Ft)}　Fmax=f·Fn={fmtN(fr.Fmax)}　
                    <span className={`${chip} ${CHIP_TEXT[FRIC_STATE_CHIP[fr.state]]}`}>{FRIC_STATE_CN[fr.state]}</span>
                  </p>
                  <p className="my-0.5 text-faint">{fr.note}</p>
                  <p className="my-0.5">
                    摩擦角 φ = atan f = <CountUp value={(fr.angle * 180) / Math.PI} decimals={2} unit="°" />
                  </p>
                </div>
              ))}
            </>
          )}

          {solution.centroid && (
            <p className="my-1 text-[12px] text-muted">
              重心/形心 c = {fmtXYZ(solution.centroid.c)} m，Σw = {fmtN(solution.centroid.W)}（负权重=挖空部件）
            </p>
          )}

          {solution.internals && solution.internals.some((it) => it.kind === "beam") && (
            <>
              <h3 className="kicker mb-1.5 mt-4">截面内力表（材料力学口径，kN / kN·m；集中荷载点左右侧分列）</h3>
              {solution.internals
                .filter((it) => it.kind === "beam" && !hiddenIds.has(it.id))
                .map((it) => (
                  // ISSUE-21：默认展开（原来要点开才看得到数）；表头改用教材记号 N/Q/M/T
                  <details key={it.id} className="my-1.5" open>
                    <summary className="cursor-pointer text-[12px] text-muted">
                      {it.id} · L={it.L.toFixed(2)} m
                    </summary>
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr>
                          <th className={th}>x (m)</th>
                          <th className={th}>N 轴力</th>
                          <th className={th}>Qy</th>
                          <th className={th}>Qz</th>
                          <th className={th}>T 扭矩</th>
                          <th className={th}>My</th>
                          <th className={th}>Mz 弯矩</th>
                        </tr>
                      </thead>
                      <tbody>
                        {it.sections.map((s, i) => (
                          <tr key={i}>
                            <td className={td}>
                              {s.x.toFixed(2)}
                              {s.side ? `（${s.side === "left" ? "左" : "右"}）` : ""}
                            </td>
                            <td className={td}>{fmt(s.N)}</td>
                            <td className={td}>{fmt(s.Vy)}</td>
                            <td className={td}>{fmt(s.Vz)}</td>
                            <td className={td}>{fmt(s.T)}</td>
                            <td className={td}>{fmt(s.My)}</td>
                            <td className={td}>{fmt(s.Mz)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ))}
            </>
          )}

          {solution.stress && solution.stress.some((ms) => !hiddenIds.has(ms.id)) && (
            <>
              <h3 className="kicker mb-1.5 mt-4">应力与强度校核（MPa · 第四理论 Mises）</h3>
              {solution.stress.filter((ms) => !hiddenIds.has(ms.id)).map((ms) => (
                <details key={ms.id} className="my-1.5" open={ms.points.length <= 8}>
                  <summary className="cursor-pointer text-[12px] text-muted">
                    {ms.id} · 利用率 {(Math.max(ms.ratio, ms.tauRatio) * 100).toFixed(1)}%{" "}
                    <span className={`${chip} ${ms.pass ? "text-ok" : "text-danger"}`}>{ms.pass ? "通过" : "不足"}</span>
                  </summary>
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr>
                        <th className={th}>x (m)</th>
                        <th className={th}>σ</th>
                        <th className={th}>τ</th>
                        <th className={th}>σ₁</th>
                        <th className={th}>σ₂</th>
                        <th className={th}>σ₃</th>
                        <th className={th}>Tresca</th>
                        <th className={th}>Mises</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ms.points.map((pt, i) => (
                        <tr key={i} className={i === ms.worst ? "bg-amber/10" : undefined}>
                          <td className={td}>
                            {pt.x.toFixed(2)}
                            {pt.side ? `（${pt.side === "left" ? "左" : "右"}）` : ""}
                          </td>
                          <td className={td}>{fmtMPa(pt.sigma)}</td>
                          <td className={td}>{fmtMPa(pt.tau)}</td>
                          <td className={td}>{fmtMPa(pt.s1)}</td>
                          <td className={td}>{fmtMPa(pt.s2)}</td>
                          <td className={td}>{fmtMPa(pt.s3)}</td>
                          <td className={td}>{fmtMPa(pt.tresca)}</td>
                          <td className={td}>{fmtMPa(pt.mises)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <MohrCircle p={ms.points[ms.worst]} />
                </details>
              ))}
            </>
          )}

          {solution.buckling && (
            <>
              <h3 className="kicker mb-1.5 mt-4">压杆稳定（几何刚度特征值）</h3>
              {solution.buckling.ok ? (
                <p className="my-1.5 leading-[1.6] text-amber">
                  临界荷载乘子 <b><CountUp value={solution.buckling.lambda} decimals={3} /></b>
                  <br />
                  现有全部荷载同乘 λ 即达第一阶屈曲模态（画布橙色细杆，顶栏可关）。基准：{solution.buckling.loadRef || "—"}
                </p>
              ) : (
                <p className="my-1.5 leading-[1.6] text-amber">{solution.buckling.note ?? "稳定分析不可用"}</p>
              )}
            </>
          )}

          {solution.energy !== undefined && (
            <p className="mt-2.5 text-muted">
              总应变能 U = <b><CountUp value={solution.energy} decimals={6} /></b> J（½dᵀKd，供卡氏定理/单位载荷法对账）
            </p>
          )}
        </>
      )}

      {solution.checks.length > 0 && (
        <>
          <h3 className="kicker mb-1.5 mt-4">独立校核</h3>
          <ul className="m-0 list-none p-0">
            {solution.checks.map((c) => (
              <li key={c.name} className="flex flex-wrap gap-2 border-b border-line py-1">
                <span className={c.pass ? "text-ok" : "text-danger"}>
                  {c.pass ? "✓" : "✗"} {c.name}
                </span>
                <span className="font-mono text-[11px] text-faint">
                  {/* ISSUE-16：强度校核的 residual = 利用率−1，直接当「残差」念没有物理意义，改报利用率 */}
                  {c.name.includes("强度校核") ? `利用率 ${((c.residual + 1) * 100).toFixed(1)}%` : `残差 ${c.residual.toExponential(2)}`}
                </span>
                {c.note && <em className="w-full text-[11px] not-italic text-faint">{c.note}</em>}
              </li>
            ))}
          </ul>
        </>
      )}

      {solution.warnings.length > 0 && (
        <ul className="mt-2.5 pl-[18px] text-amber">
          {solution.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <details className="mt-3.5 text-[12px] text-muted">
        <summary className="cursor-pointer text-faint">求解过程（{solution.steps.length} 步）</summary>
        {solution.steps.map((s, i) => (
          <p key={i} className="my-1.5 leading-[1.5]">
            <b>[{s.title}]</b> {s.detail}
          </p>
        ))}
      </details>
    </div>
  );
}
