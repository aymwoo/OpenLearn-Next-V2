/**
 * 课程交付模式（产品开关）。
 *
 * 存在教师看到的「课程」记录上（`lessons.delivery_mode`），与门户
 * `teachingModeId`（讲授 / 探究 / 协作 / 体验 / 练习）无关。
 * 未写入或无法识别的值按白板处理，保证旧课升级后行为不变。
 */
export const COURSE_DELIVERY_MODES = ['whiteboard', 'xuean'] as const;

export type CourseDeliveryMode = (typeof COURSE_DELIVERY_MODES)[number];

export function resolveCourseDeliveryMode(raw: unknown): CourseDeliveryMode {
  if (raw === 'xuean') return 'xuean';
  return 'whiteboard';
}

export function isXueanDeliveryMode(raw: unknown): boolean {
  return resolveCourseDeliveryMode(raw) === 'xuean';
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
