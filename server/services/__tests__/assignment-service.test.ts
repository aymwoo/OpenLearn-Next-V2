import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { AssignmentService, assignmentStorageDir } from '../assignment-service.js';

describe('AssignmentService 领域服务单元测试 (E3 深化)', () => {
  let service: AssignmentService;
  const db = kernelContainer.db;

  const testClassId = 'cls-test-asg-svc';
  const testStudentId = 'stu-test-asg-svc';
  const testOtherStudentId = 'stu-test-asg-other';
  const testLessonId = 'les-test-asg-svc';
  const testAssignmentId = 'asg-test-svc-01';

  const mockAiService = {
    generateText: async (prompt: string) => {
      if (prompt.includes('Generate a short 1-question quiz')) {
        return '{"title": "Python 变量作用域测验", "description": "测试全局与局部变量", "content": "x = 10, def f(): global x..."}';
      }
      if (prompt.includes('Analyze the following lesson content')) {
        return JSON.stringify({
          learningObjectives: ['理解力与运动关系'],
          questions: [
            {
              objective: '理解力与运动关系',
              question: '牛顿第一定律又称什么？',
              options: ['A) 惯性定律', 'B) 加速度定律', 'C) 作用反作用定律', 'D) 动量守恒'],
              correctAnswer: 'A) 惯性定律',
            },
          ],
        });
      }
      if (prompt.includes('warm and helpful AI tutor') || prompt.includes('strict but fair teacher')) {
        return '{"score": 90, "feedback": "回答准确，思路清晰！"}';
      }
      return '{}';
    },
  };

  const mockCommandBus = {
    execute: async (_cmd: any) => ({ success: true }),
  };

  beforeAll(async () => {
    service = new AssignmentService(db, mockAiService, mockCommandBus);
    await runStartupMigrations(db as unknown as import('../../bootstrap-db.js').MigrationDb); // strict: Database/MigrationDb 端口漂移，运行时相容
    const now = Date.now();

    // 清理历史测试数据
    db.prepare('DELETE FROM plugin_assignment_files WHERE assignment_id = ?').run(testAssignmentId);
    db.prepare('DELETE FROM plugin_assignments WHERE id = ?').run(testAssignmentId);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)').run(testClassId);
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(testStudentId, testOtherStudentId);

    // 初始化基础数据
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(testClassId, '物理高一(1)班', now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(testStudentId, 'ASG_001', '小明', now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(testOtherStudentId, 'ASG_002', '小红', now);
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(testClassId, testStudentId, now);
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      testLessonId,
      '牛顿运动定律',
      '第一定律：物体在没有外力作用时保持匀速运动或静止。',
      now,
      now,
    );

    // 初始化作业中心作业对象
    db.prepare(
      `INSERT OR REPLACE INTO plugin_assignments
       (id, title, class_id, lesson_id, status, max_files, max_file_size, allow_late, allowed_ext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(testAssignmentId, '牛顿力学综合实验报告', testClassId, testLessonId, 'published', 3, 1024 * 1024, 1, '.pdf,.png,.zip', now, now);
  });

  afterAll(() => {
    // 清除测试产生的临时存储目录
    const dir = assignmentStorageDir(testAssignmentId, testStudentId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('1. 传统作业与测试生命周期', () => {
    it('应成功创建传统作业并能按班级列出', () => {
      const astId = service.createTraditionalAssignment(testClassId, testLessonId, '牛顿第二定律作业', '课后习题', 'F=ma计算');
      expect(astId).toBeTruthy();

      const list = service.listClassAssignments(testClassId);
      const found = list.find((a) => a.id === astId);
      expect(found).toBeDefined();
      expect(found?.title).toBe('牛顿第二定律作业');
      expect(found?.content).toBe('F=ma计算');

      const detail = service.getTraditionalAssignment(astId);
      expect(detail?.id).toBe(astId);
    });

    it('学生作答提交与权限核验', () => {
      const astId = service.createTraditionalAssignment(testClassId, null, '测试作答', '', '');

      // 验证他人冒充提交拦截
      expect(() => {
        service.resolveTargetStudentId(testOtherStudentId, testStudentId, false);
      }).toThrow('Cannot submit assignment on behalf of another student');

      // 本人提交正常
      const resolved = service.resolveTargetStudentId(testStudentId, testStudentId, false);
      expect(resolved).toBe(testStudentId);

      // 写入作答提交
      service.submitTraditionalAssignment(astId, testStudentId, '我的作答内容');
      const submissions = service.listTraditionalSubmissions(astId);
      expect(submissions.length).toBe(1);
      expect(submissions[0].student_id).toBe(testStudentId);
      expect(submissions[0].content).toBe('我的作答内容');
    });

    it('AI 出题建议与智能批改', async () => {
      const generated = await service.generateQuizWithAi(testClassId, 'Python 变量');
      expect(generated.id).toBeTruthy();
      expect(generated.title).toBe('Python 变量作用域测验');

      const suggested = await service.suggestQuizWithAi(testLessonId);
      expect(suggested.questions.length).toBeGreaterThan(0);

      const quizId = service.createSuggestedQuiz(testClassId, {
        title: '客观题测验',
        questions: suggested.questions,
        learningObjectives: suggested.learningObjectives,
      });
      expect(quizId).toBeTruthy();

      // 学生提交客观题作答并执行自动评分
      service.submitTraditionalAssignment(quizId, testStudentId, JSON.stringify(['A) 惯性定律']));
      const grade = await service.gradeTraditionalAssignment(quizId, testStudentId);
      expect(grade.score).toBe(100);
      expect(grade.feedback).toBeTruthy();
    });
  });

  describe('2. 作业中心文件上传安全防护与配额管控', () => {
    it('非本班学生上传作业应被 403 拦截 (assertClassMembership)', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      await expect(
        service.uploadAssignmentFile({
          assignmentId: testAssignmentId,
          ownerStudentId: testOtherStudentId, // 未加入该班
          isPrivileged: false,
          fileName: 'report.png',
          buffer: pngBuffer,
        }),
      ).rejects.toThrow("Forbidden: You are not enrolled in this assignment's class");
    });

    it('空文件与不合规扩展名应被拦截', async () => {
      await expect(
        service.uploadAssignmentFile({
          assignmentId: testAssignmentId,
          ownerStudentId: testStudentId,
          isPrivileged: false,
          fileName: 'empty.png',
          buffer: Buffer.alloc(0),
        }),
      ).rejects.toThrow('Empty file body');

      await expect(
        service.uploadAssignmentFile({
          assignmentId: testAssignmentId,
          ownerStudentId: testStudentId,
          isPrivileged: false,
          fileName: 'evil.exe',
          buffer: Buffer.from([0x4d, 0x5a]),
        }),
      ).rejects.toThrow('File type not allowed');
    });

    it('合法 PNG 文件应成功上传落盘并记录元数据', async () => {
      // 构造合法 PNG Magic Bytes
      const validPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64, 0),
      ]);

      const res = await service.uploadAssignmentFile({
        assignmentId: testAssignmentId,
        ownerStudentId: testStudentId,
        isPrivileged: false,
        fileName: 'experiment_chart.png',
        buffer: validPng,
      });

      expect(res.id).toBeTruthy();
      expect(res.name).toBe('experiment_chart.png');
      expect(res.size).toBe(validPng.length);

      // 查询文件列表
      const files = service.listAssignmentFiles(testAssignmentId, testStudentId, false);
      expect(files.some((f) => f.id === res.id)).toBe(true);

      // 下载路径解析
      const download = service.getAssignmentFileDownloadPath(testAssignmentId, res.id, testStudentId, false);
      expect(download.originalName).toBe('experiment_chart.png');
      expect(fs.existsSync(download.absPath)).toBe(true);

      // 软删除
      service.softDeleteAssignmentFile(testAssignmentId, res.id, testStudentId, false);
      const afterDelete = service.listAssignmentFiles(testAssignmentId, testStudentId, false);
      expect(afterDelete.some((f) => f.id === res.id)).toBe(false);
    });

    it('软删除文件物理 GC 清理 (gcSoftDeletedAssignmentFiles)', async () => {
      // 伪造一条 10 天前的软删除记录
      const validPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(32, 1),
      ]);
      const res = await service.uploadAssignmentFile({
        assignmentId: testAssignmentId,
        ownerStudentId: testStudentId,
        isPrivileged: false,
        fileName: 'old_chart.png',
        buffer: validPng,
      });

      // 标记为 10 天前软删除
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE plugin_assignment_files SET deleted_at = ? WHERE id = ?').run(tenDaysAgo, res.id);

      // 执行 GC
      const removedCount = service.gcSoftDeletedAssignmentFiles(7 * 24 * 60 * 60 * 1000);
      expect(removedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
