import { describe, it, expect } from 'vitest';
import {
  buildItemResultView,
  canStudentSeeAnalysis,
  canStudentSeeScore,
  toStudentAttemptView,
  toStudentItemView,
  toTeacherAttemptView,
  toTeacherItemView,
  type AttemptRowForView,
} from '../serialize.js';
import { parseAssessmentSettings } from '../settings.js';
import type { AssessmentItemRecord } from '../types.js';

/** 哨兵：任何学生端响应里出现它就等于答案泄漏 */
const SENTINEL = 'ANSWER-KEY-SENTINEL-DO-NOT-LEAK';

const item: AssessmentItemRecord = {
  id: 'item-1',
  assessmentId: 'as-1',
  bankItemId: 'bank-1',
  section: '第一段',
  sortOrder: 0,
  type: 'single_choice',
  stem: '题干',
  config: { options: ['A', 'B'] },
  answerKey: { index: 1, secret: SENTINEL },
  maxScore: 5,
};

const attemptRow: AttemptRowForView = {
  id: 'at-1',
  assignmentId: 'asg-1',
  studentId: 'stu-1',
  anonKey: 'anon-key-must-not-leak',
  attemptNo: 1,
  status: 'submitted',
  startedAt: 1000,
  submittedAt: 2000,
  deadlineAt: 3000,
  score: 5,
  maxScore: 5,
  needsManualReview: false,
  proctor: { blurred: 2 },
};

describe('Issue #100 · 响应白名单（答案绝不下发）', () => {
  describe('题目视图', () => {
    it('学生视图不含 answerKey / bankItemId，序列化后哨兵不出现', () => {
      const view = toStudentItemView(item);
      const json = JSON.stringify(view);
      expect(json).not.toContain(SENTINEL);
      expect(json).not.toContain('answerKey');
      expect(json).not.toContain('answer_key');
      expect(json).not.toContain('bankItemId');
      // 显式断言"该有的字段还在"，避免白名单把题目本身也删了
      expect(view).toMatchObject({ id: 'item-1', type: 'single_choice', stem: '题干', maxScore: 5 });
      expect(view.config).toEqual({ options: ['A', 'B'] });
    });

    it('教师视图带 answerKey（教师本来就能改答案）', () => {
      const view = toTeacherItemView(item);
      expect(view.answerKey).toEqual({ index: 1, secret: SENTINEL });
      expect(view.bankItemId).toBe('bank-1');
    });
  });

  describe('分数可见性', () => {
    it('immediate：交卷即可见；未交卷不可见', () => {
      expect(canStudentSeeScore({ visibility: 'immediate', scoreReleased: false, submitted: true })).toBe(true);
      expect(canStudentSeeScore({ visibility: 'immediate', scoreReleased: false, submitted: false })).toBe(false);
    });

    it('after_release / score_only：必须等教师发布', () => {
      for (const visibility of ['after_release', 'score_only'] as const) {
        expect(canStudentSeeScore({ visibility, scoreReleased: false, submitted: true })).toBe(false);
        expect(canStudentSeeScore({ visibility, scoreReleased: true, submitted: true })).toBe(true);
      }
    });

    it('解析可见性比分数更严格：score_only 永不给逐题', () => {
      const base = { scoreReleased: true, submitted: true, showItemAnalysis: true };
      expect(canStudentSeeAnalysis({ ...base, visibility: 'score_only' })).toBe(false);
      expect(canStudentSeeAnalysis({ ...base, visibility: 'after_release' })).toBe(true);
      expect(canStudentSeeAnalysis({ ...base, visibility: 'immediate', showItemAnalysis: false })).toBe(false);
    });
  });

  describe('作答视图', () => {
    it('学生视图在分数不可见时连"部分分"都不泄露；且不含身份字段', () => {
      const hidden = toStudentAttemptView(attemptRow, 2500, {
        visibility: 'after_release',
        scoreReleased: false,
        submitted: true,
      });
      expect(hidden.score).toBeNull();
      expect(hidden.maxScore).toBeNull();
      expect(hidden.needsManualReview).toBe(false);
      const json = JSON.stringify(hidden);
      expect(json).not.toContain('anon-key-must-not-leak');
      expect(json).not.toContain('stu-1');

      // 已交卷 + immediate → 给分
      const visible = toStudentAttemptView(attemptRow, 2500, {
        visibility: 'immediate',
        scoreReleased: false,
        submitted: true,
      });
      expect(visible.score).toBe(5);
      expect(visible.remainingSeconds).toBe(1);

      // 作答中（row 状态权威，不采信调用方传的 submitted 标志）→ 即使 immediate 也不给分
      const inProgress = toStudentAttemptView(
        { ...attemptRow, status: 'in_progress', submittedAt: null, score: null, maxScore: null },
        2500,
        { visibility: 'immediate', scoreReleased: false, submitted: true },
      );
      expect(inProgress.score).toBeNull();
      expect(inProgress.maxScore).toBeNull();
    });

    it('教师视图默认不含匿名 key；匿名尝试只给稳定编号', () => {
      const teacher = toTeacherAttemptView(attemptRow, { revealIdentity: false });
      expect(JSON.stringify(teacher)).not.toContain('anon-key-must-not-leak');
      // 实名作答教师能看到学号
      expect(teacher.studentId).toBe('stu-1');

      const anonRow: AttemptRowForView = { ...attemptRow, studentId: null, anonKey: 'abc123def456' };
      const anon = toTeacherAttemptView(anonRow, { revealIdentity: false, anonymousLabel: '匿名 3' });
      expect(anon.studentId).toBeNull();
      expect(anon.anonymousLabel).toBe('匿名 3');
      expect(JSON.stringify(anon)).not.toContain('abc123def456');
    });

    it('管理员反查路径才会带上 studentId（且由调用方负责写审计）', () => {
      const anonRow: AttemptRowForView = { ...attemptRow, studentId: null, anonKey: 'abc123def456' };
      expect(toTeacherAttemptView(anonRow, { revealIdentity: true }).studentId).toBeNull();
      // 反查时调用方会用真实 studentId 组装行
      const revealed = toTeacherAttemptView({ ...anonRow, studentId: 'stu-9' }, { revealIdentity: true });
      expect(revealed.studentId).toBe('stu-9');
    });
  });

  describe('逐题结果视图', () => {
    it('withAnswerKey=false 时字段根本不存在（不是值为 undefined）', () => {
      const view = buildItemResultView({
        item,
        answer: 0,
        score: 0,
        isCorrect: false,
        needsManualReview: false,
        feedback: null,
        withAnswerKey: false,
      });
      expect('answerKey' in view).toBe(false);
      expect(JSON.stringify(view)).not.toContain(SENTINEL);
      expect(view.answer).toBe(0);
    });

    it('withAnswerKey=true 时包含标准答案（教师端 / 允许看解析的学生端）', () => {
      const view = buildItemResultView({
        item,
        answer: 0,
        score: 0,
        isCorrect: false,
        needsManualReview: false,
        feedback: '再想想',
        withAnswerKey: true,
      });
      expect(view.answerKey).toEqual({ index: 1, secret: SENTINEL });
    });
  });

  describe('settings 与序列化联动', () => {
    it('survey 的默认设置永远不展示解析（联调口径一致性）', () => {
      const s = parseAssessmentSettings('survey', { showItemAnalysis: true, resultVisibility: 'immediate' });
      expect(
        canStudentSeeAnalysis({
          visibility: s.resultVisibility,
          scoreReleased: true,
          submitted: true,
          showItemAnalysis: s.showItemAnalysis,
        }),
      ).toBe(false);
    });
  });
});
