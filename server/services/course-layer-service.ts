/**
 * 课程层（Gitee IKVO15 P2）。
 *
 * course 是一级实体，lessons.course_id 挂接课节（章节）。课程整体跨周保持进行中，
 * 某个章节可通过课堂会话服务一键开课次（与 IKVNIX 课次/课程解耦配合）。
 */
import type Database from 'better-sqlite3';
import { randomId } from '../utils/id.js';
import { LessonActivityError } from './lesson-activity-service.js';
import { ClassroomRuntimeService } from './classroom-runtime-service.js';

export const COURSE_VISIBILITIES = ['private', 'enrolled', 'public'] as const;
export type CourseVisibility = (typeof COURSE_VISIBILITIES)[number];

export interface CourseRecord {
  id: string;
  title: string;
  description: string;
  ownerUserId: string;
  term: string | null;
  visibility: CourseVisibility;
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
  lessonCount?: number;
}

export interface CourseLessonRef {
  id: string;
  title: string;
  courseOrder: number;
  courseId: string | null;
}

export interface CourseEnrollment {
  id: string;
  courseId: string;
  classId: string | null;
  studentId: string | null;
  createdAt: number;
  className?: string | null;
  studentName?: string | null;
}

export class CourseLayerService {
  constructor(private readonly db: Database.Database) {}

  createCourse(input: {
    title: string;
    description?: string;
    ownerUserId: string;
    term?: string | null;
    visibility?: CourseVisibility;
    thumbnail?: string | null;
  }): CourseRecord {
    const title = String(input.title || '').trim();
    if (!title) throw new LessonActivityError(400, '课程标题不能为空');
    const now = Date.now();
    const id = randomId('crs_');
    this.db
      .prepare(
        `INSERT INTO courses (id, title, description, owner_user_id, term, visibility, thumbnail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        title.slice(0, 120),
        String(input.description || '').slice(0, 2000),
        input.ownerUserId,
        input.term ?? null,
        input.visibility && COURSE_VISIBILITIES.includes(input.visibility) ? input.visibility : 'enrolled',
        input.thumbnail ?? null,
        now,
        now,
      );
    return this.getCourse(id);
  }

  getCourse(courseId: string): CourseRecord {
    const row = this.db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as
      Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '课程不存在');
    return this.mapCourse(row);
  }

  updateCourse(
    courseId: string,
    patch: Partial<{
      title: string;
      description: string;
      term: string | null;
      visibility: CourseVisibility;
      thumbnail: string | null;
    }>,
  ): CourseRecord {
    const current = this.getCourse(courseId);
    const title = patch.title != null ? String(patch.title).trim() : current.title;
    if (!title) throw new LessonActivityError(400, '课程标题不能为空');
    const visibility =
      patch.visibility && COURSE_VISIBILITIES.includes(patch.visibility) ? patch.visibility : current.visibility;
    this.db
      .prepare(
        `UPDATE courses
            SET title = ?, description = ?, term = ?, visibility = ?, thumbnail = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        title.slice(0, 120),
        patch.description != null ? String(patch.description).slice(0, 2000) : current.description,
        patch.term !== undefined ? patch.term : current.term,
        visibility,
        patch.thumbnail !== undefined ? patch.thumbnail : current.thumbnail,
        Date.now(),
        courseId,
      );
    return this.getCourse(courseId);
  }

  deleteCourse(courseId: string): void {
    this.getCourse(courseId);
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE lessons SET course_id = NULL, course_order = 0 WHERE course_id = ?').run(courseId);
      this.db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    });
    tx();
  }

  listCoursesForTeacher(userId: string, isAdmin = false): CourseRecord[] {
    const rows = isAdmin
      ? (this.db.prepare('SELECT * FROM courses ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM courses WHERE owner_user_id = ? ORDER BY updated_at DESC').all(userId) as Array<
          Record<string, unknown>
        >);
    return rows.map((row) => this.mapCourse(row, true));
  }

  listCoursesForStudent(studentId: string): CourseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.*
           FROM courses c
           LEFT JOIN course_enrollments e ON e.course_id = c.id
          WHERE c.visibility = 'public'
             OR (c.visibility = 'enrolled' AND (
                  e.student_id = ?
                  OR e.class_id IN (SELECT class_id FROM class_students WHERE student_id = ?)
             ))
          ORDER BY c.updated_at DESC`,
      )
      .all(studentId, studentId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapCourse(row, true));
  }

  canManageCourse(courseId: string, userId: string, isAdmin = false): boolean {
    if (isAdmin) return this.db.prepare('SELECT 1 AS ok FROM courses WHERE id = ?').get(courseId) != null;
    const row = this.db.prepare('SELECT owner_user_id FROM courses WHERE id = ?').get(courseId) as
      { owner_user_id: string } | undefined;
    return !!row && row.owner_user_id === userId;
  }

  canViewCourse(
    courseId: string,
    actor: { userId?: string | null; studentId?: string | null; isAdmin?: boolean },
  ): boolean {
    const course = this.db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as
      Record<string, unknown> | undefined;
    if (!course) return false;
    if (actor.isAdmin) return true;
    if (actor.userId && course.owner_user_id === actor.userId) return true;
    if (course.visibility === 'public') return true;
    if (course.visibility === 'private') return false;
    if (actor.studentId) {
      const hit = this.db
        .prepare(
          `SELECT 1 AS ok FROM course_enrollments
            WHERE course_id = ?
              AND (student_id = ? OR class_id IN (SELECT class_id FROM class_students WHERE student_id = ?))
            LIMIT 1`,
        )
        .get(courseId, actor.studentId, actor.studentId);
      return !!hit;
    }
    return false;
  }

  listLessons(courseId: string): CourseLessonRef[] {
    this.getCourse(courseId);
    const rows = this.db
      .prepare(
        `SELECT id, title, course_id AS courseId, course_order AS courseOrder
           FROM lessons WHERE course_id = ? ORDER BY course_order ASC, created_at ASC`,
      )
      .all(courseId) as CourseLessonRef[];
    return rows;
  }

  attachLessons(courseId: string, lessonIds: string[]): CourseLessonRef[] {
    this.getCourse(courseId);
    const ids = Array.from(new Set(lessonIds.filter(Boolean)));
    const existingMax = this.db
      .prepare('SELECT COALESCE(MAX(course_order), -1) AS maxOrder FROM lessons WHERE course_id = ?')
      .get(courseId) as { maxOrder: number };
    let next = Number(existingMax.maxOrder) + 1;
    const tx = this.db.transaction(() => {
      for (const lessonId of ids) {
        const lesson = this.db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get(lessonId) as
          { id: string; course_id: string | null } | undefined;
        if (!lesson) throw new LessonActivityError(404, `课节不存在：${lessonId}`);
        if (lesson.course_id && lesson.course_id !== courseId) {
          throw new LessonActivityError(409, '该课节已挂在其他课程下');
        }
        if (lesson.course_id === courseId) continue;
        this.db
          .prepare('UPDATE lessons SET course_id = ?, course_order = ?, updated_at = ? WHERE id = ?')
          .run(courseId, next, Date.now(), lessonId);
        next += 1;
      }
      this.db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(Date.now(), courseId);
    });
    tx();
    return this.listLessons(courseId);
  }

  detachLesson(courseId: string, lessonId: string): void {
    const lesson = this.db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId) as
      { course_id: string | null } | undefined;
    if (!lesson || lesson.course_id !== courseId) throw new LessonActivityError(404, '课节不在该课程中');
    this.db
      .prepare('UPDATE lessons SET course_id = NULL, course_order = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), lessonId);
  }

  reorderLessons(courseId: string, lessonIds: string[]): CourseLessonRef[] {
    const current = this.listLessons(courseId);
    if (current.length !== lessonIds.length || current.some((item) => !lessonIds.includes(item.id))) {
      throw new LessonActivityError(400, '排序列表必须包含课程下全部课节');
    }
    const tx = this.db.transaction(() => {
      lessonIds.forEach((id, index) => {
        this.db
          .prepare('UPDATE lessons SET course_order = ?, updated_at = ? WHERE id = ? AND course_id = ?')
          .run(index, Date.now(), id, courseId);
      });
    });
    tx();
    return this.listLessons(courseId);
  }

  enrollClass(courseId: string, classId: string): CourseEnrollment {
    this.getCourse(courseId);
    const cls = this.db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId) as
      { id: string; name: string } | undefined;
    if (!cls) throw new LessonActivityError(404, '班级不存在');
    const existing = this.db
      .prepare(`SELECT id FROM course_enrollments WHERE course_id = ? AND class_id = ? AND student_id IS NULL`)
      .get(courseId, classId) as { id: string } | undefined;
    if (existing) return this.getEnrollment(existing.id);
    const id = randomId('cen_');
    this.db
      .prepare(
        `INSERT INTO course_enrollments (id, course_id, class_id, student_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
      )
      .run(id, courseId, classId, Date.now());
    return this.getEnrollment(id);
  }

  enrollStudent(courseId: string, studentId: string): CourseEnrollment {
    this.getCourse(courseId);
    const student = this.db.prepare('SELECT id FROM students WHERE id = ?').get(studentId) as
      { id: string } | undefined;
    if (!student) throw new LessonActivityError(404, '学生不存在');
    const existing = this.db
      .prepare('SELECT id FROM course_enrollments WHERE course_id = ? AND student_id = ?')
      .get(courseId, studentId) as { id: string } | undefined;
    if (existing) return this.getEnrollment(existing.id);
    const id = randomId('cen_');
    this.db
      .prepare(
        `INSERT INTO course_enrollments (id, course_id, class_id, student_id, created_at) VALUES (?, ?, NULL, ?, ?)`,
      )
      .run(id, courseId, studentId, Date.now());
    return this.getEnrollment(id);
  }

  unenroll(enrollmentId: string): void {
    const changes = this.db.prepare('DELETE FROM course_enrollments WHERE id = ?').run(enrollmentId).changes;
    if (!changes) throw new LessonActivityError(404, '选课记录不存在');
  }

  listEnrollments(courseId: string): CourseEnrollment[] {
    this.getCourse(courseId);
    const rows = this.db
      .prepare(
        `SELECT e.*, c.name AS class_name, s.name AS student_name
           FROM course_enrollments e
           LEFT JOIN classes c ON c.id = e.class_id
           LEFT JOIN students s ON s.id = e.student_id
          WHERE e.course_id = ?
          ORDER BY e.created_at`,
      )
      .all(courseId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapEnrollment(row));
  }

  enrolledClassIds(courseId: string): string[] {
    const rows = this.db
      .prepare('SELECT class_id FROM course_enrollments WHERE course_id = ? AND class_id IS NOT NULL')
      .all(courseId) as Array<{ class_id: string }>;
    return Array.from(new Set(rows.map((row) => row.class_id)));
  }

  async startLessonSession(
    courseId: string,
    lessonId: string,
    teacherId: string,
    classId?: string | null,
  ): Promise<{ session: Record<string, unknown>; created: boolean }> {
    const lesson = this.db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get(lessonId) as
      { id: string; course_id: string | null } | undefined;
    if (!lesson || lesson.course_id !== courseId) {
      throw new LessonActivityError(404, '课节不在该课程中');
    }
    const enrolled = this.enrolledClassIds(courseId);
    const resolvedClassId = classId || (enrolled.length === 1 ? enrolled[0] : null);
    if (resolvedClassId && enrolled.length > 0 && !enrolled.includes(resolvedClassId)) {
      throw new LessonActivityError(400, '只能为已选课班级开启课次');
    }
    if (!resolvedClassId) {
      throw new LessonActivityError(400, '请指定要开课的班级');
    }
    const runtime = new ClassroomRuntimeService(this.db);
    const before = this.db
      .prepare(
        `SELECT id FROM classroom_sessions WHERE lesson_id = ? AND stage != 'ARCHIVED_REPORT' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(lessonId) as { id: string } | undefined;
    const session = await runtime.getOrCreateSession(lessonId, teacherId, resolvedClassId);
    return { session, created: !before || before.id !== session.id };
  }

  private getEnrollment(id: string): CourseEnrollment {
    const row = this.db
      .prepare(
        `SELECT e.*, c.name AS class_name, s.name AS student_name
           FROM course_enrollments e
           LEFT JOIN classes c ON c.id = e.class_id
           LEFT JOIN students s ON s.id = e.student_id
          WHERE e.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '选课记录不存在');
    return this.mapEnrollment(row);
  }

  private mapCourse(row: Record<string, unknown>, withCount = false): CourseRecord {
    const record: CourseRecord = {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description || ''),
      ownerUserId: String(row.owner_user_id),
      term: (row.term as string | null) ?? null,
      visibility: (row.visibility as CourseVisibility) || 'enrolled',
      thumbnail: (row.thumbnail as string | null) ?? null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
    if (withCount) {
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(record.id) as {
        n: number;
      };
      record.lessonCount = Number(count.n);
    }
    return record;
  }

  private mapEnrollment(row: Record<string, unknown>): CourseEnrollment {
    return {
      id: String(row.id),
      courseId: String(row.course_id),
      classId: (row.class_id as string | null) ?? null,
      studentId: (row.student_id as string | null) ?? null,
      createdAt: Number(row.created_at),
      className: (row.class_name as string | null) ?? null,
      studentName: (row.student_name as string | null) ?? null,
    };
  }
}
