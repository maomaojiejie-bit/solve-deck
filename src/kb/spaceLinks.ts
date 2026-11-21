// 知识库条目 ↔ 三维分区算例的双向映射（2026-11-21 强关联）。
// 正向：知识详情页挂「三维演示」卡，把人送进 #/space/t/<id> 或 #/space/build；
// 反向：三维算例详情页回链对应知识条目 #/kb/<entryId>。
// 只列对得上教学主题的算例，宁缺毋滥；build=true 表示引导去自由装配台。

export interface SpaceDemo {
  /** 算例 id（T/S/K/D 系），点进 #/space/t/<id> */
  exampleId?: string;
  /** true = 去 #/space/build 自由装配 */
  build?: boolean;
  /** 一句话说明这个算例演示条目的哪个点 */
  note: string;
}

export const KB_SPACE_DEMOS: Record<string, SpaceDemo[]> = {
  'statics.determinacy': [
    { exampleId: 'T4', note: '机构反例：两腿悬挑架拆掉一条腿，求解直接拒答——几何不变性看得见' },
    { build: true, note: '自由装配台自己拆杆，观察何时从「已解出」翻成「拒答」' },
  ],
  'statics.truss': [
    { exampleId: 'T2', note: '三脚架：空间节点法基线，与截面法互校' },
    { exampleId: 'T1', note: '正四面体：空间桁架最小稳定单元（m=3j−6）' },
    { exampleId: 'T6', note: '参数化四方塔：层数/节间/X 斜材可调的真实塔架' },
  ],
  'statics.equilibrium': [
    { exampleId: 'S4', note: '空间一般力系平衡：6 个独立约束反力 + 主矢主矩归零校核' },
  ],
  'statics.spatial-force-system': [
    { exampleId: 'S1', note: '空间受力图：球铰+固定铰+辊轴反力的教学命名' },
    { exampleId: 'S2', note: '空间汇交力系合成：三力汇交 → 合力过汇交点' },
    { exampleId: 'S3', note: '空间力系简化：主矢主矩 → 力螺旋与中心轴' },
    { build: true, note: '任意空间杆系搭完即解（棱台/圆台/楔体形状预设）' },
  ],
  'statics.friction': [
    { exampleId: 'S6', note: '空间摩擦：斜面滑块摩擦锥判别（静止/临界/滑动）' },
  ],
  'statics.rigid-body': [
    { exampleId: 'S5', note: '物体系统平衡：固定端+中间铰+滑移支承，逐体拆体列方程' },
    { exampleId: 'S7', note: '重心·形心组合体：组合法 + 负权重挖空' },
  ],
  'statics.multibody-friction': [
    { exampleId: 'S5', note: '多体拆体：铰接处约束力逐体传递' },
    { exampleId: 'S6', note: '接触面摩擦状态判定叠加到系统平衡' },
  ],
  'statics.kinematics': [
    { exampleId: 'K1', note: '质点螺旋运动（自然法）：逐帧动画看轨迹与速度箭头' },
    { exampleId: 'K2', note: '刚体定轴转动：角量与点的线量对照' },
    { exampleId: 'K4', note: '曲柄滑块平面运动：基点法/瞬心法逐帧演示' },
  ],
  'statics.dynamics': [
    { exampleId: 'D1', note: '斜抛质点：恒力+重力逐帧积分' },
    { exampleId: 'D2', note: '阿特伍德机：动量/动能定理' },
    { exampleId: 'D4', note: '提升重物：达朗贝尔动静法' },
  ],
  'statics.virtual-work': [
    { exampleId: 'D5', note: '曲柄滑块持荷：虚位移原理的真实机构演示' },
  ],
  'statics.impulse-momentum': [
    { exampleId: 'D2', note: '阿特伍德机：动量定理与动能定理互校' },
  ],
  'statics.vibration': [
    { exampleId: 'D3', note: '单摆非线性数值解：大摆角周期逐帧可见' },
  ],
};

/** 知识条目的三维演示列表（无则空数组） */
export function spaceDemosFor(entryId: string): SpaceDemo[] {
  return KB_SPACE_DEMOS[entryId] ?? [];
}

/** 反向：算例 id 对应的知识条目 id 列表（SpaceDetail 回链用） */
export function kbEntriesForExample(exampleId: string): string[] {
  const out: string[] = [];
  for (const [entryId, demos] of Object.entries(KB_SPACE_DEMOS)) {
    if (demos.some((d) => d.exampleId === exampleId)) out.push(entryId);
  }
  return out;
}
