import { useMemo } from "react";
import type { Member, Node3, Solution3D } from "../../core/space/types";
import Members from "./Members";
import { useScenePalette } from "./palette";

interface Props {
  members: Member[];
  nodes: Node3[];
  solution: Solution3D;
  /** 位移放大系数（真实位移太小，肉眼不可见） */
  scale: number;
}

/** 变形叠加层：把解出的结点位移放大 scale 倍后，用细黄色杆重画一遍杆件。 */
export default function Deformed({ members, nodes, solution, scale }: Props) {
  const pal = useScenePalette();
  const displaced = useMemo(() => {
    return nodes.map((n) => {
      const d = solution.displacements?.[n.id];
      if (!d) return n;
      return { ...n, x: n.x + d[0] * scale, y: n.y + d[1] * scale, z: n.z + d[2] * scale };
    });
  }, [nodes, solution, scale]);

  const byId = useMemo(() => new Map(displaced.map((n) => [n.id, n])), [displaced]);
  return <Members members={members} byId={byId} radius={0.008} colorOverride={pal.gold} />;
}
