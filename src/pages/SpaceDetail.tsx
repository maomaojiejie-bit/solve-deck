/**
 * 三维力学 · 模板只读详情（#/space/t/<id>）
 * ---------------------------------------------------------------------------
 * lab3d 的 Detail/MechDetail 拆出来的「看」的那一半：3D 场景 + 结果卡 + 机构播放条。
 * 只读口径：画布 pick 只更新选中态、绝不改 model；EditorPanel/MechPanel 挂 readOnly
 * 隐藏工具行 / 复位 / 参数编辑区。想改模型请去 #/space/build。
 * three.js 只在本页 lazy chunk 内出现（App.tsx 动态 import），首屏零影响。
 */

import { useMemo, useState, useEffect } from 'react';
import { EXAMPLES } from '../core/space/examples';
import { EXAMPLES_MECH } from '../core/space/examples-mech';
import { solveTruss } from '../core/space/solve';
import { solveMech } from '../core/space/mech';
import type { SolidConfig } from '../core/space/generator';
import type { Axis, Dof, FrictionContact, Member, MemberLoad, TrussModel } from '../core/space/types';
import type { EditorActions } from '../ui/space/EditorPanel';
import Canvas3D from '../scene/space/Canvas3D';
import MechCanvas from '../scene/space/MechCanvas';
import EditorPanel from '../ui/space/EditorPanel';
import MechPanel from '../ui/space/MechPanel';
import ResultCard from '../ui/space/ResultCard';
import { SiteHeader } from '../ui/SiteHeader';
import { kbEntriesForExample } from '../kb/spaceLinks';
import { KB_BY_ID } from '../kb/index.ts';

/** 只读页不改模型：EditorActions 全部给空实现，满足类型契约即可（readOnly 下控件也不渲染） */
const READONLY_ACTIONS: EditorActions = {
  changeTool: () => {},
  setNodeCoord: (_id: string, _axis: Axis, _v: number) => {},
  setSupportDofs: (_id: string, _dofs: Dof[]) => {},
  addSpring: (_id: string, _dof: Dof, _k: number) => {},
  removeSpring: (_id: string, _idx: number) => {},
  removeSupport: (_id: string) => {},
  setLoad: (_id: string, _f: [number, number, number], _m: [number, number, number]) => {},
  removeLoad: (_id: string) => {},
  setMemberMaterial: (_id: string, _E: number, _A: number) => {},
  setMemberKind: (_id: string, _kind: 'beam' | 'truss') => {},
  setMemberSection: (_id: string, _patch: Partial<Member>) => {},
  setModelFlag: (_key: 'buckling' | 'reportEnergy', _v: boolean) => {},
  addMemberLoad: (_id: string, _ml: Omit<MemberLoad, 'member'>) => {},
  removeMemberLoad: (_idx: number) => {},
  batchMaterial: (_E: number, _A: number) => {},
  setRigidBodyName: (_id: string, _name: string) => {},
  addNodeToBody: (_bodyId: string, _nodeId: string) => {},
  removeNodeFromBody: (_bodyId: string, _nodeId: string) => {},
  addRigidBody: () => {},
  addFrictionContact: (_nodeId: string) => {},
  setFrictionContact: (_idx: number, _patch: Partial<FrictionContact>) => {},
  removeFrictionContact: (_idx: number) => {},
  addGravityPart: (_nodeId: string) => {},
  setGravityPart: (_idx: number, _w: number) => {},
  removeGravityPart: (_idx: number) => {},
  setSimplifyAt: (_v: [number, number, number]) => {},
  reset: () => {},
};

const DEFAULT_SOLID: SolidConfig = { form: 'solid', sides: 4, w: 1, d: 1, h: 1, diagonals: true, autoSupport: true };

/** 杆系只读页：pick 只选中，结果与画布同源（同一个 Solution3D） */
function TrussReadonly({ example }: { example: TrussModel }) {
  const model = example;
  const solution = useMemo(() => solveTruss(model), [model]);

  const [selNode, setSelNode] = useState<string | null>(null);
  const [selMember, setSelMember] = useState<string | null>(null);
  const [deformMult, setDeformMult] = useState(1);
  const [showDeformed, setShowDeformed] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showBuckling, setShowBuckling] = useState(true);

  // 变形放大系数：与装配台同口径（最大位移缩放到外接半径 10% × 用户滑杆）
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
    return mx > 0 ? ((r * 0.1) / mx) * deformMult : 0;
  }, [model, solution, deformMult]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="canvas-solid relative min-h-[46vh] flex-1 lg:min-h-0">
          <Canvas3D
            model={model}
            solution={solution}
            showDeformed={showDeformed}
            showLabels={showLabels}
            showBuckling={showBuckling}
            deformScale={deformScale}
            onPickNode={(id) => {
              setSelNode(id);
              setSelMember(null);
            }}
            onPickMember={(id) => {
              setSelMember(id);
              setSelNode(null);
            }}
            onPickGround={() => {
              setSelNode(null);
              setSelMember(null);
            }}
            selectedNodeId={selNode}
            selectedMemberId={selMember}
            pendingNodeId={null}
          />
        </div>
        <aside className="w-full min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-line p-4 lg:w-[min(400px,calc(100vw-2rem))] lg:flex-none lg:border-l lg:border-t-0 xl:w-[min(440px,calc(100vw-2rem))]">
          <EditorPanel
            readOnly
            model={model}
            tool="select"
            selectedNodeId={selNode}
            selectedMemberId={selMember}
            pendingNodeId={null}
            msg={null}
            deformMult={deformMult}
            setDeformMult={setDeformMult}
            solidCfg={DEFAULT_SOLID}
            setSolidCfg={() => {}}
            actions={READONLY_ACTIONS}
          />
          <ResultCard model={model} solution={solution} />
        </aside>
      </div>
      {/* 图层开关：只读页的「看什么」控制，不改数据 */}
      <div className="toolbar flex-wrap gap-x-4 gap-y-1.5 px-6 font-mono text-[11px] text-muted">
        <span>
          重解 {solution.solveMs > 0 ? `${solution.solveMs} ms` : '<1 ms'}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showDeformed} onChange={(e) => setShowDeformed(e.target.checked)} /> 变形层
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> 杆力标签
        </label>
        {model.buckling && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showBuckling} onChange={(e) => setShowBuckling(e.target.checked)} /> 屈曲模态
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-4">
          {kbEntriesForExample(model.id).map((entryId) => (
            <a key={entryId} href={`#/kb/${entryId}`} className="text-cyan transition-colors hover:text-ink">
              知识点 · {KB_BY_ID[entryId]?.title ?? entryId}
            </a>
          ))}
          <a href="#/space/build" className="text-cyan transition-colors hover:text-ink">
            在装配台改这个算例 →
          </a>
        </span>
      </div>
    </>
  );
}

/** 机构只读页：播放条可玩（t 只影响画布游标，不触发重解），参数编辑区隐藏 */
function MechReadonly({ example }: { example: (typeof EXAMPLES_MECH)[number] }) {
  const model = example;
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
            readOnly
            model={model}
            solution={solution}
            t={t}
            onT={setT}
            playing={playing}
            onPlaying={setPlaying}
            speed={speed}
            onSpeed={setSpeed}
            onChange={() => {}}
            onReset={() => {
              setT(0);
              setPlaying(false);
            }}
          />
        </aside>
      </div>
      <div className="toolbar flex-wrap gap-x-4 gap-y-1.5 px-6 font-mono text-[11px] text-muted">
        <span>求解 {solution.solveMs > 0 ? `${solution.solveMs} ms` : '<1 ms'}</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showVel} onChange={(e) => setShowVel(e.target.checked)} /> 速度箭头
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showAcc} onChange={(e) => setShowAcc(e.target.checked)} /> 加速度箭头
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /> 轨迹线
        </label>
        <span className="ml-auto flex flex-wrap items-center gap-x-4">
          {kbEntriesForExample(model.id).map((entryId) => (
            <a key={entryId} href={`#/kb/${entryId}`} className="text-cyan transition-colors hover:text-ink">
              知识点 · {KB_BY_ID[entryId]?.title ?? entryId}
            </a>
          ))}
          <a href="#/space/build" className="text-cyan transition-colors hover:text-ink">
            在装配台改这个算例 →
          </a>
        </span>
      </div>
    </>
  );
}

export function SpaceDetail({ exampleId, onBack }: { exampleId: string; onBack: () => void }) {
  const truss = EXAMPLES.find((e) => e.id === exampleId);
  const mech = truss ? undefined : EXAMPLES_MECH.find((e) => e.id === exampleId);
  const name = truss?.name ?? mech?.name;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <SiteHeader
        onBack={onBack}
        backLabel="算例库"
        page="space"
        title={`${exampleId} · ${name ?? '未知算例'}`}
        note="只读模板 · 改模型去装配台"
        width={1600}
      />
      {!truss && !mech ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-[15px] text-ink">没有算例 {exampleId}</p>
          <a href="#/space" className="text-[13px] text-cyan transition-colors hover:text-ink">
            ← 回三维算例库
          </a>
        </div>
      ) : truss ? (
        <TrussReadonly key={truss.id} example={truss} />
      ) : (
        <MechReadonly key={mech!.id} example={mech!} />
      )}
    </div>
  );
}
