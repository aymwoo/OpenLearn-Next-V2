import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LessonReportAccessError, LessonReportService } from '../lesson-report-service.js';
import { runWithLessonViewer } from '../lesson-viewer.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT, timeline TEXT, creator_id TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT, content TEXT);
    CREATE TABLE assignment_submissions (
      assignment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      content TEXT,
      score INTEGER,
      feedback TEXT,
      submitted_at INTEGER NOT NULL,
      graded_at INTEGER,
      status TEXT NOT NULL DEFAULT 'submitted',
      PRIMARY KEY (assignment_id, student_id)
    );
    CREATE TABLE classroom_sessions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      class_id TEXT,
      stage TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE lesson_activities (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL
    );
    CREATE TABLE activity_progress (
      activity_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (activity_id, student_id)
    );
    CREATE TABLE student_lesson_progress (student_id TEXT, lesson_id TEXT);
  `);
  db.prepare('INSERT INTO lessons (id, title, timeline, creator_id) VALUES (?, ?, ?, ?)').run(
    'les-a',
    '课节 A',
    null,
    'teacher-a',
  );
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-a', 'teacher-a');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-a', 'stu-a');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-a', 'stu-b');
  db.prepare('INSERT INTO schedules (id, lesson_id, class_id) VALUES (?, ?, ?)').run('sch-a', 'les-a', 'cls-a');
  db.prepare(
    'INSERT INTO classroom_sessions (id, lesson_id, class_id, stage, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('sess-1', 'les-a', 'cls-a', 'POST_CLASS', 100, 200, 50);
  db.prepare('INSERT INTO assignments (id, lesson_id, class_id) VALUES (?, ?, ?)').run('asg-a', 'les-a', 'cls-a');
  db.prepare('INSERT INTO assignments (id, lesson_id, class_id) VALUES (?, ?, ?)').run('asg-b', 'les-a', 'cls-a');
  db.prepare(
    `INSERT INTO assignment_submissions
       (assignment_id, student_id, content, score, submitted_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('asg-a', 'stu-a', 'answer', 90, 100, 'graded');
  db.prepare(
    `INSERT INTO assignment_submissions
       (assignment_id, student_id, content, score, submitted_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('asg-b', 'stu-b', 'answer', null, 100, 'submitted');
  db.prepare('INSERT INTO lesson_activities (id, lesson_id, order_index, title) VALUES (?, ?, ?, ?)').run(
    'act-1',
    'les-a',
    1,
    '活动一',
  );
  db.prepare('INSERT INTO lesson_activities (id, lesson_id, order_index, title) VALUES (?, ?, ?, ?)').run(
    'act-2',
    'les-a',
    2,
    '活动二',
  );
  db.prepare(
    'INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified) VALUES (?, ?, ?, ?, ?)',
  ).run('act-1', 'stu-a', 'completed', 100, 1);
  db.prepare(
    'INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified) VALUES (?, ?, ?, ?, ?)',
  ).run('act-2', 'stu-a', 'submitted', 50, 0);
  return db;
}

describe('LessonReportService', () => {
  let db: Database.Database;
  let service: LessonReportService;

  beforeEach(() => {
    db = createDb();
    service = new LessonReportService(db);
  });

  afterEach(() => db.close());

  it('教师读取课节聚合摘要', async () => {
    const report = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getLessonReport('les-a'),
    );
    expect(report).toMatchObject({
      lessonId: 'les-a',
      lessonTitle: '课节 A',
      sessions: [
        {
          sessionId: 'sess-1',
          classId: 'cls-a',
          stage: 'POST_CLASS',
          startedAt: 100,
          endedAt: 200,
          studentCount: 2,
        },
      ],
      assignments: { total: 2, graded: 1, averageScore: 90 },
      activities: { total: 2, submitted: 2, completed: 1 },
    });
  });

  it('重复作业壳按成绩项去重后统计', async () => {
    const insertAsg = db.prepare('INSERT INTO assignments (id, lesson_id, class_id, content) VALUES (?, ?, ?, ?)');
    insertAsg.run('asg-dup-old', 'les-a', 'cls-a', JSON.stringify({ coursewareUuid: 'cw-x' }));
    insertAsg.run('asg-dup-new', 'les-a', 'cls-a', JSON.stringify({ coursewareUuid: 'cw-x' }));
    // 同一课件在别的班级是独立成绩项，不能被合并
    insertAsg.run('asg-dup-other-class', 'les-a', 'cls-b', JSON.stringify({ coursewareUuid: 'cw-x' }));

    const insertSub = db.prepare(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, content, score, submitted_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertSub.run('asg-dup-old', 'stu-a', 'answer', 60, 100, 'graded');
    insertSub.run('asg-dup-new', 'stu-a', 'answer', 80, 200, 'graded');
    insertSub.run('asg-dup-other-class', 'stu-c', 'answer', 20, 200, 'graded');

    const report = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getLessonReport('les-a'),
    );

    // 去重后：asg-a(90) + 同班同课件最新壳(80) + 外班同课件(20) + asg-b(未出分) = 4 项
    expect(report?.assignments).toEqual({ total: 4, graded: 3, averageScore: 63.3 });
  });

  it('会话摘要复用课节可见性', async () => {
    const summary = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getSessionReport('sess-1'),
    );
    expect(summary).toMatchObject({ sessionId: 'sess-1', studentCount: 2 });

    await expect(
      runWithLessonViewer({ userId: 'teacher-b', role: 'teacher' }, () => service.getSessionReport('sess-1')),
    ).rejects.toBeInstanceOf(LessonReportAccessError);
  });

  it('学生不能读取课后报告', async () => {
    await expect(
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.getLessonReport('les-a'),
      ),
    ).rejects.toMatchObject({ reason: 'not_staff' });
  });

  it('无登录用户与不存在的课节', async () => {
    await expect(service.getLessonReport('les-a')).rejects.toMatchObject({ reason: 'no_viewer' });

    const missing = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getLessonReport('missing'),
    );
    expect(missing).toBeNull();
  });
});
