/**
 * Issue #91：记住「教师在当前标签页里显式进入的那节课」。
 *
 * 进入互动课堂的第一屏是「进行中的课堂会话」列表，教师必须显式点「继续上课」才进
 * 授课视图。但有两类场景不该让教师反复重选：
 * - 授课中刷新页面；
 * - 授课中切到别的标签页再切回来（`LiveClassroomView` 会重新挂载）。
 *
 * 因此把「显式进入的课节 id」记在 `sessionStorage`（按标签页隔离，关掉标签页即失效），
 * 重新挂载时若与当前课节一致就直接回到授课视图。教师主动「返回门户」「开始新课」
 * 「结束并归档」时清除。
 */
const STORAGE_KEY = 'openlearn.liveClass.activeLessonId';

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    // 隐私模式 / 被策略禁用
    return null;
  }
}

/** 记录教师显式进入的课节；传 null 表示清除（回到门户 / 换了新课）。 */
export function rememberActiveLesson(lessonId: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (lessonId) s.setItem(STORAGE_KEY, lessonId);
    else s.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage 不可用时退化为「每次都要重选」，不影响功能正确性 */
  }
}

/** 读取当前标签页记住的课节 id。 */
export function readRememberedActiveLesson(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
