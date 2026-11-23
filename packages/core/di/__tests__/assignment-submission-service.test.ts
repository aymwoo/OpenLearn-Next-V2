import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssignmentSubmissionAccessError, AssignmentSubmissionService } from '../assignment-submission-service.js';
import { runWithLessonViewer } from '../lesson-viewer.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE classes (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, class_id TEXT, lesson_id TEXT);
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
    CREATE TABLE plugin_assignments (
      id TEXT PRIMARY KEY,
      class_id TEXT,
      lesson_id TEXT,
      title TEXT
    );
    CREATE TABLE plugin_submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT,
      lesson_id TEXT,
      student_id TEXT NOT NULL,
      file_path TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE plugin_submission_versions (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      assignment_id TEXT,
      student_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      files_json TEXT NOT NULL DEFAULT '[]',
      text_content TEXT,
      link_url TEXT,
      is_late INTEGER NOT NULL DEFAULT 0,
      submitted_at INTEGER NOT NULL,
      UNIQUE(submission_id, version)
    );
    CREATE TABLE plugin_grades (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE,
      teacher_score INTEGER,
      teacher_comment TEXT,
      teacher_weight REAL,
      peer_weight REAL,
      calculated_final_score INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      graded_at INTEGER
    );
  `);
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-a', 'teacher-a');
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-b', 'teacher-b');
  db.prepare('INSERT INTO assignments (id, class_id, lesson_id) VALUES (?, ?, ?)').run('asg-a', 'cls-a', 'les-a');
  db.prepare('INSERT INTO assignments (id, class_id, lesson_id) VALUES (?, ?, ?)').run('asg-b', 'cls-b', 'les-b');
  db.prepare(
    `INSERT INTO assignment_submissions
       (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('asg-a', 'stu-a', 'my answer', 88, 'good', 1000, 2000, 'graded');
  db.prepare(
    `INSERT INTO assignment_submissions
       (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('asg-a', 'stu-b', '', null, null, 1100, null, 'submitted');

  // 作业中心：真实作答在 plugin_submission_versions；legacy 投影行 content 为空。
  db.prepare('INSERT INTO plugin_assignments (id, class_id, lesson_id, title) VALUES (?, ?, ?, ?)').run(
    'hub-asg',
    'cls-a',
    'les-a',
    '作业中心作业',
  );
  db.prepare(
    `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`,
  ).run('hub-sub-a', 'hub-asg', 'les-a', 'stu-a', 3000, 3000);
  db.prepare(
    `INSERT INTO plugin_submission_versions
       (id, submission_id, assignment_id, student_id, version, files_json, text_content, link_url, is_late, submitted_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, ?)`,
  ).run(
    'hub-sub-a-v1',
    'hub-sub-a',
    'hub-asg',
    'stu-a',
    JSON.stringify([{ name: 'answer.pdf', fileId: 'f-1' }]),
    '作业中心作答',
    'https://example.com/a',
    3100,
  );
  db.prepare(
    `INSERT INTO plugin_grades
       (id, submission_id, teacher_comment, calculated_final_score, status, graded_at)
     VALUES (?, ?, ?, ?, 'confirmed', ?)`,
  ).run('hub-grade-a', 'hub-sub-a', '很好', 92, 3200);

  db.prepare(
    `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`,
  ).run('hub-sub-b', 'hub-asg', 'les-a', 'stu-b', 3300, 3300);
  db.prepare(
    `INSERT INTO plugin_submission_versions
       (id, submission_id, assignment_id, student_id, version, files_json, text_content, link_url, is_late, submitted_at)
     VALUES (?, ?, ?, ?, 1, '[]', NULL, ?, 0, ?)`,
  ).run('hub-sub-b-v1', 'hub-sub-b', 'hub-asg', 'stu-b', 'https://example.com/b', 3400);

  // 成绩确认后的 legacy 投影：content 为空，不能遮住作业中心的真实作答。
  db.prepare(
    `INSERT INTO assignment_submissions
       (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
     VALUES (?, ?, '', 92, '很好', ?, ?, 'graded')`,
  ).run('hub-asg', 'stu-a', 3200, 3200);
  return db;
}

describe('AssignmentSubmissionService', () => {
  let db: Database.Database;
  let service: AssignmentSubmissionService;

  beforeEach(() => {
    db = createDb();
    service = new AssignmentSubmissionService(db);
  });

  afterEach(() => db.close());

  it('学生读取本人提交；不返回名册字段', async () => {
    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMySubmission('asg-a'),
    );
    expect(view).toMatchObject({
      assignmentId: 'asg-a',
      classId: 'cls-a',
      lessonId: 'les-a',
      studentId: 'stu-a',
      content: 'my answer',
      score: 88,
      feedback: 'good',
      status: 'graded',
    });
    expect(JSON.stringify(view)).not.toContain('name');
  });

  it('学生不能读他人提交', async () => {
    await expect(
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.getSubmissionForViewer('asg-a', 'stu-b'),
      ),
    ).rejects.toMatchObject({ name: 'AssignmentSubmissionAccessError', reason: 'forbidden', status: 403 });
  });

  it('教师可读自己班级的提交，不能读其他班级', async () => {
    const own = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getSubmissionForViewer('asg-a', 'stu-b'),
    );
    expect(own?.studentId).toBe('stu-b');

    await expect(
      runWithLessonViewer({ userId: 'teacher-b', role: 'teacher' }, () =>
        service.getSubmissionForViewer('asg-a', 'stu-a'),
      ),
    ).rejects.toBeInstanceOf(AssignmentSubmissionAccessError);
  });

  it('管理员可读任意提交；无登录用户直接拒绝', async () => {
    const admin = await runWithLessonViewer({ userId: 'admin', role: 'administrator' }, () =>
      service.getSubmissionForViewer('asg-b', 'nobody'),
    );
    expect(admin).toBeNull();

    await expect(service.getMySubmission('asg-a')).rejects.toMatchObject({ reason: 'no_viewer' });
  });

  it('canShareSubmission 只有内容非空且非草稿时为 true', async () => {
    const shareable = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.canShareSubmission('asg-a', 'stu-a'),
    );
    expect(shareable).toBe(true);

    const empty = await runWithLessonViewer({ userId: 'stu-b', studentId: 'stu-b', role: 'student' }, () =>
      service.canShareSubmission('asg-a', 'stu-b'),
    );
    expect(empty).toBe(false);
  });

  it('教师不能冒充学生调用 getMySubmission', async () => {
    await expect(
      runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () => service.getMySubmission('asg-a')),
    ).rejects.toMatchObject({ reason: 'not_student' });
  });

  it('读取作业中心提交：返回最新版本文字 / 链接 / 附件与成绩', async () => {
    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMySubmission('hub-asg'),
    );
    expect(view).toMatchObject({
      assignmentId: 'hub-asg',
      classId: 'cls-a',
      lessonId: 'les-a',
      studentId: 'stu-a',
      source: 'assignment_hub',
      content: '作业中心作答',
      textContent: '作业中心作答',
      linkUrl: 'https://example.com/a',
      score: 92,
      feedback: '很好',
      status: 'graded',
    });
    expect(view?.files).toEqual([{ name: 'answer.pdf', fileId: 'f-1' }]);
  });

  it('作业中心真实作答优先于 legacy 投影行', async () => {
    const legacyRow = db
      .prepare('SELECT content FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get('hub-asg', 'stu-a') as { content: string };
    expect(legacyRow.content).toBe('');

    const view = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.getMySubmission('hub-asg'),
    );
    expect(view?.source).toBe('assignment_hub');
    expect(view?.content).toBe('作业中心作答');
  });

  it('仅链接的作业中心提交也可分享', async () => {
    const shareable = await runWithLessonViewer({ userId: 'stu-b', studentId: 'stu-b', role: 'student' }, () =>
      service.canShareSubmission('hub-asg', 'stu-b'),
    );
    expect(shareable).toBe(true);
  });

  it('教师只能读取自己班级的作业中心提交', async () => {
    const own = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      service.getSubmissionForViewer('hub-asg', 'stu-a'),
    );
    expect(own?.source).toBe('assignment_hub');

    await expect(
      runWithLessonViewer({ userId: 'teacher-b', role: 'teacher' }, () =>
        service.getSubmissionForViewer('hub-asg', 'stu-a'),
      ),
    ).rejects.toBeInstanceOf(AssignmentSubmissionAccessError);
  });
});
