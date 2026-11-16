/**
 * 课节关联班级与学生名单。排课 / 课堂会话 / 作业三个来源与 class-access 一致。
 */
import type Database from 'better-sqlite3';

export interface LessonStudentRef {
  id: string;
  name: string;
  studentNumber: string | null;
  classId: string;
  className: string;
}

export function lessonLinkedClassIds(db: Database.Database, lessonId: string): string[] {
  const rows = db
    .prepare(
      `SELECT class_id FROM schedules WHERE lesson_id = ? AND class_id IS NOT NULL
       UNION SELECT class_id FROM classroom_sessions WHERE lesson_id = ? AND class_id IS NOT NULL
       UNION SELECT class_id FROM assignments WHERE lesson_id = ? AND class_id IS NOT NULL`,
    )
    .all(lessonId, lessonId, lessonId) as Array<{ class_id: string }>;
  return Array.from(new Set(rows.map((row) => row.class_id).filter(Boolean)));
}

export function listStudentsForLesson(db: Database.Database, lessonId: string): LessonStudentRef[] {
  const classIds = lessonLinkedClassIds(db, lessonId);
  if (classIds.length === 0) return [];
  const placeholders = classIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.student_number AS studentNumber, c.id AS classId, c.name AS className
         FROM class_students cs
         JOIN students s ON s.id = cs.student_id
         JOIN classes c ON c.id = cs.class_id
        WHERE cs.class_id IN (${placeholders})
        ORDER BY c.name, s.name`,
    )
    .all(...classIds) as Array<{
    id: string;
    name: string;
    studentNumber: string | null;
    classId: string;
    className: string;
  }>;
  const seen = new Set<string>();
  const result: LessonStudentRef[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}
