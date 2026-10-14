import { describe, it, expect, beforeAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { LessonService } from '../services/lesson-service.js';
import { checkCoreVersionDrift } from '../../cli-doctor.mjs';

describe('Stage 3 Data Integrity and Tooling Suite', () => {
  const db = kernelContainer.db;
  const lessonService = new LessonService(db, kernelContainer.getReadDb());

  describe('DATA-INT-02: Lesson Cascade Deletion and Orphan Prevention', () => {
    const testLessonId = `les_stage3_${Date.now()}`;
    const otherLessonId = `les_other_${Date.now()}`;
    const testClassId = `cls_stage3_${Date.now()}`;
    const testStudentId = `stu_stage3_${Date.now()}`;
    const testScheduleId = `sch_stage3_${Date.now()}`;
    const testAssignmentId = `asg_stage3_${Date.now()}`;
    const testSessionId = `ses_stage3_${Date.now()}`;
    const testPollId = `pol_stage3_${Date.now()}`;
    const testReviewId = `rev_stage3_${Date.now()}`;

    beforeAll(() => {
      const now = Date.now();

      // 1. 创建学生与班级
      db.prepare(
        'INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)',
      ).run(testClassId, '第三阶段测试班级', '测试用', now);

      db.prepare(
        'INSERT INTO students (id, student_number, name, email, password, locked_lesson_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(testStudentId, `SN_S3_${now}`, '三期测试生', 'stage3@test.com', 'pwd_hash', testLessonId, now);

      db.prepare(
        'INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
      ).run(testClassId, testStudentId, now);

      // 2. 创建主测课时与对照课时
      db.prepare(
        'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(testLessonId, '第三阶段级联删除测试课时', '课时内容', 'teacher', now, now);

      db.prepare(
        'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(otherLessonId, '对照无关课时', '课时内容', 'teacher', now, now);

      // 3. 关联白板与学情
      db.prepare(
        'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`wb_${now}`, testLessonId, 'rectangle', '{}', now);

      db.prepare(
        'INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
      ).run(testStudentId, testLessonId, 0, 80, now);

      // 4. 排课与考勤 (重点孤儿防范)
      db.prepare(
        'INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(testScheduleId, testClassId, testLessonId, '2026-10-15', '09:00 - 09:45', 'scheduled', now);

      db.prepare(
        'INSERT INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run(testScheduleId, testStudentId, 'present', now);

      // 5. 作业与作业提交 (重点孤儿防范)
      db.prepare(
        'INSERT INTO assignments (id, class_id, lesson_id, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(testAssignmentId, testClassId, testLessonId, '第三阶段课后作业', '题目内容', now);

      db.prepare(
        'INSERT INTO assignment_submissions (assignment_id, student_id, content, score, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(testAssignmentId, testStudentId, '学生作业作答', 95, now, 'graded');

      // 6. 课堂互动会话、测验与投票
      db.prepare(
        'INSERT INTO classroom_sessions (id, lesson_id, teacher_id, stage, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(testSessionId, testLessonId, 'teacher', 'active', now, now);

      db.prepare(
        'INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, title, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(testPollId, testSessionId, testLessonId, 'single', '课堂快速测验', '["A","B"]', now);

      db.prepare(
        'INSERT INTO classroom_poll_votes (id, poll_id, student_id, selected_option, voted_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`vot_${now}`, testPollId, testStudentId, 'A', now);

      db.prepare(
        'INSERT INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, answer, is_correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(`quiz_${now}`, testLessonId, 'elem_1', testStudentId, 'A', 1, now);

      // 7. 课堂互评五联表与大屏互动
      db.prepare(
        'INSERT INTO classroom_peer_review_tasks (id, session_id, lesson_id, class_id, reviewer_id, target_student_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(`cprt_${now}`, testSessionId, testLessonId, testClassId, testStudentId, 'other_student', now);

      db.prepare(
        'INSERT INTO classroom_peer_reviews (id, session_id, lesson_id, reviewer_id, target_student_id, target_attempt_id, score, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(testReviewId, testSessionId, testLessonId, testStudentId, 'other_student', 'att_1', 4.5, '精彩的作品', now, now);

      db.prepare(
        'INSERT INTO classroom_peer_rubric_dimensions (id, session_id, lesson_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`cprd_${now}`, testSessionId, testLessonId, '逻辑严谨性', now);

      db.prepare(
        'INSERT INTO classroom_peer_badges (id, session_id, lesson_id, sender_id, receiver_id, badge_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(`cpb_${now}`, testSessionId, testLessonId, testStudentId, 'other_student', 'brilliant_idea', now);

      db.prepare(
        'INSERT INTO classroom_peer_nominations (id, session_id, lesson_id, nominator_id, nominated_student_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(`cpn_${now}`, testSessionId, testLessonId, testStudentId, 'other_student', now);

      db.prepare(
        'INSERT INTO classroom_danmaku (id, session_id, lesson_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(`cd_${now}`, testSessionId, testLessonId, '这节课太有意思了！', now);

      db.prepare(
        'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)',
      ).run(`rc_${now}`, testStudentId, testClassId, testLessonId, now);
    });

    it('correctly calculates comprehensive lesson stats before deletion', () => {
      const stats = lessonService.getLessonStats(testLessonId);
      expect(stats.whiteboardCount).toBe(1);
      expect(stats.scheduleCount).toBe(1);
      expect(stats.enrollmentCount).toBe(1);
      expect(stats.assignmentCount).toBe(1);
      expect(stats.attendanceCount).toBe(1);
      expect(stats.submissionCount).toBe(1);
      expect(stats.peerReviewCount).toBe(1);
    });

    it('executes deleteLessonCascade and cleans all 15+ related tables without orphans', () => {
      const res = lessonService.deleteLessonCascade(testLessonId);
      expect(res.success).toBe(true);
      expect(res.deleted).toBe(true);

      // 验证课节被删
      const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(testLessonId);
      expect(lesson).toBeUndefined();

      // 验证学生屏幕锁定被解除
      const student = db.prepare('SELECT locked_lesson_id FROM students WHERE id = ?').get(testStudentId) as any;
      expect(student.locked_lesson_id).toBeNull();

      // 验证考勤与排课被彻底清除
      const schedules = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE lesson_id = ?').get(testLessonId) as any;
      expect(schedules.count).toBe(0);
      const attendance = db.prepare('SELECT COUNT(*) as count FROM attendance WHERE schedule_id = ?').get(testScheduleId) as any;
      expect(attendance.count).toBe(0);

      // 验证作业与作业提交被彻底清除
      const assignments = db.prepare('SELECT COUNT(*) as count FROM assignments WHERE lesson_id = ?').get(testLessonId) as any;
      expect(assignments.count).toBe(0);
      const submissions = db.prepare('SELECT COUNT(*) as count FROM assignment_submissions WHERE assignment_id = ?').get(testAssignmentId) as any;
      expect(submissions.count).toBe(0);

      // 验证课堂会话与子项被彻底清除
      const sessions = db.prepare('SELECT COUNT(*) as count FROM classroom_sessions WHERE lesson_id = ?').get(testLessonId) as any;
      expect(sessions.count).toBe(0);
      const polls = db.prepare('SELECT COUNT(*) as count FROM classroom_quick_polls WHERE id = ?').get(testPollId) as any;
      expect(polls.count).toBe(0);

      // 验证互评体系被彻底清除
      const reviews = db.prepare('SELECT COUNT(*) as count FROM classroom_peer_reviews WHERE lesson_id = ?').get(testLessonId) as any;
      expect(reviews.count).toBe(0);
      const dimensions = db.prepare('SELECT COUNT(*) as count FROM classroom_peer_rubric_dimensions WHERE lesson_id = ?').get(testLessonId) as any;
      expect(dimensions.count).toBe(0);
      const danmaku = db.prepare('SELECT COUNT(*) as count FROM classroom_danmaku WHERE lesson_id = ?').get(testLessonId) as any;
      expect(danmaku.count).toBe(0);
      const rollcalls = db.prepare('SELECT COUNT(*) as count FROM student_rollcalls WHERE lesson_id = ?').get(testLessonId) as any;
      expect(rollcalls.count).toBe(0);

      // 验证对照课节不受影响
      const other = db.prepare('SELECT * FROM lessons WHERE id = ?').get(otherLessonId);
      expect(other).toBeDefined();

      // 清理对照课节
      db.prepare('DELETE FROM lessons WHERE id = ?').run(otherLessonId);
    });
  });

  describe('CommandBus Cascade Consistency (builtin.ts & management.ts)', () => {
    it('cleans dependent records when lesson.delete is dispatched via CommandBus', async () => {
      const busLessonId = `les_bus_${Date.now()}`;
      const busScheduleId = `sch_bus_${Date.now()}`;
      const busAssignmentId = `asg_bus_${Date.now()}`;
      const now = Date.now();

      db.prepare('INSERT INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        busLessonId,
        'Bus 级联测试课',
        'teacher',
        now,
        now,
      );
      db.prepare('INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)').run(
        busScheduleId,
        'cls_dummy',
        busLessonId,
        '2026-10-15',
        now,
      );
      db.prepare('INSERT INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)').run(
        busScheduleId,
        'stu_dummy',
        'present',
        now,
      );
      db.prepare('INSERT INTO assignments (id, class_id, lesson_id, title, created_at) VALUES (?, ?, ?, ?, ?)').run(
        busAssignmentId,
        'cls_dummy',
        busLessonId,
        'Bus 作业',
        now,
      );
      db.prepare('INSERT INTO assignment_submissions (assignment_id, student_id, submitted_at, status) VALUES (?, ?, ?, ?)').run(
        busAssignmentId,
        'stu_dummy',
        now,
        'submitted',
      );

      const cmd = kernelContainer.commandBus.createCommand('lesson.delete', { lessonId: busLessonId }, 'user:admin:administrator');
      const res = (await kernelContainer.commandBus.execute(cmd)) as any;
      expect(res.success).toBe(true);

      expect(db.prepare('SELECT COUNT(*) as c FROM lessons WHERE id = ?').get(busLessonId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM schedules WHERE id = ?').get(busScheduleId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM attendance WHERE schedule_id = ?').get(busScheduleId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM assignments WHERE id = ?').get(busAssignmentId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM assignment_submissions WHERE assignment_id = ?').get(busAssignmentId)).toEqual({ c: 0 });
    });

    it('cleans groups and submissions when class.delete is dispatched via CommandBus', async () => {
      const busClassId = `cls_bus_del_${Date.now()}`;
      const busAsgId = `asg_cls_del_${Date.now()}`;
      const busGroupId = `grp_cls_del_${Date.now()}`;
      const now = Date.now();

      db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(busClassId, '待删测试班', now);
      db.prepare('INSERT INTO assignments (id, class_id, title, created_at) VALUES (?, ?, ?, ?)').run(busAsgId, busClassId, '班级作业', now);
      db.prepare('INSERT INTO assignment_submissions (assignment_id, student_id, submitted_at, status) VALUES (?, ?, ?, ?)').run(
        busAsgId,
        'stu_dummy_2',
        now,
        'submitted',
      );
      db.prepare('INSERT INTO class_groups (id, class_id, name, created_at) VALUES (?, ?, ?, ?)').run(busGroupId, busClassId, '第一大组', now);

      const cmd = kernelContainer.commandBus.createCommand('class.delete', { classId: busClassId }, 'user:admin:administrator');
      const res = (await kernelContainer.commandBus.execute(cmd)) as any;
      expect(res.success).toBe(true);

      expect(db.prepare('SELECT COUNT(*) as c FROM classes WHERE id = ?').get(busClassId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM assignments WHERE id = ?').get(busAsgId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM assignment_submissions WHERE assignment_id = ?').get(busAsgId)).toEqual({ c: 0 });
      expect(db.prepare('SELECT COUNT(*) as c FROM class_groups WHERE id = ?').get(busGroupId)).toEqual({ c: 0 });
    });
  });

  describe('TOOL-01: CLI Diagnostics Core Version Drift Verification', () => {
    it('checkCoreVersionDrift reports ok with aligned version and no warnings', () => {
      const check = checkCoreVersionDrift();
      expect(check.status).toBe('ok');
      expect(check.name).toBe('Core Version Drift');
      expect(check.message).toContain('v0.6.1');
      expect(check.message).toContain('对齐');
    });
  });
});
