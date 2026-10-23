/**
 * 成绩审计与手动分保护（PR-5）。
 *
 * 覆盖统一写入器 applyGradeChange 的核心契约：
 *   - 手动分/插件确认分/缺考行不被自动或 AI 写入覆盖；
 *   - 教师显式 override 时可改判；
 *   - 每次真实变更都留下 assignment_grade_history（旧值/新值/操作者/原因）；
 *   - 幂等重写不产生重复历史；
 *   - 分数范围与缺考空分口径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadMigrationsFromDirectory, runMigrations } from '../../packages/core/db/migrator.js';
import { applyGradeChange } from '../../packages/core/db/assignment-grade-writer.js';

const CLASS_ID = 'cls-grade-audit';
const ASSIGNMENT_ID = 'ast-grade-audit';
const STUDENT_ID = 'stu-grade-audit';
const TEACHER = 'user:usr-grade-audit:teacher';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

let db: Database.Database;
let dbPath: string;

function historyRows() {
  return db
    .prepare(
      `SELECT * FROM assignment_grade_history
       WHERE assignment_id = ? AND student_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(ASSIGNMENT_ID, STUDENT_ID) as any[];
}

function submission() {
  return db
    .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
    .get(ASSIGNMENT_ID, STUDENT_ID) as any;
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `grade-audit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // 跑真实迁移，确保 040 的建表/加列/回填与实际部署口径一致
  runMigrations(db, loadMigrationsFromDirectory(MIGRATIONS_DIR));
  db.prepare('INSERT INTO assignments (id, class_id, title, created_at, academic_year) VALUES (?, ?, ?, ?, ?)').run(
    ASSIGNMENT_ID,
    CLASS_ID,
    '审计作业',
    Date.now(),
    '2025-2026',
  );
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

describe('applyGradeChange — 审计留痕', () => {
  it('手动录入写 source=manual、graded_by 与历史行（旧值为空）', () => {
    const result = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 88,
      feedback: '完成度好',
      status: 'graded',
      source: 'manual',
      actorId: TEACHER,
      reason: 'teacher-grade',
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.historyId).toBeTruthy();

    const row = submission();
    expect(row.score).toBe(88);
    expect(row.source).toBe('manual');
    expect(row.graded_by).toBe(TEACHER);
    expect(row.academic_year).toBe('2025-2026');

    const history = historyRows();
    expect(history).toHaveLength(1);
    expect(history[0].old_score).toBeNull();
    expect(history[0].new_score).toBe(88);
    expect(history[0].old_source).toBeNull();
    expect(history[0].new_source).toBe('manual');
    expect(history[0].actor_id).toBe(TEACHER);
    expect(history[0].actor_role).toBe('teacher');
    expect(history[0].reason).toBe('teacher-grade');
  });

  it('幂等重写同分不产生重复历史；改分才追加', () => {
    const base = {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      status: 'graded',
      source: 'auto' as const,
      actorId: 'system',
      reason: 'auto-record',
    };
    applyGradeChange(db, { ...base, score: 70 });
    const same = applyGradeChange(db, { ...base, score: 70 });
    expect(same.changed).toBe(false);
    expect(historyRows()).toHaveLength(1);

    applyGradeChange(db, { ...base, score: 75 });
    const history = historyRows();
    expect(history).toHaveLength(2);
    expect(history[1].old_score).toBe(70);
    expect(history[1].new_score).toBe(75);
  });
});

describe('applyGradeChange — 手动分/缺考保护', () => {
  it('自动录入不得覆盖教师手动分', () => {
    applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 82,
      status: 'graded',
      source: 'manual',
      actorId: TEACHER,
    });

    const blocked = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 95,
      status: 'graded',
      source: 'auto',
      actorId: 'system',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('manual-protected');
    expect(submission().score).toBe(82);
    expect(historyRows()).toHaveLength(1);
  });

  it('AI 不得覆盖插件确认分；教师显式 override 才可改判', () => {
    applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 90,
      status: 'graded',
      source: 'plugin',
      actorId: TEACHER,
    });

    const blocked = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 60,
      status: 'graded',
      source: 'ai',
      actorId: 'system',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('manual-protected');
    expect(submission().score).toBe(90);

    const overridden = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 60,
      status: 'graded',
      source: 'ai',
      actorId: TEACHER,
      overrideProtected: true,
      reason: 'teacher-approved-ai-regrade',
    });
    expect(overridden.ok).toBe(true);
    expect(submission().score).toBe(60);
    expect(submission().source).toBe('ai');
    expect(submission().graded_by).toBe(TEACHER);
    expect(historyRows()).toHaveLength(2);
  });

  it('缺考行不被自动/AI 写入覆盖，但教师手动改判可以', () => {
    applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: null,
      status: 'absent',
      source: 'manual',
      actorId: TEACHER,
      reason: 'mark-absent',
    });

    const blocked = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 100,
      status: 'graded',
      source: 'auto',
      actorId: 'system',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('absent-protected');
    expect(submission().status).toBe('absent');
    expect(submission().score).toBeNull();

    const regraded = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 66,
      status: 'graded',
      source: 'manual',
      actorId: TEACHER,
      reason: 'teacher-regrade-absent',
    });
    expect(regraded.ok).toBe(true);
    expect(submission().status).toBe('graded');
    expect(submission().score).toBe(66);
  });

  it('学生已提交但未出分的行允许 AI 批改（不误判为手动分）', () => {
    db.prepare(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status)
       VALUES (?, ?, ?, ?, 'submitted')`,
    ).run(ASSIGNMENT_ID, STUDENT_ID, '我的答案', Date.now());

    const result = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 77,
      status: 'graded',
      source: 'ai',
      actorId: 'system',
      reason: 'ai-apply-grade',
    });
    expect(result.ok).toBe(true);
    expect(submission().score).toBe(77);
    expect(submission().source).toBe('ai');
  });
});

describe('applyGradeChange — 输入边界', () => {
  it('拒绝 0~100 之外的分数与非缺考空分', () => {
    const base = {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      status: 'graded',
      source: 'manual' as const,
      actorId: TEACHER,
    };
    expect(applyGradeChange(db, { ...base, score: 101 }).reason).toBe('invalid-score');
    expect(applyGradeChange(db, { ...base, score: -1 }).reason).toBe('invalid-score');
    expect(applyGradeChange(db, { ...base, score: Number.NaN }).reason).toBe('invalid-score');
    expect(applyGradeChange(db, { ...base, score: null }).reason).toBe('invalid-score');
    expect(submission()).toBeUndefined();
  });

  it('createIfMissing=false 时不创建成绩行', () => {
    const result = applyGradeChange(db, {
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      score: 80,
      status: 'graded',
      source: 'ai',
      actorId: 'system',
      createIfMissing: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('submission-not-found');
    expect(submission()).toBeUndefined();
  });

  it('作业不存在时拒绝创建孤立成绩行', () => {
    const result = applyGradeChange(db, {
      assignmentId: 'ast-missing',
      studentId: STUDENT_ID,
      score: 80,
      status: 'graded',
      source: 'manual',
      actorId: TEACHER,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('assignment-not-found');
  });
});
