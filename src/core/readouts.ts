/**
 * 读数体检（readouts）—— 结果页的数字自己给自己做一次体检。
 *
 * 为什么要有这一层：求解器已经把「算得对」做到了（40 道门禁、三路径交叉），
 * 但学生拿到 -45.5 这个数还是会问「这正常吗」。两种回答都不够：
 *   - 只说「已校验」→ 那是校验器的可信度，不是这个数的物理合理性；
 *   - 只给一句「典型区间 20–200」→ 区间从哪来？凭什么是这个范围？
 *
 * 所以这里只放**能说清依据**的核对，分两种：
 *   1. strict：由定义或组态必然成立的关系（共射必反相、共集增益必小于 1、
 *      IE=IB+IC、W=Iy/(h/2)）。违反了就是矛盾，红点。
 *   2. typical：教学经验或一阶解析锚点（组态指纹、静态工作点居中、利用率）。
 *      偏了只是「不常见」，琥珀点，不是错误。
 * 外加一块**近似代价**：把「忽略 ro / 理想运放 / 深度负反馈」这类近似带来的
 * 实际偏差，连同它的一阶预期一起摆出来 —— 误差被解释过，才谈得上敢用。
 *
 * 硬边界：本文件只读 solution，不参与求解、不改 result、不影响 confidence 判定；
 * 没有登记规则的题型直接返回 null（界面整块不出现），绝不编造区间。
 */

import { formatScalar } from './format.ts';
import type { Solution } from './types.ts';

type Rec = Record<string, number | string>;

export interface Reading {
  label: string;
  /** 读数（带单位，已格式化）。 */
  value: string;
  /** 期望区间的写法，如「< 0」「0.2–12 V」「≈ 2.60 kΩ」。 */
  expect: string;
  kind: 'strict' | 'typical';
  ok: boolean;
  /** 依据：这条区间为什么成立、偏了意味着什么。 */
  note: string;
}

export interface ApproxRow {
  label: string;
  /** 参照值（含该近似之外的全部效应）。 */
  exact: string;
  /** 近似值。 */
  approx: string;
  /** 实测相对偏差，%。 */
  errorPct: number;
  /** 一阶预期偏差，%；一阶估计不适用时不给。 */
  expectPct?: number;
  ok: boolean;
  note: string;
}

export interface ReadoutReport {
  readings: Reading[];
  approximations: ApproxRow[];
}

/* ── 取值与判定小工具 ─────────────────────────────────────────────── */

interface Num {
  value: number;
  text: string;
  infinite: boolean;
}

/** 取一个数值读数；'∞' 与缺失/non-finite 分别处理，不给假零。 */
function pick(rec: Rec, key: string, unit?: string): Num | null {
  const raw = rec[key];
  if (raw === '∞') return { value: Number.POSITIVE_INFINITY, text: '∞', infinite: true };
  const value = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(value)) return null;
  // 无量纲量（增益、比值）多留一位：体检要能看出 -45.54 与 -45.53 的差别。
  const text = unit ? formatScalar(value, unit) : String(Number(value.toPrecision(4)));
  return { value, text, infinite: false };
}

/** 相对偏差；基准为 0 时退化为绝对判据。 */
function relDev(actual: number, base: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(base)) return Number.NaN;
  if (base === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs((actual - base) / base);
}

function pctText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0%';
  if (value < 0.01) return `${value.toExponential(2)}%`;
  return `${value.toFixed(value < 1 ? 2 : 1)}%`;
}

/**
 * 百分比的家庭写法：能写小数就不写科学计数法。
 * 「1.1e-3%」读者要在脑子里搬小数点，而 0.0011% 一眼就是个「小到可以忽略」。
 */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0%';
  if (value >= 1) return `${Number(value.toFixed(2))}%`;
  if (value >= 0.001) return `${Number(value.toFixed(4))}%`;
  return `${value.toExponential(1)}%`;
}

function strict(
  label: string,
  value: string,
  expect: string,
  ok: boolean,
  note: string,
): Reading {
  return { label, value, expect, kind: 'strict', ok, note };
}

function typical(
  label: string,
  value: string,
  expect: string,
  ok: boolean,
  note: string,
): Reading {
  return { label, value, expect, kind: 'typical', ok, note };
}

/**
 * 近似行；参照值为 0 或非有限时不出这一行（没有分母就没有偏差可言）。
 *
 * 两个条件都得满足才叫「这个近似还能用」：
 *   ① 偏差没超出一阶预期（×1.5）—— 误差被解释清楚了；
 *   ② 偏差本身不超过 bandPct    —— 解释得清 ≠ 小到能用。T=1 时 1/β 的误差
 *      恰好等于 1/T=101%，一阶预期完全对得上，可这个近似已经废了。
 */
function approx(
  label: string,
  exact: number,
  approxValue: number,
  note: string,
  expectPct?: number,
  bandPct = 5,
): ApproxRow | null {
  if (!Number.isFinite(exact) || exact === 0 || !Number.isFinite(approxValue)) return null;
  const errorPct = relDev(approxValue, exact) * 100;
  const hasExpect = expectPct !== undefined && Number.isFinite(expectPct) && expectPct > 0;
  const ok = errorPct <= bandPct && (!hasExpect || errorPct <= expectPct * 1.5 + 1e-12);
  // 6 位有效数字起步：忽略 ro 之后两值常只差第 4 位，截到 3 位就变成「-10 对 -10」看不出差别。
  const digits = (value: number) => String(Number(value.toPrecision(6)));
  return {
    label,
    exact: digits(exact),
    approx: digits(approxValue),
    errorPct,
    ...(hasExpect ? { expectPct } : {}),
    ok,
    note,
  };
}

/* ── 组态指纹：一阶锚点，偏差本身也是信息 ─────────────────────────── */

/**
 * 判「落在锚点附近」。锚点是一阶解析式，ro 变大或参数走到边界时会偏，
 * 所以宽带（默认 ±20%）只用来提示，不作判据。
 */
function nearAnchor(actual: number, anchor: number, band = 0.2): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(anchor)) return true;
  if (anchor === 0) return Math.abs(actual) <= 1e-12;
  return relDev(actual, anchor) <= band;
}

/** MOS 工作区的电压判据写法（A4 用）。 */
function saturatesLabel(saturated: boolean): string {
  return saturated ? '饱和（VDS ≥ VOV）' : '三极管区（VDS < VOV）';
}

/* ── A1 二极管 ───────────────────────────────────────────────────── */

function readoutsA1(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const vout = pick(result, 'Vout', 'V');
  const current = pick(result, 'I', 'A');
  const on = String(result.on) === '是' || result.on === 1;
  const zener = given.mode === 'zener';
  const knee = pick(given, zener ? 'Vz' : 'Vf', 'V');
  const rz = pick(given, 'Rz', 'Ω');

  if (current) {
    readings.push(
      strict(
        on ? '导通电流方向' : '截止电流',
        current.text,
        on ? '> 0（与假定的导通方向一致）' : '= 0',
        on ? current.value > 0 : Math.abs(current.value) < 1e-12,
        on
          ? '按导通假设计算，电流若为负说明二极管其实该截止 —— 假设与结果自相矛盾。'
          : '电源电压未越过导通门限，回路无电流，输出被钳在电源电压上。',
      ),
    );
  }

  if (vout && knee && current && rz && on) {
    const modelled = knee.value + current.value * rz.value;
    readings.push(
      strict(
        zener ? '稳压值 = Vz + I·Rz' : '导通压降 = Vf + I·Rz',
        vout.text,
        `= ${formatScalar(Number(modelled.toPrecision(6)), 'V')}`,
        relDev(vout.value, modelled) < 1e-9,
        '分段线性模型：膝点电压串上动态电阻 Rz，输出电压必须正好落在这条直线上。',
      ),
    );
  }

  if (current && !current.infinite) {
    const milli = Math.abs(current.value) * 1e3;
    const inBand = !on ? milli < 1e-9 : milli >= 0.5 && milli <= 20;
    readings.push(
      typical(
        '工作电流量级',
        `${Number(milli.toPrecision(3))} mA`,
        '0.5–20 mA',
        inBand,
        '毫安级是二极管/稳压管的常规工作区间：太小易受漏电流与温漂影响，太大超过额定功耗。',
      ),
    );
  }

  return { readings, approximations: [] };
}

/* ── A2 BJT 直流工作点 ───────────────────────────────────────────── */

function readoutsA2(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const ib = pick(result, 'IB', 'A');
  const ic = pick(result, 'IC', 'A');
  const ie = pick(result, 'IE', 'A');
  const vce = pick(result, 'VCE', 'V');
  const vcc = pick(given, 'Vcc', 'V');
  const vceSat = pick(given, 'VCEsat', 'V');
  const beta = pick(given, 'beta');
  const zone = String(result.zone ?? '');

  if (ib && ic && ie) {
    readings.push(
      strict(
        'IE = IB + IC',
        ie.text,
        `= ${formatScalar(Number((ib.value + ic.value).toPrecision(6)), 'A')}`,
        relDev(ie.value, ib.value + ic.value) < 1e-9,
        'KCL 在晶体管三个端子上的直接形式；三者对不上说明工作区判定与电流分配不在同一套假设里。',
      ),
    );
  }

  if (ib && ic && beta && ib.value > 0) {
    const active = zone === 'active';
    const ratio = ic.value / ib.value;
    readings.push(
      strict(
        'IC / IB',
        `${Number(ratio.toPrecision(4))}`,
        active ? `= β = ${beta.value}` : `< β = ${beta.value}`,
        active ? relDev(ratio, beta.value) < 1e-9 : ratio < beta.value,
        active
          ? '放大区里集电结反偏，IC 只由 IB 与 β 决定 —— 这一条成立，才谈得上「β 决定电流」。'
          : '饱和区里集电结正偏，集电极「抢不走」β·IB 那么多电流，实际 IC 必然小于 β·IB。',
      ),
    );
  }

  if (vce && vcc) {
    const low = vceSat ? vceSat.value : 0.2;
    const inWindow = vce.value > low && vce.value < vcc.value;
    readings.push(
      strict(
        'VCE 与工作区一致性',
        vce.text,
        zone === 'active' ? `∈ (${low}, ${vcc.value}) V` : zone === 'saturation' ? `≤ ${low} V` : `= ${vcc.value} V`,
        zone === 'active' ? inWindow : true,
        zone === 'active'
          ? '放大区要求集电结反偏，即 VCE 必须高于饱和压降、又低于电源电压；越界就不是放大区。'
          : `当前判定为 ${zone || '非放大区'}，VCE 与之一致，不按放大区窗口核对。`,
      ),
    );
  }

  if (vce && vcc && vcc.value > 0) {
    const share = (vce.value / vcc.value) * 100;
    readings.push(
      typical(
        '静态工作点位置',
        `${Number(share.toPrecision(3))}% Vcc`,
        '33%–67% Vcc',
        share >= 33 && share <= 67,
        '工作点落在电源电压中段时，输出上下摆幅都不先被削顶；太靠边就一定有一侧先饱和。',
      ),
    );
  }

  return { readings, approximations: [] };
}

/* ── A3 BJT 小信号 ───────────────────────────────────────────────── */

const A3_SIGN: Record<string, { expect: string; note: string; sign: 1 | -1 }> = {
  CE: {
    expect: '< 0（反相）',
    note: '共射：集电极电流随 vbe 增大而增大，集电极电压反而下降，所以输出与输入反相。',
    sign: -1,
  },
  CB: {
    expect: '> 0（同相）',
    note: '共基：输入在发射极、输出在集电极，电流从 e 进 c 出，电压同相。',
    sign: 1,
  },
  CC: {
    expect: '> 0（同相）',
    note: '共集（射极跟随）：输出在发射极电阻上，电压跟着输入走，既不反相，也不可能被放大。',
    sign: 1,
  },
};

function readoutsA3(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const approximations: ApproxRow[] = [];
  const config = String(result.config ?? given.config ?? 'CE');
  const signSpec = A3_SIGN[config] ?? A3_SIGN.CE;

  const gm = pick(result, 'gm', 'S');
  const rpi = pick(result, 'rpi', 'Ω');
  const ro = pick(result, 'ro', 'Ω');
  const rc = pick(given, 'Rc', 'Ω');
  const rl = pick(given, 'Rl', 'Ω');
  const re = pick(given, 'Re', 'Ω');
  const rs = pick(given, 'Rs', 'Ω');
  const beta = pick(given, 'beta');
  const av = pick(result, 'Av');
  const ri = pick(result, 'Ri', 'Ω');
  const roOut = pick(result, 'Ro', 'Ω');

  if (av) {
    const signed = signSpec.sign < 0 ? av.value < 0 : av.value > 0;
    readings.push(
      strict('增益极性', av.text, signSpec.expect, signed, signSpec.note),
    );

    if (config === 'CC') {
      readings.push(
        strict(
          '跟随器增益上限',
          av.text,
          '|Av| < 1',
          Math.abs(av.value) < 1,
          '共集组态没有电压放大能力（电流放大才是它的用途）；|Av| ≥ 1 说明模型或组态判断有误。',
        ),
      );
    }

    if (config === 'CE' && gm && rc && rl && ro) {
      const parallel = 1 / (1 / rc.value + 1 / rl.value + 1 / ro.value);
      const bound = gm.value * parallel;
      readings.push(
        strict(
          '增益上限 gm·(Rc∥RL∥ro)',
          av.text,
          `|Av| ≤ ${Number(bound.toPrecision(4))}`,
          Math.abs(av.value) <= bound * (1 + 1e-9),
          '增益不可能超过「跨导 × 集电极总负载」：源电阻还会再分掉 rπ/(Rs+rπ) 这一份，所以实际必然更小。',
        ),
      );
    }
  }

  // 组态指纹：输入/输出阻抗是哪一档，是判断「有没有认错组态」最直接的证据。
  if (ri && rpi && beta) {
    let anchor = Number.NaN;
    let expr = '';
    if (config === 'CE') {
      anchor = rpi.value;
      expr = 'rπ';
    } else if (config === 'CB') {
      anchor = rpi.value / (beta.value + 1);
      expr = 'rπ/(β+1)';
    } else if (config === 'CC' && re && rl) {
      anchor = rpi.value + (beta.value + 1) * (1 / (1 / re.value + 1 / rl.value));
      expr = 'rπ+(β+1)(Re∥RL)';
    }
    if (Number.isFinite(anchor)) {
      readings.push(
        typical(
          '输入电阻指纹',
          ri.infinite ? '∞' : ri.text,
          `≈ ${formatScalar(Number(anchor.toPrecision(4)), 'Ω')}（${expr}）`,
          ri.infinite ? false : nearAnchor(ri.value, anchor),
          `组态指纹：${config} 的输入电阻一阶等于 ${expr}。偏出一档以上，先怀疑组态或 β 抄错，而不是先怀疑求解。`,
        ),
      );
    }
  }

  if (roOut && rc && ro) {
    let anchor = Number.NaN;
    let expr = '';
    if (config === 'CE') {
      anchor = 1 / (1 / rc.value + 1 / ro.value);
      expr = 'Rc∥ro';
    } else if (config === 'CB') {
      anchor = rc.value;
      expr = 'Rc';
    } else if (config === 'CC' && rs && rpi && beta && re) {
      // 共集：从射极看进去 = [(Rs+rπ)/(β+1)] ∥ Re
      const fromBase = (rs.value + rpi.value) / (beta.value + 1);
      anchor = 1 / (1 / fromBase + 1 / re.value);
      expr = '(Rs+rπ)/(β+1) ∥ Re';
    }
    if (Number.isFinite(anchor)) {
      readings.push(
        typical(
          '输出电阻指纹',
          roOut.infinite ? '∞' : roOut.text,
          `≈ ${formatScalar(Number(anchor.toPrecision(4)), 'Ω')}（${expr}）`,
          roOut.infinite ? false : nearAnchor(roOut.value, anchor),
          `组态指纹：${config} 的输出电阻一阶等于 ${expr}。共射「从集电极看进去」、共集「从射极看进去」差别就在这里。`,
        ),
      );
    }
  }

  const avNoRo = pick(result, 'AvNoRo');
  if (av && avNoRo && rc && rl && ro) {
    const parallel = 1 / (1 / rc.value + 1 / rl.value);
    /* 一阶预期 (Rc∥RL)/ro 只在共射成立。共基里 ro 同时抬高 Ri、压低 k，两个方向
       几乎抵消（实测 0.06% vs 预期 1.67%，差三十倍），共集更不适用 —— 宁可不给，
       也不给一条对不上的「预期」（2026-11-14 巡检 D3）。 */
    const expectPct = config === 'CE' ? (parallel / ro.value) * 100 : undefined;
    const row = approx(
      '忽略 ro（教材常用近似）',
      av.value,
      avNoRo.value,
      expectPct === undefined
        ? '本组态里 ro 同时影响增益与输入电阻，两个方向相互抵消，没有一条干净的一阶预期可给 —— 直接看实测偏差。'
        : `误差主要来自集电极负载与 ro 的分流，一阶约 (Rc∥RL)/ro = ${pctText(expectPct)}；ro 比负载大一个数量级以上时，这个近似才敢用。`,
      expectPct,
    );
    if (row) approximations.push(row);
  }

  return { readings, approximations };
}

/* ── A4 MOS 工作区 ───────────────────────────────────────────────── */

function readoutsA4(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const vgs = pick(result, 'VGS', 'V');
  const vds = pick(result, 'VDS', 'V');
  const vov = pick(result, 'VOV', 'V');
  const id = pick(result, 'ID', 'A');
  const vth = pick(given, 'Vth', 'V');
  const kn = pick(given, 'Kn', 'A/V²');
  const lambda = pick(given, 'lambda', '1/V');
  const zone = String(result.zone ?? '');

  if (vgs && vth && vov) {
    readings.push(
      strict(
        'VOV = VGS − Vth',
        vov.text,
        `= ${formatScalar(Number((vgs.value - vth.value).toPrecision(6)), 'V')}`,
        relDev(vov.value, vgs.value - vth.value) < 1e-9,
        '过驱动电压的定义式；它决定沟道「有多强」，后面所有电流公式都建在它上面。',
      ),
    );
  }

  if (vds && vov && vov.value > 0) {
    const saturated = vds.value >= vov.value * (1 - 1e-9);
    const zoneAgrees =
      zone === 'saturation' ? saturated : zone === 'triode' ? !saturated : zone === 'cutoff' ? vov.value <= 1e-12 : true;
    readings.push(
      strict(
        '工作区与电压自洽',
        `${vds.text} / VOV ${vov.text}`,
        saturatesLabel(saturated),
        zoneAgrees,
        '沟道在漏端被夹断才叫饱和（恒流区）：VDS ≥ VOV 是它的电压形式。判定为饱和却给出 VDS < VOV，就是标签与数字打架。',
      ),
    );
  }

  // 平方律只在饱和区成立；三极管区的电流关系不同，不能拿同一条式子去核对。
  if (id && vov && kn && zone === 'saturation') {
    const lam = lambda ? lambda.value : 0;
    const modelled =
      0.5 * kn.value * vov.value * vov.value * (1 + (vds ? lam * vds.value : 0));
    readings.push(
      strict(
        'ID = ½Kn·VOV²(1+λVDS)',
        id.text,
        `= ${formatScalar(Number(modelled.toPrecision(6)), 'A')}`,
        relDev(id.value, modelled) < 1e-6,
        '平方律加沟道长度调制；这一条对不上，说明工作区判定用了一套式、电流又用了另一套。',
      ),
    );
  }

  if (vov) {
    readings.push(
      typical(
        '过驱动电压',
        vov.text,
        '0.1–0.3 V 常见',
        vov.value >= 0.1 && vov.value <= 0.3,
        '现代工艺常把 VOV 取在 0.1–0.3 V：小了速度与匹配变差，大了摆幅被吃掉。偏出这个范围不一定是错，是设计取向不同。',
      ),
    );
  }

  return { readings, approximations: [] };
}

/* ── A5 MOS 小信号 ───────────────────────────────────────────────── */

function readoutsA5(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const approximations: ApproxRow[] = [];
  const config = String(result.config ?? given.config ?? 'CS');
  const gm = pick(result, 'gm', 'S') ?? pick(given, 'gm', 'S');
  const ro = pick(given, 'ro', 'Ω');
  const rd = pick(given, 'Rd', 'Ω');
  const rl = pick(given, 'Rl', 'Ω');
  const rss = pick(given, 'Rss', 'Ω');
  const av = pick(result, 'Av');
  const ri = pick(result, 'Ri', 'Ω');
  const roOut = pick(result, 'Ro', 'Ω');

  const signSpec =
    config === 'CS'
      ? { expect: '< 0（反相）', note: '共源：栅压升高 → 漏极电流增大 → 漏极电压下降，输出与输入反相。', sign: -1 as const }
      : config === 'CG'
        ? { expect: '> 0（同相）', note: '共栅：信号从源极进、漏极出，电流方向一致，电压同相。', sign: 1 as const }
        : { expect: '> 0（同相）', note: '共漏（源极跟随）：输出取自源极，同相且增益永远小于 1。', sign: 1 as const };

  if (av) {
    readings.push(
      strict('增益极性', av.text, signSpec.expect, signSpec.sign < 0 ? av.value < 0 : av.value > 0, signSpec.note),
    );
    if (config === 'CD') {
      readings.push(
        strict('跟随器增益上限', av.text, '|Av| < 1', Math.abs(av.value) < 1, '源极跟随器没有电压增益；|Av| ≥ 1 说明体效应/负载算错或组态判断有误。'),
      );
    }
    // 共源：栅极不取电流，增益就是跨导乘负载，没有分压项 —— 所以这是一条贴边的上界。
    if (config === 'CS' && gm && rd && ro) {
      const parallel = 1 / (1 / rd.value + (rl ? 1 / rl.value : 0) + 1 / ro.value);
      const bound = gm.value * parallel;
      readings.push(
        strict(
          '增益上限 gm·(Rd∥RL∥ro)',
          av.text,
          `|Av| ≤ ${Number(bound.toPrecision(4))}`,
          Math.abs(av.value) <= bound * (1 + 1e-9),
          '栅极绝缘、不取电流，所以没有 BJT 那个 rπ/(Rs+rπ) 分压项：增益贴在这个上界上。',
        ),
      );
    }
  }

  // 指纹：输入电阻与输出电阻是分辨三种组态最直接的两把尺子。
  if (ri) {
    const cgAnchor = gm ? 1 / gm.value : Number.NaN;
    readings.push(
      typical(
        '输入电阻指纹',
        ri.infinite ? '∞' : ri.text,
        config === 'CG'
          ? Number.isFinite(cgAnchor)
            ? `≈ 1/gm = ${formatScalar(Number(cgAnchor.toPrecision(4)), 'Ω')}`
            : '≈ 1/gm'
          : '≈ ∞（栅极无电流）',
        config === 'CG' ? Number.isFinite(cgAnchor) && nearAnchor(ri.value, cgAnchor, 0.5) : ri.infinite,
        config === 'CG'
          ? '共栅的输入落在源极，看到的是沟道电阻 1/gm，所以输入电阻天然很低 —— 这是它唯一不如共源的地方。'
          : 'MOS 栅极是绝缘的，低频下输入电流为零，输入电阻趋于无穷 —— 这是它相对 BJT 的核心优势。',
      ),
    );
  }

  if (roOut) {
    let anchor = Number.NaN;
    let expr = '';
    if (config === 'CS' && rd && ro) {
      anchor = 1 / (1 / rd.value + 1 / ro.value);
      expr = 'Rd∥ro';
    } else if (config === 'CG' && rd) {
      anchor = rd.value;
      expr = 'Rd';
    } else if (config === 'CD' && gm && rss) {
      anchor = 1 / (1 / (1 / gm.value) + 1 / rss.value);
      expr = '(1/gm)∥Rss';
    }
    if (Number.isFinite(anchor)) {
      readings.push(
        typical(
          '输出电阻指纹',
          roOut.infinite ? '∞' : roOut.text,
          `≈ ${formatScalar(Number(anchor.toPrecision(4)), 'Ω')}（${expr}）`,
          roOut.infinite ? false : nearAnchor(roOut.value, anchor),
          `组态指纹：${config} 从输出端看进去是 ${expr}；共漏的输出电阻被 1/gm 压到很低，这正是它适合做缓冲的原因。`,
        ),
      );
    }
  }

  const avNoRo = pick(result, 'AvNoRo');
  if (av && avNoRo && rd && ro) {
    const expectPct = ((1 / (1 / rd.value + (rl ? 1 / rl.value : 0))) / ro.value) * 100;
    const row = approx(
      '忽略 ro（教材常用近似）',
      av.value,
      avNoRo.value,
      `ro 与漏极负载并联分流，一阶误差约 (Rd∥RL)/ro = ${pctText(expectPct)}；本设计里 ro 通常在百 kΩ 量级，所以误差往往小到看不出来。`,
      expectPct,
    );
    if (row) approximations.push(row);
  }

  return { readings, approximations };
}

/* ── A6 理想运放 ─────────────────────────────────────────────────── */

function readoutsA6(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const approximations: ApproxRow[] = [];
  const topology = String(result.topology ?? given.topology ?? 'inverting');
  const ideal = pick(result, 'AvIdeal');
  const finite = pick(result, 'AvFinite');
  const r1 = pick(given, 'R1', 'Ω');
  const r2 = pick(given, 'R2', 'Ω');
  const aol = pick(given, 'Aol');

  if (ideal) {
    const inverting = topology === 'inverting';
    readings.push(
      strict(
        '理想增益极性与量值',
        ideal.text,
        inverting ? '= −R2/R1（反相）' : '= 1+R2/R1（同相）',
        r1 && r2
          ? relDev(ideal.value, inverting ? -r2.value / r1.value : 1 + r2.value / r1.value) < 1e-9
          : true,
        inverting
          ? '反相组态：虚短使反相端为 0 V，输入电流全部流过 R2，故 Av = −R2/R1。'
          : '同相组态：反馈分压使反相端跟随输入，闭环增益是 1 + R2/R1，不会小于 1。',
      ),
    );
  }

  if (ideal && finite) {
    readings.push(
      strict(
        '有限增益只会削小增益',
        finite.text,
        `|Av| ≤ |${ideal.text}|`,
        Math.abs(finite.value) <= Math.abs(ideal.value) * (1 + 1e-12),
        '开环增益有限 ⇒ 虚短不再严格成立 ⇒ 闭环增益总是略小于理想值，且永远同号。放大超过理想值必然是算错。',
      ),
    );
  }

  if (ideal && finite && r1 && r2 && aol) {
    const noiseGain = 1 + r2.value / r1.value;
    const expectPct = (noiseGain / aol.value) * 100;
    const row = approx(
      '理想运放假设（Aol 有限）',
      ideal.value,
      finite.value,
      `闭环误差约等于噪声增益除以开环增益：(1+R2/R1)/Aol = ${pctText(expectPct)}。Aol 越大，虚短越像真的。`,
      expectPct,
      2,
    );
    if (row) approximations.push(row);
  }

  return { readings, approximations };
}

/* ── A7 反馈 ─────────────────────────────────────────────────────── */

function readoutsA7(given: Rec, result: Rec): ReadoutReport {
  const readings: Reading[] = [];
  const approximations: ApproxRow[] = [];
  const beta = pick(given, 'beta');
  const t = pick(result, 'T');
  const af = pick(result, 'AfAnswer');
  const afDeep = pick(result, 'AfDeep');

  if (beta && af) {
    const ceiling = 1 / beta.value;
    readings.push(
      strict(
        '闭环增益不超过 1/β',
        af.text,
        `≤ ${formatScalar(Number(ceiling.toPrecision(6)))}`,
        Math.abs(af.value) <= Math.abs(ceiling) * (1 + 1e-12),
        '负反馈把增益压低到 1/β 附近，且永远从下方逼近；超过 1/β 意味着反馈极性或 β 取值有误。',
      ),
    );
  }

  if (t) {
    readings.push(
      typical(
        '环路增益 T',
        t.text,
        '≥ 100（深度负反馈）',
        t.value >= 100,
        '只有 T 足够大，1/β 这个近似才站得住；T 在 10 附近时近似误差会到 10%，必须用闭环式。',
      ),
    );
  }

  // 深度负反馈的近似域是 T ≥ 100（误差 ≤ 1/T ≤ 1%）；T 掉出这个域时结果页
  // 本来就把近似值藏起来不给结论，这里跟着不给，别一边说不显示一边又列出来。
  if (af && afDeep && t && t.value >= 100) {
    const expectPct = (1 / t.value) * 100;
    const row = approx(
      '深度负反馈近似 Af ≈ 1/β',
      af.value,
      afDeep.value,
      `误差一阶等于 1/T = ${pctText(expectPct)}；这正是「T 越大越准」的量化形式，也是判断能不能用 1/β 的唯一依据。`,
      expectPct,
      1,
    );
    if (row) approximations.push(row);
  }

  return { readings, approximations };
}

/* ── 登记表 ─────────────────────────────────────────────────────── */

type Builder = (given: Rec, result: Rec) => ReadoutReport;

const BUILDERS: Record<string, Builder> = {
  A1: readoutsA1,
  A2: readoutsA2,
  A3: readoutsA3,
  A4: readoutsA4,
  A5: readoutsA5,
  A6: readoutsA6,
  A7: readoutsA7,
};

/** 已登记体检规则的题型（门禁用它核对覆盖面，避免悄悄漏掉一型）。 */
export const READOUT_TEMPLATES: readonly string[] = Object.keys(BUILDERS);

/**
 * 造一份读数体检报告；没有登记规则的题型返回 null（界面整块不渲染）。
 * 纯函数，只读 solution。
 */
export function buildReadouts(solution: Solution): ReadoutReport | null {
  const builder = BUILDERS[solution.templateId];
  if (!builder) return null;
  let report: ReadoutReport;
  try {
    report = builder(solution.parsed_given, solution.result);
  } catch {
    // 体检是附加信息，任何异常都不许把结果页拖垮。
    return null;
  }
  if (report.readings.length === 0 && report.approximations.length === 0) return null;
  return report;
}

/**
 * 一句话摘要。只报「查了几项、偏了几处」，好坏由标题颜色表达 ——
 * 「5 项读数一致」这种写法会把近似代价也算进「读数」，反而不准。
 */
export function readoutSummary(report: ReadoutReport): string {
  const parts = [`${report.readings.length} 项核对`];
  if (report.approximations.length > 0) parts.push(`${report.approximations.length} 项近似`);
  const off =
    report.readings.filter((item) => !item.ok).length +
    report.approximations.filter((item) => !item.ok).length;
  if (off > 0) parts.push(`${off} 处偏离`);
  return parts.join(' · ');
}
