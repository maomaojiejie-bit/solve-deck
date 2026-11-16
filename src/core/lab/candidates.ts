/**
 * 「换三种接法 / 换三种结构」候选表（W10-B 任务 3）。
 *
 * 数据源只有**已经过 check:p3 校验的快照**；映射不到快照的候选一律给
 * why + 禁用态，不硬造拓扑（S5 加竖杆会让 m=4 变静不定、A6 跟随 / A1 限幅
 * 没有对应 solver 组态，硬画一张图只会骗人）。
 *
 * `baseTemplateId` 是「载入后用哪张归约表」：A3-CB 这种组态变体没有自己的
 * 归约表，仍按 A3 归约，只是把 config 写进 meta；M3-cantilever 有自己的
 * 归约表（fixedSupport 判据与简支不同），所以 base 就是它自己。
 */

import type { ParamValue } from '../templates/registry.ts';

export type CandidateSource =
  | { kind: 'snapshot'; exampleId: string; baseTemplateId: string; metaPatch?: Record<string, string> }
  | { kind: 'none'; reason: string };

export interface Candidate {
  id: string;
  title: string;
  why: string;
  source: CandidateSource;
  /** 缩略图里写的那行小字（不画图，只用文字说清差别）。 */
  thumb: string;
}

const snap = (id: string, title: string, why: string, thumb: string, exampleId: string, baseTemplateId: string, metaPatch?: Record<string, string>): Candidate => ({
  id,
  title,
  why,
  thumb,
  source: { kind: 'snapshot', exampleId, baseTemplateId, ...(metaPatch ? { metaPatch } : {}) },
});

const none = (id: string, title: string, why: string, thumb: string, reason: string): Candidate => ({
  id,
  title,
  why,
  thumb,
  source: { kind: 'none', reason },
});

export const CANDIDATES: Record<string, readonly Candidate[]> = {
  A3: [
    snap('A3-CE', '共射 CE', '电压增益高、输出反相，默认骨架', 'Vs→Rs→Q(b) · Q(c)→Rc∥Rl', 'A3', 'A3', { config: 'CE' }),
    snap('A3-CB', '共基 CB', '输入在发射极，高频响应好、电流增益≈1', '信号从 e 进 · c 出 · b 交流接地', 'A3-CB', 'A3', { config: 'CB' }),
    none(
      'A3-CC', '共集 CC', '射极跟随器，输入电阻高、电压增益≈1', 'c 接 Vcc · 输出取自 e',
      '共集接法没有现成骨架：图上看不到发射极电阻（它被旁路电容短接了），照搬骨架会让负载电阻被误判成空载。不硬载入——请自己搭，或先用 CE / CB',
    ),
  ],
  A5: [
    snap('A5-CS', '共源 CS', '反相电压放大，默认骨架', 'Vin→g · d→Rd∥Rl', 'A5', 'A5', { config: 'CS' }),
    snap('A5-CG', '共栅 CG', '栅极交流接地，输入电阻低、带宽宽', '信号从 s 进 · g 接地', 'A5-CG', 'A5', { config: 'CG' }),
    none(
      'A5-CD', '共漏 CD', '源极跟随器，输出近似跟随输入', 'd 接 Vdd · 输出取自 s',
      '共漏接法没有现成骨架：图上看不到源极电阻（它被旁路电容短接了），照搬骨架会让负载电阻被误判成空载。不硬载入——请自己搭，或先用 CS / CG',
    ),
  ],
  A6: [
    snap('A6-INV', '反相', 'Av=−R2/R1，输入经 R1 进反相端', 'Vin→R1→(−) · R2 反馈', 'A6', 'A6', { topology: 'inverting' }),
    none('A6-NONINV', '同相', 'Av=1+R2/R1，但目前没有已校验的同相骨架快照', 'Vin→(+) · R1/R2 分压反馈', '缺同相组态的已校验快照，不硬造'),
    none('A6-FOLLOWER', '跟随', 'Av≈1，需要拆掉 R2 改直连，本型 solver 未覆盖', '输出直连反相端', '缺跟随器组态的已校验快照，不硬造'),
  ],
  A1: [
    snap('A1-RECT', '整流 / 串联', '恒压降模型，D 导通后 Vout=Vs−Vf', 'Vs→R→D→负载', 'A1', 'A1', { mode: 'series' }),
    none('A1-ZENER', '稳压', '需要 zener 器件与 Vz 支路，当前归约白名单只收 diode', 'Vs→R→Z(反向)', '缺稳压组态的已校验快照，不硬造'),
    none('A1-CLIP', '限幅', '需要双向钳位与两个参考源，本型 solver 未覆盖', '±Vref 双支路', '缺限幅组态的已校验快照，不硬造'),
  ],
  M3: [
    snap('M3-SIMPLE', '简支', 'pin@0 + roller@L，弯矩在跨中最大', '△────P────○', 'M3', 'M3'),
    snap('M3-CANT', '悬臂', '固定端 + 跨中集中力（a=L/2），固定端反力偶最大', '▌────────P↓', 'M3-cantilever', 'M3-cantilever'),
    none('M3-OVERHANG', '带外伸', '支座外还有一段梁，反力与 M 图要另立分段', '△──○────P↓', '缺带外伸梁的已校验快照，不硬造'),
  ],
  S5: [
    snap('S5-TRI', '三角', '三节点三杆，m=2j−3=3，节点法逐点求解', 'A──B · △C', 'S5', 'S5'),
    none('S5-DOUBLE', '双三角', '五杆四节点才静定，当前 solver 只解单三角', 'A──B──D · △C', '缺双三角桁架的已校验快照，不硬造'),
    none('S5-VERT', '加竖杆', '加一根就 m=4>3，结构静不定，本页按设计拒答', 'A──B · C 加竖杆', '静不定结构没有已校验快照，不硬造'),
  ],
};

/** 电路叫「接法」，力学叫「结构」。 */
export function candidateHeading(templateId: string): string {
  // 剩余漏洞 2.2：第三个候选是禁用态（未覆盖），标题还写「三种」让人点进去才扑空。
  // 按实际可用数写，并把禁用那条的原因摆到标题上。
  const list = candidatesFor(templateId);
  const usable = list.filter((item) => item.source.kind !== 'none').length;
  const noun = templateId.startsWith('A') ? '接法' : '结构';
  if (list.length === 0) return `换${noun}`;
  if (usable === list.length) return `换${noun}（${usable} 种）`;
  return `换${noun}：${usable} 个可用 · ${list.length - usable} 个未覆盖`;
}

export function candidatesFor(templateId: string): readonly Candidate[] {
  return CANDIDATES[templateId] ?? [];
}

/**
 * 候选默认值 = 骨架默认 + 当前图继承下来的共享参数 + 候选自己的 meta 组态。
 * 「Rc 改成 3300 后三个候选都带 3300」就是这一句；组态键（config/mode…）
 * 不许被继承覆盖，否则载入 CB 会退回 CE。
 */
export function candidateDefaults(
  candidate: Candidate,
  baseDefaults: Record<string, ParamValue>,
  current: Record<string, number | string> = {},
): Record<string, ParamValue> {
  if (candidate.source.kind === 'none') return { ...baseDefaults };
  const inherited: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key in baseDefaults && typeof value === 'number') inherited[key] = value;
  }
  return { ...baseDefaults, ...inherited, ...(candidate.source.metaPatch ?? {}) };
}
