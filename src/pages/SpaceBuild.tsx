/**
 * 三维力学 · 自由装配台（#/space/build）
 * ---------------------------------------------------------------------------
 * lab3d Detail/MechDetail 的「改」的那一半搬到这里：model 是唯一事实源，
 * 任何编辑 → 新 model → useMemo 重解 → 图/数/校核同步同源。
 * 与只读详情的分工：#/space/t/<id> 只看不能改；本页从空白或「从算例起步」随便改。
 * 从算例起步 = 深拷贝一份模板进编辑器，模板本体不受影响。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { EXAMPLES } from '../core/space/examples';
import { EXAMPLES_MECH } from '../core/space/examples-mech';
import { addSolid } from '../core/space/generator';
import type { SolidConfig } from '../core/space/generator';
import { solveMech } from '../core/space/mech';
import { solveTruss } from '../core/space/solve';
import type { Solution3D } from '../core/space/types';
import type { Axis, Dof, EditTool, FrictionContact, Member, MemberLoad, MechModel, TrussModel } from '../core/space/types';
import { MAX_NODES, snap } from '../core/space/types';
import Canvas3D, { type ViewKind } from '../scene/space/Canvas3D';
import MechCanvas from '../scene/space/MechCanvas';
import EditorPanel from '../ui/space/EditorPanel';
import MechPanel from '../ui/space/MechPanel';
import ResultCard from '../ui/space/ResultCard';
import { SiteHeader } from '../ui/SiteHeader';
import { Magnetic } from '../ui/motion';

const clone = <T,>(m: T): T => JSON.parse(JSON.stringify(m)) as T;

function nextId(prefix: string, ids: string[]): string {
  const set = new Set(ids);
  let k = 1;
  while (set.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

const BLANK: TrussModel = { id: 'build', name: '自由装配', nodes: [], members: [], supports: [], loads: [] };

/** I-8：下拉只显示场景名，去掉「必须拒答 / 互校基线 / 锚固 xyz+yz+y」这类 QA 说明 */
const seedName = (name: string): string => name.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim() || name;

/** ISSUE-06 自动存档草稿键：TrussBuild 编辑时写入，SpaceBuild 进场读取提示恢复 */
const DRAFT_KEY = 'solve-deck:space-build-draft';

const TOOLS: { k: EditTool; label: string; hint: string }[] = [
  { k: 'select', label: '选择', hint: '点结点/构件查看与编辑' },
  { k: 'node', label: '+结点', hint: '点地面放新结点（坐标自动吸附 0.5）' },
  { k: 'member', label: '+构件', hint: '依次点两个结点连杆' },
  { k: 'support', label: '支座', hint: '点结点，面板里勾约束自由度' },
  { k: 'load', label: '荷载', hint: '点结点，面板里填力/力矩' },
  { k: 'solid', label: '+实体', hint: '点地面放实体块（真正实体，内部连接隐藏）或框架（可见构件）；角点可用「+构件」继续连接' },
  { k: 'delete', label: '删除', hint: '点结点或构件直接删' },
];

/** 杆系装配：lab3d Detail 状态机原样迁移（只换皮，不改行为）。
 *  model 提升到 SpaceBuild（ISSUE-06）：切模式/切算例不丢编辑，本组件只挂工具态。 */
function TrussBuild({ seed, model, setModel, draftPending }: { seed: TrussModel; model: TrussModel; setModel: Dispatch<SetStateAction<TrussModel>>; draftPending: boolean }) {
  // 评审 L5：求解器抛异常（如管截面壁厚非法）不再白屏，转成一张「求解异常」结果卡
  const solution = useMemo<Solution3D>(() => {
    try {
      return solveTruss(model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        modelId: model.id,
        headline: `求解异常：${msg}`,
        verified: false,
        determinacy: 'mechanism',
        reactions: {},
        memberForces: [],
        displacements: {},
        steps: [],
        checks: [],
        warnings: [],
        refusals: [`求解器抛出异常：${msg}`, '请检查截面尺寸（例如管壁厚 D−2t > 0）、材料参数与几何后重试'],
        solveMs: 0,
      };
    }
  }, [model]);
  // ISSUE-15：把内核拒答文案里的缺约束结点提取出来，交给画布标红
  const refusalNodeId = useMemo(() => {
    for (const r of solution.refusals ?? []) {
      const m = r.match(/结点\s*([A-Za-z]\w*)\s*的\s*([xyz]|rx|ry|rz)\s*自由度/);
      if (m) return m[1];
    }
    return null;
  }, [solution.refusals]);

  // ---- ISSUE-06：撤销/重做栈（上限 50 步）----
  const [undoStack, setUndoStack] = useState<TrussModel[]>([]);
  const [redoStack, setRedoStack] = useState<TrussModel[]>([]);
  const prevModel = useRef(model);
  const skipHist = useRef(false);
  const prevSeedId = useRef(seed.id);
  // 键盘回调需要读最新选中态，用 ref 避免把 selNode/selMember 塞进依赖（它们在 effect 之后声明）
  const selRef = useRef<{ n: string | null; m: string | null }>({ n: null, m: null });
  const dirty = useMemo(() => JSON.stringify(model) !== JSON.stringify(seed), [model, seed]);

  useEffect(() => {
    // 切换算例：清空撤销/重做栈，且不把「换算例」本身记成一步可撤销的编辑
    if (prevSeedId.current !== seed.id) {
      prevSeedId.current = seed.id;
      prevModel.current = model;
      setUndoStack([]);
      setRedoStack([]);
      return;
    }
    const prev = prevModel.current;
    if (prev === model) return;
    if (skipHist.current) skipHist.current = false;
    else {
      setUndoStack((s) => [...s.slice(-49), prev]);
      setRedoStack([]);
    }
    prevModel.current = model;
  }, [model, seed.id]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    skipHist.current = true;
    setRedoStack((r) => [model, ...r].slice(0, 50));
    setModel(undoStack[undoStack.length - 1]);
    setUndoStack((s) => s.slice(0, -1));
  }, [undoStack, model, setModel]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    skipHist.current = true;
    setUndoStack((s) => [...s.slice(-49), model]);
    setModel(redoStack[0]);
    setRedoStack((r) => r.slice(1));
  }, [redoStack, model, setModel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === 'Escape') {
        if (typing) return;
        e.preventDefault();
        setPending(null);
        setHoverGround(null);
        // I-5：Esc 不只是取消起点——直接退回「选择」，不再一按 Esc 后继续放点
        setTool('select');
        setMsg('已退出放置工具，回到「选择」');
        return;
      }
      if (typing) return;
      // 评审 X27：Delete/Backspace 删除当前选中（结点级联删除相连构件/支座/荷载）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selMember = selRef.current.m;
        const selNode = selRef.current.n;
        if (selMember) {
          e.preventDefault();
          const id = selMember;
          setModel((m) => {
            const memberLoads = m.memberLoads?.filter((ml) => ml.member !== id);
            return { ...m, members: m.members.filter((x) => x.id !== id), memberLoads: memberLoads?.length ? memberLoads : undefined };
          });
          setSelMember(null);
          setMsg(`已删除构件 ${id}（Ctrl+Z 可撤销）`);
          return;
        }
        if (selNode) {
          e.preventDefault();
          const id = selNode;
          setModel((m) => {
            const members = m.members.filter((mb) => mb.a !== id && mb.b !== id);
            const memberLoads = m.memberLoads?.filter((ml) => members.some((x) => x.id === ml.member));
            const solids = m.solids?.map((s) => ({ ...s, nodes: s.nodes.filter((nid) => nid !== id) })).filter((s) => s.nodes.length > 0);
            return {
              ...m,
              nodes: m.nodes.filter((n) => n.id !== id),
              members,
              supports: m.supports.filter((s) => s.node !== id),
              loads: m.loads.filter((l) => l.node !== id),
              memberLoads: memberLoads?.length ? memberLoads : undefined,
              solids: solids?.length ? solids : undefined,
            };
          });
          setSelNode(null);
          setMsg(`已删除结点 ${id} 及相连构件/支座/荷载（Ctrl+Z 可撤销）`);
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.isComposing) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setModel]);

  // 自动存档（debounce 500ms）：有改动写入；改回与算例一致时清掉旧草稿，避免撤销后仍提示恢复。
  // draftPending（恢复横幅还没点）时不删——否则进场干净挂载会把横幅对应的草稿抹掉。
  useEffect(() => {
    const h = setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ seedId: seed.id, model }));
        else if (!draftPending) localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* 隐私模式/配额满：静默 */
      }
    }, 500);
    return () => clearTimeout(h);
  }, [model, seed.id, dirty, draftPending]);

  // ---- ISSUE-02：视图预设请求（nonce 递增触发 Canvas3D 取景）----
  const [viewReq, setViewReq] = useState<{ nonce: number; kind: ViewKind }>({ nonce: 0, kind: 'fit' });
  const requestView = (kind: ViewKind) => setViewReq((v) => ({ nonce: v.nonce + 1, kind }));

  const [tool, setTool] = useState<EditTool>('select');
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selMember, setSelMember] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [defE, setDefE] = useState(2.0e11);
  const [defA, setDefA] = useState(1e-3);
  const [deformMult, setDeformMult] = useState(1);
  const [showDeformed, setShowDeformed] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showBuckling, setShowBuckling] = useState(true);
  const [solidCfg, setSolidCfg] = useState<SolidConfig>({ form: 'solid', sides: 4, w: 1, d: 1, h: 1, diagonals: true, autoSupport: true });
  // ISSUE-24：栅格吸附开关（默认开，关掉后可任意落点）+ 地面落点预览
  const [snapOn, setSnapOn] = useState(true);
  const [hoverGround, setHoverGround] = useState<[number, number] | null>(null);
  const placeMode = tool === 'node' || tool === 'solid';

  // 键盘监听注册在选中态声明之前，用 ref 同步最新选中值（避免把 selNode/selMember 塞进依赖）
  useEffect(() => {
    selRef.current = { n: selNode, m: selMember };
  }, [selNode, selMember]);

  // 切换算例：清选中/提示并把镜头重新适配到新模型（不再靠 key 重挂整个画布，
  // 否则 drei Html 标签会成批销毁，控制台刷「synchronously unmount a root」）
  useEffect(() => {
    setSelNode(null);
    setSelMember(null);
    setPending(null);
    setMsg(null);
    setViewReq((v) => ({ nonce: v.nonce + 1, kind: 'fit' }));
  }, [seed.id]);

  // 评审 I7/X20：提示条 4 s 自动消失（新提示会重置计时）
  useEffect(() => {
    if (!msg) return;
    const h = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(h);
  }, [msg]);

  // 评审 I1：删除结点/构件后清理悬挂的选择态（右栏不再空白）
  useEffect(() => {
    if (selNode && !model.nodes.some((n) => n.id === selNode)) setSelNode(null);
    if (selMember && !model.members.some((m) => m.id === selMember)) setSelMember(null);
    if (pending && !model.nodes.some((n) => n.id === pending)) setPending(null);
  }, [model, selNode, selMember, pending]);

  const deformScale = useMemo(() => {
    let mx = 0;
    let r = 0.8;
    const c: [number, number, number] = [0, 0, 0];
    for (const n of model.nodes) {
      c[0] += n.x / model.nodes.length;
      c[1] += n.y / model.nodes.length;
      c[2] += n.z / model.nodes.length;
    }
    for (const n of model.nodes) r = Math.max(r, Math.hypot(n.x - c[0], n.y - c[1], n.z - c[2]));
    for (const d of Object.values(solution.displacements ?? {})) mx = Math.max(mx, Math.hypot(d[0], d[1], d[2]));
    // P0-5：上限从 50 抬到 2000 —— 真实刚度下 0.05 mm 的位移也能看见；
    // 图例里常驻「×N（真实值）」，避免把放大后的形状误读成实际变形量
    return mx > 0 ? Math.min(2000, (r * 0.1) / mx) * deformMult : 0;
  }, [model, solution, deformMult]);

  // ---- ISSUE-20：顶部 KPI（始终可见，不必滚到结果卡底部）----
  const kpi = useMemo(() => {
    // 实体块内部的隐藏刚性连接不进 KPI（它们不是用户关心的受力构件）
    const hidden = new Set(model.members.filter((m) => m.hidden).map((m) => m.id));
    let nMax = 0;
    let nId = '';
    for (const f of solution.memberForces) {
      if (hidden.has(f.id)) continue;
      const a = Math.abs(f.N);
      if (a > nMax) {
        nMax = a;
        nId = f.id;
      }
    }
    let mMax = 0;
    let mId = '';
    for (const it of solution.internals ?? []) {
      if (it.kind !== 'beam' || hidden.has(it.id)) continue;
      for (const s of it.sections) {
        const a = Math.max(Math.abs(s.My), Math.abs(s.Mz));
        if (a > mMax) {
          mMax = a;
          mId = it.id;
        }
      }
    }
    let uMax = 0;
    let uId = '';
    for (const [id, d] of Object.entries(solution.displacements ?? {})) {
      const a = Math.hypot(d[0], d[1], d[2]);
      if (a > uMax) {
        uMax = a;
        uId = id;
      }
    }
    let util = 0;
    let utilId = '';
    for (const ms of solution.stress ?? []) {
      if (hidden.has(ms.id)) continue;
      const r = Math.max(ms.ratio, ms.tauRatio);
      if (r > util) {
        util = r;
        utilId = ms.id;
      }
    }
    return { nMax, nId, mMax, mId, uMax, uId, util, utilId };
  }, [solution, model.members]);

  // ISSUE-19 / 评审 X17：只在「从无选中变有选中」时滚回顶部；
  // 已选中时点另一个元素不再抢滚动（用户可能正在看结果卡）
  const asideRef = useRef<HTMLElement | null>(null);
  const hadSelection = useRef(false);
  useEffect(() => {
    const has = !!(selNode || selMember);
    if (has && !hadSelection.current) asideRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    hadSelection.current = has;
  }, [selNode, selMember]);

  function changeTool(t: EditTool) {
    if (pending) setMsg(`已切换工具，起点 ${pending} 已取消`);
    setTool(t);
    setPending(null);
    setHoverGround(null);
  }

  /** ISSUE-24：指针在地面移动 → 吸附后的落点（只在格点变化时更新，避免每个 mousemove 重渲染） */
  function onGroundHover(x: number, z: number) {
    if (!placeMode) return;
    const nx = snapOn ? snap(x) : Math.round(x * 100) / 100;
    const nz = snapOn ? snap(z) : Math.round(z * 100) / 100;
    setHoverGround((prev) => (prev && prev[0] === nx && prev[1] === nz ? prev : [nx, nz]));
  }

  function pickNode(id: string) {
    if (tool === 'member') {
      if (!pending) {
        setPending(id);
        setMsg(`已选起点 ${id}，再点另一个结点完成连接（Esc 取消）`);
      } else if (pending === id) {
        setMsg(`已取消起点 ${id}`);
        setPending(null);
      } else {
        const a = pending;
        const mid = nextId(
          'M',
          model.members.map((m) => m.id),
        );
        setModel((m) => ({ ...m, members: [...m.members, { id: mid, a, b: id, A: defA, E: defE }] }));
        setPending(null);
        setSelMember(mid);
        setSelNode(null);
        setMsg(`已连接 ${a}–${id}（${mid}）`);
      }
      return;
    }
    if (tool === 'delete') {
      setModel((m) => {
        const members = m.members.filter((mb) => mb.a !== id && mb.b !== id);
        const memberLoads = m.memberLoads?.filter((ml) => members.some((x) => x.id === ml.member));
        // 实体块跟着结点走：删掉的结点从实体归属里摘除，结点全删光则实体一并消失
        const solids = m.solids?.map((s) => ({ ...s, nodes: s.nodes.filter((nid) => nid !== id) })).filter((s) => s.nodes.length > 0);
        return {
          ...m,
          nodes: m.nodes.filter((n) => n.id !== id),
          members,
          supports: m.supports.filter((s) => s.node !== id),
          loads: m.loads.filter((l) => l.node !== id),
          memberLoads: memberLoads?.length ? memberLoads : undefined,
          solids: solids?.length ? solids : undefined,
        };
      });
      if (selNode === id) setSelNode(null);
      if (pending === id) setPending(null);
      setMsg(`已删除结点 ${id} 及相连构件/支座/荷载`);
      return;
    }
    setSelNode(id);
    setSelMember(null);
  }

  function pickMember(id: string) {
    if (tool === 'delete') {
      setModel((m) => {
        const memberLoads = m.memberLoads?.filter((ml) => ml.member !== id);
        return { ...m, members: m.members.filter((x) => x.id !== id), memberLoads: memberLoads?.length ? memberLoads : undefined };
      });
      if (selMember === id) setSelMember(null);
      setMsg(`已删除构件 ${id}`);
      return;
    }
    setSelMember(id);
    setSelNode(null);
  }

  /** 点实体块本体：外壳不参与求解（受力主体是结点+构件）。
   *  这里按「点空白」处理选中，并给出堆叠/连件的下一步指引。 */
  function pickSolid(id: string) {
    const s = model.solids?.find((x) => x.id === id);
    setSelNode(null);
    setSelMember(null);
    setPending(null);
    setMsg(
      s
        ? `实体 ${id} 顶面标高 ${(s.cy + s.h).toFixed(1)} m：往上叠就把面板「底标高」改成这个值再点空地面；要连构件，点它的角点选结点`
        : `实体 ${id} 是框架外壳，受力主体是结点与构件`,
    );
  }

  /** 地面点击：solid 工具放实体框架 / node 工具放新结点 / 其余清空选中（lab3d pickGround 原样） */
  function pickGround(x: number, z: number) {
    const sx = snapOn ? snap(x) : x;
    const sz = snapOn ? snap(z) : z;
    if (tool === 'solid') {
      if (model.nodes.length >= MAX_NODES) {
        setMsg(`原型上限 ${MAX_NODES} 结点（稠密消元 O((3n)³)），请删减或简化`);
        return;
      }
      const cx = sx;
      const cz = sz;
      const cy = snap(solidCfg.baseY ?? 0);
      const r = addSolid(model, cx, cy, cz, solidCfg, defE, defA);
      setModel(r.model);
      setSelNode(null);
      setSelMember(null);
      const asSolid = (solidCfg.form ?? 'solid') === 'solid';
      setMsg(
        r.newNodes + r.newMembers === 0
          ? `该位置已有同样的${asSolid ? '实体' : '框架'}（结点全部重合合并，零新增）`
          : asSolid
            ? `放置实体块 @ (${cx}, ${cy}~${cy + solidCfg.h}m, ${cz})：+${r.newNodes} 结点，内部刚性连接已隐藏${
                r.reusedNodes ? `，合并重合结点 ${r.reusedNodes} 个` : ''
              }${solidCfg.autoSupport ? '，底角已自动球铰' : ''}`
            : `放置框架 @ (${cx}, ${cy}~${cy + solidCfg.h}m, ${cz})：+${r.newNodes} 结点 +${r.newMembers} 构件${
                r.reusedNodes ? `，合并重合结点 ${r.reusedNodes} 个` : ''
              }${solidCfg.autoSupport ? '，底角已自动球铰' : ''}`,
      );
      return;
    }
    if (tool === 'node') {
      // 评审 X3：落点 0.3 m 内有既有结点 → 吸附过去（不再靠 0.05 重合碰运气）
      const near = model.nodes.find((n) => Math.hypot(n.x - sx, n.z - sz) < 0.3 && Math.abs(n.y) < 1e-9);
      if (near) {
        setSelNode(near.id);
        setSelMember(null);
        setMsg(`落点已吸附到既有结点 ${near.id}（不会重复新建）`);
        return;
      }
      // ISSUE-24：同一位置连点两次不再产生重合结点（上面的 0.3 m 吸附已覆盖）
      if (model.nodes.length >= MAX_NODES) {
        setMsg(`原型上限 ${MAX_NODES} 结点（稠密消元 O((3n)³)），请删减或简化`);
        return;
      }
      const id = nextId(
        'N',
        model.nodes.map((n) => n.id),
      );
      setModel((m) => ({ ...m, nodes: [...m.nodes, { id, x: sx, y: 0, z: sz }] }));
      setSelNode(id);
      setSelMember(null);
      setMsg(`新增结点 ${id} @ (${sx}, 0, ${sz})${snapOn ? '（0.5 m 栅格吸附）' : ''}，面板可精调坐标`);
      return;
    }
    // 评审 X6：连杆途中点空白不再静默清掉起点（手抖一次就得重来）
    if (pending) {
      setMsg(`点空白不会取消起点 ${pending}；要取消请按 Esc`);
      return;
    }
    setSelNode(null);
    setSelMember(null);
    setPending(null);
  }

  const actions = {
    changeTool,
    setNodeCoord(id: string, axis: Axis, v: number) {
      // ISSUE-05：数值输入=精调，不再栅格吸附（吸附只用于地面点击落点）
      setModel((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, [axis]: v } : n)) }));
    },
    setSupportDofs(nodeId: string, dofs: Dof[]) {
      // ISSUE-11：重建支座时保留已挂弹簧；只剩弹簧（fix 空）的弹性支座仍然有效
      setModel((m) => {
        const old = m.supports.find((s) => s.node === nodeId);
        const next = m.supports.filter((s) => s.node !== nodeId);
        if (!dofs.length && !old?.springs?.length) return { ...m, supports: next };
        return { ...m, supports: [...next, { node: nodeId, fix: dofs, ...(old?.springs?.length ? { springs: old.springs } : {}) }] };
      });
    },
    addSpring(nodeId: string, dof: Dof, k: number) {
      setModel((m) => {
        const sup = m.supports.find((s) => s.node === nodeId);
        // ISSUE-11：结点还没有支座时也能直接加弹簧（原来静默无反应）
        if (!sup) return { ...m, supports: [...m.supports, { node: nodeId, fix: [], springs: [{ dof, k }] }] };
        return { ...m, supports: m.supports.map((s) => (s.node === nodeId ? { ...s, springs: [...(s.springs ?? []), { dof, k }] } : s)) };
      });
      setMsg(`已给结点 ${nodeId} 加 ${dof} 向弹性支座 k=${(k / 1e3).toFixed(0)} kN/m`);
    },
    removeSpring(nodeId: string, idx: number) {
      setModel((m) => ({
        ...m,
        supports: m.supports.map((s) => (s.node === nodeId ? { ...s, springs: (s.springs ?? []).filter((_, i) => i !== idx) } : s)),
      }));
    },
    removeSupport(nodeId: string) {
      setModel((m) => ({ ...m, supports: m.supports.filter((s) => s.node !== nodeId) }));
    },
    setLoad(nodeId: string, f: [number, number, number], m3: [number, number, number]) {
      setModel((m) => ({
        ...m,
        loads: [
          ...m.loads.filter((l) => l.node !== nodeId),
          { node: nodeId, fx: f[0], fy: f[1], fz: f[2], mx: m3[0] || undefined, my: m3[1] || undefined, mz: m3[2] || undefined },
        ],
      }));
    },
    removeLoad(nodeId: string) {
      setModel((m) => ({ ...m, loads: m.loads.filter((l) => l.node !== nodeId) }));
    },
    setMemberMaterial(id: string, E: number, A: number) {
      setModel((m) => ({ ...m, members: m.members.map((x) => (x.id === id ? { ...x, E, A } : x)) }));
    },
    setMemberKind(id: string, kind: 'beam' | 'truss') {
      // 切换为梁时补上最小截面属性，避免「刚切梁就报缺 Iy/Iz/J」
      setModel((m) => ({
        ...m,
        members: m.members.map((x) =>
          x.id === id
            ? kind === 'beam'
              ? { ...x, kind, Iy: x.Iy ?? 1e-5, Iz: x.Iz ?? 1e-5, J: x.J ?? 2e-5, G: x.G ?? x.E / 2.6 }
              : { ...x, kind }
            : x,
        ),
      }));
      // P0-1：默认截面不是用户选的，切换后明确提示从哪改
      if (kind === 'beam') setMsg(`构件 ${id} 已切为梁：未选截面时用默认截面（Iy/Iz=1000 cm⁴、J=2000 cm⁴），建议在构件面板的截面库选真实截面`);
    },
    setMemberSection(id: string, patch: Partial<Member>) {
      setModel((m) => ({ ...m, members: m.members.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    },
    setModelFlag(key: 'buckling' | 'reportEnergy', v: boolean) {
      setModel((m) => ({ ...m, [key]: v }) as TrussModel);
    },
    addMemberLoad(id: string, ml: Omit<MemberLoad, 'member'>) {
      setModel((m) => ({ ...m, memberLoads: [...(m.memberLoads ?? []), { member: id, ...ml }] }));
      setMsg(`已给构件 ${id} 施加构件荷载（梁段局部轴 +x 正向）`);
    },
    removeMemberLoad(idx: number) {
      setModel((m) => ({ ...m, memberLoads: (m.memberLoads ?? []).filter((_, i) => i !== idx) }));
    },
    batchMaterial(E: number, A: number) {
      setDefE(E);
      setDefA(A);
      // P0-2：梁的 G 由 E 派生（钢/铝统一取 ν=0.3 → G=E/2.6），避免 E 与 G 互相矛盾
      setModel((m) => ({
        ...m,
        members: m.members.map((x) => ({ ...x, E, A, ...(x.kind === 'beam' ? { G: E / 2.6 } : {}) })),
      }));
      const beams = model.members.filter((x) => x.kind === 'beam').length;
      setMsg(
        `已覆盖全部 ${model.members.length} 个构件：E=${E.toExponential(2)} Pa、A=${(A * 1e6).toFixed(0)} mm²${
          beams ? `；${beams} 根梁的 G 同步为 E/2.6` : ''
        }`,
      );
    },
    setRigidBodyName(id: string, name: string) {
      setModel((m) => (m.rigid ? { ...m, rigid: { ...m.rigid, bodies: m.rigid.bodies.map((b) => (b.id === id ? { ...b, name } : b)) } } : m));
    },
    addNodeToBody(bodyId: string, nodeId: string) {
      setModel((m) =>
        m.rigid
          ? { ...m, rigid: { ...m.rigid, bodies: m.rigid.bodies.map((b) => (b.id === bodyId ? { ...b, nodes: [...b.nodes, nodeId] } : b)) } }
          : m,
      );
    },
    removeNodeFromBody(bodyId: string, nodeId: string) {
      setModel((m) =>
        m.rigid
          ? { ...m, rigid: { ...m.rigid, bodies: m.rigid.bodies.map((b) => (b.id === bodyId ? { ...b, nodes: b.nodes.filter((x) => x !== nodeId) } : b)) } }
          : m,
      );
    },
    addRigidBody() {
      const id = nextId(
        'B',
        (model.rigid?.bodies ?? []).map((b) => b.id),
      );
      setModel((m) => ({
        ...m,
        rigid: { ...(m.rigid ?? { bodies: [] }), bodies: [...(m.rigid?.bodies ?? []), { id, name: `刚体 ${id}`, nodes: [] }] },
      }));
      setMsg(`已新建刚体 ${id}：在结点面板「所属刚体」把结点归进来`);
    },
    addFrictionContact(nodeId: string) {
      setModel((m) => {
        const list = m.rigid?.friction ?? [];
        return { ...m, rigid: { ...(m.rigid ?? { bodies: [] }), friction: [...list, { node: nodeId, normal: [0, 1, 0], f: 0.3 }] } };
      });
      setMsg(`结点 ${nodeId} 已加摩擦接触（默认 f=0.3、法向 +y，可改）`);
    },
    setFrictionContact(idx: number, patch: Partial<FrictionContact>) {
      setModel((m) => {
        const list = m.rigid?.friction ?? [];
        return { ...m, rigid: { ...(m.rigid ?? { bodies: [] }), friction: list.map((c, i) => (i === idx ? { ...c, ...patch } : c)) } };
      });
    },
    removeFrictionContact(idx: number) {
      setModel((m) => ({ ...m, rigid: { ...(m.rigid ?? { bodies: [] }), friction: (m.rigid?.friction ?? []).filter((_, i) => i !== idx) } } as TrussModel));
    },
    addGravityPart(nodeId: string) {
      setModel((m) => {
        const list = m.rigid?.gravity ?? [];
        if (list.some((g) => g.node === nodeId)) {
          setMsg(`结点 ${nodeId} 已在承重列表里`);
          return m;
        }
        return { ...m, rigid: { ...(m.rigid ?? { bodies: [] }), gravity: [...list, { node: nodeId, w: 100 }] } };
      });
      setMsg(`结点 ${nodeId} 已加入承重列表（默认 w=100 N，面板里可改）`);
    },
    setGravityPart(idx: number, w: number) {
      setModel((m) => ({ ...m, rigid: { ...(m.rigid ?? { bodies: [] }), gravity: (m.rigid?.gravity ?? []).map((g, i) => (i === idx ? { ...g, w } : g)) } } as TrussModel));
    },
    removeGravityPart(idx: number) {
      setModel((m) => ({ ...m, rigid: { ...(m.rigid ?? { bodies: [] }), gravity: (m.rigid?.gravity ?? []).filter((_, i) => i !== idx) } } as TrussModel));
    },
    setSimplifyAt(v: [number, number, number]) {
      setModel((m) => (m.rigid ? { ...m, rigid: { ...m.rigid, simplifyAt: v } } : m));
    },
    reset() {
      // I-1：复位进撤销栈，可 Ctrl+Z 找回 —— 不再弹与「可撤销」自相矛盾的确认框
      setModel(clone(seed));
      setSelNode(null);
      setSelMember(null);
      setPending(null);
      setMsg(seed.id === 'build' ? '已清空为空白模型（Ctrl+Z 可撤销）' : `已复位到算例 ${seed.id}（Ctrl+Z 可撤销）`);
    },
  };

  return (
    <>
      {/* ISSUE-20：KPI 常驻条 —— 轴力/弯矩/位移/利用率四个关键结论不用滚到结果卡底部 */}
      {model.nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-6 py-1 font-mono text-[11px] text-muted">
          {solution.refusals?.length ? (
            <span className="text-danger">拒答 · 明细与修法见右侧结果卡</span>
          ) : (
            <>
              {kpi.nMax > 0 && (
                <span>
                  轴力 |N|max <b className="font-normal text-ink">{(kpi.nMax / 1000).toFixed(2)}</b> kN
                  {kpi.nId && <span className="text-faint"> @{kpi.nId}</span>}
                </span>
              )}
              {kpi.mMax > 0 && (
                <span>
                  弯矩 |M|max <b className="font-normal text-ink">{(kpi.mMax / 1000).toFixed(2)}</b> kN·m
                  {kpi.mId && <span className="text-faint"> @{kpi.mId}</span>}
                </span>
              )}
              {kpi.uMax > 0 && (
                <span>
                  位移 |u|max <b className="font-normal text-ink">{(kpi.uMax * 1000).toFixed(3)}</b> mm
                  {kpi.uId && <span className="text-faint"> @{kpi.uId}</span>}
                </span>
              )}
              {kpi.util > 0 ? (
                <span>
                  利用率 <b className={`font-normal ${kpi.util > 1 ? 'text-danger' : 'text-ok'}`}>{(kpi.util * 100).toFixed(1)}%</b>
                  {kpi.utilId && <span className="text-faint"> @{kpi.utilId}</span>}
                </span>
              ) : (
                <span className="text-faint" title="在构件面板填 σallow（或选材料库）后出现强度利用率">
                  强度校核：未设
                </span>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="canvas-solid focus-ring relative min-h-[46vh] flex-1 lg:min-h-0"
          tabIndex={0}
          role="application"
          aria-label="三维装配画布：用底部工具放置/选择结点与构件，鼠标可旋转视角"
        >
          {/* ISSUE-02：画布左上角视图预设浮层（相机只在点按钮时移动，不干扰手动轨道） */}
          <div className="absolute left-2 top-2 z-10 flex gap-1">
            {(
              [
                ['fit', '适配视图'],
                ['front', '正视'],
                ['top', '俯视'],
                ['iso', '轴测'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => requestView(k)}
                className="h-7 rounded-[4px] border border-line-2 bg-elev/90 px-2 text-[11.5px] text-muted transition-colors hover:text-ink"
              >
                {label}
              </button>
            ))}
          </div>
          {/* ISSUE-17 / 评审 L-6：颜色之外再给线型编码（色弱也能分拉压） */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-2.5 rounded-[3px] border border-line-2 bg-elev/85 px-2 py-1 font-mono text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <i className="inline-block w-3.5 border-t-2 border-solid border-danger" />
              拉
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block w-3.5 border-t-2 border-dashed border-cyan" />
              压
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block w-3.5 border-t border-dotted border-faint" />
              零轴力
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block w-3.5 border-t-[3px] border-muted" />
              粗=梁单元
            </span>
            {/* P0-5：变形倍数常驻，避免把放大后的形状当成真实变形 */}
            {showDeformed && deformScale > 0 && (
              <span className="flex items-center gap-1 text-gold">
                变形 ×{deformScale >= 100 ? deformScale.toFixed(0) : deformScale.toFixed(1)}
                {kpi.uMax > 0 && <span className="text-faint">（真实 {(kpi.uMax * 1000).toFixed(3)} mm）</span>}
              </span>
            )}
          </div>
          {/* L-4：空模型引导卡上移到画布上 1/4，不压住地面原点落点 */}
          {model.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[16%] z-10 flex justify-center">
              <div className="rounded-[4px] border border-line-2 bg-panel/90 px-4 py-3 text-center text-[12px] leading-[1.7] text-muted shadow-sm">
                画布还是空的
                <br />
                <span className="text-faint">选「+结点」放点、「+构件」连接；或用「+实体」放下实体块 / 框架</span>
              </div>
            </div>
          )}
          <Canvas3D
            model={model}
            solution={solution}
            showDeformed={showDeformed}
            showLabels={showLabels}
            showBuckling={showBuckling}
            deformScale={deformScale}
            onPickNode={pickNode}
            onPickMember={pickMember}
            onPickSolid={pickSolid}
            onPickGround={pickGround}
            selectedNodeId={selNode}
            selectedMemberId={selMember}
            pendingNodeId={pending}
            alertNodeId={refusalNodeId}
            groundPreview={placeMode ? hoverGround : null}
            onHoverGround={placeMode ? onGroundHover : undefined}
            pickCursor={tool !== 'select'}
            viewRequest={viewReq}
          />
        </div>
        {/* ISSUE-01：桌面端行有确定高度后 aside 才能内部滚动；窄屏交给整页滚动 */}
        <aside ref={asideRef} className="w-full space-y-4 border-t border-line p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:w-[min(400px,calc(100vw-2rem))] lg:flex-none lg:border-l lg:border-t-0 xl:w-[min(440px,calc(100vw-2rem))]">
          {/* L-1：结果优先——结果卡置顶，设置项和选中编辑放在它下面 */}
          <ResultCard
            model={model}
            solution={solution}
            deformScale={deformScale}
            onSelectNode={(id) => {
              setSelNode(id);
              setSelMember(null);
            }}
            onSelectMember={(id) => {
              setSelMember(id);
              setSelNode(null);
            }}
          />
          <EditorPanel
            model={model}
            tool={tool}
            selectedNodeId={selNode}
            selectedMemberId={selMember}
            pendingNodeId={pending}
            msg={msg}
            deformMult={deformMult}
            setDeformMult={setDeformMult}
            solidCfg={solidCfg}
            setSolidCfg={setSolidCfg}
            actions={actions}
            dirty={dirty}
          />
        </aside>
      </div>
      {/* 工具条：lab3d Detail 头部的工具行/图层开关/复位原样迁到页面底栏 */}
      <div className="toolbar flex-wrap gap-x-4 gap-y-1.5 px-6">
        {TOOLS.map((t) => (
          <button
            key={t.k}
            type="button"
            data-testid={`space-tool-${t.k}`}
            title={t.k === 'node' || t.k === 'solid' ? (model.nodes.length >= MAX_NODES ? `已达上限 ${MAX_NODES} 结点` : t.hint) : t.hint}
            aria-pressed={tool === t.k}
            disabled={(t.k === 'node' || t.k === 'solid') && model.nodes.length >= MAX_NODES}
            onClick={() => changeTool(t.k)}
            className={
              'h-7 border border-line-2 px-2.5 text-[12px] transition-colors disabled:cursor-default disabled:opacity-40 ' +
              (tool === t.k ? 'bg-cyan text-white' : 'bg-elev text-muted hover:text-ink')
            }
          >
            {t.label}
          </button>
        ))}
        {/* L-6：工具提示只在宽屏常驻，窄屏靠按钮 title */}
        <span className="hidden text-[11px] text-faint xl:inline">{TOOLS.find((t) => t.k === tool)?.hint}</span>
        <span className="font-mono text-[10.5px] text-faint">图层</span>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
          <input data-testid="layer-deformed" type="checkbox" checked={showDeformed} onChange={(e) => setShowDeformed(e.target.checked)} /> 变形层
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
          <input data-testid="layer-labels" type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> 杆力标签
        </label>
        {/* ISSUE-24：吸附开关（关掉后地面落点/预览按实际坐标） */}
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted" title="地面点击落点按 0.5 m 栅格吸附">
          <input data-testid="layer-snap" type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> 栅格吸附
        </label>
        {/* 评审 X29：屈曲模态固定占位（模型未开屈曲校核时置灰），避免开关忽隐忽现 */}
        <label
          className={`flex items-center gap-1.5 font-mono text-[11px] ${model.buckling ? 'cursor-pointer text-muted' : 'cursor-default text-faint opacity-60'}`}
          title={model.buckling ? '显示一阶屈曲模态' : '在右侧「分析选项」里勾选「压杆稳定校核」后可用'}
        >
          <input type="checkbox" checked={showBuckling} disabled={!model.buckling} onChange={(e) => setShowBuckling(e.target.checked)} /> 屈曲模态
        </label>
        <span className="font-mono text-[11px] text-muted">
          {solution.solveMs > 0 ? `重解 ${solution.solveMs} ms` : '重解 <1 ms'}
        </span>
        {/* 无障碍/可发现性：快捷键以前只存在于代码里，界面给一行常驻提示 */}
        <span
          className="font-mono text-[10.5px] text-faint"
          title="Ctrl+Z 撤销 · Ctrl+Shift+Z / Ctrl+Y 重做 · Delete 删除选中 · Esc 退出放置"
        >
          ⌨ Ctrl+Z 撤销 · Del 删除选中 · Esc 退出放置
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* I-1：显式「新建空白模型」——不用再靠「从算例起步」里选空白 */}
          <button
            type="button"
            data-testid="space-new"
            onClick={() => {
              setModel(clone(BLANK));
              setSelNode(null);
              setSelMember(null);
              setPending(null);
              setMsg('已新建空白模型（Ctrl+Z 可撤销）');
            }}
            title="清空画布，从零开始（可撤销）"
            className="h-7 border border-line-2 bg-elev px-2.5 text-[12px] text-muted transition-colors hover:text-ink"
          >
            新建
          </button>
          <button
            type="button"
            data-testid="space-undo"
            onClick={undo}
            disabled={!undoStack.length}
            title="撤销（Ctrl+Z）"
            className="h-7 border border-line-2 bg-elev px-2.5 text-[12px] text-muted transition-colors hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            撤销{undoStack.length ? ` ${undoStack.length}` : ''}
          </button>
          <button
            type="button"
            data-testid="space-redo"
            onClick={redo}
            disabled={!redoStack.length}
            title="重做（Ctrl+Shift+Z / Ctrl+Y）"
            className="h-7 border border-line-2 bg-elev px-2.5 text-[12px] text-muted transition-colors hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            重做
          </button>
          {/* I-2：「复位」与「恢复原算例」同语义，同状态禁用 */}
          <button
            type="button"
            data-testid="space-reset"
            onClick={actions.reset}
            disabled={!dirty}
            title={dirty ? `复位到算例 ${seed.id}（可撤销）` : '当前模型与算例一致，无需复位'}
            className="h-7 border border-line-2 bg-elev px-2.5 text-[12px] text-muted transition-colors hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            复位
          </button>
        </span>
      </div>
    </>
  );
}

/** 机构装配：lab3d MechDetail 状态机原样迁移，t 只影响画布游标不触发重解。
 *  model 同样提升到 SpaceBuild：切模式再切回不丢参数编辑（ISSUE-06）。 */
function MechBuild({ seed, model, onChange }: { seed: MechModel; model: MechModel; onChange: (m: MechModel) => void }) {
  const solution = useMemo(() => solveMech(model), [model]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showVel, setShowVel] = useState(true);
  const [showAcc, setShowAcc] = useState(false);
  const [showTrail, setShowTrail] = useState(true);

  useEffect(() => {
    if (!playing || !solution.frames.length) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((x) => (x + dt >= model.duration ? 0 : x + dt));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, model.duration, solution.frames.length]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="canvas-solid relative min-h-[46vh] flex-1 lg:min-h-0">
          <MechCanvas model={model} solution={solution} t={t} showVel={showVel} showAcc={showAcc} showTrail={showTrail} />
        </div>
        <aside className="w-full min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-line p-4 lg:w-[min(400px,calc(100vw-2rem))] lg:flex-none lg:border-l lg:border-t-0 xl:w-[min(440px,calc(100vw-2rem))]">
          <MechPanel
            model={model}
            solution={solution}
            t={t}
            onT={setT}
            playing={playing}
            onPlaying={setPlaying}
            speed={speed}
            onSpeed={setSpeed}
            onChange={onChange}
            onReset={() => {
              if (JSON.stringify(model) !== JSON.stringify(seed) && !window.confirm('复位将丢弃当前参数编辑，继续？')) return;
              onChange(clone(seed));
              setT(0);
              setPlaying(false);
            }}
          />
        </aside>
      </div>
      <div className="toolbar flex-wrap gap-x-4 gap-y-1.5 px-6">
        <span className="font-mono text-[11px] text-muted">求解 {solution.solveMs > 0 ? `${solution.solveMs} ms` : '<1 ms'}</span>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
          <input type="checkbox" checked={showVel} onChange={(e) => setShowVel(e.target.checked)} /> 速度箭头
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
          <input type="checkbox" checked={showAcc} onChange={(e) => setShowAcc(e.target.checked)} /> 加速度箭头
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted">
          <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> 轨迹线
        </label>
      </div>
    </>
  );
}

export function SpaceBuild({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'truss' | 'mech'>('truss');
  const [seed, setSeed] = useState<TrussModel>(BLANK);
  const [trussModel, setTrussModel] = useState<TrussModel>(BLANK);
  const [mechSeed, setMechSeed] = useState<MechModel>(() => clone(EXAMPLES_MECH[0]));
  const [mechModel, setMechModel] = useState<MechModel>(() => clone(EXAMPLES_MECH[0]));

  // ISSUE-06：进场时若发现上次自动存档的草稿，提示恢复/放弃
  const [draft, setDraft] = useState<{ seedId: string; model: TrussModel } | null>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (d?.model && Array.isArray(d.model.nodes) && d.model.nodes.length > 0) return d;
    } catch {
      /* 坏档忽略 */
    }
    return null;
  });

  return (
    // ISSUE-01 + L-2：桌面端锁视口；<lg 允许整页滚动，否则右栏结果永远够不着
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:overflow-hidden">
      <SiteHeader
        onBack={onBack}
        backLabel="算例库"
        page="space"
        title="三维自由装配"
        note="改结构 · 即时重算"
      />
      {/* ISSUE-07：模式切换与算例下拉从全局顶栏移到页面子工具条，顶栏不再被页面级控件撑爆 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-6 py-1.5">
        <Magnetic strength={0.14}>
          <div className="flex" role="group" aria-label="装配模式">
            {(
              [
                { k: 'truss', label: '杆系/刚体' },
                { k: 'mech', label: '机构运动学' },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                type="button"
                aria-pressed={mode === m.k}
                onClick={() => {
                  if (m.k === mode) return;
                  // 评审 P0-9：切模式不再静默清空杆系编辑的撤销记录
                  if (mode === 'truss' && JSON.stringify(trussModel) !== JSON.stringify(seed) && !window.confirm('切到机构模式会保留当前杆系模型，但撤销/重做记录会清空。继续？')) return;
                  setMode(m.k);
                }}
                className={
                  'h-8 border border-line-2 px-3 text-[12px] transition-colors first:rounded-l-[4px] last:rounded-r-[4px] ' +
                  (mode === m.k ? 'bg-cyan text-white' : 'bg-elev text-muted hover:text-ink')
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </Magnetic>
        {mode === 'truss' ? (
          <select
            aria-label="从算例起步"
            value={seed.id}
            onChange={(e) => {
              const val = e.target.value;
              if (JSON.stringify(trussModel) !== JSON.stringify(seed) && !window.confirm('切换算例将丢弃当前未保存的编辑，继续？')) return;
              const ex = EXAMPLES.find((x) => x.id === val);
              const next = ex ? clone(ex) : BLANK;
              setSeed(next);
              setTrussModel(clone(next));
            }}
            className="h-8 max-w-[min(22rem,60vw)] truncate border border-line-2 bg-elev px-2 font-mono text-[11px] text-ink"
          >
            <option value="build">＋ 新建空白模型</option>
            {EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {seedName(x.name)}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="从机构算例起步"
            value={mechSeed.id}
            onChange={(e) => {
              const val = e.target.value;
              if (JSON.stringify(mechModel) !== JSON.stringify(mechSeed) && !window.confirm('切换机构算例将丢弃当前参数编辑，继续？')) return;
              const ex = EXAMPLES_MECH.find((x) => x.id === val);
              if (!ex) return;
              const next = clone(ex);
              setMechSeed(next);
              setMechModel(clone(next));
            }}
            className="h-8 max-w-[min(22rem,60vw)] truncate border border-line-2 bg-elev px-2 font-mono text-[11px] text-ink"
          >
            {EXAMPLES_MECH.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {draft && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-6 py-1.5 text-[12px]">
          <span className="text-muted">
            发现上次未保存的装配草稿（{draft.seedId === 'build' ? '空白模型' : `算例 ${draft.seedId}`} ·{' '}
            {draft.model.nodes.length} 结点 · {draft.model.members.length} 构件）
          </span>
          <button
            type="button"
            className="h-6 border border-line-2 bg-elev px-2 text-muted transition-colors hover:text-ink"
            onClick={() => {
              const ex = EXAMPLES.find((x) => x.id === draft.seedId);
              setMode('truss');
              setSeed(ex ? clone(ex) : BLANK);
              setTrussModel(draft.model);
              setDraft(null);
            }}
          >
            恢复
          </button>
          <button
            type="button"
            className="h-6 border border-line-2 bg-elev px-2 text-muted transition-colors hover:text-ink"
            onClick={() => {
              try {
                localStorage.removeItem(DRAFT_KEY);
              } catch {
                /* 忽略 */
              }
              setDraft(null);
            }}
          >
            放弃
          </button>
        </div>
      )}
      {mode === 'truss' ? (
        <TrussBuild seed={seed} model={trussModel} setModel={setTrussModel} draftPending={!!draft} />
      ) : (
        <MechBuild key={`m-${mechSeed.id}`} seed={mechSeed} model={mechModel} onChange={setMechModel} />
      )}
    </div>
  );
}
