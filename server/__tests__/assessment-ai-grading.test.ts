// @vitest-environment node
/**
 * Issue #187：AI 辅助批改建议。
 *
 * 核心不变量：**建议不直接改分**。教师确认（manualGrade）才落分并写 manual_override，
 * 之后 regrade 不覆盖。AI 不可用/超时/输出非法时给出明确错误，不产生脏数据。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';
import { AssessmentService } from '../services/assessment-service.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const db = kernelContainer.db;
const OWNER = 'usr-ai-grade-owner';
const STUDENT = 'stu-ai-grade';
const CLASS = 'cls-ai-grade';

let validAi = true;
const fakeAi = {
  generateText: async () => {
    if (!validAi) return 'this is not json at all';
    return '{"suggestedScore": 6.5, "rationale": "要点基本齐全，但缺少结论。", "confidence": 0.8}';
  },
};

const service = new AssessmentService({ db: db as any, ai: fakeAi, aiTimeoutMs: 5000 });
const noAiService = new AssessmentService({ db: db as any, ai: null });

const audits: AuditRecord[] = [];

async function buildSubmittedAttempt(svc: AssessmentService) {
  const assessment = svc.createAssessment({ ownerId: OWNER, kind: 'quiz', title: 'AI 批改测试卷' });
  svc.replaceItems(assessment.id, OWNER, [
    {
      type: 'short_answer',
      stem: '请简述光合作用的条件。',
      answerKey: '光照、叶绿体、二氧化碳和水',
      maxScore: 10,
      config: { placeholder: '作答' },
    },
  ]);
  const assignment = svc.publish(assessment.id, OWNER, { classId: CLASS, createdBy: OWNER });
  const payload: any = svc.startAttempt(assignment.id, STUDENT);
  const itemId = payload.items[0].id;
  svc.saveAnswer(payload.attempt.id, STUDENT, itemId, '需要光照和叶绿体');
  svc.submitAttempt(payload.attempt.id, STUDENT);
  return { assessmentId: assessment.id, assignmentId: assignment.id, attemptId: payload.attempt.id, itemId };
}

describe('AI 辅助批改建议（Issue #187）', () => {
  beforeAll(() => {
    ensureTestSchema();
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(OWNER, 'ai_grade_owner', 'x', 'teacher', 'AI 批改教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(STUDENT, 'ai_grade_student', 'x', 'student', 'AI 批改学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(CLASS, 'AI 批改班', '', 'x', OWNER, now);
    setAuditSinkForTests((record) => audits.push(record));
  });

  afterAll(() => {
    setAuditSinkForTests(null);
    db.prepare(
      'DELETE FROM assessment_answers WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)))',
    ).run(OWNER);
    db.prepare(
      'DELETE FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?))',
    ).run(OWNER);
    db.prepare(
      'DELETE FROM assessment_assignments WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)',
    ).run(OWNER);
    db.prepare(
      'DELETE FROM assessment_items WHERE assessment_id IN (SELECT id FROM assessments WHERE owner_id = ?)',
    ).run(OWNER);
    db.prepare('DELETE FROM assessments WHERE owner_id = ?').run(OWNER);
    db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(OWNER, STUDENT);
  });

  it('建议不直接改分：suggest 后 score 仍为 null，建议落 ai_suggestion_json 并记审计', async () => {
    const { attemptId, itemId } = await buildSubmittedAttempt(service);
    const beforeScore = (db.prepare('SELECT score FROM assessment_attempts WHERE id = ?').get(attemptId) as any).score;
    const suggestion = await service.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER });

    expect(suggestion.suggestedScore).toBe(6.5);
    expect(suggestion.rationale).toContain('要点');
    expect(suggestion.confidence).toBe(0.8);

    const row: any = db
      .prepare(
        'SELECT score, grader, manual_override, ai_suggestion_json FROM assessment_answers WHERE attempt_id = ? AND item_id = ?',
      )
      .get(attemptId, itemId);
    expect(row.score).toBeNull();
    expect(row.manual_override).toBe(0);
    expect(row.grader).toBe('ai_suggested');
    expect(JSON.parse(row.ai_suggestion_json).suggestedScore).toBe(6.5);

    // 学生成绩不受建议影响（与建议前一致）
    const attempt: any = db.prepare('SELECT score, status FROM assessment_attempts WHERE id = ?').get(attemptId);
    expect(attempt.score).toBe(beforeScore);

    const audit = audits.find((a) => a.event === 'assessment.ai_grading_suggested');
    expect(audit).toBeDefined();
    expect((audit as any).itemId).toBe(itemId);
  });

  it('教师确认后落分并写 manual_override，regrade 不覆盖', async () => {
    const { attemptId, itemId } = await buildSubmittedAttempt(service);
    await service.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER });
    service.manualGrade(attemptId, OWNER, itemId, { score: 7, feedback: '采纳并微调', gradedBy: OWNER });

    let row: any = db
      .prepare('SELECT score, grader, manual_override FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
      .get(attemptId, itemId);
    expect(row.score).toBe(7);
    expect(row.manual_override).toBe(1);
    expect(row.grader).toBe('manual');

    service.regradeAttempt(attemptId, OWNER);
    row = db
      .prepare('SELECT score, manual_override FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
      .get(attemptId, itemId);
    expect(row.score).toBe(7);
    expect(row.manual_override).toBe(1);
  });

  it('AI 输出非法：抛 502，且不产生建议/分数', async () => {
    validAi = false;
    try {
      const { attemptId, itemId } = await buildSubmittedAttempt(service);
      await expect(service.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER })).rejects.toMatchObject({
        status: 502,
      });
      const row: any = db
        .prepare('SELECT score, ai_suggestion_json FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
        .get(attemptId, itemId);
      expect(row.score).toBeNull();
      expect(row.ai_suggestion_json).toBeNull();
    } finally {
      validAi = true;
    }
  });

  it('AI Provider 未配置：抛 503，不阻塞人工批改', async () => {
    const { attemptId, itemId } = await buildSubmittedAttempt(noAiService);
    await expect(noAiService.suggestAiGrade(attemptId, OWNER, itemId, { actorId: OWNER })).rejects.toMatchObject({
      status: 503,
    });
    // 人工批改仍然可用
    noAiService.manualGrade(attemptId, OWNER, itemId, { score: 5, gradedBy: OWNER });
    const row: any = db
      .prepare('SELECT score FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
      .get(attemptId, itemId);
    expect(row.score).toBe(5);
  });

  it('客观题拒绝生成 AI 建议（400）', async () => {
    const assessment = service.createAssessment({ ownerId: OWNER, kind: 'quiz', title: '客观题测试' });
    service.replaceItems(assessment.id, OWNER, [
      { type: 'single_choice', stem: '1+1=?', answerKey: { index: 1 }, maxScore: 5, config: { options: ['1', '2'] } },
    ]);
    const assignment = service.publish(assessment.id, OWNER, { classId: CLASS, createdBy: OWNER });
    const payload: any = service.startAttempt(assignment.id, STUDENT);
    service.saveAnswer(payload.attempt.id, STUDENT, payload.items[0].id, 1);
    service.submitAttempt(payload.attempt.id, STUDENT);

    await expect(
      service.suggestAiGrade(payload.attempt.id, OWNER, payload.items[0].id, { actorId: OWNER }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
