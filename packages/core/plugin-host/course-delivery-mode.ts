/**
 * 课程交付模式（产品开关）。
 *
 * 存在教师看到的「课程」记录上（`lessons.delivery_mode`），与门户
 * `teachingModeId`（讲授 / 探究 / 协作 / 体验 / 练习）无关。
 * 未写入或无法识别的值按白板处理，保证旧课升级后行为不变。
 *
 * 新写入的课还会带 `lessons.mode_pack_id`（支持第三方模式包）；
 * 读取时用 `resolveLessonModePackDeliveryMode` 做优先级决议。
 */
import { BUILTIN_WHITEBOARD_MODE_PACK_ID, BUILTIN_XUEAN_MODE_PACK_ID } from './mode-pack.js';

export const COURSE_DELIVERY_MODES = ['whiteboard', 'xuean'] as const;

export type CourseDeliveryMode = (typeof COURSE_DELIVERY_MODES)[number];

export function resolveCourseDeliveryMode(raw: unknown): CourseDeliveryMode {
  if (raw === 'xuean') return 'xuean';
  return 'whiteboard';
}

export function isXueanDeliveryMode(raw: unknown): boolean {
  return resolveCourseDeliveryMode(raw) === 'xuean';
}

/**
 * 由课时绑定的模式包 id 与旧 `delivery_mode` 共同决议交付模式。
 *
 * `mode_pack_id` 优先：内置学案包 → xuean，内置白板包 → whiteboard；
 * 其它（第三方包 / 未绑定）回落到 `delivery_mode` 的既有口径。第三方包在
 * 服务端写入时已按环节类型推导出兼容值，因此旧读路径不会退化。
 */
export function resolveLessonModePackDeliveryMode(modePackId: unknown, deliveryMode: unknown): CourseDeliveryMode {
  if (modePackId === BUILTIN_XUEAN_MODE_PACK_ID) return 'xuean';
  if (modePackId === BUILTIN_WHITEBOARD_MODE_PACK_ID) return 'whiteboard';
  return resolveCourseDeliveryMode(deliveryMode);
}

/** 学案环节在时间轴上的类型。`xuean` 前缀会被学案 Mode Pack 认领。 */
export function xueanSegmentTypeForActivity(activity: 'preview' | 'study' | 'drill'): string {
  if (activity === 'preview') return 'xuean:preview';
  if (activity === 'drill') return 'xuean:drill';
  return 'xuean';
}

/** 学案时间轴环节对应的活动表类型。 */
export function xueanActivityTypeForSegment(segmentType: string | null | undefined): 'reading' | 'quiz' | 'submission' {
  if (segmentType === 'xuean:drill') return 'quiz';
  if (segmentType === 'xuean') return 'submission';
  return 'reading';
}
