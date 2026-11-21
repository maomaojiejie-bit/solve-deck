import { useMemo } from "react";
import { ArrowHelper, Quaternion, Vector3 } from "three";
import { Html, Line } from "@react-three/drei";
import type { Node3, Solution3D } from "../../core/space/types";
import { tagStyle, useScenePalette } from "./palette";

// Q3 刚体静力（E2）受力图（FBD）层：支座反力分量箭头 + 反力矩弧箭头 + 铰力 + 重心 + 摩擦状态。
// 仅 model.rigid 路由挂载（Canvas3D 处门控），一期/二期算例不渲染本组件。
const AXIS_VEC: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const AXIS_CN = ["x", "y", "z"];
const STATE_CN: Record<string, string> = { stick: "静止", critical: "临界", slip: "滑动", separate: "脱离" };
const UP = new Vector3(0, 1, 0);

interface Props {
  solution: Solution3D;
  nodes: Node3[];
}

/** 画布文字标签（统一走 tagStyle：等宽字体 + token 色 + 自适应光晕，不拦截鼠标）。 */
function Tag({ pos, color, text, dy = 12 }: { pos: [number, number, number]; color: string; text: string; dy?: number }) {
  return (
    <Html position={pos} center style={tagStyle(color, { transform: `translateY(${dy}px)` })}>
      {text}
    </Html>
  );
}

export default function Reactions({ solution, nodes }: Props) {
  const pal = useScenePalette();
  const items = useMemo(() => {
    const STATE_COLOR: Record<string, string> = { stick: pal.ok, critical: pal.amber, slip: pal.danger, separate: pal.danger };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const posOf = (id: string): Vector3 | null => {
      const nd = byId.get(id);
      return nd ? new Vector3(nd.x, nd.y, nd.z) : null;
    };

    // —— 支座反力分量箭头（绿色，长度按最大分量归一到 0.55 m，同 Loads 口径）——
    let maxF = 1e-9;
    const forceRaw: { node: string; k: number; v: number }[] = [];
    for (const [node, r] of Object.entries(solution.reactions)) {
      for (let k = 0; k < 3; k++) {
        const v = r[k];
        if (Math.abs(v) < 1e-9) continue;
        forceRaw.push({ node, k, v });
        maxF = Math.max(maxF, Math.abs(v));
      }
    }
    const forces = forceRaw.flatMap(({ node, k, v }) => {
      const p = posOf(node);
      if (!p) return [];
      const dir = new Vector3(...AXIS_VEC[k]);
      const len = 0.55 * (Math.abs(v) / maxF);
      const arrow = new ArrowHelper(dir, p, len, pal.ok, len * 0.32, 0.06);
      const tip = p.clone().addScaledVector(dir, len);
      const lbl = solution.reactionLabels?.[node]?.force?.[k] || `F${node}·${AXIS_CN[k]}`;
      return [{ key: `f:${node}:${k}`, arrow, tip, text: `${lbl}=${v.toExponential(2)}` }];
    });

    // —— 反力矩分量：绕世界轴采样 1.5π 圆弧（drei Line）+ 端部小锥体，正分量按右手定则 ——
    const moments: { key: string; pts: [number, number, number][]; conePos: [number, number, number]; coneQuat: Quaternion; labelPos: [number, number, number]; text: string }[] = [];
    for (const [node, rm] of Object.entries(solution.reactionMoments ?? {})) {
      const c = posOf(node);
      if (!c) continue;
      for (let k = 0; k < 3; k++) {
        const mv = rm[k];
        if (Math.abs(mv) < 1e-9) continue;
        const axis = new Vector3(...AXIS_VEC[k]);
        const helper = k === 1 ? new Vector3(1, 0, 0) : UP;
        const u = new Vector3().crossVectors(axis, helper).normalize();
        const v = new Vector3().crossVectors(axis, u).normalize();
        const s = mv > 0 ? 1 : -1;
        const r = 0.3;
        const N = 28;
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= N; i++) {
          const th = (i / N) * Math.PI * 1.5 * s;
          const p = c.clone().addScaledVector(u, r * Math.cos(th)).addScaledVector(v, r * Math.sin(th));
          pts.push([p.x, p.y, p.z]);
        }
        const thEnd = Math.PI * 1.5 * s;
        const tan = new Vector3().addScaledVector(u, -Math.sin(thEnd) * s).addScaledVector(v, Math.cos(thEnd) * s).normalize();
        const end = pts[N];
        const conePos: [number, number, number] = [end[0] + tan.x * 0.05, end[1] + tan.y * 0.05, end[2] + tan.z * 0.05];
        const labelPos: [number, number, number] = [end[0] + tan.x * 0.2, end[1] + tan.y * 0.2, end[2] + tan.z * 0.2];
        const lbl = solution.reactionLabels?.[node]?.moment?.[k] || `M${node}·${AXIS_CN[k]}`;
        moments.push({
          key: `m:${node}:${k}`,
          pts,
          conePos,
          coneQuat: new Quaternion().setFromUnitVectors(UP, tan),
          labelPos,
          text: `${lbl}=${mv.toExponential(2)}`,
        });
      }
    }

    // —— 铰接内力箭头（紫色，合力向量，作用在 bodies[1] 上的口径）——
    let maxH = 1e-9;
    for (const hf of solution.hingeForces ?? []) maxH = Math.max(maxH, Math.hypot(...hf.f));
    const hinges = (solution.hingeForces ?? []).flatMap((hf) => {
      const p = posOf(hf.node);
      if (!p) return [];
      const f = new Vector3(...hf.f);
      const mag = f.length();
      if (mag < 1e-9) return [];
      const len = 0.5 * (mag / maxH);
      const dir = f.clone().normalize();
      const arrow = new ArrowHelper(dir, p, len, pal.purple, len * 0.32, 0.06);
      const tip = p.clone().addScaledVector(dir, len);
      return [{ key: `h:${hf.node}:${hf.bodies.join("-")}`, arrow, tip, text: `F(铰→${hf.bodies[1]})=${mag.toExponential(2)}` }];
    });

    // —— 重心标记（黄色小球）与摩擦状态标签 ——
    const centroid = solution.centroid
      ? { pos: solution.centroid.c, text: `C(重心) (${solution.centroid.c.map((x) => x.toFixed(2)).join(", ")})` }
      : null;
    const fric = (solution.friction ?? []).flatMap((fr) => {
      const p = posOf(fr.node);
      if (!p) return [];
      return [{ key: `fr:${fr.node}`, pos: [p.x, p.y + 0.25, p.z] as [number, number, number], color: STATE_COLOR[fr.state], text: `摩擦·${STATE_CN[fr.state]}` }];
    });

    return { forces, moments, hinges, centroid, fric };
  }, [solution, nodes, pal]);

  return (
    <>
      {items.forces.map((it) => (
        <group key={it.key}>
          <primitive object={it.arrow} />
          <Tag pos={[it.tip.x, it.tip.y, it.tip.z]} color="var(--color-ok)" text={it.text} />
        </group>
      ))}
      {items.moments.map((it) => (
        <group key={it.key}>
          <Line points={it.pts} color={pal.ok} lineWidth={2} />
          <mesh position={it.conePos} quaternion={it.coneQuat}>
            <coneGeometry args={[0.05, 0.13, 10]} />
            <meshBasicMaterial color={pal.ok} />
          </mesh>
          <Tag pos={it.labelPos} color="var(--color-ok)" text={it.text} />
        </group>
      ))}
      {items.hinges.map((it) => (
        <group key={it.key}>
          <primitive object={it.arrow} />
          <Tag pos={[it.tip.x, it.tip.y, it.tip.z]} color={pal.purple} text={it.text} />
        </group>
      ))}
      {items.centroid && (
        <group>
          <mesh position={items.centroid.pos}>
            <sphereGeometry args={[0.09, 20, 20]} />
            <meshStandardMaterial color={pal.gold} emissive="#3a2408" />
          </mesh>
          <Tag pos={items.centroid.pos} color="var(--color-gold)" text={items.centroid.text} dy={-16} />
        </group>
      )}
      {items.fric.map((it) => (
        <Tag key={it.key} pos={it.pos} color={it.color} text={it.text} />
      ))}
    </>
  );
}
