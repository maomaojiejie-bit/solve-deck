/**
 * build-kb-skeleton.mjs —— K1 知识库空位生成器。
 *
 * 铁律：**只在新文件不存在时写**（K2 之后的文案绝不覆盖）。四科文件齐了就原样退出。
 * 数据来源：`docs/覆盖账本-四科题型.md`（15 / 11 / 14 / 12 = 52；
 * 29 条能算挂 solvable.templateId，◐ M4 内嵌与 ○ 只讲不挂）。
 *
 * 用法：node scripts/build-kb-skeleton.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'src', 'kb', 'entries');

/* ── 52 条元数据（机器字段；文案 approach/points 留给 K2） ─────────── */
const CIRCUIT = [
  { id: 'diode-constant-drop', chapter: '器件与整流', title: '二极管恒压降模型与串联回路', aliases: ['二极管恒压降', '二极管串联回路', '二极管电路'], oneLine: '二极管按 0.7V 恒压降处理串联回路的电流与电阻压降。', template: 'A1' },
  { id: 'rectifier-clamp-zener', chapter: '器件与整流', title: '整流、钳位与稳压管稳压', aliases: ['整流电路', '钳位电路', '稳压管稳压'], oneLine: '半波整流、钳位与稳压管稳压三种二极管电路的判定与计算。', template: 'A1' },
  { id: 'bjt-dc-bias', chapter: '工作点与偏置', title: 'BJT 直流工作点与分压偏置', aliases: ['静态工作点', '分压偏置', 'BJT 工作点'], oneLine: '分压偏置下求 IC/VCE 并判定截止、放大、饱和三状态。', template: 'A2' },
  { id: 'bjt-small-signal', chapter: '小信号放大', title: 'BJT 三组态小信号（CE/CB/CC）', aliases: ['共射放大', 'π 模型', '三组态'], oneLine: 'π 模型下 CE/CB/CC 三组态的 Av、Ri、Ro 求解。', template: 'A3' },
  { id: 'mos-operating-region', chapter: '工作点与偏置', title: 'MOS 工作区判定与 Vth/Kn', aliases: ['MOS 工作区', '恒流区', '三极管区'], oneLine: '用 VGS/VDS 与 Vth 判定截止、恒流、三极管区并求 ID。', template: 'A4' },
  { id: 'mos-small-signal', chapter: '小信号放大', title: 'MOS 三组态小信号（CS/CG/CD）', aliases: ['共源放大', '跨导 gm', '共漏放大'], oneLine: 'gm=2ID/VOV 下 CS/CG/CD 三组态的小信号求解。', template: 'A5' },
  { id: 'opamp-ideal', chapter: '运放与反馈', title: '理想运放：虚短虚断与四种电路', aliases: ['虚短虚断', '反相放大器', '同相放大器'], oneLine: '虚短虚断分析反相、同相、加减、积分微分电路。', template: 'A6' },
  { id: 'feedback', chapter: '运放与反馈', title: '负反馈：组态判据与深度负反馈', aliases: ['负反馈', '环路增益', '四种反馈组态'], oneLine: '四种反馈组态判据、环路增益与深度负反馈 1/β 估算法。', template: 'A7' },
  { id: 'multistage-amplifier', chapter: '只讲专题', title: '多级放大', aliases: ['级联放大', '多级增益'], oneLine: '级联增益与输入输出电阻的串并联口径（只讲，不计算）。' },
  { id: 'differential-amplifier', chapter: '只讲专题', title: '差分放大', aliases: ['差分对', '共模抑制比', '半边等效'], oneLine: '共模抑制比与半边等效的分析口径（只讲，不计算）。' },
  { id: 'frequency-response', chapter: '只讲专题', title: '频率响应与波特图', aliases: ['波特图', '截止频率', '增益带宽积'], oneLine: '中频增益、上下限截止与波特图画法（只讲，不计算）。' },
  { id: 'opamp-nonideal', chapter: '只讲专题', title: '运放非理想效应', aliases: ['失调电压', '压摆率', '共模抑制'], oneLine: '失调、共模抑制与压摆率等非理想效应（只讲，不计算）。' },
  { id: 'power-amplifier', chapter: '只讲专题', title: '功率放大', aliases: ['甲乙类', '交越失真', '功放效率'], oneLine: '甲乙类偏置、交越失真与效率的定性分析（只讲，不计算）。' },
  { id: 'regulated-power-supply', chapter: '只讲专题', title: '稳压电源', aliases: ['串联稳压', '三端稳压器'], oneLine: '串联型稳压与三端稳压器的工作原理（只讲，不计算）。' },
  { id: 'oscillator', chapter: '只讲专题', title: '振荡电路', aliases: ['起振条件', 'RC 桥式振荡', 'LC 三点式'], oneLine: '起振条件与 RC 桥式、LC 三点式的构成（只讲，不计算）。' },
];
const DIGITAL = [
  { id: 'logic-simplification', chapter: '组合逻辑', title: '逻辑代数化简与卡诺图', aliases: ['卡诺图', '最小项', '无关项'], oneLine: '公式法与卡诺图化简：最小项、无关项与最简表达式。', template: 'D1' },
  { id: 'combinational-analysis', chapter: '组合逻辑', title: '组合逻辑分析', aliases: ['真值表', '表达式反推'], oneLine: '由门电路写表达式、列真值表、归纳逻辑功能。', template: 'D2' },
  { id: 'combinational-design', chapter: '组合逻辑', title: '组合逻辑设计', aliases: ['译码器', '数据选择器', '加法器'], oneLine: '用译码器、MUX、加法器、比较器实现逻辑函数。', template: 'D3' },
  { id: 'flip-flops', chapter: '时序逻辑', title: '触发器', aliases: ['JK 触发器', 'D 触发器', '特性表'], oneLine: 'SR/D/JK/T 触发器的特性表、激励表与边沿动作。', template: 'D4' },
  { id: 'sequential-fsm', chapter: '时序逻辑', title: '时序电路与状态机', aliases: ['同步计数器', '状态转移表', 'FSM'], oneLine: '寄存器、同步计数器与 FSM 的状态转移表分析。', template: 'D5' },
  { id: 'number-encoding', chapter: '数制与编码', title: '数制与编码', aliases: ['补码', '格雷码', 'BCD'], oneLine: '进制转换、BCD、补码与格雷码的运算规则。', template: 'D6' },
  { id: 'hazard-race', chapter: '只讲专题', title: '竞争与冒险', aliases: ['冒险消除', '竞争判别'], oneLine: '竞争冒险的代数判别与采样消除（只讲，不计算）。' },
  { id: 'setup-hold', chapter: '只讲专题', title: '建立与保持时间', aliases: ['时序余量', '建立时间'], oneLine: '建立/保持时间与时序余量的工程口径（只讲，不计算）。' },
  { id: 'cmos-tristate', chapter: '只讲专题', title: '传输门、三态门与线与', aliases: ['三态门', '传输门', '线与'], oneLine: 'CMOS 传输门、三态门与线与的电路行为（只讲，不计算）。' },
  { id: 'memory', chapter: '只讲专题', title: '存储器', aliases: ['ROM 容量', 'RAM 地址线', '位扩展'], oneLine: 'ROM/RAM 容量、地址线与字位扩展（只讲，不计算）。' },
  { id: 'adc-dac', chapter: '只讲专题', title: 'ADC 与 DAC', aliases: ['分辨率', '量化误差', '转换时间'], oneLine: '分辨率、量化误差与转换时间的指标口径（只讲，不计算）。' },
];
const MECHANICS = [
  { id: 'axial', chapter: '拉压与扭转', title: '轴向拉压', aliases: ['轴力图', '胡克定律', '轴向变形'], oneLine: '轴力、正应力、胡克定律与轴向变形的计算链。', template: 'M1' },
  { id: 'torsion', chapter: '拉压与扭转', title: '圆轴扭转', aliases: ['扭矩图', '切应力', '扭转角'], oneLine: '扭矩图、切应力与扭转角的计算链。', template: 'M2' },
  { id: 'bending-internal', chapter: '弯曲', title: '弯曲内力', aliases: ['剪力图', '弯矩图', '微分关系'], oneLine: '剪力图与弯矩图：微分关系、控制截面与突变量。', template: 'M3' },
  { id: 'bending-stress', chapter: '弯曲', title: '弯曲应力与强度校核', aliases: ['惯性矩', '截面系数', '正应力校核'], oneLine: 'σ=My/I、W 与惯性矩，正应力强度校核全流程。', template: 'M4' },
  { id: 'bending-deflection', chapter: '变形与稳定', title: '弯曲变形', aliases: ['挠曲线', '积分法', '叠加法'], oneLine: '挠曲线近似微分方程：积分法与叠加法求挠度转角。', template: 'M5' },
  { id: 'stress-state', chapter: '应力状态与组合', title: '应力状态与莫尔圆', aliases: ['主应力', '莫尔圆', '最大切应力'], oneLine: '平面应力状态的主应力、莫尔圆与 τmax。', template: 'M6' },
  { id: 'buckling', chapter: '变形与稳定', title: '压杆稳定', aliases: ['欧拉公式', '柔度', '临界力'], oneLine: '柔度分档与欧拉临界力 Pcr 的计算与校核。', template: 'M7' },
  { id: 'combined', chapter: '应力状态与组合', title: '弯扭组合变形', aliases: ['第三强度理论', '第四强度理论', '相当应力'], oneLine: '弯扭组合按第三/第四强度理论出相当应力并校核。', template: 'M8' },
  { id: 'section-properties', chapter: '只讲专题', title: '截面几何性质', aliases: ['形心', '平行轴定理', '主惯性轴'], oneLine: '形心、平行轴定理与主惯性轴的算法（M4 内嵌，不单算）。' },
  { id: 'shear-bearing', chapter: '只讲专题', title: '剪切与挤压实用计算', aliases: ['铆钉', '键连接', '挤压应力'], oneLine: '铆钉、键、销的剪切挤压实用算法（只讲，不计算）。' },
  { id: 'strength-theories', chapter: '只讲专题', title: '强度理论四种', aliases: ['强度理论', '相当应力判据'], oneLine: '四种强度理论的判据与选用场景（只讲，不计算）。' },
  { id: 'energy-methods', chapter: '只讲专题', title: '能量法', aliases: ['单位载荷法', '莫尔积分', '卡氏定理'], oneLine: '单位载荷法、莫尔积分与卡氏定理（只讲，不计算）。' },
  { id: 'statically-indeterminate', chapter: '只讲专题', title: '简单超静定', aliases: ['变形协调', '力法一次'], oneLine: '变形协调与一次超静定的力法思路（只讲，不计算）。' },
  { id: 'fatigue', chapter: '只讲专题', title: '疲劳与应力集中', aliases: ['疲劳强度', '应力集中系数'], oneLine: '疲劳破坏、应力集中与持久极限的定性口径（只讲，不计算）。' },
];
const STATICS = [
  { id: 'determinacy', chapter: '力系与平衡', title: '静定判据与机构识别', aliases: ['自由度', '约束数', '静不定'], oneLine: '自由度/约束数判静定，识别静不定与机构（含反例）。', template: 'S1' },
  { id: 'force-system-reduction', chapter: '力系与平衡', title: '平面力系简化', aliases: ['主矢', '主矩', '合力作用线'], oneLine: '主矢主矩的求法与合力作用线的定位。', template: 'S2' },
  { id: 'equilibrium', chapter: '力系与平衡', title: '平面任意力系平衡', aliases: ['支座反力', '分布载荷'], oneLine: '平衡方程求支座反力，分布载荷的简化处理。', template: 'S3' },
  { id: 'friction', chapter: '力系与平衡', title: '摩擦与自锁', aliases: ['摩擦角', '自锁', '临界平衡'], oneLine: '摩擦角、自锁条件与临界平衡的判定。', template: 'S4' },
  { id: 'truss', chapter: '桁架与几何', title: '静定桁架', aliases: ['节点法', '截面法', '零杆'], oneLine: '节点法、截面法求杆力与零杆判别。', template: 'S5' },
  { id: 'section-geometry', chapter: '桁架与几何', title: '组合截面几何', aliases: ['形心坐标', '组合截面惯性矩'], oneLine: '组合截面的形心与惯性矩（分割 + 平行轴）。', template: 'S6' },
  { id: 'rigid-body', chapter: '力系与平衡', title: '刚体平衡应用', aliases: ['杠杆平衡', '支架受力'], oneLine: '杠杆、支架类刚体的平衡方程应用。', template: 'S7' },
  { id: 'spatial-force-system', chapter: '只讲专题', title: '空间力系', aliases: ['力对轴之矩', '三维平衡'], oneLine: '三维平衡与力对轴之矩的展开（只讲，不计算）。' },
  { id: 'multibody-friction', chapter: '只讲专题', title: '多体摩擦平衡', aliases: ['滚阻', '多体临界'], oneLine: '含滚阻的多体临界平衡分析（只讲，不计算）。' },
  { id: 'virtual-work', chapter: '只讲专题', title: '虚位移原理', aliases: ['虚位移', '虚功方程'], oneLine: '虚位移原理与虚功方程的建立（只讲，不计算）。' },
  { id: 'kinematics', chapter: '只讲专题', title: '运动学', aliases: ['点的合成运动', '刚体平面运动'], oneLine: '点的合成运动与刚体平面运动（只讲，不计算）。' },
  { id: 'dynamics', chapter: '只讲专题', title: '动力学', aliases: ['达朗贝尔', '动能定理', '牛顿欧拉'], oneLine: '牛顿-欧拉、达朗贝尔与动能定理（只讲，不计算）。' },
];

const SUBJECTS = [
  { file: 'circuit.ts', name: 'CIRCUIT', subject: 'circuit', meta: CIRCUIT },
  { file: 'digital.ts', name: 'DIGITAL', subject: 'digital', meta: DIGITAL },
  { file: 'mechanics.ts', name: 'MECHANICS', subject: 'mechanics', meta: MECHANICS },
  { file: 'statics.ts', name: 'STATICS', subject: 'statics', meta: STATICS },
];

mkdirSync(outDir, { recursive: true });

let written = 0;
let skipped = 0;
for (const subject of SUBJECTS) {
  const path = join(outDir, subject.file);
  if (existsSync(path)) {
    skipped += 1;
    console.log(`跳过（已存在，绝不覆盖）：src/kb/entries/${subject.file}`);
    continue;
  }
  const body = subject.meta
    .map((entry) => {
      const lines = [
        '  {',
        `    id: '${subject.subject}.${entry.id}',`,
        `    subject: '${subject.subject}',`,
        `    chapter: '${entry.chapter}',`,
        `    title: '${entry.title}',`,
        `    aliases: [${entry.aliases.map((alias) => `'${alias}'`).join(', ')}],`,
        `    oneLine: '${entry.oneLine}',`,
        '    approach: [],',
        '    formulas: [],',
        '    points: [],',
      ];
      if (entry.template) lines.push(`    solvable: { templateId: '${entry.template}' },`);
      lines.push('  },');
      return lines.join('\n');
    })
    .join('\n');
  const content = `/**\n * K1 空位（由 scripts/build-kb-skeleton.mjs 生成；本文件已被生成，脚本此后绝不覆盖）。\n * approach / points 为空 = K2 待写清单；门禁 check:kb ② 会逐条报账。\n */\nimport type { KnowledgeEntry } from '../types';\n\nexport const ${subject.name}: KnowledgeEntry[] = [\n${body}\n];\n`;
  writeFileSync(path, content, 'utf8');
  written += 1;
  console.log(`写入：src/kb/entries/${subject.file}（${subject.meta.length} 条）`);
}

const total = SUBJECTS.reduce((sum, subject) => sum + subject.meta.length, 0);
const solvable = SUBJECTS.reduce((sum, subject) => sum + subject.meta.filter((entry) => entry.template).length, 0);
console.log(`\n合计：${total} 条（能算 ${solvable} / 待写文案 ${total - solvable ? '' : ''}${total} 条 approach 空）；本次新写 ${written} 个文件，跳过 ${skipped} 个`);
console.log('数量核对：15 / 11 / 14 / 12 = 52；solvable 29 条');
