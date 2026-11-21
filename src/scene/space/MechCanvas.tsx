// Q4 E3 运动学/动力学 3D 动画层：按帧线性插值渲染机构位形 + 轨迹线 + 速度/加速度箭头。
// 与 Canvas3D（静力）并列的独立画布，只消费 SolutionKin.frames 的 pts/vel/acc，不碰 E1/E2 路径。
import { useMemo } from "react";
import { ArrowHelper, Quaternion, Vector3 } from "three";
import { Canvas } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { KinFrame, MechModel, SolutionKin } from "../../core/space/types";
import { tagStyle, useScenePalette } from "./palette";

type V3 = [number, number, number];

const UP = new Vector3(0, 1, 0);

/** 在均匀采样帧序列上对 t 做线性插值（vel/acc 取最近帧，仅用于箭头方向展示） */
function frameAt(frames: KinFrame[], t: number): KinFrame | null {
  if (!frames.length) return null;
  const n = frames.length;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[n - 1].t) return frames[n - 1];
  let i = 0;
  while (i < n - 2 && frames[i + 1].t < t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const pts: Record<string, V3> = {};
  for (const k of Object.keys(b.pts)) {
    const pa = a.pts[k] ?? b.pts[k];
    const pb = b.pts[k];
    pts[k] = [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u];
  }
  return { t, pts, vel: b.vel, acc: b.acc };
}

interface Props {
  model: MechModel;
  solution: SolutionKin;
  /** 当前播放时刻（s） */
  t: number;
  showVel: boolean;
  showAcc: boolean;
  showTrail: boolean;
}

export default function MechCanvas({ model, solution, t, showVel, showAcc, showTrail }: Props) {
  const frames = solution.frames;
  const pal = useScenePalette();

  const meta = useMemo(() => {
    const keys = new Set<string>();
    for (const f of frames) for (const k of Object.keys(f.pts)) keys.add(k);
    const moving: string[] = [];
    const trails: Record<string, V3[]> = {};
    for (const k of keys) {
      let moved = 0;
      let prev: V3 | null = null;
      const pts: V3[] = [];
      for (const f of frames) {
        const p = f.pts[k];
        if (!p || !p.every(Number.isFinite)) continue;
        if (prev) moved = Math.max(moved, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
        prev = p;
        pts.push(p);
      }
      trails[k] = pts;
      if (moved > 1e-9) moving.push(k);
    }
    // 相机包围盒（全帧全点）
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const f of frames)
      for (const p of Object.values(f.pts))
        for (let k = 0; k < 3; k++) {
          if (!Number.isFinite(p[k])) continue;
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
    const center: V3 = lo.map((v, i) => (Number.isFinite(v) ? (v + hi[i]) / 2 : 0)) as V3;
    let radius = 0;
    for (const f of frames) for (const p of Object.values(f.pts)) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
    radius = Math.max(0.8, radius);
    // 箭头归一：全帧最大 |v|、|a|
    let maxV = 1e-9;
    let maxA = 1e-9;
    for (const f of frames) {
      for (const v of Object.values(f.vel ?? {})) maxV = Math.max(maxV, Math.hypot(...v));
      for (const a of Object.values(f.acc ?? {})) maxA = Math.max(maxA, Math.hypot(...a));
    }
    return { moving: new Set(moving), trails, center, radius, maxV, maxA };
  }, [frames]);

  const cur = useMemo(() => frameAt(frames, t), [frames, t]);

  if (!cur) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-muted">
        无运动解（拒答或空模型）——请在右侧查看原因
      </div>
    );
  }

  const { center, radius } = meta;
  const dotR = Math.min(0.12, Math.max(0.03, radius * 0.03));
  const rodR = Math.min(0.05, Math.max(0.012, radius * 0.016));

  // 杆件端点：优先当前帧 pts（D2 的 B1/B2 不在 nodes 中），回退静态 nodes 坐标
  const nodeById = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z] as V3]));
  const posOf = (id: string): V3 | null => cur.pts[id] ?? nodeById.get(id) ?? null;

  const arrows: { key: string; obj: ArrowHelper }[] = [];
  if (showVel || showAcc) {
    for (const k of Object.keys(cur.pts)) {
      const p = cur.pts[k];
      if (showVel) {
        const v = cur.vel?.[k];
        if (v && v.every(Number.isFinite)) {
          const mag = Math.hypot(...v);
          if (mag > 1e-9) {
            const len = radius * 0.45 * (mag / meta.maxV);
            arrows.push({ key: `v:${k}`, obj: new ArrowHelper(new Vector3(...v).normalize(), new Vector3(...p), len, pal.ok, len * 0.3, rodR * 3) });
          }
        }
      }
      if (showAcc) {
        const a = cur.acc?.[k];
        if (a && a.every(Number.isFinite)) {
          const mag = Math.hypot(...a);
          if (mag > 1e-9) {
            const len = radius * 0.45 * (mag / meta.maxA);
            arrows.push({ key: `a:${k}`, obj: new ArrowHelper(new Vector3(...a).normalize(), new Vector3(...p), len, pal.danger, len * 0.3, rodR * 3) });
          }
        }
      }
    }
  }

  return (
    <Canvas
      gl={{ alpha: true }}
      style={{ background: "transparent" }}
      camera={{ position: [center[0] + radius * 1.9, center[1] + radius * 1.4, center[2] + radius * 2.1], fov: 50 }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <gridHelper args={[Math.max(10, radius * 4), 20, pal.gridMajor, pal.gridMinor]} />
      <axesHelper args={[radius * 0.8]} />

      {showTrail &&
        [...meta.moving].map((k) =>
          meta.trails[k].length > 1 ? <Line key={`tr:${k}`} points={meta.trails[k]} color={pal.gold} lineWidth={2} transparent opacity={0.9} /> : null,
        )}

      {(model.members ?? []).flatMap((mb) => {
        const a = posOf(mb.a);
        const b = posOf(mb.b);
        if (!a || !b) return [];
        const va = new Vector3(...a);
        const vb = new Vector3(...b);
        const d = vb.clone().sub(va);
        const len = d.length();
        if (len < 1e-9) return [];
        const mid = va.clone().addScaledVector(d, 0.5);
        const quat = new Quaternion().setFromUnitVectors(UP, d.clone().normalize());
        return [
          <mesh key={mb.id} position={mid} quaternion={quat}>
            <cylinderGeometry args={[rodR, rodR, len, 12]} />
            <meshStandardMaterial color={pal.compression} />
          </mesh>,
        ];
      })}

      {Object.entries(cur.pts).map(([k, p]) => (
        <group key={`pt:${k}`}>
          <mesh position={p}>
            <sphereGeometry args={[meta.moving.has(k) ? dotR : dotR * 0.8, 18, 18]} />
            <meshStandardMaterial color={meta.moving.has(k) ? pal.amber : pal.zero} emissive={meta.moving.has(k) ? "#3a2408" : "#000000"} />
          </mesh>
          <Html position={p} center style={tagStyle("var(--color-ink)", { transform: "translateY(-13px)" })}>
            {k}
          </Html>
        </group>
      ))}

      {arrows.map((it) => (
        <primitive key={it.key} object={it.obj} />
      ))}

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={center} minDistance={radius * 0.8} maxDistance={radius * 10} />
    </Canvas>
  );
}
