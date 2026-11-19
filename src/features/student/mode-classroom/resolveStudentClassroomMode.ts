import {
  resolveCourseDeliveryMode,
  type CourseDeliveryMode,
} from '../../../../packages/core/plugin-host/course-delivery-mode';

/** 学生进课后的页面。未设置交付模式的旧课走白板页。 */
export function resolveStudentClassroomMode(deliveryMode: unknown): CourseDeliveryMode {
  return resolveCourseDeliveryMode(deliveryMode);
}
