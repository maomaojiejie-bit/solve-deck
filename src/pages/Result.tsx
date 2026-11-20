import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import 'katex/dist/katex.min.css';
import { CONTRACT_VERSION, type CheckState, type Solution } from '../core/types';
import { isLabSupported } from '../core/lab/ids';
import { SUBJECT_LABEL } from '../core/subjects.ts';
import { formatScalar } from '../core/format.ts';
import { UnitModeSelect } from '../ui/UnitModeSelect.tsx';
import { copyText } from '../ui/clipboard.ts';
import { stepsToLatex, stepsToMarkdown } from '../core/latexExport.ts';
import { kbLinksFor } from '../kb/related.ts';
import { getUnitMode, subscribeUnitMode } from '../core/units.ts';
import { modelCaveatFor } from '../core/modelCaveats.ts';
import { Chart } from '../render/Chart.tsx';
import {
  buildSweepChart,
  sweepAxis,
  sweepExtrema,
  type SweepPoint,
  type SweepExtremum,
} from '../core/parameterSweep.ts';
import type { ChartSpec } from '../core/types.ts';
import { pickPrimaryAnswer } from '../core/primaryAnswer.ts';
import {
  getTemplate,
  getTemplateRoute,
  type ParamSpec,
  type ParamValue,
  type Solver,
} from '../core/templates/registry';
import { getExample } from '../examples';
import { validateLive } from '../confidence/live';
import {
  bitsToValue,
  buildParamQuery,
  buildSolverInput,
  cloneDefault,
  defaultParamValues,
  parseParamQuery,
} from '../core/params/query';
import { ParamPanel } from '../ui/ParamPanel';
import {
  nextSpeed,
  nextStep,
  prevStep,
  stepDurationMs,
  type PlayerSpeed,
} from '../core/player';
import { Formula } from '../render/Formula';
import { SpecGrid } from '../render/SpecGrid';
import { isFullyValidated } from '../confidence/confidence.ts';
import { ConfidenceBadge, confidenceTone } from '../ui/ConfidenceBadge';
import { confidenceSummary, formatDisplayValue, skippedChecks } from '../ui/confidenceSummary';
import { StepPlayer } from '../ui/StepPlayer';
import { ThemeToggle } from '../ui/ThemeToggle';
import { SiteHeader } from '../ui/SiteHeader';
import { LoadingPlate } from '../ui/LoadingPlate';
import { ReadoutPanel } from '../ui/ReadoutPanel';
import { buildReadouts } from '../core/readouts.ts';
import { assumptionLines, parseSimplifications } from '../core/scope/simplifications';

/** 结果位只给人话：判据名不许露 unknownCount 这类英文键。
 *  2026-11-14 巡检 D1：以前只映射了 7 个键，A3 的 `rpi / AvApprox / AvNoRo`、
 *  M5 的 `MmaxX / thetaMaxMrad`、S5 的 `zeroMembers` 全是原样印给用户。 */
const RESULT_KEY_LABELS: Record<string, string> = {
  unknownCount: '未知量数',
  equationCount: '方程数',
  rank: '矩阵秩',
  config: '组态',
  status: '状态',
  conclusion: '结论',
  remedy: '怎么改',
  // 模电
  rpi: 'rπ',
  gm: 'gm',
  gds: 'gds',
  ro: 'ro',
  Av: 'Av',
  Ri: 'Ri',
  Ro: 'Ro',
  /** 闭式解（含 ro）：不是「近似」，与 Av 只差 MNA 的舍入。 */
  AvApprox: 'Av 闭式（含 ro）',
  /** 教材常用的「忽略 ro」近似 —— 和上面那行完全不同的一回事。 */
  AvNoRo: 'Av 忽略 ro',
  topology: '拓扑',
  AvIdeal: 'Av 理想运放',
  AvFinite: 'Av 有限增益',
  Vout: 'Vout',
  AfAnswer: 'Af 闭环增益',
  AfLoop: 'Af 环路法',
  AfMNA: 'Af 节点法',
  AfDeep: 'Af 深度负反馈近似',
  T: '环路增益 T',
  // 力学 / 结构
  RA: 'RA',
  RB: 'RB',
  MA: 'MA',
  Mmax: 'Mmax',
  MmaxX: 'Mmax 位置 x',
  Qmax: 'Qmax',
  Qmin: 'Qmin',
  zeroMembers: '零杆数',
  Iy: 'Iy',
  deltaMax: 'δmax',
  deltaMaxX: 'δmax 位置 x',
  deltaAllow: '许用 δ',
  thetaMaxMrad: 'θmax（mrad）',
  ratio: '利用率',
  lambda: 'λ',
  lambdaP: 'λp',
  sigmaCr: 'σcr',
  sigmaWork: 'σ',
  sigmaAllowStability: '许用 σ',
  pCr: 'Pcr',
  Imin: 'Imin',
  i: 'i',
  // 复合
  demand: '需求',
  capacity: '能力',
  // 力学剩余（第二轮：以前这些键原样印 key）
  A: '面积 A',
  W: '抗弯截面系数 W',
  N: '轴力 N',
  M: '弯矩 M',
  Rx: 'Rx',
  Ry: 'Ry',
  R: '合力 R',
  Feq: '等效力 Feq',
  FeqAngle: '等效力方向',
  thetaR: '合力方向 θ',
  phiF: '摩擦角 φ',
  Pcrit: '临界力 Pcrit',
  F: 'F',
  tau: 'τ',
  tauMax: 'τmax',
  sigmaMax: 'σmax',
  sigmaN: 'σN',
  sigmaM: 'σM',
  sigmaR4: 'σr4',
  deltaL: 'ΔL',
  phiPerRad: '扭转角 φ',
  neutralAxis: '中性轴位置',
  selfLock: '自锁',
  A_mm2: '面积 A',
  A_m2: '面积 A',
  ybar_mm: '形心 ȳ',
  ybar_m: '形心 ȳ',
  // 许用值 / 派生量（第二轮逐个对着 handCheck 核过）
  sigmaAllow: '许用 σ',
  sigmaMin: 'σmin',
  tauAllow: '许用 τ',
  Wp: '抗扭截面系数 Wp',
  Ip: '极惯性矩 Ip',
  Tmax: 'Tmax',
  phiDeg: '扭转角（度）',
  Ix_mm4: 'Ix',
  // M6 应力状态（莫尔圆）
  center: '莫尔圆圆心 σ',
  radius: '莫尔圆半径 R',
  sigma1: 'σ1',
  sigma2: 'σ2',
  thetaP: '主方向 θp',
  // S4 摩擦 / S7 虚功
  Pmin: '最小推力 Pmin',
  friction: '摩擦力',
  delta1: '位移 δ₁',
  delta2: '位移 δ₂',
};

/** 同一个键在不同题型里含义不同，键名要按题型覆盖（`T` 在模电是环路增益，
 *  M8 里是扭矩）。 */
const TEMPLATE_KEY_LABELS: Record<string, Record<string, string>> = {
  M8: { T: '扭矩 T' },
};

/** 求解器内部量：不解释清楚就不该占结果表一行（以前 lastSweepError 直接摆给用户看）。 */
const RESULT_INTERNAL_KEYS = new Set(['lastSweepError', 'errorAtT1000']);

function humanizeKeys(
  data: Record<string, number | string>,
  templateId: string,
): Record<string, number | string> {
  const override = TEMPLATE_KEY_LABELS[templateId] ?? {};
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !RESULT_INTERNAL_KEYS.has(key))
      .map(([key, value]) => [override[key] ?? RESULT_KEY_LABELS[key] ?? key, value]),
  );
}

/** 打印稿的「已知量」表：键去 registry 里查 label / unit，值走同一个 formatScalar。
 *  以前模电之外（力学 M1–M8 / 结构 S1–S7）这张表印的是 `L 4`、`P 20`、`E 200`。 */
function humanizeGiven(
  specs: readonly { key: string; label: string; unit?: string }[],
  data: Record<string, number | string>,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      const spec = specs.find((one) => one.key === key);
      const label = spec?.label ?? RESULT_KEY_LABELS[key] ?? key;
      return [label, typeof value === 'number' ? formatScalar(value, spec?.unit) : String(value)];
    }),
  );
}

/** R-36 A6：结果表按量纲给人话 —— 电流/电压/电阻带工程单位，工作区翻中文。
 *  只动显示层：solution.result 里的 SI 原值（A / 英文 zone 枚举）是 goldenSet
 *  与 live 校验的契约，一个字都不许改。 */
const ANALOG_VALUE_UNITS: Record<string, string> = {
  IB: 'A', IC: 'A', IE: 'A', Ib: 'A', Ic: 'A', Id: 'A', ID: 'A', Iout: 'A',
  VBE: 'V', VCE: 'V', VCEsat: 'V', VBB: 'V', VCC: 'V', Vcc: 'V', Vdd: 'V', Vss: 'V', Vt: 'V',
  Vds: 'V', Vgs: 'V', VDS: 'V', VGS: 'V', Vov: 'V', VOV: 'V', Vout: 'V', Vin: 'V', Vth: 'V',
  gm: 'S', gds: 'S',
  rpi: 'Ω', ro: 'Ω', Ri: 'Ω', Ro: 'Ω', Rth: 'Ω', Rin: 'Ω', Rout: 'Ω',
};

/**
 * 力学 / 结构：**按题型**建表，不做全局键表。
 *
 * 同一个键在两道题里量纲可以不同：`N` 在 M1（拉压轴力）与 M8（组合变形）是 kN，
 * 在 S4（摩擦）却是 N —— 一张全局表会把 S4 的 170.47 N 印成「170 kN」，差一千倍。
 * 表里只放**对着 solver / goldenSet 手算核过**的键；没登记的键维持原样（裸数字）。
 */
const MECH_VALUE_UNITS: Record<string, Record<string, string>> = {
  M1: { N: 'kN', sigmaMax: 'MPa', sigmaAllow: 'MPa', deltaL: 'mm' },
  M2: { Tmax: 'kN·m', Wp: 'mm³', Ip: 'mm⁴', tauMax: 'MPa', tauAllow: 'MPa', phiPerRad: 'rad', phiDeg: '°' },
  M3: { RA: 'kN', RB: 'kN', MA: 'kN·m', Mmax: 'kN·m', MmaxX: 'm', Qmax: 'kN', Qmin: 'kN' },
  M4: { W: 'mm³', Iy: 'mm⁴', Mmax: 'kN·m', sigmaMax: 'MPa', sigmaMin: 'MPa', sigmaAllow: 'MPa', neutralAxis: 'mm' },
  M5: { Iy: 'mm⁴', Mmax: 'kN·m', deltaMax: 'mm', deltaMaxX: 'm', deltaAllow: 'mm' },
  M6: { center: 'MPa', radius: 'MPa', sigma1: 'MPa', sigma2: 'MPa', thetaP: '°', tauMax: 'MPa', sigmaR4: 'MPa', sigmaAllow: 'MPa' },
  M7: { A: 'mm²', Imin: 'mm⁴', i: 'mm', sigmaCr: 'MPa', pCr: 'kN', sigmaWork: 'MPa', sigmaAllowStability: 'MPa' },
  M8: { A: 'mm²', W: 'mm³', Wp: 'mm³', N: 'kN', M: 'kN·m', T: 'kN·m', sigmaN: 'MPa', sigmaM: 'MPa', sigmaMax: 'MPa', tau: 'MPa', sigmaR4: 'MPa', neutralAxis: 'mm', sigmaAllow: 'MPa' },
  S1: { RA: 'kN', RB: 'kN' },
  S2: { Rx: 'kN', Ry: 'kN', R: 'kN', thetaR: '°', Feq: 'kN', FeqAngle: '°' },
  S3: { RA: 'kN', RB: 'kN', RAx: 'kN', Fy: 'kN', MA: 'kN·m', M: 'kN·m' },
  // 摩擦题的解一律按 N 给（不是 kN）—— 见 s4 的 handCheck。
  S4: { Pcrit: 'N', Pmin: 'N', N: 'N', friction: 'N', phiF: '°' },
  S5: { RA: 'kN', RB: 'kN' },
  S6: { A_mm2: 'mm²', A_m2: 'm²', ybar_mm: 'mm', ybar_m: 'm', Ix_mm4: 'mm⁴' },
  S7: { F: 'N', delta1: 'mm', delta2: 'mm' },
};

/** 少数题的 result 按 SI（m）存，但表里按 mm 读才像话（S7 的虚位移 0.0004 m）。
 *  **只做显示换算**，不进 result、不进校验。 */
const MECH_VALUE_SCALE: Record<string, Record<string, number>> = {
  S7: { delta1: 1000, delta2: 1000 },
};
/** 变体 id 落到母题的单位表（M3-cantilever 与 M3 同一套量纲）。 */
function unitsFor(templateId: string, family: 'analog' | 'other'): Record<string, string> | undefined {
  if (family === 'analog') return ANALOG_VALUE_UNITS;
  return MECH_VALUE_UNITS[templateId] ?? MECH_VALUE_UNITS[templateId.split('-')[0]];
}

const RESULT_ZONE_LABELS: Record<string, string> = {
  active: '放大区',
  cutoff: '截止区',
  saturation: '饱和区',
  triode: '可变电阻区',
  subthreshold: '亚阈区',
  inverting: '反相',
  'non-inverting': '同相',
  follower: '跟随',
  ok: '通过',
};

/** P1：校核项以前把内部标识符直接摆给用户（`scopeOk` / `pathsConsistent` / `goldenOk`），
 *  同一张卡里的状态又写英文 `pass` / `skipped`。名字与状态都翻成人话，
 *  认不出的名字原样保留（新增闸门不至于变成空白）。 */
const CHECK_NAME_LABELS: Record<string, string> = {
  scopeOk: '题型范围',
  inputOk: '输入合法性',
  pathsConsistent: '两条路径互核（闭式 vs 节点法）',
  boundaryOk: '边界条件',
  goldenOk: '黄金样例',
  residualOk: '方程残差',
  structure: '结构改动',
  semantic: '关键语义',
};

const CHECK_STATE_LABELS: Record<string, string> = {
  pass: '通过',
  fail: '未通过',
  skipped: '跳过',
  warn: '注意',
};

/** 校核详情里常有 16 位裸浮点（`maxResidual=5.24708481792074e-16`）。
 *  只动显示：绝对值很小的走两位科学计数，其余留四位小数。 */
function tidyCheckText(text: string): string {
  return text.replace(/-?\d+\.\d{5,}(?:e[+-]?\d+)?/gi, (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return raw;
    if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
    return String(Number(value.toFixed(4)));
  });
}

/**
 * 第二轮：以前只有 `subject === 'analog'` 才走单位表，力学族的结果表一直裸着数字
 * （`RA 10`、`Mmax 20`、`σcr 148`）。现在按题型查表；「R 开头就是电阻」这条启发式
 * 只留给模电 —— 结构里的 `R / Rx / Ry` 是反力，按 Ω 印就闹笑话了。
 */
/** 修复计划 T3.4：config / mode 的内部值 → 用户可读（英文缩写保留备查）。 */
const CONFIG_VALUE_LABELS: Record<string, string> = {
  series: '串联 · 普通二极管（series）',
  zener: '稳压管（zener）',
  CE: '共射（CE）',
  CB: '共基（CB）',
  CC: '共集（CC）',
  CS: '共源（CS）',
  CG: '共栅（CG）',
  CD: '共漏（CD）',
};

function formatResultValue(  key: string,
  value: number | string,
  family: 'analog' | 'other',
  templateId: string,
): number | string {
  if (typeof value === 'string') {
    // 修复计划 T3.4：组态 / 模式的内部值不再裸印（config-CE / mode=series）——
    // 表里给中文 + 保留英文缩写备查。
    if (key === 'config' || key === 'mode') {
      const label = CONFIG_VALUE_LABELS[value];
      if (label) return label;
    }
    // P1：A3/A5 的输入电阻是无穷大时 result 里给字符串 '∞'，原来直接印成
    // `Ri∞`（没有单位，和隔壁 `Ro 1.96kΩ` 不是一个样子）。有单位就带上。
    if (value === '∞') {
      const infUnit = unitsFor(templateId, family)?.[key];
      return infUnit ? `∞ ${infUnit}` : value;
    }
    return RESULT_ZONE_LABELS[value] ?? value;
  }
  if (!Number.isFinite(value)) return value;
  // 自锁是 0/1 判据，不是量；给它一句人话，别在表里留个孤零零的 1。
  if (key === 'selfLock') return value !== 0 ? '自锁' : '不自锁';
  const scale = MECH_VALUE_SCALE[templateId]?.[key];
  const shown = scale ? value * scale : value;
  const unit =
    unitsFor(templateId, family)?.[key] ??
    (/^N_[A-Za-z0-9]{1,4}$/.test(key) && family !== 'analog' ? 'kN' : family === 'analog' && /^R[A-Za-z0-9]{0,3}$/.test(key) ? 'Ω' : undefined);
  return unit !== undefined ? formatScalar(shown, unit) : shown;
}

function humanizeValues(
  data: Record<string, number | string>,
  family: 'analog' | 'other',
  templateId: string,
): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, formatResultValue(key, value, family, templateId)]),
  );
}

interface ResultProps {
  templateId: string;
  search: string;
  onBack: () => void;
  onToast: (message: string) => void;
}

const STATE_CLASS: Record<CheckState, string> = {
  pass: 'border-ok/40 text-ok',
  fail: 'border-danger/40 text-danger',
  skipped: 'border-line text-muted',
};

const GRAY_INDEX = [0, 1, 3, 2];

function liveSelectionFor(
  entryId: string,
  params: readonly ParamSpec[],
  values: Record<string, ParamValue>,
  solution: Solution | null,
) {
  if (!solution || !['D1', 'D2', 'D3'].includes(entryId)) return undefined;
  const spec = params.find((param) => param.kind === 'bits');
  const bits = spec && Array.isArray(values[spec.key])
    ? (values[spec.key] as number[])
    : [];
  if (bits.length === 0) return undefined;
  const table = solution.render_specs.find((item) => item.type === 'table')?.table;
  const row = bitsToValue(bits);
  const output = table?.rows[row]?.out[0];
  const active: Record<string, string[]> = {};

  if (entryId === 'D2') {
    const [a, b, c] = bits;
    const g1 = a & b;
    const g2 = c ? 0 : 1;
    const g3 = g1 | g2;
    const f = g3;
    const nodes = ['node-A', 'node-B', 'node-C'];
    const edges = ['edge-A-G1', 'edge-B-G1', 'edge-C-G2'];
    if (g1) nodes.push('node-G1');
    if (g2) nodes.push('node-G2');
    if (g3) nodes.push('node-G3');
    if (f) nodes.push('node-F');
    if (g1) edges.push('edge-G1-G3');
    if (g2) edges.push('edge-G2-G3');
    if (g3) edges.push('edge-G3-F');
    active.main = [...nodes, ...edges];
  }

  if (entryId === 'D3' && bits.length === 3) {
    const [s, a, b] = bits;
    const g1 = s ? 0 : 1;
    const g2 = g1 & a;
    const g3 = s & b;
    const g4 = g2 | g3;
    const f = g4;
    const nodes = ['node-S', 'node-A', 'node-B'];
    const edges = ['edge-S-G1', 'edge-A-G2', 'edge-S-G3', 'edge-B-G3'];
    if (g1) nodes.push('node-G1');
    if (g2) nodes.push('node-G2');
    if (g3) nodes.push('node-G3');
    if (g4) nodes.push('node-G4');
    if (f) nodes.push('node-F');
    if (g1) edges.push('edge-G1-G2');
    if (g2) edges.push('edge-G2-G4');
    if (g3) edges.push('edge-G3-G4');
    if (g4) edges.push('edge-G4-F');
    active.main = [...nodes, ...edges];
  }

  const kmap =
    entryId === 'D1' && bits.length === 4
      ? {
          row: GRAY_INDEX[bits[0] * 2 + bits[1]],
          col: GRAY_INDEX[bits[2] * 2 + bits[3]],
        }
      : undefined;

  return { row, output, active, kmap };
}

function displayResult(
  entryId: string,
  result: Record<string, number | string>,
  subject?: string,
): Record<string, number | string> {
  const family = subject === 'analog' ? 'analog' : 'other';
  const rest = { ...result };
  // 黑盒 #24：Av 与「Av 闭式（含 ro）」数值相同（同一 MNA 口径的两种写法）——
  // 按 DataPanel 的 4 位有效数字口径逐字相等时不再重复占行；有差异（组态变体 /
  // 参数实验场改值后）则照常并列。必须在 humanizeKeys 之前比：键名还没换成展示标签。
  if (rest.Av !== undefined && rest.AvApprox !== undefined) {
    const shownAv = formatDisplayValue(Number(rest.Av));
    const shownApprox = formatDisplayValue(Number(rest.AvApprox));
    if (shownAv === shownApprox) delete rest.AvApprox;
  }
  if (entryId === 'A7' && Number(result.T) < 100) {
    delete rest.AfDeep;
    delete rest.errorAtT1000;
  }
  return humanizeKeys(humanizeValues(rest, family, entryId), entryId);
}

function formatPrintTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 力学结论位：σmax 与 [σ] 的对比由 solver 写进 result.status / ratio / conclusion，
 * 这里只决定红/黄/绿，不重算任何数字。
 *
 * 拒绝态（静不定 / 机构 / 超域）分两种：
 * - 刻意拒绝（S1 的两个反例）：结论位只给「为什么拒」+「怎么改」，一个数都不印；
 * - 超域（M7 柔度不足）：λ 这些量本身是有效的，只把 σcr 那条结论挂黄底，不在此列。
 */
function MechVerdict({ result }: { result: Record<string, number | string> }) {
  const status = String(result.status ?? '');
  const conclusion = String(result.conclusion ?? '');
  const remedy = result.remedy === undefined ? '' : String(result.remedy);
  const ratio = Number(result.ratio);
  if (status === 'indeterminate' || status === 'out-of-scope') {
    return (
      <div className="no-print rounded-xl border border-amber/50 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber">
        <p>{conclusion || '当前版本不解静不定 —— 不给数字结论。'}</p>
        {remedy ? <p className="mt-1 text-amber/90">怎么改：{remedy}</p> : null}
      </div>
    );
  }
  if (status === 'over') {
    return (
      <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
        超限 {Number.isFinite(ratio) ? ((ratio - 1) * 100).toFixed(1) : '—'}%
        <span className="ml-1 text-danger/80">{conclusion}</span>
      </div>
    );
  }
  return (
    <div className="no-print rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-[11px] leading-5 text-ok">
      {conclusion || '未超限'}
    </div>
  );
}

/**
 * 拒绝态的「结果」位：不印任何数字，只说明「这里本来就不该有数字」以及判据在哪看。
 * 静不定 / 机构的反力是**解不出来**的，印一组 0 或印个占位符都会被读成「算出来了」。
 */
function RefusedPanel() {
  return (
    <section className="rounded-xl border border-danger/40 bg-danger/5">
      <header className="border-b border-danger/30 px-3 py-2 text-[11px] text-danger">
        拒绝求解 · 不输出数值结论
      </header>
      <p className="px-3 py-2 text-[11px] leading-5 text-muted">
        本页按设计拒绝作答：内力与反力在这里不存在唯一解，所以结果位保持空白。
        判据（未知量数、约束矩阵秩、载荷可平衡性）在左侧步骤与「校验」表里逐条列出，可逐条复核。
      </p>
    </section>
  );
}

/**
 * W18-C 参数徽标：让用户一眼看出「这是不是我的题」。
 *  - URL 里没有覆盖 → 灰「默认参数」；
 *  - 有覆盖 → 青「本次参数 · L=3 a=3 P=12」，点开两列对照（题面给的 / 默认推的）；
 *  - 未在题面出现、仍取默认的参数，逐条标琥珀「默认值，未在题面出现」。
 * 数据源就是 URL 与参数表本身——参数链路以后再坏一次，用户也能当场看出来。
 */
function ParamBadge({
  params,
  values,
  queryKeys,
}: {
  params: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  queryKeys: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  if (params.length === 0) return null;
  const fromQuery = params.filter((param) => queryKeys.has(param.key));
  const fromDefault = params.filter((param) => !queryKeys.has(param.key));
  const show = (param: ParamSpec) => {
    const value = values[param.key];
    return `${param.key}=${Array.isArray(value) ? value.join('') : value}`;
  };
  return (
    <div data-testid="param-badge" className="no-print border-b border-line/60 bg-panel/60">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-1.5 text-[11px]">
        {fromQuery.length > 0 ? (
          <button
            type="button"
            data-testid="param-badge-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="rounded border border-cyan/50 bg-cyan/10 px-2 py-0.5 font-medium text-cyan hover:bg-cyan/20"
          >
            本次参数 · {fromQuery.map(show).join('  ')}
            <span aria-hidden="true" className="ml-1">{open ? '▲' : '▼'}</span>
          </button>
        ) : (
          <span data-testid="param-badge-default" className="rounded border border-line bg-bg px-2 py-0.5 text-faint">
            默认参数
          </span>
        )}
        {fromDefault.length > 0 ? (
          <span data-testid="param-badge-defaults" className="basis-full text-[10px] leading-5 text-amber">
            {fromDefault.map((param) => param.key).join(' · ')} · 默认值，未在题面出现
          </span>
        ) : null}
      </div>
      {open && fromQuery.length > 0 ? (
        <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-x-6 gap-y-1 px-4 pb-2 text-[11px] leading-5 sm:grid-cols-2">
          <div data-testid="param-badge-given">
            <p className="font-medium text-cyan">题面给的（来自 URL / 读题）</p>
            <ul className="mt-0.5 space-y-0.5">
              {fromQuery.map((param) => (
                <li key={param.key} className="text-ink">
                  {param.label}: {show(param)}
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="param-badge-inferred">
            <p className="font-medium text-muted">默认推的（题面没提）</p>
            {fromDefault.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {fromDefault.map((param) => (
                  <li key={param.key} className="text-amber">
                    {param.label}: {show(param)} · 默认值，未在题面出现
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-muted">题面把全部参数都给了。</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DataPanel({
  title,
  data,
  accent,
  className = '',
  testId,
}: {
  title: string;
  data: Record<string, number | string>;
  accent?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-xl border border-line bg-panel elev ${className}`}>
      <header className="border-b border-line px-3 py-2 text-[11px] text-muted">{title}</header>
      <dl className="divide-y divide-line/60">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 px-3 py-2 text-[11px]">
            <dt className="text-muted">{key}</dt>
            {/* 数字不换行（换行会把 1.000E−3 拆两行），文字值必须能折 —— 否则结论长句
                用 nowrap 直接把页面顶宽（M7 实测 1440 视口撑到 1458）。 */}
            <dd
              className={`min-w-0 max-w-[68%] text-right ${
                typeof value === 'number' ? 'whitespace-nowrap tabular-nums' : 'break-words'
              } ${accent ? 'text-cyan' : 'text-ink'}`}
            >
              {formatDisplayValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Result({ templateId, search, onBack, onToast, override }: ResultProps & { override?: Solution }) {
  /** R-37：切单位制后整页读数重算（formatScalar 默认档读全局偏好）。
   *  取值本身要给 resultData 的 memo 当依赖 —— 只订阅不用值，memo 不会失效，
   *  「读数体检」跟着变、「结果」表还是旧格式（2026-11-14 巡检 B3）。 */
  const unitMode = useSyncExternalStore(subscribeUnitMode, getUnitMode, () => getUnitMode());
  /** 从 #/scope 带过来的简化：三处留痕（顶部 amber 条 / assumptions / PDF）共用的数据源。 */
  const simpRaw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('simp') ?? '';
  const simplifications = parseSimplifications(simpRaw);
  const assumptions = assumptionLines(simplifications);
  const canLab = isLabSupported(templateId);
  /** R-38：装配台求解后会内嵌这整页讲解稿。此时外壳已有标题栏 / 参数实验场，
   *  这里必须降级成「讲解稿」小条，否则两个 sticky 标题 + 两份参数面板同屏。 */
  const embedded = Boolean(override);
  const routeInfo = getTemplateRoute(templateId);
  const entry = routeInfo?.entry ?? getTemplate(templateId);
  const variant = routeInfo?.variant;
  const displayId = variant?.id ?? entry.id;
  const displayTitle = variant?.title ?? entry.title;
  const params = entry.params ?? [];
  // 变体（如 M3 悬臂）自带默认参数，滑杆基线要用它；否则一开页滑杆值就和图对不上。
  const paramBaseline = variant?.params;
  const [solution, setSolution] = useState<Solution | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [solveMs, setSolveMs] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNotes, setLiveNotes] = useState<string[]>([]);
  /** W22-R P0-A：URL 里越界被拒的参数，红条点名（不许静默回默认不说话）。 */
  const [urlOutOfRange, setUrlOutOfRange] = useState<{ key: string; raw: string }[]>([]);

  const [stepIndex, setStepIndex] = useState(0);
  /** 黑盒 #27：步骤列的 <ol>，当前步自动滚到可视区。 */
  const stepListRef = useRef<HTMLOListElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlayerSpeed>(1);
  const [checksOpen, setChecksOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** R-37 复制解题步骤的格式菜单。 */
  const [stepsMenuOpen, setStepsMenuOpen] = useState(false);
  /** R-37 结果页 ↔ 知识库：随题型 / 求解结果变化，映射规则全在 kb/related.ts。 */
  const kbLinks = useMemo(
    () => kbLinksFor({
      templateId: displayId,
      subject: (entry as { subject?: string } | undefined)?.subject,
      bases: solution?.steps.map((step) => step.basis) ?? [],
    }),
    [displayId, entry, solution],
  );
  /** R-37 参数扫描：区间 / 采样数由学生填，曲线只吃 solver 现场算出的主答案。 */
  const [sweepKey, setSweepKey] = useState('');
  const [sweepMin, setSweepMin] = useState('');
  const [sweepMax, setSweepMax] = useState('');
  const [sweepCount, setSweepCount] = useState('21');
  const [sweepResult, setSweepResult] = useState<{
    chart: ChartSpec | null;
    extrema: { min: SweepExtremum; max: SweepExtremum } | null;
    skipped: number;
    points: SweepPoint[];
    answerKey: string;
    label: string;
    unit: string;
  } | null>(null);

  useEffect(() => {
    const first = (entry.params ?? []).find((param) => param.kind === 'number');
    setSweepKey(first?.key ?? '');
    setSweepMin(String(first?.min ?? 0));
    setSweepMax(String(first?.max ?? 1));
    setSweepResult(null);
  }, [entry.id]);
  /**
   * W21-B B2：浏览器在打印前后会派发 beforeprint / afterprint。这里把状态显式
   * 挂到根上，打印态只留打印稿（CSS 的 @media print 与 [data-printing] 双保险）；
   * 不如此则「导出 PDF」点下去屏幕层与打印稿会同时存在。
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const [wizardInfo, setWizardInfo] = useState<{ label: string; targetId?: string } | null>(null);

  const valuesRef = useRef<Record<string, ParamValue>>({});
  const solverRef = useRef<Solver | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setSolution(undefined);
    setStepIndex(0);
    setPlaying(false);
    setChecksOpen(false);
    setMenuOpen(false);
    setLiveError(null);
    setLiveNotes([]);
    setUrlOutOfRange([]);
    setSolveMs(null);
    solverRef.current = null;
    valuesRef.current = {};
    setValues({});
    Promise.all([
      getExample(templateId),
      entry.solver ? entry.solver() : Promise.resolve(null),
    ])
      .then(async ([loaded, solverModule]) => {
        if (!active) return;
        solverRef.current = solverModule?.default ?? null;
        // 装配台 override：solution 由归约 + 既有 solver 现场产出，直接用；参数表照常可改并实时重算
        if (override) {
          const parsed = parseParamQuery(entry.params ?? [], search, paramBaseline);
          valuesRef.current = { ...parsed.values, ...override.parsed_given };
          setValues(valuesRef.current);
          setUrlOutOfRange(parsed.outOfRange);
          setSolution(override);
          return;
        }
        const parsed = parseParamQuery(entry.params ?? [], search, paramBaseline);
        valuesRef.current = parsed.values;
        setValues(parsed.values);
        setUrlOutOfRange(parsed.outOfRange);
        if (parsed.corrected) {
          const simpQuery = simpRaw ? `simp=${encodeURIComponent(simpRaw)}` : '';
          const parts = [parsed.normalized, simpQuery].filter(Boolean).join('&');
          const normalizedHash = `#/t/${templateId}${parts ? `?${parts}` : ''}`;
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}${normalizedHash}`,
          );
        }
        const hasNonDefault =
          buildParamQuery(entry.params ?? [], parsed.values, paramBaseline).length > 0;
        if (
          loaded &&
          solverModule?.default &&
          hasNonDefault &&
          entry.id !== 'D1' &&
          entry.id !== 'D2' &&
          entry.id !== 'D3'
        ) {
          try {
            const input = buildSolverInput(entry, variant?.config, parsed.values);
            const base = solverModule.default(input);
            const live = await validateLive(entry, variant, base, input);
            if (!active) return;
            setSolution({
              ...base,
              confidence: live.confidence,
              validatedAt: new Date().toISOString(),
              contractVersion: CONTRACT_VERSION,
              warnings: base.warnings,
            });
            setLiveNotes(live.notes);
            return;
          } catch (error) {
            if (!active) return;
            // W22-R P0-A：live 求解失败 = 这组参数算不出来。宁可不出结果，
            // 也绝不把默认参数的黄金快照顶上来盖「已校验」的章。
            setLiveError(error instanceof Error ? error.message : String(error));
            setSolution(null);
            return;
          }
        }
        setSolution(loaded ?? null);
      })
      .catch(() => {
        if (active) setSolution(null);
      });
    return () => {
      active = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [templateId, entry, search, variant, override]);

  const schedule = (next: Record<string, ParamValue>) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (!solverRef.current) return;
    if (entry.id === 'D1' || entry.id === 'D2' || entry.id === 'D3') {
      setSolveMs(null);
      return;
    }
    // W22-R P0-E3：越界不夹取、不静默回退 —— 点名拒绝，红条给区间。
    const spec = entry.params ?? [];
    const bad = spec.find((param) => {
      if (param.kind === 'bits') return false;
      const value = Number(next[param.key]);
      if (!Number.isFinite(value)) return false;
      return (param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max);
    });
    if (bad) {
      const min = bad.min ?? '−∞';
      const max = bad.max ?? '+∞';
      setLiveError(`「${bad.label ?? bad.key}」= ${next[bad.key]} 超出合法区间 [${min}, ${max}]${bad.unit ? ` ${bad.unit}` : ''}，拒绝计算。改回区间内再看结果。`);
      setSolution(null);
      setSolveMs(null);
      return;
    }
    setLiveError(null);
    timerRef.current = window.setTimeout(async () => {
      const started = performance.now();
      try {
        const input = buildSolverInput(entry, variant?.config, next);
        const base = solverRef.current?.(input);
        if (!base) return;
        const live = await validateLive(entry, variant, base, input);
        const elapsed = performance.now() - started;
        setSolution({
          ...base,
          confidence: live.confidence,
          validatedAt: new Date().toISOString(),
          contractVersion: CONTRACT_VERSION,
          warnings: base.warnings,
        });
        setLiveNotes(live.notes);
        setLiveError(null);
        setSolveMs(elapsed);
      } catch (error) {
        // W22-R P0-A：实时重算失败同样清结果 —— 旧图残留在屏上等于用旧参数回答新题。
        setLiveError(error instanceof Error ? error.message : String(error));
        setSolution(null);
        setSolveMs(null);
      }
    }, 80);
  };

  const syncUrl = (next: Record<string, ParamValue>) => {
    const query = buildParamQuery(params, next, paramBaseline);
    const hash = `#/t/${templateId}${query ? `?${query}` : ''}`;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };

  const changeParam = (key: string, value: ParamValue) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    syncUrl(next);
    schedule(next);
  };

  const resetParam = (key: string) => {
    const param = params.find((item) => item.key === key);
    if (!param) return;
    const base = paramBaseline?.[key] ?? param.defaultValue;
    changeParam(key, cloneDefault(base));
  };

  const resetAll = () => {
    const next = defaultParamValues(params, paramBaseline);
    valuesRef.current = next;
    setValues(next);
    syncUrl(next);
    schedule(next);
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('solve-deck:wizard');
      setWizardInfo(raw ? (JSON.parse(raw) as { label: string; targetId?: string }) : null);
    } catch {
      setWizardInfo(null);
    }
  }, [templateId]);

  const stepCount = solution?.steps.length ?? 0;
  const canPlay = Boolean(solution && isFullyValidated(solution.confidence));

  useEffect(() => {
    if (!solution) return;
    if (stepIndex >= solution.steps.length) {
      setStepIndex(Math.max(0, solution.steps.length - 1));
    }
  }, [solution, stepIndex]);

  /** 黑盒 #27：当前步自动滚进步骤列可视区 —— 第 4/5 步不再被裁在折叠线外。 */
  useEffect(() => {
    const list = stepListRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-step="${stepIndex}"]`);
    active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stepIndex]);

  const liveSelection = useMemo(
    () => liveSelectionFor(entry.id, params, values, solution ?? null),
    [entry.id, params, values, solution],
  );
  const resultData = useMemo(
    () => (solution ? displayResult(entry.id, solution.result, entry.subject) : {}),
    // unitMode 必须进依赖：displayResult 里的 formatScalar 读的是当前偏好。
    [entry.id, solution, unitMode],
  );

  useEffect(() => {
    if (!playing || !solution) return;
    if (stepIndex >= solution.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStepIndex((current) => nextStep(current, solution.steps.length));
    }, stepDurationMs(speed));
    return () => window.clearTimeout(timer);
  }, [playing, stepIndex, speed, solution]);

  if (solution === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingPlate title="加载已校验快照" detail="取这一题的标准答案与图形…" />
      </div>
    );
  }

  if (!solution) {
    if (liveError) {
      // W22-R P0-A：参数被拒（区间外 / 求解器不收），绝不拿默认参数的答案顶上来。
      return (
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-line bg-panel/60">
            <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
              <button type="button" onClick={onBack} className="text-xs text-muted hover:text-cyan">
                ← 题库
              </button>
              <span className="text-sm text-cyan">{displayId}</span>
              <span className="truncate text-sm text-ink">{displayTitle}</span>
            </div>
          </header>
          <main className="mx-auto w-full max-w-3xl px-4 pb-44 pt-16">
            <div
              data-testid="param-error-banner"
              className="rounded-xl border border-danger/50 bg-danger/10 p-6"
            >
              <h2 className="text-lg text-danger">这组参数算不出来 —— 已拒绝出结果</h2>
              <p className="mt-2 text-sm leading-6 text-ink">{liveError}</p>
              <p className="mt-2 text-[12px] leading-5 text-muted">
                面板上的参数就是参与计算的参数；两边对不上时，这里宁可空白，也不会拿默认题的答案盖「已校验」的章。
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  data-testid="param-error-reset"
                  onClick={resetAll}
                  className="rounded-md bg-cyan px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  恢复默认参数重算
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-md border border-line px-4 py-2 text-xs text-ink hover:border-cyan/50 hover:text-cyan"
                >
                  返回题库
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-line bg-panel/60">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
            <button type="button" onClick={onBack} className="text-xs text-muted hover:text-cyan">
              ← 题库
            </button>
            <span className="text-sm text-cyan">{displayId}</span>
            <span className="truncate text-sm text-ink">{displayTitle}</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl px-4 pb-44 pt-16">
          <div className="rounded-xl border border-line bg-panel elev p-8 text-center">
            <h2 className="text-lg text-ink">施工中</h2>
            <p className="mt-2 text-sm text-muted">
              {displayId} 已登记 {entry.paths.length} 条校验路径，但还没有预置示例。
              当前只开放 D1–D6 / A1–A7 的只读预览。
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-6 rounded-md border border-line px-4 py-2 text-xs text-ink hover:border-cyan/50 hover:text-cyan"
            >
              返回题库
            </button>
          </div>
        </main>
      </div>
    );
  }

  const tone = confidenceTone(solution.confidence);
  const conclusionUnavailable =
    !solution.confidence.allPassed || solution.confidence.failedCount > 0;
  const a7Outside = entry.id === 'A7' && Number(solution.result.T) < 100;
  const teachingNotes = liveNotes.filter(
    (note) => !(a7Outside && note.includes('深度负反馈')),
  );
  const bitLabels = params.find((param) => param.kind === 'bits')?.bitLabels ?? [];
  /** 读数体检：只读 solution 的纯函数，未登记规则的题型返回 null（整块不出现）。 */
  const readouts = buildReadouts(solution);
  /* 读数头：设计稿的 h1 就是「答案本身」。所以把登记的答案键提到页首当主读数，
     其余给定值排成参数胶囊 —— 先看到结论，再往下看推导。 */
  const primaryAnswer = pickPrimaryAnswer(templateId, solution.result);
  /* P1：大字以前直接拼 `solution.result` 的键名和裸数字 —— A7 印出 `AfAnswer = 99.9`，
     M3 印出 `Mmax = 20`（没有 kN·m）。这里跟结果表用同一套键名表与量纲表。 */
  const primaryUnit = primaryAnswer
    ? unitsFor(templateId, entry.subject === 'analog' ? 'analog' : 'other')?.[primaryAnswer.key]
    : undefined;
  const primaryReading = primaryAnswer
    ? {
        key: primaryAnswer.key,
        label: RESULT_KEY_LABELS[primaryAnswer.key] ?? primaryAnswer.key,
        text: formatScalar(primaryAnswer.value, primaryUnit),
      }
    : null;
  /* P3：胶囊以前直接印 parsed_given 的原始键与 SI 值（`beta 100` / `Rc 2000`），
     同一页的读数区却写「Rc 2kΩ」—— 同一张纸两套口径。这里按 registry 的
     label / unit 翻一遍，再走同一个 formatScalar。 */
  const givenChips = Object.entries(solution.parsed_given)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .slice(0, 6)
    .map(([key, value]) => {
      const spec = (entry.params ?? []).find((one) => one.key === key);
      return {
        key,
        label: spec?.label ?? RESULT_KEY_LABELS[key] ?? key,
        text: formatScalar(value, spec?.unit),
      };
    });
  const syncLabel =
    entry.id === 'D1' ? '真值表行 / 卡诺图单元同步' : '真值表行 / 门级高亮同步';
  const selectStep = (index: number) => {
    setStepIndex(index);
    setPlaying(false);
  };
  const goPrev = () => {
    setStepIndex((current) => prevStep(current, stepCount));
    setPlaying(false);
  };
  const goNext = () => {
    setStepIndex((current) => nextStep(current, stepCount));
    setPlaying(false);
  };
  const togglePlay = () => {
    if (!canPlay) return;
    if (!playing && stepIndex >= stepCount - 1) setStepIndex(0);
    setPlaying((value) => !value);
  };
  const exportPdf = () => {
    setMenuOpen(false);
    // 打印态先于对话框生效；关掉对话框后立刻还原，不依赖 afterprint 是否派发。
    setPrinting(true);
    try {
      window.print();
    } finally {
      setPrinting(false);
    }
  };  const copyLink = async () => {
    const url = window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = url;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        area.remove();
      } catch {
        ok = false;
      }
    }
    setMenuOpen(false);
    onToast(ok ? '链接已复制（含当前参数）' : '复制失败，请手动复制地址栏');
  };
  /** R-37 步骤导出：按 copyText 的返回值说话，拒绝授权时不能谎报成功。 */
  const copySteps = async (format: 'latex' | 'markdown') => {
    setStepsMenuOpen(false);
    setMenuOpen(false);
    const steps = solution?.steps ?? [];
    if (steps.length === 0) {
      onToast('这道题还没有可复制的解题步骤');
      return;
    }
    const label = format === 'latex' ? 'LaTeX' : 'Markdown';
    const text = format === 'latex'
      ? stepsToLatex(displayTitle, steps)
      : stepsToMarkdown(displayTitle, steps);
    const ok = await copyText(text);
    onToast(ok ? `已复制 ${steps.length} 步（${label}）` : '复制失败，请手动选中页面内容');
  };

  /** R-37 参数扫描：逐点调已加载的 solver 取主答案，拒答 / 非数值如实跳过并计数。 */
  const runSweep = () => {
    const spec = params.find((param) => param.key === sweepKey && param.kind === 'number');
    const solver = solverRef.current;
    if (!solver || !spec) {
      onToast('这道题没有可扫描的数值参数');
      return;
    }
    const min = Number(sweepMin);
    const max = Number(sweepMax);
    const count = Number(sweepCount);
    const xs = sweepAxis(min, max, count, Boolean(spec.log));
    if (xs.length === 0) {
      onToast('扫描区间不合法：最大值要大于最小值');
      return;
    }
    if ((spec.min !== undefined && min < spec.min) || (spec.max !== undefined && max > spec.max)) {
      onToast(`扫描区间超出「${spec.label ?? spec.key}」的合法范围 [${spec.min ?? '−∞'}, ${spec.max ?? '+∞'}]`);
      return;
    }
    const points: SweepPoint[] = [];
    let skipped = 0;
    let answerKey = '';
    for (const x of xs) {
      try {
        const input = buildSolverInput(entry, variant?.config, { ...values, [sweepKey]: x });
        const base = solver(input);
        const primary = pickPrimaryAnswer(entry.id, base.result ?? {});
        const y = Number(primary?.value);
        if (!primary || !Number.isFinite(y)) {
          skipped += 1;
          continue;
        }
        answerKey = primary.key;
        points.push([x, y]);
      } catch {
        skipped += 1;
      }
    }
    const label = spec.label ?? spec.key;
    const unit = spec.unit ?? '';
    const chart = buildSweepChart({
      key: sweepKey,
      xLabel: `${label}${unit ? ` (${unit})` : ''}`,
      yLabel: answerKey || '主答案',
      unit,
      title: `${displayTitle} · ${label} 扫描`,
      points,
    });
    setSweepResult({ chart, extrema: sweepExtrema(points), skipped, points, answerKey, label, unit });
    if (points.length === 0) onToast('这个区间里没有可解的点（可能触发拒答或数值越界）');
  };

  /** 画布这一栏（结果页 / 装配台内嵌共用同一份内容）。 */
  const canvasPane = (
    <>
      <div className="no-print mb-2 flex items-center justify-between px-1 text-[11px] text-muted">
        <span>画布</span>
        <span>
          <span className="text-cyan">青</span> = 当前步
        </span>
      </div>
      {liveSelection ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-cyan/30 bg-cyan/5 px-2 py-1 text-[11px] text-cyan">
          <span className="tabular-nums">
            {bitLabels
              .map((label, index) => `${label}=${(values.bits as number[])?.[index] ?? 0}`)
              .join(' ')}
          </span>
          <span className="text-muted">→</span>
          <span className="tabular-nums">F={String(liveSelection.output ?? 'x')}</span>
          <span className="text-muted">（{syncLabel}）</span>
        </div>
      ) : null}
      <SpecGrid
        specs={solution.render_specs}
        stepIndex={stepIndex}
        liveSelection={liveSelection}
      />
    </>
  );

  const printTime = formatPrintTime(solution.validatedAt);
  const printMeta = `拆解台 · SolveDeck ｜ ${displayId} ｜ ${printTime}`;
  /** 刻意拒绝：静不定一律算；out-of-scope 只有在 solver 明确给了「怎么改」时才算反例页。 */
  const refused =
    solution.result.status === 'indeterminate' ||
    (solution.result.status === 'out-of-scope' && solution.result.remedy !== undefined);
  const rejection = variant?.rejection ?? '';
  /** R-38：理想模型题要把「图上没有电源也能求解」的前提说清楚。 */
  const caveat = solution ? modelCaveatFor(entry.id, solution.result) : null;

  /**
   * 表头右侧那组控制（自检 / 单位 / 复制步骤 / 手机 ⋯）。
   * 独立页走全站统一表头、嵌入讲解稿走窄条，两种表头用的是同一份控制簇。
   */
  const headerControls = (
    <>
      <span className="no-print hidden sm:inline-flex">
        <ConfidenceBadge
          report={solution.confidence}
          validatedAt={solution.validatedAt}
          contractVersion={solution.contractVersion}
          expanded={checksOpen}
          onToggle={() => setChecksOpen((value) => !value)}
        />
      </span>
      <button
        type="button"
        onClick={() => setChecksOpen((value) => !value)}
        className="no-print hidden rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-cyan/50 hover:text-cyan sm:inline-flex"
      >
        查看自检
      </button>
      <span className="no-print hidden sm:inline-flex">
        <UnitModeSelect testId="unit-mode-result" showScope />
      </span>
      <div className="no-print relative hidden sm:block">
        <button
          type="button"
          data-testid="copy-steps-toggle"
          aria-expanded={stepsMenuOpen}
          aria-label="复制解题步骤"
          onClick={() => setStepsMenuOpen((open) => !open)}
          className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-cyan/50 hover:text-cyan"
        >
          复制步骤 ▾
        </button>
        {stepsMenuOpen ? (
          <div
            data-testid="copy-steps-menu"
            className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-line bg-panel p-1 shadow-lg"
          >
            <button
              type="button"
              data-testid="copy-steps-latex"
              onClick={() => void copySteps('latex')}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
            >
              复制为 LaTeX
            </button>
            <button
              type="button"
              data-testid="copy-steps-markdown"
              onClick={() => void copySteps('markdown')}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
            >
              复制为 Markdown
            </button>
          </div>
        ) : null}
      </div>
      <div className="no-print relative sm:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-label="更多操作"
          className="rounded border border-line px-2 py-1 text-[13px] leading-none text-muted hover:border-cyan/50 hover:text-cyan"
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-line bg-panel p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setChecksOpen((value) => !value);
                setMenuOpen(false);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
            >
              查看自检
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
            >
              复制链接
            </button>
            <button
              type="button"
              data-testid="print-button"
              onClick={exportPdf}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-cyan hover:bg-ink/[0.04]"
            >
              打印 / 另存 PDF
            </button>
            <button
              type="button"
              data-testid="copy-steps-latex-mobile"
              onClick={() => void copySteps('latex')}
              className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
            >
              复制步骤（LaTeX）
            </button>
            {canLab && !embedded ? (
              <a
                href={`#/lab/t/${templateId}`}
                onClick={() => setMenuOpen(false)}
                className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-ink/[0.04]"
              >
                改结构 →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  /** 巡检 D7：打印页脚去掉内部路由 #/t/A1（像调试残留），题号 + 时间够定位了。 */
  const printMetaBlock = (
    <div className="print-only print-meta">
      <span>拆解台 · SolveDeck</span>
      <span>{displayId}</span>
      <span>{printTime}</span>
    </div>
  );

  return (
    <div className="result-page min-h-screen pb-24" data-embedded={embedded ? '1' : undefined} data-printing={printing ? '1' : undefined}>
      {embedded ? (
        /* 嵌进装配台右栏的窄条：不挂全站导航（下面整页都是这份讲解稿），只留题号与操作 */
        <header className="result-header no-print z-30 border-t border-line">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2">
            <span className="id-mono shrink-0 text-cyan">讲解稿</span>
            <h1 className="min-w-0 flex-1 truncate font-serif text-[13px] font-normal text-ink">分步推导与讲解</h1>
            {headerControls}
            <ThemeToggle />
            {printMetaBlock}
          </div>
        </header>
      ) : (
        /* 独立结果页：与首页同一条 60px 玻璃纸带 —— 品牌 / 当前页 / 全站导航 / 这一页的控制簇 */
        <SiteHeader
          page="result"
          z="z-30"
          width={1600}
          onBack={onBack}
          backLabel="题库"
          title={
            <>
              <span className="id-mono shrink-0 text-cyan">{displayId}</span>
              <h1 className="min-w-0 flex-1 truncate font-serif text-[13px] font-normal text-ink">{displayTitle}</h1>
              {headerControls}
              {printMetaBlock}
            </>
          }
        />
      )}

      {solution ? (
        <ParamBadge
          params={params}
          values={values}
          queryKeys={new Set(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).keys())}
        />
      ) : null}

      {caveat ? (
        <div data-testid="model-caveat" className="no-print border-b border-amber/50 bg-amber/10 px-4 py-2 text-[11px] leading-5 text-amber">
          <p>{caveat.title}</p>
          <p className="mt-0.5">{caveat.body}</p>
          {caveat.warning ? (
            <p className="mt-1 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-danger">{caveat.warning}</p>
          ) : null}
        </div>
      ) : null}

      {kbLinks.length > 0 ? (
        <details data-testid="kb-links" className="no-print border-b border-line bg-panel-2 px-4 py-2">
          <summary className="cursor-pointer text-[11px] text-muted">
            相关知识点 · {kbLinks.length} 条（点开看依据）
          </summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {kbLinks.map((link) => (
              <li key={link.id}>
                <a
                  data-testid="kb-link"
                  href={link.href}
                  className="block max-w-[280px] rounded-lg border border-line bg-panel px-2.5 py-1.5 hover:border-cyan/50"
                >
                  <span className="text-[11px] text-ink">{link.title}</span>
                  <span className="ml-1.5 text-[10px] text-cyan">{link.reason}</span>
                  <span className="block text-[10px] leading-4 text-faint">{link.oneLine}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {params.some((param) => param.kind === 'number') ? (
        <details data-testid="sweep-panel" className="no-print border-b border-line bg-panel-2 px-4 py-2">
          <summary className="cursor-pointer text-[11px] text-muted">
            参数扫描曲线 · 找极值 / 看趋势
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <label className="flex items-center gap-1">
              参数
              <select
                data-testid="sweep-key"
                aria-label="扫描参数"
                value={sweepKey}
                onChange={(event) => {
                  const key = event.target.value;
                  setSweepKey(key);
                  const next = params.find((param) => param.key === key);
                  setSweepMin(String(next?.min ?? 0));
                  setSweepMax(String(next?.max ?? 1));
                }}
                className="rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink"
              >
                {params.filter((param) => param.kind === 'number').map((param) => (
                  <option key={param.key} value={param.key}>{param.label ?? param.key}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              从
              <input data-testid="sweep-min" aria-label="扫描最小值" type="number" step="any" value={sweepMin} onChange={(event) => setSweepMin(event.target.value)} className="w-20 rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink" />
            </label>
            <label className="flex items-center gap-1">
              到
              <input data-testid="sweep-max" aria-label="扫描最大值" type="number" step="any" value={sweepMax} onChange={(event) => setSweepMax(event.target.value)} className="w-20 rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink" />
            </label>
            <label className="flex items-center gap-1">
              采样
              <input data-testid="sweep-count" aria-label="采样点数" type="number" min="2" max="81" value={sweepCount} onChange={(event) => setSweepCount(event.target.value)} className="w-14 rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-ink" />
            </label>
            <button
              type="button"
              data-testid="sweep-run"
              onClick={runSweep}
              className="focus-ring rounded border border-cyan/60 px-2 py-0.5 text-[11px] text-cyan hover:bg-cyan/10"
            >
              运行扫描
            </button>
            <span className="text-[10px] text-faint">纵轴取本题主答案，逐点现场求解；越界区间会被拒绝</span>
          </div>
          {sweepResult ? (
            <div data-testid="sweep-result" className="mt-2">
              {sweepResult.chart ? (
                <div className="overflow-x-auto"><Chart spec={sweepResult.chart} /></div>
              ) : (
                <p className="text-[11px] text-danger">有效点不足 2 个，画不出曲线（无解点已计入跳过数）。</p>
              )}
              {sweepResult.extrema ? (
                <p data-testid="sweep-extrema" className="mt-1 text-[11px] leading-5 text-ink">
                  最大 {sweepResult.answerKey} = {Number(sweepResult.extrema.max.y.toPrecision(4))}
                  {' '}@ {sweepResult.label} = {Number(sweepResult.extrema.max.x.toPrecision(4))}{sweepResult.unit}；
                  最小 = {Number(sweepResult.extrema.min.y.toPrecision(4))}
                  {' '}@ {Number(sweepResult.extrema.min.x.toPrecision(4))}{sweepResult.unit}
                  {sweepResult.skipped > 0 ? ` · 跳过 ${sweepResult.skipped} 个无解点` : ''}
                </p>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}

      {assumptions.length > 0 ? (
        <div className="print-assumption border-b border-amber/50 bg-amber/10 px-4 py-2 text-[11px] leading-5 text-amber">
          {assumptions.map((line) => (
            <p key={line}>· {line}</p>
          ))}
        </div>
      ) : null}

      {rejection ? (
        <div className="border-b border-danger/50 bg-danger/10 px-4 py-2 text-center text-[11px] leading-5 text-danger">
          反例：故意给一个{rejection}，按设计拒答，不给数值。
        </div>
      ) : null}

      {wizardInfo && (!wizardInfo.targetId || wizardInfo.targetId === templateId) ? (
        <div className="no-print border-b border-amber/40 bg-amber/10 px-4 py-2 text-center text-[11px] text-amber">
          按你的回答，这是{wizardInfo.label}；如果不对，
          <a href="#/wizard" className="ml-1 underline hover:text-cyan">
            点这里换组态
          </a>
          。
        </div>
      ) : null}

      {urlOutOfRange.length > 0 ? (
        <div
          data-testid="param-range-banner"
          className="no-print border-b border-amber/50 bg-amber/10 px-4 py-2 text-center text-[11px] leading-5 text-amber"
        >
          链接里的 {urlOutOfRange.map((item) => `${item.key}=${item.raw}`).join('、')} 超出合法区间，已改用默认值计算；
          左侧参数面板显示的就是参与计算的值。
        </div>
      ) : null}

      {/* 读数头：题型标签 → 主读数（这道题的答案）→ 参数胶囊。
          设计稿把「答案」放在 h1 的位置，推导全部往后排；这里只搬来这个层次，
          不动下方三步工作区。 */}
      <section data-testid="result-hero" className="mx-auto w-full max-w-[1600px] px-4 pt-7">
        <p className="kicker">
          {SUBJECT_LABEL[entry.subject] ?? entry.subject} · {entry.id}
        </p>
        <h2 className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] text-ink">
          {/* 题型名取到第一个冒号为止：整条标题是「组态 + 全部考点」，摆在大字旁边会把答案挤走。 */}
          <span className="text-[17px] font-normal text-muted">{displayTitle.split(/[:：]/)[0]}：</span>
          {primaryReading ? (
            <span className="text-amber">
              {primaryReading.label} = {primaryReading.text}
            </span>
          ) : null}
        </h2>
        {givenChips.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {givenChips.map((chip) => (
              <span
                key={chip.key}
                title={chip.key}
                className="rounded-full border border-line-2 bg-elev px-3 py-1.5 text-[12px] text-muted"
              >
                {chip.label} <b className="font-medium text-ink">{chip.text}</b>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* 断点：<1024 单栏堆叠；1024–1279 两栏（步骤 | 画布，数据栏整行落到下方两列）；
          ≥1280 才三栏 —— 1080 下强行三栏，两侧各 340 只剩 336 给画布，电路和公式全糊。 */}
      <div className="result-heavy result-grid mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 pb-32 pt-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,340px)]">
        <aside className="print-steps min-h-0">
          <section className="rounded-xl border border-line bg-panel elev lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-11rem)] lg:overflow-auto">
            <header className="no-print flex items-center justify-between border-b border-line px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-faint">
              <span>步骤 · {stepCount}</span>
              <span>{playing ? '播放中' : '已暂停'}</span>
            </header>
            <ol ref={stepListRef} className="flex flex-col gap-1.5 p-2">
              {solution.steps.map((step) => {
                const active = step.i === stepIndex;
                return (
                  <li key={step.i} data-step={step.i}>
                    <button
                      type="button"
                      onClick={() => selectStep(step.i)}
                      /* 当前步以前只靠 CSS 边框表示，读屏念不出来（巡检 P3）。 */
                      aria-current={active ? 'step' : undefined}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'step-active border-cyan/50 bg-cyan/5'
                          : 'border-transparent hover:border-line hover:bg-ink/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px] text-faint">
                        <span className="id-mono">第 {step.i + 1} 步</span>
                        <span className="truncate">{step.basis}</span>
                      </div>
                      <div className="mt-1.5 text-[13px] leading-[1.45] text-ink">{step.title}</div>
                      <Formula
                        tex={step.formula_tex}
                        className="mt-2 block overflow-x-auto overflow-y-hidden text-[13px]"
                      />
                      {active ? (
                        <div className="no-print mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
                          <p className="text-muted">代入：{step.substitution}</p>
                          <p className="text-cyan">{step.value}</p>
                        </div>
                      ) : null}
                      <div className="print-only mt-2 space-y-1 border-t border-line pt-2 text-[11px]">
                        <p className="text-muted">代入：{step.substitution}</p>
                        <p className="text-cyan">{step.value}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>

        {/*
          内嵌进装配台（embedded）时这层只能是 div：外层 <Lab> 已经是 <main>，
          两个 landmark 会让读屏的「跳到主内容」出现两个同名目标。
        */}
        {embedded ? (
          <div className="print-canvas min-w-0" data-testid="result-canvas">
            {canvasPane}
          </div>
        ) : (
          <main className="print-canvas min-w-0">
            {canvasPane}
          </main>
        )}

          <section className="print-confidence rounded-xl border border-line bg-panel elev lg:col-span-2">
            <header className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px]">
              {/* 巡检 A3：这份清单是「求解链路校核」，与物理恒等式核验（ΣFx=0 那张表）是两回事，
                  各自计数 —— 原来两份都叫「校验」且都是 8 项，用户看到「8 全过」与「6 过 2 跳」并存。 */}
              <span className="text-muted">求解链路校核</span>
              <span className={tone === 'gray' ? 'text-muted' : 'text-danger'}>
                {tone === 'gray' ? '未校验预览' : tone === 'green' ? '已校验' : '未通过'}
              </span>
            </header>
            <div className="space-y-2 p-3 text-[11px]">
              <p data-testid="confidence-counts" className="text-muted">
                通过 {solution.confidence.checks.length - solution.confidence.skippedCount - solution.confidence.failedCount} · 跳过{' '}
                {solution.confidence.skippedCount} · 未通过 {solution.confidence.failedCount} · 共 {solution.confidence.checks.length} 项
              </p>
              {/* W21-A A4：跳过的项单独一行，点开看是哪几项、为什么，不混进绿章。 */}
              {skippedChecks(solution.confidence).length > 0 ? (
                <details data-testid="skipped-details" className="no-print rounded border border-amber/40 bg-amber/5 px-2 py-1">
                  <summary className="cursor-pointer text-amber">
                    跳过 {skippedChecks(solution.confidence).length} 项
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {skippedChecks(solution.confidence).map((item) => (
                      <li key={item.name}>· {item.name}：{item.reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {/*
                W21-A A5：17 位裸浮点只在「自检」里给完整精度；validatedAt /
                contract 这类研发信息也移出主面板，不再压在教学结论旁边。
              */}
              <details data-testid="self-check" className="no-print rounded border border-line px-2 py-1">
                <summary className="cursor-pointer text-muted">完整精度 · 自检</summary>
                <dl className="mt-1 grid gap-0.5 font-mono text-[10px] leading-4 text-muted">
                  {Object.entries(solution.result).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt>{key}</dt>
                      <dd className="text-right">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">
                  validatedAt: {solution.validatedAt} · contract {solution.contractVersion}
                </p>
              </details>
              {checksOpen ? (
                <div className="no-print space-y-1.5">
                  {solution.confidence.checks.map((item) => (
                    <div key={item.name} className="rounded border border-line p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink" title={item.name}>
                          {CHECK_NAME_LABELS[item.name] ?? item.name}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATE_CLASS[item.state]}`}>
                          {CHECK_STATE_LABELS[item.state] ?? item.state}
                        </span>
                      </div>
                      <p className="mt-1 text-muted">{tidyCheckText(item.detail)}</p>
                      {item.skipReason ? (
                        <p className="mt-0.5 text-muted">跳过原因：{tidyCheckText(item.skipReason)}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setChecksOpen(true)}
                  className="no-print text-cyan hover:underline"
                >
                  {/* R-36：检查项是按 checks[] 实数计的（6 通过 + 2 跳过 = 8），
                      「六项」这个写死的数与徽标口径对不上 —— 改成动态计数。 */}
                  展开求解链路校核（共 {solution.confidence.checks.length} 项）
                </button>
              )}
              <div className="print-only space-y-1.5">
                {solution.confidence.checks.map((item) => (
                  <div key={`print-${item.name}`} className="rounded border border-line p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink" title={item.name}>
                        {CHECK_NAME_LABELS[item.name] ?? item.name}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATE_CLASS[item.state]}`}>
                        {CHECK_STATE_LABELS[item.state] ?? item.state}
                      </span>
                    </div>
                    <p className="mt-1 text-muted">{tidyCheckText(item.detail)}</p>
                    {item.skipReason ? (
                      <p className="mt-0.5 text-muted">跳过原因：{tidyCheckText(item.skipReason)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>

        <aside className="print-side flex min-w-0 flex-col gap-3 lg:col-span-2 xl:col-span-1 xl:flex xl:flex-col xl:items-stretch">
          <div className={`no-print hidden gap-2 sm:grid lg:col-span-2 ${canLab ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-xl border border-cyan/40 bg-panel px-2 py-2 text-xs text-cyan transition-colors hover:border-cyan/70"
            >
              复制链接
            </button>
            <button
              type="button"
              data-testid="print-button"
              onClick={exportPdf}
              className="rounded-xl border border-line bg-panel elev px-2 py-2 text-xs text-ink transition-colors hover:border-cyan/50 hover:text-cyan"
            >
              打印 / 另存 PDF
            </button>
            {canLab && !embedded ? (
              <a
                data-testid="go-lab"
                href={`#/lab/t/${templateId}`}
                className="rounded-xl border border-line bg-panel px-2 py-2 text-center text-xs text-muted transition-colors hover:border-cyan/50 hover:text-cyan"
              >
                改结构 →
              </a>
            ) : null}
          </div>
          {/* R-38：嵌入态不再挂第二份参数实验场 —— 装配台右栏那份才是唯一真相，
              两份同名面板既让人改错，又会被 override.parsed_given 反复盖回求解时的值。 */}
          {embedded ? (
            <p data-testid="embedded-param-note" className="no-print rounded-xl border border-line bg-panel-2 px-3 py-2 text-[11px] leading-5 text-muted">
              参数请在装配台右栏「确认已知量 / 参数实验场」修改；讲解稿用的就是那一份值，这里不再重复放一份面板。
            </p>
          ) : (
            <ParamPanel
              params={params}
              values={values}
              solveMs={solveMs}
              error={liveError}
              onChange={changeParam}
              onReset={resetParam}
              onResetAll={resetAll}
              title="参数实验场"
            />
          )}
          <div className="print-only print-given">
            <DataPanel
              title="已知量 parsed_given"
              data={humanizeGiven(entry.params ?? [], solution.parsed_given)}
            />
          </div>
          {a7Outside ? (
            <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
              回路增益 T={Number(solution.result.T).toFixed(1)} &lt; 100，超出深度负反馈近似域；
              结论位只给 AfLoop / AfMNA，不显示深度负反馈近似值。
            </div>
          ) : null}
          {entry.subject === 'mechanics' || entry.subject === 'statics' ? (
            <MechVerdict result={solution.result} />
          ) : null}
          {conclusionUnavailable ? (
            <div className="no-print rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-[11px] leading-5 text-danger">
              {rejection
                ? `反例页：${solution.confidence.failedCount} 项校验未通过。`
                : `结论不可用：${solution.confidence.failedCount} 项校验未通过。`}
            </div>
          ) : (
            <div data-testid="conclusion-banner" className="no-print rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-[11px] leading-5 text-ok">
              结论可用 · {confidenceSummary(solution.confidence)}
            </div>
          )}
          {teachingNotes.length > 0 ? (
            <ul className="no-print space-y-1 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] leading-5 text-amber">
              {teachingNotes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          ) : null}
          {refused ? <RefusedPanel /> : <DataPanel title="结果" data={resultData} accent className="print-result" testId="result-table" />}

          {/* 读数体检：紧贴结果表 —— 数字刚出现，就回答「这个数正常吗、近似值能不能用」。 */}
          {readouts ? <ReadoutPanel report={readouts} /> : null}

          {assumptions.length > 0 ? (
            <section className="print-assumptions rounded-xl border border-amber/50 bg-amber/10 p-3">
              <header className="border-b border-amber/30 pb-1 text-[11px] text-amber">
                前提与简化
              </header>
              <ul className="mt-1 space-y-1 text-[11px] leading-5 text-amber">
                {assumptions.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            </section>
          ) : null}


          {solution.warnings.length > 0 ? (
            <section className="print-warnings rounded-xl border border-line bg-panel elev">
              <header className="border-b border-line px-3 py-2 text-[11px] text-muted">
                提示
              </header>
              <ul className="space-y-1 p-3 text-[11px] leading-5 text-amber">
                {solution.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.id === 'M6' ? (
            <p className="px-1 text-[10px] leading-4 text-muted">
              本型无受力图（应力状态题只给莫尔圆与单元体）。
            </p>
          ) : null}

          <p className="no-print px-1 text-[10px] leading-4 text-muted">
            solver: {displayId}
          </p>
          <a
            href="#/about"
            className="no-print px-1 text-[10px] text-muted hover:text-cyan"
          >
            关于本工具
          </a>
        </aside>
      </div>

      <div className="print-only print-footer">{printMeta}</div>

      <StepPlayer
        stepIndex={stepIndex}
        stepCount={stepCount}
        playing={playing}
        speed={speed}
        disabled={!canPlay}
        summary={confidenceSummary(solution.confidence)}
        onToggle={togglePlay}
        onPrev={goPrev}
        onNext={goNext}
        onSpeed={() => setSpeed((current) => nextSpeed(current))}
        onSeek={selectStep}
      />
    </div>
  );
}