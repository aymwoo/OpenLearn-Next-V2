import { describe, it, expect, beforeAll } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { GradingService } from '../grading-service.js';

describe('GradingService 领域服务单元测试 (E3)', () => {
  let service: GradingService;
  const testClassId = 'cls-service-test-e3';
  const testStudentAlice = 'stu-service-alice-e3';
  const testStudentBob = 'stu-service-bob-e3';
  const scheduleId = 'sch-svc-test-e3';
  let createdExamId: string;

  beforeAll(() => {
    service = new GradingService(kernelContainer.db);
    const db = kernelContainer.db;
    const now = Date.now();
    const nowStr = new Date().toISOString().split('T')[0];

    // 清理旧测试数据
    db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run(scheduleId);
    db.prepare('DELETE FROM schedules WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM exam_scores WHERE exam_id IN (SELECT id FROM exams WHERE class_id = ?)').run(testClassId);
    db.prepare('DELETE FROM exams WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM student_semester_reports WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM class_grade_weights WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);

    // 1. 初始化测试班级与学生
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      testClassId,
      '服务测试班级',
      now,
    );

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)',
    );
    insertStudent.run(testStudentAlice, 'SVC_001', 'Alice Service', now);
    insertStudent.run(testStudentBob, 'SVC_002', 'Bob Service', now);

    const enroll = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    enroll.run(testClassId, testStudentAlice, now);
    enroll.run(testClassId, testStudentBob, now);

    // 2. 初始化课节与课表
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('les-svc-dummy', '服务测试课节', now, now);

    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(scheduleId, testClassId, 'les-svc-dummy', nowStr, '09:00-10:00', 'completed', '', now);
  });

  describe('1. 权重管理与校验 (getGradeWeights & saveGradeWeights)', () => {
    it('当班级无自定义权重时应返回默认加权配置 (0.15, 0.25, 0.35, 0.25)', () => {
      const weights = service.getGradeWeights('cls-non-existent');
      expect(weights.attendance_weight).toBe(0.15);
      expect(weights.progress_weight).toBe(0.25);
      expect(weights.assignment_weight).toBe(0.35);
      expect(weights.exam_weight).toBe(0.25);
    });

    it('当权重总和不等于 1.0 或 100% 时应抛出异常', () => {
      expect(() => {
        service.saveGradeWeights(testClassId, {
          attendance_weight: 0.1,
          progress_weight: 0.2,
          assignment_weight: 0.3,
          exam_weight: 0.3, // sum = 0.9
        });
      }).toThrow('Weights sum must equal 1.0 or 100%');
    });

    it('百分比权重应自动标准化为 0-1 浮点数并持久化', () => {
      service.saveGradeWeights(testClassId, {
        attendance_weight: 20,
        progress_weight: 30,
        assignment_weight: 30,
        exam_weight: 20, // sum = 100
      });

      const updated = service.getGradeWeights(testClassId);
      expect(updated.attendance_weight).toBeCloseTo(0.2, 5);
      expect(updated.progress_weight).toBeCloseTo(0.3, 5);
      expect(updated.assignment_weight).toBeCloseTo(0.3, 5);
      expect(updated.exam_weight).toBeCloseTo(0.2, 5);
    });
  });

  describe('2. 考勤聚合与记录 (recordAttendance & getAttendanceSummary)', () => {
    it('记录学生考勤并正确计算到出勤明细中', () => {
      service.recordAttendance(scheduleId, testStudentAlice, 'present');
      service.recordAttendance(scheduleId, testStudentBob, 'late');

      const records = service.getScheduleAttendance(scheduleId);
      expect(records.length).toBe(2);

      const summary = service.getAttendanceSummary(testClassId, 30);
      const item = summary.find((s) => s.id === scheduleId);
      expect(item).toBeDefined();
      expect(item?.present).toBe(1);
      expect(item?.late).toBe(1);
      expect(item?.total).toBe(2);
      // (present + late) / total = (1 + 1) / 2 = 100%
      expect(item?.attendanceRate).toBe(100);
    });
  });

  describe('3. 考试事务与成绩批量保存 (createExam & batchSaveExamScores)', () => {
    it('创建考试应校验标题并生成唯一 ID', () => {
      expect(() => service.createExam(testClassId, '')).toThrow('Title is required');

      createdExamId = service.createExam(testClassId, '单元测验A', '单元1与2复习', 100);
      expect(createdExamId).toMatch(/^exam-/);

      const exams = service.listExams(testClassId);
      const found = exams.find((e) => e.id === createdExamId);
      expect(found).toBeDefined();
      expect(found?.title).toBe('单元测验A');
    });

    it('批量录入考试成绩应原子生效且支持更新与置空', () => {
      service.batchSaveExamScores(createdExamId, [
        { studentId: testStudentAlice, score: 95, notes: '表现优秀' },
        { studentId: testStudentBob, score: null, notes: '缺考' },
      ]);

      const scores = service.getExamScores(createdExamId);
      const aliceScore = scores.find((s) => s.student_id === testStudentAlice);
      const bobScore = scores.find((s) => s.student_id === testStudentBob);

      expect(aliceScore?.score).toBe(95);
      expect(aliceScore?.notes).toBe('表现优秀');
      expect(bobScore?.score).toBeNull();
      expect(bobScore?.notes).toBe('缺考');
    });
  });

  describe('4. 学期综合总评计算引擎 (computeSemesterGrades)', () => {
    it('按考勤、作业、考试和进度准确加权计算学生期末总评与等级分档', () => {
      const result = service.computeSemesterGrades(testClassId, '2026年春季学期');
      expect(result.weights).toBeDefined();
      expect(result.students.length).toBe(2);

      const alice = result.students.find((s) => s.studentId === testStudentAlice);
      const bob = result.students.find((s) => s.studentId === testStudentBob);

      expect(alice).toBeDefined();
      expect(bob).toBeDefined();

      // Alice: 出勤 present=100分，考试 95分，无作业时默认100，进度默认100
      // 权重: att:0.2, prog:0.3, assign:0.3, exam:0.2 -> 100*0.2 + 100*0.3 + 100*0.3 + 95*0.2 = 20 + 30 + 30 + 19 = 99
      expect(alice?.attendanceScore).toBe(100);
      expect(alice?.examScore).toBe(95);
      expect(alice?.totalScore).toBe(99);
      expect(alice?.gradeLevel).toBe('A');

      // Bob: 出勤 late=80分，考试缺考 (score is null) -> 0分，无作业默认100，进度100
      // 80*0.2 + 100*0.3 + 100*0.3 + 0*0.2 = 16 + 30 + 30 + 0 = 76
      expect(bob?.attendanceScore).toBe(80);
      expect(bob?.examScore).toBe(0);
      expect(bob?.totalScore).toBe(76);
      expect(bob?.gradeLevel).toBe('C');
    });
  });

  describe('5. 成绩归档保存与归档快照优先读取 (archiveSemesterReports)', () => {
    it('归档后再次计算总评应直接读取归档快照', () => {
      service.archiveSemesterReports(testClassId, '2026年春季学期', [
        {
          studentId: testStudentAlice,
          attendanceScore: 100,
          progressScore: 100,
          assignmentScore: 100,
          examScore: 100,
          totalScore: 100,
          gradeLevel: 'A',
          teacherEvaluation: '学期全优，继续保持！',
        },
      ]);

      const result = service.computeSemesterGrades(testClassId, '2026年春季学期');
      const alice = result.students.find((s) => s.studentId === testStudentAlice);

      expect(alice?.isArchived).toBe(true);
      expect(alice?.totalScore).toBe(100);
      expect(alice?.teacherEvaluation).toBe('学期全优，继续保持！');
    });
  });
});
