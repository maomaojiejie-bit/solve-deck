/**
 * 首页「实时演算」工作台 —— 真的在算，不是截图。
 * ---------------------------------------------------------------------------
 * 数据链：滑杆 → MechSpec → solveMech(前端求解内核) → 反力 / 内力图 / 应力 / 六项校核。
 * 页面上每一个数字都能追到内核输出，滑杆一改就重算 —— 这也是「拆解台」本身的样子。
 */

import { useMemo, useState } from 'react';
import {
  solveMech,
  type MechDiagramPoint,
  type MechSolution,
} from '../../core/mechanics/solve.ts';
import type { MechSpec } from '../../core/mechanics/spec.ts';
import { CountUp, Typewriter } from '../../ui/motion';

type PresetId = 'beam-mid' | 'cantilever' | 'beam-udl';

type Control = {
  key: 'L' | 'P' | 'q';
  label: string;
  symbol: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

type Preset = {
  id: PresetId;
  tab: string;
  code: string;
  title: string;
  statement: (v: Values) => string;
  controls: Control[];
  init: Values;
};

type Values = Record<'L' | 'P' | 'q', number>;

const SECTION_RECT = { b: 0.18, h: 0.32 };

const PRESETS: Preset[] = [
  {
    id: 'beam-mid',
    tab: '简支梁',
    code: 'M3',
    title: '中点集中力',
    statement: (v) =>
      `简支梁，跨度 ${v.L.toFixed(2)} m，跨中作用一个 ${v.P.toFixed(0)} kN 的向下集中力。求支座反力与最大弯矩。`,
    controls: [
      { key: 'L', label: '跨度', symbol: 'L', min: 2, max: 8, step: 0.1, unit: 'm' },
      { key: 'P', label: '集中力', symbol: 'F', min: 5, max: 60, step: 1, unit: 'kN' },
    ],
    init: { L: 4, P: 20, q: 0 },
  },
  {
    id: 'beam-udl',
    tab: '均布荷载',
    code: 'M4',
    title: '满跨均布',
    statement: (v) =>
      `简支梁，跨度 ${v.L.toFixed(2)} m，全长承受 ${v.q.toFixed(0)} kN/m 的向下均布荷载。求反力、剪力与弯矩极值。`,
    controls: [
      { key: 'L', label: '跨度', symbol: 'L', min: 2, max: 8, step: 0.1, unit: 'm' },
      { key: 'q', label: '线荷载', symbol: 'q', min: 2, max: 30, step: 1, unit: 'kN/m' },
    ],
    init: { L: 6, P: 0, q: 8 },
  },
  {
    id: 'cantilever',
    tab: '悬臂梁',
    code: 'M5',
    title: '端部集中力',
    statement: (v) =>
      `一端固定的悬臂梁，伸出 ${v.L.toFixed(2)} m，自由端作用 ${v.P.toFixed(0)} kN 向下集中力。求固端反力与最大弯矩。`,
    controls: [
      { key: 'L', label: '悬臂长', symbol: 'L', min: 1.5, max: 6, step: 0.1, unit: 'm' },
      { key: 'P', label: '集中力', symbol: 'F', min: 3, max: 40, step: 1, unit: 'kN' },
    ],
    init: { L: 3, P: 12, q: 0 },
  },
];

function buildSpec(preset: PresetId, v: Values): MechSpec {
  if (preset === 'cantilever') {
    return {
      kind: 'beam',
      length: v.L,
      supports: [{ x: 0, type: 'fixed' }],
      loads: [{ type: 'point_force', x: v.L, value: -v.P, dir: 'transverse' }],
      section: { shape: 'rect', params: SECTION_RECT },
    };
  }
  if (preset === 'beam-udl') {
    return {
      kind: 'beam',
      length: v.L,
      supports: [
        { x: 0, type: 'pin' },
        { x: v.L, type: 'roller' },
      ],
      loads: [{ type: 'distributed', x0: 0, x1: v.L, q0: -v.q, q1: -v.q, dir: 'transverse' }],
      section: { shape: 'rect', params: SECTION_RECT },
    };
  }
  return {
    kind: 'beam',
    length: v.L,
    supports: [
      { x: 0, type: 'pin' },
      { x: v.L, type: 'roller' },
    ],
    loads: [{ type: 'point_force', x: v.L / 2, value: -v.P, dir: 'transverse' }],
    section: { shape: 'rect', params: SECTION_RECT },
  };
}

function fmt(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/* ───────────────────────────── 图形 ───────────────────────────── */

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function Schematic({
  preset,
  values,
  solution,
}: {
  preset: PresetId;
  values: Values;
  solution: MechSolution | null;
}) {
  const L = values.L;
  const x0 = 34;
  const x1 = 366;
  const span = x1 - x0;
  const beamY = 58;
  const at = (x: number) => x0 + (x / Math.max(L, 1e-6)) * span;
  const loadX = preset === 'cantilever' ? x1 : preset === 'beam-udl' ? null : at(L / 2);
  const color = 'var(--color-ink)';
  const hairl = 'var(--color-line-2)';
  const accent = 'var(--color-cyan)';

  return (
    <svg viewBox="0 0 400 132" className="h-[132px] w-full" role="img" aria-label="梁的受力简图">
      {/* 制图辅助线：只交代比例，不参与信息 */}
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1={x0 + span * ratio}
          y1={16}
          x2={x0 + span * ratio}
          y2={112}
          stroke={hairl}
          strokeWidth="0.5"
          strokeDasharray="2 5"
          opacity="0.55"
        />
      ))}

      {/* 梁：一道粗线 + 上下发丝线，读起来是一根构件而不是一条笔画 */}
      <line x1={x0} y1={beamY} x2={x1} y2={beamY} stroke={color} strokeWidth="3" strokeLinecap="butt" />
      <line x1={x0} y1={beamY - 3.5} x2={x1} y2={beamY - 3.5} stroke={hairl} strokeWidth="0.5" />
      <line x1={x0} y1={beamY + 3.5} x2={x1} y2={beamY + 3.5} stroke={hairl} strokeWidth="0.5" />

      {/* 支座：固定端 / 固定铰 / 可动铰 */}
      {preset === 'cantilever' ? (
        <g>
          <line x1={x0} y1={beamY - 16} x2={x0} y2={beamY + 16} stroke={color} strokeWidth="2" />
          {[-12, -6, 0, 6, 12].map((dy) => (
            <line
              key={dy}
              x1={x0 - 9}
              y1={beamY + dy + 6}
              x2={x0}
              y2={beamY + dy}
              stroke={hairl}
              strokeWidth="1"
            />
          ))}
        </g>
      ) : (
        <g>
          <path d={`M${x0} ${beamY} l -10 15 h 20 z`} fill="none" stroke={color} strokeWidth="1.4" />
          <line x1={x0 - 12} y1={beamY + 15} x2={x0 + 12} y2={beamY + 15} stroke={color} strokeWidth="1.4" />
          <path d={`M${x1} ${beamY} l -10 15 h 20 z`} fill="none" stroke={color} strokeWidth="1.4" />
          <circle cx={x1 - 5} cy={beamY + 18} r="2.6" fill="none" stroke={color} strokeWidth="1.2" />
          <circle cx={x1 + 5} cy={beamY + 18} r="2.6" fill="none" stroke={color} strokeWidth="1.2" />
          <line x1={x1 - 13} y1={beamY + 21} x2={x1 + 13} y2={beamY + 21} stroke={color} strokeWidth="1.2" />
        </g>
      )}

      {/* 载荷：集中力一支箭头，均布一排小箭头 */}
      {preset === 'beam-udl' ? (
        <g>
          {Array.from({ length: 11 }, (_, i) => x0 + (span / 10) * i).map((x) => (
            <g key={x}>
              <line x1={x} y1={22} x2={x} y2={beamY - 5} stroke={accent} strokeWidth="1.1" />
              <path d={`M${x - 2.6} ${beamY - 9} L${x} ${beamY - 5} L${x + 2.6} ${beamY - 9}`}
                fill="none" stroke={accent} strokeWidth="1.1" />
            </g>
          ))}
          <line x1={x0} y1={20} x2={x1} y2={20} stroke={accent} strokeWidth="1.2" />
          <text x={x1} y={14} textAnchor="end" fontFamily={MONO} fontSize="9" fill={accent}>
            q = {fmt(values.q, 0)} kN/m
          </text>
        </g>
      ) : (
        <g>
          <line x1={loadX ?? x0} y1={18} x2={loadX ?? x0} y2={beamY - 5} stroke={accent} strokeWidth="1.6" />
          <path
            d={`M${(loadX ?? x0) - 4.5} ${beamY - 11} L${loadX ?? x0} ${beamY - 5} L${(loadX ?? x0) + 4.5} ${beamY - 11}`}
            fill="none"
            stroke={accent}
            strokeWidth="1.6"
          />
          <text
            x={loadX ?? x0}
            y={13}
            textAnchor="middle"
            fontFamily={MONO}
            fontSize="9"
            fill={accent}
          >
            F = {fmt(values.P, 0)} kN
          </text>
        </g>
      )}

      {/* 尺寸线：刻度 + 两端界标 + 居中标注 */}
      <line x1={x0} y1={100} x2={x1} y2={100} stroke={hairl} strokeWidth="0.9" />
      <line x1={x0} y1={94} x2={x0} y2={106} stroke={hairl} strokeWidth="0.9" />
      <line x1={x1} y1={94} x2={x1} y2={106} stroke={hairl} strokeWidth="0.9" />
      <rect x={x0 + span / 2 - 26} y={92} width="52" height="15" fill="var(--color-panel)" opacity="0.92" />
      <text
        x={x0 + span / 2}
        y={103}
        textAnchor="middle"
        fontFamily={MONO}
        fontSize="9"
        fill="var(--color-muted)"
      >
        L = {fmt(L, 2)} m
      </text>

      {/* 反力读数贴在支座旁边（真的来自内核，没算出来就不画） */}
      {preset !== 'cantilever' && solution?.reactions[0] ? (
        <text x={x0} y={beamY + 34} textAnchor="middle" fontFamily={MONO} fontSize="9" fill={accent}>
          R_A {fmt(solution.reactions[0].Ry, 2)}
        </text>
      ) : null}
    </svg>
  );
}

function Diagram({
  points,
  label,
  unit,
  tone,
}: {
  points: MechDiagramPoint[];
  label: string;
  unit: string;
  tone: 'q' | 'm';
}) {
  const W = 176;
  const H = 62;
  if (!points || points.length === 0) {
    return (
      <div className="flex h-[62px] items-center justify-center text-[11px] text-faint">该内力恒为 0</div>
    );
  }
  const values = points.map((p) => p.value);
  const hi = Math.max(...values, 0);
  const lo = Math.min(...values, 0);
  const range = Math.max(hi - lo, 1e-9);
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const pad = 6;
  const sx = (x: number) => pad + ((x - xMin) / Math.max(xMax - xMin, 1e-9)) * (W - pad * 2);
  const zeroY = H / 2;
  const sy = (value: number) => zeroY - ((value - (hi + lo) / 2) / range) * (H - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)} ${sy(p.value).toFixed(2)}`).join(' ');
  const area = `${path} L${sx(xMax).toFixed(2)} ${zeroY.toFixed(2)} L${sx(xMin).toFixed(2)} ${zeroY.toFixed(2)} Z`;
  const stroke = tone === 'q' ? 'var(--color-ink)' : 'var(--color-cyan)';
  const fill = tone === 'q' ? 'var(--color-line)' : 'color-mix(in srgb, var(--color-cyan) 18%, transparent)';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted">{label}</span>
        <span className="font-mono text-[10px] text-faint">{unit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[62px] w-full" aria-hidden="true">
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--color-line-2)" strokeWidth="0.7" />
        <path d={area} fill={fill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ───────────────────────────── 工作台 ───────────────────────────── */

export function LiveWorkbench() {
  const [presetId, setPresetId] = useState<PresetId>('beam-mid');
  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0];
  const [drafts, setDrafts] = useState<Record<PresetId, Values>>({
    'beam-mid': PRESETS[0].init,
    'beam-udl': PRESETS[1].init,
    cantilever: PRESETS[2].init,
  });
  const values = drafts[presetId];

  const setValue = (key: Control['key'], raw: number) => {
    setDrafts((prev) => ({ ...prev, [presetId]: { ...prev[presetId], [key]: raw } }));
  };

  const solution = useMemo<MechSolution | null>(() => {
    try {
      return solveMech(buildSpec(presetId, values));
    } catch {
      // 参数越界时内核会抛 MechSpecError：这里退回「无读数」，绝不编造数字
      return null;
    }
  }, [presetId, values]);

  const reactions = solution?.reactions ?? [];
  const qPoints = solution?.diagrams.Q ?? [];
  const mPoints = solution?.diagrams.M ?? [];
  const mAbsMax = solution?.extrema.M?.abs_max;
  const mAbsMaxX = solution?.extrema.M?.abs_max_x;
  const sigmaMax = solution?.stresses.sigma_max;
  const checks = solution?.checks ?? [];
  const passed = checks.filter((check) => check.pass).length;
  const allPass = checks.length > 0 && passed === checks.length;

  const readouts: Array<{ label: string; value: number | undefined; unit: string; digits: number }> =
    presetId === 'cantilever'
      ? [
          { label: '固端反力 R_A', value: reactions[0]?.Ry, unit: 'kN', digits: 2 },
          { label: '固端弯矩 M_A', value: reactions[0]?.Mz, unit: 'kN·m', digits: 2 },
          { label: '|M|max', value: mAbsMax, unit: 'kN·m', digits: 2 },
        ]
      : [
          { label: 'R_A', value: reactions[0]?.Ry, unit: 'kN', digits: 2 },
          { label: 'R_B', value: reactions[1]?.Ry, unit: 'kN', digits: 2 },
          { label: '|M|max', value: mAbsMax, unit: 'kN·m', digits: 2 },
        ];

  return (
    <figure
      data-testid="home-product"
      className="overflow-hidden rounded-[14px] border border-line-2 bg-panel"
      style={{ boxShadow: '0 18px 44px -28px rgba(24,20,12,0.55)' }}
    >
      {/* 窗口条：只有编号与状态，不做三个彩色圆点 */}
      <div className="flex h-10 items-center gap-3 border-b border-line px-4">
        <span className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] text-faint">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan" />
          实时演算 · {preset.code}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPresetId(item.id)}
              aria-pressed={item.id === presetId}
              className={`focus-ring rounded-[3px] px-2 py-1 font-mono text-[10.5px] tracking-[0.08em] transition-colors ${
                item.id === presetId
                  ? 'bg-cyan/10 text-cyan'
                  : 'text-faint hover:text-ink'
              }`}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>

      {/* 题面：打字机逐字落，落完才让读数出场 */}
      <div className="border-b border-line px-4 py-3">
        <p className="font-mono text-[10px] tracking-[0.16em] text-faint">题面</p>
        <p className="mt-1 min-h-[38px] text-[12.5px] leading-[1.6] text-muted">
          <Typewriter key={preset.id} text={preset.statement(values)} speed={16} delay={140} />
        </p>
      </div>

      <div className="px-2 pt-1">
        <Schematic preset={presetId} values={values} solution={solution} />
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-line px-4 py-3 sm:grid-cols-2">
        <Diagram points={qPoints} label="剪力图 Q" unit="kN" tone="q" />
        <Diagram points={mPoints} label="弯矩图 M" unit="kN·m" tone="m" />
      </div>

      {/* 读数：数字递增，值一变数字弹一下 */}
      <div className="grid grid-cols-1 border-t border-line sm:grid-cols-3">
        {readouts.map((readout, index) => (
          <div
            key={readout.label}
            className={`px-4 py-3 ${
              index < readouts.length - 1 ? 'border-b border-line sm:border-b-0 sm:border-r' : ''
            }`}
          >
            <p className="font-mono text-[10px] tracking-[0.12em] text-faint">{readout.label}</p>
            <p className="mt-1 text-[19px] leading-none text-ink">
              <CountUp value={readout.value ?? Number.NaN} decimals={readout.digits} unit={readout.unit} />
            </p>
          </div>
        ))}
      </div>

      {/* 滑杆：真参数面板，拖动即重算 */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line px-4 py-3">
        {preset.controls.map((control) => (
          <label key={control.key} className="min-w-[150px] flex-1">
            <span className="flex items-baseline justify-between">
              <span className="font-mono text-[10px] tracking-[0.12em] text-faint">
                {control.label} · {control.symbol}
              </span>
              <span className="font-mono text-[11px] text-ink">
                {values[control.key].toFixed(control.step < 1 ? 1 : 0)} {control.unit}
              </span>
            </span>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={values[control.key]}
              aria-label={`${control.label} ${control.symbol}`}
              onChange={(event) => setValue(control.key, Number(event.target.value))}
              className="mt-2 h-1 w-full cursor-ew-resize appearance-none rounded-full bg-[var(--color-line-2)] accent-[var(--color-cyan)]"
            />
          </label>
        ))}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.12em] text-faint">校核</span>
          <span className="flex items-center gap-1">
            {checks.length === 0
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="h-1.5 w-4 rounded-full bg-[var(--color-line-2)]" />
                ))
              : checks.map((check, i) => (
                  <span
                    key={`${check.name}-${i}`}
                    title={check.name}
                    className={`h-1.5 w-4 rounded-full ${check.pass ? 'bg-cyan' : 'bg-danger'}`}
                  />
                ))}
          </span>
          <span className={`font-mono text-[10px] ${allPass ? 'text-cyan' : 'text-danger'}`}>
            {checks.length === 0 ? '无读数' : `${passed}/${checks.length}`}
          </span>
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-faint">
          σmax {fmt(sigmaMax, 1)} MPa
        </span>
        <span className="h-2 w-px bg-[var(--color-line-2)]" />
        <span className="font-mono text-[10px] text-faint">
          {mAbsMaxX === undefined ? '—' : `M 极值位置 x = ${fmt(mAbsMaxX, 2)} m`}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">本地求解 · 零请求</span>
      </figcaption>
    </figure>
  );
}
