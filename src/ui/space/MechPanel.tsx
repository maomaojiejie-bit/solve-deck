// Q4 E3 侧栏：播放条 + 时程图（SVG 小倍数）+ 关键量对账表 + 校核/步骤/拒答 + 扁平参数编辑器。
// 参数直接编辑 model.p（通用数值表，无需逐模板写表单），改完由上层 useMemo 即时重解。
// 自 lab3d-proto src/ui/MechPanel.tsx 迁入；样式已按 solve-deck 图纸口径重写（Tailwind/token，不再依赖 lab3d index.css）。
// 新增 readOnly：只读模式下隐藏机构参数编辑区与复位按钮，保留播放条、tKey/时程结果表、校核与拒答展示。
import type { KinSeries, MechModel, SolutionKin } from "../../core/space/types";

interface Props {
  model: MechModel;
  solution: SolutionKin;
  t: number;
  onT: (t: number) => void;
  playing: boolean;
  onPlaying: (b: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  onChange: (m: MechModel) => void;
  onReset: () => void;
  /** 只读模式：隐藏机构参数编辑区（改 model 的输入/按钮），保留播放与结果展示 */
  readOnly?: boolean;
}

/* ---- solve-deck 图纸口径的样式常量（原 .badge/.rc-table/.mini 等类的 Tailwind 重写） ---- */
const badge = "rounded-[3px] border border-line-2 px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em]";
const th = "border-b border-line-2 py-1 pr-3 text-left text-[11px] font-medium text-muted";
const td = "border-b border-line py-1 pr-3 font-mono tabular-nums";
const btn = "h-8 rounded-[4px] border border-line-2 bg-elev px-2.5 text-[12px] text-muted disabled:cursor-default disabled:opacity-45";
const inp = "h-8 rounded-[4px] border border-line-2 bg-elev px-2 font-mono text-[12px]";
const h3 = "kicker mb-1.5 mt-4";

/** 对账友好格式：常规 4 位小数去尾零，过大/过小走科学计数，非有限值原样标注。
 *  ISSUE-16：|v| < 1e-9 的浮点噪声不再显示成 -7.944e-16，统一记 0 / ≈0。 */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a < 1e-9) return v === 0 ? "0" : "≈0";
  if (a < 1e-3 || a >= 1e5) return v.toExponential(3);
  return String(Number(v.toFixed(4)));
}

const P_LABEL: Record<string, string> = {
  tKey: "对账时刻 tKey (s)",
  x_A: "x 振幅 A (m)", x_w: "x 角频率 ω (rad/s)", x_ph: "x 初相 φ (rad)",
  y_A: "y 振幅 A (m)", y_w: "y 角频率 ω (rad/s)", y_ph: "y 初相 φ (rad)",
  z_c1: "z 一次项 c₁ (m/s)",
  dz: "转动半径 d (m)", ph_c1: "φ 一次项 (rad/s)", ph_c2: "φ 二次项 (rad/s²)", kn: "轮周标记点数",
  psi_c1: "杆转角速度 ψ̇ (rad/s)", s_c1: "沿杆滑速 ṡ (m/s)",
  L: "长度 L (m)", r: "曲柄半径 r (m)", l: "连杆长度 l (m)", w: "角速度 ω (rad/s)",
  R: "半径 R (m)", v0: "质心速度 v_C (m/s)",
  m: "质量 m (kg)", m1: "左质量 m₁ (kg)", m2: "右质量 m₂ (kg)", rope0: "绳长 ℓ₀ (m)",
  vx0: "初速 vₓ₀ (m/s)", vy0: "初速 v_y₀ (m/s)", Fx: "水平力 Fₓ (N)",
  mode: "子模式 (0/1/2)", th0: "初始角 θ₀ (rad)", th1: "终止角 θ₁ (rad)",
  beta: "斜面倾角 β (rad)", k: "惯量系数 k (I/mR²)",
  y_c2: "提升 y=c₂t² 系数 (m/s²)", mr: "偏心质量 mᵣ (kg)", e: "偏心距 e (m)",
};

/** 单条时程曲线的独立缩放小图（NaN 断线；金色虚线=tKey 对账时刻；白竖线=当前播放时刻） */
function Spark({ s, duration, t, tKey }: { s: KinSeries; duration: number; t: number; tKey: number | null }) {
  const W = 320;
  const H = 92;
  const P = 8;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of s.values)
    if (Number.isFinite(v)) {
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  if (!Number.isFinite(mn)) {
    mn = -1;
    mx = 1;
  }
  if (mx - mn < 1e-12) {
    mn -= 0.5;
    mx += 0.5;
  }
  const n = Math.max(2, s.values.length);
  const X = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - mn) / (mx - mn)) * (H - 2 * P);
  const segs: string[] = [];
  let d = "";
  s.values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      if (d) segs.push(d);
      d = "";
      return;
    }
    d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
  });
  if (d) segs.push(d);
  const xT = P + (Math.min(t, duration) / duration) * (W - 2 * P);
  const xK = tKey != null && tKey <= duration ? P + (tKey / duration) * (W - 2 * P) : null;
  return (
    <div className="mb-3 mt-2">
      <div className="flex items-baseline gap-1.5 text-[11px] text-muted">
        <b className="font-mono text-[12px] text-ink">{s.name}</b>
        <span>[{s.unit}]</span>
        <em className="ml-auto not-italic tabular-nums text-faint">
          {fmt(mn)} ~ {fmt(mx)}
        </em>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full rounded-[4px] border border-line bg-panel-2"
      >
        {mn < 0 && mx > 0 && <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} stroke="var(--color-line)" />}
        {xK != null && <line x1={xK} x2={xK} y1={P} y2={H - P} stroke="var(--color-gold)" strokeDasharray="3 3" />}
        {segs.map((dd, i) => (
          <path key={i} d={dd} fill="none" stroke="var(--color-cyan)" strokeWidth={1.6} />
        ))}
        <line x1={xT} x2={xT} y1={P} y2={H - P} stroke="var(--color-ink)" strokeWidth={1} opacity={0.75} />
      </svg>
    </div>
  );
}

export default function MechPanel({
  model,
  solution,
  t,
  onT,
  playing,
  onPlaying,
  speed,
  onSpeed,
  onChange,
  onReset,
  readOnly = false,
}: Props) {
  const tKey = Number.isFinite(model.p.tKey) ? model.p.tKey : null;
  const pKeys = Object.keys(model.p).sort();

  function setP(key: string, v: number) {
    onChange({ ...model, p: { ...model.p, [key]: v } });
  }

  return (
    <div className="card px-3.5 pb-5 pt-3 text-[13px]">
      {/* ---- 播放条（只读模式保留） ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-elev px-2.5 py-2">
        <button className={btn} onClick={() => onPlaying(!playing)} disabled={!solution.frames.length}>
          {playing ? "暂停" : "播放"}
        </button>
        <button className={btn} onClick={() => onT(0)} disabled={!solution.frames.length}>
          归零
        </button>
        {tKey != null && (
          <button className={btn} onClick={() => onT(tKey)} title="跳到金色对账时刻">
            跳 tKey
          </button>
        )}
        {/* I-10：时间读数与滑杆放在一起，两端给刻度，避免「t 单独占一行、顺序还反了」 */}
        <div className="min-w-[150px] flex-1">
          <div className="flex justify-between font-mono text-[10.5px] text-faint">
            <span>0</span>
            <span className="text-ink">t = {t.toFixed(3)} s</span>
            <span>{model.duration.toFixed(2)} s</span>
          </div>
          <input
            className="h-1 w-full accent-cyan"
            type="range"
            aria-label="播放时刻"
            min={0}
            max={model.duration}
            step={model.duration / 600}
            value={Math.min(t, model.duration)}
            onChange={(e) => {
              onPlaying(false);
              onT(Number(e.target.value));
            }}
          />
        </div>
        <select className={inp} value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="播放速度">
          <option value={0.25}>0.25×</option>
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] text-faint">结果中的 t 为对账时刻 tKey，与上面当前播放时刻不是同一时间。</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className={`${badge} text-muted`}>{model.type} 模板</span>
        <span className={`${badge} text-muted`}>{solution.kind === "kin" ? "运动学" : "动力学"}</span>
        <span className={`${badge} ${solution.verified ? "text-ok" : "text-danger"}`}>
          {solution.verified ? "校核通过" : "未通过/拒答"}
        </span>
      </div>
      <p className="callout mt-2.5 leading-[1.5]">{solution.headline}</p>

      {solution.refusals && (
        <div className="mt-2.5 rounded-[4px] border border-danger/40 bg-danger/5 px-3 py-2.5">
          {solution.refusals.map((r, i) => (
            <p key={i} className="my-1 text-danger">
              {r}
            </p>
          ))}
        </div>
      )}

      {/* ---- 关键量对账表 ---- */}
      {solution.keyValues.length > 0 && (
        <>
          <h3 className={h3}>tKey 关键量（金色对账）</h3>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={th}>量</th>
                <th className={th}>值</th>
                <th className={th}>单位</th>
              </tr>
            </thead>
            <tbody>
              {solution.keyValues.map((k) => (
                <tr key={k.name}>
                  <td className={td}>{k.name}</td>
                  <td className={`${td}${k.name === "tKey" ? "" : " whitespace-nowrap text-gold"}`}>{fmt(k.value)}</td>
                  <td className={td}>{k.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---- 时程图 ---- */}
      {solution.series.length > 0 && (
        <>
          <h3 className={h3}>时程曲线（各自独立缩放，白线=播放时刻）</h3>
          {solution.series.map((s) => (
            <Spark key={s.name} s={s} duration={model.duration} t={t} tKey={tKey} />
          ))}
        </>
      )}

      {/* ---- 校核 ---- */}
      {solution.checks.length > 0 && (
        <>
          <h3 className={h3}>数值校核</h3>
          <ul className="m-0 list-none p-0">
            {solution.checks.map((c) => (
              <li key={c.name} className="flex flex-wrap gap-2 border-b border-line py-1">
                <span className={c.pass ? "text-ok" : "text-danger"}>{c.pass ? "✓" : "✗"}</span>
                <span>{c.name}</span>
                <span className="font-mono text-[11px] text-faint">残差 {c.residual.toExponential(2)}</span>
                <em className="w-full text-[11px] not-italic text-faint">{c.note}</em>
              </li>
            ))}
          </ul>
        </>
      )}

      {solution.warnings.length > 0 && (
        <ul className="mt-2.5 pl-[18px] text-amber">
          {solution.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {solution.steps.length > 0 && (
        <details className="mt-3.5 text-[12px] text-muted">
          <summary className="cursor-pointer text-faint">求解步骤（{solution.steps.length} 步）</summary>
          {solution.steps.map((s, i) => (
            <p key={i} className="my-1.5 leading-[1.5]">
              <b>
                {i + 1}. {s.title}
              </b>
              <br />
              {s.detail}
            </p>
          ))}
        </details>
      )}

      {/* ---- 参数编辑器（扁平 p 表 + 时长）：只读模式隐藏 ---- */}
      {!readOnly && (
        <>
          <h3 className={h3}>模型参数（改后即时重解）</h3>
          <div className="flex flex-col gap-[5px]">
            <label className="flex items-center justify-between gap-2 text-muted">
              <span className="truncate whitespace-nowrap">duration 时长 (s)</span>
              <input
                className={`${inp} w-[110px] shrink-0`}
                type="number"
                step="any"
                min={0.01}
                value={model.duration}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) onChange({ ...model, duration: v });
                }}
              />
            </label>
            {pKeys.map((k) => (
              <label className="flex items-center justify-between gap-2 text-muted" key={k}>
                <span className="truncate whitespace-nowrap" title={k}>
                  {P_LABEL[k] ?? k}
                </span>
                <input
                  className={`${inp} w-[110px] shrink-0`}
                  type="number"
                  step="any"
                  value={model.p[k]}
                  onChange={(e) => setP(k, Number(e.target.value))}
                />
              </label>
            ))}
          </div>

          <button
            className="lift mt-3.5 w-full rounded-[4px] border border-danger/40 bg-transparent py-1 text-[12px] text-danger hover:border-danger hover:bg-danger/5"
            onClick={onReset}
          >
            恢复原算例
          </button>
        </>
      )}
    </div>
  );
}
