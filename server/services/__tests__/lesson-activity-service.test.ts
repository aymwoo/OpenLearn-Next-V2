import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import {
  LessonActivityError,
  LessonActivityService,
  aggregateLessonActivityProgress,
} from '../lesson-activity-service.js';

describe('LessonActivityService（IKVO15 P0）', () => {
  const db = kernelContainer.db;
  const service = new LessonActivityService(db);
  const teacherId = 'usr-lact-svc-teacher';
  const lessonId = 'les-lact-svc';
  const otherLessonId = 'les-lact-svc-other';
  const studentId = 'stu-lact-svc';
  const otherStudentId = 'stu-lact-svc-other';

  const cleanup = () => {
    db.prepare(
      'DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id IN (?, ?))',
    ).run(lessonId, otherLessonId);
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonId, otherLessonId);
  };

  beforeAll(() => {
    cleanup();
    const now = Date.now();
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, '', '[]', 'manual', ?, ?, ?)`,
    ).run(lessonId, '学案包课节', teacherId, now, now);
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, '', '[]', 'manual', ?, ?, ?)`,
    ).run(otherLessonId, '对照课节', teacherId, now, now);
  });

  afterAll(() => {
    cleanup();
  });

  it('聚合进度只把已验证的必做活动算作完成，自报只进入展示进度', () => {
    const summary = aggregateLessonActivityProgress([
      { required: true, released: true, status: 'submitted', verified: false },
      { required: true, released: true, status: 'graded', verified: true },
      { required: false, released: true, status: 'submitted', verified: false },
    ]);
    expect(summary.requiredTotal).toBe(2);
    expect(summary.requiredSubmitted).toBe(2);
    expect(summary.requiredVerified).toBe(1);
    expect(summary.displayPercent).toBe(100);
    expect(summary.verifiedPercent).toBe(50);
    expect(summary.completed).toBe(false);
  });

  it('教师可编排活动与学案首页区块，未发布活动对学生不可见', () => {
    const draft = service.createActivity(lessonId, {
      type: 'reading',
      title: '阅读导言',
      config: { body: '先读这一段。' },
      visible: false,
    });
    const published = service.createActivity(lessonId, {
      type: 'reading',
      title: '必读材料',
      config: { body: '正文' },
      visible: true,
      required: true,
    });
    service.replaceBlocks(lessonId, [
      { blockType: 'learning_goals', content: { text: '理解活动进度口径' } },
      { blockType: 'freeform', content: { text: '补充说明' } },
    ]);

    const teacherPack = service.getTeacherPack(lessonId);
    expect(teacherPack.courseId).toBeNull();
    expect(teacherPack.activities.map((item) => item.id).sort()).toEqual([draft.id, published.id].sort());
    expect(teacherPack.blocks).toHaveLength(2);

    const studentPack = service.getStudentPack(lessonId, studentId);
    expect(studentPack.activities.map((item) => item.id)).toEqual([published.id]);
    expect(studentPack.blocks[0].blockType).toBe('learning_goals');
  });

  it('自报不会把 verified 置为 true，也不会把课节汇总标为已完成', () => {
    const activity = service
      .getTeacherPack(lessonId)
      .activities.find((item) => item.title === '必读材料' && item.visible);
    expect(activity).toBeTruthy();
    service.startActivity(activity!.id, studentId);
    const reported = service.selfReportActivity(activity!.id, studentId);
    expect(reported.status).toBe('submitted');
    expect(reported.verified).toBe(false);
    expect(reported.progressPercent).toBe(100);

    const pack = service.getStudentPack(lessonId, studentId);
    expect(pack.summary.displayPercent).toBe(100);
    expect(pack.summary.verifiedPercent).toBe(0);
    expect(pack.summary.completed).toBe(false);

    const lessonProgress = db
      .prepare(
        'SELECT completed, progress_percent, verified, verified_progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?',
      )
      .get(studentId, lessonId) as {
      completed: number;
      progress_percent: number;
      verified: number;
      verified_progress_percent: number;
    };
    expect(lessonProgress.progress_percent).toBe(100);
    expect(lessonProgress.verified).toBe(0);
    expect(lessonProgress.verified_progress_percent).toBe(0);
    expect(lessonProgress.completed).toBe(0);
  });

  it('教师确认后才把活动与课节汇总标为已验证完成', () => {
    const activity = service.getTeacherPack(lessonId).activities.find((item) => item.title === '必读材料')!;
    const verified = service.teacherVerify(activity.id, studentId);
    expect(verified.verified).toBe(true);
    expect(verified.status).toBe('submitted');

    const pack = service.getStudentPack(lessonId, studentId);
    expect(pack.summary.verifiedPercent).toBe(100);
    expect(pack.summary.completed).toBe(true);

    const lessonProgress = db
      .prepare(
        'SELECT completed, verified, verified_progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?',
      )
      .get(studentId, lessonId) as { completed: number; verified: number; verified_progress_percent: number };
    expect(lessonProgress.completed).toBe(1);
    expect(lessonProgress.verified).toBe(1);
    expect(lessonProgress.verified_progress_percent).toBe(100);
  });

  it('不会根据作品提交活动去改写 timeline 或环节门禁表', () => {
    const beforeGates = db.prepare('SELECT COUNT(*) AS n FROM segment_gate_overrides').get() as { n: number };
    const beforeTimeline = db.prepare('SELECT timeline FROM lessons WHERE id = ?').get(lessonId) as {
      timeline: string;
    };
    const activity = service.createActivity(lessonId, {
      type: 'reading',
      title: '补充阅读',
      visible: true,
      required: false,
    });
    service.selfReportActivity(activity.id, otherStudentId);
    const afterGates = db.prepare('SELECT COUNT(*) AS n FROM segment_gate_overrides').get() as { n: number };
    const afterTimeline = db.prepare('SELECT timeline FROM lessons WHERE id = ?').get(lessonId) as { timeline: string };
    expect(afterGates.n).toBe(beforeGates.n);
    expect(afterTimeline.timeline).toBe(beforeTimeline.timeline);
  });

  it('发布课件/测验/作品活动时必须先关联已有资产', () => {
    expect(() => service.createActivity(lessonId, { type: 'courseware', title: '课件', visible: true })).toThrow(
      LessonActivityError,
    );
    expect(() => service.createActivity(lessonId, { type: 'quiz', title: '测验', visible: true })).toThrow(
      LessonActivityError,
    );
    expect(() => service.createActivity(lessonId, { type: 'submission', title: '作品', visible: true })).toThrow(
      LessonActivityError,
    );
  });

  it('lessons.course_id 可空预留，既有行无需回填', () => {
    const row = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId) as { course_id: string | null };
    expect(row.course_id).toBeNull();
  });

  it('导入缺失课件时可先保存草稿，重新关联后再发布', () => {
    const activity = service.createActivity(lessonId, {
      type: 'courseware',
      title: '待重关联课件',
      config: { coursewareId: 'cw-missing-for-relink' },
      visible: false,
    });
    expect(activity.config.coursewareId).toBe('cw-missing-for-relink');
    const unresolved = service.listUnresolvedBindings(lessonId);
    expect(unresolved.some((item) => item.activityId === activity.id && item.field === 'coursewareId')).toBe(true);
    expect(() => service.updateActivity(activity.id, { visible: true })).toThrow(LessonActivityError);

    const now = Date.now();
    db.prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'cw-local-relink',
      'uuid-cw-local-relink',
      '本地课件',
      'html',
      '/cw/local/index.html',
      now,
    );
    const relinked = service.relinkActivity(activity.id, { coursewareId: 'cw-local-relink' });
    expect(relinked.activity.config.coursewareId).toBe('cw-local-relink');
    expect(relinked.unresolvedBindings).toEqual([]);
    const published = service.updateActivity(activity.id, { visible: true });
    expect(published.visible).toBe(true);
    db.prepare('DELETE FROM courseware WHERE id = ?').run('cw-local-relink');
  });

  it('编程活动可保存并提交作品，自报与提交都不会把 verified 置为 1，也不改门禁', () => {
    const beforeGates = db.prepare('SELECT COUNT(*) AS n FROM segment_gate_overrides').get() as { n: number };
    const activity = service.createActivity(lessonId, {
      type: 'programming',
      title: 'Python 练习',
      config: { kind: 'python', prompt: '打印问候' },
      visible: true,
      required: true,
    });
    const draft = service.saveProgrammingArtifact(activity.id, studentId, { kind: 'python', code: 'print("hi")' });
    expect(draft.status).toBe('in_progress');
    expect(draft.verified).toBe(false);
    expect(draft.artifact?.code).toContain('print');

    const submitted = service.saveProgrammingArtifact(
      activity.id,
      studentId,
      { kind: 'python', code: 'print("done")' },
      true,
    );
    expect(submitted.status).toBe('submitted');
    expect(submitted.verified).toBe(false);
    expect(submitted.progressPercent).toBe(100);

    const self = service.selfReportActivity(activity.id, otherStudentId);
    expect(self.verified).toBe(false);
    const afterGates = db.prepare('SELECT COUNT(*) AS n FROM segment_gate_overrides').get() as { n: number };
    expect(afterGates.n).toBe(beforeGates.n);
  });

  it('未选择编程类型的活动不能发布', () => {
    expect(() => service.createActivity(lessonId, { type: 'programming', title: '未选型', visible: true })).toThrow(
      LessonActivityError,
    );
  });
});
