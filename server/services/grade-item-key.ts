/**
 * 成绩项身份（grade item key）。
 *
 * 学期总评与学年对比都以 `assignments` 行为统计单位。历史上同一个底层成绩项
 * 可能被写成多行 assignment（例如课件改名后旧壳未清理、学案活动被重复补壳），
 * 逐行统计会让同一份成绩同时进入分子与分母。这里为每条 assignment 解析一个
 * 稳定键，调用方按「学生 + 键」去重后再计算作业分。
 *
 * 只有带稳定来源标识的行才合并；普通作业（无标识）仍按作业 id 各自独立。
 */

export interface GradeItemIdentity {
  id: string;
  classId?: string | null;
  lessonId?: string | null;
  content?: string | null;
}

const XUEAN_PREFIX = 'xuean-activity:';

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 解析一条 assignment 的成绩项键；同一键的多行视为同一份成绩。 */
export function resolveGradeItemKey(item: GradeItemIdentity): string {
  const parsed = parseJsonObject(item.content);
  const scope = item.classId ?? '';

  const activityId = typeof parsed?.activityId === 'string' ? parsed.activityId.trim() : '';
  if (activityId && (parsed?.adapter === 'xuean-adapter' || item.id.startsWith(XUEAN_PREFIX))) {
    return `xuean:${scope}:${activityId}`;
  }
  if (item.id.startsWith(XUEAN_PREFIX)) {
    return `xuean:${scope}:${item.id.slice(XUEAN_PREFIX.length)}`;
  }

  const coursewareUuid = typeof parsed?.coursewareUuid === 'string' ? parsed.coursewareUuid.trim() : '';
  if (coursewareUuid) {
    // 同一课件在不同课节是两次独立课堂作业，键必须带课节区分。
    return `courseware:${scope}:${item.lessonId ?? ''}:${coursewareUuid}`;
  }

  // 无稳定标识：每条 assignment 各自独立，不做合并。
  return `assignment:${item.id}`;
}
