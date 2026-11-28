import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { buildCoursewareScoreView } from '../services/courseware-score-view.js';

/**
 * Issue IKYP8P 阶段 G：courseware_attempt 与 learning_surface_attempts
 * 的统一只读成绩视图。测试库不跑全部迁移，这里按查询所需最小列建表。
 */
describe('unified courseware score view (Issue IKYP8P)', () => {
  const branch = `sv-${Date.now()}`;
  const classId = `cls-${branch}`;
  const otherClassId = `cls-other-${branch}`;
  const coursewareId = `cw-${branch}`;
  const coursewareUuid = `cw-uuid-${branch}`;
  const coursewareName = '统一视图课件';
  const stuA = `stu-a-${branch}`;
  const stuB = `stu-b-${branch}`;
  const stuOut = `stu-out-${branch}`;
  const attemptA = `att-a-${branch}`;
  const attemptB = `att-b-${branch}`;
  const surfaceId = `surf-${branch}`;
  const surfaceAttemptA = `sa-a-${branch}`;
  const surfaceAttemptB = `sa-b-${branch}`;

  beforeAll(() => {
    const db = kernelContainer.db;
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classId, '统一视图班', '', 'pass', now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(otherClassId, '其他班', '', 'pass', now);
    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(stuA, `${branch}-a`, '学生甲', 'a@test', now);
    insertStudent.run(stuB, `${branch}-b`, '学生乙', 'b@test', now);
    insertStudent.run(stuOut, `${branch}-out`, '外班学生', 'out@test', now);
    const enroll = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    enroll.run(classId, stuA, now);
    enroll.run(classId, stuB, now);
    enroll.run(otherClassId, stuOut, now);

    db.prepare(
      'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(coursewareId, coursewareUuid, coursewareName, 'html', 'index.html', now);

    const insertAttempt = db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    insertAttempt.run(attemptA, coursewareId, stuA, now, 'completed');
    insertAttempt.run(attemptB, coursewareId, stuB, now, 'completed');
    db.prepare(
      'INSERT OR REPLACE INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`res-a-${branch}`, attemptA, 70, '', 1, '{}');
    db.prepare(
      'INSERT OR REPLACE INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`res-b-${branch}`, attemptB, 60, '', 1, '{}');

    // 测试库未跑迁移 072，按查询所需列建最小表
    db.exec(`CREATE TABLE IF NOT EXISTS learning_surfaces (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      content_ref_json TEXT NOT NULL,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS learning_surface_attempts (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      renderer_id TEXT NOT NULL,
      status TEXT NOT NULL,
      auto_score REAL,
      score REAL,
      max_score REAL,
      completion REAL,
      state_json TEXT,
      is_preview INTEGER NOT NULL DEFAULT 0,
      submitted_at INTEGER,
      graded_at INTEGER,
      graded_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);

    db.prepare(
      'INSERT OR REPLACE INTO learning_surfaces (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      surfaceId,
      'lesson-sv',
      'whiteboard_element',
      'owner',
      JSON.stringify({ rendererId: 'html_courseware', source: { kind: 'courseware', id: coursewareUuid } }),
      null,
      now,
      now,
    );
    // 甲：Surface 90 分（历史脏 completion=50）
    db.prepare(
      `INSERT OR REPLACE INTO learning_surface_attempts
         (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, score, max_score, completion,
          is_preview, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(surfaceAttemptA, 'lesson-sv', surfaceId, stuA, 1, 'html_courseware', 'graded', 90, 100, 50, 0, now, now + 10);
    // 乙：Surface 存在但还没分数，应保留 courseware_attempt 的 60
    db.prepare(
      `INSERT OR REPLACE INTO learning_surface_attempts
         (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, score, max_score, completion,
          is_preview, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      surfaceAttemptB,
      'lesson-sv',
      surfaceId,
      stuB,
      1,
      'html_courseware',
      'in_progress',
      null,
      100,
      null,
      0,
      now,
      now + 20,
    );
  });

  afterAll(() => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM learning_surface_attempts WHERE id IN (?, ?)').run(surfaceAttemptA, surfaceAttemptB);
    db.prepare('DELETE FROM learning_surfaces WHERE id = ?').run(surfaceId);
    for (const id of [attemptA, attemptB]) {
      db.prepare('DELETE FROM submission_result WHERE attempt_id = ?').run(id);
      db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM courseware WHERE id = ?').run(coursewareId);
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classId, otherClassId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(stuA, stuB, stuOut);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId, otherClassId);
  });

  it('Surface 有分时覆盖旧链路，并归一化历史 completion', () => {
    const rows = buildCoursewareScoreView(kernelContainer.db, { classId, coursewareUuid });
    const rowA = rows.find((row) => row.studentId === stuA);
    expect(rowA).toBeDefined();
    expect(rowA?.score).toBe(90);
    expect(rowA?.completion).toBe(0.5);
    expect(rowA?.source).toBe('learning-surface');
    expect(rowA?.hasSurfaceAttempt).toBe(true);
    expect(rowA?.coursewareName).toBe(coursewareName);
  });

  it('Surface 无分时保留旧链路分数，但仍标记双写', () => {
    const rows = buildCoursewareScoreView(kernelContainer.db, { classId, coursewareUuid });
    const rowB = rows.find((row) => row.studentId === stuB);
    expect(rowB?.score).toBe(60);
    expect(rowB?.source).toBe('courseware-attempt');
    expect(rowB?.hasSurfaceAttempt).toBe(true);
  });

  it('班级过滤生效：外班学生不出现', () => {
    const rows = buildCoursewareScoreView(kernelContainer.db, { classId });
    expect(rows.some((row) => row.studentId === stuOut)).toBe(false);
    expect(rows.map((row) => row.studentId).sort()).toEqual([stuA, stuB].sort());
  });

  it('按 studentId 过滤', () => {
    const rows = buildCoursewareScoreView(kernelContainer.db, { classId, studentId: stuA });
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe(stuA);
  });

  it('空班级返回空数组（不泄漏其他班数据）', () => {
    expect(buildCoursewareScoreView(kernelContainer.db, { classId: `empty-${branch}` })).toEqual([]);
  });
});
