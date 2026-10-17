/**
 * @vitest-environment node
 *
 * Issue #107：白板随堂测验的正确答案曾同时存在 `correctIndex` 与 `correctAnswer` 两个字段，
 * 不同模块各读各的 —— 服务端只读 `correctAnswer` 判分，大屏只读 `correctIndex` 统计，
 * 于是「新建测验不设答案就全员 0 分」「教师选了非 A 的答案后大屏与服务端对不上」。
 *
 * 本用例锁定修复后的判分口径（服务层，跳过环节门禁以聚焦判分本身）：
 * 1. 只有 correctIndex（组件默认数据）→ 按索引判分；
 * 2. correctIndex + correctAnswer（属性栏新写入）→ 按索引判分；
 * 3. 只有 correctAnswer 文本 / 字母（历史数据）→ 换算成索引后仍正确判分；
 * 4. 完全没配答案 → 0 分且 resolved=false（保持「未配置不判对」的旧口径）；
 * 5. 提交后回传 correctIndex，供大屏/学生端高亮。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { diagnosticService } from '../services/diagnostic-service.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const LESSON_ID = 'lesson-quiz107';
const OPTIONS = ['完全掌握', '基本掌握', '还有疑惑', '需要再讲'];

interface Seeded {
  elementId: string;
  data: Record<string, unknown>;
}

const seeded: Seeded[] = [];

function seedElement(elementId: string, data: Record<string, unknown>): void {
  kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(elementId);
  kernelContainer.db
    .prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(elementId, LESSON_ID, 'quiz', JSON.stringify(data), Date.now());
  seeded.push({ elementId, data });
}

async function submit(elementId: string, answer: unknown, studentId = 'stu-quiz107') {
  return diagnosticService.submitQuiz({
    lessonId: LESSON_ID,
    elementId,
    studentId,
    studentName: '测验学生',
    answer,
    skipStageGuard: true,
  });
}

beforeAll(() => {
  ensureTestSchema();
  kernelContainer.db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(LESSON_ID);

  // 1) 组件默认数据：只有 correctIndex
  seedElement('el-q107-index-only', { question: '本节课的核心概念？', options: OPTIONS, correctIndex: 0 });

  // 2) 属性栏新写入：两个字段同时存在，答案不是 A
  seedElement('el-q107-both', {
    question: '你的掌握程度？',
    options: OPTIONS,
    correctIndex: 2,
    correctAnswer: '还有疑惑',
  });

  // 3) 历史数据：只有 correctAnswer（选项文本）
  seedElement('el-q107-legacy-text', { question: '历史题（文本答案）', options: OPTIONS, correctAnswer: '基本掌握' });

  // 4) 历史数据：只有 correctAnswer（字母）
  seedElement('el-q107-legacy-letter', { question: '历史题（字母答案）', options: OPTIONS, correctAnswer: 'C' });

  // 5) 完全没配答案
  seedElement('el-q107-no-answer', { question: '还没设答案', options: OPTIONS });
});

afterAll(() => {
  seeded.forEach(({ elementId }) => {
    kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(elementId);
  });
  kernelContainer.db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(LESSON_ID);
});

describe('Issue #107 · quiz-submit 判分口径', () => {
  it('只有 correctIndex 的新建测验：选对 100 分、选错 0 分（不再全员 0 分）', async () => {
    const right = await submit('el-q107-index-only', 0, 'stu-q107-a');
    expect(right).toMatchObject({ success: true, isCorrect: true, score: 100, correctIndex: 0 });

    const wrong = await submit('el-q107-index-only', 2, 'stu-q107-b');
    expect(wrong).toMatchObject({ success: true, isCorrect: false, score: 0, correctIndex: 0 });
  });

  it('correctIndex + correctAnswer 并存时以索引为准（答案不是 A 也对）', async () => {
    const right = await submit('el-q107-both', 2, 'stu-q107-c');
    expect(right).toMatchObject({ isCorrect: true, score: 100, correctIndex: 2 });

    // 索引 0（第一个选项）不是本题答案
    const wrong = await submit('el-q107-both', 0, 'stu-q107-d');
    expect(wrong).toMatchObject({ isCorrect: false, score: 0 });
  });

  it('历史数据只有 correctAnswer 文本：学生发索引 / 字母 / 文本都能判对', async () => {
    for (const [i, answer] of [1, 'B', '基本掌握', '  基本掌握  '].entries()) {
      const res = await submit('el-q107-legacy-text', answer, `stu-q107-legacy-text-${i}`);
      expect(res, `answer=${String(answer)} 应判对`).toMatchObject({ isCorrect: true, score: 100, correctIndex: 1 });
    }
    const wrong = await submit('el-q107-legacy-text', 0, 'stu-q107-legacy-text-wrong');
    expect(wrong).toMatchObject({ isCorrect: false, score: 0 });
  });

  it('历史数据只有 correctAnswer 字母：字母与索引都判对', async () => {
    for (const [i, answer] of [2, 'C', 'c'].entries()) {
      const res = await submit('el-q107-legacy-letter', answer, `stu-q107-legacy-letter-${i}`);
      expect(res, `answer=${String(answer)} 应判对`).toMatchObject({ isCorrect: true, score: 100, correctIndex: 2 });
    }
  });

  it('未配置正确答案：0 分且 resolved 为 false（correctIndex 回传 null）', async () => {
    const res = await submit('el-q107-no-answer', 1, 'stu-q107-nan');
    expect(res).toMatchObject({ success: true, isCorrect: false, score: 0, correctIndex: null });
  });

  it('落库结果与返回一致（is_correct / score 同源）', async () => {
    await submit('el-q107-index-only', 0, 'stu-q107-persist');
    const row = kernelContainer.db
      .prepare(
        'SELECT answer, score, is_correct FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ? AND student_id = ?',
      )
      .get(LESSON_ID, 'el-q107-index-only', 'stu-q107-persist') as any;
    expect(row.score).toBe(100);
    expect(row.is_correct).toBe(1);
    expect(row.answer).toBe('0');
  });

  it('大屏统计口径：quiz-submissions 返回 correctIndex，与判分同源', () => {
    const quizzes = diagnosticService.getQuizSubmissions(LESSON_ID) as any[];
    const both = quizzes.find((q) => q.elementId === 'el-q107-both');
    expect(both).toBeDefined();
    expect(both.correctIndex).toBe(2);
    // 旧字段保留，供仍在读 correctAnswer 的下游使用
    expect(both.correctAnswer).toBe('还有疑惑');
  });
});
