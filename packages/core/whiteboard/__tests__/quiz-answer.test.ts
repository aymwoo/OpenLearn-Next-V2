import { describe, it, expect } from 'vitest';
import {
  buildQuizAnswerFields,
  gradeQuizSubmission,
  looksLikeQuizAnswerData,
  readQuizOptions,
  resolveCorrectIndex,
  resolveSubmittedIndex,
} from '../quiz-answer.js';

const OPTIONS = ['完全掌握', '基本掌握', '还有疑惑', '需要再讲'];
const LETTER_OPTIONS = ['A', 'B', 'C', 'D'];

describe('Issue #107 · 随堂测验答案字段归一化', () => {
  describe('resolveCorrectIndex —— 正确答案索引解析', () => {
    it('correctIndex 是权威字段（数字与纯数字字符串都认）', () => {
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: 2 })).toBe(2);
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: '3' })).toBe(3);
      // 同时存在时以 correctIndex 为准，不被旧字段覆盖
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: 1, correctAnswer: '需要再讲' })).toBe(1);
    });

    it('越界 / 非法 correctIndex 视为未设置', () => {
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: 9 })).toBeNull();
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: -1 })).toBeNull();
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: 1.5 })).toBeNull();
      expect(resolveCorrectIndex({ options: OPTIONS, correctIndex: 'abc' })).toBeNull();
    });

    it('旧数据：correctAnswer 是选项文本（历史属性栏写的就是文本）', () => {
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: '还有疑惑' })).toBe(2);
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: '  基本掌握 ' })).toBe(1);
    });

    it('旧数据：correctAnswer 是字母', () => {
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: 'C' })).toBe(2);
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: 'b' })).toBe(1);
      // 超出选项范围的字母不算
      expect(resolveCorrectIndex({ options: ['甲', '乙'], correctAnswer: 'C' })).toBeNull();
    });

    it('旧数据：correctAnswer 是数字', () => {
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: 3 })).toBe(3);
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: '0' })).toBe(0);
    });

    it('选项文本本身就是字母时，文本优先于字母解释（不会错位）', () => {
      // 选项顺序被调整过：'A' 在第 2 位。下拉写入的 correctAnswer 是文本 'A'，应得索引 1
      const swapped = ['B', 'A', 'C'];
      expect(resolveCorrectIndex({ options: swapped, correctAnswer: 'A' })).toBe(1);
    });

    it('没有答案字段 / 空字符串 / 非法 payload 都返回 null', () => {
      expect(resolveCorrectIndex({ options: OPTIONS })).toBeNull();
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: '' })).toBeNull();
      expect(resolveCorrectIndex({ options: OPTIONS, correctAnswer: '  ' })).toBeNull();
      expect(resolveCorrectIndex(null)).toBeNull();
      expect(resolveCorrectIndex(undefined)).toBeNull();
      expect(resolveCorrectIndex({})).toBeNull();
    });

    it('options 缺失时仍认数字索引（0 起点），不因长度 0 而拒绝', () => {
      expect(resolveCorrectIndex({ correctIndex: 0 })).toBe(0);
      expect(resolveCorrectIndex({ correctIndex: 3 })).toBe(3);
    });
  });

  describe('resolveSubmittedIndex —— 学生作答归一化', () => {
    it('新协议：直接是索引', () => {
      expect(resolveSubmittedIndex(2, OPTIONS)).toBe(2);
      expect(resolveSubmittedIndex('3', OPTIONS)).toBe(3);
    });

    it('历史协议：字母（旧客户端发的是 LETTERS[idx]）', () => {
      expect(resolveSubmittedIndex('B', OPTIONS)).toBe(1);
      expect(resolveSubmittedIndex('d', OPTIONS)).toBe(3);
      // 字母优先于文本：选项顺序被打乱时，'A' 表示第 0 个，不是文本匹配到的第 1 个
      expect(resolveSubmittedIndex('A', ['B', 'A', 'C'])).toBe(0);
    });

    it('历史协议：选项文本', () => {
      expect(resolveSubmittedIndex('还有疑惑', OPTIONS)).toBe(2);
    });

    it('历史本地缓存对象：optionIndex / answer 嵌套', () => {
      expect(resolveSubmittedIndex({ optionIndex: 1 }, OPTIONS)).toBe(1);
      expect(resolveSubmittedIndex({ answer: 'C' }, OPTIONS)).toBe(2);
    });

    it('非法作答返回 null', () => {
      expect(resolveSubmittedIndex(null, OPTIONS)).toBeNull();
      expect(resolveSubmittedIndex('', OPTIONS)).toBeNull();
      expect(resolveSubmittedIndex('完全不存在的选项', OPTIONS)).toBeNull();
      expect(resolveSubmittedIndex(99, OPTIONS)).toBeNull();
    });
  });

  describe('gradeQuizSubmission —— 判分（Issue 复现的三种组合）', () => {
    it('新建测验只有 correctIndex（无 correctAnswer）时按默认答案判分，不再全员 0 分', () => {
      const data = { options: OPTIONS, correctIndex: 0 };
      expect(gradeQuizSubmission(data, 0)).toMatchObject({ isCorrect: true, score: 100, resolved: true });
      expect(gradeQuizSubmission(data, 2)).toMatchObject({ isCorrect: false, score: 0, resolved: true });
    });

    it('教师在大屏/属性栏选了非 A 的答案后，索引与旧文本字段同时生效', () => {
      const data = { options: OPTIONS, correctIndex: 2, correctAnswer: '还有疑惑' };
      expect(gradeQuizSubmission(data, 2).isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, 0).isCorrect).toBe(false);
    });

    it('旧数据只有 correctAnswer 文本时仍能正确判分（学生发索引 / 字母 / 文本都对）', () => {
      const data = { options: OPTIONS, correctAnswer: '还有疑惑' };
      expect(gradeQuizSubmission(data, 2).isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, 'C').isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, '还有疑惑').isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, 0).isCorrect).toBe(false);
    });

    it('选项是单个字母时不会因为字母/文本歧义判错', () => {
      const data = { options: LETTER_OPTIONS, correctIndex: 1 };
      expect(gradeQuizSubmission(data, 1).isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, 'B').isCorrect).toBe(true);
      expect(gradeQuizSubmission(data, 'A').isCorrect).toBe(false);
    });

    it('没有 options、correctAnswer 是自由文本时退回字符串等值比较（历史「文本对答」测验）', () => {
      // 真实存量数据：stage-guard 测试里就有 { correctAnswer: '氧气', segmentId: 'seg-2' } 这种无选项的题
      const data = { correctAnswer: '氧气' };
      expect(gradeQuizSubmission(data, '氧气')).toMatchObject({ isCorrect: true, score: 100, resolved: true });
      expect(gradeQuizSubmission(data, '  氧气 ')).toMatchObject({ isCorrect: true, score: 100 });
      expect(gradeQuizSubmission(data, '二氧化碳')).toMatchObject({ isCorrect: false, score: 0, resolved: true });
    });

    it('未设置正确答案 → resolved=false、0 分（保持修复前口径，不把未配置的题算满分）', () => {
      const grade = gradeQuizSubmission({ options: OPTIONS }, 1);
      expect(grade).toMatchObject({ isCorrect: false, score: 0, resolved: false, correctIndex: null });
    });

    it('作答无法解析时不抛错，按答错处理', () => {
      const grade = gradeQuizSubmission({ options: OPTIONS, correctIndex: 1 }, undefined);
      expect(grade).toMatchObject({ isCorrect: false, score: 0, resolved: true, answerIndex: null });
    });
  });

  describe('buildQuizAnswerFields —— 保存时成对写字段', () => {
    it('写入索引时同步选项文本', () => {
      expect(buildQuizAnswerFields(2, OPTIONS)).toEqual({ correctIndex: 2, correctAnswer: '还有疑惑' });
    });

    it('清除答案时两个字段一起清空', () => {
      expect(buildQuizAnswerFields(null, OPTIONS)).toEqual({ correctIndex: null, correctAnswer: null });
      expect(buildQuizAnswerFields(9, OPTIONS)).toEqual({ correctIndex: null, correctAnswer: null });
    });

    it('写出的字段能被 resolveCorrectIndex 原样读回（往返一致）', () => {
      for (let i = 0; i < OPTIONS.length; i++) {
        const fields = buildQuizAnswerFields(i, OPTIONS);
        expect(resolveCorrectIndex({ options: OPTIONS, ...fields })).toBe(i);
      }
    });
  });

  describe('looksLikeQuizAnswerData —— 环节门禁识别测验', () => {
    it('只设 correctIndex 的测验也能被识别（旧实现只看 correctAnswer）', () => {
      expect(looksLikeQuizAnswerData({ options: OPTIONS, correctIndex: 0 })).toBe(true);
    });

    it('旧字段 correctAnswer 仍然识别', () => {
      expect(looksLikeQuizAnswerData({ options: OPTIONS, correctAnswer: 'A' })).toBe(true);
      expect(looksLikeQuizAnswerData({ options: OPTIONS, correctAnswer: 0 })).toBe(true);
    });

    it('完全没有答案配置时不算测验', () => {
      expect(looksLikeQuizAnswerData({ options: OPTIONS })).toBe(false);
      expect(looksLikeQuizAnswerData(null)).toBe(false);
    });
  });

  describe('readQuizOptions —— options 容错', () => {
    it('非数组返回空数组，非字符串项转字符串', () => {
      expect(readQuizOptions({ options: 'oops' })).toEqual([]);
      expect(readQuizOptions({})).toEqual([]);
      expect(readQuizOptions({ options: ['a', 1, null] })).toEqual(['a', '1', '']);
    });
  });
});
