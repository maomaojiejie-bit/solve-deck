import { useMemo } from "react";
import { ArrowHelper, Vector3 } from "three";
import { Html } from "@react-three/drei";
import type { Load3, Member, MemberLoad, Node3 } from "../../core/space/types";
import { tagStyle, useScenePalette } from "./palette";

interface Props {
  loads: Load3[];
  byId: Map<string, Node3>;
  /** 最长箭头对应的力值（N），用于把箭头长度归一到 0.55 m */
  maxMag: number;
}

/** 载荷箭头：从结点沿合力方向，长度按最大载荷归一，标签给 kN 数值。 */
export default function Loads({ loads, byId, maxMag }: Props) {
  const pal = useScenePalette();
  const items = useMemo(
    () =>
      loads
        .map((l) => {
          const nd = byId.get(l.node);
          if (!nd) return null;
          const f = new Vector3(l.fx ?? 0, l.fy ?? 0, l.fz ?? 0);
          const mag = f.length();
          if (mag < 1e-12) return null;
          const len = 0.55 * (mag / Math.max(1e-9, maxMag));
          const arrow = new ArrowHelper(f.clone().normalize(), new Vector3(nd.x, nd.y, nd.z), len, pal.amber, len * 0.32, 0.06);
          const tip = new Vector3(nd.x, nd.y, nd.z).addScaledVector(f.clone().normalize(), len);
          return { key: `${l.node}:${l.fx}:${l.fy}:${l.fz}`, arrow, tip, mag };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [loads, byId, maxMag, pal],
  );

  return (
    <>
      {items.map((it) => (
        <group key={it.key}>
          <primitive object={it.arrow} />
          <Html position={[it.tip.x, it.tip.y, it.tip.z]} center style={tagStyle("var(--color-amber)", { transform: "translateY(11px)" })}>
            {/* ISSUE-16：与构件标签/结果卡统一两位小数（原来 1 位，同一张图里三种精度） */}
            {`${(it.mag / 1000).toFixed(2)} kN`}
          </Html>
        </group>
      ))}
    </>
  );
}

/** 均布/梯形的采样位置（避开端点，视觉上一排小箭头骑在梁上）。 */
const SAMPLES = [0.0625, 0.2083, 0.3542, 0.5, 0.6458, 0.7917, 0.9375];

interface MLProps {
  members: Member[];
  memberLoads: MemberLoad[];
  byId: Map<string, Node3>;
}

/** 杆上荷载箭头（紫色）：集中力单箭头 @pos，均布/梯形沿梁一排箭头，长度按集度归一。 */
export function MemberLoadArrows({ members, memberLoads, byId }: MLProps) {
  const pal = useScenePalette();
  const items = useMemo(() => {
    const out: { key: string; arrow: ArrowHelper }[] = [];
    if (!memberLoads.length) return out;
    let maxMag = 1e-9;
    for (const ml of memberLoads) {
      maxMag = Math.max(
        maxMag,
        Math.hypot(ml.fx ?? 0, ml.fy ?? 0, ml.fz ?? 0),
        Math.hypot(ml.fx2 ?? ml.fx ?? 0, ml.fy2 ?? ml.fy ?? 0, ml.fz2 ?? ml.fz ?? 0),
      );
    }
    for (const ml of memberLoads) {
      const mb = members.find((m) => m.id === ml.member);
      const a = mb && byId.get(mb.a);
      const b = mb && byId.get(mb.b);
      if (!a || !b) continue;
      const va = new Vector3(a.x, a.y, a.z);
      const vb = new Vector3(b.x, b.y, b.z);
      const L = va.distanceTo(vb);
      if (L < 1e-9) continue;
      const ss = ml.kind === "point" ? [Math.min(1, Math.max(0, (ml.pos ?? 0) / L))] : SAMPLES;
      for (const s of ss) {
        const lin = (a0: number, b0: number) => (ml.kind === "linear" ? a0 + (b0 - a0) * s : a0);
        const f = new Vector3(
          lin(ml.fx ?? 0, ml.fx2 ?? ml.fx ?? 0),
          lin(ml.fy ?? 0, ml.fy2 ?? ml.fy ?? 0),
          lin(ml.fz ?? 0, ml.fz2 ?? ml.fz ?? 0),
        );
        const mag = f.length();
        if (mag < 1e-12) continue;
        const len = 0.42 * (mag / maxMag);
        const arrow = new ArrowHelper(f.normalize(), va.clone().lerp(vb, s), len, pal.purple, len * 0.35, 0.035);
        out.push({ key: `${ml.member}:${ml.kind}:${s.toFixed(4)}:${ml.pos ?? 0}`, arrow });
      }
    }
    return out;
  }, [members, memberLoads, byId, pal]);

  return (
    <>
      {items.map((it) => (
        <primitive key={it.key} object={it.arrow} />
      ))}
    </>
  );
}
