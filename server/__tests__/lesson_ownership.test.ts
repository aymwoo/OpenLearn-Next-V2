import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { checkLessonOwnership, requireWhiteboardWriteAccess } from '../routes/lessons.js';
import { v7 as uuidv7 } from 'uuid';

describe('Lesson Ownership & IDOR Protection Suite', () => {
  const teacherAliceId = 'usr_teacher_alice';
  const teacherBobId = 'usr_teacher_bob';
  const adminId = 'usr_admin';
  const studentId = 'usr_student_charlie';

  const aliceSession = {
    userId: teacherAliceId,
    username: 'alice',
    role: 'teacher',
    name: 'Alice Teacher'
  };

  const bobSession = {
    userId: teacherBobId,
    username: 'bob',
    role: 'teacher',
    name: 'Bob Teacher'
  };

  const adminSession = {
    userId: adminId,
    username: 'admin',
    role: 'administrator',
    name: 'System Admin'
  };

  const studentSession = {
    userId: studentId,
    username: 'charlie',
    role: 'student',
    name: 'Charlie Student'
  };

  let aliceLessonId: string;
  let legacyLessonId: string;

  beforeEach(() => {
    aliceLessonId = `lesson-alice-${uuidv7()}`;
    legacyLessonId = `lesson-legacy-${uuidv7()}`;

    // Seed Alice's lesson
    kernelContainer.db.prepare(`
      INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(aliceLessonId, 'Alice Physics 101', 'Newtonian Mechanics', '[]', 'manual', teacherAliceId, Date.now(), Date.now());

    // Seed a legacy lesson without creator_id
    kernelContainer.db.prepare(`
      INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(legacyLessonId, 'Legacy Math 101', 'Algebra', '[]', 'manual', Date.now(), Date.now());
  });

  afterAll(() => {
    try {
      kernelContainer.db.prepare('DELETE FROM lessons WHERE title LIKE ?').run('%Physics%');
      kernelContainer.db.prepare('DELETE FROM lessons WHERE title LIKE ?').run('%Math%');
    } catch (_) {}
  });

  describe('checkLessonOwnership Unit Tests', () => {
    it('should reject unauthenticated request with 401', () => {
      const req: any = { headers: {} };
      const result = checkLessonOwnership(req, aliceLessonId);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain('Authentication required');
    });

    it('should reject non-teacher / non-admin (student) with 403', () => {
      const req: any = { headers: {}, session: studentSession };
      const result = checkLessonOwnership(req, aliceLessonId);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('Only teachers or administrators');
    });

    it('should return 404 if lesson does not exist', () => {
      const req: any = { headers: {}, session: aliceSession };
      const result = checkLessonOwnership(req, 'non-existent-lesson-id');
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toContain('Lesson not found');
    });

    it('should allow the creator teacher to modify the lesson', () => {
      const req: any = { headers: {}, session: aliceSession };
      const result = checkLessonOwnership(req, aliceLessonId);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
      expect(result.lesson.id).toBe(aliceLessonId);
    });

    it('should block another teacher (IDOR attempt) with 403', () => {
      const req: any = { headers: {}, session: bobSession };
      const result = checkLessonOwnership(req, aliceLessonId);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('Forbidden: You do not have permission to modify this lesson');
    });

    it('should allow administrator to modify any lesson', () => {
      const req: any = { headers: {}, session: adminSession };
      const result = checkLessonOwnership(req, aliceLessonId);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
    });

    it('should allow teachers to modify legacy lessons without creator_id', () => {
      const reqBob: any = { headers: {}, session: bobSession };
      const result = checkLessonOwnership(reqBob, legacyLessonId);
      expect(result.allowed).toBe(true);
      expect(result.status).toBe(200);
    });
  });

  describe('Lesson Clone & Collaborative Handoff', () => {
    it('should assign new creator_id to current teacher when cloned', () => {
      // Simulate cloning Alice's lesson by Bob
      const original = kernelContainer.db.prepare('SELECT * FROM lessons WHERE id = ?').get(aliceLessonId) as any;
      expect(original).toBeDefined();

      const clonedId = `cloned-${uuidv7()}`;
      const now = Date.now();
      const clonedTitle = `副本-${original.title}`;

      kernelContainer.db.prepare(`
        INSERT INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(clonedId, clonedTitle, original.content, original.timeline, original.progress_mode, original.progress_conditions, teacherBobId, now, now);

      // Verify Bob is owner of the cloned lesson
      const reqBob: any = { headers: {}, session: bobSession };
      const bobOwnership = checkLessonOwnership(reqBob, clonedId);
      expect(bobOwnership.allowed).toBe(true);
      expect(bobOwnership.lesson.creator_id).toBe(teacherBobId);

      // Verify Alice cannot modify Bob's cloned lesson
      const reqAlice: any = { headers: {}, session: aliceSession };
      const aliceOwnership = checkLessonOwnership(reqAlice, clonedId);
      expect(aliceOwnership.allowed).toBe(false);
      expect(aliceOwnership.status).toBe(403);
    });
  });

  describe('Kernel lesson.create command creator binding', () => {
    it('should store creatorId in the database when executed via commandBus', async () => {
      const cmd = kernelContainer.commandBus.createCommand(
        'lesson.create',
        {
          title: 'Chemistry Lab 101',
          content: 'Chemical reactions',
          creatorId: 'usr_teacher_chemist'
        },
        'user:usr_teacher_chemist:teacher',
        { approved: true }
      );

      const res = await kernelContainer.commandBus.execute(cmd) as any;
      expect(res.lessonId).toBeDefined();

      const savedLesson = kernelContainer.db.prepare('SELECT * FROM lessons WHERE id = ?').get(res.lessonId) as any;
      expect(savedLesson).toBeDefined();
      expect(savedLesson.creator_id).toBe('usr_teacher_chemist');
    });
  });

  describe('requireWhiteboardWriteAccess Middleware Suite', () => {
    function executeMiddleware(middleware: any, req: any): Promise<{ status: number; body: any; nextCalled: boolean }> {
      return new Promise((resolve) => {
        let status = 200;
        let body: any = null;
        let nextCalled = false;
        const res: any = {
          status: (s: number) => {
            status = s;
            return {
              json: (b: any) => {
                body = b;
                resolve({ status, body, nextCalled });
              }
            };
          },
          json: (b: any) => {
            body = b;
            resolve({ status, body, nextCalled });
          }
        };
        const next = () => {
          nextCalled = true;
          resolve({ status, body, nextCalled });
        };
        middleware(req, res, next);
      });
    }

    it('should reject anonymous whiteboard writes with 401 on regular lessons', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, params: { id: aliceLessonId } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(false);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });

    it('should reject anonymous whiteboard writes with 401 on assignment whiteboards', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, params: { id: 'assignment-asg1-student-charlie' } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(false);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });

    it('should reject students attempting to write to classroom lesson whiteboard with 403', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: studentSession, params: { id: aliceLessonId } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(false);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Students cannot modify classroom whiteboards');
    });

    it('should reject students attempting to modify another student assignment whiteboard with 403', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: studentSession, params: { id: 'assignment-asg1-student-david' } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(false);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('modify another student');
    });

    it('should allow student modifying their own assignment whiteboard', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = {
        headers: {},
        session: { ...studentSession, studentId: 'usr_student_charlie' },
        params: { id: 'assignment-asg1-student-usr_student_charlie' }
      };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(true);
    });

    it('should allow teachers to access assignment whiteboards for grading', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: bobSession, params: { id: 'assignment-asg1-student-usr_student_charlie' } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(true);
    });

    it('should reject non-owner teacher modifying Alice lesson whiteboard with 403', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: bobSession, params: { id: aliceLessonId } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(false);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('should allow owner teacher Alice to modify her lesson whiteboard', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: aliceSession, params: { id: aliceLessonId } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(true);
    });

    it('should allow administrator to modify any lesson whiteboard', async () => {
      const mw = requireWhiteboardWriteAccess();
      const req = { headers: {}, session: adminSession, params: { id: aliceLessonId } };
      const res = await executeMiddleware(mw, req);
      expect(res.nextCalled).toBe(true);
    });
  });
});
