import { useMemo, useState } from 'react';
import { getTemplateRoute } from '../core/templates/registry';
import { SiteHeader } from '../ui/SiteHeader';

interface WizardProps {
  onBack: () => void;
}

interface Candidate {
  id: string;
  why: string;
}

interface Question {
  key: string;
  label: string;
  hint: string;
  ids: Candidate[];
}

interface Course {
  key: string;
  label: string;
  hint: string;
  questions: Question[];
}

/* 28 型 + 4 组态变体的分诊表：按「哪门课 → 题目要你求什么」两级走，
   不按管脚走。学生知道自己要算什么，不一定记得住输入接哪只脚。 */
const COURSES: Course[] = [
  {
    key: 'M',
    label: '材料力学',
    hint: '内力图 · 应力 · 变形 · 稳定',
    questions: [
      {
        key: 'diagram',
        label: '画剪力图 / 弯矩图，或求最大弯矩',
        hint: '简支、悬臂、集中力、均布载荷',
        ids: [
          { id: 'M3', why: '简支梁 + 集中力/均布载荷，出 Q/M 双图与极值位置' },
          { id: 'M3-cantilever', why: '悬臂梁（固定端 + 自由端），反力含固定端力偶' },
        ],
      },
      {
        key: 'bendstress',
        label: '算弯曲正应力 / 抗弯截面系数',
        hint: '矩形、圆、圆环、工字形截面',
        ids: [{ id: 'M4', why: '先算 W 与 max|M|，再给 σmax 与 σ 沿高度的分布' }],
      },
      {
        key: 'axial',
        label: '轴向拉压 / 构件伸长 / 拉杆强度',
        hint: 'σ=200MPa、ΔL=1mm 这类',
        ids: [{ id: 'M1', why: '算 A、σ、ΔL，并核对许用应力' }],
      },
      {
        key: 'torsion',
        label: '圆轴扭转：剪应力 / 扭转角',
        hint: '扭矩、直径、剪切模量 G',
        ids: [{ id: 'M2', why: '算 Wp、Ip、τmax 与单位长度扭转角 φ' }],
      },
      {
        key: 'defl',
        label: '求挠度 / 转角 / 挠曲线',
        hint: '简支或悬臂梁的弯曲变形',
        ids: [{ id: 'M5', why: '给挠曲线方程、最大挠度位置与数值，并与刚度条件比' }],
      },
      {
        key: 'principal',
        label: '主应力 / 莫尔圆 / 应力状态',
        hint: '给了 σx、σy、τxy',
        ids: [{ id: 'M6', why: '画莫尔圆，给 σ1/σ2/τmax 与主平面转角' }],
      },
      {
        key: 'buckling',
        label: '压杆稳定 / 临界力 / 柔度',
        hint: '欧拉公式、λ 与 λp 比',
        ids: [{ id: 'M7', why: '算 λ、判大/小柔度、给 Pcr 与安全系数' }],
      },
      {
        key: 'combined',
        label: '组合变形（弯扭组合 / 偏心压缩）',
        hint: '主轴疲劳、第三/第四强度理论',
        ids: [{ id: 'M8', why: '叠加各分量应力，按强度理论合并' }],
      },
    ],
  },
  {
    key: 'S',
    label: '理论力学',
    hint: '受力图 · 反力 · 桁架 · 摩擦',
    questions: [
      {
        key: 'reaction',
        label: '求支座反力 / 画受力图 / 判静定',
        hint: '固定铰、可动铰、固定端',
        ids: [
          { id: 'S3', why: '整体平衡求反力，逐支座标注并回代' },
          { id: 'S1', why: '数未知量 vs 独立方程，判静定；静不定与机构会明说不能解' },
        ],
      },
      {
        key: 'truss',
        label: '桁架里求某根杆的内力',
        hint: '节点法、截面法、零杆',
        ids: [{ id: 'S5', why: '节点法与截面法互校，逐节点残差进校核表' }],
      },
      {
        key: 'friction',
        label: '斜面 / 摩擦 / 自锁',
        hint: '摩擦系数、倾角、临界拉力',
        ids: [{ id: 'S4', why: '给临界拉力与自锁判据，画出临界状态' }],
      },
      {
        key: 'centroid',
        label: '求截面形心 / 组合截面几何量',
        hint: 'T 形、工字形、拼合截面',
        ids: [{ id: 'S6', why: '分块求面积与形心，合并后回代校核' }],
      },
      {
        key: 'lever',
        label: '杠杆 / 平衡条件求力',
        hint: '支点、力臂、配重',
        ids: [{ id: 'S7', why: '对支点取矩，解出未知力并给平衡校核' }],
      },
    ],
  },
  {
    key: 'A',
    label: '电路 · 模电',
    hint: '静态工作点 · 小信号 · 运放 · 反馈',
    questions: [
      {
        key: 'gain',
        label: '求小信号电压增益 / 输入电阻 / 输出电阻',
        hint: '共射、共基、共集、共源、共栅、共漏',
        ids: [
          { id: 'A3', why: 'BJT 共射：原电路 + π 模型并列，三路互校' },
          { id: 'A3-CB', why: 'BJT 共基：输入接发射极、基极交流接地' },
          { id: 'A3-CC', why: 'BJT 共集（射极跟随）：增益≈1、输入阻抗高' },
          { id: 'A5', why: 'MOS 共源：原电路 + 小信号模型并列' },
          { id: 'A5-CG', why: 'MOS 共栅：输入接源极、栅极交流接地' },
          { id: 'A5-CD', why: 'MOS 共漏（源极跟随）' },
        ],
      },
      {
        key: 'qpoint',
        label: '求静态工作点 / 判断工作区',
        hint: '分压偏置、截止/放大/饱和',
        ids: [
          { id: 'A2', why: 'BJT 分压偏置，判工作区并给 IB/IC/VCE' },
          { id: 'A4', why: 'MOS 偏置，判截止/可变电阻区/饱和' },
        ],
      },
      {
        key: 'opamp',
        label: '理想运放电路（反相 / 同相 / 加减 / 积分）',
        hint: '虚短虚断',
        ids: [{ id: 'A6', why: '按拓扑给 Av 与输出，并核对线性区' }],
      },
      {
        key: 'feedback',
        label: '负反馈 / 闭环增益',
        hint: '反馈深度、环路增益',
        ids: [{ id: 'A7', why: '判反馈类型，算环路增益 T 与闭环增益 Af' }],
      },
      {
        key: 'diode',
        label: '二极管 / 稳压管 / 整流电路',
        hint: '恒压降模型、钳位',
        ids: [{ id: 'A1', why: '假设导通后回代不变量，给 V 与 I' }],
      },
    ],
  },
  {
    key: 'D',
    label: '数字逻辑',
    hint: '化简 · 组合 · 时序 · 数制',
    questions: [
      {
        key: 'simplify',
        label: '卡诺图化简 / 最小项 / 无关项',
        hint: '给真值表或逻辑式',
        ids: [{ id: 'D1', why: '画卡诺图分块，给最小化表达式并互校' }],
      },
      {
        key: 'analyze',
        label: '分析门电路 / 写出表达式与真值表',
        hint: '给电路图求 F',
        ids: [{ id: 'D2', why: '逐门写中间式，再合成并列表校验' }],
      },
      {
        key: 'design',
        label: '设计译码器 / 选择器 / 加法器 / 比较器',
        hint: '给功能求电路',
        ids: [{ id: 'D3', why: '先写真值表，再合成最简式并给门级实现' }],
      },
      {
        key: 'ff',
        label: '触发器 / 状态表 / 特性方程',
        hint: 'SR、D、JK、T',
        ids: [{ id: 'D4', why: '给特性方程与激励表，校验状态转移' }],
      },
      {
        key: 'fsm',
        label: '时序逻辑 / 序列检测 / 状态机',
        hint: '状态图、计数序列',
        ids: [{ id: 'D5', why: '状态编码后推次态，给状态表与波形' }],
      },
      {
        key: 'num',
        label: '进制转换 / 补码 / BCD',
        hint: '按位展开、取余',
        ids: [{ id: 'D6', why: '按位权展开求值，并给反码补码互推' }],
      },
    ],
  },
];

const COMMON: Candidate[] = [
  { id: 'M3', why: '最常考：简支梁剪力图弯矩图' },
  { id: 'A3', why: '最常考：BJT 共射小信号' },
  { id: 'D1', why: '最常考：卡诺图化简' },
  { id: 'S3', why: '最常考：支座反力' },
];

const BTN =
  'rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm text-ink transition-colors hover:border-cyan/50 hover:bg-panel-2';

export function Wizard({ onBack }: WizardProps) {
  const [step, setStep] = useState(0);
  const [courseKey, setCourseKey] = useState<string | null>(null);
  const [questionKey, setQuestionKey] = useState<string | null>(null);

  const course = useMemo(
    () => COURSES.find((item) => item.key === courseKey) ?? null,
    [courseKey],
  );
  const question = useMemo(
    () => course?.questions.find((item) => item.key === questionKey) ?? null,
    [course, questionKey],
  );

  const exists = (id: string) => Boolean(getTemplateRoute(id));
  const candidates = (question ? question.ids : COMMON).filter((item) => exists(item.id));

  const go = (id: string) => {
    window.location.hash = `#/t/${id}`;
  };

  const reset = () => {
    setStep(0);
    setCourseKey(null);
    setQuestionKey(null);
  };

  const pct = `${[0, 33.33, 66.66, 100][Math.min(step, 3)]}%`;

  return (
    <div className="min-h-screen">
      <SiteHeader
        page="wizard"
        title="选型向导"
        note="三步选到能算的那一款"
        onBack={onBack}
        extra={<span className="text-[13px] text-faint">{step === 0 ? '先选课' : step === 1 ? '再选题型' : '确认后进入拆解'}</span>}
      />

      <main className="mx-auto w-full max-w-[1120px] px-6 pb-16 pt-8">
        <div className="mb-5 h-1 overflow-hidden rounded bg-line">
          <div className="h-full bg-cyan transition-all" style={{ width: pct }} />
        </div>

        {step === 0 ? (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <p className="text-[11px] text-cyan">第 1 步 · 哪门课</p>
            <h2 className="mt-1 text-base text-ink">这道题是哪门课的？</h2>
            <p className="mt-1 text-xs text-muted">
              只覆盖 28 型能算的范围；不确定就选最后一项，我给你最常考的四道。
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {COURSES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setCourseKey(item.key);
                    setQuestionKey(null);
                    setStep(1);
                  }}
                  className={BTN}
                >
                  <span className="block text-sm">{item.label}</span>
                  <span className="mt-1 block text-[11px] text-muted">{item.hint}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCourseKey(null);
                  setQuestionKey(null);
                  setStep(2);
                }}
                className={`${BTN} sm:col-span-2`}
              >
                <span className="block text-sm">不确定 / 想直接贴题</span>
                <span className="mt-1 block text-[11px] text-muted">
                  看最常考的四道，或者去「我有道题」把题面贴进来让系统认
                </span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 1 && course ? (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <p className="text-[11px] text-cyan">第 2 步 · 题目要你求什么</p>
            <h2 className="mt-1 text-base text-ink">{course.label}里，这道题问的是？</h2>
            <p className="mt-1 text-xs text-muted">按你手里的题面挑最接近的一条，不必完全一致。</p>
            <div className="mt-4 grid gap-2">
              {course.questions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setQuestionKey(item.key);
                    setStep(2);
                  }}
                  className={BTN}
                >
                  <span className="block text-sm">{item.label}</span>
                  <span className="mt-1 block text-[11px] text-muted">{item.hint}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="mt-4 text-[11px] text-muted hover:text-cyan"
            >
              ← 重选课程
            </button>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="rounded-2xl border border-line bg-panel p-5">
            <p className="text-[11px] text-cyan">第 3 步 · 确认</p>
            <h2 className="mt-1 text-base text-ink">
              {question ? '这几个模板里挑一个' : '最常考的四道'}
            </h2>
            <p className="mt-1 text-xs text-muted">
              每张卡都会给你：分步推导 + 图 + 六项校核；点开就是成品，参数可以再改。
            </p>
            <div className="mt-4 grid gap-2">
              {candidates.map((item) => {
                const route = getTemplateRoute(item.id);
                const variant = route?.entry.variants?.find((v) => v.id === item.id);
                const label = variant?.title ?? route?.entry.title ?? item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    className="rounded-xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-cyan/50 hover:bg-panel-2"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-cyan">
                        {item.id}
                      </span>
                      <span className="text-sm text-ink">{label}</span>
                    </span>
                    <span className="mt-1 block text-[11px] text-muted">{item.why}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-xl border border-line bg-panel-2/60 p-3">
              <p className="text-[11px] text-muted">
                都对不上？说明这题不在 28 型覆盖范围内 —— 不用硬凑。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href="#/solve"
                  className="rounded-lg bg-cyan px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  把题面贴进来，让系统认
                </a>
                <a
                  href="#/"
                  className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink hover:border-cyan/50"
                >
                  回首页看全部 28 型
                </a>
                <a
                  href="#/about"
                  className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink hover:border-cyan/50"
                >
                  看看它不覆盖什么
                </a>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {course ? (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-[11px] text-muted hover:text-cyan"
                >
                  ← 重选题型
                </button>
              ) : null}
              <button
                type="button"
                onClick={reset}
                className="text-[11px] text-muted hover:text-cyan"
              >
                从头再来
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
