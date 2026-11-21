import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { Node3 } from "../../core/space/types";
import { tagStyle, useScenePalette } from "./palette";

interface Props {
  nodes: Node3[];
  /** 编辑模式下的结点拾取（优先级最高：球体最近 + stopPropagation） */
  onPick?: (id: string) => void;
  selectedId?: string | null;
  /** 连杆件模式：已选起点的高亮 */
  pendingId?: string | null;
  /** ISSUE-15：拒答时内核指出的缺约束结点（红色标出，便于学生找到问题位置） */
  alertId?: string | null;
}

// 结点球体 + id 标签。标签用 Html 叠加层——drei Text 默认字体走网络，
// 违反零运行时请求约束，禁用。球体色走场景色板，标签色走 CSS 变量（随主题自动切换）。
export default function Nodes({ nodes, onPick, selectedId, pendingId, alertId }: Props) {
  const pal = useScenePalette();
  return (
    <>
      {nodes.map((n) => {
        const sel = n.id === selectedId;
        const pend = n.id === pendingId;
        const alert = n.id === alertId;
        const color = alert ? pal.danger : pend ? pal.ok : sel ? pal.gold : pal.ink;
        const labelColor = alert
          ? "var(--color-danger)"
          : pend
            ? "var(--color-ok)"
            : sel
              ? "var(--color-gold)"
              : "var(--color-muted)";
        return (
          <group key={n.id} position={[n.x, n.y, n.z]}>
            <mesh>
              <sphereGeometry args={[alert ? 0.075 : sel || pend ? 0.06 : 0.045, 20, 20]} />
              <meshStandardMaterial color={color} metalness={0.2} roughness={0.4} />
            </mesh>
            {onPick && (
              // 放大拾取球：0.045 太小点不准，透明壳只接事件不渲染
              <mesh
                onClick={(e: ThreeEvent<MouseEvent>) => {
                  if (e.delta > 4) return; // 轨道拖拽松手不算点击
                  e.stopPropagation();
                  onPick(n.id);
                }}
              >
                <sphereGeometry args={[0.11, 8, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
            <Html center style={tagStyle(labelColor, { fontSize: "9.5px", transform: "translateY(-12px)" })}>
              {n.id}
            </Html>
          </group>
        );
      })}
    </>
  );
}
