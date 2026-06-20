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

    // 1. Get classId from schedules using lessonId
    const schedule = this.db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ?').get(lessonId) as { class_id: string } | undefined;
    if (!schedule) {
      throw new Error(`No scheduled class found for lesson: ${lessonId}`);
    }
    const classId = schedule.class_id;
    const assignmentId = `plugin-lesson-${lessonId}`;

    // 2. Ensure representative assignment exists in host assignments table
    this.db.prepare(`
      INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      assignmentId,
      classId,
      lessonId,
      `平时作业 - 课时 ${lessonId}`,
      '上传与互评插件确认自动同步的平时成绩代表作业',
      '',
      Date.now()
    );

    // 3. Write or update assignment_submissions score
    this.db.prepare(`
      INSERT INTO assignment_submissions (
        assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assignment_id, student_id) DO UPDATE SET
        score = excluded.score,
        feedback = excluded.feedback,
        graded_at = excluded.graded_at,
        status = excluded.status
    `).run(
      assignmentId,
      studentId,
      '[微应用插件同步平时成绩]',
      grade,
      '平时作业互评与评分系统确认成绩',
      Date.now(),
      Date.now(),
      'graded'
    );
  }
}
