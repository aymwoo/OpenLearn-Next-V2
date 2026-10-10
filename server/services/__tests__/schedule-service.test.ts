/**
 * ScheduleService 单元测试套件
 *
 * 覆盖：
 * 1. 纯算法验证 (parseTimeSlot, isTimeOverlapping, expandRecurringSchedules)
 * 2. 三维冲突检测引擎 (班级时间冲突、教师时间冲突、机房空间冲突、自更新排除)
 * 3. 单条与批量排课事务与冲突阻断
 * 4. 课表列表查询与周循环匹配 (getTodaySchedules, listSchedules, getClassSchedules)
 * 5. 级联删除考勤事务 (deleteScheduleCascade)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { loadMigrationsFromDirectory, runMigrations } from '../../utils/migrate.js';
import {
  ScheduleService,
  parseTimeSlot,
  isTimeOverlapping,
  expandRecurringSchedules,
  ScheduleConflictError,
} from '../schedule-service.js';

describe('ScheduleService 领域服务与冲突检测引擎', () => {
  const db = kernelContainer.db;
  let scheduleService: ScheduleService;

  const TEACHER_1 = 'usr_sch_tea_001';
  const TEACHER_2 = 'usr_sch_tea_002';
  const LAB_ID = 'lab_sch_test_001';
  const CLASS_1 = 'cls_sch_test_001';
  const CLASS_2 = 'cls_sch_test_002'; // 分配在同一机房 LAB_ID
  const CLASS_3 = 'cls_sch_test_003'; // 无机房绑定

  let LESSON_1: string; // 由 TEACHER_1 创建
  let LESSON_2: string; // 由 TEACHER_1 创建
  let LESSON_3: string; // 由 TEACHER_2 创建

  beforeAll(async () => {
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../../migrations')));
    scheduleService = new ScheduleService(db);

    const now = Date.now();

    // 预置教师账号
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(TEACHER_1, 'tea_sch_1', 'hash', 'teacher', '张老师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(TEACHER_2, 'tea_sch_2', 'hash', 'teacher', '李老师', now);

    // 预置机房与班级
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, lab_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(CLASS_1, '高一(1)班', '实验班', LAB_ID, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, lab_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(CLASS_2, '高一(2)班', '普通班', LAB_ID, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, lab_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(CLASS_3, '高二(1)班', '文科班', null, now);

    // 预置课时
    LESSON_1 = `les_sch_${uuidv7()}`;
    LESSON_2 = `les_sch_${uuidv7()}`;
    LESSON_3 = `les_sch_${uuidv7()}`;

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(LESSON_1, 'Python 编程入门', TEACHER_1, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(LESSON_2, '算法与数据结构', TEACHER_1, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(LESSON_3, '高中通用技术', TEACHER_2, now, now);
  });

  afterAll(() => {
    try {
      db.prepare('DELETE FROM schedules WHERE class_id IN (?, ?, ?)').run(CLASS_1, CLASS_2, CLASS_3);
      db.prepare('DELETE FROM classes WHERE id IN (?, ?, ?)').run(CLASS_1, CLASS_2, CLASS_3);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(TEACHER_1, TEACHER_2);
      db.prepare('DELETE FROM lessons WHERE id IN (?, ?, ?)').run(LESSON_1, LESSON_2, LESSON_3);
    } catch {}
  });

  beforeEach(() => {
    // 清空测试班级的排课与考勤
    db.prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id IN (?, ?, ?))').run(
      CLASS_1,
      CLASS_2,
      CLASS_3,
    );
    db.prepare('DELETE FROM schedules WHERE class_id IN (?, ?, ?)').run(CLASS_1, CLASS_2, CLASS_3);
  });

  describe('1. 纯算法工具函数测试', () => {
    it('parseTimeSlot: 准确解析各种时段格式', () => {
      expect(parseTimeSlot('08:00 - 08:45')).toEqual({ startMin: 480, endMin: 525 });
      expect(parseTimeSlot('8:00-8:45')).toEqual({ startMin: 480, endMin: 525 });
      expect(parseTimeSlot('14:30 ~ 16:00')).toEqual({ startMin: 870, endMin: 960 });
      expect(parseTimeSlot('09:00')).toEqual({ startMin: 540, endMin: 585 });
      expect(parseTimeSlot('全天')).toEqual({ startMin: 0, endMin: 1440 });
      expect(parseTimeSlot('All-Day')).toEqual({ startMin: 0, endMin: 1440 });
      expect(parseTimeSlot(null)).toBeNull();
      expect(parseTimeSlot('未知时段')).toBeNull();
    });

    it('isTimeOverlapping: 准确判定时间区间是否重叠', () => {
      // 边界接触：不重叠 (08:00-08:45 与 08:45-09:30)
      expect(isTimeOverlapping('08:00 - 08:45', '08:45 - 09:30')).toBe(false);

      // 部分重叠 (08:00-09:00 与 08:30-09:30)
      expect(isTimeOverlapping('08:00 - 09:00', '08:30 - 09:30')).toBe(true);

      // 包含关系 (08:00-10:00 包含 08:30-09:15)
      expect(isTimeOverlapping('08:00 - 10:00', '08:30 - 09:15')).toBe(true);

      // 全天与其他时段均重叠
      expect(isTimeOverlapping('全天', '10:00 - 10:45')).toBe(true);
      expect(isTimeOverlapping(null, '10:00 - 10:45')).toBe(true);

      // 非标准离散字符串比较
      expect(isTimeOverlapping('第1节', '第1节')).toBe(true);
      expect(isTimeOverlapping('第1节', '第2节')).toBe(false);
    });

    it('parseTimeSlot: 非法时间（25:99/跨天/空区间）返回 null', () => {
      expect(parseTimeSlot('25:99')).toBeNull();
      expect(parseTimeSlot('23:00-01:00')).toBeNull();
      expect(parseTimeSlot('10:00-10:00')).toBeNull();
      expect(parseTimeSlot('08:00-08:45')).not.toBeNull();
    });

    it('expandRecurringSchedules: 准确按周期展开未来日期', () => {
      const items = expandRecurringSchedules({
        startDate: '2026-10-12', // 2026-10-12 是周一
        endDate: '2026-10-25',   // 跨两周
        daysOfWeek: [1, 3],      // 每周一、周三
        timeSlot: '08:00 - 08:45',
        notes: '周期性上课',
      });

      // 2 周内应有 4 次课：10-12(周一), 10-14(周三), 10-19(周一), 10-21(周三)
      expect(items.length).toBe(4);
      expect(items.map((i) => i.scheduledDate)).toEqual([
        '2026-10-12',
        '2026-10-14',
        '2026-10-19',
        '2026-10-21',
      ]);
      expect(items[0].timeSlot).toBe('08:00 - 08:45');
      expect(items[0].notes).toBe('周期性上课');
    });
  });

  describe('2. 三维冲突检测引擎 (detectConflicts)', () => {
    it('班级时间冲突：同一班级同一天重叠时段排课触发拦截', () => {
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '08:00 - 08:45',
      });

      const report = scheduleService.detectConflicts({
        classId: CLASS_1,
        scheduledDate: '2026-10-20',
        timeSlot: '08:30 - 09:15', // 重叠
      });

      expect(report.hasConflict).toBe(true);
      expect(report.conflicts[0].type).toBe('class_overlap');
      expect(report.conflicts[0].message).toContain('高一(1)班');
    });

    it('教师时间冲突：同一教师同一天在不同班级重叠时段排课触发拦截', () => {
      // 张老师已在 CLASS_1 排了 LESSON_1
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '09:00 - 09:45',
      });

      // 尝试在 CLASS_3 为张老师排 LESSON_2 (重叠时段 09:15-10:00)
      const report = scheduleService.detectConflicts({
        classId: CLASS_3,
        lessonId: LESSON_2,
        scheduledDate: '2026-10-20',
        timeSlot: '09:15 - 10:00',
      });

      expect(report.hasConflict).toBe(true);
      const teacherConflict = report.conflicts.find((c) => c.type === 'teacher_overlap');
      expect(teacherConflict).toBeDefined();
      expect(teacherConflict?.message).toContain('张老师');
      expect(teacherConflict?.message).toContain('高一(1)班');
    });

    it('机房空间冲突：分配在同一机房的两个班级在重叠时段排课触发拦截', () => {
      // CLASS_1 和 CLASS_2 均绑定了 LAB_ID
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '14:00 - 15:30',
      });

      // CLASS_2 尝试在相同时段排课，即使授课教师不同 (李老师 LESSON_3)
      const report = scheduleService.detectConflicts({
        classId: CLASS_2,
        lessonId: LESSON_3,
        scheduledDate: '2026-10-20',
        timeSlot: '14:30 - 16:00',
      });

      expect(report.hasConflict).toBe(true);
      const labConflict = report.conflicts.find((c) => c.type === 'lab_overlap');
      expect(labConflict).toBeDefined();
      expect(labConflict?.message).toContain('机房资源');
      expect(labConflict?.message).toContain('高一(1)班');
    });

    it('排除自身排课：更新同一排课时不会误判与自己冲突', () => {
      const created = scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '08:00 - 08:45',
      });

      const report = scheduleService.detectConflicts({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '08:00 - 08:45',
        excludeScheduleId: created.id,
      });

      expect(report.hasConflict).toBe(false);
      expect(report.conflicts.length).toBe(0);
    });
  });

  describe('3. 单条与批量排课 CRUD 与强门禁行为', () => {
    it('createSchedule: 发生冲突时默认抛出 ScheduleConflictError (HTTP 409)', () => {
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-21',
        timeSlot: '10:00 - 10:45',
      });

      expect(() => {
        scheduleService.createSchedule({
          classId: CLASS_1,
          lessonId: LESSON_1,
          scheduledDate: '2026-10-21',
          timeSlot: '10:15 - 11:00', // 冲突
        });
      }).toThrowError(ScheduleConflictError);
    });

    it('createSchedule: 传入 allowConflict=true 时允许强制覆盖创建', () => {
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-21',
        timeSlot: '10:00 - 10:45',
      });

      const forced = scheduleService.createSchedule(
        {
          classId: CLASS_1,
          lessonId: LESSON_1,
          scheduledDate: '2026-10-21',
          timeSlot: '10:15 - 11:00',
        },
        { allowConflict: true },
      );

      expect(forced).toBeDefined();
      expect(forced.id).toMatch(/^sch-/);
    });

    it('updateSchedule: 更新排课时同样执行冲突检测', () => {
      const schA = scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-22',
        timeSlot: '08:00 - 08:45',
      });

      const schB = scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-22',
        timeSlot: '14:00 - 14:45',
      });

      // 尝试把 schB 的时段修改为 schA 的时段，应被拦截
      expect(() => {
        scheduleService.updateSchedule(schB.id, CLASS_1, {
          scheduledDate: '2026-10-22',
          timeSlot: '08:00 - 08:45',
        });
      }).toThrowError(ScheduleConflictError);

      // 若修改为无冲突时段，应成功
      scheduleService.updateSchedule(schB.id, CLASS_1, {
        scheduledDate: '2026-10-22',
        timeSlot: '15:00 - 15:45',
        status: 'completed',
        notes: '调课',
      });

      const updated = scheduleService.getScheduleById(schB.id);
      expect(updated?.time_slot).toBe('15:00 - 15:45');
      expect(updated?.notes).toBe('调课');
    });

    it('createSchedule: 离散文本时段放行、malformed 时间 400 拒绝', () => {
      // e2e 夹具与“第N节”形态：无时间形态的短文本标签允许入库
      const discrete = scheduleService.createSchedule({
        classId: CLASS_3,
        lessonId: LESSON_3,
        scheduledDate: '2026-10-26',
        timeSlot: 'e2e',
      });
      expect(discrete.time_slot).toBe('e2e');
      // 同文本再次排布应冲突（文本相等口径）
      expect(() =>
        scheduleService.createSchedule({
          classId: CLASS_3,
          lessonId: LESSON_3,
          scheduledDate: '2026-10-26',
          timeSlot: 'e2e',
        }),
      ).toThrowError(ScheduleConflictError);
      // 含时间形态但非法：25:99 / 跨天一律 400
      expect(() =>
        scheduleService.createSchedule({
          classId: CLASS_3,
          lessonId: LESSON_3,
          scheduledDate: '2026-10-26',
          timeSlot: '25:99',
        }),
      ).toThrowError(/timeSlot/);
      expect(() =>
        scheduleService.createSchedule({
          classId: CLASS_3,
          lessonId: LESSON_3,
          scheduledDate: '2026-10-26',
          timeSlot: '23:00-01:00',
        }),
      ).toThrowError(/timeSlot/);
    });

    it('batchCreateSchedules: 批量排课原子事务与冲突拦截', () => {
      // 预先占有时段
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-23',
        timeSlot: '09:00 - 09:45',
      });

      // 尝试批量创建，其中一条有冲突
      expect(() => {
        scheduleService.batchCreateSchedules(CLASS_1, [
          { scheduledDate: '2026-10-24', timeSlot: '08:00 - 08:45' },
          { scheduledDate: '2026-10-23', timeSlot: '09:15 - 10:00' }, // 冲突
        ]);
      }).toThrowError(ScheduleConflictError);

      // 验证未产生脏数据（事务完整性）
      const listAfter = scheduleService.getClassSchedules(CLASS_1);
      expect(listAfter.length).toBe(1);

      // 批量创建合规排课
      const result = scheduleService.batchCreateSchedules(CLASS_1, [
        { scheduledDate: '2026-10-24', timeSlot: '08:00 - 08:45' },
        { scheduledDate: '2026-10-25', timeSlot: '08:00 - 08:45' },
      ]);
      expect(result.count).toBe(2);
      expect(result.ids.length).toBe(2);
    });
  });

  describe('4. 列表与周循环课表查询 (getTodaySchedules & listSchedules)', () => {
    it('listSchedules: 支持 A7 标准分页信封', () => {
      scheduleService.createSchedule({
        classId: CLASS_1,
        scheduledDate: '2026-10-28',
        timeSlot: '08:00 - 08:45',
      });
      scheduleService.createSchedule({
        classId: CLASS_1,
        scheduledDate: '2026-10-29',
        timeSlot: '09:00 - 09:45',
      });

      const page1 = scheduleService.listSchedules({ page: 1, pageSize: 1, offset: 0, isAll: false });
      expect(page1.data.length).toBe(1);
      expect(page1.pageSize).toBe(1);
      expect(page1.total).toBeGreaterThanOrEqual(2);
      expect(page1.data[0]).toHaveProperty('class_name');
    });

    it('getTodaySchedules: 周循环课表匹配与窗口排名', () => {
      // 插入周二的课 (2026-10-20 是周二)
      scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-20',
        timeSlot: '08:00 - 08:45',
        notes: '周二第一节',
      });

      // 模拟学生在另一周的周二 (2026-10-27 同样是周二) 查询今日课表
      const today = scheduleService.getTodaySchedules('2026-10-27');
      expect(today.length).toBeGreaterThanOrEqual(1);
      const matched = today.find((t) => t.class_id === CLASS_1 && t.time_slot === '08:00 - 08:45');
      expect(matched).toBeDefined();
      expect(matched?.scheduled_date).toBe('2026-10-27');
      expect(matched?.notes).toBe('周二第一节');
    });
  });

  describe('5. 级联删除考勤事务 (deleteScheduleCascade)', () => {
    it('删除排课时单事务原子清理关联考勤记录 (DATA-INT-01)', () => {
      const sch = scheduleService.createSchedule({
        classId: CLASS_1,
        lessonId: LESSON_1,
        scheduledDate: '2026-10-30',
        timeSlot: '08:00 - 08:45',
      });

      // 写入关联考勤
      db.prepare(
        'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run(sch.id, 'stu_001', 'present', Date.now());

      expect(db.prepare('SELECT COUNT(*) as n FROM attendance WHERE schedule_id = ?').get(sch.id)).toEqual({ n: 1 });

      // 执行级联删除
      scheduleService.deleteScheduleCascade(sch.id, CLASS_1);

      // 验证两者皆被清除
      expect(scheduleService.getScheduleById(sch.id)).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) as n FROM attendance WHERE schedule_id = ?').get(sch.id)).toEqual({ n: 0 });
    });
  });
});
