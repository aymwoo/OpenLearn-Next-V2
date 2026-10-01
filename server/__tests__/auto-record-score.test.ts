/**
 * 自动录入成绩（auto-record）核心逻辑测试
 *
 * 覆盖三条铁律：
 *   1. 没有分数一律不录（历史缺陷：promote 的 finalScore 默认 100 会把「没作答」记成满分）
 *   2. 只处理已完成的 attempt
 *   3. 幂等：重复触发不产生重复行
 * 以及规则开关、完成度门槛、批量补录的分类统计。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  autoRecordAttempt,
  autoRecordForLesson,
  evaluateAutoRecord,
  findActiveLessonForStudent,
  markStudentAbsent,
  normalizePercentScore,
  promoteAttemptToGrade,
} from '../utils/auto-record-score.js';
import { saveScoreConfig, resolveScoreConfig } from '../../packages/plugins/courseware-score.js';

let db: Database.Database;
let dbPath: string;

const LESSON = 'lesson_1';
const CLASS_ID = 'class_1';

function seedCourseware(id = 'cw_1', name = '分数乐园') {
  db.prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    `uuid-${id}`,
    name,
    'html',
    'index.html',
    Date.now(),
  );
}

function seedStudent(id: string, name: string) {
  db.prepare('INSERT OR IGNORE INTO students (id, name) VALUES (?, ?)').run(id, name);
  db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)').run(CLASS_ID, id);
}

function seedAttempt(opts: {
  attemptId: string;
  studentId: string;
  status?: string;
  score?: number | null;
  completion?: number | null;
  coursewareId?: string;
}) {
  const { attemptId, studentId, status = 'completed', score = null, completion = 1, coursewareId = 'cw_1' } = opts;
  db.prepare(
    'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(attemptId, coursewareId, studentId, Date.now(), Date.now(), status);
  if (score !== null) {
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`res-${attemptId}`, attemptId, score, 'ok', completion, '{}');
  }
}

/** 该（作业, 学生）是否已有成绩行 */
function submissionRow(attemptCoursewareName: string, studentId: string) {
  return db
    .prepare(
      `SELECT s.score, s.feedback, s.status, s.source FROM assignment_submissions s
       JOIN assignments a ON a.id = s.assignment_id
       WHERE a.class_id = ? AND a.lesson_id = ? AND a.title = ? AND s.student_id = ?`,
    )
    .get(CLASS_ID, LESSON, `互动课件: ${attemptCoursewareName}`, studentId) as any;
}

function enableRule(minCompletion = 0) {
  saveScoreConfig(db as any, {
    coursewareId: '*',
    autoRecordEnabled: true,
    autoRecordMinCompletion: minCompletion,
  });
}

/** 记录某学生在本课节的考勤状态（缺考联动测试用） */
function seedAttendance(studentId: string, status: string) {
  db.prepare(
    'INSERT OR IGNORE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('sched_1', CLASS_ID, LESSON, '2026-01-01', Date.now());
  db.prepare(
    'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
  ).run('sched_1', studentId, status, Date.now());
}

beforeEach(() => {
  dbPath = path.join(
    os.tmpdir(),
    `auto-record-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE courseware (
      id TEXT PRIMARY KEY, uuid TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      type TEXT, entry TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE courseware_attempt (
      id TEXT PRIMARY KEY, courseware_id TEXT NOT NULL, student_id TEXT NOT NULL,
      started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL
    );
    CREATE TABLE submission_result (
      id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, score REAL, comment TEXT,
      completion REAL, extra_json TEXT
    );
    CREATE TABLE courseware_score_config (
      courseware_id TEXT PRIMARY KEY, courseware_name TEXT,
      score_policy TEXT NOT NULL DEFAULT 'LATEST', score_fields TEXT NOT NULL DEFAULT '',
      raw_full_score REAL NOT NULL DEFAULT 100, target_full_score REAL NOT NULL DEFAULT 100,
      weight_percentage REAL NOT NULL DEFAULT 100, lesson_id TEXT, updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY, class_id TEXT NOT NULL, lesson_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, content TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE assignment_submissions (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id TEXT NOT NULL,
      content TEXT, score REAL, feedback TEXT, submitted_at INTEGER, graded_at INTEGER, status TEXT
    );
    CREATE UNIQUE INDEX idx_assignment_submissions_unique
      ON assignment_submissions(assignment_id, student_id);
    CREATE TABLE student_lesson_progress (
      student_id TEXT NOT NULL, lesson_id TEXT NOT NULL, completed INTEGER,
      progress_percent REAL, completed_segments TEXT, assigned_at INTEGER,
      PRIMARY KEY (student_id, lesson_id)
    );
    CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE class_students (class_id TEXT NOT NULL, student_id TEXT NOT NULL);
    CREATE TABLE classroom_sessions (
      id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, class_id TEXT, stage TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY, class_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
      scheduled_date TEXT NOT NULL, time_slot TEXT, status TEXT, notes TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE attendance (
      schedule_id TEXT NOT NULL, student_id TEXT NOT NULL,
      status TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      PRIMARY KEY (schedule_id, student_id)
    );
  `);

  // 模拟 012 迁移新增的两列
  db.exec(`
    ALTER TABLE courseware_score_config ADD COLUMN auto_record_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE courseware_score_config ADD COLUMN auto_record_min_completion REAL NOT NULL DEFAULT 0;
  `);

  // 模拟 013 迁移：成绩来源列 + 自动录入更新策略列
  db.exec(`
    ALTER TABLE assignment_submissions ADD COLUMN source TEXT;
    ALTER TABLE courseware_score_config ADD COLUMN auto_record_strategy TEXT NOT NULL DEFAULT 'latest';
  `);

  db.prepare('INSERT INTO classes (id, name) VALUES (?, ?)').run(CLASS_ID, '一班');
  seedCourseware();
  seedStudent('s1', '小明');
  seedStudent('s2', '小红');
});

afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe('normalizePercentScore', () => {
  it('无分数一律返回 null，绝不兜底成 0 或 100', () => {
    expect(normalizePercentScore(null)).toBeNull();
    expect(normalizePercentScore(undefined)).toBeNull();
    expect(normalizePercentScore('')).toBeNull();
    expect(normalizePercentScore('abc')).toBeNull();
    expect(normalizePercentScore(NaN)).toBeNull();
  });

  it('0~1 比率换算为百分制，0 保持 0', () => {
    expect(normalizePercentScore(0.85)).toBe(85);
    expect(normalizePercentScore(0)).toBe(0);
    expect(normalizePercentScore(1)).toBe(100);
  });

  it('已是百分制的值原样取整，并夹到 0~100', () => {
    expect(normalizePercentScore(88.6)).toBe(89);
    expect(normalizePercentScore(150)).toBe(100);
    expect(normalizePercentScore(-5)).toBe(0);
  });
});

describe('promoteAttemptToGrade', () => {
  it('【铁律 1】没有分数时拒绝录入，而不是给满分', () => {
    seedAttempt({ attemptId: 'att_noscore', studentId: 's1', score: null });
    const result = promoteAttemptToGrade(db as any, 'att_noscore', { lessonId: LESSON, classId: CLASS_ID });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-score');
    // 关键：绝不能落库任何分数，尤其不能是 100
    expect(submissionRow('分数乐园', 's1')).toBeUndefined();
  });

  it('【铁律 2】自动路径不录进行中的 attempt，但手动路径保留该能力', () => {
    seedAttempt({ attemptId: 'att_active', studentId: 's1', status: 'active', score: 90 });

    // 默认（即自动路径）：进行中不录
    const auto = promoteAttemptToGrade(db as any, 'att_active', { lessonId: LESSON, classId: CLASS_ID });
    expect(auto.ok).toBe(false);
    expect(auto.reason).toBe('not-finished');
    expect(submissionRow('分数乐园', 's1')).toBeUndefined();

    // 手动路径：教师显式判断，不被规则收窄能力（与改动前行为一致）
    const manual = promoteAttemptToGrade(db as any, 'att_active', {
      lessonId: LESSON,
      classId: CLASS_ID,
      ignoreNotFinished: true,
    });
    expect(manual.ok).toBe(true);
    expect(submissionRow('分数乐园', 's1').score).toBe(90);
  });

  it('自动路径不会因为开启了规则就放行进行中的 attempt', () => {
    seedAttempt({ attemptId: 'att_active', studentId: 's1', status: 'active', score: 90 });
    enableRule();

    const result = autoRecordAttempt(db as any, 'att_active', { lessonId: LESSON, classId: CLASS_ID });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-finished');
  });

  it('【历史 bug 回归】completed 状态必须被认作终态', () => {
    // 曾经前端只认 finished/submitted，导致 completed 的行「录入成绩」按钮长期灰着
    seedAttempt({ attemptId: 'att_completed', studentId: 's1', status: 'completed', score: 92 });
    const result = promoteAttemptToGrade(db as any, 'att_completed', { lessonId: LESSON, classId: CLASS_ID });

    expect(result.ok).toBe(true);
    expect(result.score).toBe(92);
    expect(submissionRow('分数乐园', 's1').score).toBe(92);
  });

  it('访客/教师预览记录不记入学生成绩', () => {
    seedAttempt({ attemptId: 'att_guest', studentId: 'guest', score: 100 });
    const result = promoteAttemptToGrade(db as any, 'att_guest', { lessonId: LESSON, classId: CLASS_ID });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('placeholder-student');
  });

  it('【铁律 3】重复录入幂等：只更新同一行，不新增', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 70 });

    promoteAttemptToGrade(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });
    promoteAttemptToGrade(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });
    promoteAttemptToGrade(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });

    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM assignment_submissions s
         JOIN assignments a ON a.id = s.assignment_id
         WHERE a.class_id = ? AND a.lesson_id = ?`,
      )
      .get(CLASS_ID, LESSON) as { n: number };
    expect(count.n).toBe(1);
  });

  it('完成度门槛不满足时拒绝（手动录入可绕过）', () => {
    seedAttempt({ attemptId: 'att_low', studentId: 's1', score: 80, completion: 0.3 });

    const blocked = promoteAttemptToGrade(db as any, 'att_low', {
      lessonId: LESSON,
      classId: CLASS_ID,
      minCompletion: 0.6,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('below-min-completion');

    const manual = promoteAttemptToGrade(db as any, 'att_low', {
      lessonId: LESSON,
      classId: CLASS_ID,
      minCompletion: 0.6,
      ignoreMinCompletion: true,
    });
    expect(manual.ok).toBe(true);
  });

  it('同时更新学生课节进度为 100%', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 70 });
    promoteAttemptToGrade(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });

    const progress = db
      .prepare('SELECT completed, progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?')
      .get('s1', LESSON) as any;
    expect(progress.completed).toBe(1);
    expect(progress.progress_percent).toBe(100);
  });
});

describe('规则开关与门槛', () => {
  it('默认关闭：升级后行为不变', () => {
    const resolved = resolveScoreConfig(db as any, 'cw_1');
    expect(resolved.config.auto_record_enabled).toBe(false);
    expect(resolved.config.auto_record_min_completion).toBe(0);
  });

  it('规则关闭时不自动录入', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 88 });
    expect(saveScoreConfig(db as any, { coursewareId: '*' }).auto_record_enabled).toBe(false);

    const result = autoRecordAttempt(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rule-disabled');
    expect(submissionRow('分数乐园', 's1')).toBeUndefined();
  });

  it('开启规则后自动录入，并带上来源标记', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 88 });
    enableRule();

    const result = autoRecordAttempt(db as any, 'att_1', { lessonId: LESSON, classId: CLASS_ID });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(88);
    expect(submissionRow('分数乐园', 's1').feedback).toContain('自动录入规则');
  });

  it('规则门槛会拦住低完成度的提交', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 88, completion: 0.4 });
    enableRule(0.8);

    const decision = evaluateAutoRecord(db as any, 'att_1');
    expect(decision.shouldRecord).toBe(false);
    expect(decision.reason).toBe('below-min-completion');
  });

  it('课件专属配置可覆盖全局规则', () => {
    seedAttempt({ attemptId: 'att_1', studentId: 's1', score: 88, completion: 0.5 });
    enableRule(0.9); // 全局门槛 90%
    saveScoreConfig(db as any, { coursewareId: 'cw_1', autoRecordEnabled: true, autoRecordMinCompletion: 0 });

    const decision = evaluateAutoRecord(db as any, 'att_1');
    expect(decision.ruleSource).toBe('courseware');
    expect(decision.shouldRecord).toBe(true);
  });

  it('门槛越界会被拒绝', () => {
    expect(() => saveScoreConfig(db as any, { coursewareId: '*', autoRecordMinCompletion: 1.5 })).toThrow(
      /autoRecordMinCompletion/,
    );
  });
});

describe('autoRecordForLesson 批量补录', () => {
  it('按规则分类：已录入的跳过，无分数的跳过，低门槛的录进来', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's1', score: 90 });
    seedAttempt({ attemptId: 'att_b', studentId: 's2', score: null }); // 无分数
    seedAttempt({ attemptId: 'att_c', studentId: 's1', coursewareId: 'cw_2', score: 60, completion: 0.2 });
    seedCourseware('cw_2', '闯关课件');
    seedAttempt({ attemptId: 'att_d', studentId: 's1', status: 'active', score: 95 }); // 进行中
    enableRule(0.5);

    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });

    // 只有 att_a（分数 90、完成度 1）满足规则
    expect(report.recorded).toBe(1);
    expect(submissionRow('分数乐园', 's1').score).toBe(90);
    expect(submissionRow('闯关课件', 's1')).toBeUndefined();

    const reasons = report.details.map((d) => `${d.attemptId}:${d.reason ?? 'ok'}`).sort();
    expect(reasons).toEqual(expect.arrayContaining(['att_a:ok', 'att_b:missing-score', 'att_c:below-min-completion']));
  });

  it('重复补录幂等：auto 行按 latest 刷新为最新分但不产生重复行', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's1', score: 90 });
    enableRule();

    const first = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(first.recorded).toBe(1);

    // migration 013 行为变更：auto 行不再硬跳过（旧分永不更新），而是按 latest 刷新；
    // 幂等保证不变 —— 永远只有一行，不重复记分。
    const second = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(second.recorded).toBe(1);
    expect(submissionRow('分数乐园', 's1').score).toBe(90);
    expect(submissionRow('分数乐园', 's1').source).toBe('auto');

    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.lesson_id = ?`,
      )
      .get(LESSON) as { n: number };
    expect(count.n).toBe(1);
  });

  it('学生重做课件后，latest 策略把 auto 行刷新为最新分', () => {
    const now = Date.now();
    // att_a 先发生（旧分 90），att_a2 是重做（新分 70）—— 显式时间戳保证 finished_at 排序
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a', 'cw_1', 's1', now - 10000, now - 9000, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a', 'att_a', 90, 'ok', 1, '{}');
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a2', 'cw_1', 's1', now - 1000, now, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a2', 'att_a2', 70, 'ok', 1, '{}');
    enableRule();

    autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(submissionRow('分数乐园', 's1').score).toBe(70);
    expect(submissionRow('分数乐园', 's1').source).toBe('auto');
  });

  it('同一学生多条 attempt 只处理最新一条（避免回写最旧分）', () => {
    // att_old 分更高但更早（finished_at 更小）；att_new 是最新 attempt
    const now = Date.now();
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_old', 'cw_1', 's1', now - 10000, now - 9000, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_old', 'att_old', 95, 'ok', 1, '{}');
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_new', 'cw_1', 's1', now - 1000, now, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_new', 'att_new', 60, 'ok', 1, '{}');
    enableRule();

    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(report.recorded).toBe(1);
    expect(submissionRow('分数乐园', 's1').score).toBe(60);
  });

  it('highest 策略：新分不高于已录分数时保持原分（not-higher）', () => {
    const now = Date.now();
    // 显式时间戳保证 att_a 先发生且是首次补录的唯一 attempt
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a', 'cw_1', 's1', now - 10000, now - 9000, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a', 'att_a', 90, 'ok', 1, '{}');
    enableRule();
    saveScoreConfig(db as any, { coursewareId: '*', autoRecordStrategy: 'highest' });

    const first = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(first.recorded).toBe(1);
    expect(submissionRow('分数乐园', 's1').score).toBe(90);

    // 学生重做，分更低 → 保持 90
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a2', 'cw_1', 's1', now - 1000, now, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a2', 'att_a2', 70, 'ok', 1, '{}');
    const second = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(second.recorded).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.details[0].reason).toBe('not-higher');
    expect(submissionRow('分数乐园', 's1').score).toBe(90);
  });

  it('highest 策略：新分更高时正常覆盖', () => {
    const now = Date.now();
    // 显式时间戳保证 att_a2 是最新 attempt（同毫秒排序不稳定）
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a', 'cw_1', 's1', now - 10000, now - 9000, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a', 'att_a', 70, 'ok', 1, '{}');
    enableRule();
    saveScoreConfig(db as any, { coursewareId: '*', autoRecordStrategy: 'highest' });

    autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(submissionRow('分数乐园', 's1').score).toBe(70);

    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('att_a2', 'cw_1', 's1', now - 1000, now, 'completed');
    db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('res-att_a2', 'att_a2', 95, 'ok', 1, '{}');
    autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(submissionRow('分数乐园', 's1').score).toBe(95);
  });

  it('自动路径不覆盖教师手动录入/调整过的分数（manual-protected）', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's1', score: 90 });
    enableRule();

    // 教师先手动录入 85
    const manual = promoteAttemptToGrade(db as any, 'att_a', {
      lessonId: LESSON,
      classId: CLASS_ID,
      sourceLabel: '教师在课堂中保存录入',
      source: 'manual',
      ignoreMinCompletion: true,
      ignoreNotFinished: true,
    });
    // 手动路径写入后教师改分场景：直接把行改成 85 + source='manual'（模拟教师改判）
    db.prepare(
      `UPDATE assignment_submissions SET score = 85, source = 'manual',
       feedback = '由教师在学期成绩页手动调整' WHERE student_id = 's1'`,
    ).run();
    expect(manual.ok).toBe(true);

    // 学生重做出 95 分的新 attempt，自动规则不得冲掉手动分
    seedAttempt({ attemptId: 'att_a2', studentId: 's1', score: 95 });
    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(report.details[0].reason).toBe('manual-protected');
    expect(submissionRow('分数乐园', 's1').score).toBe(85);
    expect(submissionRow('分数乐园', 's1').source).toBe('manual');
  });

  it('自动录入写 source=auto，手动录入写 source=manual', () => {
    seedAttempt({ attemptId: 'att_auto', studentId: 's1', score: 88 });
    seedAttempt({ attemptId: 'att_manual', studentId: 's2', score: 66 });
    enableRule();

    autoRecordAttempt(db as any, 'att_auto', { lessonId: LESSON, classId: CLASS_ID });
    promoteAttemptToGrade(db as any, 'att_manual', {
      lessonId: LESSON,
      classId: CLASS_ID,
      sourceLabel: '教师在课堂中保存录入',
      source: 'manual',
      ignoreMinCompletion: true,
      ignoreNotFinished: true,
    });

    expect(submissionRow('分数乐园', 's1').source).toBe('auto');
    expect(submissionRow('分数乐园', 's2').source).toBe('manual');
  });

  it('skip（manual 保护/缺考保护）时不推进 student_lesson_progress', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's1', score: 90 });
    enableRule();

    // 先手动录入，再把行改回「未完成进度」状态以便观察 skip 分支
    promoteAttemptToGrade(db as any, 'att_a', {
      lessonId: LESSON,
      classId: CLASS_ID,
      source: 'manual',
      ignoreMinCompletion: true,
      ignoreNotFinished: true,
    });
    db.prepare(
      `UPDATE assignment_submissions SET score = 85, source = 'manual' WHERE student_id = 's1'`,
    ).run();
    db.prepare(`UPDATE student_lesson_progress SET completed = 0, progress_percent = 40 WHERE student_id = 's1'`).run();

    seedAttempt({ attemptId: 'att_a2', studentId: 's1', score: 95 });
    autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });

    const progress = db
      .prepare(`SELECT completed, progress_percent FROM student_lesson_progress WHERE student_id = ?`)
      .get('s1') as any;
    expect(progress.completed).toBe(0);
    expect(progress.progress_percent).toBe(40);
  });

  it('报告里带出学生姓名，便于教师核对', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's2', score: 77 });
    enableRule();

    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    const entry = report.details.find((d) => d.attemptId === 'att_a');
    expect(entry?.studentName).toBe('小红');
  });
});

describe('findActiveLessonForStudent', () => {
  it('上课期间能反查到进行中的课节', () => {
    db.prepare(
      'INSERT INTO classroom_sessions (id, lesson_id, class_id, stage, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('sess_1', LESSON, CLASS_ID, 'IN_CLASS_TEACHING', Date.now());
    expect(findActiveLessonForStudent(db as any, 's1')).toEqual({ lessonId: LESSON, classId: CLASS_ID });
  });

  it('课节已结束则查不到（不实时录入，交给补录兜底）', () => {
    db.prepare(
      'INSERT INTO classroom_sessions (id, lesson_id, class_id, stage, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('sess_1', LESSON, CLASS_ID, 'ARCHIVED_REPORT', Date.now());
    expect(findActiveLessonForStudent(db as any, 's1')).toBeNull();
  });

  it('查不到时不报错', () => {
    expect(findActiveLessonForStudent(db as any, 'unknown')).toBeNull();
  });
});

describe('markStudentAbsent 标缺考', () => {
  it('写入 status=absent、score=NULL、source=manual 的成绩行（幂等）', () => {
    const first = markStudentAbsent(db as any, {
      lessonId: LESSON,
      classId: CLASS_ID,
      studentId: 's1',
      coursewareId: 'cw_1',
    });
    expect(first.ok).toBe(true);
    expect(first.coursewareName).toBe('分数乐园');

    const row = submissionRow('分数乐园', 's1');
    expect(row.status).toBe('absent');
    expect(row.score).toBeNull();
    expect(row.source).toBe('manual');

    // 幂等：重复标记不产生重复行
    markStudentAbsent(db as any, { lessonId: LESSON, classId: CLASS_ID, studentId: 's1', coursewareId: 'cw_1' });
    const count = db
      .prepare(
        `SELECT COUNT(*) AS n FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.lesson_id = ? AND s.student_id = 's1'`,
      )
      .get(LESSON) as { n: number };
    expect(count.n).toBe(1);
  });

  it('课件不存在 / 学生不在班级时拒绝', () => {
    expect(
      markStudentAbsent(db as any, {
        lessonId: LESSON,
        classId: CLASS_ID,
        studentId: 's1',
        coursewareId: 'cw_none',
      }).reason,
    ).toBe('courseware-not-found');
    expect(
      markStudentAbsent(db as any, {
        lessonId: LESSON,
        classId: CLASS_ID,
        studentId: 's_none',
        coursewareId: 'cw_1',
      }).reason,
    ).toBe('student-not-in-class');
  });
});

describe('考勤联动生成缺考行', () => {
  it('缺考学生自动生成 absent 行；出勤学生不生成；重复补录不重复生成', () => {
    seedAttempt({ attemptId: 'att_a', studentId: 's1', score: 90 });
    seedAttendance('s1', 'present');
    seedAttendance('s2', 'absent');
    enableRule();

    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(report.recorded).toBe(1);
    expect(report.absentGenerated).toBe(1);

    const row2 = submissionRow('分数乐园', 's2');
    expect(row2.status).toBe('absent');
    expect(row2.score).toBeNull();
    expect(row2.source).toBe('manual');

    // 出勤学生不被生成缺考行
    const row1 = submissionRow('分数乐园', 's1');
    expect(row1.status).toBe('graded');

    // 重复补录：absent 行已存在 → 不再生成
    const second = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(second.absentGenerated).toBeUndefined();
  });

  it('缺考行受自动规则保护：学生补交后 auto 路径跳过（absent-protected）', () => {
    // s2 做了 cw_1（使该课件进入本批），s1 缺考 → 联动生成 s1 的缺考行
    seedAttempt({ attemptId: 'att_a', studentId: 's2', score: 88 });
    seedAttendance('s1', 'absent');
    enableRule();
    autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    expect(submissionRow('分数乐园', 's1').status).toBe('absent');

    // 学生 s1 事后补交（教师允许）→ 自动规则不得冲掉缺考标记
    seedAttempt({ attemptId: 'att_makeup', studentId: 's1', score: 92 });
    const report = autoRecordForLesson(db as any, { lessonId: LESSON, classId: CLASS_ID });
    const makeup = report.details.find((d) => d.attemptId === 'att_makeup');
    expect(makeup?.reason).toBe('absent-protected');
    expect(submissionRow('分数乐园', 's1').status).toBe('absent');
  });
});
