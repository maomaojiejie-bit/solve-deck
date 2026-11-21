// 实体块渲染：按 SolidBody 的几何参数画填充面 + 棱线。
// 与 Members 的关系：实体不是求解对象，结点/杆件仍在上面真实受力；
// 这里只负责「看得见一个真块」，所以画在杆件下层、半透明、不写深度。
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { SolidBody } from "../../core/space/types";
import { useScenePalette, type ScenePalette } from "./palette";

/** 与 generator.addSolid 同一套环坐标口径：sides=4 走盒角（45°+90°i、半径 √2），其余走外接椭圆等分角 */
function buildGeometry(s: SolidBody): THREE.BufferGeometry {
  const sides = Math.min(16, Math.max(3, Math.round(s.sides || 4)));
  const phase = sides === 4 ? Math.PI / 4 : Math.PI / 2;
  const k = sides === 4 ? Math.SQRT2 : 1;
  const sw = Math.max(0, s.topScaleW ?? 1);
  const sd = Math.max(0, s.topScaleD ?? 1);
  const twist = ((s.twist ?? 0) * Math.PI) / 180;

  const bot: [number, number, number][] = [];
  const top: [number, number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const th = phase + (i * 2 * Math.PI) / sides;
    bot.push([s.cx + ((s.w / 2) * k * Math.cos(th)), s.cy, s.cz + ((s.d / 2) * k * Math.sin(th))]);
    const th2 = th + twist;
    top.push([s.cx + ((s.w / 2) * k * sw * Math.cos(th2)), s.cy + s.h, s.cz + ((s.d / 2) * k * sd * Math.sin(th2))]);
  }

  const pos: number[] = [];
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) =>
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    // 侧面：四边形拆两片三角；顶面收尖时其中一片退化，不影响
    tri(bot[i], bot[j], top[j]);
    tri(bot[i], top[j], top[i]);
  }
  // 上下封盖：扇形三角化（底面朝下、顶面朝上，配合 DoubleSide 无需纠结绕序）
  for (let i = 1; i < sides - 1; i++) {
    tri(bot[0], bot[i + 1], bot[i]);
    tri(top[0], top[i], top[i + 1]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function SolidMesh({ solid, pal, onPick }: { solid: SolidBody; pal: ScenePalette; onPick?: (id: string) => void }) {
  const geom = useMemo(() => buildGeometry(solid), [solid]);
  // 棱线只取折角处（≥24°），侧面被拆出的共面三角线不会冒出来
  const edges = useMemo(() => new THREE.EdgesGeometry(geom, 24), [geom]);

  useEffect(
    () => () => {
      geom.dispose();
      edges.dispose();
    },
    [geom, edges],
  );

  return (
    <group>
      <mesh
        geometry={geom}
        renderOrder={-2}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          // 实体表面挡住身后的地面拾取：否则点在块上会把新结点/实体放到底面后面
          if (e.delta > 4) return;
          e.stopPropagation();
          onPick?.(solid.id);
        }}
      >
        <meshStandardMaterial
          color={pal.muted}
          transparent
          opacity={0.22}
          roughness={0.92}
          metalness={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={edges} renderOrder={-1}>
        <lineBasicMaterial color={pal.faint} transparent opacity={0.85} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

export default function Solids({ solids, onPick }: { solids: SolidBody[]; onPick?: (id: string) => void }) {
  const pal = useScenePalette();
  if (!solids.length) return null;
  return (
    <group>
      {solids.map((s) => (
        <SolidMesh key={s.id} solid={s} pal={pal} onPick={onPick} />
      ))}
    </group>
  );
}
