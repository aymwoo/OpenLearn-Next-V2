import { resolveLessonModePackDeliveryMode } from '../../../../packages/core/plugin-host/course-delivery-mode';

/**
 * 学案课进入课堂时是否应默认落在「环节工作区」（`segment_main`）。
 *
 * 只有 mode pack 开启且课时确实是学案交付时才切换：白板课保持历史默认，
 * 未声明交付模式的旧课也保持默认，避免老课首屏行为变化。
 */
export function shouldAutoSelectSegmentMain(
  lesson: { mode_pack_id?: string | null; delivery_mode?: string | null } | null | undefined,
  modePacksEnabled: boolean,
): boolean {
  if (!modePacksEnabled || !lesson) return false;
  return resolveLessonModePackDeliveryMode(lesson.mode_pack_id, lesson.delivery_mode) === 'xuean';
}
