/**
 * 科目表：首页与「我有道题」共用一份，别在页面里各写一份（写两份就会漂）。
 * `READY_SUBJECTS` = 至少有一型 ready 的科目，首页首屏与读题页的题型选择器都按它分组。
 */

import type { Subject } from './types.ts';
import { TEMPLATES } from './templates/registry.ts';

export interface SubjectMeta {
  key: Subject;
  label: string;
  code: string;
  hint: string;
}

export const SUBJECTS: SubjectMeta[] = [
  { key: 'digital', label: '数电', code: 'D', hint: '逻辑代数 / 组合 / 时序 / 数制' },
  { key: 'analog', label: '模电', code: 'A', hint: '二极管 / BJT / MOS / 运放 / 反馈' },
  { key: 'mechanics', label: '材料力学', code: 'M', hint: '拉压 / 扭转 / 弯曲 / 稳定' },
  { key: 'statics', label: '理论力学', code: 'S', hint: '受力图 / 力系 / 摩擦 / 三角桁架' },
];

export const READY_SUBJECTS: SubjectMeta[] = SUBJECTS.filter((subject) =>
  TEMPLATES.some((entry) => entry.subject === subject.key && entry.status === 'ready'),
);

export const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(
  SUBJECTS.map((subject) => [subject.key, subject.label]),
);
