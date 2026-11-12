export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  kind: string;
  label: string;
  /** 图元自身旋转角（0/90/180/270）：竖放的电阻、电源用它；标签不跟着转。 */
  rot?: number;
  /** 标签相对图元的位置；缺省 up。 */
  labelSide?: 'up' | 'down' | 'left' | 'right';
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  label?: string;
  /** 显式折线（绝对坐标）；给了就不走默认 H-V-H。 */
  points?: [number, number][];
  /** 虚线：受控源的控制量引出线。 */
  dashed?: boolean;
  /** 端口标签（B/C/E/G/D/S/Vo 等），贴线段中点。 */
  tag?: string;
  weight?: 1 | 2;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}
