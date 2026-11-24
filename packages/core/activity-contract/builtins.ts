/**
 * 各活动体系的静态内置定义。
 *
 * xuean 与 classroom-legacy 原先分别散落在 `server/routes/lesson-activities.ts`
 * 与 `server/routes/classroom.ts`；这里收敛为单一事实源，供路由校验与 Catalog 发现共用。
 */

import type { ActivityDescriptorBase } from './types.js';
import { makeActivityId } from './types.js';

/** 学案活动类型白名单（与 lesson_activities 表的 type 字段对应）。 */
export const XUEAN_ACTIVITY_TYPES = [
  'reading',
  'submission',
  'quiz',
  'survey',
  'discussion',
  'courseware',
  'scratch',
  'form',
  'other',
] as const;

export type XueanActivityType = (typeof XUEAN_ACTIVITY_TYPES)[number];

const XUEAN_LABELS: Record<XueanActivityType, string> = {
  reading: '阅读',
  submission: '作品提交（练习）',
  quiz: '测验',
  survey: '调查',
  discussion: '讨论',
  courseware: '课件学习',
  scratch: '编程实践',
  form: '填表',
  other: '其他活动',
};

export function xueanDescriptors(): ActivityDescriptorBase[] {
  return XUEAN_ACTIVITY_TYPES.map((type) => ({
    kind: 'xuean',
    // `type:` 前缀用于区分「活动类型定义」与未来的「lesson_activities 行实例（xuean:<uuid>）」。
    activityId: makeActivityId('xuean', `type:${type}`),
    title: XUEAN_LABELS[type],
    category: 'xuean',
    description: `学案活动类型：${type}`,
  }));
}

/** 课堂旧互动协议（Phase 5 之前只做目录登记，不做行为迁移）。 */
export const CLASSROOM_LEGACY_ACTIVITIES = [
  { localId: 'quick-poll', title: '极速投票', category: 'assessment' },
  { localId: 'buzzer', title: '抢答器', category: 'assessment' },
  { localId: 'pacing-signal', title: '听懂了反馈', category: 'feedback' },
  { localId: 'exit-ticket', title: '结课通票', category: 'assessment' },
] as const;

export type ClassroomLegacyActivityId = (typeof CLASSROOM_LEGACY_ACTIVITIES)[number]['localId'];

export function classroomLegacyDescriptors(): ActivityDescriptorBase[] {
  return CLASSROOM_LEGACY_ACTIVITIES.map((item) => ({
    kind: 'classroom-legacy',
    activityId: makeActivityId('classroom-legacy', item.localId),
    title: item.title,
    category: item.category,
    description: `课堂旧互动协议：${item.localId}`,
  }));
}
