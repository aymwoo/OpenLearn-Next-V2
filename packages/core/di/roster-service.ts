/**
 * 受管名册读取服务（Issue #366）。
 *
 * 只读、字段最小化：`classes` / `students` / `class_students` 是 sql-guard 的禁读表，
 * 插件需要班级与成员信息时走这里，而不是 SQL。返回体刻意不含 email / private_notes /
 * password / 班级口令 —— 受管通道的价值就在于「能拿到该拿的，拿不到不该拿的」。
 */
import type { Database } from 'better-sqlite3';
import type { IClassRosterService, RosterClassSummary, RosterStudentRef } from './interfaces.js';

export class ClassRosterService implements IClassRosterService {
  constructor(private readonly db: Database) {}

  async listClasses(): Promise<RosterClassSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, c.name AS name, COUNT(cs.student_id) AS student_count
           FROM classes c
           LEFT JOIN class_students cs ON cs.class_id = c.id
          GROUP BY c.id, c.name
          ORDER BY c.created_at DESC, c.name ASC`,
      )
      .all() as { id: string; name: string; student_count: number }[];
    return rows.map((row) => ({ id: row.id, name: row.name, studentCount: Number(row.student_count) }));
  }

  async listClassStudents(classId: string): Promise<RosterStudentRef[]> {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id, s.name AS name, s.student_number AS student_number
           FROM class_students cs
           JOIN students s ON s.id = cs.student_id
          WHERE cs.class_id = ?
          ORDER BY s.name ASC`,
      )
      .all(classId) as { id: string; name: string; student_number: string | null }[];
    return rows.map(toStudentRef);
  }

  async getStudent(studentId: string): Promise<RosterStudentRef | null> {
    const row = this.db.prepare('SELECT id, name, student_number FROM students WHERE id = ?').get(studentId) as
      { id: string; name: string; student_number: string | null } | undefined;
    return row ? toStudentRef(row) : null;
  }
}

function toStudentRef(row: { id: string; name: string; student_number: string | null }): RosterStudentRef {
  return { id: row.id, name: row.name, studentNumber: row.student_number ?? null };
}
