/**
 * 长周期课程与常规课节的多对多引用（course_lessons）。
 * 一门常规课可同时被多门长周期课程挂接；本模块供课程层、学案包、互评和讨论区共用。
 */
import type Database from 'better-sqlite3';

export function listCourseIdsForLesson(db: Database.Database, lessonId: string): string[] {
  const rows = db
    .prepare('SELECT course_id FROM course_lessons WHERE lesson_id = ? ORDER BY created_at ASC')
    .all(lessonId) as Array<{ course_id: string }>;
  return rows.map((row) => row.course_id);
}

export function primaryCourseIdForLesson(db: Database.Database, lessonId: string): string | null {
  return listCourseIdsForLesson(db, lessonId)[0] ?? null;
}

export function lessonIsInCourse(db: Database.Database, lessonId: string, courseId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM course_lessons WHERE course_id = ? AND lesson_id = ? LIMIT 1')
    .get(courseId, lessonId);
  return row != null;
}

export function sharedCourseIdsForLessons(db: Database.Database, lessonIds: string[]): string[] {
  const unique = Array.from(new Set(lessonIds.filter(Boolean)));
  if (unique.length === 0) return [];
  const sets = unique.map((id) => new Set(listCourseIdsForLesson(db, id)));
  return [...sets[0]].filter((courseId) => sets.every((set) => set.has(courseId)));
}
