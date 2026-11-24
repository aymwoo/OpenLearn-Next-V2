import {
  resolveLessonModePackDeliveryMode,
  type CourseDeliveryMode,
} from '../../../../packages/core/plugin-host/course-delivery-mode';

/**
 * 学生进课后的页面。
 *
 * 先看课时绑定的模式包（`mode_pack_id`），再回落旧的 `delivery_mode`；
 * 两者都缺失或无法识别时走白板页。
 */
export function resolveStudentClassroomMode(deliveryMode: unknown, modePackId?: unknown): CourseDeliveryMode {
  return resolveLessonModePackDeliveryMode(modePackId, deliveryMode);
}
