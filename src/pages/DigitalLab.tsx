/**
 * `#/lab/digital` —— 数字通用求值（W15-S3）。
 *
 * 输入面是文本网表（不是画布——数字族没有可装配的几何，coverage.ts 已判定）：
 *   IN  a, b, c
 *   g1 = AND(a, b)
 *   F  = OR(g1, g2)
 * 右边三块：真值表（≤6 输入全枚举；7–8 输入走激励模式并写明原因）、
 * 每输出最小化式、门数与层深。组合逻辑求值，不做时序仿真——页面写明。
 */

import { useState } from 'react';
import { ThemeToggle } from '../ui/ThemeToggle';
import { gateSolve, type GateSolveOutcome } from '../core/lab/gateSolve';

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: '例 1 · F = A·B + C′',
    text: 'IN  a, b, c\ng1 = AND(a, b)\ng2 = NOT(c)\nF  = OR(g1, g2)',
  },
  {
    label: '例 2 · 全加器',
    text: 'IN  a, b, cin\ns1   = XOR(a, b)\nS    = XOR(s1, cin)\na1   = AND(a, b)\na2   = AND(s1, cin)\nCout = OR(a1, a2)',
  },
  {
    label: '例 3 · 2 位计数器（次态）',
    text: 'IN  Q1, Q0\nN1  = XOR(Q1, Q0)\nN0  = NOT(Q0)',
  },
];

interface DigitalLabProps {
  onBack: () => void;
}

const bitsOf = (value: number, width: number): string =>
  value.toString(2).padStart(width, '0');

export function DigitalLab({ onBack }: DigitalLabProps) {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [stimuli, setStimuli] = useState('');
  const [result, setResult] = useState<GateSolveOutcome | null>(null);

  const evaluate = () => {
    const lines = stimuli
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    setResult(gateSolve(text, lines.length > 0 ? { stimuli: lines } : {}));
  };

  const solution = result && result.ok ? result.solution : null;
  const refusal = result && !result.ok ? result : null;
  const excitationMode = solution !== null && solution.inputs.length > 6;

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-4 px-6">
          <button
            type="button"
            onClick={onBack}
            className="focus-ring text-[13px] text-muted transition-colors hover:text-ink"
          >
            ← 返回
          </button>
          <span className="text-[13px] text-muted">数字求值</span>
          <a href="#/lab" className="focus-ring ml-auto text-[13px] text-muted transition-colors hover:text-ink">
            装配台
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1120px] gap-6 px-6 py-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* 左：文本网表输入 */}
        <section className="card elev flex flex-col gap-3 rounded-2xl p-4">
          <div>
            <h2 className="text-sm font-semibold">门级网表</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              三行语法：<code>IN</code> 声明输入（必须有）、<code>OUT</code> 可选声明输出、
              每行一个 <code>名字 = 门(信号, …)</code>。支持 AND / OR / NOT / NAND / NOR / XOR / XNOR；
              没被别人引用的赋值就是输出（F、Cout 各一行）。
            </p>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            rows={10}
            className="focus-ring w-full resize-y rounded border border-line bg-panel p-2 font-mono text-[12px] leading-5"
            aria-label="门级网表"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => setText(example.text)}
                className="focus-ring rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-cyan/50 hover:text-cyan"
              >
                {example.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={evaluate}
            className="focus-ring self-start rounded border border-cyan/50 bg-cyan/10 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/20"
          >
            求值
          </button>
          <p className="text-[11px] leading-5 text-muted">
            组合逻辑求值，不做时序仿真：有环会拒答（code=cycle），要时序请用触发器另建模型。
          </p>
        </section>

        {/* 右：结果三块 */}
        <section className="flex flex-col gap-4">
          {!solution && !refusal && (
            <div className="card rounded-2xl p-5">
              <h2 className="text-[20px] font-medium leading-tight text-ink">求值后这里出结果</h2>
              <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-muted">
                真值表（输入 ≤ 6 全枚举）、每个输出的最小化式、门数与层深。左侧三个例子可以直接点了看。
              </p>
              <ul className="mt-4 flex flex-col gap-1.5 text-[12px] leading-5 text-faint">
                <li>· 组合环会拒答并指出回路（code=cycle）</li>
                <li>· 输出没被驱动会拒答（code=undrivenOutput）</li>
                <li>· 超过 6 个输入改成按激励串逐条求值，不假装枚举过</li>
              </ul>
            </div>
          )}

          {refusal && (
            <div className="card elev rounded-2xl border border-danger/50 p-4">
              <h2 className="text-sm font-semibold text-danger">拒答 · {refusal.code}</h2>
              <p className="mt-1 text-xs leading-5 text-muted">{refusal.reason}</p>
            </div>
          )}

          {solution && (
            <>
              {/* ① 真值表 / 激励 */}
              <div className="card elev rounded-2xl p-4">
                <h2 className="text-sm font-semibold">
                  {excitationMode ? `真值表 · 激励模式（${solution.inputs.length} 个输入 > 6）` : '真值表'}
                </h2>
                {excitationMode && (
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    超过 6 个输入不再枚举真值表（7 输入就是 128 行）：按 IN 声明序每行给一条
                    {solution.inputs.length} 位 0/1 激励串，逐条求值。
                  </p>
                )}
                {excitationMode && (
                  <div className="mt-2 flex gap-2">
                    <textarea
                      value={stimuli}
                      onChange={(event) => setStimuli(event.target.value)}
                      spellCheck={false}
                      rows={3}
                      placeholder={'00000000\n00000001\n11111111'}
                      className="focus-ring flex-1 rounded border border-line bg-panel p-2 font-mono text-[12px] leading-5"
                      aria-label="激励串（每行一条）"
                    />
                    <button
                      type="button"
                      onClick={evaluate}
                      className="focus-ring self-start rounded border border-cyan/50 bg-cyan/10 px-3 py-1.5 text-xs text-cyan hover:bg-cyan/20"
                    >
                      按激励求值
                    </button>
                  </div>
                )}
                {!excitationMode && solution.outputs.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left font-mono text-[12px]">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          {solution.inputs.map((name) => (
                            <th key={name} className="px-2 py-1 font-medium">{name}</th>
                          ))}
                          {solution.outputs.map((output) => (
                            <th key={output.name} className="px-2 py-1 font-medium text-cyan">{output.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 2 ** solution.inputs.length }, (_, index) => (
                          <tr key={index} className="border-b border-line/40">
                            {bitsOf(index, solution.inputs.length).split('').map((bit, at) => (
                              <td key={`i${at}`} className="px-2 py-0.5">{bit}</td>
                            ))}
                            {solution.outputs.map((output) => (
                              <td key={output.name} className="px-2 py-0.5">
                                {output.minterms.includes(index) ? 1 : 0}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {solution.states && solution.states.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left font-mono text-[12px]">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th className="px-2 py-1 font-medium">激励（{solution.inputs.join(' ')}）</th>
                          <th className="px-2 py-1 font-medium">输出（{solution.outputs.map((o) => o.name).join(' ')}）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {solution.states.map((state, index) => (
                          <tr key={index} className="border-b border-line/40">
                            <td className="px-2 py-0.5">{state.in}</td>
                            <td className="px-2 py-0.5 text-cyan">{state.out}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ② 每输出最小化式 */}
              <div className="card elev rounded-2xl p-4">
                <h2 className="text-sm font-semibold">每输出的最小化式（QMC）</h2>
                <div className="mt-2 flex flex-col gap-2 font-mono text-[12px]">
                  {solution.outputs.map((output) => (
                    <div key={output.name} className="rounded border border-line/60 bg-panel/40 p-2">
                      <div className="text-cyan">
                        {output.name} = {excitationMode ? '（激励模式：不枚举，不求最小化）' : output.minimized}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">结构式：{output.expression}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ③ 门数与层深 */}
              <div className="card elev rounded-2xl p-4">
                <h2 className="text-sm font-semibold">门数与层深</h2>
                <p className="mt-2 font-mono text-[12px]">
                  门数 {solution.gateCount} · 最长层深 {solution.depth}
                  <span className="text-muted">（输入层 = 0；XNOR 按 XOR+NOT 两级如实计）</span>
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  输入 {solution.inputs.join(', ')}；组合逻辑求值，不做时序仿真。
                </p>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
