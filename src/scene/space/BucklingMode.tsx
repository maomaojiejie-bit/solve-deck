import { useMemo } from "react";
import type { BucklingReport, Member, Node3 } from "../../core/space/types";
import Members from "./Members";
import { useScenePalette } from "./palette";

interface Props {
  members: Member[];
  nodes: Node3[];
  report: BucklingReport;
  /** 模态显示幅值（m）：模态已按最大平动分量归一为 1 */
  scale: number;
}

/** 屈曲模态叠加层：结点沿一阶模态位移放大 scale 倍后，用橙色细杆重画一遍杆件。 */
export default function BucklingMode({ members, nodes, report, scale }: Props) {
  const pal = useScenePalette();
  const displaced = useMemo(() => {
    const d = new Map(report.mode.map((m) => [m.node, m.d]));
    return nodes.map((n) => {
      const v = d.get(n.id);
      if (!v) return n;
      return { ...n, x: n.x + v[0] * scale, y: n.y + v[1] * scale, z: n.z + v[2] * scale };
    });
  }, [nodes, report, scale]);

  const byId = useMemo(() => new Map(displaced.map((n) => [n.id, n])), [displaced]);
  return <Members members={members} byId={byId} radius={0.008} colorOverride={pal.danger} />;
}
