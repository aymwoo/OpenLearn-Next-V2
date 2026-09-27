import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 课程预设极速投票 CRUD 测试
 *
 * 直接测试 lesson_preset_polls 表的数据库层操作，
 * 确保表结构正确、增删改查逻辑无误。
 */
describe('Lesson Preset Polls - Database Layer', () => {
  const db = kernelContainer.db;
  const testLessonId = `lesson_test_${Date.now()}`;

  beforeEach(() => {
    // 清理测试数据
    db.prepare('DELETE FROM lesson_preset_polls WHERE lesson_id = ?').run(testLessonId);
  });

  afterAll(() => {
    db.prepare('DELETE FROM lesson_preset_polls WHERE lesson_id = ?').run(testLessonId);
  });

  it('should create lesson_preset_polls table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='lesson_preset_polls'",
    ).all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('lesson_preset_polls');
  });

  it('should have idx_lpp_lesson index', () => {
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_lpp_lesson'",
    ).all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
  });

  it('should INSERT a preset poll and SELECT it back', () => {
    const id = `preset_test_${Date.now()}_abcd`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '下列哪个选项正确？', 'ABCD', JSON.stringify(['A', 'B', 'C', 'D']), 'B', 0, now, now);

    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id) as any;

    expect(row).toBeTruthy();
    expect(row.lesson_id).toBe(testLessonId);
    expect(row.title).toBe('下列哪个选项正确？');
    expect(row.question_type).toBe('ABCD');
    expect(JSON.parse(row.options_json)).toEqual(['A', 'B', 'C', 'D']);
    expect(row.correct_option).toBe('B');
    expect(row.sort_order).toBe(0);
    expect(row.created_at).toBe(now);
    expect(row.updated_at).toBe(now);
  });

  it('should support TF question type', () => {
    const id = `preset_test_${Date.now()}_tf`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '地球是圆的吗？', 'TF', JSON.stringify(['正确', '错误']), '正确', 0, now, now);

    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id) as any;
    expect(row.question_type).toBe('TF');
    expect(JSON.parse(row.options_json)).toEqual(['正确', '错误']);
    expect(row.correct_option).toBe('正确');
  });

  it('should support CUSTOM question type with multiple options', () => {
    const id = `preset_test_${Date.now()}_custom`;
    const now = Date.now();
    const customOptions = ['选项甲', '选项乙', '选项丙', '选项丁', '选项戊'];

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '自定义问题', 'CUSTOM', JSON.stringify(customOptions), null, 0, now, now);

    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id) as any;
    expect(row.question_type).toBe('CUSTOM');
    expect(JSON.parse(row.options_json)).toEqual(customOptions);
    expect(row.correct_option).toBeNull();
  });

  it('should UPDATE a preset poll', () => {
    const id = `preset_test_${Date.now()}_upd`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '原标题', 'ABCD', JSON.stringify(['A', 'B', 'C', 'D']), 'A', 0, now, now);

    const newTime = Date.now();
    db.prepare(`
      UPDATE lesson_preset_polls SET title = ?, options_json = ?, correct_option = ?, updated_at = ?
      WHERE id = ? AND lesson_id = ?
    `).run('新标题', JSON.stringify(['甲', '乙', '丙']), '甲', newTime, id, testLessonId);

    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id) as any;
    expect(row.title).toBe('新标题');
    expect(JSON.parse(row.options_json)).toEqual(['甲', '乙', '丙']);
    expect(row.correct_option).toBe('甲');
    expect(row.updated_at).toBe(newTime);
  });

  it('should DELETE a preset poll', () => {
    const id = `preset_test_${Date.now()}_del`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '要删除的', 'ABCD', JSON.stringify(['A', 'B', 'C', 'D']), null, 0, now, now);

    const result = db.prepare('DELETE FROM lesson_preset_polls WHERE id = ? AND lesson_id = ?').run(id, testLessonId);
    expect((result as any).changes).toBe(1);

    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('should DELETE only matching lesson_id (prevent cross-lesson deletion)', () => {
    const id = `preset_test_${Date.now()}_xlesson`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, testLessonId, '属于A课程', 'TF', JSON.stringify(['正确', '错误']), null, 0, now, now);

    // 尝试用不同的 lesson_id 删除 → 应该失败
    const result = db.prepare('DELETE FROM lesson_preset_polls WHERE id = ? AND lesson_id = ?').run(id, 'other_lesson');
    expect((result as any).changes).toBe(0);

    // 原记录仍存在
    const row = db.prepare('SELECT * FROM lesson_preset_polls WHERE id = ?').get(id);
    expect(row).toBeTruthy();
  });

  it('should SELECT all presets for a lesson ordered by sort_order, created_at', () => {
    const now = Date.now();

    // 插入 3 条，sort_order 分别为 2, 0, 1
    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p_2', testLessonId, '第三题', 'ABCD', '["A","B","C","D"]', null, 2, now, now);

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p_0', testLessonId, '第一题', 'TF', '["正确","错误"]', null, 0, now, now);

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p_1', testLessonId, '第二题', 'ABCD', '["A","B","C","D"]', 'C', 1, now + 1, now + 1);

    const rows = db.prepare(
      'SELECT * FROM lesson_preset_polls WHERE lesson_id = ? ORDER BY sort_order ASC, created_at ASC',
    ).all(testLessonId) as any[];

    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe('第一题');
    expect(rows[1].title).toBe('第二题');
    expect(rows[2].title).toBe('第三题');
  });

  it('should not return presets from other lessons', () => {
    const now = Date.now();

    db.prepare(`
      INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('p_other', 'other_lesson_id', '其他课程的题', 'ABCD', '["A","B","C","D"]', null, 0, now, now);

    const rows = db.prepare(
      'SELECT * FROM lesson_preset_polls WHERE lesson_id = ?',
    ).all(testLessonId) as any[];

    const otherFound = rows.some((r: any) => r.id === 'p_other');
    expect(otherFound).toBe(false);

    // 清理
    db.prepare('DELETE FROM lesson_preset_polls WHERE id = ?').run('p_other');
  });
});
