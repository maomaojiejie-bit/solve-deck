import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { Member, MemberForce, Node3, Solution3D } from "../../core/space/types";
import { tagStyle, useScenePalette, type ScenePalette } from "./palette";

const UP = new Vector3(0, 1, 0);

// 杆力色标：拉红压蓝，零杆灰（与结果卡 chip 同口径，图/数一套色系）。
// 构件本体走场景色板 hex（WebGL 吃不了 CSS 变量），数值标签走 CSS 变量随主题自动切换。
// ISSUE-16：零杆判据只认内核的 kind（相对阈值 maxN·1e-6），不再用本地的 N === 0，
// 否则会出现「表格说零杆、画布颜色却不是零杆」。
export function forceColor(kind: MemberForce["kind"] | undefined, pal: ScenePalette): string {
  if (kind === undefined || kind === "zero") return pal.zero;
  return kind === "tension" ? pal.tension : pal.compression;
}
const forceLabelVar = (kind: MemberForce["kind"] | undefined): string =>
  kind === undefined || kind === "zero" ? "var(--color-faint)" : kind === "tension" ? "var(--color-danger)" : "var(--color-cyan)";

/** ISSUE-16：画布标签与结果卡统一两位小数，负零归一（-0.00 → 0.00） */
const kNLabel = (N: number): string => {
  const v = N / 1000;
  return `${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)} kN`;
};

interface MeshProps {
  from: Node3;
  to: Node3;
  color: string;
  labelColor?: string;
  radius?: number;
  label?: string;
  /** ISSUE-17：标签上下错开，减少密集模型里读数互相压字 */
  labelDy?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

// 杆件 = 两端点之间的圆柱：位置取中点，朝向由 (0,1,0) 旋到杆轴方向
function MemberMesh({ from, to, color, labelColor, radius = 0.018, label, labelDy = 0, onClick }: MeshProps) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new Vector3(from.x, from.y, from.z);
    const end = new Vector3(to.x, to.y, to.z);
    const dir = end.clone().sub(start);
    const len = dir.length();
    return {
      position: start.clone().addScaledVector(dir, 0.5),
      quaternion: new Quaternion().setFromUnitVectors(UP, dir.normalize()),
      length: len,
    };
  }, [from, to]);

  return (
    <group>
      <mesh position={position} quaternion={quaternion} onClick={onClick}>
        <cylinderGeometry args={[radius, radius, length, 12]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
      </mesh>
      {label && (
        <Html position={position} center style={tagStyle(labelColor ?? color, { transform: `translateY(${labelDy}px)` })}>
          {label}
        </Html>
      )}
    </group>
  );
}

interface Props {
  members: Member[];
  byId: Map<string, Node3>;
  /** 传入解则按杆力着色（+可选数值标签）；拒答/无解时全灰 */
  solution?: Solution3D;
  showLabels?: boolean;
  radius?: number;
  /** 无视杆力，统一着色（变形层用） */
  colorOverride?: string;
  /** 编辑模式下的杆件拾取（优先级低于结点：球体拾取壳更大更近） */
  onPick?: (id: string) => void;
  selectedId?: string | null;
}

export default function Members({ members, byId, solution, showLabels, radius, colorOverride, onPick, selectedId }: Props) {
  const pal = useScenePalette();
  // 实体块内部的隐藏刚性连接不画（求解仍消费它们）
  const visible = useMemo(() => members.filter((m) => !m.hidden), [members]);
  const hiddenIds = useMemo(() => new Set(members.filter((m) => m.hidden).map((m) => m.id)), [members]);
  const forceById = useMemo(
    () => new Map(solution?.memberForces.map((f) => [f.id, f]) ?? []),
    [solution],
  );
  // ISSUE-17 / I-4：密集模型只标 |N| 最大的前 8 根（且不低于最大值的 3%），
  // 否则 52 根杆会同时挂 44 个标签糊成一片；选中的构件永远显示。
  const labelCut = useMemo(() => {
    const mags = (solution?.memberForces ?? [])
      .filter((f) => !hiddenIds.has(f.id))
      .map((f) => Math.abs(f.N))
      .sort((a, b) => b - a);
    if (!mags.length) return 0;
    const top8 = mags[Math.min(7, mags.length - 1)];
    return Math.max(mags[0] * 0.03, top8);
  }, [solution, hiddenIds]);
  return (
    <>
      {visible.map((m, i) => {
        const a = byId.get(m.a);
        const b = byId.get(m.b);
        if (!a || !b) return null;
        const f = forceById.get(m.id);
        const sel = m.id === selectedId;
        const label = showLabels && f && ((f.kind !== "zero" && Math.abs(f.N) >= labelCut) || sel) ? kNLabel(f.N) : undefined;
        return (
          <MemberMesh
            key={m.id}
            from={a}
            to={b}
            color={colorOverride ?? forceColor(f?.kind, pal)}
            labelColor={forceLabelVar(f?.kind)}
            labelDy={i % 2 === 0 ? -7 : 7}
            radius={sel ? 0.052 : radius ?? (m.kind === "beam" ? 0.03 : undefined)}
            label={label}
            onClick={
              onPick
                ? (e: ThreeEvent<MouseEvent>) => {
                    if (e.delta > 4) return;
                    e.stopPropagation();
                    onPick(m.id);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
