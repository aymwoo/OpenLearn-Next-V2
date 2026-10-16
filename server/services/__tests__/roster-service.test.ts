import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

    it('deleteClassCascade 应级联清理排座、分组、课堂会话、插件作业与考试记录 (HIGH-04)', () => {
      const clsId = service.createClass('待级联删除班级', undefined, testLabId);
      // 写入分组、选课和排座
      const grp = service.createGroup(clsId, { name: '临时组' });
      db.prepare(
        'INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)',
      ).run(clsId, 'dummy-student', testLabId, 1, 1);

      // 写入该班级的课堂会话与子项
      const now = Date.now();
      const sessId = `cs_cascade_${now}`;
      db.prepare(
        'INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(sessId, 'lesson_cascade', clsId, 'teacher', 'IN_CLASS_TEACHING', now);
      db.prepare(
        'INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('poll_cascade', sessId, 'lesson_cascade', 'SINGLE', '[]', now);

      // 写入插件作业
      db.prepare(
        'INSERT INTO plugin_assignments (id, class_id, lesson_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('passign_cascade', clsId, 'lesson_cascade', '作业标题', now, now);

      // 写入考试
      db.prepare('INSERT INTO exams (id, class_id, title, created_at) VALUES (?, ?, ?, ?)').run(
        'exam_cascade',
        clsId,
        '期中考试',
        now,
      );

      service.deleteClassCascade(clsId);

      const clsRow = db.prepare('SELECT id FROM classes WHERE id = ?').get(clsId);
      expect(clsRow).toBeUndefined();

      const grpRow = db.prepare('SELECT id FROM class_groups WHERE id = ?').get(grp.id);
      expect(grpRow).toBeUndefined();

      const seats = db.prepare('SELECT * FROM student_seats WHERE class_id = ?').all(clsId);
      expect(seats.length).toBe(0);

      const sessRow = db.prepare('SELECT id FROM classroom_sessions WHERE id = ?').get(sessId);
      expect(sessRow).toBeUndefined();

      const pollRow = db.prepare('SELECT id FROM classroom_quick_polls WHERE id = ?').get('poll_cascade');
      expect(pollRow).toBeUndefined();

      const passignRow = db.prepare('SELECT id FROM plugin_assignments WHERE id = ?').get('passign_cascade');
      expect(passignRow).toBeUndefined();

      const examRow = db.prepare('SELECT id FROM exams WHERE id = ?').get('exam_cascade');
      expect(examRow).toBeUndefined();
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
      db.prepare('INSERT OR IGNORE INTO exam_scores (exam_id, student_id, score, recorded_at) VALUES (?, ?, ?, ?)').run(
        'dummy-e',
        sid,
        88,
        now,
      );
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
      db.prepare('INSERT OR IGNORE INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)').run(
        sid,
        'notif-1',
      );

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

  describe('3. 批量导入学生统一实现 (importStudents)', () => {
    const cleanup: string[] = [];
    const rand = () => Math.random().toString(36).slice(2, 8);

    afterAll(() => {
      for (const id of cleanup) {
        try {
          service.deleteStudentCascade(id);
        } catch {
          /* 已删除 */
        }
      }
    });

    it('CSV 未提供密码时应自动生成 12 位初始密码并回传，库内存 bcrypt 哈希', () => {
      const { results, created } = service.importStudents([
        { name: '导入密码测试', student_number: `STU_PWD_${rand()}` },
      ]);

      expect(created).toBe(1);
      const r = results[0];
      expect(r.initial_password).toMatch(/^[a-zA-Z0-9]{12}$/);
      cleanup.push(r.id);

      const row = db.prepare('SELECT password FROM students WHERE id = ?').get(r.id) as any;
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(bcrypt.compareSync(r.initial_password!, row.password)).toBe(true);
    });

    it('CSV 显式提供密码时应按填写的值设置，且不回传明文', () => {
      const { results } = service.importStudents([
        { name: '指定密码测试', student_number: `STU_PWD2_${rand()}`, password: 'Teacher@2026' },
      ]);

      const r = results[0];
      cleanup.push(r.id);
      expect(r.initial_password).toBeUndefined();

      const row = db.prepare('SELECT password FROM students WHERE id = ?').get(r.id) as any;
      expect(bcrypt.compareSync('Teacher@2026', row.password)).toBe(true);
    });

    it('CSV 显式填写 123456 时应照用（CSV 无表单默认值，显式即明确选择）', () => {
      const { results } = service.importStudents([
        { name: '弱密码测试', student_number: `STU_PWD3_${rand()}`, password: '123456' },
      ]);

      const r = results[0];
      cleanup.push(r.id);
      expect(r.initial_password).toBeUndefined();
      const row = db.prepare('SELECT password FROM students WHERE id = ?').get(r.id) as any;
      expect(bcrypt.compareSync('123456', row.password)).toBe(true);
    });

    it('应尊重 CSV 传入的学号，而不是像旧 /api/classes/import 那样无条件重新生成', () => {
      const num = `STU_KEEP_${rand()}`;
      const { results } = service.importStudents([{ name: '学号保留测试', student_number: num }]);

      cleanup.push(results[0].id);
      expect(results[0].student_number).toBe(num);
      const row = db.prepare('SELECT student_number FROM students WHERE id = ?').get(results[0].id) as any;
      expect(row.student_number).toBe(num);
    });

    it('未填邮箱时也应按学号去重，重复导入不产生第二条记录', () => {
      const num = `STU_DEDUP_${rand()}`;
      const first = service.importStudents([{ name: '无邮箱同学', student_number: num }]);
      cleanup.push(first.results[0].id);

      const second = service.importStudents([{ name: '无邮箱同学', student_number: num }]);

      expect(second.created).toBe(0);
      expect(second.existing).toBe(1);
      expect(second.results[0].id).toBe(first.results[0].id);
      // 重复导入不得覆盖已有学生的密码
      expect(second.results[0].initial_password).toBeUndefined();

      const count = (db.prepare('SELECT COUNT(*) n FROM students WHERE student_number = ?').get(num) as any).n;
      expect(count).toBe(1);
    });

    it('按邮箱命中的已有学生应回传库内真实学号，而非 CSV 原值', () => {
      const email = `dedup_email_${rand()}@openlearn.local`;
      const realNum = `STU_REAL_${rand()}`;
      const first = service.importStudents([{ name: '真实学号同学', student_number: realNum, email }]);
      cleanup.push(first.results[0].id);

      // 第二次只给邮箱，学号列留空
      const second = service.importStudents([{ name: '真实学号同学', email }]);

      expect(second.results[0].created).toBe(false);
      expect(second.results[0].student_number).toBe(realNum);
    });

    it('导入应写入教师私有备注 private_notes', () => {
      const { results } = service.importStudents([
        { name: '备注测试', student_number: `STU_NOTE_${rand()}`, private_notes: '数学较弱, 需重点关注' },
      ]);

      cleanup.push(results[0].id);
      const row = db.prepare('SELECT private_notes FROM students WHERE id = ?').get(results[0].id) as any;
      expect(row.private_notes).toBe('数学较弱, 需重点关注');
    });

    it('无姓名行应被跳过，不产生空壳记录', () => {
      const { results } = service.importStudents([
        { name: '', email: `skip_${rand()}@openlearn.local` },
        { name: '   ', email: `skip2_${rand()}@openlearn.local` },
        { name: '正常同学', student_number: `STU_OK_${rand()}` },
      ]);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('正常同学');
      cleanup.push(results[0].id);
    });

    it('传入 classId 时应同时建立班级关系', () => {
      const clsId = service.createClass(`导入入班测试_${rand()}`);
      const { results } = service.importStudents([{ name: '入班同学', student_number: `STU_JOIN_${rand()}` }], {
        classId: clsId,
      });

      cleanup.push(results[0].id);
      const link = db
        .prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ?')
        .get(clsId, results[0].id);
      expect(link).toBeTruthy();
      service.deleteClassCascade(clsId);
    });

    it('班级不存在时应抛错且不落任何学生', () => {
      expect(() =>
        service.importStudents([{ name: '幽灵同学', student_number: `STU_GHOST_${rand()}` }], {
          classId: 'cls-does-not-exist-xyz',
        }),
      ).toThrow('Class not found');

      const count = (
        db.prepare('SELECT COUNT(*) n FROM students WHERE student_number LIKE ?').get(`STU_GHOST_%`) as any
      ).n;
      expect(count).toBe(0);
    });

    it('bulkEnrollStudents 应复用同一套去重/学号/密码逻辑并回传初始密码', () => {
      const clsId = service.createClass(`选课导入_${rand()}`);
      const num = `STU_ENROLL_${rand()}`;

      const res = service.bulkEnrollStudents(clsId, [{ name: '选课同学', student_number: num }]);

      expect(res.results[0].status).toBe('created_and_enrolled');
      expect(res.results[0].student_number).toBe(num);
      expect(res.results[0].initial_password).toMatch(/^[a-zA-Z0-9]{12}$/);
      cleanup.push(res.results[0].id);

      // 旧调用方不传密码时不应崩（字段为可选）
      const res2 = service.bulkEnrollStudents(clsId, [{ name: '选课同学', student_number: num }]);
      expect(res2.results[0].status).toBe('enrolled_existing');

      service.deleteClassCascade(clsId);
    });
  });

  describe('4. 批量导入选课与机房排座', () => {
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

      const absent = service.createStudent({ name: '未进课堂' });
      service.enrollStudent(clsId, absent.id);
      const presentOnly = service.getPickerCandidates(clsId, 'lesson-present', {
        restrictToPresentIds: [stu.id],
      });
      expect(presentOnly.map((c) => c.id)).toEqual([stu.id]);
      expect(presentOnly[0].term_picked_count).toBe(1);

      expect(service.getPickerCandidates(clsId, 'lesson-empty', { restrictToPresentIds: [] })).toEqual([]);

      service.deleteStudentCascade(absent.id);

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
