import { ISemesterGradeService } from './interfaces.js';
import type { Database } from 'better-sqlite3';

export class SemesterGradeService implements ISemesterGradeService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void> {
    if (!lessonId || !studentId) {
      throw new Error('lessonId and studentId are required');
    }

    // 1. Get classId from schedules using lessonId, with fallbacks to student's class or plugin assignments
    let classId: string | undefined;
    const schedule = this.db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1').get(lessonId) as
      { class_id: string } | undefined;
    if (schedule?.class_id) {
      classId = schedule.class_id;
    } else {
      // Fallback 1: Resolve from student's enrolled class
      const studentClass = this.db
        .prepare('SELECT class_id FROM class_students WHERE student_id = ? ORDER BY joined_at DESC LIMIT 1')
        .get(studentId) as { class_id: string } | undefined;
      if (studentClass?.class_id) {
        classId = studentClass.class_id;
      } else {
        // Fallback 2: Check if plugin_assignments table exists and has a class_id for this lesson
        const hasPluginTable = this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_assignments'")
          .get();
        if (hasPluginTable) {
          const pluginAssignment = this.db
            .prepare('SELECT class_id FROM plugin_assignments WHERE lesson_id = ? AND class_id IS NOT NULL LIMIT 1')
            .get(lessonId) as { class_id: string } | undefined;
          if (pluginAssignment?.class_id) {
            classId = pluginAssignment.class_id;
          }
        }
      }
    }

    if (!classId) {
      throw new Error(`No scheduled class or enrolled class found for lesson: ${lessonId} and student: ${studentId}`);
    }
    const assignmentId = `plugin-lesson-${lessonId}`;

    // 2. Ensure representative assignment exists in host assignments table
    this.db
      .prepare(
        `
      INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `,
      )
      .run(
        assignmentId,
        classId,
        lessonId,
        `平时作业 - 课时 ${lessonId}`,
        '上传与互评插件确认自动同步的平时成绩代表作业',
        '',
        Date.now(),
      );

    // 3. Write or update assignment_submissions score
    this.db
      .prepare(
        `
      INSERT INTO assignment_submissions (
        assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assignment_id, student_id) DO UPDATE SET
        score = excluded.score,
        feedback = excluded.feedback,
        graded_at = excluded.graded_at,
        status = excluded.status
    `,
      )
      .run(
        assignmentId,
        studentId,
        '[微应用插件同步平时成绩]',
        grade,
        '平时作业互评与评分系统确认成绩',
        Date.now(),
        Date.now(),
        'graded',
      );
  }
}
