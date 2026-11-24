import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { XueanActivityProgressAccessError, XueanActivityProgressService } from '../xuean-activity-progress-service.js';
import { runWithLessonViewer } from '../lesson-viewer.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT, timeline TEXT, creator_id TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE classroom_sessions (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE student_lesson_progress (student_id TEXT, lesson_id TEXT);
    CREATE TABLE lesson_activities (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      release_at INTEGER
    );
    CREATE TABLE activity_progress (
      activity_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      score INTEGER,
      graded_at INTEGER,
      last_activity_at INTEGER,
      submission_json TEXT,
      PRIMARY KEY (activity_id, student_id)
    );
  `);
  db.prepare('INSERT INTO lessons (id, title, timeline) VALUES (?, ?, ?)').run('les-a', '课节 A', null);
  db.prepare('INSERT INTO lessons (id, title, timeline) VALUES (?, ?, ?)').run('les-b', '课节 B', null);
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-a', 'teacher-a');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-a', 'stu-a');
  db.prepare('INSERT INTO schedules (id, lesson_id, class_id) VALUES (?, ?, ?)').run('sch-a', 'les-a', 'cls-a');
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
  db.prepare('INSERT INTO lesson_activities (id, lesson_id, order_index, title, visible) VALUES (?, ?, ?, ?, 0)').run(
    'act-hidden',
    'les-a',
    3,
    '隐藏活动',
  );
  db.prepare(
    'INSERT INTO lesson_activities (id, lesson_id, order_index, title, release_at) VALUES (?, ?, ?, ?, ?)',
  ).run('act-future', 'les-a', 4, '未发布活动', Date.now() + 60_000);
  db.prepare(
    `INSERT INTO activity_progress
       (activity_id, student_id, status, progress_percent, verified, score, graded_at, last_activity_at, submission_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('act-1', 'stu-a', 'submitted', 100, 1, 95, 3000, 2500, JSON.stringify({ text: '答案' }));
  db.prepare(
    `INSERT INTO activity_progress
       (activity_id, student_id, status, progress_percent, verified, score, graded_at, last_activity_at, submission_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('act-hidden', 'stu-a', 'submitted', 100, 0, null, null, 2600, JSON.stringify({ text: '隐藏答案' }));
  db.prepare(
    `INSERT INTO activity_progress
       (activity_id, student_id, status, progress_percent, verified, score, graded_at, last_activity_at, submission_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('act-future', 'stu-a', 'submitted', 100, 0, null, null, 2700, JSON.stringify({ text: '未发布答案' }));
  return db;
}

describe('XueanActivityProgressService', () => {
  let db: Database.Database;
  let service: XueanActivityProgressService;

  beforeEach(() => {
    db = createDb();
    service = new XueanActivityProgressService(db);
  });

  afterEach(() => db.close());

  it('学生读取本人活动进度与解析后的提交内容', async () => {
    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMyActivityProgress('act-1'),
    );
    expect(view).toMatchObject({
      activityId: 'act-1',
      lessonId: 'les-a',
      activityTitle: '活动一',
      studentId: 'stu-a',
      status: 'submitted',
      progressPercent: 100,
      verified: true,
      score: 95,
      submission: { text: '答案' },
    });
  });

  it('没有进度时返回 null', async () => {
    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMyActivityProgress('act-2'),
    );
    expect(view).toBeNull();
  });

  it('列出本人在课节内的进度，按 order_index 排序', async () => {
    const list = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.listMyActivityProgress('les-a'),
    );
    expect(list.map((item) => item.activityId)).toEqual(['act-1']);
  });

  it('学生看不到未关联自己班级的课节', async () => {
    await expect(
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.listMyActivityProgress('les-b'),
      ),
    ).rejects.toBeInstanceOf(XueanActivityProgressAccessError);
  });

  it('教师与无登录用户都被拒绝（本服务只面向学生）', async () => {
    await expect(
      runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () => service.getMyActivityProgress('act-1')),
    ).rejects.toMatchObject({ reason: 'not_student' });

    await expect(service.getMyActivityProgress('act-1')).rejects.toMatchObject({ reason: 'no_viewer' });
  });

  it('隐藏活动与未到发布时间的活动按不存在处理', async () => {
    const hidden = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMyActivityProgress('act-hidden'),
    );
    expect(hidden).toBeNull();

    const future = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMyActivityProgress('act-future'),
    );
    expect(future).toBeNull();
  });

  it('列表不返回隐藏或未发布活动', async () => {
    const list = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.listMyActivityProgress('les-a'),
    );
    expect(list.map((item) => item.activityId)).toEqual(['act-1']);
  });

  it('损坏的 submission_json 返回 null 而不抛错', async () => {
    db.prepare('UPDATE activity_progress SET submission_json = ? WHERE activity_id = ?').run('not-json', 'act-1');
    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMyActivityProgress('act-1'),
    );
    expect(view?.submission).toBeNull();
  });
});
