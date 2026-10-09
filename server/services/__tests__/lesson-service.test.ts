import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { LessonService } from '../lesson-service.js';

describe('LessonService 领域服务单元测试 (路线图 E3 深化)', () => {
  let service: LessonService;
  const db = kernelContainer.db;

  const teacherAliceId = 'usr_teacher_alice_ls';
  const teacherBobId = 'usr_teacher_bob_ls';
  const adminId = 'usr_admin_ls';
  const studentId = 'usr_student_charlie_ls';

  const aliceSession = {
    userId: teacherAliceId,
    username: 'alice_ls',
    role: 'teacher',
    name: 'Alice Teacher',
  };

  const bobSession = {
    userId: teacherBobId,
    username: 'bob_ls',
    role: 'teacher',
    name: 'Bob Teacher',
  };

  const adminSession = {
    userId: adminId,
    username: 'admin',
    role: 'administrator',
    name: 'Admin User',
  };

  const studentSession = {
    userId: studentId,
    username: 'charlie_ls',
    role: 'student',
    name: 'Charlie Student',
  };

  let testLessonId: string;
  let legacyLessonId: string;

  beforeAll(() => {
    service = new LessonService(db, kernelContainer.commandBus, kernelContainer.aiService);

    testLessonId = `lesson-ls-${uuidv7()}`;
    legacyLessonId = `lesson-legacy-ls-${uuidv7()}`;
    const now = Date.now();

    // 1. 初始化测试课程
    db.prepare(
      `
      INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(testLessonId, 'Alice Math 101', 'Calculus Intro', '[]', 'manual', teacherAliceId, now, now);

    db.prepare(
      `
      INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(legacyLessonId, 'Legacy Physics 101', 'Old Course', '[]', 'manual', null, now, now);
  });

  afterAll(() => {
    service.deleteLessonCascade(testLessonId);
    service.deleteLessonCascade(legacyLessonId);
  });

  describe('1. 课时基础查询与分页 (listLessons / getLesson)', () => {
    it('getLesson 应正确返回课程详情，不存在时返回 undefined', () => {
      const lesson = service.getLesson(testLessonId);
      expect(lesson).toBeDefined();
      expect(lesson.title).toBe('Alice Math 101');
      expect(lesson.creator_id).toBe(teacherAliceId);

      const nonExistent = service.getLesson('non-existent-lesson-id');
      expect(nonExistent).toBeUndefined();
    });

    it('listLessons 应输出 A7 标准分页信封 (data, total, page, pageSize)', () => {
      const res = service.listLessons({ page: 1, pageSize: 10, offset: 0, isAll: false });
      expect(res).toHaveProperty('data');
      expect(res).toHaveProperty('total');
      expect(res).toHaveProperty('page', 1);
      expect(res).toHaveProperty('pageSize', 10);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. 课时管理权与 IDOR 防护 (checkOwnership)', () => {
    it('未认证会话访问应返回 401', () => {
      const result = service.checkOwnership(testLessonId, null);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('Authentication required');
    });

    it('学生角色访问应返回 403', () => {
      const result = service.checkOwnership(testLessonId, studentSession);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('Only teachers or administrators');
    });

    it('不存在的课程访问应返回 404', () => {
      const result = service.checkOwnership('unknown-lesson-id', aliceSession);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toBe('Lesson not found');
    });

    it('创建教师本人访问应放行 (200, allowed: true)', () => {
      const result = service.checkOwnership(testLessonId, aliceSession);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
      expect(result.lesson).toBeDefined();
      expect(result.lesson.id).toBe(testLessonId);
    });

    it('其他教师访问应被拦截 (403 IDOR 防护)', () => {
      const result = service.checkOwnership(testLessonId, bobSession);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('created by another teacher');
    });

    it('管理员访问任意教师课程应无条件放行', () => {
      const result = service.checkOwnership(testLessonId, adminSession);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
    });

    it('历史遗留未记录 creator_id 的课程应向任意教师放行 (向后兼容)', () => {
      const result = service.checkOwnership(legacyLessonId, bobSession);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
    });
  });

  const teacherAliceActor = `user:${teacherAliceId}:teacher`;

  describe('3. 课时创建、时间轴更新与流转模式 (createLesson / updateTimeline / updateProgressMode)', () => {
    it('createLesson 应通过 commandBus 成功创建课程', async () => {
      const created = (await service.createLesson(
        { title: 'New Chemistry 101', content: 'Atomic Models', creatorId: teacherAliceId },
        teacherAliceActor,
      )) as any;
      expect(created).toBeDefined();
      expect(created.lessonId).toBeDefined();

      const saved = service.getLesson(created.lessonId);
      expect(saved).toBeDefined();
      expect(saved.title).toBe('New Chemistry 101');
      expect(saved.creator_id).toBe(teacherAliceId);

      // 清理
      service.deleteLessonCascade(created.lessonId);
    });

    it('updateTimeline 应更新时间轴并支持对象数组格式', async () => {
      const timelineData = [{ id: 'seg-1', title: '导入与提问', duration: 300, type: 'presentation' }];
      await service.updateTimeline({ lessonId: testLessonId, timeline: timelineData }, teacherAliceActor);

      const updated = service.getLesson(testLessonId);
      expect(updated.timeline).toContain('导入与提问');
    });

    it('updateProgressMode 应更新流转模式与进度规则', async () => {
      const conditions = { minQuizScore: 80, requireAttendance: true };
      const res = await service.updateProgressMode(testLessonId, 'gated', conditions);
      expect(res.success).toBe(true);

      const updated = service.getLesson(testLessonId);
      expect(updated.progress_mode).toBe('gated');
      expect(updated.progress_conditions).toContain('minQuizScore');
    });
  });

  describe('4. 课时深度克隆 (cloneLesson)', () => {
    it('应深克隆课时本体及所包含的全部白板图元', () => {
      // 在原课时写入 2 个白板图元
      const el1Id = uuidv7();
      const el2Id = uuidv7();
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        el1Id,
        testLessonId,
        'text',
        '{"text":"Formula 1"}',
        Date.now(),
      );
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        el2Id,
        testLessonId,
        'shape',
        '{"type":"rect"}',
        Date.now(),
      );

      const cloned = service.cloneLesson(testLessonId, teacherBobId);
      expect(cloned).toBeDefined();
      expect(cloned.id).not.toBe(testLessonId);
      expect(cloned.title).toBe('副本-Alice Math 101');
      expect(cloned.creator_id).toBe(teacherBobId);

      // 验证白板图元已被克隆且具有新 ID
      const clonedElements = db
        .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?')
        .all(cloned.id) as any[];
      expect(clonedElements.length).toBe(2);
      expect(clonedElements.some((e) => e.id === el1Id)).toBe(false);
      expect(clonedElements.some((e) => e.id === el2Id)).toBe(false);

      // 验证 stats
      const stats = service.getLessonStats(cloned.id);
      expect(stats.whiteboardCount).toBe(2);
      expect(stats.enrollmentCount).toBe(0);

      // 清理克隆课时
      service.deleteLessonCascade(cloned.id);
    });

    it('克隆不存在的课时应抛出 404', () => {
      expect(() => service.cloneLesson('non-existent-lesson', teacherBobId)).toThrow('Lesson not found');
    });
  });

  describe('5. 课时多表级联删除事务 (deleteLessonCascade)', () => {
    it('级联删除应在单事务内彻底清除 10+ 张关联表，零孤儿数据残留', () => {
      const cascadeLessonId = `lesson-cascade-${uuidv7()}`;
      const sessionId = `session-cascade-${uuidv7()}`;
      const pollId = `poll-cascade-${uuidv7()}`;
      const now = Date.now();

      // 1. 创建课时
      db.prepare(
        'INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(cascadeLessonId, 'Cascade Test Course', '', '[]', 'manual', teacherAliceId, now, now);

      // 2. 插入白板元素、排课、进度、作业、测验提交
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        uuidv7(),
        cascadeLessonId,
        'text',
        '{}',
        now,
      );
      db.prepare(
        'INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stu-test-cascade', cascadeLessonId, 0, 50, now);
      db.prepare(
        'INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(), 'cls-test-cascade', cascadeLessonId, '2026-10-10', '08:00-09:00', now);
      db.prepare(
        'INSERT INTO assignments (id, class_id, lesson_id, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(), 'cls-test-cascade', cascadeLessonId, 'Homework 1', '', now);
      db.prepare(
        'INSERT INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, answer, score, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(), cascadeLessonId, 'el-1', 'stu-test-cascade', 'A', 100, now);

      // 3. 插入课堂互动会话及其子表 (投票/快速投票/抢答/通票/晴雨表)
      db.prepare(
        'INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(sessionId, cascadeLessonId, 'cls-test-cascade', teacherAliceId, 'IN_CLASS', now, now);
      db.prepare(
        'INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, title, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(pollId, sessionId, cascadeLessonId, 'SINGLE_CHOICE', 'Q?', '[]', now);
      db.prepare(
        'INSERT INTO classroom_poll_votes (id, poll_id, student_id, selected_option, voted_at) VALUES (?, ?, ?, ?, ?)',
      ).run(uuidv7(), pollId, 'stu-test-cascade', 'A', now);
      db.prepare('INSERT INTO classroom_buzzers (id, session_id, lesson_id, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
        uuidv7(),
        sessionId,
        cascadeLessonId,
        'READY',
        now,
      );
      db.prepare(
        'INSERT INTO classroom_exit_tickets (id, session_id, lesson_id, student_id, rating, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(), sessionId, cascadeLessonId, 'stu-test-cascade', 5, 'Great class', now);
      db.prepare(
        'INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(uuidv7(), sessionId, 'stu-test-cascade', 'TOO_FAST', now);

      // 执行级联删除
      const delResult = service.deleteLessonCascade(cascadeLessonId);
      expect(delResult.success).toBe(true);
      expect(delResult.deleted).toBe(true);

      // 校验所有子表零残留
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM lessons WHERE id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM whiteboard_elements WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM student_lesson_progress WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM schedules WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM assignments WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_sessions WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_quick_polls WHERE session_id = ?').get(sessionId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_poll_votes WHERE poll_id = ?').get(pollId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_buzzers WHERE session_id = ?').get(sessionId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_exit_tickets WHERE session_id = ?').get(sessionId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM classroom_pacing_signals WHERE session_id = ?').get(sessionId) as any).n,
      ).toBe(0);
      expect(
        (db.prepare('SELECT COUNT(*) as n FROM lesson_quiz_submissions WHERE lesson_id = ?').get(cascadeLessonId) as any).n,
      ).toBe(0);
    });
  });

  describe('6. 作业互评与版本多模态展开 (getEvalSubmissions / getEvalGrades / getStudentEvalStatus)', () => {
    it('getEvalSubmissions 应正确解析展开最新版本的附件/纯文本/链接字段', () => {
      const subId = `sub-test-${uuidv7()}`;
      const now = Date.now();

      db.prepare(
        'INSERT INTO plugin_submissions (id, lesson_id, student_id, file_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(subId, testLessonId, studentId, null, 1, now, now);

      db.prepare(
        'INSERT INTO plugin_submission_versions (id, submission_id, student_id, version, files_json, text_content, link_url, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(uuidv7(), subId, studentId, 1, JSON.stringify(['https://example.com/file.pdf']), '这是我的解题思路', 'https://github.com/solution', now);

      const submissions = service.getEvalSubmissions(testLessonId);
      expect(submissions.length).toBeGreaterThanOrEqual(1);

      const target = submissions.find((s) => s.id === subId);
      expect(target).toBeDefined();
      expect(target.files).toEqual(['https://example.com/file.pdf']);
      expect(target.textContent).toBe('这是我的解题思路');
      expect(target.linkUrl).toBe('https://github.com/solution');

      // 清理
      db.prepare('DELETE FROM plugin_submission_versions WHERE submission_id = ?').run(subId);
      db.prepare('DELETE FROM plugin_submissions WHERE id = ?').run(subId);
    });
  });
});
