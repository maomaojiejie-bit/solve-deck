/**
 * 莫尔圆引擎：把 MohrSpec 画成 SVG。
 *
 * 硬要求：σ 轴与 τ 轴的**每单位长度像素完全相同**，所以画出来必然是圆而不是椭圆。
 * 圆心 (σx+σy)/2、半径 R、σ1/σ2/τmax、θp 全部从 spec 读；
 * 这里一个数都不重算 —— 重算就等于悄悄用第二个数据源，画的和查的就不是一回事了。
 */

import type { MohrSpec } from '../core/types';
import { mohrLayout } from './mohrLayout';

const LINE = 'var(--schematic-idle)';
const ACCENT = 'var(--schematic-active)';
const TEXT = 'var(--schematic-text)';
const AMBER = 'var(--color-amber, #d97706)';

function fmt(value: number): string {
  return String(Number(value.toPrecision(4)));
}

export function Mohr({ spec }: { spec: MohrSpec }) {
  const layout = mohrLayout(spec);
  const { size, pad, px, py, axisX, axisY, scaleX, scaleY } = layout;
  const cxPx = px(spec.center);
  const cyPx = py(0);

  // 主平面方向：从 +σ 轴量起，逆时针为正（屏幕上 τ 向上为正，所以取负角）
  const thetaRad = (spec.thetaP * Math.PI) / 180;
  const dirX = cxPx + Math.cos(thetaRad) * layout.rx;
  const dirY = cyPx - Math.sin(thetaRad) * layout.rx;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-auto w-full"
      role="img"
      aria-label="mohr circle"
      preserveAspectRatio="xMidYMid meet"
      data-needle="mohr"
      data-scale-ratio={String(scaleX / scaleY)}
      style={{ maxHeight: 420 }}
    >
      <line x1={pad - 10} x2={size - pad + 10} y1={axisY} y2={axisY} stroke={TEXT} strokeOpacity={0.5} />
      <line x1={axisX} x2={axisX} y1={pad - 10} y2={size - pad + 10} stroke={TEXT} strokeOpacity={0.5} />

      {/* 圆：rx 与 ry 来自同一 scale，所以是正圆 */}
      <ellipse
        cx={cxPx}
        cy={cyPx}
        rx={layout.rx}
        ry={layout.ry}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.8}
      />
      <circle cx={cxPx} cy={cyPx} r={2.4} fill={ACCENT} />
      <text x={cxPx} y={cyPx + 30} textAnchor="middle" fontSize={9.5} fill={TEXT} fillOpacity={0.75}>
        C={fmt(spec.center)}　R={fmt(spec.radius)}
      </text>

      {/* 主平面方向线 + 应力点 (σx, τxy) */}
      <line
        x1={cxPx}
        y1={cyPx}
        x2={dirX}
        y2={dirY}
        stroke={AMBER}
        strokeDasharray="4 3"
        strokeWidth={1.2}
      />
      <text x={dirX + 5} y={dirY - 6} fontSize={9.5} fill={AMBER}>
        θp={fmt(spec.thetaP)}°
      </text>

      <circle cx={px(spec.sigmaX)} cy={py(spec.tauXY)} r={2.8} fill={ACCENT} />
      <text x={px(spec.sigmaX) + 7} y={py(spec.tauXY) - 6} fontSize={9.5} fill={ACCENT}>
        ({fmt(spec.sigmaX)}, {fmt(spec.tauXY)})
      </text>
      <line
        x1={px(spec.sigmaX)}
        y1={py(spec.tauXY)}
        x2={px(spec.sigmaX)}
        y2={py(-spec.tauXY)}
        stroke={LINE}
        strokeDasharray="4 3"
      />

      {[
        // 标注一律往圆内写：圆形几乎铺满绘图区，写在轴外侧会被 SVG 边界切掉，
        // 写在轴上又正好压在圆周那一点上。圆内靠两端处是空的，读数最干净。
        { sigma: spec.sigma1, label: 'σ1', anchor: 'end' as const, dx: -7 },
        { sigma: spec.sigma2, label: 'σ2', anchor: 'start' as const, dx: 7 },
      ].map((item) => (
        <g key={item.label}>
          <line
            x1={px(item.sigma)}
            x2={px(item.sigma)}
            y1={axisY - 5}
            y2={axisY + 5}
            stroke={TEXT}
            strokeOpacity={0.7}
          />
          <text
            x={px(item.sigma) + item.dx}
            y={axisY - 7}
            textAnchor={item.anchor}
            fontSize={10}
            fill={TEXT}
          >
            {item.label}={fmt(item.sigma)}
          </text>
        </g>
      ))}

      <line x1={cxPx} x2={cxPx} y1={cyPx} y2={py(spec.tauMax)} stroke={LINE} strokeDasharray="3 3" />
      <text x={cxPx + 6} y={py(spec.tauMax) - 4} fontSize={9.5} fill={TEXT} fillOpacity={0.85}>
        τmax={fmt(spec.tauMax)}
      </text>

      {/* 轴单位放到绘图区外沿：贴着轴写会同时压住圆周和 σ1 标注 */}
      <text x={size - 4} y={axisY - 6} fontSize={10} fill={TEXT} textAnchor="end">
        σ ({spec.unit})
      </text>
      <text x={axisX + 6} y={pad - 14} fontSize={10} fill={TEXT}>
        τ ({spec.unit})
      </text>
    </svg>
  );
}
