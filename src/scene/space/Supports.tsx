import { Html } from "@react-three/drei";
import type { Axis, Dof, Node3, Support } from "../../core/space/types";
import { tagStyle, useScenePalette } from "./palette";

// 约束轴向短杆颜色与 axesHelper 一致（走场景色板，深浅两档）；转动锁定用金色环
const AXIS_VEC: Record<Axis, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const ROT_AXIS: Record<string, Axis> = { rx: "x", ry: "y", rz: "z" };

interface Props {
  supports: Support[];
  byId: Map<string, Node3>;
}

/** 支座图元：结点下方锥座 + 平动锁定轴向短杆 + 转动锁定金色环，标签注明锁定自由度。 */
export default function Supports({ supports, byId }: Props) {
  const pal = useScenePalette();
  const AXIS_COLOR: Record<Axis, string> = { x: pal.axis[0], y: pal.axis[1], z: pal.axis[2] };
  return (
    <>
      {supports.map((s) => {
        const nd = byId.get(s.node);
        if (!nd) return null;
        const p: [number, number, number] = [nd.x, nd.y, nd.z];
        const fixed6 = (s.fix as Dof[]).length === 6;
        return (
          <group key={s.node}>
            {/* 锥座：尖端朝上贴近结点球面；固定端加底盘方块 */}
            {fixed6 && (
              <mesh position={[p[0], p[1] - 0.26, p[2]]}>
                <boxGeometry args={[0.3, 0.06, 0.3]} />
                <meshStandardMaterial color={pal.supportBase} metalness={0.3} roughness={0.6} />
              </mesh>
            )}
            <mesh position={[p[0], p[1] - 0.145, p[2]]}>
              <coneGeometry args={[fixed6 ? 0.11 : 0.085, 0.19, 4]} />
              <meshStandardMaterial color={pal.support} metalness={0.3} roughness={0.5} />
            </mesh>
            {s.fix.map((ax) => {
              if (ax === "rx" || ax === "ry" || ax === "rz") {
                const a = ROT_AXIS[ax];
                const rot: [number, number, number] = a === "x" ? [0, Math.PI / 2, 0] : a === "y" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
                return (
                  <mesh key={ax} position={p} rotation={rot}>
                    <torusGeometry args={[0.13, 0.012, 8, 24]} />
                    <meshStandardMaterial color={pal.gold} metalness={0.4} roughness={0.4} />
                  </mesh>
                );
              }
              const v = AXIS_VEC[ax];
              const off = 0.045 + 0.07;
              return (
                <mesh
                  key={ax}
                  position={[p[0] + v[0] * off, p[1] + v[1] * off, p[2] + v[2] * off]}
                  rotation={ax === "y" ? [0, 0, 0] : ax === "x" ? [0, 0, -Math.PI / 2] : [Math.PI / 2, 0, 0]}
                >
                  <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
                  <meshStandardMaterial color={AXIS_COLOR[ax]} />
                </mesh>
              );
            })}
            <Html
              position={[p[0], p[1] - 0.45, p[2]]}
              center
              style={tagStyle("var(--color-muted)", { fontSize: "9.5px" })}
            >
              {/* ISSUE-12/17 + L-5：默认只给紧凑写法（固定端 / 球铰 xyz），
                  不再把「平动 xyz · 转动 rx ry rz · 弹簧 …」堆在结点标签上 */}
              {(() => {
                if (fixed6) return "⚓ 固定端 6";
                const trans = s.fix.filter((d) => d === "x" || d === "y" || d === "z");
                const rots = s.fix.filter((d) => d !== "x" && d !== "y" && d !== "z");
                const parts: string[] = [];
                if (trans.length) parts.push(trans.length === 3 ? "平动 xyz" : `平动 ${trans.join("")}`);
                if (rots.length) parts.push(rots.length === 3 ? "转动 6" : `转动 ${rots.join("")}`);
                if (s.springs?.length) parts.push(`弹簧 ${s.springs.map((sp) => `${sp.dof}${(sp.k / 1e3).toFixed(0)}`).join("、")}`);
                return parts.length ? `⚓ ${parts.join(" · ")}` : null;
              })()}
            </Html>
          </group>
        );
      })}
    </>
  );
}
