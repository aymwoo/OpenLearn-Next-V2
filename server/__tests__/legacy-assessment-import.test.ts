// @vitest-environment node
/**
 * Issue #185：存量白板 quiz / 预置投票导入新测评模型。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { importLegacyAssessments } from '../services/legacy-assessment-import.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const db = kernelContainer.db;
const OWNER = 'usr-legacy-import';
const CLASS = 'cls-legacy-import';
const LESSON = 'lesson-legacy-import';
const ELEMENT = 'wl-quiz-legacy';
const POLL_WITH_KEY = 'poll-with-key';
const POLL_NO_KEY = 'poll-no-key';

describe('存量测评导入（Issue #185）', () => {
  beforeAll(() => {
    ensureTestSchema();
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(OWNER, 'legacy_import', 'x', 'teacher', '导入教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(CLASS, '导入班', '', 'x', OWNER, now);
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      LESSON,
      '导入课',
      '',
      now,
      now,
    );
    db.prepare('UPDATE lessons SET creator_id = ? WHERE id = ?').run(OWNER, LESSON);
    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('sch-legacy', CLASS, LESSON, '2026-01-01', now);
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      ELEMENT,
      LESSON,
      'quiz',
      JSON.stringify({ question: '1+1=?', options: ['1', '2', '3'], correctIndex: 1 }),
      now,
    );
    // 两条历史作答
    db.prepare(
      'INSERT OR REPLACE INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sub-1', LESSON, ELEMENT, 'stu-a', 'A', '1', 1, 1, now - 1000);
    db.prepare(
      'INSERT OR REPLACE INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sub-2', LESSON, ELEMENT, 'stu-b', 'B', '0', 0, 0, now - 500);
    db.prepare(
      'INSERT OR REPLACE INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(POLL_WITH_KEY, LESSON, '预置题', 'ABCD', JSON.stringify(['甲', '乙']), 'B', 0, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(POLL_NO_KEY, LESSON, '纯投票', 'ABCD', JSON.stringify(['甲', '乙']), null, 1, now, now);
  });

  afterAll(() => {
    const ids = db.prepare("SELECT id FROM assessments WHERE json_extract(settings_json, '$.legacy.sourceId') IN (?, ?, ?)").all(ELEMENT, POLL_WITH_KEY, POLL_NO_KEY) as Array<{ id: string }>;
    for (const { id } of ids) {
      db.prepare('DELETE FROM assessment_answers WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id = ?))').run(id);
      db.prepare('DELETE FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id = ?)').run(id);
      db.prepare('DELETE FROM assessment_assignments WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM assessment_items WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE id IN (?, ?)').run('sub-1', 'sub-2');
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(ELEMENT);
    db.prepare('DELETE FROM lesson_preset_polls WHERE id IN (?, ?)').run(POLL_WITH_KEY, POLL_NO_KEY);
    db.prepare('DELETE FROM schedules WHERE id = ?').run('sch-legacy');
    db.prepare('DELETE FROM lessons WHERE id = ?').run(LESSON);
    db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS);
    db.prepare('DELETE FROM users WHERE id = ?').run(OWNER);
  });

  it('幂等导入：首次创建试卷/题目/assignment/历史作答，二次执行为空操作', () => {
    const legacyCountBefore = (db.prepare('SELECT COUNT(*) AS n FROM whiteboard_elements').get() as any).n;

    const first = importLegacyAssessments(db);
    expect(first.created.assessments).toBe(2); // 白板 quiz + 有答案的预置投票
    expect(first.created.items).toBe(2);
    expect(first.created.assignments).toBe(2);
    expect(first.created.attempts).toBe(2);
    expect(first.created.answers).toBe(2);
    expect(first.skipped.some((s) => s.source === 'preset_poll' && s.reason === 'no_correct_option')).toBe(true);

    // 溯源标记可查
    const imported = db
      .prepare("SELECT id, status FROM assessments WHERE json_extract(settings_json, '$.legacy.sourceId') = ?")
      .get(ELEMENT) as any;
    expect(imported).toBeTruthy();
    expect(imported.status).toBe('published');

    // 二次执行：全部跳过
    const second = importLegacyAssessments(db);
    expect(second.created.assessments).toBe(0);
    expect(second.created.items).toBe(0);
    expect(second.created.attempts).toBe(0);
    expect(second.skipped.filter((s) => s.reason === 'already_imported')).toHaveLength(2);

    // 旧数据原样保留
    expect((db.prepare('SELECT COUNT(*) AS n FROM whiteboard_elements').get() as any).n).toBe(legacyCountBefore);
    expect((db.prepare('SELECT COUNT(*) AS n FROM lesson_quiz_submissions').get() as any).n).toBeGreaterThanOrEqual(2);
  });

  it('dry-run 只统计不写入', () => {
    const report = importLegacyAssessments(db, { dryRun: true });
    // 已导入的两条会被 already_imported 跳过；dryRun 下不会新建
    expect(report.created.attempts).toBe(0);
    expect(report.created.answers).toBe(0);
  });

  it('新模型可按导入的卷面读取题目与历史得分', () => {
    const assessment = db
      .prepare("SELECT id FROM assessments WHERE json_extract(settings_json, '$.legacy.sourceId') = ?")
      .get(ELEMENT) as any;
    const items = db.prepare('SELECT * FROM assessment_items WHERE assessment_id = ?').all(assessment.id) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('single_choice');
    expect(JSON.parse(items[0].answer_key_json)).toEqual({ index: 1 });

    const attempts = db
      .prepare(
        'SELECT a.student_id, a.score, ans.score AS answer_score FROM assessment_attempts a JOIN assessment_answers ans ON ans.attempt_id = a.id JOIN assessment_items i ON i.id = ans.item_id WHERE i.assessment_id = ? ORDER BY a.student_id',
      )
      .all(assessment.id) as any[];
    expect(attempts.map((a) => a.student_id)).toEqual(['stu-a', 'stu-b']);
    expect(attempts.map((a) => a.score)).toEqual([1, 0]);
  });
});
