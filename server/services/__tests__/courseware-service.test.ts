import { describe, it, expect, beforeAll } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { CoursewareService } from '../courseware-service.js';

describe('CoursewareService 领域服务单元测试 (E3 深化)', () => {
  let service: CoursewareService;
  const cwId = 'cw-svc-test-01';
  const cwUuid = 'uuid-svc-test-01';
  const stuAlice = 'stu-cw-alice';
  const stuBob = 'stu-cw-bob';
  const guestAttemptId = 'att-cw-guest-01';
  const aliceAttemptId = 'att-cw-alice-01';

  beforeAll(() => {
    service = new CoursewareService(kernelContainer.db);
    const db = kernelContainer.db;
    const now = Date.now();

    // 清理测试数据
    db.prepare('DELETE FROM submission_result WHERE attempt_id IN (?, ?)').run(guestAttemptId, aliceAttemptId);
    db.prepare('DELETE FROM submission_raw WHERE attempt_id IN (?, ?)').run(guestAttemptId, aliceAttemptId);
    db.prepare('DELETE FROM courseware_attempt WHERE courseware_id = ?').run(cwId);
    db.prepare('DELETE FROM courseware WHERE id = ?').run(cwId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(stuAlice, stuBob);

    // 1. 初始化测试学生
    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)',
    );
    insertStudent.run(stuAlice, 'CW_001', 'Alice Courseware', now);
    insertStudent.run(stuBob, 'CW_002', 'Bob Courseware', now);

    // 2. 初始化测试课件
    db.prepare(
      'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(cwId, cwUuid, '物理力学仿真实验', 'html', 'index.html', now);

    // 3. 初始化测试 attempts
    const insertAttempt = db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    insertAttempt.run(guestAttemptId, cwId, 'guest', now, 'active');
    insertAttempt.run(aliceAttemptId, cwId, stuAlice, now, 'active');
  });

  describe('1. 跨域沙箱 Attempt 归属认领状态机 (adoptAttempt)', () => {
    it('未认证会话认领应抛出 401', async () => {
      await expect(service.adoptAttempt(guestAttemptId, null)).rejects.toThrow(
        'Authentication required to adopt an attempt',
      );
    });

    it('不存在的 attempt 认领应抛出 404', async () => {
      await expect(
        service.adoptAttempt('non-existent-attempt', { userId: stuAlice, role: 'student' }),
      ).rejects.toThrow('Attempt not found');
    });

    it('教师或管理员预览认领应直接放行 (adopted: false, reused: true)', async () => {
      const res = await service.adoptAttempt(guestAttemptId, { userId: 'teacher-01', role: 'teacher' });
      expect(res.adopted).toBe(false);
      expect(res.reused).toBe(true);
      expect(res.role).toBe('teacher');
    });

    it('无主 guest 哨兵 attempt 应被真实学生原子认领 (adopted: true)', async () => {
      const res = await service.adoptAttempt(guestAttemptId, { userId: stuAlice, role: 'student' });
      expect(res.adopted).toBe(true);
      expect(res.reused).toBe(true);
      expect(res.attemptId).toBe(guestAttemptId);

      // 验证数据库状态更新为 Alice
      const row = kernelContainer.db
        .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
        .get(guestAttemptId) as { student_id: string };
      expect(row.student_id).toBe(stuAlice);
    });

    it('已是本人名下的 attempt 认领应保持幂等 (adopted: false, reused: true)', async () => {
      const res = await service.adoptAttempt(guestAttemptId, { userId: stuAlice, role: 'student' });
      expect(res.adopted).toBe(false);
      expect(res.reused).toBe(true);
      expect(res.attemptId).toBe(guestAttemptId);
    });

    it('已被他人占用的 attempt 应为当前学生新建或复用其独立 active attempt (杜绝串号)', async () => {
      // Bob 尝试认领 Alice 占用的 guestAttemptId
      const res = await service.adoptAttempt(guestAttemptId, { userId: stuBob, role: 'student' });
      expect(res.adopted).toBe(false);
      expect(res.reused).toBe(true);
      expect(res.attemptId).not.toBe(guestAttemptId);
      expect(res.reason).toBe('attempt-owned-by-another-student');

      // 验证新建的 attempt 确属 Bob
      const row = kernelContainer.db
        .prepare('SELECT student_id, courseware_id FROM courseware_attempt WHERE id = ?')
        .get(res.attemptId) as { student_id: string; courseware_id: string };
      expect(row.student_id).toBe(stuBob);
      expect(row.courseware_id).toBe(cwId);
    });
  });

  describe('2. 榜单查询与敏感数据脱敏投影 (listAttempts)', () => {
    beforeAll(() => {
      // 写入测试成绩明细与评语
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          'res-alice-01',
          aliceAttemptId,
          95,
          '实验步骤严谨，分析深刻',
          1.0,
          JSON.stringify({ answers: ['A', 'C', 'D'], details: '敏感作答记录' }),
        );
    });

    it('教师查询榜单应完整包含 extra_json 与 comment', () => {
      const list = service.listAttempts({ coursewareUuid: cwUuid }, true);
      expect(list.total).toBeGreaterThanOrEqual(1);

      const aliceRow = list.data.find((item) => item.attemptId === aliceAttemptId);
      expect(aliceRow).toBeDefined();
      expect(aliceRow?.score).toBe(95);
      expect(aliceRow?.comment).toBe('实验步骤严谨，分析深刻');
      expect(aliceRow?.extra_json).toBeDefined();
      expect(aliceRow?.extra_json).toContain('敏感作答记录');
    });

    it('学生查询榜单必须安全脱敏 (自动剥离 extra_json 与 comment)', () => {
      const list = service.listAttempts({ coursewareUuid: cwUuid }, false);
      const aliceRow = list.data.find((item) => item.attemptId === aliceAttemptId);
      expect(aliceRow).toBeDefined();
      expect(aliceRow?.score).toBe(95);
      // 安全脱敏校验
      expect(aliceRow?.comment).toBeUndefined();
      expect(aliceRow?.extra_json).toBeUndefined();
    });
  });

  describe('3. 手写内联课件安全落库 (saveInlineCourseware)', () => {
    it('空代码应拒绝并抛出 400', () => {
      expect(() => service.saveInlineCourseware('')).toThrow('Missing code');
      expect(() => service.saveInlineCourseware('   ')).toThrow('Missing code');
    });

    it('超过 512KB 上限代码应拒绝并抛出 413', () => {
      const hugeCode = 'a'.repeat(513 * 1024);
      expect(() => service.saveInlineCourseware(hugeCode)).toThrow('Inline courseware too large (512KB max)');
    });

    it('合法代码应生成 SHA256 唯一摘要并支持幂等落库', () => {
      const sampleCode = '<!DOCTYPE html><html><body><h1>测试实验</h1></body></html>';
      const uuid1 = service.saveInlineCourseware(sampleCode);
      expect(uuid1).toMatch(/^inline-[a-f0-9]{16}$/);

      // 重复落库相同内容应返回相同 UUID
      const uuid2 = service.saveInlineCourseware(sampleCode);
      expect(uuid2).toBe(uuid1);

      // 验证写入数据库
      const row = kernelContainer.db
        .prepare('SELECT content FROM system_resources WHERE id = ?')
        .get(uuid1) as { content: string };
      expect(row.content).toBe(sampleCode);
    });
  });
});
