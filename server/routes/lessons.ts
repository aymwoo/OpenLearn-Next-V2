import { GoogleGenAI } from '@google/genai';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';

/**
 * 校验当前用户对课程的管理权 (水平越权 IDOR 防护)
 * - 管理员 (administrator) 拥有全局管辖权
 * - 教师仅可修改/删除本人创建的课程 (creator_id === session.userId)
 * - 兼容历史未记录 creator_id 的课程
 */
export function checkLessonOwnership(req: any, lessonId: string): { allowed: boolean; status: number; error?: string; lesson?: any } {
  const token = getCookieToken(req);
  const session = req.session || (token ? getValidSession(token) : null);
  if (!session) {
    return { allowed: false, status: 401, error: 'Authentication required' };
  }

  const isAdmin =
    session.username === 'admin' ||
    session.userId === 'usr_admin' ||
    session.role === 'admin' ||
    session.role === 'administrator';

  const isTeacherOrAdmin = isAdmin || session.role === 'teacher';
  if (!isTeacherOrAdmin) {
    return { allowed: false, status: 403, error: 'Forbidden: Only teachers or administrators can modify lessons' };
  }

  const lesson = kernelContainer.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
  if (!lesson) {
    return { allowed: false, status: 404, error: 'Lesson not found' };
  }

  if (isAdmin) {
    return { allowed: true, status: 200, lesson };
  }

  if (!lesson.creator_id || lesson.creator_id === session.userId || lesson.creator_id === session.username) {
    return { allowed: true, status: 200, lesson };
  }

  return {
    allowed: false,
    status: 403,
    error: 'Forbidden: You do not have permission to modify this lesson because it was created by another teacher'
  };
}

export function registerLessonsRoutes(ctx: ServerContext) {
  const { app, io } = ctx;

  app.get('/api/lessons', (req, res) => {
    const lessons = kernelContainer.db.prepare(`
      SELECT l.*, u.name as creator_name,
        (SELECT COUNT(*) FROM student_lesson_progress WHERE lesson_id = l.id) as enrollment_count
      FROM lessons l
      LEFT JOIN users u ON l.creator_id = u.id
      ORDER BY l.created_at DESC
    `).all();
    res.json(lessons);
  });

  // ── 作业上传与互评插�? API ──────────────────────────────────────────────
  app.get('/api/lessons/:lessonId/eval-submissions', (req, res) => {
    try {
      const { lessonId } = req.params;
      const rows = kernelContainer.db.prepare(`
        SELECT ps.*, s.name as student_name
        FROM plugin_submissions ps
        LEFT JOIN students s ON ps.student_id = s.id
        WHERE ps.lesson_id = ?
      `).all(lessonId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/eval-grades', (req, res) => {
    try {
      const { lessonId } = req.params;
      const submissions = kernelContainer.db.prepare(`
        SELECT ps.*, s.name as student_name
        FROM plugin_submissions ps
        LEFT JOIN students s ON ps.student_id = s.id
        WHERE ps.lesson_id = ?
      `).all(lessonId) as any[];

      const result = [];
      for (const sub of submissions) {
        // Query peer reviews with reviewer names
        const reviews = kernelContainer.db.prepare(`
          SELECT pr.*, s.name as reviewer_name
          FROM plugin_peer_reviews pr
          LEFT JOIN students s ON pr.reviewer_id = s.id
          WHERE pr.submission_id = ?
        `).all(sub.id) as any[];

        let peerAverageScore = 0;
        if (reviews.length > 0) {
          const sum = reviews.reduce((acc, r) => acc + r.score, 0);
          peerAverageScore = Math.round(sum / reviews.length);
        }

        // Query grade details
        const grade = kernelContainer.db.prepare(`
          SELECT * FROM plugin_grades WHERE submission_id = ?
        `).get(sub.id) as any;

        result.push({
          id: sub.id,
          lessonId: sub.lesson_id,
          studentId: sub.student_id,
          studentName: sub.student_name,
          filePath: sub.file_path,
          version: sub.version,
          createdAt: sub.created_at,
          updatedAt: sub.updated_at,
          peerReviews: reviews,
          peerAverageScore,
          grade: grade || null
        });
      }

      res.json(result);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/eval-submissions/:submissionId/reviews', (req, res) => {
    try {
      const { submissionId } = req.params;
      const rows = kernelContainer.db.prepare(`
        SELECT pr.*, s.name as reviewer_name
        FROM plugin_peer_reviews pr
        LEFT JOIN students s ON pr.reviewer_id = s.id
        WHERE pr.submission_id = ?
      `).all(submissionId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/students/:studentId/eval-status', (req, res) => {
    try {
      const { lessonId, studentId } = req.params;
      const submission = kernelContainer.db.prepare(`
        SELECT * FROM plugin_submissions WHERE lesson_id = ? AND student_id = ?
      `).get(lessonId, studentId) as any;

      let reviewsWritten = [];
      let grade = null;

      if (submission) {
        reviewsWritten = kernelContainer.db.prepare(`
          SELECT pr.*, s.name as student_name 
          FROM plugin_peer_reviews pr
          LEFT JOIN plugin_submissions ps ON pr.submission_id = ps.id
          LEFT JOIN students s ON ps.student_id = s.id
          WHERE pr.reviewer_id = ? AND ps.lesson_id = ?
        `).all(studentId, lessonId);

        grade = kernelContainer.db.prepare(`
          SELECT * FROM plugin_grades WHERE submission_id = ?
        `).get(submission.id) as any;
      } else {
        reviewsWritten = kernelContainer.db.prepare(`
          SELECT pr.*, s.name as student_name 
          FROM plugin_peer_reviews pr
          LEFT JOIN plugin_submissions ps ON pr.submission_id = ps.id
          LEFT JOIN students s ON ps.student_id = s.id
          WHERE pr.reviewer_id = ? AND ps.lesson_id = ?
        `).all(studentId, lessonId);
      }

      res.json({
        submission,
        reviewsWritten,
        grade
      });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.post('/api/lessons', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { title, content } = req.body;
      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || 'usr_teacher';
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand(
         'lesson.create',
         { title, content, creatorId },
         actorId,
         { approved: true }
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/timeline', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const { timeline } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand(
         'lesson.update_timeline',
         { lessonId: id, timeline },
         actorId,
         { approved: true }
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/progress-mode', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const { progressMode, progressConditions } = req.body;
      const conditionsStr = typeof progressConditions === 'string'
        ? progressConditions
        : JSON.stringify(progressConditions || null);

      kernelContainer.db.prepare('UPDATE lessons SET progress_mode = ?, progress_conditions = ?, updated_at = ? WHERE id = ?')
        .run(progressMode || 'manual', conditionsStr, Date.now(), id);

      io.emit('lesson-progress-mode-changed', {
        lessonId: id,
        progressMode: progressMode || 'manual',
        progressConditions: progressConditions || null
      });

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
  
  // Auth helper functions imported from server/middleware/auth.js
  // (getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId are now module-level imports)


  app.get('/api/lessons/:id/whiteboard', (req, res) => {
    const id = req.params.id;
    const elements = kernelContainer.db.prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?').all(id);
    
    // Take a snapshot on first load if it's a regular lesson and no snapshot exists yet
    if (!id.startsWith('assignment-') && !id.startsWith('snapshot-')) {
      try {
        const snapshotId = `snapshot-${id}`;
        const markerCheck = kernelContainer.db.prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?').get(snapshotId) as any;
        const count = markerCheck ? markerCheck.count : 0;
        if (count === 0) {
          // Take snapshot
          const insertStmt = kernelContainer.db.prepare(
            'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
          );
          
          // Insert marker
          insertStmt.run(`marker-${id}-${Date.now()}`, snapshotId, 'snapshot_marker', '{}', Date.now());
          
          // Insert copies of all current elements
          for (const el of elements as any[]) {
            insertStmt.run(`snapshot-${el.id}`, snapshotId, el.type, el.data, el.created_at);
          }
        }
      } catch (err) {
        console.error('Failed to create whiteboard snapshot:', err);
      }
    }
    
    res.json(elements);
  });

  app.post('/api/lessons/:id/whiteboard/reset', async (req, res) => {
    try {
      const id = req.params.id;
      
      // If it's an assignment whiteboard, reset means clearing it (making it empty)
      if (id.startsWith('assignment-')) {
        const deleteStmt = kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?');
        deleteStmt.run(id);
        res.json({ success: true, message: 'Assignment whiteboard reset to empty' });
        return;
      }

      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }
      
      const snapshotId = `snapshot-${id}`;
      const hasSnapshot = kernelContainer.db.prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?').get(snapshotId) as any;
      const count = hasSnapshot ? hasSnapshot.count : 0;
      
      if (count > 0) {
        // Revert to snapshot
        // 1. Delete all current elements for this lesson
        kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(id);
        
        // 2. Fetch all snapshot elements (excluding the marker)
        const snapshotElements = kernelContainer.db.prepare(
          "SELECT * FROM whiteboard_elements WHERE lesson_id = ? AND type != 'snapshot_marker'"
        ).all(snapshotId) as any[];
        
        // 3. Re-insert them into the active lesson whiteboard
        const insertStmt = kernelContainer.db.prepare(
          'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        for (const el of snapshotElements) {
          const originalId = el.id.startsWith('snapshot-') ? el.id.substring('snapshot-'.length) : el.id;
          insertStmt.run(originalId, id, el.type, el.data, el.created_at);
        }
        res.json({ success: true, message: 'Lesson whiteboard reset to start state' });
      } else {
        // If no snapshot exists, just clear it
        kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(id);
        res.json({ success: true, message: 'Lesson whiteboard cleared (no snapshot)' });
      }
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/lessons/:id/whiteboard', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-')) {
        const ownership = checkLessonOwnership(req, id);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }
      const { type, data } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.draw', {
        lessonId: id,
        type,
        data: JSON.stringify(data)
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/whiteboard/:elementId', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-')) {
        const ownership = checkLessonOwnership(req, id);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }
      const { data } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.update', {
        lessonId: id,
        elementId: req.params.elementId,
        data: JSON.stringify(data)
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/lessons/:id/whiteboard', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-')) {
        const ownership = checkLessonOwnership(req, id);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.clear', {
        lessonId: id
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/lessons/:id/whiteboard/:elementId', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-')) {
        const ownership = checkLessonOwnership(req, id);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.delete', {
        lessonId: id,
        elementId: req.params.elementId
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Quiz submission (student) ──────────────────────────────────────────────
  app.post('/api/lessons/:id/quiz-submit', async (req, res) => {
    try {
      const { id: lessonId } = req.params;
      const { elementId, answer } = req.body;
      if (!elementId || answer === undefined) {
        return res.status(400).json({ error: 'Missing elementId or answer' });
      }

      // Get student info from session
      const token = getCookieToken(req);
      let studentId = 'guest';
      if (token) {
        const sessionRow = kernelContainer.db.prepare('SELECT * FROM client_sessions WHERE id = ?').get(token) as any;
        if (sessionRow) {
          const session = JSON.parse(sessionRow.session_data);
          if (session.role === 'student') {
            studentId = session.studentId || session.userId || 'guest';
          }
        }
      }

      // Retrieve the quiz element
      const row = kernelContainer.db.prepare(
        'SELECT data FROM whiteboard_elements WHERE id = ? AND lesson_id = ?'
      ).get(elementId, lessonId) as { data: string } | undefined;
      if (!row) {
        return res.status(404).json({ error: 'Quiz element not found' });
      }

      const dataObj = JSON.parse(row.data);
      const correctAnswer = dataObj.correctAnswer;

      // Determine correctness
      let isCorrect = false;
      let score = 0;
      if (correctAnswer) {
        const normalize = (s: string) => String(s).trim().toLowerCase();
        isCorrect = normalize(answer) === normalize(correctAnswer);
        score = isCorrect ? 100 : 0;
      }

      // Record submission
      if (!dataObj.submissions) dataObj.submissions = {};
      dataObj.submissions[studentId] = { answer, score, time: Date.now() };

      // Persist updated data
      kernelContainer.db.prepare(
        'UPDATE whiteboard_elements SET data = ? WHERE id = ?'
      ).run(JSON.stringify(dataObj), elementId);

      // Broadcast refresh to whiteboard room
      io.to(`lesson-${lessonId}`).emit('whiteboard-sync', { type: 'element-updated', elementId });

      res.json({ success: true, isCorrect, score, studentId });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Quiz submissions retrieval (teacher) ────────────────────────────────────
  app.get('/api/lessons/:id/quiz-submissions', (req, res) => {
    try {
      const { id: lessonId } = req.params;
      if (!checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const elements = kernelContainer.db.prepare(
        'SELECT id, type, data FROM whiteboard_elements WHERE lesson_id = ? AND type = ?'
      ).all(lessonId, 'quiz') as { id: string; type: string; data: string }[];

      const quizzes = elements.map(el => {
        let parsed: any = {};
        try { parsed = JSON.parse(el.data); } catch (_) {}
        return {
          elementId: el.id,
          question: parsed.question || '',
          options: parsed.options || [],
          correctAnswer: parsed.correctAnswer || null,
          submissions: parsed.submissions || {},
          submissionCount: Object.keys(parsed.submissions || {}).length
        };
      });

      res.json({ success: true, quizzes });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/lessons/:id/ai-tutor', async (req, res) => {
    try {
      const { elements } = req.body;
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const elementsSummary = elements.map((e: any, i: number) => `Element ${i+1}: type=${e.type}, content=${JSON.stringify(e.data)}`).join('\n');
      
      const prompt = `You are a real-time AI Tutor monitoring a student's interactive whiteboard.
The student has pressed the "Ask AI" button for help.
Current Whiteboard Elements:
${elementsSummary || 'The whiteboard is empty.'}

Provide a short, friendly, and helpful hint (1-2 sentences) directly related to the student's current progress or to encourage them to start. Do not use markdown. Return ONLY the hint text.`;

      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const hint = response.text || "I'm here to help! Let me know what you're working on.";

      const cmd = kernelContainer.commandBus.createCommand('whiteboard.draw', {
        lessonId: req.params.id,
        type: 'text',
        data: JSON.stringify({
          text: `🤖 AI Tutor: ${hint}`,
          x: 50,
          y: 50,
          fontSize: 20,
          color: '#8b5cf6',
          page: 0
        })
      }, 'system-ai', { approved: true });
      
      await kernelContainer.commandBus.execute(cmd);

      // In a real system, the socket.io broadcast would happen here or within the command handler.
      // The frontend currently emits a 'refresh' event on its own socket upon success of this API.
      res.json({ success: true, hint });
    } catch (e: any) {
      console.error('AI Tutor error:', e);
      sendSafeError(res, e);
    }
  });

  // ── 课程删除 API ─────────────────────────────────────────────────────
  app.delete('/api/lessons/:id', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      kernelContainer.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(id);
      kernelContainer.db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(id);
      kernelContainer.db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(id);
      kernelContainer.db.prepare('DELETE FROM assignments WHERE lesson_id = ?').run(id);

      const result = kernelContainer.db.prepare('DELETE FROM lessons WHERE id = ?').run(id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 课程统计 API（删除确认弹窗用）───────────────────────────────────
  app.get('/api/lessons/:id/stats', (req, res) => {
    try {
      const { id } = req.params;

      const whiteboardCount = (kernelContainer.db.prepare(
        'SELECT COUNT(*) as count FROM whiteboard_elements WHERE lesson_id = ?'
      ).get(id) as any).count;

      const scheduleCount = (kernelContainer.db.prepare(
        'SELECT COUNT(*) as count FROM schedules WHERE lesson_id = ?'
      ).get(id) as any).count;

      const enrollmentCount = (kernelContainer.db.prepare(
        'SELECT COUNT(*) as count FROM student_lesson_progress WHERE lesson_id = ?'
      ).get(id) as any).count;

      const assignmentCount = (kernelContainer.db.prepare(
        'SELECT COUNT(*) as count FROM assignments WHERE lesson_id = ?'
      ).get(id) as any).count;

      res.json({ whiteboardCount, scheduleCount, enrollmentCount, assignmentCount });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 课程复制 API ─────────────────────────────────────────────────────
  app.post('/api/lessons/:id/clone', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;

      const original = kernelContainer.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as any;
      if (!original) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || 'usr_teacher';
      const newId = uuidv7();
      const now = Date.now();
      const newTitle = `副本-${original.title}`;

      kernelContainer.db.prepare(
        'INSERT INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newId, newTitle, original.content, original.timeline, original.progress_mode, original.progress_conditions, creatorId, now, now);

      const whiteboardElements = kernelContainer.db.prepare(
        'SELECT * FROM whiteboard_elements WHERE lesson_id = ?'
      ).all(id) as any[];

      const insertElement = kernelContainer.db.prepare(
        'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
      );

      for (const el of whiteboardElements) {
        insertElement.run(uuidv7(), newId, el.type, el.data, now);
      }

      const cloned = kernelContainer.db.prepare(`
        SELECT l.*, u.name as creator_name, 0 as enrollment_count 
        FROM lessons l 
        LEFT JOIN users u ON l.creator_id = u.id
        WHERE l.id = ?
      `).get(newId);

      res.json({ success: true, lesson: cloned });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // Fetch events stream
}
