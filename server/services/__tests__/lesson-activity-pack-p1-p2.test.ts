import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';
import { LessonActivityService } from '../lesson-activity-service.js';
import { ActivityPeerReviewService, assignReviewPairs } from '../activity-peer-review-service.js';
import { ActivityProgressReportService, NUDGE_COOLDOWN_MS } from '../activity-progress-report-service.js';
import { LessonActivityPackTransferService } from '../lesson-activity-pack-transfer.js';
import { CourseLayerService } from '../course-layer-service.js';
import { DiscussionService } from '../discussion-service.js';
import { EXTERNAL_LINK_PLACEHOLDER } from '../../../packages/core/security/ugc-sanitize.js';

describe('学案包 P1 / P2 服务（IKVO15）', () => {
  const db = kernelContainer.db;
  const activities = new LessonActivityService(db);
  const peer = new ActivityPeerReviewService(db);
  const report = new ActivityProgressReportService(db);
  const transfer = new LessonActivityPackTransferService(db);
  const courses = new CourseLayerService(db);
  const discussions = new DiscussionService(db);

  const suffix = uuidv7().slice(0, 8);
  const teacherId = `usr_p12_t_${suffix}`;
  const lessonA = `les_p12_a_${suffix}`;
  const lessonB = `les_p12_b_${suffix}`;
  const otherLesson = `les_p12_o_${suffix}`;
  const classId = `cls_p12_${suffix}`;
  const studentA = `stu_p12_a_${suffix}`;
  const studentB = `stu_p12_b_${suffix}`;
  const studentC = `stu_p12_c_${suffix}`;
  let courseId = '';

  const cleanup = () => {
    db.prepare(
      `DELETE FROM activity_peer_review_reports WHERE review_id IN (
         SELECT id FROM activity_peer_reviews WHERE activity_id IN (
           SELECT id FROM lesson_activities WHERE lesson_id IN (?, ?, ?)
         )
       )`,
    ).run(lessonA, lessonB, otherLesson);
    db.prepare(
      `DELETE FROM activity_peer_reviews WHERE activity_id IN (
         SELECT id FROM lesson_activities WHERE lesson_id IN (?, ?, ?)
       )`,
    ).run(lessonA, lessonB, otherLesson);
    db.prepare(
      `DELETE FROM activity_peer_review_assignments WHERE activity_id IN (
         SELECT id FROM lesson_activities WHERE lesson_id IN (?, ?, ?)
       )`,
    ).run(lessonA, lessonB, otherLesson);
    db.prepare(`DELETE FROM activity_peer_review_cycles WHERE lesson_id IN (?, ?, ?) OR id LIKE ?`).run(
      lessonA,
      lessonB,
      otherLesson,
      `%${suffix}%`,
    );
    db.prepare('DELETE FROM activity_nudges WHERE lesson_id IN (?, ?, ?)').run(lessonA, lessonB, otherLesson);
    db.prepare(
      'DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id IN (?, ?, ?))',
    ).run(lessonA, lessonB, otherLesson);
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id IN (?, ?, ?)').run(lessonA, lessonB, otherLesson);
    db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id IN (?, ?, ?)').run(lessonA, lessonB, otherLesson);
    db.prepare(
      'DELETE FROM discussion_reports WHERE thread_id IN (SELECT id FROM discussion_threads WHERE lesson_id IN (?, ?, ?) OR title LIKE ?)',
    ).run(lessonA, lessonB, otherLesson, `%${suffix}%`);
    db.prepare(
      'DELETE FROM discussion_posts WHERE thread_id IN (SELECT id FROM discussion_threads WHERE lesson_id IN (?, ?, ?) OR title LIKE ?)',
    ).run(lessonA, lessonB, otherLesson, `%${suffix}%`);
    db.prepare('DELETE FROM discussion_threads WHERE lesson_id IN (?, ?, ?) OR title LIKE ?').run(
      lessonA,
      lessonB,
      otherLesson,
      `%${suffix}%`,
    );
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id IN (?, ?, ?)').run(lessonA, lessonB, otherLesson);
    db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM courses WHERE owner_user_id = ?').run(teacherId);
    db.prepare('UPDATE lessons SET course_id = NULL, course_order = 0 WHERE id IN (?, ?, ?)').run(
      lessonA,
      lessonB,
      otherLesson,
    );
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?, ?)').run(lessonA, lessonB, otherLesson);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(studentA, studentB, studentC);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  };

  beforeAll(() => {
    cleanup();
    const now = Date.now();
    db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      teacherId,
      `p12_t_${suffix}`,
      'hash',
      'teacher',
      'P12 教师',
      now,
    );
    for (const [id, name] of [
      [studentA, '学生甲'],
      [studentB, '学生乙'],
      [studentC, '学生丙'],
    ] as const) {
      db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        id,
        name,
        '',
        now,
      );
    }
    db.prepare('INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      classId,
      'P12 班',
      '',
      teacherId,
      now,
    );
    for (const sid of [studentA, studentB, studentC]) {
      db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        classId,
        sid,
        now,
      );
    }
    for (const [id, title] of [
      [lessonA, '第一章'],
      [lessonB, '第二章'],
      [otherLesson, '其他课'],
    ] as const) {
      db.prepare(
        `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
         VALUES (?, ?, '', '[]', 'manual', ?, ?, ?)`,
      ).run(id, title, teacherId, now, now);
      db.prepare(
        `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
         VALUES (?, ?, ?, ?, '09:00-10:00', 'scheduled', '', ?)`,
      ).run(`sch_${id}`, classId, id, '2026-11-16', now);
    }
    const course = courses.createCourse({
      title: `长周期课程 ${suffix}`,
      ownerUserId: teacherId,
      visibility: 'enrolled',
    });
    courseId = course.id;
    courses.attachLessons(courseId, [lessonA, lessonB]);
    courses.enrollClass(courseId, classId);
  });

  afterAll(() => {
    cleanup();
  });

  it('循环分配互评任务且不会分给自己', () => {
    const pairs = assignReviewPairs([studentA, studentB, studentC], 2);
    expect(pairs).toHaveLength(6);
    expect(pairs.every((pair) => pair.reviewerStudentId !== pair.revieweeStudentId)).toBe(true);
    const byReviewer = new Map<string, number>();
    for (const pair of pairs) {
      byReviewer.set(pair.reviewerStudentId, (byReviewer.get(pair.reviewerStudentId) || 0) + 1);
    }
    expect([...byReviewer.values()].every((count) => count === 2)).toBe(true);
  });

  it('互评：匿名分配、防刷票、隐藏外链、教师复核', () => {
    const activityA = activities.createActivity(lessonA, {
      type: 'reading',
      title: '阅读一',
      config: { body: '正文 A' },
      visible: true,
      peerReview: true,
    });
    const activityB = activities.createActivity(lessonB, {
      type: 'reading',
      title: '阅读二',
      config: { body: '正文 B' },
      visible: true,
      peerReview: true,
    });
    for (const activityId of [activityA.id, activityB.id]) {
      for (const studentId of [studentA, studentB, studentC]) {
        activities.startActivity(activityId, studentId);
        activities.selfReportActivity(activityId, studentId);
      }
    }

    const started = peer.startCycle({
      activityIds: [activityA.id, activityB.id],
      title: '跨课节互评',
      anonymous: true,
      reviewsPerStudent: 1,
      createdBy: teacherId,
    });
    expect(started.cycle.courseId).toBe(courseId);
    expect(started.assignmentCount).toBe(6);

    const tasks = peer.listAssignmentsForStudent(studentA);
    const mine = tasks.find((item) => item.activityId === activityA.id);
    expect(mine).toBeTruthy();
    expect(mine?.revieweeName).toBeNull();
    expect(mine?.revieweeStudentId).toBeUndefined();

    const review = peer.submitReview(mine!.id, studentA, {
      scores: { quality: 4, clarity: 5 },
      comment: '不错，详见 https://phish.example/x',
    });
    expect(review.comment).toContain(EXTERNAL_LINK_PLACEHOLDER);
    expect(review.comment).not.toContain('https://');

    expect(() => peer.submitReview(mine!.id, studentB, { scores: { quality: 1, clarity: 1 } })).toThrow(/自己的互评/);

    const confirmed = peer.teacherReview(review.id, teacherId, 'confirm', { teacherFeedback: '已复核' });
    expect(confirmed.status).toBe('teacher_confirmed');
    expect(() => peer.submitReview(mine!.id, studentA, { scores: { quality: 5, clarity: 5 } })).toThrow(/教师已复核/);

    const reportResult = peer.reportReview(review.id, studentA, '疑似攻击性评价');
    expect(reportResult.status).toBe('open');
    expect(() => peer.reportReview(review.id, studentA, '再举一次')).toThrow(/已经举报/);
  });

  it('进度报告列出未完成学生，催办有冷却且不改进度', () => {
    const activity = activities.createActivity(lessonA, {
      type: 'reading',
      title: '独立阅读',
      config: { body: '请读完' },
      visible: true,
      required: true,
    });
    activities.startActivity(activity.id, studentA);
    activities.selfReportActivity(activity.id, studentA);
    const snapshot = report.buildReport(lessonA);
    const row = snapshot.activities.find((item) => item.activity.id === activity.id);
    expect(row?.totals.students).toBe(3);
    expect(row?.incomplete.map((item) => item.studentId).sort()).toEqual([studentB, studentC].sort());

    const first = report.nudgeIncomplete({
      lessonId: lessonA,
      teacherId,
      activityId: activity.id,
      message: '请完成阅读 https://evil.test',
    });
    expect(first.sent).toHaveLength(2);
    expect(first.sent[0].message).toContain(EXTERNAL_LINK_PLACEHOLDER);
    const after = activities.getActivity(activity.id);
    expect(after).toBeTruthy();
    const progressB = db
      .prepare('SELECT status FROM activity_progress WHERE student_id = ? AND activity_id = ?')
      .get(studentB, activity.id) as { status: string } | undefined;
    expect(progressB?.status ?? 'not_started').not.toBe('submitted');

    const second = report.nudgeIncomplete({
      lessonId: lessonA,
      teacherId,
      activityId: activity.id,
      now: Date.now() + 1000,
    });
    expect(second.sent).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);

    const later = report.nudgeIncomplete({
      lessonId: lessonA,
      teacherId,
      activityId: activity.id,
      studentIds: [studentB],
      now: Date.now() + NUDGE_COOLDOWN_MS + 10,
    });
    expect(later.sent).toHaveLength(1);
  });

  it('教师预览不写入真实进度', () => {
    const preview = activities.getPreviewPack(lessonA);
    expect(preview.preview).toBe(true);
    expect(preview.previewKind).toBe('activity-pack-student');
    expect(preview.activities.every((item) => item.progress.studentId === 'preview')).toBe(true);
    const previewRows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM activity_progress WHERE student_id = 'preview' AND activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)",
      )
      .get(lessonA) as { n: number };
    expect(previewRows.n).toBe(0);
  });

  it('学案包可以导出再导入，且默认不自动发布', async () => {
    const source = activities.createActivity(lessonA, {
      type: 'reading',
      title: '导出阅读',
      config: { body: '可搬运的正文' },
      visible: true,
    });
    activities.replaceBlocks(lessonA, [{ blockType: 'learning_goals', content: { text: '目标一' } }]);
    const exported = await transfer.exportPack(lessonA);
    expect(exported.filename).toMatch(/activity-pack\.zip$/);
    const zip = await JSZip.loadAsync(exported.buffer);
    expect(zip.file('manifest.json')).toBeTruthy();
    expect(zip.file('activities.json')).toBeTruthy();
    expect(zip.file('blocks.json')).toBeTruthy();

    const result = await transfer.importPack(otherLesson, exported.buffer);
    expect(result.activities.some((item) => item.title === source.title)).toBe(true);
    expect(result.activities.every((item) => item.visible === false)).toBe(true);
    expect(result.blocks.some((item) => item.blockType === 'learning_goals')).toBe(true);
  });

  it('课程层可挂接课节、选课，并在归档后再开新课次', async () => {
    const lessons = courses.listLessons(courseId);
    expect(lessons.map((item) => item.id)).toEqual([lessonA, lessonB]);
    const first = await courses.startLessonSession(courseId, lessonA, teacherId, classId);
    expect(first.session).toBeTruthy();
    db.prepare(`UPDATE classroom_sessions SET stage = 'ARCHIVED_REPORT' WHERE id = ?`).run(first.session.id);
    const second = await courses.startLessonSession(courseId, lessonA, teacherId, classId);
    expect(second.created).toBe(true);
    expect(second.session.id).not.toBe(first.session.id);
    expect(courses.canViewCourse(courseId, { studentId: studentA })).toBe(true);
  });

  it('讨论区去掉外链，锁定后不能回复，支持举报', () => {
    const thread = discussions.createThread({
      courseId,
      lessonId: lessonA,
      title: `讨论 ${suffix}`,
      body: '欢迎留言 https://spam.test',
      actor: { userId: teacherId },
    });
    expect(thread.body).toContain(EXTERNAL_LINK_PLACEHOLDER);
    const post = discussions.reply(thread.id, { studentId: studentA }, '我的看法');
    expect(post.body).toBe('我的看法');
    discussions.setThreadState(thread.id, { locked: true });
    expect(() => discussions.reply(thread.id, { studentId: studentB }, '再跟一条')).toThrow(/锁定/);
    const reported = discussions.report({
      threadId: thread.id,
      postId: post.id,
      actor: { studentId: studentB },
      reason: '不当内容',
    });
    expect(reported.id).toBeTruthy();
  });

  it('自报仍然不能把 verified 置为 1，活动完成不改课堂阶段', () => {
    const activity = activities.createActivity(lessonA, {
      type: 'reading',
      title: '口径校验',
      config: { body: '读完自报' },
      visible: true,
      required: true,
    });
    const progress = activities.selfReportActivity(activity.id, studentA);
    expect(progress.verified).toBe(false);
    const sessionCount = db
      .prepare('SELECT COUNT(*) AS n FROM classroom_sessions WHERE lesson_id = ? AND stage = ?')
      .get(lessonA, 'IN_CLASS_TEACHING') as { n: number };
    expect(sessionCount.n).toBe(0);
  });

  it('导入后缺失课件可以重新关联', async () => {
    const pack = new JSZip();
    pack.file(
      'manifest.json',
      JSON.stringify({
        format: 'openlearn.lesson-activity-pack',
        version: 1,
        name: 'missing-cw',
        sourceLessonTitle: '源',
        exportedAt: Date.now(),
        activityCount: 1,
        blockCount: 0,
        assetCount: 0,
      }),
    );
    pack.file(
      'activities.json',
      JSON.stringify([
        {
          type: 'courseware',
          title: '导入课件',
          config: { coursewareId: 'cw-imported-missing' },
          required: true,
          visible: true,
          peerReview: false,
          groupMode: false,
          submissionType: null,
          rubric: null,
          releaseAt: null,
          dueAt: null,
        },
      ]),
    );
    pack.file('blocks.json', '[]');
    const result = await transfer.importPack(
      otherLesson,
      Buffer.from(await pack.generateAsync({ type: 'nodebuffer' })),
      {
        replace: true,
      },
    );
    expect(result.activities[0]?.visible).toBe(false);
    expect(result.unresolvedBindings.some((item) => item.originalId === 'cw-imported-missing')).toBe(true);

    const now = Date.now();
    const localId = `cw_local_${suffix}`;
    db.prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      localId,
      `uuid-${localId}`,
      '本地课件',
      'html',
      '/cw/local/index.html',
      now,
    );
    const relinked = activities.relinkActivity(result.activities[0]!.id, { coursewareId: localId });
    expect(relinked.unresolvedBindings).toEqual([]);
    db.prepare('DELETE FROM courseware WHERE id = ?').run(localId);
  });
});

describe('长周期课程类型与开课选班', () => {
  const db = kernelContainer.db;
  const courses = new CourseLayerService(db);
  const suffix = uuidv7().slice(0, 8);
  const teacherId = `usr_lc2_t_${suffix}`;
  const lessonId = `les_lc2_${suffix}`;
  const classId = `cls_lc2_${suffix}`;
  const extraClassId = `cls_lc2b_${suffix}`;
  const now = Date.now();

  beforeAll(() => {
    db.prepare(`INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      teacherId,
      `lc2_${suffix}`,
      'x',
      'teacher',
      '教师',
      now,
    );
    db.prepare(`INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, '', ?, ?)`).run(
      classId,
      '一班',
      teacherId,
      now,
    );
    db.prepare(`INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, '', ?, ?)`).run(
      extraClassId,
      '二班',
      teacherId,
      now,
    );
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, '', '[]', 'manual', ?, ?, ?)`,
    ).run(lessonId, '常规课节', teacherId, now, now);
  });

  afterAll(() => {
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM course_enrollments WHERE class_id IN (?, ?)').run(classId, extraClassId);
    db.prepare('DELETE FROM courses WHERE owner_user_id = ?').run(teacherId);
    db.prepare('UPDATE lessons SET course_id = NULL, course_order = 0 WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId, extraClassId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  it('既有课程层行视为长周期，并可把常规课节提升为长周期课程', () => {
    const created = courses.createCourse({ title: `既有课程 ${suffix}`, ownerUserId: teacherId });
    expect(created.isLongCycle).toBe(true);
    expect(created.autoArchiveAfterMs).toBeNull();

    const promoted = courses.promoteLessonToLongCycle(lessonId, teacherId, { classIds: [classId] });
    expect(promoted.isLongCycle).toBe(true);
    expect(promoted.lessonIds).toEqual([lessonId]);
    expect(courses.enrolledClassIds(promoted.id)).toEqual([classId]);
    const again = courses.promoteLessonToLongCycle(lessonId, teacherId);
    expect(again.id).toBe(promoted.id);
  });

  it('一键开课次必须使用教师明确选择的班级，未选或误用其他班都要拒绝', async () => {
    const course = courses.promoteLessonToLongCycle(lessonId, teacherId, { classIds: [classId] });
    await expect(courses.startLessonSession(course.id, lessonId, teacherId)).rejects.toThrow(/请指定要开课的班级/);
    await expect(courses.startLessonSession(course.id, lessonId, teacherId, extraClassId)).rejects.toThrow(
      /只能为已选课班级开启课次/,
    );
    const started = await courses.startLessonSession(course.id, lessonId, teacherId, classId);
    expect(started.session).toBeTruthy();
  });

  it('课程级自动归档阈值会钳制在 3 小时至 30 天', () => {
    const course = courses.createCourse({
      title: `阈值 ${suffix}`,
      ownerUserId: teacherId,
      autoArchiveAfterMs: 60_000,
    });
    expect(course.autoArchiveAfterMs).toBe(3 * 60 * 60 * 1000);
    const updated = courses.updateCourse(course.id, { autoArchiveAfterMs: 40 * 24 * 60 * 60 * 1000 });
    expect(updated.autoArchiveAfterMs).toBe(30 * 24 * 60 * 60 * 1000);
    const cleared = courses.updateCourse(course.id, { autoArchiveAfterMs: null });
    expect(cleared.autoArchiveAfterMs).toBeNull();
  });
});
