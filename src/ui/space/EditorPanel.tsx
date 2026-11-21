// P5 编辑器面板：工具行 + 结点/构件/刚体系编辑 + 模型级选项。
// 自 lab3d-proto src/ui/EditorPanel.tsx 迁入；样式已按 solve-deck 图纸口径重写（Tailwind/token，不再依赖 lab3d index.css）。
// 新增 readOnly：只读模式下隐藏全部会改 model 的编辑动作区，保留选中结点/构件的只读信息展示。
import { useEffect, useRef, useState } from "react";
import type { Axis, Dof, EditTool, FrictionContact, Member, MemberLoad, TrussModel } from "../../core/space/types";
import type { SolidConfig } from "../../core/space/generator";
import { SOLID_PRESETS, solidPresetLabel } from "../../core/space/generator";
import { SECTION_PRESETS, presetProps } from "../../core/space/sections";
import { MATERIALS, materialById } from "../../core/space/materials";

const AXES: Axis[] = ["x", "y", "z"];
const DOFS6: Dof[] = ["x", "y", "z", "rx", "ry", "rz"];
const ML_KIND_CN = { point: "集中力", uniform: "均布", linear: "梯形" } as const;

/* ---- solve-deck 图纸口径的样式常量（原 .tools/.mini/.coord-row 等类的 Tailwind 重写） ---- */
const btn = "h-8 rounded-[4px] border border-line-2 bg-elev px-2.5 text-[12px] text-muted disabled:cursor-default disabled:opacity-45";
const btnOn = "border-cyan bg-cyan text-white";
const inp = "h-8 rounded-[4px] border border-line-2 bg-elev px-2 font-mono text-[12px]";
const sel = "h-8 rounded-[4px] border border-line-2 bg-elev px-2 text-[12px]";
const tag = "inline-flex items-center gap-1 rounded-[3px] border border-line-2 bg-elev px-1.5 py-px font-mono text-[10.5px] text-muted";
const row = "flex flex-wrap items-center gap-2";
const lbl = "flex items-center gap-1 text-muted";
const sec = "mt-3.5 border-t border-line pt-2.5";
const h3 = "kicker mb-2";
const subHead = "mt-2.5 mb-1 flex items-center gap-2 text-muted";
const hint = "mt-2 leading-[1.5] text-muted";
const msgCls = "mt-1.5 text-amber";

export interface EditorActions {
  changeTool(t: EditTool): void;
  setNodeCoord(id: string, axis: Axis, v: number): void;
  setSupportDofs(id: string, dofs: Dof[]): void;
  addSpring(id: string, dof: Dof, k: number): void;
  removeSpring(id: string, idx: number): void;
  removeSupport(id: string): void;
  setLoad(id: string, f: [number, number, number], m: [number, number, number]): void;
  removeLoad(id: string): void;
  setMemberMaterial(id: string, E: number, A: number): void;
  setMemberKind(id: string, kind: "truss" | "beam"): void;
  setMemberSection(id: string, patch: Partial<Member>): void;
  setModelFlag(key: "buckling" | "reportEnergy", v: boolean): void;
  addMemberLoad(id: string, ml: Omit<MemberLoad, "member">): void;
  removeMemberLoad(globalIdx: number): void;
  batchMaterial(E: number, A: number): void;
  // ---- Q3 刚体系（E2）编辑 ----
  setRigidBodyName(id: string, name: string): void;
  addNodeToBody(bodyId: string, nodeId: string): void;
  removeNodeFromBody(bodyId: string, nodeId: string): void;
  addRigidBody(): void;
  addFrictionContact(nodeId: string): void;
  setFrictionContact(idx: number, patch: Partial<FrictionContact>): void;
  removeFrictionContact(idx: number): void;
  addGravityPart(nodeId: string): void;
  setGravityPart(idx: number, w: number): void;
  removeGravityPart(idx: number): void;
  setSimplifyAt(v: [number, number, number]): void;
  reset(): void;
}

interface Props {
  model: TrussModel;
  tool: EditTool;
  selectedNodeId: string | null;
  selectedMemberId: string | null;
  pendingNodeId: string | null;
  msg: string | null;
  deformMult: number;
  setDeformMult(v: number): void;
  solidCfg: SolidConfig;
  setSolidCfg(v: SolidConfig): void;
  actions: EditorActions;
  /** 只读模式：隐藏工具行、复位按钮与全部编辑动作区，仅保留选中元素的只读信息 */
  readOnly?: boolean;
  /** 有未保存改动；false 时「恢复原算例」置灰（评审 I8） */
  dirty?: boolean;
}

const num = (v: string): number => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

/** 空串/非法 → undefined（用于「清除许用应力字段」） */
const numOr = (v: string): number | undefined => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : undefined;
};

/** ISSUE-10：结点荷载六个分量（kN / kN·m）一次提交。
 *  受控本地态 + 失焦/回车提交：输入过程中不会被 parseFloat 回写打断，
 *  也不会出现「只点施加力偶 → 力分量被旧值覆盖」的半提交。 */
function LoadEditor({
  nodeId,
  load,
  onCommit,
}: {
  nodeId: string;
  load: TrussModel["loads"][number] | null;
  onCommit: (f: [number, number, number], m: [number, number, number]) => void;
}) {
  const toStr = (l: TrussModel["loads"][number] | null): string[] => [
    String((l?.fx ?? 0) / 1e3),
    String((l?.fy ?? 0) / 1e3),
    String((l?.fz ?? 0) / 1e3),
    String((l?.mx ?? 0) / 1e3),
    String((l?.my ?? 0) / 1e3),
    String((l?.mz ?? 0) / 1e3),
  ];
  const [vals, setVals] = useState<string[]>(() => toStr(load));
  // 外部改模型（撤销/重做/算例切换）时同步回输入框；nodeId 变化也要重置
  const sig = load ? [load.fx ?? 0, load.fy ?? 0, load.fz ?? 0, load.mx ?? 0, load.my ?? 0, load.mz ?? 0].join("|") : "";
  useEffect(() => {
    setVals(toStr(load));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, sig]);

  const commit = () => {
    const f: [number, number, number] = [num(vals[0]) * 1e3, num(vals[1]) * 1e3, num(vals[2]) * 1e3];
    const m: [number, number, number] = [num(vals[3]) * 1e3, num(vals[4]) * 1e3, num(vals[5]) * 1e3];
    const same = (a: number, b: number | undefined) => Math.abs(a - (b ?? 0)) < 1e-9;
    if (
      same(f[0], load?.fx) &&
      same(f[1], load?.fy) &&
      same(f[2], load?.fz) &&
      same(m[0], load?.mx) &&
      same(m[1], load?.my) &&
      same(m[2], load?.mz)
    )
      return;
    onCommit(f, m);
  };

  const field = (label: string, i: number, title: string) => (
    <label key={label} className={lbl} title={title}>
      {label}
      <input
        className={`${inp} w-[84px]`}
        type="number"
        step={1}
        value={vals[i]}
        onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className={row}>
        <span className="w-14 shrink-0 text-[10.5px] text-faint">力 kN</span>
        {(["Fx", "Fy", "Fz"] as const).map((lb, i) => field(lb, i, `沿 ${lb[1].toLowerCase()} 方向的集中力 (kN)`))}
      </div>
      <div className={row}>
        <span className="w-14 shrink-0 text-[10.5px] text-faint">力偶 kN·m</span>
        {(["Mx", "My", "Mz"] as const).map((lb, i) => field(lb, i + 3, `绕 ${lb[1].toLowerCase()} 轴的集中力偶 (kN·m)`))}
      </div>
    </div>
  );
}

export default function EditorPanel({
  model,
  tool,
  selectedNodeId,
  selectedMemberId,
  pendingNodeId,
  msg,
  deformMult,
  setDeformMult,
  solidCfg,
  setSolidCfg,
  actions,
  readOnly = false,
  dirty,
}: Props) {
  const node = model.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const member = model.members.find((m) => m.id === selectedMemberId) ?? null;
  const load = node ? model.loads.find((l) => l.node === node.id) ?? null : null;
  const support = node ? model.supports.find((s) => s.node === node.id) ?? null : null;
  const fixedDofs = node ? new Set<Dof>(support?.fix ?? []) : null;
  const rigid = model.rigid;

  const beRef = useRef<HTMLInputElement>(null);
  const baRef = useRef<HTMLInputElement>(null);
  const skRef = useRef<HTMLInputElement>(null);
  const nRef = useRef<HTMLInputElement>(null);
  const mlKindRef = useRef<HTMLSelectElement>(null);
  const mlPosRef = useRef<HTMLInputElement>(null);
  const mlFxRef = useRef<HTMLInputElement>(null);
  const mlFyRef = useRef<HTMLInputElement>(null);
  const mlFzRef = useRef<HTMLInputElement>(null);
  const mlFy2Ref = useRef<HTMLInputElement>(null);

  const [matHint, setMatHint] = useState<string | null>(null);
  const [springDof, setSpringDof] = useState<Dof>("y");
  const [mlKind, setMlKind] = useState<MemberLoad["kind"]>("uniform");

  /* ISSUE-13：单位制只影响「输入框显示/回填」，模型内部始终存 SI。
     工程制：E/G 用 GPa、A 用 cm²、Iy/Iz/J 用 cm⁴ —— 输入框里就是人话数字。 */
  const [unitSys, setUnitSys] = useState<"eng" | "si">("eng");
  const U = unitSys === "eng" ? { E: 1e-9, A: 1e4, I: 1e8, W: 1e6 } : { E: 1, A: 1, I: 1, W: 1 };
  const uLabel = unitSys === "eng" ? { E: "GPa", A: "cm²", I: "cm⁴", W: "cm³" } : { E: "Pa", A: "m²", I: "m⁴", W: "m³" };
  /** 输入框显示值：去掉浮点尾差（1e-5 m⁴ → 1000 cm⁴ 而不是 1000.0000000000002） */
  const fmtU = (v: number): string => String(Number(v.toPrecision(6)));

  // ISSUE-10：E/A、截面、许用应力都走「受控本地态 + 失焦提交」，避免一提交就重挂输入框导致焦点丢失
  const [matV, setMatV] = useState({ E: "", A: "" });
  const [secV, setSecV] = useState({ Iy: "", Iz: "", J: "", G: "", Wy: "", Wz: "", Wt: "" });
  const [allowV, setAllowV] = useState({ sa: "", ta: "" });
  useEffect(() => {
    if (!member) return;
    setMatV({ E: fmtU(member.E * U.E), A: fmtU(member.A * U.A) });
    if (member.kind === "beam")
      setSecV({
        Iy: fmtU((member.Iy ?? 1e-5) * U.I),
        Iz: fmtU((member.Iz ?? 1e-5) * U.I),
        J: fmtU((member.J ?? 2e-5) * U.I),
        G: fmtU((member.G ?? 8e10) * U.E),
        Wy: member.Wy !== undefined ? fmtU(member.Wy * U.W) : "",
        Wz: member.Wz !== undefined ? fmtU(member.Wz * U.W) : "",
        Wt: member.Wt !== undefined ? fmtU(member.Wt * U.W) : "",
      });
    setAllowV({
      sa: member.sigmaAllow !== undefined ? String(member.sigmaAllow / 1e6) : "",
      ta: member.tauAllow !== undefined ? String(member.tauAllow / 1e6) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id, member?.E, member?.A, member?.kind, member?.Iy, member?.Iz, member?.J, member?.G, member?.sigmaAllow, member?.tauAllow, unitSys]);

  const memberLoads = member ? (model.memberLoads ?? []).map((ml, i) => ({ ml, i })).filter((x) => x.ml.member === member.id) : [];

  /** 截面库选择：梁写全套 A/Iy/Iz/J/Wy/Wz/Wt/ks，桁架杆只写 A */
  function applySection(pid: string) {
    if (!member) return;
    if (!pid) {
      actions.setMemberSection(member.id, { sectionId: undefined });
      return;
    }
    const sp = presetProps(pid);
    if (!sp) return;
    actions.setMemberSection(
      member.id,
      member.kind === "beam"
        ? { sectionId: pid, A: sp.A, Iy: sp.Iy, Iz: sp.Iz, J: sp.J, Wy: sp.Wy, Wz: sp.Wz, Wt: sp.Wt, ks: sp.ks }
        : { sectionId: pid, A: sp.A },
    );
  }

  /** 材料库选择：写 E（梁另写 G），并按 σallow=σs/n 给强度校核口径 */
  function applyMaterial(mid: string) {
    if (!member) return;
    if (!mid) {
      actions.setMemberSection(member.id, { materialId: undefined });
      return;
    }
    const mt = materialById(mid);
    if (!mt) return;
    const n = num(nRef.current?.value ?? "") || 1.5;
    actions.setMemberSection(member.id, {
      materialId: mid,
      safetyN: n,
      E: mt.E,
      ...(member.kind === "beam" ? { G: mt.G } : {}),
      sigmaAllow: mt.sigmaS / n,
    });
  }

  /** 手填许用应力（MPa→Pa）；留空 = 清除该字段（不再触发对应校核） */
  function applyAllow() {
    if (!member) return;
    const sa = numOr(allowV.sa);
    const ta = numOr(allowV.ta);
    const nextSa = sa !== undefined ? sa * 1e6 : undefined;
    const nextTa = ta !== undefined ? ta * 1e6 : undefined;
    if (nextSa === member.sigmaAllow && nextTa === member.tauAllow) return;
    actions.setMemberSection(member.id, { sigmaAllow: nextSa, tauAllow: nextTa });
  }

  /** ISSUE-10/13：E/A 失焦即生效；输入值按当前单位制换算回 SI，只提交合法正数 */
  function commitMaterial() {
    if (!member) return;
    const eV = numOr(matV.E);
    const aV = numOr(matV.A);
    if (eV === undefined || aV === undefined) return;
    const E = eV / U.E;
    const A = aV / U.A;
    if (!(E > 0) || !(A > 0)) return;
    if (E === member.E && A === member.A) return;
    actions.setMemberMaterial(member.id, E, A);
  }

  /** ISSUE-10/13：梁截面 Iy/Iz/J/G、Wy/Wz/Wt 失焦即生效；空着的字段不动 */
  function commitSection() {
    if (!member) return;
    const patch: Partial<Member> = {};
    const iyV = numOr(secV.Iy);
    const izV = numOr(secV.Iz);
    const jV = numOr(secV.J);
    const gV = numOr(secV.G);
    const wyV = numOr(secV.Wy);
    const wzV = numOr(secV.Wz);
    const wtV = numOr(secV.Wt);
    const iy = iyV !== undefined ? iyV / U.I : undefined;
    const iz = izV !== undefined ? izV / U.I : undefined;
    const j = jV !== undefined ? jV / U.I : undefined;
    const g = gV !== undefined ? gV / U.E : undefined;
    const wy = wyV !== undefined ? wyV / U.W : undefined;
    const wz = wzV !== undefined ? wzV / U.W : undefined;
    const wt = wtV !== undefined ? wtV / U.W : undefined;
    if (iy !== undefined && iy > 0 && iy !== member.Iy) patch.Iy = iy;
    if (iz !== undefined && iz > 0 && iz !== member.Iz) patch.Iz = iz;
    if (j !== undefined && j > 0 && j !== member.J) patch.J = j;
    if (g !== undefined && g > 0 && g !== member.G) patch.G = g;
    // 评审 P0-5：手工截面必须能补全 Wy/Wz/Wt，否则弯曲/扭转应力无法计算
    if (wy !== undefined && wy > 0 && wy !== member.Wy) patch.Wy = wy;
    if (wz !== undefined && wz > 0 && wz !== member.Wz) patch.Wz = wz;
    if (wt !== undefined && wt > 0 && wt !== member.Wt) patch.Wt = wt;
    if (Object.keys(patch).length) actions.setMemberSection(member.id, patch);
  }

  return (
    <div
      className="border-b border-line bg-panel-2 p-3.5 text-[12px]"
      // 评审 X15：滚轮停在数字框上会静默改值（还立刻重解）→ 滚轮先失焦，只能键入/箭头调
      onWheel={(e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement && t.type === "number") t.blur();
      }}
    >
      {/* ISSUE-09：工具按钮只在页面底栏保留一套，面板里不再重复 */}
      {pendingNodeId && <p className={`${hint} text-ok`}>已选起点 {pendingNodeId}，再点终点结点（Esc 取消）</p>}
      {msg && (
        <p className={msgCls} role="status" aria-live="polite">
          {msg}
        </p>
      )}

      {tool === "solid" && !readOnly && (
        <section className={sec}>
          <h3 className={h3}>实体 / 框架（m）</h3>
          <div className={row}>
            <label className={lbl}>
              形式
              <select
                className={sel}
                value={solidCfg.form ?? "solid"}
                onChange={(e) => setSolidCfg({ ...solidCfg, form: e.target.value as "solid" | "frame" })}
              >
                <option value="solid">实体块（真正实体，内部连接不显示）</option>
                <option value="frame">框架（可见构件）</option>
              </select>
            </label>
          </div>
          <div className={row}>
            <label className={lbl}>
              形状
              <select
                className={sel}
                value={solidPresetLabel(solidCfg)}
                onChange={(e) => {
                  const p = SOLID_PRESETS.find((x) => x.label === e.target.value);
                  if (p) setSolidCfg({ ...solidCfg, ...p.patch });
                }}
              >
                {SOLID_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
                <option value="自定义">自定义</option>
              </select>
            </label>
            <label className={lbl}>
              边数
              <input
                className={`${inp} w-[64px]`}
                type="number"
                step={1}
                min={3}
                max={16}
                value={solidCfg.sides}
                onChange={(e) => {
                  const v = Math.min(16, Math.max(3, Math.round(num(e.target.value))));
                  setSolidCfg({ ...solidCfg, sides: v });
                }}
              />
            </label>
          </div>
          <div className={row}>
            {(
              [
                ["w", "宽 x"],
                ["d", "深 z"],
                ["h", "高 y"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={lbl}>
                {label}
                <input
                  className={`${inp} w-[88px]`}
                  type="number"
                  step={0.5}
                  min={0.5}
                  value={solidCfg[k]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v > 0) setSolidCfg({ ...solidCfg, [k]: v });
                  }}
                />
              </label>
            ))}
            <label className={lbl}>
              底标高
              <input
                className={`${inp} w-[88px]`}
                type="number"
                step={0.5}
                value={solidCfg.baseY ?? 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setSolidCfg({ ...solidCfg, baseY: v });
                }}
              />
            </label>
          </div>
          <div className={row}>
            <label className={lbl}>
              顶缩放 x
              <input
                className={`${inp} w-[64px]`}
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={solidCfg.topScaleW ?? 1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setSolidCfg({ ...solidCfg, topScaleW: v });
                }}
              />
            </label>
            <label className={lbl}>
              顶缩放 z
              <input
                className={`${inp} w-[64px]`}
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={solidCfg.topScaleD ?? 1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setSolidCfg({ ...solidCfg, topScaleD: v });
                }}
              />
            </label>
            <label className={lbl}>
              顶面转角°
              <input
                className={`${inp} w-[64px]`}
                type="number"
                step={5}
                value={solidCfg.twist ?? 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setSolidCfg({ ...solidCfg, twist: v });
                }}
              />
            </label>
          </div>
          <div className={row}>
            <label className={`${lbl} ${solidCfg.form === "frame" ? "" : "opacity-50"}`} title={solidCfg.form === "frame" ? "框架按开关生成可见斜杆" : "实体块内部自动刚性连接，不显示斜杆"}>
              <input
                type="checkbox"
                checked={solidCfg.diagonals}
                disabled={solidCfg.form !== "frame"}
                onChange={(e) => setSolidCfg({ ...solidCfg, diagonals: e.target.checked })}
              />
              面斜杆（几何不变所需）
            </label>
            <label className={lbl}>
              <input
                type="checkbox"
                checked={solidCfg.autoSupport}
                onChange={(e) => setSolidCfg({ ...solidCfg, autoSupport: e.target.checked })}
              />
              底角自动球铰
            </label>
          </div>
          <p className={hint}>
            形式选「实体块」= 画一个真正实体（半透明体 + 棱线），内部刚性连接只在求解里存在、不显示；
            选「框架」= 只放可见构件，按「面斜杆」开关决定是否加斜杆。两种形式都保留角点，
            可继续用「+构件」把实体/框架连成整体。顶缩放 1=棱柱、0~1=棱台、0=收尖成棱锥；12 边≈圆柱/圆台；
            堆叠时把「底标高」设为下层顶高，重合结点自动合并连通。
          </p>
        </section>
      )}

      {node && !readOnly && (
        <section className={sec} key={node.id}>
          <h3 className={h3}>结点 {node.id}</h3>
          <div className={row}>
            {AXES.map((ax) => (
              <label key={ax} className={lbl}>
                {ax}
                {/* ISSUE-05：非受控输入 + 失焦/回车提交：小数点可打、可清空、中途值不回流；数值输入不吸附 */}
                <input
                  key={`${node.id}:${ax}:${node[ax]}`}
                  className={`${inp} w-[88px]`}
                  type="number"
                  step={0.1}
                  defaultValue={node[ax]}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v !== node[ax]) actions.setNodeCoord(node.id, ax, v);
                  }}
                  onKeyDown={(e) => {
                    if (!e.nativeEvent.isComposing && e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 leading-[1.5] text-muted">坐标为精确值（地面点击落点才按 0.5 m 栅格吸附），失焦或回车生效</p>

          <div className={subHead}>
            <b>支座</b>
            {support && (support.fix.length > 0 || support.springs?.length) && (
              <button className={`${btn}`} onClick={() => actions.removeSupport(node.id)}>
                移除
              </button>
            )}
            <button className={`${btn}`} title="球铰：约束 x/y/z 平动" onClick={() => actions.setSupportDofs(node.id, ["x", "y", "z"])}>
              球铰 xyz
            </button>
            <button className={`${btn}`} title="固定端：6 个自由度全锁" onClick={() => actions.setSupportDofs(node.id, [...DOFS6])}>
              固定端 6
            </button>
            {/* ISSUE-12：补齐教学常用支座语义 */}
            <button className={`${btn}`} title="辊轴（可动铰）：只约束法向 y" onClick={() => actions.setSupportDofs(node.id, ["y"])}>
              辊轴 y
            </button>
            <button className={`${btn}`} title="滑移/导向支承：约束 y+z，释放 x" onClick={() => actions.setSupportDofs(node.id, ["y", "z"])}>
              滑移 yz
            </button>
          </div>
          <div className={row}>
            {DOFS6.map((d) => (
              <label key={d} className={lbl}>
                <input
                  type="checkbox"
                  checked={fixedDofs?.has(d) ?? false}
                  onChange={(e) => {
                    const set = new Set<Dof>(fixedDofs ?? []);
                    if (e.target.checked) set.add(d);
                    else set.delete(d);
                    actions.setSupportDofs(node.id, DOFS6.filter((x) => set.has(x)));
                  }}
                />
                {d}
              </label>
            ))}
          </div>
          {support?.springs && support.springs.length > 0 && (
            <div className={row}>
              {support.springs.map((sp, i) => (
                <span key={i} className={tag}>
                  ⇢{sp.dof} k={(sp.k / 1e3).toFixed(0)}kN/m
                  <button className="border-none bg-transparent p-0 text-muted" onClick={() => actions.removeSpring(node.id, i)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={row}>
            <select className={sel} value={springDof} onChange={(e) => setSpringDof(e.target.value as Dof)}>
              {DOFS6.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input ref={skRef} className={`${inp} w-[88px]`} type="number" step={100} placeholder="k (kN/m)" />
            <button
              className={`${btn}`}
              onClick={() => {
                const k = num(skRef.current?.value ?? "") * 1e3;
                if (k > 0) actions.addSpring(node.id, springDof, k);
              }}
            >
              加弹簧
            </button>
          </div>

          <div className={subHead}>
            <b>荷载 (kN / kN·m)</b>
            {load && (
              <button className={`${btn}`} onClick={() => actions.removeLoad(node.id)}>
                移除
              </button>
            )}
          </div>
          {/* ISSUE-10：六个分量一次提交，失焦/回车即生效，不再需要「施加/施加力偶」两个按钮 */}
          <LoadEditor key={node.id} nodeId={node.id} load={load} onCommit={(f, m) => actions.setLoad(node.id, f, m)} />
          <p className="mt-1 leading-[1.5] text-muted">力与力偶都改完再移开焦点（或回车）即生效</p>
        </section>
      )}

      {/* 只读模式：结点仅展示坐标/支座/荷载信息，不提供任何编辑控件 */}
      {node && readOnly && (
        <section className={sec}>
          <h3 className={h3}>结点 {node.id}</h3>
          <div className={`${row} font-mono tabular-nums`}>
            {AXES.map((ax) => (
              <span key={ax} className="text-muted">
                {ax} <b className="font-normal text-ink">{node[ax]}</b>
              </span>
            ))}
          </div>
          {support && (support.fix.length > 0 || support.springs?.length) && (
            <div className="mt-2.5">
              <b className="text-muted">支座</b>
              <div className={`${row} mt-1`}>
                {support.fix.map((d) => (
                  <span key={d} className={tag}>
                    {d}
                  </span>
                ))}
                {support.springs?.map((sp, i) => (
                  <span key={i} className={tag}>
                    ⇢{sp.dof} k={(sp.k / 1e3).toFixed(0)}kN/m
                  </span>
                ))}
              </div>
            </div>
          )}
          {load && (
            <div className="mt-2.5">
              <b className="text-muted">荷载 (kN / kN·m)</b>
              <div className={`${row} mt-1 font-mono tabular-nums text-muted`}>
                <span>
                  fx={((load.fx ?? 0) / 1e3).toFixed(1)} fy={((load.fy ?? 0) / 1e3).toFixed(1)} fz={((load.fz ?? 0) / 1e3).toFixed(1)}
                </span>
                {(load.mx || load.my || load.mz) && (
                  <span>
                    mx={((load.mx ?? 0) / 1e3).toFixed(1)} my={((load.my ?? 0) / 1e3).toFixed(1)} mz={((load.mz ?? 0) / 1e3).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {member && !readOnly && (
        <section className={sec} key={member.id}>
          <h3 className={h3}>构件 {member.id}</h3>
          <p className="mb-2 text-muted">
            {member.a} → {member.b}
            {(() => {
              const a = model.nodes.find((n) => n.id === member.a);
              const b = model.nodes.find((n) => n.id === member.b);
              return a && b ? ` · L=${Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2)}m` : " · 端点缺失";
            })()}
          </p>
          <div className={row}>
            <button
              className={`${btn}${member.kind === "beam" ? ` ${btnOn}` : ""}`}
              onClick={() => actions.setMemberKind(member.id, "beam")}
            >
              梁单元（抗弯/扭）
            </button>
            <button
              className={`${btn}${member.kind !== "beam" ? ` ${btnOn}` : ""}`}
              onClick={() => actions.setMemberKind(member.id, "truss")}
            >
              桁架杆（只轴力）
            </button>
          </div>
          {/* ISSUE-10/13：E/A 失焦或回车即生效，不再需要「应用」按钮；单位随上方单位制切换 */}
          <div className={row}>
            <label className={lbl} title={`弹性模量，单位 ${uLabel.E}`}>
              E ({uLabel.E})
              <input
                className={`${inp} w-[110px]`}
                type="number"
                step={unitSys === "eng" ? 1 : "1e10"}
                value={matV.E}
                onChange={(e) => setMatV((v) => ({ ...v, E: e.target.value }))}
                onBlur={commitMaterial}
                onKeyDown={(e) => {
                  if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <label className={lbl} title={`截面面积，单位 ${uLabel.A}`}>
              A ({uLabel.A})
              <input
                className={`${inp} w-[96px]`}
                type="number"
                step={unitSys === "eng" ? 0.1 : "1e-4"}
                value={matV.A}
                onChange={(e) => setMatV((v) => ({ ...v, A: e.target.value }))}
                onBlur={commitMaterial}
                onKeyDown={(e) => {
                  if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
          </div>

          <div className={subHead}>
            <b>截面库 / 材料库</b>
          </div>
          <div className={row} key={`${member.id}:lib`}>
            <select className={sel} value={member.sectionId ?? ""} onChange={(e) => applySection(e.target.value)}>
              <option value="">截面库…</option>
              {SECTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className={sel} value={member.materialId ?? ""} onChange={(e) => applyMaterial(e.target.value)}>
              <option value="">材料库…</option>
              {MATERIALS.map((mt) => (
                <option key={mt.id} value={mt.id}>
                  {mt.name} σs={(mt.sigmaS / 1e6).toFixed(0)}MPa
                </option>
              ))}
            </select>
            <label className={lbl}>
              n
              <input ref={nRef} className={`${inp} w-[72px]`} type="number" step={0.1} min={1} defaultValue={member.safetyN ?? 1.5} />
            </label>
          </div>
          {/* ISSUE-10：许用应力失焦即生效（留空 = 清除该字段） */}
          <div className={row}>
            <label className={lbl}>
              σ<sub>allow</sub> (MPa)
              <input
                className={`${inp} w-[88px]`}
                type="number"
                step={5}
                placeholder="留空=不校核"
                value={allowV.sa}
                onChange={(e) => setAllowV((v) => ({ ...v, sa: e.target.value }))}
                onBlur={applyAllow}
                onKeyDown={(e) => {
                  if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <label className={lbl}>
              τ<sub>allow</sub> (MPa)
              <input
                className={`${inp} w-[88px]`}
                type="number"
                step={5}
                placeholder="留空=不校核"
                value={allowV.ta}
                onChange={(e) => setAllowV((v) => ({ ...v, ta: e.target.value }))}
                onBlur={applyAllow}
                onKeyDown={(e) => {
                  if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
          </div>

          {member.kind === "beam" && (
            <>
              <div className={subHead}>
                <b>
                  截面（{uLabel.I} / {uLabel.E}）
                </b>
              </div>
              {/* ISSUE-10/13：截面参数失焦即生效，单位随单位制切换 */}
              <div className={row}>
                <label className={lbl}>
                  Iy ({uLabel.I})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    value={secV.Iy}
                    onChange={(e) => setSecV((v) => ({ ...v, Iy: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className={lbl}>
                  Iz ({uLabel.I})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    value={secV.Iz}
                    onChange={(e) => setSecV((v) => ({ ...v, Iz: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className={lbl}>
                  J ({uLabel.I})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    value={secV.J}
                    onChange={(e) => setSecV((v) => ({ ...v, J: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className={lbl}>
                  G ({uLabel.E})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 1 : "1e10"}
                    value={secV.G}
                    onChange={(e) => setSecV((v) => ({ ...v, G: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
              {/* 评审 P0-5：抗弯/抗扭截面模量 —— 手工截面时补全这里，强度校核才能算弯曲/扭转应力 */}
              <div className={row}>
                <label className={lbl} title="绕 y 轴抗弯截面模量（校核用）">
                  Wy ({uLabel.W})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    placeholder="可留空"
                    value={secV.Wy}
                    onChange={(e) => setSecV((v) => ({ ...v, Wy: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className={lbl} title="绕 z 轴抗弯截面模量（竖向弯曲主用）">
                  Wz ({uLabel.W})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    placeholder="可留空"
                    value={secV.Wz}
                    onChange={(e) => setSecV((v) => ({ ...v, Wz: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className={lbl} title="抗扭截面模量 τ=T/Wt">
                  Wt ({uLabel.W})
                  <input
                    className={`${inp} w-[96px]`}
                    type="number"
                    step={unitSys === "eng" ? 10 : "1e-6"}
                    placeholder="可留空"
                    value={secV.Wt}
                    onChange={(e) => setSecV((v) => ({ ...v, Wt: e.target.value }))}
                    onBlur={commitSection}
                    onKeyDown={(e) => {
                      if (!e.nativeEvent.isComposing && e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
              <div className={row}>
                <label className={lbl}>
                  <input
                    type="checkbox"
                    checked={member.releaseA ?? false}
                    onChange={(e) => actions.setMemberSection(member.id, { releaseA: e.target.checked })}
                  />
                  A 端铰（释放弯矩）
                </label>
                <label className={lbl}>
                  <input
                    type="checkbox"
                    checked={member.releaseB ?? false}
                    onChange={(e) => actions.setMemberSection(member.id, { releaseB: e.target.checked })}
                  />
                  B 端铰（释放弯矩）
                </label>
              </div>

              <div className={subHead}>
                <b>杆上荷载</b>
              </div>
              {memberLoads.length > 0 && (
                <div className="mb-1.5 flex flex-col gap-1">
                  {memberLoads.map(({ ml, i }) => (
                    <div key={i} className="flex items-center justify-between gap-1.5 text-muted">
                      <span>
                        {ML_KIND_CN[ml.kind]}
                        {ml.kind === "point" ? ` @x=${ml.pos ?? 0}m` : ""} fx={((ml.fx ?? 0) / 1e3).toFixed(1)} fy={
                          ((ml.fy ?? 0) / 1e3
                        ).toFixed(1)}{" "}
                        fz={((ml.fz ?? 0) / 1e3).toFixed(1)}
                        {ml.kind === "linear" ? ` → fy2=${((ml.fy2 ?? ml.fy ?? 0) / 1e3).toFixed(1)}` : ""}
                        <em className="not-italic text-faint">（{ml.kind === "point" ? "kN" : "kN/m"}）</em>
                      </span>
                      <button className={`${btn}`} onClick={() => actions.removeMemberLoad(i)}>
                        删
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={row}>
                <select
                  ref={mlKindRef}
                  className={sel}
                  value={mlKind}
                  onChange={(e) => setMlKind(e.target.value as MemberLoad["kind"])}
                >
                  <option value="point">集中力 kN</option>
                  <option value="uniform">均布 kN/m</option>
                  <option value="linear">梯形 kN/m</option>
                </select>
                {mlKind === "point" && (
                  <label className={lbl}>
                    x
                    <input ref={mlPosRef} className={`${inp} w-[88px]`} type="number" step={0.25} min={0} placeholder="距A端m" />
                  </label>
                )}
                <label className={lbl}>
                  fx
                  <input ref={mlFxRef} className={`${inp} w-[72px]`} type="number" step={1} defaultValue={0} />
                </label>
                <label className={lbl}>
                  fy
                  <input ref={mlFyRef} className={`${inp} w-[72px]`} type="number" step={1} defaultValue={-10} />
                </label>
                <label className={lbl}>
                  fz
                  <input ref={mlFzRef} className={`${inp} w-[72px]`} type="number" step={1} defaultValue={0} />
                </label>
                {mlKind === "linear" && (
                  <label className={lbl}>
                    fyB
                    <input ref={mlFy2Ref} className={`${inp} w-[72px]`} type="number" step={1} defaultValue={0} />
                  </label>
                )}
                <button
                  className={`${btn}`}
                  onClick={() => {
                    const kind = mlKindRef.current?.value as MemberLoad["kind"];
                    const ml: Omit<MemberLoad, "member"> = {
                      kind,
                      ...(kind === "point" ? { pos: num(mlPosRef.current?.value ?? "") } : {}),
                      fx: num(mlFxRef.current?.value ?? "") * 1e3,
                      fy: num(mlFyRef.current?.value ?? "") * 1e3,
                      fz: num(mlFzRef.current?.value ?? "") * 1e3,
                      ...(kind === "linear" ? { fy2: num(mlFy2Ref.current?.value ?? "") * 1e3 } : {}),
                    };
                    actions.addMemberLoad(member.id, ml);
                  }}
                >
                  加
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* 只读模式：构件仅展示单元类型与材料/截面参数，不提供任何编辑控件 */}
      {member && readOnly && (
        <section className={sec}>
          <h3 className={h3}>构件 {member.id}</h3>
          <p className="mb-2 text-muted">
            {member.a} → {member.b}
            {(() => {
              const a = model.nodes.find((n) => n.id === member.a);
              const b = model.nodes.find((n) => n.id === member.b);
              return a && b ? ` · L=${Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2)}m` : " · 端点缺失";
            })()}
          </p>
          <div className={`${row} font-mono tabular-nums text-muted`}>
            <span>{member.kind === "beam" ? "梁单元（抗弯/扭）" : "桁架杆（只轴力）"}</span>
            <span>
              E={fmtU(member.E * U.E)} {uLabel.E}　A={fmtU(member.A * U.A)} {uLabel.A}
            </span>
            {member.kind === "beam" && (
              <span>
                Iy={fmtU((member.Iy ?? 1e-5) * U.I)} Iz={fmtU((member.Iz ?? 1e-5) * U.I)} J={fmtU((member.J ?? 2e-5) * U.I)} {uLabel.I}　G=
                {fmtU((member.G ?? 8e10) * U.E)} {uLabel.E}
              </span>
            )}
            {(member.sectionId || member.materialId) && (
              <span>
                {member.sectionId ? `截面 ${member.sectionId}` : ""} {member.materialId ? `材料 ${member.materialId}` : ""}
                {member.safetyN !== undefined ? ` n=${member.safetyN}` : ""}
              </span>
            )}
            {member.sigmaAllow !== undefined && <span>σallow={(member.sigmaAllow / 1e6).toFixed(0)}MPa</span>}
            {member.tauAllow !== undefined && <span>τallow={(member.tauAllow / 1e6).toFixed(0)}MPa</span>}
          </div>
          {memberLoads.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1 text-muted">
              {memberLoads.map(({ ml }, i) => (
                <div key={i} className="font-mono tabular-nums">
                  {ML_KIND_CN[ml.kind]}
                  {ml.kind === "point" ? ` @x=${ml.pos ?? 0}m` : ""} fx={((ml.fx ?? 0) / 1e3).toFixed(1)} fy={
                    ((ml.fy ?? 0) / 1e3
                  ).toFixed(1)}{" "}
                  fz={((ml.fz ?? 0) / 1e3).toFixed(1)}
                  {ml.kind === "linear" ? ` → fy2=${((ml.fy2 ?? ml.fy ?? 0) / 1e3).toFixed(1)}` : ""}
                  <em className="not-italic text-faint">（{ml.kind === "point" ? "kN" : "kN/m"}）</em>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {rigid && !readOnly && (
        <section className={sec}>
          <h3 className={h3}>刚体系（E2）</h3>

          <div className={subHead}>
            <b>刚体（共享结点=铰）</b>
            <button className={`${btn}`} onClick={actions.addRigidBody}>
              + 新刚体
            </button>
          </div>
          {rigid.bodies.map((b) => (
            <div key={b.id} className="mt-1.5">
              <div className={row}>
                <input
                  className="h-8 min-w-[90px] flex-1 rounded-[4px] border border-line-2 bg-elev px-2 text-[12px]"
                  type="text"
                  value={b.name}
                  onChange={(e) => actions.setRigidBodyName(b.id, e.target.value)}
                />
                <button
                  className={`${btn}`}
                  disabled={!selectedNodeId}
                  onClick={() => selectedNodeId && actions.addNodeToBody(b.id, selectedNodeId)}
                >
                  把选中结点加入本刚体
                </button>
              </div>
              <div className={`${row} mt-1`}>
                {b.nodes.map((nid) => (
                  <span key={nid} className={tag}>
                    {nid}
                    <button className="border-none bg-transparent p-0 text-muted" onClick={() => actions.removeNodeFromBody(b.id, nid)}>
                      ×
                    </button>
                  </span>
                ))}
                {b.nodes.length === 0 && <em className="text-[11px] not-italic text-faint">（空刚体）</em>}
              </div>
            </div>
          ))}

          <div className={subHead}>
            <b>摩擦接触</b>
            <button
              className={`${btn}`}
              disabled={!selectedNodeId}
              onClick={() => selectedNodeId && actions.addFrictionContact(selectedNodeId)}
            >
              + 摩擦接触
            </button>
          </div>
          {(rigid.friction ?? []).map((fc, i) => (
            <div key={i} className={row}>
              <span className={tag}>{fc.node}</span>
              {(["nx", "ny", "nz"] as const).map((lbl2, k) => (
                <label key={lbl2} className={lbl}>
                  {lbl2}
                  <input
                    className={`${inp} w-[72px]`}
                    type="number"
                    step={0.1}
                    value={fc.normal[k]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const normal = fc.normal.map((x, j) => (j === k ? v : x)) as [number, number, number];
                      actions.setFrictionContact(i, { normal });
                    }}
                  />
                </label>
              ))}
              <label className={lbl}>
                f
                <input
                  className={`${inp} w-[72px]`}
                  type="number"
                  step={0.05}
                  min={0}
                  value={fc.f}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) actions.setFrictionContact(i, { f: v });
                  }}
                />
              </label>
              <button className={`${btn}`} onClick={() => actions.removeFrictionContact(i)}>
                删
              </button>
            </div>
          ))}

          <div className={subHead}>
            <b>重力部件（负 w=挖空）</b>
            <button
              className={`${btn}`}
              disabled={!selectedNodeId}
              onClick={() => selectedNodeId && actions.addGravityPart(selectedNodeId)}
            >
              + 重力部件
            </button>
          </div>
          {(rigid.gravity ?? []).map((g, i) => (
            <div key={i} className={row}>
              <span className={tag}>{g.node}</span>
              <label className={lbl}>
                w
                <input
                  className={`${inp} w-[88px]`}
                  type="number"
                  step={100}
                  value={g.w}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) actions.setGravityPart(i, v);
                  }}
                />
              </label>
              <button className={`${btn}`} onClick={() => actions.removeGravityPart(i)}>
                删
              </button>
            </div>
          ))}

          <div className={subHead}>
            <b>简化基点 O（m，未设置=原点）</b>
          </div>
          <div className={row}>
            {AXES.map((ax, k) => (
              <label key={ax} className={lbl}>
                O{ax}
                <input
                  className={`${inp} w-[72px]`}
                  type="number"
                  step={0.5}
                  value={rigid.simplifyAt?.[k] ?? 0}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    const cur = rigid.simplifyAt ?? [0, 0, 0];
                    actions.setSimplifyAt(cur.map((x, j) => (j === k ? v : x)) as [number, number, number]);
                  }}
                />
              </label>
            ))}
          </div>
          <p className={hint}>改刚体结点指派后方程组可能变得静不定/机构（拒答），属正常教学反馈。</p>
        </section>
      )}

      {!readOnly && (
        <details className={sec}>
          {/* ISSUE-19：模型级设置收进折叠组，默认不占版面；选中元素的参数与结果卡更靠前 */}
          <summary className="cursor-pointer text-[12px] text-muted">
            分析选项 / 材料 / 输入单位
            <span className="ml-1.5 rounded-[3px] border border-line-2 px-1.5 py-px font-mono text-[10.5px] text-faint">
              {unitSys === "eng" ? "工程制" : "SI"}
            </span>
          </summary>
          <div className="mt-2">
            <h3 className={h3}>分析选项</h3>
            <div className={row}>
              <label className={lbl}>
                <input type="checkbox" checked={model.buckling ?? false} onChange={(e) => actions.setModelFlag("buckling", e.target.checked)} />
                压杆稳定校核（屈曲模态）
              </label>
              <label className={lbl}>
                <input
                  type="checkbox"
                  checked={model.reportEnergy ?? false}
                  onChange={(e) => actions.setModelFlag("reportEnergy", e.target.checked)}
                />
                应变能输出
              </label>
            </div>
            <div className={subHead}>
              <b>材料输入单位</b>
              {/* ISSUE-13 / P0-3：只切换输入框，输出口径固定为工程制 */}
              <span className="ml-auto flex">
                {(
                  [
                    ["eng", "工程制（GPa·cm²·cm⁴）"],
                    ["si", "SI（Pa·m²·m⁴）"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={unitSys === k}
                    onClick={() => setUnitSys(k)}
                    title={label}
                    className={
                      "h-7 border border-line-2 px-2 font-mono text-[10.5px] transition-colors first:rounded-l-[4px] last:rounded-r-[4px] " +
                      (unitSys === k ? "bg-cyan text-white" : "bg-elev text-muted hover:text-ink")
                    }
                  >
                    {k === "eng" ? "工程制" : "SI"}
                  </button>
                ))}
              </span>
            </div>
            <div className={row} key={unitSys}>
              <label className={lbl}>
                E ({uLabel.E})
                <input
                  ref={beRef}
                  aria-label={`批量弹性模量 E（${uLabel.E}）`}
                  className={`${inp} w-[88px]`}
                  type="number"
                  step={unitSys === "eng" ? 1 : "1e10"}
                  defaultValue={fmtU((model.members[0]?.E ?? 2e11) * U.E)}
                />
              </label>
              <label className={lbl}>
                A ({uLabel.A})
                <input
                  ref={baRef}
                  aria-label={`批量截面积 A（${uLabel.A}）`}
                  className={`${inp} w-[88px]`}
                  type="number"
                  step={unitSys === "eng" ? 0.1 : "1e-4"}
                  defaultValue={fmtU((model.members[0]?.A ?? 1e-3) * U.A)}
                />
              </label>
              <button
                className={`${btn}`}
                title={`覆盖式操作：将重写全部 ${model.members.length} 个构件的 E/A（逐构件调过的值会被抹平）`}
                onClick={() => {
                  const E = num(beRef.current?.value ?? "") / U.E;
                  const A = num(baRef.current?.value ?? "") / U.A;
                  if (!(E > 0) || !(A > 0)) {
                    setMatHint("E / A 必须是正数（单位见输入框标签）");
                    return;
                  }
                  if (!window.confirm(`将覆盖全部 ${model.members.length} 个构件的 E / A（可用 Ctrl+Z 撤销），继续？`)) return;
                  actions.batchMaterial(E, A);
                  setMatHint(`已覆盖全部 ${model.members.length} 个构件`);
                }}
              >
                应用到全部构件
              </button>
            </div>
            <p className={hint}>
              覆盖式操作：重写全部 {model.members.length} 个构件的 E / A（梁的 G 同步为 E/2.6）；逐构件设置会被抹平，可用 Ctrl+Z 撤销。
              单位只影响输入框，结果统一按 kN / mm / MPa / kN·m 展示。
            </p>
            {matHint && <p className={msgCls}>{matHint}</p>}
          </div>
        </details>
      )}

      <section className={sec}>
        <h3 className={h3}>变形放大系数 ×{deformMult.toFixed(1)}</h3>
        <div className={row}>
          <input
            className="min-w-[120px] flex-1 accent-cyan"
            type="range"
            aria-label="变形放大系数"
            min={0.2}
            max={5}
            step={0.1}
            value={deformMult}
            onChange={(e) => setDeformMult(parseFloat(e.target.value))}
          />
          {/* V-4：滑杆旁给数字输入与即时倍数，拖动时知道自己拖到几倍 */}
          <input
            className={`${inp} w-[72px]`}
            type="number"
            aria-label="变形放大系数（数值）"
            min={0.1}
            max={50}
            step={0.1}
            value={Number(deformMult.toFixed(1))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0) setDeformMult(v);
            }}
          />
        </div>
        <p className={hint}>×N 只是显示放大（真实位移见画布图例与顶栏 KPI），不改变计算结果。</p>
      </section>

      {!readOnly && (
        <button
          className="lift mt-3.5 w-full rounded-[4px] border border-danger/40 bg-transparent py-1 text-[12px] text-danger hover:border-danger hover:bg-danger/5 disabled:cursor-default disabled:border-line-2 disabled:text-faint disabled:hover:bg-transparent"
          onClick={actions.reset}
          disabled={dirty === false}
          title={dirty === false ? "当前模型与算例一致，无需复位" : "丢弃当前编辑，回到算例初始状态（可撤销）"}
        >
          恢复原算例
        </button>
      )}
    </div>
  );
}
