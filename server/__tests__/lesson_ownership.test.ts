import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { checkLessonOwnership } from '../routes/lessons.js';
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
});
