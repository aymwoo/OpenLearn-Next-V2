// @vitest-environment node
/**
 * Issue #186：题库共享与按规则随机抽题（每人一卷）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { setAuditSinkForTests } from '../../packages/core/observability/audit-log.js';
import { AssessmentService } from '../services/assessment-service.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const db = kernelContainer.db;
const TEACHER_A = 'usr-bank-teacher-a';
const TEACHER_B = 'usr-bank-teacher-b';
const STUDENT_1 = 'stu-bank-1';
const STUDENT_2 = 'stu-bank-2';
/** 抽样用：验证「并非全员同卷」需要多名学生。 */
const SAMPLE_STUDENTS = ['stu-bank-1', 'stu-bank-2', 'stu-bank-3', 'stu-bank-4', 'stu-bank-5'];
const CLASS = 'cls-bank-draw';

const service = new AssessmentService({ db: db as any });

/** 读取某次 attempt 持久化的抽题种子（paper_json.seed）。 */
function seedOf(attemptId: string): string {
  const row = db.prepare('SELECT paper_json FROM assessment_attempts WHERE id = ?').get(attemptId) as
    { paper_json?: string | null } | undefined;
  const parsed = JSON.parse(row?.paper_json || '{}') as { seed?: string };
  return String(parsed.seed ?? '');
}

async function buildDrawAssessment(settings: Record<string, unknown>, itemCount = 5) {
  const assessment = service.createAssessment({ ownerId: TEACHER_A, kind: 'quiz', title: '抽题卷', settings });
  const items = Array.from({ length: itemCount }, (_, i) => ({
    type: 'short_answer',
    stem: '题目 ' + (i + 1),
    answerKey: '要点 ' + (i + 1),
    maxScore: 10,
    config: {},
  }));
  service.replaceItems(assessment.id, TEACHER_A, items);
  const assignment = service.publish(assessment.id, TEACHER_A, { classId: CLASS, createdBy: TEACHER_A });
  return { assessment, assignment };
}

describe('题库共享与按规则抽题（Issue #186）', () => {
  beforeAll(() => {
    ensureTestSchema();
    const now = Date.now();
    for (const [id, username, role] of [
      [TEACHER_A, 'bank_teacher_a', 'teacher'],
      [TEACHER_B, 'bank_teacher_b', 'teacher'],
      ...SAMPLE_STUDENTS.map((sid, i) => [sid, 'bank_student_' + (i + 1), 'student'] as const),
    ] as const) {
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, username, 'x', role, username, now);
    }
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(CLASS, '抽题班', '', 'x', TEACHER_A, now);
    setAuditSinkForTests(null);
  });

  afterAll(() => {
    const assessmentIds = 'SELECT id FROM assessments WHERE owner_id = ?';
    db.prepare(
      'DELETE FROM assessment_answers WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (' +
        assessmentIds +
        ')))',
    ).run(TEACHER_A);
    db.prepare(
      'DELETE FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE assessment_id IN (' +
        assessmentIds +
        '))',
    ).run(TEACHER_A);
    db.prepare('DELETE FROM assessment_assignments WHERE assessment_id IN (' + assessmentIds + ')').run(TEACHER_A);
    db.prepare('DELETE FROM assessment_items WHERE assessment_id IN (' + assessmentIds + ')').run(TEACHER_A);
    db.prepare('DELETE FROM assessments WHERE owner_id = ?').run(TEACHER_A);
    db.prepare('DELETE FROM question_bank_items WHERE owner_id IN (?, ?)').run(TEACHER_A, TEACHER_B);
    db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?, ?, ?, ?)').run(TEACHER_A, TEACHER_B, ...SAMPLE_STUDENTS);
  });

  it('每人一卷：抽到 count 道、同学生重入稳定、不同学生种子不同', async () => {
    const { assignment } = await buildDrawAssessment({ draw: { count: 3 } }, 6);
    const a: any = service.startAttempt(assignment.id, STUDENT_1);
    const b: any = service.startAttempt(assignment.id, STUDENT_2);

    expect(a.items).toHaveLength(3);
    expect(b.items).toHaveLength(3);
    const idsA = a.items.map((i: any) => i.id);
    const idsB = b.items.map((i: any) => i.id);

    // 「每人一卷」的机制是种子里带 studentId，所以这里断言**种子不同**——
    // 确定性，不依赖概率。（卷面是否相同见下一个用例，那里有 1/120 的固有概率，
    // 不能写成「任意两名学生卷面必不同」，那正是此前偶发失败的原因。）
    expect(seedOf(a.attempt.id)).not.toBe(seedOf(b.attempt.id));
    expect(seedOf(a.attempt.id)).toContain(STUDENT_1);
    expect(seedOf(b.attempt.id)).toContain(STUDENT_2);

    // 同一学生再次进入（未交卷）复用同一卷面
    const again: any = service.startAttempt(assignment.id, STUDENT_1);
    expect(again.attempt.id).toBe(a.attempt.id);
    expect(again.items.map((i: any) => i.id)).toEqual(idsA);

    // 只能作答本卷题目：不存在的题 → 404（同步抛错）
    expect(() => service.saveAnswer(a.attempt.id, STUDENT_1, 'it-not-exist', 'x')).toThrowError(/item not found/);
  });

  it('不同学生的卷面不会全部相同（抽样断言，全同概率可忽略）', async () => {
    // 6 题抽 3 的有序三元组共 120 种，任意两名学生撞卷概率 1/120 ≈ 0.83%。
    // 因此不断言「两两不同」，而是抽样多人断言「并非全员同卷」：
    // n 人全同的概率 = (1/120)^(n-1)，n=5 时约 5e-9，等价于确定性。
    const { assignment } = await buildDrawAssessment({ draw: { count: 3 } }, 6);
    const papers = SAMPLE_STUDENTS.map((sid) => {
      const attempt: any = service.startAttempt(assignment.id, sid);
      return attempt.items.map((i: any) => i.id).join(',');
    });
    expect(new Set(papers).size).toBeGreaterThan(1);
  });

  it('题库不足：抽题数量超过可用题量时报 409，不静默少题', async () => {
    const { assignment } = await buildDrawAssessment({ draw: { count: 10 } }, 3);
    expect(() => service.startAttempt(assignment.id, STUDENT_1)).toThrowError(/题目不足/);
  });

  it('按题库标签/难度过滤抽题；缺少题库溯源的自建题被排除', async () => {
    const tag = 'draw-tag-' + Date.now();
    const bankEasy = service.createBankItem({
      ownerId: TEACHER_A,
      type: 'short_answer',
      stem: 'easy',
      tags: [tag],
      difficulty: 1,
      answerKey: 'e',
    });
    const bankHard = service.createBankItem({
      ownerId: TEACHER_A,
      type: 'short_answer',
      stem: 'hard',
      tags: [tag],
      difficulty: 5,
      answerKey: 'h',
    });
    const assessment = service.createAssessment({
      ownerId: TEACHER_A,
      kind: 'quiz',
      title: '过滤抽题',
      settings: { draw: { count: 1, tags: [tag], difficultyMin: 1, difficultyMax: 2 } },
    });
    service.replaceItems(assessment.id, TEACHER_A, [
      { bankItemId: bankEasy.id, type: 'short_answer', stem: 'easy', answerKey: 'e', maxScore: 10, config: {} },
      { bankItemId: bankHard.id, type: 'short_answer', stem: 'hard', answerKey: 'h', maxScore: 10, config: {} },
      { type: 'short_answer', stem: 'no-bank', answerKey: 'n', maxScore: 10, config: {} },
    ]);
    const assignment = service.publish(assessment.id, TEACHER_A, { classId: CLASS, createdBy: TEACHER_A });
    const payload: any = service.startAttempt(assignment.id, STUDENT_1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].stem).toBe('easy');
  });

  it('题库共享：school 可见同实例教师，private 仅 owner', () => {
    const shared = service.createBankItem({
      ownerId: TEACHER_A,
      type: 'short_answer',
      stem: '共享题',
      tags: [],
      answerKey: 's',
      visibility: 'school',
    });
    const privateItem = service.createBankItem({
      ownerId: TEACHER_A,
      type: 'short_answer',
      stem: '私有题',
      tags: [],
      answerKey: 'p',
      visibility: 'private',
    });

    const visibleToB = service.listBankItems(TEACHER_B).map((item: any) => item.id);
    expect(visibleToB).toContain(shared.id);
    expect(visibleToB).not.toContain(privateItem.id);
    // 读取：共享可读，私有 403
    expect(service.getBankItem(shared.id, TEACHER_B).id).toBe(shared.id);
    expect(() => service.getBankItem(privateItem.id, TEACHER_B)).toThrowError(/not the bank item owner|forbidden/i);
  });
});
