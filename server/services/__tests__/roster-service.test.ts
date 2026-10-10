import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { RosterService } from '../roster-service.js';

describe('RosterService 领域服务单元测试 (E3 深化)', () => {
  let service: RosterService;
  const db = kernelContainer.db;

  const testClassId = 'cls-test-roster-svc';
  const testStudentId = 'stu-test-roster-svc';
  const testLabId = 'lab-test-roster-svc';

  beforeAll(async () => {
    service = new RosterService(db);
    await runStartupMigrations(db as unknown as import('../../bootstrap-db.js').MigrationDb); // strict: Database/MigrationDb 端口漂移，运行时相容
    const now = Date.now();

    // 清理可能存在的历史测试数据
    db.prepare('DELETE FROM class_groups WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM computer_labs WHERE id = ?').run(testLabId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);
    db.prepare('DELETE FROM students WHERE id = ?').run(testStudentId);

    // 初始化测试机房
    db.prepare(
      'INSERT OR REPLACE INTO computer_labs (id, room_number, rows, cols, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testLabId, 'Test Lab 101', 5, 6, now);
  });

  describe('1. 班级生命周期与事务级联删除', () => {
    it('应成功创建班级并能够更新', () => {
      const clsId = service.createClass('高二(1)班', '实验班', testLabId);
      expect(clsId).toBeTruthy();

      service.updateClass(clsId, '高二(1)卓越班', '卓越实验班', testLabId);
      const list = service.listClasses({ limit: 10, offset: 0, sort: 'desc' } as any);
      const found = list.data.find((c) => c.id === clsId);
      expect(found).toBeDefined();
      expect(found?.name).toBe('高二(1)卓越班');
      expect(found?.lab_id).toBe(testLabId);
    });

    it('应能正确获取与生成班级加入口令', () => {
      const clsId = service.createClass('高二(2)班');
      const passcodeInfo = service.getClassPasscode(clsId);
      expect(passcodeInfo.classPasscode).toBeTruthy();
      expect(typeof passcodeInfo.classPasscode).toBe('string');
      expect(passcodeInfo.expiresAt).toBeGreaterThan(Date.now());
    });

    it('deleteClassCascade 应级联清理排座、分组和选课记录', () => {
      const clsId = service.createClass('待级联删除班级', undefined, testLabId);
      // 写入分组、选课和排座
      const grp = service.createGroup(clsId, { name: '临时组' });
      db.prepare('INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)').run(
        clsId,
        'dummy-student',
        testLabId,
        1,
        1,
      );

      service.deleteClassCascade(clsId);

      const clsRow = db.prepare('SELECT id FROM classes WHERE id = ?').get(clsId);
      expect(clsRow).toBeUndefined();

      const grpRow = db.prepare('SELECT id FROM class_groups WHERE id = ?').get(grp.id);
      expect(grpRow).toBeUndefined();

      const seats = db.prepare('SELECT * FROM student_seats WHERE class_id = ?').all(clsId);
      expect(seats.length).toBe(0);
    });
  });

  describe('2. 学生管理、初始密码与 12 表原子级联删除 (DATA-INT-01)', () => {
    it('教师未填密码时应生成 12 位高熵初始密码，库内存储 bcrypt 哈希', () => {
      const res = service.createStudent({
        name: '张三测试',
        email: 'zhangsan_test@openlearn.local',
      });

      expect(res.id).toBeTruthy();
      expect(res.initial_password).toBeTruthy();
      expect(res.initial_password?.length).toBe(12);

      // 验证数据库存储的是合法的 bcrypt 哈希
      const row = db.prepare('SELECT password FROM students WHERE id = ?').get(res.id) as any;
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(bcrypt.compareSync(res.initial_password!, row.password)).toBe(true);

      // 验证导出 GDPR 数据时密码已脱敏
      const exportData = service.exportStudentData(res.id);
      expect(exportData.student.password).toBe('[REDACTED]');
      expect(exportData.student.name).toBe('张三测试');

      // 清理
      service.deleteStudentCascade(res.id);
    });

    it('deleteStudentCascade 必须在单事务中彻底级联清理 12 张关联表', () => {
      const student = service.createStudent({
        name: '李四关联测试',
        student_number: `STU_CASCADE_${Date.now()}`,
      });
      const sid = student.id;
      const now = Date.now();

      // 在关联表中写入模拟关联数据
      db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)').run('dummy-c', sid);
      db.prepare(
        'INSERT OR IGNORE INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
      ).run(sid, 'dummy-l', 1, 100, now);
      db.prepare(
        'INSERT OR IGNORE INTO assignment_submissions (assignment_id, student_id, score, submitted_at) VALUES (?, ?, ?, ?)',
      ).run('dummy-a', sid, 95, now);
      db.prepare(
        'INSERT OR IGNORE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run('dummy-s', sid, 'present', now);
      db.prepare(
        'INSERT OR IGNORE INTO exam_scores (exam_id, student_id, score, recorded_at) VALUES (?, ?, ?, ?)',
      ).run('dummy-e', sid, 88, now);
      db.prepare(
        'INSERT OR IGNORE INTO student_semester_reports (id, student_id, class_id, semester_name, attendance_score, progress_score, assignment_score, exam_score, total_score, grade_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(`ssr-${sid}`, sid, 'dummy-c', '2026-春', 90, 90, 90, 90, 90, 'A', now, now);
      db.prepare(
        'INSERT OR IGNORE INTO student_rollcalls (id, student_id, class_id, picked_time) VALUES (?, ?, ?, ?)',
      ).run(`rc-${sid}`, sid, 'dummy-c', now);
      db.prepare(
        'INSERT OR IGNORE INTO plugin_submissions (id, lesson_id, student_id, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(`ps-${sid}`, 'dummy-l', sid, '/tmp/test.zip', now, now);
      db.prepare(
        'INSERT OR IGNORE INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`ppr-${sid}`, `ps-${sid}`, sid, 90, now);
      db.prepare(
        'INSERT OR IGNORE INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)',
      ).run('dummy-c', sid, testLabId, 2, 3);
      db.prepare(
        'INSERT OR IGNORE INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)',
      ).run(sid, 'notif-1');

      // 执行级联删除
      service.deleteStudentCascade(sid);

      // 验证全部清理干净
      expect(db.prepare('SELECT id FROM students WHERE id = ?').get(sid)).toBeUndefined();
      expect(db.prepare('SELECT * FROM class_students WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM student_lesson_progress WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM assignment_submissions WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM attendance WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM exam_scores WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM student_semester_reports WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM student_rollcalls WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM plugin_submissions WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM plugin_peer_reviews WHERE reviewer_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM student_seats WHERE student_id = ?').all(sid).length).toBe(0);
      expect(db.prepare('SELECT * FROM student_read_notifications WHERE student_id = ?').all(sid).length).toBe(0);
    });
  });

  describe('3. 批量导入选课与机房排座', () => {
    it('bulkEnrollStudents 应支持新学生创建并选课，以及已有邮箱学生复用选课', () => {
      const clsId = service.createClass('批量选课班级');
      const rand = Math.random().toString(36).slice(2, 7);
      const email1 = `bulk_stu_01_${rand}@openlearn.local`;
      const email2 = `bulk_stu_02_${rand}@openlearn.local`;

      // 首次批量导入
      const results1 = service.bulkEnrollStudents(clsId, [
        { name: '学生A', email: email1 },
        { name: '学生B', email: email2 },
      ]);

      expect(results1.results.length).toBe(2);
      expect(results1.results[0].status).toBe('created_and_enrolled');
      expect(results1.results[0].student_number).toBeTruthy();

      // 再次导入包含已有邮箱的学生
      const clsId2 = service.createClass('第二个班级');
      const results2 = service.bulkEnrollStudents(clsId2, [{ name: '学生A重名', email: email1 }]);

      expect(results2.results.length).toBe(1);
      expect(results2.results[0].status).toBe('enrolled_existing');
      expect(results2.results[0].id).toBe(results1.results[0].id);

      // 清理
      service.deleteClassCascade(clsId);
      service.deleteClassCascade(clsId2);
      service.deleteStudentCascade(results1.results[0].id);
      service.deleteStudentCascade(results1.results[1].id);
    });

    it('saveClassSeats 应支持批量覆盖排座并同步更新 classes.lab_id', () => {
      const clsId = service.createClass('机房测试班');
      const s1 = service.createStudent({ name: '机房学生1' });
      const s2 = service.createStudent({ name: '机房学生2' });

      service.saveClassSeats(clsId, testLabId, [
        { student_id: s1.id, row_idx: 1, col_idx: 1 },
        { student_id: s2.id, row_idx: 1, col_idx: 2 },
      ]);

      const seatResult = service.getClassSeats(clsId);
      expect(seatResult.lab_id).toBe(testLabId);
      expect(seatResult.seats.length).toBe(2);
      expect(seatResult.seats.find((s: any) => s.student_id === s1.id)?.row_idx).toBe(1);

      // 检查 classes.lab_id 是否被同步关联
      const clsRow = db.prepare('SELECT lab_id FROM classes WHERE id = ?').get(clsId) as any;
      expect(clsRow.lab_id).toBe(testLabId);

      // 清理
      service.deleteClassCascade(clsId);
      service.deleteStudentCascade(s1.id);
      service.deleteStudentCascade(s2.id);
    });
  });

  describe('4. 班级自动均分分组与组长设定', () => {
    it('autoGroup 应按指定组数均分学生，并自动指定首个成员为组长', () => {
      const clsId = service.createClass('分组测试班');
      const students = [
        service.createStudent({ name: '组员1' }),
        service.createStudent({ name: '组员2' }),
        service.createStudent({ name: '组员3' }),
        service.createStudent({ name: '组员4' }),
      ];

      for (const s of students) {
        service.enrollStudent(clsId, s.id);
      }

      const groups = service.autoGroup(clsId, 2);
      expect(groups.length).toBe(2);
      expect(groups[0].memberIds.length).toBe(2);
      expect(groups[0].leader_id).toBeTruthy();
      expect(groups[0].memberIds).toContain(groups[0].leader_id!);
      expect(groups[0].is_default).toBe(true);

      // 测试 updateGroup 调换组长与更新信息
      const updated = service.updateGroup(clsId, groups[0].id, {
        name: '先锋第一组',
        color: 'bg-emerald-500',
      });
      expect(updated.name).toBe('先锋第一组');
      expect(updated.color).toBe('bg-emerald-500');

      // 清理
      service.deleteClassCascade(clsId);
      for (const s of students) {
        service.deleteStudentCascade(s.id);
      }
    });
  });

  describe('5. 点名评价记录与分层推荐池', () => {
    it('evaluateRollcall 应支持记录与冲突 upsert', () => {
      const stu = service.createStudent({ name: '抽问学生' });
      const clsId = service.createClass('抽问班级');
      service.enrollStudent(clsId, stu.id);

      const rollcall = service.evaluateRollcall({
        studentId: stu.id,
        studentName: '抽问学生',
        classId: clsId,
        rating: '5',
        score: 100,
        rewardCoins: 5,
        difficulty: 'advanced',
      });

      expect(rollcall.rollcallId).toBeTruthy();
      expect(rollcall.score).toBe(100);
      expect(rollcall.rewardCoins).toBe(5);

      // 获取分层推荐候选人池
      const candidates = service.getPickerCandidates(clsId);
      const found = candidates.find((c) => c.id === stu.id);
      expect(found).toBeDefined();
      expect(found?.term_picked_count).toBe(1);
      expect(found?.total_reward_coins).toBe(5);

      // 清理
      service.deleteClassCascade(clsId);
      service.deleteStudentCascade(stu.id);
    });
  });

  // ── 回归：归属校验丢失 + 全量覆盖（审计第 2 批）────────────────────────────
  describe('6. deleteGroup 归属作用域与 updateClass 部分更新', () => {
    const readClass = (id: string) => db.prepare('SELECT * FROM classes WHERE id = ?').get(id) as any;
    const groupRow = (id: string) => db.prepare('SELECT * FROM class_groups WHERE id = ?').get(id) as any;

    it('deleteGroup 跨班删除必须被拒，且一行都不能删（DELETE 缺 AND class_id = ? 的回归）', () => {
      const classA = service.createClass('归属甲班');
      const classB = service.createClass('归属乙班');
      const groupB = service.createGroup(classB, { name: '乙班小组' });

      // 用 A 班的 classId 去删 B 班的小组 —— 必须抛错
      expect(() => service.deleteGroup(classA, groupB.id)).toThrow('Group not found');

      // 关键断言：目标行必须仍在。修复前 SQL 是 `WHERE id = ?`，这里会 undefined。
      expect(groupRow(groupB.id)).toBeDefined();
      expect(groupRow(groupB.id).class_id).toBe(classB);
      // 两个视角都应保持一致：A 班看不到它，B 班仍持有它
      expect(service.listClassGroups(classA)).toHaveLength(0);
      expect(service.listClassGroups(classB).map((g) => g.id)).toContain(groupB.id);

      service.deleteClassCascade(classA);
      service.deleteClassCascade(classB);
    });

    it('deleteGroup 同班删除应成功；不存在的 group 应报错', () => {
      const clsId = service.createClass('归属同班');
      const grp = service.createGroup(clsId, { name: '同班小组' });

      service.deleteGroup(clsId, grp.id);
      expect(groupRow(grp.id)).toBeUndefined();
      expect(service.listClassGroups(clsId)).toHaveLength(0);

      // 不存在的 group id
      expect(() => service.deleteGroup(clsId, 'grp-does-not-exist')).toThrow('Group not found');
      // 班级存在但小组属于别的班级（上一条已覆盖）；这里补"班级本身不存在"
      expect(() => service.deleteGroup('cls-not-exist', grp.id)).toThrow('Group not found');

      service.deleteClassCascade(clsId);
    });

    it('updateClass 只传 name 时，description 与 lab_id 必须原样保留', () => {
      const clsId = service.createClass('部分更新甲班', '原始简介', testLabId);
      expect(readClass(clsId).lab_id).toBe(testLabId);

      // 只带 name —— 旧的全量覆盖写法会把 description / lab_id 一起清空
      service.updateClass(clsId, '部分更新甲班-改名');

      const after = readClass(clsId);
      expect(after.name).toBe('部分更新甲班-改名');
      expect(after.description).toBe('原始简介');
      // lab_id 是班级↔机房绑定，getClassSeats 依赖它，置空后排座 UI 失效
      expect(after.lab_id).toBe(testLabId);
      expect(service.getClassSeats(clsId).lab_id).toBe(testLabId);

      service.deleteClassCascade(clsId);
    });

    it('updateClass 只传 description 时应生效（回归重构前逐字段 if (x !== undefined)）', () => {
      const clsId = service.createClass('部分更新乙班', '旧简介', testLabId);

      // name / lab_id 均为 undefined：路由层旧门控 `if (name)` 会把这条请求整条丢弃
      service.updateClass(clsId, undefined, '新简介');

      const after = readClass(clsId);
      expect(after.description).toBe('新简介');
      expect(after.name).toBe('部分更新乙班');
      expect(after.lab_id).toBe(testLabId);

      service.deleteClassCascade(clsId);
    });

    it('updateClass 传全部字段时全部更新；空 name 报 400 语义错误；显式空串可清空', () => {
      const clsId = service.createClass('部分更新丙班', '丙班简介', testLabId);

      service.updateClass(clsId, '部分更新丙班-全量', '丙班新简介', '');
      const after = readClass(clsId);
      expect(after.name).toBe('部分更新丙班-全量');
      expect(after.description).toBe('丙班新简介');
      // 显式传 '' → 清空机房绑定（与"未传入"是两回事）
      expect(after.lab_id).toBeNull();

      // 空 name：400 语义，且不应改坏已有数据
      let caught: any;
      try {
        service.updateClass(clsId, '   ');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toContain('Class name is required');
      expect(caught.status).toBe(400);
      expect(readClass(clsId).name).toBe('部分更新丙班-全量');

      // 一个字段都没传 → 400（而不是静默成功）
      let empty: any;
      try {
        service.updateClass(clsId);
      } catch (e) {
        empty = e;
      }
      expect(empty?.status).toBe(400);

      // 班级不存在 → 404
      let missing: any;
      try {
        service.updateClass('cls-not-exist-xyz', '改名试试');
      } catch (e) {
        missing = e;
      }
      expect(missing?.message).toContain('Class not found');
      expect(missing?.status).toBe(404);

      service.deleteClassCascade(clsId);
    });
  });
});
