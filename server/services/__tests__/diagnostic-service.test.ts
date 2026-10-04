import { describe, it, expect, beforeAll } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { DiagnosticService } from '../diagnostic-service.js';

describe('DiagnosticService / MistakeService 领域服务单元测试 (E3 深化)', () => {
  let service: DiagnosticService;
  const db = kernelContainer.db;

  const testLessonId = 'les-test-diag-01';
  const testClassId = 'cls-test-diag-01';
  const testStudentId1 = 'stu-test-diag-01';
  const testStudentId2 = 'stu-test-diag-02';
  const testElementId1 = 'elem-quiz-01';
  const testElementId2 = 'elem-quiz-02';

  const publishedEvents: Array<{ type: string; payload: any }> = [];
  const mockPublisher = async (type: string, payload: any) => {
    publishedEvents.push({ type, payload });
  };

  beforeAll(async () => {
    service = new DiagnosticService(db, mockPublisher as any);
    await runStartupMigrations(db);
    const now = Date.now();

    // 清理可能存在的历史脏数据
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(testLessonId);
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(testLessonId);
    db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(testLessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(testStudentId1, testStudentId2);

    // 基础种子数据
    db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
      testClassId,
      '物理高一(1)班',
      '实验班',
      now,
    );

    db.prepare(
      'INSERT INTO lessons (id, title, content, progress_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(testLessonId, '牛顿第一定律与惯性', '课堂核心内容', 'teacher_led', now, now);

    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testStudentId1, 'STU001', '张小明', 's1@test.com', now);

    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testStudentId2, 'STU002', '李小红', 's2@test.com', now);

    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      testClassId,
      testStudentId1,
      now,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      testClassId,
      testStudentId2,
      now,
    );

    // 白板测验题目元素
    const quiz1Data = JSON.stringify({
      question: '下列关于惯性的说法正确的是？',
      options: ['A) 速度越大惯性越大', 'B) 惯性大小只与质量有关', 'C) 静止物体没有惯性', 'D) 只有受力物体才有惯性'],
      correctAnswer: 'B',
      submissions: {},
    });
    db.prepare(
      'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testElementId1, testLessonId, 'quiz', quiz1Data, now);

    const quiz2Data = JSON.stringify({
      question: '物体在不受外力作用时，总保持什么状态？',
      options: ['A) 静止状态', 'B) 匀速直线运动', 'C) 静止或匀速直线运动状态', 'D) 减速运动'],
      correctAnswer: 'C',
      submissions: {},
    });
    db.prepare(
      'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testElementId2, testLessonId, 'quiz', quiz2Data, now);
  });

  describe('1. 随堂测验提交与批改判分 (submitQuiz)', () => {
    it('测验元素不存在时应抛出 404 错误', async () => {
      await expect(
        service.submitQuiz({
          lessonId: testLessonId,
          elementId: 'non-existent-quiz',
          studentId: testStudentId1,
          answer: 'B',
        }),
      ).rejects.toThrow('Quiz element not found');
    });

    it('提交正确答案时判定 100 分，写入唯一权威表并派发事件', async () => {
      const res = await service.submitQuiz({
        lessonId: testLessonId,
        elementId: testElementId1,
        studentId: testStudentId1,
        studentName: '张小明',
        answer: 'B',
        timeSpentMs: 5000,
      });

      expect(res.success).toBe(true);
      expect(res.isCorrect).toBe(true);
      expect(res.score).toBe(100);

      // 验证 DB 原子落库
      const row = db
        .prepare('SELECT * FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ? AND student_id = ?')
        .get(testLessonId, testElementId1, testStudentId1) as any;
      expect(row).toBeDefined();
      expect(row.score).toBe(100);
      expect(row.is_correct).toBe(1);
      expect(row.student_name).toBe('张小明');

      // 验证事件派发
      const lastEvent = publishedEvents[publishedEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent.payload.isCorrect).toBe(true);
      expect(lastEvent.payload.score).toBe(100);
    });

    it('提交错误答案时判定 0 分，重复提交触发 upsert 覆盖', async () => {
      const res = await service.submitQuiz({
        lessonId: testLessonId,
        elementId: testElementId1,
        studentId: testStudentId2,
        studentName: '李小红',
        answer: 'A', // 错误答案 (正确答案为 B)
        timeSpentMs: 8000,
      });

      expect(res.isCorrect).toBe(false);
      expect(res.score).toBe(0);

      // 学生 2 改正重答为 'B'
      const retryRes = await service.submitQuiz({
        lessonId: testLessonId,
        elementId: testElementId1,
        studentId: testStudentId2,
        studentName: '李小红',
        answer: 'B',
        timeSpentMs: 12000,
      });

      expect(retryRes.isCorrect).toBe(true);
      expect(retryRes.score).toBe(100);

      // DB 中该 (lessonId, elementId, studentId) 应只有一条记录，且为最新更新
      const allForStudent2 = db
        .prepare('SELECT * FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ? AND student_id = ?')
        .all(testLessonId, testElementId1, testStudentId2);
      expect(allForStudent2).toHaveLength(1);
    });
  });

  describe('2. 作答统计与明细检索 (getQuizCounts & getQuizSubmissions)', () => {
    it('正确统计各题作答人数', () => {
      const counts = service.getQuizCounts(testLessonId);
      expect(counts).toBeInstanceOf(Array);
      const q1 = counts.find((c) => c.elementId === testElementId1);
      expect(q1?.submissionCount).toBe(2);
    });

    it('获取测验明细，正确合并白板元数据与关系型作答流水', () => {
      const submissions = service.getQuizSubmissions(testLessonId);
      expect(submissions).toHaveLength(2);

      const q1 = submissions.find((q) => q.elementId === testElementId1);
      expect(q1).toBeDefined();
      expect(q1?.question).toContain('下列关于惯性的说法');
      expect(q1?.correctAnswer).toBe('B');
      expect(q1?.submissionCount).toBe(2);
      expect(q1?.submissions[testStudentId1]).toBeDefined();
      expect(q1?.submissions[testStudentId1].isCorrect).toBe(true);
    });
  });

  describe('3. 课前学情诊断与错题卡点归集 (getPreClassDiagnostic & getLessonMistakes)', () => {
    it('课程不存在时抛出 404', () => {
      expect(() => service.getPreClassDiagnostic('invalid-lesson-id')).toThrow('Lesson not found');
    });

    it('聚合错题卡点：正确计算错误率并标注教学建议与优先级', async () => {
      // 学生 1 在题 2 答错
      await service.submitQuiz({
        lessonId: testLessonId,
        elementId: testElementId2,
        studentId: testStudentId1,
        studentName: '张小明',
        answer: 'A', // 错误
      });

      // 插入预习进度
      db.prepare(
        'INSERT OR REPLACE INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
      ).run(testStudentId1, testLessonId, 1, 95, Date.now());
      db.prepare(
        'INSERT OR REPLACE INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
      ).run(testStudentId2, testLessonId, 0, 50, Date.now());

      const diag = service.getPreClassDiagnostic(testLessonId, testClassId);
      expect(diag).toBeDefined();
      expect(diag.lessonTitle).toBe('牛顿第一定律与惯性');
      expect(diag.prepSummary.totalStudents).toBe(2);
      expect(diag.prepSummary.completedCount).toBe(1);
      expect(diag.prepSummary.completionRate).toBe(50);

      // 分层分布: tierA (>=90) = 1, tierC (<60) = 1
      expect(diag.studentDistribution.tierA_mastered).toBe(1);
      expect(diag.studentDistribution.tierC_needSupport).toBe(1);

      // 错题卡点 (题 2 错误率为 100%)
      expect(diag.topMistakes.length).toBeGreaterThan(0);
      const m1 = diag.topMistakes[0];
      expect(m1.mistakeRate).toBe(100);
      expect(m1.status).toBe('high_priority');
      expect(m1.pedagogicalAdvice).toContain('微探究');
    });

    it('破冰心态打卡与即时查询', () => {
      const s1 = service.recordIcebreakerCheckin(testClassId, 'fullPower');
      expect(s1.fullPower).toBe(1);

      service.recordIcebreakerCheckin(testClassId, 'needCoffee');
      const stats = service.getIcebreakerStats(testClassId);
      expect(stats.fullPower).toBe(1);
      expect(stats.needCoffee).toBe(1);
      expect(stats.needHelp).toBe(0);
    });
  });

  describe('4. 卓越答题者榜单与作答模拟 (getTopPerformers & simulateQuizResponses)', () => {
    it('正确按总分和正确率排序卓越答题者榜单', () => {
      const res = service.getTopPerformers(testLessonId, 5);
      expect(res.success).toBe(true);
      expect(res.topPerformers.length).toBeGreaterThan(0);
      expect(res.summary.totalParticipants).toBe(2);
      expect(res.summary.averageScore).toBeGreaterThan(0);
    });

    it('无课节作答数据时优雅回退白板 JSON 聚合', () => {
      const emptyLessonId = 'les-test-empty-diag';
      const now = Date.now();
      db.prepare(
        'INSERT OR REPLACE INTO lessons (id, title, content, progress_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(emptyLessonId, '空白课节', '内容', 'teacher_led', now, now);

      const res = service.getTopPerformers(emptyLessonId, 5);
      expect(res.success).toBe(true);
      expect(res.topPerformers).toHaveLength(0);
      expect(res.summary.totalParticipants).toBe(0);
    });

    it('支持按 classId 过滤，只返回当前班级在册学生的作答', () => {
      const singleClassId = 'cls-test-single-student';
      db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
        singleClassId,
        '单人测试班',
        Date.now(),
      );
      db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        singleClassId,
        testStudentId1,
        Date.now(),
      );

      // singleClassId 只绑定了 testStudentId1
      const resWithClass = service.getTopPerformers(testLessonId, 5, singleClassId);
      expect(resWithClass.success).toBe(true);
      expect(resWithClass.topPerformers).toHaveLength(1);
      expect(resWithClass.topPerformers[0].studentId).toBe(testStudentId1);

      // 若传入不包含任何作答学生的空班级，诚实返回空列表
      const emptyClassId = 'cls-empty-test';
      const emptyRes = service.getTopPerformers(testLessonId, 5, emptyClassId);
      expect(emptyRes.success).toBe(true);
      expect(emptyRes.topPerformers).toHaveLength(0);
      expect(emptyRes.summary.totalParticipants).toBe(0);
    });

    it('模拟作答流程能批量生成答卷并调用事件钩子，且生成的 sim-quiz 假数据被榜单过滤隔离', async () => {
      const simulatedEvents: any[] = [];
      const results = await service.simulateQuizResponses(testLessonId, (ev) => {
        simulatedEvents.push(ev);
      });

      expect(results.length).toBeGreaterThan(0);
      expect(simulatedEvents.length).toBe(results.length);
      expect(results[0]).toHaveProperty('score');

      // 验证生成的 sim-quiz 假数据不会污染正式的 getTopPerformers 榜单
      const cleanList = service.getTopPerformers(testLessonId, 10);
      expect(cleanList.topPerformers.every((s) => !String(s.studentId).startsWith('sim-quiz'))).toBe(true);
    });
  });
});
