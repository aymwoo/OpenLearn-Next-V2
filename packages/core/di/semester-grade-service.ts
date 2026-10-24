import { ISemesterGradeService, SemesterGradeWriteOptions } from './interfaces.js';
import { applyGradeChange, type GradeWriteResult } from '../db/assignment-grade-writer.js';
import type { Database } from 'better-sqlite3';

/** 排课日期/学年缺失时按 9 月学年起点回退到当前学年，避免成绩在学年报表里不可见 */
function resolveAcademicYear(schedule?: {
  academic_year?: string | null;
  scheduled_date?: string | null;
}): string | null {
  if (schedule?.academic_year) return schedule.academic_year;
  const raw = schedule?.scheduled_date?.trim();
  let year: number;
  let month: number; // 0-based
  const parts = raw ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
  if (parts) {
    // 纯日期按字面解析，避免 new Date() 的时区换算把 9 月 1 日推回 8 月
    year = Number(parts[1]);
    month = Number(parts[2]) - 1;
  } else {
    const date = raw ? new Date(raw) : new Date();
    if (Number.isNaN(date.getTime())) return null;
    year = date.getFullYear();
    month = date.getMonth();
  }
  const startYear = month + 1 >= 9 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export class SemesterGradeService implements ISemesterGradeService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async saveSemesterGrade(
    lessonId: string,
    studentId: string,
    grade: number,
    options: SemesterGradeWriteOptions = {},
  ): Promise<GradeWriteResult | void> {
    if (!lessonId || !studentId) {
      throw new Error('lessonId and studentId are required');
    }

    // 1. Get classId from schedules using lessonId, with fallbacks to student's class or plugin assignments
    let classId: string | undefined;
    const schedule = this.db
      .prepare('SELECT class_id, academic_year, scheduled_date FROM schedules WHERE lesson_id = ? LIMIT 1')
      .get(lessonId) as { class_id: string; academic_year?: string | null; scheduled_date?: string | null } | undefined;
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
    const now = Date.now();
    const academicYear = resolveAcademicYear(schedule);

    // 代表作业与成绩行必须同事务落库：避免只写了作业壳、成绩行失败后
    // 学期报表出现「有作业无成绩」的半成品。
    let writeResult: GradeWriteResult | undefined;
    const write = this.db.transaction(() => {
      // 2. Ensure representative assignment exists in host assignments table
      this.db
        .prepare(
          `
        INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at, academic_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          academic_year = COALESCE(assignments.academic_year, excluded.academic_year)
      `,
        )
        .run(
          assignmentId,
          classId,
          lessonId,
          `平时作业 - 课时 ${lessonId}`,
          '上传与互评插件确认自动同步的平时成绩代表作业',
          '',
          now,
          academicYear,
        );

      // 3. 统一走成绩写入器：手动分/缺考保护 + 历史审计
      writeResult = applyGradeChange(this.db, {
        assignmentId,
        studentId,
        content: '[微应用插件同步平时成绩]',
        score: grade,
        feedback: '平时作业互评与评分系统确认成绩',
        submittedAt: now,
        gradedAt: now,
        status: 'graded',
        source: options.source ?? 'plugin',
        actorId: options.actorId ?? null,
        actorRole: options.actorRole ?? null,
        reason: 'semester-grade-sync',
        academicYear,
        createIfMissing: true,
        overrideProtected: options.overrideProtected === true,
      });
    });
    write();
    return writeResult;
  }
}
