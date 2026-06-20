// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Token } from '../token.js';
import { ISemesterGradeServiceToken, ISemesterGradeService } from '../interfaces.js';
import { SEMESTER_GRADE_SERVICE_TOKEN } from '../../../../src/plugin-host/types';
import { MfeServiceRegistryProxy, DI_WHITELIST } from '../../../../src/mfe/MfeContextProvider';
import { ServiceRegistry } from '../service-registry.js';
import { db } from '../../db/index.js';
import { SemesterGradeService } from '../semester-grade-service.js';
import { Kernel } from '../../kernel/index.js';

describe('SemesterGradeService - Token Contracts and Whitelist (Wave 1)', () => {
  it('should define ISemesterGradeServiceToken correctly', () => {
    expect(ISemesterGradeServiceToken).toBeInstanceOf(Token);
    expect(ISemesterGradeServiceToken.name).toBe('@openlearn/core:ISemesterGradeService');
  });

  it('should define frontend SEMESTER_GRADE_SERVICE_TOKEN correctly', () => {
    expect(SEMESTER_GRADE_SERVICE_TOKEN).toBe('@openlearn/frontend:ISemesterGradeService');
  });

  it('should include the frontend semester grade Token in DI_WHITELIST', () => {
    expect(DI_WHITELIST).toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('should allow resolving the semester grade Token via MfeServiceRegistryProxy without access denied', async () => {
    const mockService: ISemesterGradeService = {
      saveSemesterGrade: async () => {}
    };

    const fakeFrontendRegistry = {
      resolve: async (token: string) => {
        if (token === SEMESTER_GRADE_SERVICE_TOKEN) return mockService;
        throw new Error('Not found');
      },
      services: new Map<string, any>([[SEMESTER_GRADE_SERVICE_TOKEN, mockService]]),
      has: (token: string) => token === SEMESTER_GRADE_SERVICE_TOKEN
    };

    const proxy = new MfeServiceRegistryProxy(fakeFrontendRegistry);

    const resolved = await proxy.resolve<ISemesterGradeService>(SEMESTER_GRADE_SERVICE_TOKEN);
    expect(resolved).toBe(mockService);

    const gotten = proxy.get<ISemesterGradeService>(SEMESTER_GRADE_SERVICE_TOKEN);
    expect(gotten).toBe(mockService);

    expect(proxy.has(SEMESTER_GRADE_SERVICE_TOKEN)).toBe(true);
  });

  it('should throw Access Denied on non-whitelisted token resolution', async () => {
    const fakeFrontendRegistry = {
      resolve: async () => ({}),
      services: new Map<string, any>(),
      has: () => true
    };

    const proxy = new MfeServiceRegistryProxy(fakeFrontendRegistry);
    const privateToken = '@openlearn/frontend:IPrivateHostService';

    await expect(proxy.resolve(privateToken)).rejects.toThrow(/Access Denied/);
    expect(() => proxy.get(privateToken)).toThrow(/Access Denied/);
    expect(() => proxy.has(privateToken)).toThrow(/Access Denied/);
  });
});

describe('SemesterGradeService - Database Schemas & Sync Logic (Wave 2)', () => {
  const testLessonId = 'test-grade-lesson-123';
  const testClassId = 'test-grade-class-456';
  const testStudentId = 'test-grade-student-789';

  beforeAll(() => {
    // Setup test data in DB
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(testLessonId, 'Test Grade Lesson', 'Test content', Date.now(), Date.now());

    db.prepare('INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('test-grade-schedule-000', testClassId, testLessonId, '2026-06-20', Date.now());
  });

  afterAll(() => {
    // Clean up test data from DB
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(testLessonId);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(`plugin-lesson-${testLessonId}`);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(`plugin-lesson-${testLessonId}`);
    
    // Also clean up plugin tables if any records exist
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(testLessonId);
  });

  it('should verify that plugin_submissions, plugin_peer_reviews, and plugin_grades tables exist', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_%'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('plugin_submissions');
    expect(tableNames).toContain('plugin_peer_reviews');
    expect(tableNames).toContain('plugin_grades');
  });

  it('should synchronize regular scores to host assignments and assignment_submissions successfully', async () => {
    const service = new SemesterGradeService(db);

    // Sync score 88 first
    await service.saveSemesterGrade(testLessonId, testStudentId, 88);

    // Verify assignment is created
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(`plugin-lesson-${testLessonId}`) as any;
    expect(assignment).toBeDefined();
    expect(assignment.lesson_id).toBe(testLessonId);
    expect(assignment.class_id).toBe(testClassId);

    // Verify submission is updated with score 88
    let submission = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(`plugin-lesson-${testLessonId}`, testStudentId) as any;
    expect(submission).toBeDefined();
    expect(submission.score).toBe(88);
    expect(submission.status).toBe('graded');

    // Sync updated score 95 to verify overwrite behavior
    await service.saveSemesterGrade(testLessonId, testStudentId, 95);

    submission = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(`plugin-lesson-${testLessonId}`, testStudentId) as any;
    expect(submission.score).toBe(95);
  });
});

describe('SemesterGradeService & AssignmentEvalPlugin Integration (Wave 3)', () => {
  const testLessonId = 'test-eval-lesson-123';
  const testClassId = 'test-eval-class-456';
  const testStudentId1 = 'student-alice';
  const testStudentId2 = 'student-bob';
  const testTeacherId = 'teacher-carol';
  let kernel: Kernel;

  beforeAll(async () => {
    kernel = new Kernel();
    await kernel.ready;

    // Grant capabilities
    kernel.capabilityGuard.grant(testStudentId1, 'lesson:write');
    kernel.capabilityGuard.grant(testStudentId1, 'lesson:read');
    kernel.capabilityGuard.grant(testStudentId2, 'lesson:write');
    kernel.capabilityGuard.grant(testStudentId2, 'lesson:read');
    kernel.capabilityGuard.grant(testTeacherId, 'lesson:write');
    kernel.capabilityGuard.grant(testTeacherId, 'lesson:read');

    // Setup schedule and lesson data
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(testLessonId, 'Test Eval Lesson', 'Test content', Date.now(), Date.now());

    db.prepare('INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('test-eval-schedule-000', testClassId, testLessonId, '2026-06-20', Date.now());
  });

  afterAll(() => {
    // Clean up test data
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(testLessonId);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(`plugin-lesson-${testLessonId}`);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(`plugin-lesson-${testLessonId}`);
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(testLessonId);
  });

  it('should verify that AssignmentEvalPlugin is registered and active', () => {
    const state = kernel.pluginHost.getPluginState('@openlearn/plugin-assignment-eval');
    expect(state).toBe('active');
  });

  it('should handle assignment.submit successfully and increment version on duplicate submit', async () => {
    // 1. Submit first version
    const cmd1 = kernel.commandBus.createCommand('assignment.submit', {
      lessonId: testLessonId,
      studentId: testStudentId1,
      filePath: '/submissions/alice_v1.pdf'
    }, testStudentId1);

    const res1 = await kernel.commandBus.execute(cmd1) as any;
    expect(res1.success).toBe(true);
    expect(res1.submissionId).toBeDefined();
    expect(res1.version).toBe(1);

    // Verify in db
    let sub = db.prepare('SELECT * FROM plugin_submissions WHERE id = ?').get(res1.submissionId) as any;
    expect(sub).toBeDefined();
    expect(sub.file_path).toBe('/submissions/alice_v1.pdf');
    expect(sub.version).toBe(1);

    // 2. Submit second version (overwrite)
    const cmd2 = kernel.commandBus.createCommand('assignment.submit', {
      lessonId: testLessonId,
      studentId: testStudentId1,
      filePath: '/submissions/alice_v2.pdf'
    }, testStudentId1);

    const res2 = await kernel.commandBus.execute(cmd2) as any;
    expect(res2.success).toBe(true);
    expect(res2.submissionId).toBe(res1.submissionId);
    expect(res2.version).toBe(2);

    // Verify update in db
    sub = db.prepare('SELECT * FROM plugin_submissions WHERE id = ?').get(res2.submissionId) as any;
    expect(sub.file_path).toBe('/submissions/alice_v2.pdf');
    expect(sub.version).toBe(2);
  });

  it('should block self peer reviews and allow peer review from other students', async () => {
    // Alice submits
    const cmdSubmitAlice = kernel.commandBus.createCommand('assignment.submit', {
      lessonId: testLessonId,
      studentId: testStudentId1,
      filePath: '/submissions/alice_v2.pdf'
    }, testStudentId1);
    const resSubmitAlice = await kernel.commandBus.execute(cmdSubmitAlice) as any;
    const aliceSubId = resSubmitAlice.submissionId;

    // Bob submits
    const cmdSubmitBob = kernel.commandBus.createCommand('assignment.submit', {
      lessonId: testLessonId,
      studentId: testStudentId2,
      filePath: '/submissions/bob_v1.pdf'
    }, testStudentId2);
    const resSubmitBob = await kernel.commandBus.execute(cmdSubmitBob) as any;
    const bobSubId = resSubmitBob.submissionId;

    // 1. Peer review self should fail (Collusion Check)
    const cmdSelfReview = kernel.commandBus.createCommand('assignment.peer_review', {
      submissionId: aliceSubId,
      reviewerId: testStudentId1,
      score: 85,
      comment: 'I am so good'
    }, testStudentId1);

    await expect(kernel.commandBus.execute(cmdSelfReview)).rejects.toThrow(/Access Denied/);

    // 2. Peer review with invalid score should fail (Boundary Check)
    const cmdInvalidReview1 = kernel.commandBus.createCommand('assignment.peer_review', {
      submissionId: aliceSubId,
      reviewerId: testStudentId2,
      score: 105,
      comment: 'Too high'
    }, testStudentId2);
    await expect(kernel.commandBus.execute(cmdInvalidReview1)).rejects.toThrow(/Access Denied/);

    const cmdInvalidReview2 = kernel.commandBus.createCommand('assignment.peer_review', {
      submissionId: aliceSubId,
      reviewerId: testStudentId2,
      score: -5,
      comment: 'Too low'
    }, testStudentId2);
    await expect(kernel.commandBus.execute(cmdInvalidReview2)).rejects.toThrow(/Access Denied/);

    // 3. Valid peer review should succeed
    const cmdValidReview = kernel.commandBus.createCommand('assignment.peer_review', {
      submissionId: aliceSubId,
      reviewerId: testStudentId2,
      score: 90,
      comment: 'Well done Bob'
    }, testStudentId2);

    const resReview = await kernel.commandBus.execute(cmdValidReview) as any;
    expect(resReview.success).toBe(true);
    expect(resReview.reviewId).toBeDefined();

    // Verify in db
    const review = db.prepare('SELECT * FROM plugin_peer_reviews WHERE id = ?').get(resReview.reviewId) as any;
    expect(review).toBeDefined();
    expect(review.score).toBe(90);
    expect(review.reviewer_id).toBe(testStudentId2);
  });

  it('should handle grading as draft or confirmed with correct weights and score calculation', async () => {
    // Setup Bob's submission and peer reviews
    const cmdSubmitBob = kernel.commandBus.createCommand('assignment.submit', {
      lessonId: testLessonId,
      studentId: testStudentId2,
      filePath: '/submissions/bob_v1.pdf'
    }, testStudentId2);
    const resSubmitBob = await kernel.commandBus.execute(cmdSubmitBob) as any;
    const bobSubId = resSubmitBob.submissionId;

    // Alice reviews Bob with score 80
    const cmdReview1 = kernel.commandBus.createCommand('assignment.peer_review', {
      submissionId: bobSubId,
      reviewerId: testStudentId1,
      score: 80,
      comment: 'Decent work'
    }, testStudentId1);
    await kernel.commandBus.execute(cmdReview1);

    // 1. Grade as Draft
    const cmdGradeDraft = kernel.commandBus.createCommand('assignment.grade', {
      submissionId: bobSubId,
      teacherScore: 90,
      teacherComment: 'Good job in draft',
      teacherWeight: 0.6,
      peerWeight: 0.4,
      status: 'draft'
    }, testTeacherId);

    const resGradeDraft = await kernel.commandBus.execute(cmdGradeDraft) as any;
    expect(resGradeDraft.success).toBe(true);
    // Calculated score: 90 * 0.6 + 80 * 0.4 = 54 + 32 = 86
    expect(resGradeDraft.calculatedFinalScore).toBe(86);

    // Verify in plugin_grades db table
    let gradeRecord = db.prepare('SELECT * FROM plugin_grades WHERE submission_id = ?').get(bobSubId) as any;
    expect(gradeRecord).toBeDefined();
    expect(gradeRecord.status).toBe('draft');
    expect(gradeRecord.calculated_final_score).toBe(86);

    // Host table must NOT be synced yet
    const hostSubDraft = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(`plugin-lesson-${testLessonId}`, testStudentId2) as any;
    expect(hostSubDraft).toBeUndefined();

    // 2. Grade as Confirmed
    const cmdGradeConfirm = kernel.commandBus.createCommand('assignment.grade', {
      submissionId: bobSubId,
      teacherScore: 95,
      teacherComment: 'Excellent work upon review',
      teacherWeight: 0.6,
      peerWeight: 0.4,
      status: 'confirmed'
    }, testTeacherId);

    const resGradeConfirm = await kernel.commandBus.execute(cmdGradeConfirm) as any;
    expect(resGradeConfirm.success).toBe(true);
    // Calculated score: 95 * 0.6 + 80 * 0.4 = 57 + 32 = 89
    expect(resGradeConfirm.calculatedFinalScore).toBe(89);

    // Verify status updated in plugin_grades db table
    gradeRecord = db.prepare('SELECT * FROM plugin_grades WHERE submission_id = ?').get(bobSubId) as any;
    expect(gradeRecord.status).toBe('confirmed');
    expect(gradeRecord.calculated_final_score).toBe(89);

    // Host table MUST be synced now
    const hostSubConfirm = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(`plugin-lesson-${testLessonId}`, testStudentId2) as any;
    expect(hostSubConfirm).toBeDefined();
    expect(hostSubConfirm.score).toBe(89);
    expect(hostSubConfirm.status).toBe('graded');

    // 3. Defensive checks
    // Invalid score
    const cmdInvalidGrade = kernel.commandBus.createCommand('assignment.grade', {
      submissionId: bobSubId,
      teacherScore: -10,
      status: 'confirmed'
    }, testTeacherId);
    await expect(kernel.commandBus.execute(cmdInvalidGrade)).rejects.toThrow(/Access Denied/);

    // Invalid weights total
    const cmdInvalidWeights = kernel.commandBus.createCommand('assignment.grade', {
      submissionId: bobSubId,
      teacherScore: 90,
      teacherWeight: 0.8,
      peerWeight: 0.5, // Total 1.3
      status: 'confirmed'
    }, testTeacherId);
    await expect(kernel.commandBus.execute(cmdInvalidWeights)).rejects.toThrow(/Access Denied/);
  });
});
