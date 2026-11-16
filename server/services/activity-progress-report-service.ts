/**
 * 学案进度报告与一键催办（Gitee IKVO15 P1）。
 * 催办消息单独存放，不改写活动进度或成绩。
 */
import type Database from 'better-sqlite3';
import { sanitizeUgcText } from '../../packages/core/security/ugc-sanitize.js';
import { randomId } from '../utils/id.js';
import {
  LessonActivityError,
  LessonActivityService,
  type ActivityStatus,
  type LessonActivityRecord,
} from './lesson-activity-service.js';
import { listStudentsForLesson, type LessonStudentRef } from './lesson-roster.js';

export const NUDGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface ActivityProgressReportRow {
  activity: LessonActivityRecord;
  totals: {
    students: number;
    notStarted: number;
    inProgress: number;
    submitted: number;
    graded: number;
    verified: number;
  };
  completionRate: number;
  verifiedRate: number;
  incomplete: Array<{
    studentId: string;
    name: string;
    classId: string;
    status: ActivityStatus;
    verified: boolean;
  }>;
}

export interface LessonProgressReport {
  lessonId: string;
  studentCount: number;
  activities: ActivityProgressReportRow[];
}

export interface ActivityNudgeRecord {
  id: string;
  lessonId: string;
  activityId: string | null;
  studentId: string;
  teacherId: string;
  message: string;
  createdAt: number;
}

export class ActivityProgressReportService {
  constructor(private readonly db: Database.Database) {}

  buildReport(lessonId: string, now = Date.now()): LessonProgressReport {
    const activityService = new LessonActivityService(this.db);
    activityService.assertLesson(lessonId);
    const pack = activityService.getTeacherPack(lessonId);
    const students = listStudentsForLesson(this.db, lessonId);
    const activities = pack.activities.map((activity) => this.buildActivityRow(activity, students, now));
    return { lessonId, studentCount: students.length, activities };
  }

  nudgeIncomplete(input: {
    lessonId: string;
    teacherId: string;
    activityId?: string | null;
    studentIds?: string[];
    message?: string;
    now?: number;
  }): { sent: ActivityNudgeRecord[]; skipped: Array<{ studentId: string; reason: string }> } {
    const now = input.now ?? Date.now();
    const report = this.buildReport(input.lessonId, now);
    const targetActivityId = input.activityId ?? null;
    const requested = new Set((input.studentIds || []).filter(Boolean));
    const incomplete = new Map<string, { name: string }>();

    for (const row of report.activities) {
      if (targetActivityId && row.activity.id !== targetActivityId) continue;
      if (targetActivityId == null && !row.activity.visible) continue;
      for (const student of row.incomplete) {
        if (requested.size > 0 && !requested.has(student.studentId)) continue;
        incomplete.set(student.studentId, { name: student.name });
      }
    }

    if (requested.size > 0) {
      for (const studentId of requested) {
        if (!incomplete.has(studentId)) {
          // 仍允许教师对指定学生发提醒，只要该学生属于课节名单
          const roster = listStudentsForLesson(this.db, input.lessonId);
          if (!roster.some((item) => item.id === studentId)) {
            throw new LessonActivityError(400, '学生不在该课节名单中');
          }
        }
      }
    }

    const studentIds = requested.size > 0 ? Array.from(requested) : Array.from(incomplete.keys());
    if (studentIds.length === 0) {
      throw new LessonActivityError(400, '没有可催办的未完成学生');
    }

    const defaultMessage =
      targetActivityId != null ? '请尽快完成尚未提交的学案活动。' : '请尽快完成尚未完成的学案活动。';
    const message = sanitizeUgcText(input.message || defaultMessage, 500) || defaultMessage;
    const sent: ActivityNudgeRecord[] = [];
    const skipped: Array<{ studentId: string; reason: string }> = [];
    const insert = this.db.prepare(
      `INSERT INTO activity_nudges (id, lesson_id, activity_id, student_id, teacher_id, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (const studentId of studentIds) {
        if (this.wasRecentlyNudged(input.lessonId, targetActivityId, studentId, now)) {
          skipped.push({ studentId, reason: '冷却时间内已催办' });
          continue;
        }
        const id = randomId('nud_');
        insert.run(id, input.lessonId, targetActivityId, studentId, input.teacherId, message, now);
        sent.push({
          id,
          lessonId: input.lessonId,
          activityId: targetActivityId,
          studentId,
          teacherId: input.teacherId,
          message,
          createdAt: now,
        });
      }
    });
    tx();
    return { sent, skipped };
  }

  listNudgesForStudent(studentId: string, since?: number): ActivityNudgeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_nudges WHERE student_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(studentId, since ?? 0) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      lessonId: String(row.lesson_id),
      activityId: (row.activity_id as string | null) ?? null,
      studentId: String(row.student_id),
      teacherId: String(row.teacher_id),
      message: String(row.message),
      createdAt: Number(row.created_at),
    }));
  }

  private wasRecentlyNudged(lessonId: string, activityId: string | null, studentId: string, now: number): boolean {
    const row = this.db
      .prepare(
        `SELECT created_at FROM activity_nudges
          WHERE lesson_id = ? AND student_id = ? AND ifnull(activity_id, '') = ifnull(?, '')
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(lessonId, studentId, activityId) as { created_at: number } | undefined;
    return !!row && now - Number(row.created_at) < NUDGE_COOLDOWN_MS;
  }

  private buildActivityRow(
    activity: LessonActivityRecord,
    students: LessonStudentRef[],
    now: number,
  ): ActivityProgressReportRow {
    const activityService = new LessonActivityService(this.db);
    const totals = {
      students: students.length,
      notStarted: 0,
      inProgress: 0,
      submitted: 0,
      graded: 0,
      verified: 0,
    };
    const incomplete: ActivityProgressReportRow['incomplete'] = [];
    for (const student of students) {
      const progress = activity.visible
        ? activityService.reconcileStudentActivity(activity, student.id, now)
        : { status: 'not_started' as ActivityStatus, verified: false };
      totals[statusKey(progress.status)] += 1;
      if (progress.verified) totals.verified += 1;
      const done = progress.status === 'submitted' || progress.status === 'graded';
      if (!done) {
        incomplete.push({
          studentId: student.id,
          name: student.name,
          classId: student.classId,
          status: progress.status,
          verified: !!progress.verified,
        });
      }
    }
    const completionRate =
      totals.students === 0 ? 0 : Math.round(((totals.submitted + totals.graded) / totals.students) * 100);
    const verifiedRate = totals.students === 0 ? 0 : Math.round((totals.verified / totals.students) * 100);
    return { activity, totals, completionRate, verifiedRate, incomplete };
  }
}

function statusKey(status: ActivityStatus): 'notStarted' | 'inProgress' | 'submitted' | 'graded' {
  if (status === 'in_progress') return 'inProgress';
  if (status === 'submitted') return 'submitted';
  if (status === 'graded') return 'graded';
  return 'notStarted';
}
