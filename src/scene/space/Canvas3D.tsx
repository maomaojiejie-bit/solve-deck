import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Solution3D, TrussModel } from "../../core/space/types";
import { nodeMap } from "../../core/space/types";
import Members from "./Members";
import Solids from "./Solids";
import Nodes from "./Nodes";
import Supports from "./Supports";
import Loads, { MemberLoadArrows } from "./Loads";
import Deformed from "./Deformed";
import BucklingMode from "./BucklingMode";
import Reactions from "./Reactions";
import { useScenePalette } from "./palette";

/** ISSUE-02：视图预设（适配/正视/俯视/轴测），由页面浮动按钮触发 */
export type ViewKind = "fit" | "front" | "top" | "iso";

interface OrbitLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/** 坐标轴字母：画进 CanvasTexture 的 Sprite（不用 drei Html，避免每次挂载多一个 React root）。 */
function AxisLabel({ text, color, position, size = 0.24 }: { text: string; color: string; position: [number, number, number]; size?: number }) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "bold 44px ui-monospace, monospace";
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 32, 34);
    const t = new CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }, [text, color]);
  return (
    <sprite position={position} scale={[size, size, size]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

/**
 * ISSUE-02 / 评审 P0-1：相机适配模型。
 * 相机位置只在「首次挂载」与「点视图预设按钮（nonce 递增）」时改变；
 * 模型编辑（加结点/改几何）只更新 OrbitControls.target，绝不重设 position ——
 * 否则每放一个点视角就被拉回默认，用户没法连续摆点。
 */
function CameraRig({ center, radius, viewRequest }: { center: [number, number, number]; radius: number; viewRequest?: { nonce: number; kind: ViewKind } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const nonce = viewRequest?.nonce ?? 0;
  const kind = viewRequest?.kind ?? "fit";
  const mounted = useRef(false);
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (!nonce && !first) return;
    const d = radius * 2.4;
    const p: [number, number, number] =
      kind === "front"
        ? [center[0], center[1] + radius * 0.25, center[2] + d]
        : kind === "top"
          ? [center[0] + 1e-3, center[1] + d, center[2]]
          : kind === "iso"
            ? [center[0] + d * 0.66, center[1] + d * 0.66, center[2] + d * 0.66]
            : [center[0] + radius * 1.9, center[1] + radius * 1.5, center[2] + radius * 2.1];
    camera.position.set(p[0], p[1], p[2]);
    if (controls) {
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    }
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
    // 依赖只挂 nonce：中心/半径取点击那一刻的最新闭包值，避免编辑时相机乱跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  // 模型重心变化：只跟 target，不动相机位置（用户当前视角/俯视/正视都保留）
  useEffect(() => {
    if (!controls) return;
    controls.target.set(center[0], center[1], center[2]);
    controls.update();
  }, [controls, center[0], center[1], center[2]]);
  return null;
}

interface Props {
  model: TrussModel;
  solution: Solution3D;
  showDeformed: boolean;
  showLabels: boolean;
  /** Q2：solution.buckling.ok 时叠加一阶屈曲模态（橙色细杆） */
  showBuckling: boolean;
  /** 位移放大系数（0 = 无位移可显） */
  deformScale: number;
  // ---- P5 编辑拾取（不传即纯查看模式） ----
  onPickNode?: (id: string) => void;
  onPickMember?: (id: string) => void;
  /** 点实体块本体（外壳，不是结点） */
  onPickSolid?: (id: string) => void;
  /** 贴地平面拾取（加结点落点，吸附由调用方处理） */
  onPickGround?: (x: number, z: number) => void;
  selectedNodeId?: string | null;
  selectedMemberId?: string | null;
  pendingNodeId?: string | null;
  /** ISSUE-15：拒答时内核指出的缺约束结点，画布用红色标出 */
  alertNodeId?: string | null;
  /** ISSUE-24：地面落点预览（已吸附的 x/z；null = 不显示） */
  groundPreview?: [number, number] | null;
  /** 地面指针移动回调（调用方负责吸附/节流） */
  onHoverGround?: (x: number, z: number) => void;
  /** 放置类工具时画布用十字光标 */
  pickCursor?: boolean;
  /** ISSUE-02：视图预设请求（nonce 递增触发取景） */
  viewRequest?: { nonce: number; kind: ViewKind };
}

export default function Canvas3D({
  model,
  solution,
  showDeformed,
  showLabels,
  showBuckling,
  deformScale,
  onPickNode,
  onPickMember,
  onPickSolid,
  onPickGround,
  selectedNodeId,
  selectedMemberId,
  pendingNodeId,
  alertNodeId,
  groundPreview,
  onHoverGround,
  pickCursor,
  viewRequest,
}: Props) {
  const byId = useMemo(() => nodeMap(model), [model]);
  const pal = useScenePalette();
  const maxMag = useMemo(
    () => Math.max(1e-9, ...model.loads.map((l) => Math.hypot(l.fx ?? 0, l.fy ?? 0, l.fz ?? 0))),
    [model],
  );

  // 相机适配：target 锁结构重心，推拉范围按外接半径给
  const { center, radius } = useMemo(() => {
    const c: [number, number, number] = [0, 0, 0];
    for (const n of model.nodes) {
      c[0] += n.x / model.nodes.length;
      c[1] += n.y / model.nodes.length;
      c[2] += n.z / model.nodes.length;
    }
    let r = 0;
    for (const n of model.nodes) r = Math.max(r, Math.hypot(n.x - c[0], n.y - c[1], n.z - c[2]));
    return { center: c, radius: Math.max(0.8, r) };
  }, [model]);

  // ISSUE-02：网格尺寸随包围盒自适应（5 m 步进取整），并与贴地拾取平面一致
  const gridSize = Math.max(10, Math.ceil((radius * 4) / 5) * 5);
  const gridDiv = Math.min(120, gridSize);
  // 坐标轴长度跟着模型尺度走：空模型 1.2 m、大模型最多 2.4 m，保证 X/Y/Z 文字落在画布内
  const axisLen = Math.max(1.2, Math.min(2.4, radius * 1.2));

  return (
    // 透明画布：不设 scene.background，页面 .canvas-solid 实色底直接透出，
    // 深浅主题随 body token 自动切换；网格/坐标轴色走场景色板。
    <Canvas
      gl={{ alpha: true }}
      style={{ background: "transparent", cursor: pickCursor ? "crosshair" : undefined }}
      camera={{ fov: 50 }}
    >
      <CameraRig center={center} radius={Math.max(radius, axisLen)} viewRequest={viewRequest} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <gridHelper args={[gridSize, gridDiv, pal.gridMajor, pal.gridMinor]} position={[center[0], 0, center[2]]} />
      <axesHelper args={[axisLen]} />
      {/* 评审 L-8：坐标轴补 X/Y/Z 文字（绿竖=Y、橙=X、蓝=Z 不再靠猜） */}
      <AxisLabel text="X" color={pal.axis[0]} position={[axisLen * 1.06, 0, 0]} />
      <AxisLabel text="Y" color={pal.axis[1]} position={[0, axisLen * 1.06, 0]} />
      <AxisLabel text="Z" color={pal.axis[2]} position={[0, 0, axisLen * 1.06]} />
      {onPickGround && (
        // 贴地拾取平面：透明壳，结点/杆件 stopPropagation 保证拾取优先级 结点>杆件>地面
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[center[0], 0, center[2]]}
          onPointerMove={
            onHoverGround
              ? (e: ThreeEvent<PointerEvent>) => {
                  e.stopPropagation();
                  onHoverGround(e.point.x, e.point.z);
                }
              : undefined
          }
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (e.delta > 4) return;
            e.stopPropagation();
            onPickGround(e.point.x, e.point.z);
          }}
        >
          <planeGeometry args={[gridSize, gridSize]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {/* ISSUE-24：落点预览（金色半透明球 + 地面圆环），坐标为调用方吸附后的落点 */}
      {groundPreview && (
        <group position={[groundPreview[0], 0, groundPreview[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <ringGeometry args={[0.16, 0.22, 32]} />
            <meshBasicMaterial color={pal.gold} transparent opacity={0.85} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0.045, 0]}>
            <sphereGeometry args={[0.045, 16, 16]} />
            <meshBasicMaterial color={pal.gold} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        </group>
      )}
      {/* 实体块：半透明填充 + 棱线，压在杆件/结点下面；结点仍可正常拾取 */}
      <Solids solids={model.solids ?? []} onPick={onPickSolid} />
      <Members
        members={model.members}
        byId={byId}
        solution={solution}
        showLabels={showLabels}
        onPick={onPickMember}
        selectedId={selectedMemberId}
      />
      <Nodes nodes={model.nodes} onPick={onPickNode} selectedId={selectedNodeId} pendingId={pendingNodeId} alertId={alertNodeId} />
      <Supports supports={model.supports} byId={byId} />
      <Loads loads={model.loads} byId={byId} maxMag={maxMag} />
      <MemberLoadArrows members={model.members} memberLoads={model.memberLoads ?? []} byId={byId} />
      {showDeformed && deformScale > 0 && (
        <Deformed members={model.members} nodes={model.nodes} solution={solution} scale={deformScale} />
      )}
      {showBuckling && solution.buckling?.ok && (
        <BucklingMode members={model.members} nodes={model.nodes} report={solution.buckling} scale={radius * 0.18} />
      )}
      {/* Q3 刚体路由才叠加受力图（FBD）层；T/B/C 算例有 reactions 也不渲染，保证原显示零变化 */}
      {model.rigid && <Reactions solution={solution} nodes={model.nodes} />}
      {/* 相机边界：限制推拉范围与俯仰，避免钻到地面下丢失参照 */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={center}
        minDistance={radius * 0.8}
        maxDistance={radius * 8}
        maxPolarAngle={Math.PI / 2 + 0.12}
      />
    </Canvas>
  );
}
