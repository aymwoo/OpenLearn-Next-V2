import { describe, it, expect, beforeAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ScheduleService } from '../services/schedule-service.js';
import { LessonService } from '../services/lesson-service.js';
import { DiagnosticService } from '../services/diagnostic-service.js';
import { RosterService } from '../services/roster-service.js';
import { parsePagination } from '../utils/pagination.js';

describe('PERF-01 Read Connection Pool Integration (Stage 2)', () => {
  const primaryDb = kernelContainer.db;
  const readDb = kernelContainer.getReadDb();

  let testClassId: string;
  let testLessonId: string;
  let testStudentId: string;

  beforeAll(() => {
    // 准备基础测试数据（直接使用主写连接写入）
    const now = Date.now();
    testClassId = `cls_perf_${now}`;
    testLessonId = `les_perf_${now}`;
    testStudentId = `stu_perf_${now}`;

    primaryDb
      .prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)')
      .run(testClassId, '只读连接性能测试班级', '测试用', now);

    primaryDb
      .prepare('INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testLessonId, '只读连接性能测试课时', '课时内容', 'teacher', now, now);

    primaryDb
      .prepare(
        'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(testStudentId, `SN_${now}`, '性能测试生', 'perf@test.com', 'pwd_hash', now);

    primaryDb
      .prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)')
      .run(testClassId, testStudentId, now);

    primaryDb
      .prepare('INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`sch_perf_${now}`, testClassId, testLessonId, '2026-10-14', '08:00 - 08:45', 'scheduled', now);
  });

  it('verifies readDb is configured with query_only = ON to reject writes', () => {
    expect(() => {
      readDb.prepare("INSERT INTO events (id, type, source, payload, timestamp) VALUES ('fake', 'test', 'test', '{}', 1)").run();
    }).toThrow(/readonly|attempt to write a readonly database/i);
  });

  it('ScheduleService operates seamlessly with read connection pool', () => {
    const service = new ScheduleService(primaryDb, readDb);

    // 1. 今日排课查询
    const todaySchedules = service.getTodaySchedules('2026-10-14', [testClassId]);
    expect(Array.isArray(todaySchedules)).toBe(true);

    // 2. 分页排课列表
    const pg = parsePagination({ page: '1', pageSize: '10' });
    const listResult = service.listSchedules(pg, [testClassId]);
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);
    expect(listResult.total).toBeGreaterThanOrEqual(1);

    // 3. 班级排课列表
    const classSchedules = service.getClassSchedules(testClassId);
    expect(classSchedules.length).toBeGreaterThanOrEqual(1);

    // 4. 冲突检测 (纯读)
    const report = service.detectConflicts({
      classId: testClassId,
      scheduledDate: '2026-10-14',
      timeSlot: '08:00 - 08:45',
      lessonId: testLessonId,
    });
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('LessonService executes reads through reader connection without locking primary db', () => {
    const service = new LessonService(primaryDb, kernelContainer.commandBus, kernelContainer.aiService, readDb);

    // 1. 分页课时列表
    const pg = parsePagination({ page: '1', pageSize: '10' });
    const listResult = service.listLessons(pg);
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);
    expect(listResult.total).toBeGreaterThanOrEqual(1);

    // 2. 课时详情
    const lesson = service.getLesson(testLessonId);
    expect(lesson).toBeDefined();
    expect(lesson.title).toBe('只读连接性能测试课时');

    // 3. 所有权校验
    const authResult = service.checkOwnership(testLessonId, { userId: 'teacher', role: 'teacher' });
    expect(authResult.allowed).toBe(true);

    // 4. 课时统计
    const stats = service.getLessonStats(testLessonId);
    expect(stats.scheduleCount).toBeGreaterThanOrEqual(1);
  });

  it('DiagnosticService executes reports and stats using read connection pool', () => {
    const diagService = new DiagnosticService(primaryDb, undefined as any, readDb);

    // 1. 课前诊断
    const report = diagService.getPreClassDiagnostic(testLessonId, testClassId);
    expect(report.lessonId).toBe(testLessonId);
    expect(report.lessonTitle).toBe('只读连接性能测试课时');
    expect(report.prepSummary.totalStudents).toBeGreaterThanOrEqual(1);

    // 2. 测验计数
    const quizCounts = diagService.getQuizCounts(testLessonId);
    expect(Array.isArray(quizCounts)).toBe(true);

    // 3. 卓越答题者榜单
    const topPerformers = diagService.getTopPerformers(testLessonId, 5, testClassId);
    expect(topPerformers.success).toBe(true);
    expect(Array.isArray(topPerformers.topPerformers)).toBe(true);
  });

  it('RosterService executes class, student, lab, and seat queries via reader', () => {
    const roster = new RosterService(primaryDb, readDb);

    // 1. 班级列表
    const pg = parsePagination({ page: '1', pageSize: '10' });
    const classes = roster.listClasses(pg);
    expect(classes.data.length).toBeGreaterThanOrEqual(1);

    // 2. 学生列表
    const students = roster.listStudents(pg);
    expect(students.data.length).toBeGreaterThanOrEqual(1);

    // 3. 班级学生
    const classStudents = roster.getClassStudents(testClassId);
    expect(classStudents.length).toBeGreaterThanOrEqual(1);
    expect(classStudents.some((s) => s.id === testStudentId)).toBe(true);

    // 4. 机房与座位
    const labs = roster.listLabs();
    expect(Array.isArray(labs)).toBe(true);

    const seats = roster.getClassSeats(testClassId);
    expect(Array.isArray(seats.seats)).toBe(true);

    // 5. 点名候选池
    const candidates = roster.getPickerCandidates(testClassId, testLessonId);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.some((c) => c.id === testStudentId)).toBe(true);
  });

  it('supports concurrent non-blocking reads during long write transactions (WAL concurrency)', async () => {
    const service = new ScheduleService(primaryDb, readDb);
    const tempClassId = `cls_tx_${Date.now()}`;

    // 在主连接上开启事务并执行插入，但在事务提交前通过只读连接发起读请求
    let readExecuted = false;
    let readCount = 0;

    const tx = primaryDb.transaction(() => {
      primaryDb
        .prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)')
        .run(tempClassId, '事务内临时班级', Date.now());

      // 在写事务尚未提交的临界期，使用只读池并发发起查询（验证不产生 SQLITE_BUSY 挂起）
      const readResult = service.listSchedules(parsePagination({ page: '1', pageSize: '5' }));
      readCount = readResult.total;
      readExecuted = true;
    });

    expect(() => tx()).not.toThrow();
    expect(readExecuted).toBe(true);
    expect(typeof readCount).toBe('number');

    // 清理事务数据
    primaryDb.prepare('DELETE FROM classes WHERE id = ?').run(tempClassId);
  });
});
