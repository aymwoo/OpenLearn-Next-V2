/**
 * 排课与课表管理领域服务 (ScheduleService)
 *
 * 承载排课核心业务逻辑：
 * 1. 列表与周循环课表查询 (A7 分页信封与窗口匹配)；
 * 2. 三维排课冲突检测引擎 (班级冲突、教师冲突、机房冲突)；
 * 3. 周期性排课跨周展开 (Recurring Expansion) 与批量排课原子事务；
 * 4. 课表项与关联考勤级联删除事务 (DATA-INT-01)；
 * 5. 多模态 AI 课表 OCR 智能识别与数据清洗。
 *
 * 独立于 Express HTTP 传输层，可直接进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { decryptApiKey } from '../utils/crypto.js';
import { randomId } from '../utils/id.js';
import type { Pagination } from '../utils/pagination.js';
import type { StoredAIProvider } from '../context.js';
import { fetchWithRetry } from '../../packages/core/ai/utils/fetch-with-retry.js';

export interface ScheduleRecord {
  id: string;
  class_id: string;
  lesson_id: string;
  scheduled_date: string;
  time_slot: string | null;
  status: string | null;
  notes: string | null;
  created_at: number;
  lesson_title?: string;
  class_name?: string;
}

export interface CreateScheduleParams {
  classId: string;
  lessonId?: string | null;
  scheduledDate: string;
  timeSlot?: string | null;
  status?: string | null;
  notes?: string | null;
}

export interface UpdateScheduleParams {
  lessonId?: string | null;
  scheduledDate: string;
  timeSlot?: string | null;
  status?: string | null;
  notes?: string | null;
}

export interface BatchScheduleItem {
  lessonId?: string;
  lesson_id?: string;
  scheduledDate?: string;
  scheduled_date?: string;
  timeSlot?: string | null;
  time_slot?: string | null;
  status?: string | null;
  notes?: string | null;
}

export interface RecurringScheduleParams {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysOfWeek: number[]; // 0=周日, 1=周一, ..., 6=周六
  timeSlot?: string | null;
  lessonId?: string | null;
  status?: string | null;
  notes?: string | null;
}

export type ConflictType = 'class_overlap' | 'teacher_overlap' | 'lab_overlap';

export interface ScheduleConflictItem {
  type: ConflictType;
  message: string;
  conflictingScheduleId: string;
  conflictingClassId: string;
  conflictingClassName?: string;
  conflictingLessonId?: string;
  conflictingLessonTitle?: string;
  conflictingTeacherId?: string;
  conflictingTeacherName?: string;
  timeSlot?: string | null;
}

export interface ScheduleConflictReport {
  hasConflict: boolean;
  conflicts: ScheduleConflictItem[];
}

export interface DetectConflictsParams {
  classId: string;
  scheduledDate: string;
  timeSlot?: string | null;
  lessonId?: string | null;
  excludeScheduleId?: string;
}

export class ScheduleConflictError extends Error {
  status = 409;
  code = 'SCHEDULE_CONFLICT';
  conflicts: ScheduleConflictItem[];

  constructor(message: string, conflicts: ScheduleConflictItem[]) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
  }
}

/**
 * 解析时段字符串为起止分钟数（从当天 00:00 起算）
 * 覆盖：
 * - "08:00 - 08:45" / "8:00-8:45" / "08:00~08:45"
 * - "08:00"（默认45分钟）
 * - "全天" / "all-day" / null / "" -> [0, 1440)
 */
export function parseTimeSlot(timeSlot: string | null | undefined): { startMin: number; endMin: number } | null {
  if (!timeSlot || typeof timeSlot !== 'string') {
    return null;
  }
  const trimmed = timeSlot.trim();
  if (!trimmed || trimmed === '全天' || trimmed.toLowerCase() === 'all-day') {
    return { startMin: 0, endMin: 1440 };
  }

  // 匹配范围时段：08:00 - 08:45, 8:00~8:45, 08:00至08:45 等
  const rangeMatch = trimmed.match(/(\d{1,2}):(\d{2})\s*(?:[-~～—至到]|\s-\s)\s*(\d{1,2}):(\d{2})/);
  if (rangeMatch) {
    const sH = parseInt(rangeMatch[1], 10);
    const sM = parseInt(rangeMatch[2], 10);
    const eH = parseInt(rangeMatch[3], 10);
    const eM = parseInt(rangeMatch[4], 10);
    // P1 修复：此前接受 25:99 且跨天/空区间返回负区间导致漏检。此处做白名单校验。
    if (sH < 0 || sH > 23 || eH < 0 || eH > 24 || sM < 0 || sM > 59 || eM < 0 || eM > 59) return null;
    const startMin = sH * 60 + sM;
    const endMin = eH * 60 + eM;
    if (!(endMin > startMin && endMin <= 1440)) return null; // 明确禁止跨天/空区间
    return { startMin, endMin };
  }

  // 匹配单点时段：08:00
  const singleMatch = trimmed.match(/(\d{1,2}):(\d{2})/);
  if (singleMatch) {
    const sH = parseInt(singleMatch[1], 10);
    const sM = parseInt(singleMatch[2], 10);
    if (sH < 0 || sH > 23 || sM < 0 || sM > 59) return null;
    const startMin = sH * 60 + sM;
    return {
      startMin,
      endMin: Math.min(1440, startMin + 45),
    };
  }

  return null;
}

/**
 * 判断两个时段区间是否重叠
 * 数学充要条件：max(startA, startB) < min(endA, endB)
 */
export function isTimeOverlapping(slotA: string | null | undefined, slotB: string | null | undefined): boolean {
  const normA = (slotA || '').trim();
  const normB = (slotB || '').trim();

  // 若任一方为全天/未设定时段，视为覆盖全天，判定为与同日任意时段重叠
  if (
    !normA ||
    normA === '全天' ||
    normA.toLowerCase() === 'all-day' ||
    !normB ||
    normB === '全天' ||
    normB.toLowerCase() === 'all-day'
  ) {
    return true;
  }

  const rangeA = parseTimeSlot(normA);
  const rangeB = parseTimeSlot(normB);

  if (rangeA && rangeB) {
    return Math.max(rangeA.startMin, rangeB.startMin) < Math.min(rangeA.endMin, rangeB.endMin);
  }

  // 无法解析出分钟范围的离散文本（如 "第1节"），比较标准化文本是否相等
  return normA.toLowerCase() === normB.toLowerCase();
}

const SCHEDULE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// scheduled 占资源；cancelled/holiday 不占；swap/completed 为历史兼容状态（单测与存量数据在用）
const SCHEDULE_STATUS = new Set(['scheduled', 'cancelled', 'holiday', 'swap', 'completed']);

/** P1 输入校验：日期/时段/状态/外键存在性，失败抛 status=400 */
function assertValidScheduleInput(
  db: Database.Database,
  params: { classId: string; lessonId?: string | null; scheduledDate: string; timeSlot?: string | null; status?: string | null },
): void {
  const { classId, lessonId, scheduledDate, timeSlot, status } = params;
  const bad = (msg: string): Error => {
    const e = new Error(msg) as Error & { status: number };
    e.status = 400;
    return e;
  };
  if (!classId || typeof classId !== 'string') throw bad('classId is required');
  if (!scheduledDate || !SCHEDULE_DATE_RE.test(scheduledDate)) throw bad('scheduledDate must be YYYY-MM-DD');
  const [y, mo, d] = scheduledDate.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) throw bad('scheduledDate is not a real date');
  if (timeSlot != null && timeSlot !== '') {
    const parsed = parseTimeSlot(timeSlot);
    if (!parsed) throw bad('timeSlot must be HH:MM-HH:MM with 00:00<=start<end<=24:00');
  }
  if (status != null && status !== '' && !SCHEDULE_STATUS.has(status)) throw bad(`status must be one of ${[...SCHEDULE_STATUS].join('/')}`);
  const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId) as any;
  if (!cls) throw bad('classId does not exist');
  if (lessonId) {
    const les = db.prepare('SELECT id FROM lessons WHERE id = ?').get(lessonId) as any;
    if (!les) throw bad('lessonId does not exist');
  }
}

/**
 * 展开周期性排课模板为指定周次的单日排课列表
 */
export function expandRecurringSchedules(
  params: RecurringScheduleParams,
): Array<{ scheduledDate: string; timeSlot: string | null; lessonId: string; status: string; notes: string | null }> {
  const { startDate, endDate, daysOfWeek, timeSlot, lessonId, status, notes } = params;
  const results: Array<{
    scheduledDate: string;
    timeSlot: string | null;
    lessonId: string;
    status: string;
    notes: string | null;
  }> = [];

  // P1 修复：此前用 UTC（T00:00:00Z + getUTCDay/toISOString），UTC+8 晚间差一天。
  // 日期为无时区 YYYY-MM-DD，一律按本地历法展开。
  const m = (s: string) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  const ms = m(startDate);
  const me = m(endDate);
  if (!ms || !me) return results;
  const start = new Date(Number(ms[1]), Number(ms[2]) - 1, Number(ms[3]));
  const end = new Date(Number(me[1]), Number(me[2]) - 1, Number(me[3]));
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return results;
  }
  const pad = (n: number) => String(n).padStart(2, '0');

  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (daysOfWeek.includes(day)) {
      const dateStr = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`;
      results.push({
        scheduledDate: dateStr,
        timeSlot: timeSlot || null,
        lessonId: lessonId || '',
        status: status || 'scheduled',
        notes: notes || null,
      });
    }
    current.setDate(current.getDate() + 1);
  }

  return results;
}

export class ScheduleService {
  constructor(private db: Database.Database = kernelContainer.db) {}

  /**
   * 今日/指定日期的课表查询 (支持每周循环匹配与窗口排名)
   */
  public getTodaySchedules(clientDate: string): ScheduleRecord[] {
    // P1 修复：校验 YYYY-MM-DD（此前任意字符串进 strftime，行为未定义）；
    // 循环投影仅取 scheduled 状态，cancelled 不再幽灵复现；返回加 isRecurringProjection 语义注释
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clientDate || '')) return [];
    const query = `
      WITH RankedSchedules AS (
        SELECT s.*,
               ROW_NUMBER() OVER (
                 PARTITION BY s.class_id, s.time_slot, strftime('%w', s.scheduled_date)
                 ORDER BY s.scheduled_date DESC, s.created_at DESC
               ) as rn
        FROM schedules s
        WHERE strftime('%w', s.scheduled_date) = strftime('%w', ?)
          AND s.status = 'scheduled'
      )
      SELECT r.id, r.class_id, r.lesson_id, ? as scheduled_date, r.time_slot, r.status, r.notes, r.created_at,
             COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title, c.name as class_name
      FROM RankedSchedules r
      LEFT JOIN lessons l ON r.lesson_id = l.id
      JOIN classes c ON r.class_id = c.id
      WHERE r.rn = 1
      ORDER BY r.time_slot ASC, r.created_at ASC
    `;
    return this.db.prepare(query).all(clientDate, clientDate) as ScheduleRecord[];
  }

  /**
   * 分页查询全量排课列表 (A7 标准分页信封)
   */
  public listSchedules(pg: Pagination) {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM schedules').get() as any)?.n || 0;
    const schedules = this.db
      .prepare(
        `
        SELECT s.*, COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title, c.name as class_name
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        LEFT JOIN classes c ON s.class_id = c.id
        ORDER BY s.scheduled_date DESC, s.time_slot ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(pg.isAll ? -1 : pg.pageSize, pg.offset) as ScheduleRecord[];

    return {
      data: schedules,
      total,
      page: pg.page,
      pageSize: pg.isAll ? total : pg.pageSize,
    };
  }

  /**
   * 查询指定班级的所有排课列表 (维持裸数组兼容)
   */
  public getClassSchedules(classId: string): ScheduleRecord[] {
    return this.db
      .prepare(
        `
        SELECT s.*, COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        WHERE s.class_id = ?
        ORDER BY s.scheduled_date DESC, s.time_slot ASC
      `,
      )
      .all(classId) as ScheduleRecord[];
  }

  /**
   * 查询单个排课详情
   */
  public getScheduleById(scheduleId: string): ScheduleRecord | undefined {
    return this.db
      .prepare(
        `
        SELECT s.*, COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title, c.name as class_name
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.id = ?
      `,
      )
      .get(scheduleId) as ScheduleRecord | undefined;
  }

  /**
   * 排课冲突检测引擎 (三维冲突判定：班级、教师、机房)
   */
  public detectConflicts(params: DetectConflictsParams): ScheduleConflictReport {
    const { classId, scheduledDate, timeSlot, lessonId, excludeScheduleId } = params;
    const conflicts: ScheduleConflictItem[] = [];

    // 1. 班级时间冲突：同一班级在同一日期、重叠时段是否已有其他排课
    // P1 修复：已取消/假期不占资源，过滤幽灵占用
    const classSchedules = this.db
      .prepare(
        `
        SELECT s.*, COALESCE(l.title, '未设定内容') as lesson_title, c.name as class_name
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        JOIN classes c ON s.class_id = c.id
        WHERE s.class_id = ? AND s.scheduled_date = ? AND s.status NOT IN ('cancelled', 'holiday') ${excludeScheduleId ? 'AND s.id != ?' : ''}
      `,
      )
      .all(...(excludeScheduleId ? [classId, scheduledDate, excludeScheduleId] : [classId, scheduledDate])) as any[];

    for (const cs of classSchedules) {
      if (isTimeOverlapping(timeSlot, cs.time_slot)) {
        conflicts.push({
          type: 'class_overlap',
          message: `班级「${cs.class_name}」在时段 ${cs.time_slot || '全天'} 已排有课程「${cs.lesson_title}」`,
          conflictingScheduleId: cs.id,
          conflictingClassId: cs.class_id,
          conflictingClassName: cs.class_name,
          conflictingLessonId: cs.lesson_id,
          conflictingLessonTitle: cs.lesson_title,
          timeSlot: cs.time_slot,
        });
      }
    }

    // 2. 教师时间冲突：授课教师在同一日期、重叠时段是否已在其他班级排课
    if (lessonId) {
      const currentLesson = this.db
        .prepare('SELECT creator_id, title FROM lessons WHERE id = ?')
        .get(lessonId) as { creator_id: string | null; title: string } | undefined;

      if (currentLesson?.creator_id) {
        const teacherSchedules = this.db
          .prepare(
            `
            SELECT s.*, COALESCE(l.title, '未设定内容') as lesson_title, c.name as class_name, u.name as teacher_name
            FROM schedules s
            JOIN lessons l ON s.lesson_id = l.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN users u ON l.creator_id = u.id
            WHERE l.creator_id = ? AND s.scheduled_date = ? AND s.status NOT IN ('cancelled', 'holiday') ${excludeScheduleId ? 'AND s.id != ?' : ''}
          `,
          )
          .all(
            ...(excludeScheduleId
              ? [currentLesson.creator_id, scheduledDate, excludeScheduleId]
              : [currentLesson.creator_id, scheduledDate]),
          ) as any[];

        for (const ts of teacherSchedules) {
          if (ts.class_id !== classId && isTimeOverlapping(timeSlot, ts.time_slot)) {
            conflicts.push({
              type: 'teacher_overlap',
              message: `授课教师「${ts.teacher_name || currentLesson.creator_id}」在时段 ${ts.time_slot || '全天'} 已在班级「${ts.class_name}」排有课程「${ts.lesson_title}」`,
              conflictingScheduleId: ts.id,
              conflictingClassId: ts.class_id,
              conflictingClassName: ts.class_name,
              conflictingLessonId: ts.lesson_id,
              conflictingLessonTitle: ts.lesson_title,
              conflictingTeacherId: currentLesson.creator_id,
              conflictingTeacherName: ts.teacher_name,
              timeSlot: ts.time_slot,
            });
          }
        }
      }
    }

    // 3. 机房资源冲突：若当前班级关联了机房，其他分配到该机房的班级在同一日期、重叠时段是否已排课
    const currentClass = this.db
      .prepare('SELECT lab_id, name FROM classes WHERE id = ?')
      .get(classId) as { lab_id: string | null; name: string } | undefined;

    if (currentClass?.lab_id) {
      const labSchedules = this.db
        .prepare(
          `
          SELECT s.*, COALESCE(l.title, '未设定内容') as lesson_title, c.name as class_name, c.lab_id
          FROM schedules s
          JOIN classes c ON s.class_id = c.id
          LEFT JOIN lessons l ON s.lesson_id = l.id
          WHERE c.lab_id = ? AND s.class_id != ? AND s.scheduled_date = ? AND s.status NOT IN ('cancelled', 'holiday') ${excludeScheduleId ? 'AND s.id != ?' : ''}
        `,
        )
        .all(
          ...(excludeScheduleId
            ? [currentClass.lab_id, classId, scheduledDate, excludeScheduleId]
            : [currentClass.lab_id, classId, scheduledDate]),
        ) as any[];

      for (const ls of labSchedules) {
        if (isTimeOverlapping(timeSlot, ls.time_slot)) {
          conflicts.push({
            type: 'lab_overlap',
            message: `机房资源在时段 ${ls.time_slot || '全天'} 已被班级「${ls.class_name}」占用（课程「${ls.lesson_title}」）`,
            conflictingScheduleId: ls.id,
            conflictingClassId: ls.class_id,
            conflictingClassName: ls.class_name,
            conflictingLessonId: ls.lesson_id,
            conflictingLessonTitle: ls.lesson_title,
            timeSlot: ls.time_slot,
          });
        }
      }
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * 创建单条排课 (可配置冲突强校验)
   */
  public createSchedule(
    params: CreateScheduleParams,
    options?: { allowConflict?: boolean },
  ): ScheduleRecord {
    const { classId, lessonId, scheduledDate, timeSlot, status, notes } = params;
    assertValidScheduleInput(this.db, { classId, lessonId, scheduledDate, timeSlot, status });

    // P0 竞态修复：detect+insert 同事务（better-sqlite3 同进程串行），事務内重查
    const tx = this.db.transaction(() => {
      if (!options?.allowConflict) {
        const report = this.detectConflicts({
          classId,
          scheduledDate,
          timeSlot,
          lessonId,
        });
        if (report.hasConflict) {
          throw new ScheduleConflictError(
            `排课冲突：${report.conflicts[0].message}`,
            report.conflicts,
          );
        }
      }

      const id = randomId('sch-');
      const now = Date.now();

      this.db
        .prepare(
          `
          INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          classId,
          lessonId || '',
          scheduledDate,
          timeSlot || null,
          status || 'scheduled',
          notes || null,
          now,
        );
      return {
        id,
        class_id: classId,
        lesson_id: lessonId || '',
        scheduled_date: scheduledDate,
        time_slot: timeSlot || null,
        status: status || 'scheduled',
        notes: notes || null,
        created_at: now,
      };
    });

    return tx() as ScheduleRecord;
  }

  /**
   * 更新排课信息 (可配置冲突强校验)
   */
  public updateSchedule(
    scheduleId: string,
    classId: string,
    params: UpdateScheduleParams,
    options?: { allowConflict?: boolean },
  ): void {
    const { lessonId, scheduledDate, timeSlot, status, notes } = params;
    assertValidScheduleInput(this.db, { classId, lessonId, scheduledDate, timeSlot, status });

    const tx = this.db.transaction(() => {
      if (!options?.allowConflict) {
        const report = this.detectConflicts({
          classId,
          scheduledDate,
          timeSlot,
          lessonId,
          excludeScheduleId: scheduleId,
        });
        if (report.hasConflict) {
          throw new ScheduleConflictError(
            `排课冲突：${report.conflicts[0].message}`,
            report.conflicts,
          );
        }
      }

      this.db
        .prepare(
          `
          UPDATE schedules 
          SET lesson_id = ?, scheduled_date = ?, time_slot = ?, status = ?, notes = ?
          WHERE id = ? AND class_id = ?
        `,
        )
        .run(
          lessonId || '',
          scheduledDate,
          timeSlot || null,
          status || 'scheduled',
          notes || null,
          scheduleId,
          classId,
        );
    });
    tx();
  }

  /**
   * 级联删除排课记录及关联考勤表 (DATA-INT-01 原子事务)
   */
  public deleteScheduleCascade(scheduleId: string, classId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM schedules WHERE id = ? AND class_id = ?').run(scheduleId, classId);
      this.db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run(scheduleId);
    });
    tx();
  }

  /**
   * 批量创建排课 (原子事务封装)
   */
  public batchCreateSchedules(
    classId: string,
    schedules: BatchScheduleItem[],
    options?: { allowConflict?: boolean },
  ): { count: number; ids: string[] } {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return { count: 0, ids: [] };
    }
    if (schedules.length > 500) {
      const e = new Error('batch too large (max 500)') as Error & { status: number };
      e.status = 413;
      throw e;
    }

    // 归一化 + P1 逐条校验（空日期此前直接入库脏数据）
    const norm = schedules.map((item) => ({
      lessonId: item.lessonId || item.lesson_id || '',
      scheduledDate: item.scheduledDate || item.scheduled_date || '',
      timeSlot: item.timeSlot || item.time_slot || null,
      status: item.status || 'scheduled',
      notes: item.notes || null,
    }));
    for (const n of norm) {
      assertValidScheduleInput(this.db, { classId, lessonId: n.lessonId, scheduledDate: n.scheduledDate, timeSlot: n.timeSlot, status: n.status });
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const createdIds: string[] = [];
    const now = Date.now();

    // 检测与插入同事务：单实例串行化，全成功或全失败
    const tx = this.db.transaction(() => {
      if (!options?.allowConflict) {
        const allConflicts: ScheduleConflictItem[] = [];
        for (const n of norm) {
          const report = this.detectConflicts({ classId, scheduledDate: n.scheduledDate, timeSlot: n.timeSlot, lessonId: n.lessonId });
          if (report.hasConflict) allConflicts.push(...report.conflicts);
        }
        const byDate = new Map<string, typeof norm>();
        for (const n of norm) {
          const arr = byDate.get(n.scheduledDate) || [];
          arr.push(n);
          byDate.set(n.scheduledDate, arr);
        }
        for (const [, arr] of byDate) {
          for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
              if (isTimeOverlapping(arr[i].timeSlot, arr[j].timeSlot)) {
                allConflicts.push({
                  type: 'class_overlap',
                  message: `批量内自冲突：${arr[i].scheduledDate} ${arr[i].timeSlot || '全天'} 与 ${arr[j].timeSlot || '全天'} 重叠`,
                } as ScheduleConflictItem);
              }
            }
          }
        }
        if (allConflicts.length > 0) {
          throw new ScheduleConflictError(
            `批量排课检测到 ${allConflicts.length} 处冲突：${allConflicts[0].message}`,
            allConflicts,
          );
        }
      }
      for (const n of norm) {
        const id = randomId('sch-');
        createdIds.push(id);
        insertStmt.run(id, classId, n.lessonId, n.scheduledDate, n.timeSlot, n.status, n.notes, now);
      }
    });

    tx();
    return { count: norm.length, ids: createdIds };
  }

  /**
   * Timetable OCR 课表图像识别与数据清洗
   */
  public async processTimetableOcr(
    imageBase64: string,
    options: { lang?: string; providerId?: string } = {},
  ): Promise<{ entries: any[]; providerUsed: { id: string; name: string; model_name: string } }> {
    const { lang = 'zh', providerId } = options;

    if (!imageBase64) {
      throw new Error('imageBase64 is required');
    }

    const base64Content = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/[^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

    const prompt = `你是一个专业的课程表识别助手。请仔细分析这张学校教师的周课程表图片，直接提取出所有的课程条目。

重要指令（非常关键，必须遵守）：
1. 严禁输出任何长篇的推理过程、草稿或思考步骤（如不要输出 <think> 标签及其中的英文/中文思考过程）。
2. 直接以 JSON 格式输出课程表数据数组，不要有任何前导说明文字或后随文字。
3. 请立即输出结果，保持极简，避免输出长度超限而被API截断。

对于每一个课程条目，请提取以下信息：
- dayOfWeek: 星期几（1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六, 7=周日）
- periodNumber: 第几节课（1-9）
- className: 班级名称（例如 "高一(13)", "高二(5)"）
- subject: 科目名称（例如 "信息", "劳动", "数学"）
- timeSlot: 上课时间段（例如 "10:50-11:30"）。如果图片中可见，请填入具体时间。通常课表的最左侧或某列（“时间”列）会标注该节次对应的上下课时间（例如“第4节对应“10:50-11:30”），请将对应的时段填入该节次的所有课程条目中。如果确实不可见则为空字符串
- location: 教室/机房信息（如果图片中可见，例如 "312"），如果不可见则为空字符串
- teacherName: 教师姓名（如果图片中可见），如果不可见则为空字符串

请注意：
1. 必须提取课程表中的所有课程条目，不要遗漏
2. 仔细区分不同的星期和节次
3. 只返回一个有效的 JSON 数组，包含在方括号 [] 中，严禁使用 markdown 格式包裹
4. 如果某个字段在图片中不可见，请使用空字符串

返回格式示例：
[{"dayOfWeek":1,"periodNumber":1,"className":"高一(13)","subject":"信息","timeSlot":"08:00-08:40","location":"312","teacherName":""}]`;

    const provider = providerId
      ? (this.db
          .prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE id = ?')
          .get(providerId) as StoredAIProvider | undefined)
      : undefined;

    if (provider?.api_key) provider.api_key = decryptApiKey(provider.api_key);

    if (!provider || !provider.api_key || !provider.api_key.trim()) {
      throw new Error(
        lang === 'zh'
          ? '未检测到可用的 AI 提供商。请前往「系统管理 -> AI 提供商管理」添加并配置大模型服务。'
          : 'No AI provider configured. Please add and configure an AI Provider in "System Management -> AI Provider Management".',
      );
    }

    let chatUrl = provider.api_url.trim();
    if (!chatUrl.endsWith('/chat/completions')) {
      chatUrl = chatUrl.endsWith('/') ? chatUrl + 'chat/completions' : chatUrl + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.api_key.trim()}`,
    };

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Content}`,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ];

    const response = await fetchWithRetry(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages,
        temperature: 0.1,
        max_tokens: 8192,
      }),
      timeoutMs: 60_000,
      maxAttempts: 2,
    });

    const responseText = await response.text();
    if (!responseText || !responseText.trim()) {
      throw new Error(
        lang === 'zh'
          ? `AI Provider (${provider.name}) 返回了空响应，请检查模型是否支持图片识别。`
          : `AI Provider (${provider.name}) returned an empty response.`,
      );
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        lang === 'zh'
          ? `AI Provider (${provider.name}) 返回了非 JSON 响应: ${responseText.substring(0, 200)}`
          : `AI Provider (${provider.name}) returned non-JSON: ${responseText.substring(0, 200)}`,
      );
    }

    const text = data.choices?.[0]?.message?.content?.trim() || '';
    if (!text) {
      throw new Error(
        lang === 'zh'
          ? `AI Provider (${provider.name}) 未返回有效文本内容。可能该模型不支持图片输入。`
          : `AI Provider (${provider.name}) returned no text content. The model may not support image input.`,
      );
    }

    // 清洗 <think> 标签与 markdown 标记
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const startIdx = cleanText.indexOf('[');
    const endIdx = cleanText.lastIndexOf(']');

    let jsonStr = '';
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonStr = cleanText.substring(startIdx, endIdx + 1).trim();
    } else {
      jsonStr = cleanText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    }

    const entries = JSON.parse(jsonStr);
    return {
      entries,
      providerUsed: { id: provider.id, name: provider.name, model_name: provider.model_name },
    };
  }
}
