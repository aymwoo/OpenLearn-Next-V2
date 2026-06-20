import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Token } from '../token.js';
import { ISemesterGradeServiceToken, ISemesterGradeService } from '../interfaces.js';
import { SEMESTER_GRADE_SERVICE_TOKEN } from '../../../../src/plugin-host/types';
import { MfeServiceRegistryProxy, DI_WHITELIST } from '../../../../src/mfe/MfeContextProvider';
import { ServiceRegistry } from '../service-registry.js';
import { db } from '../../db/index.js';
import { SemesterGradeService } from '../semester-grade-service.js';

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
