import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ISemesterGradeServiceToken } from '../../packages/core/di/interfaces.js';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from '../../packages/plugins/ai-submit-injector.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { encryptApiKey, decryptApiKey, maskApiKey, detectPromptInjection } from '../utils/crypto.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from '../../packages/core/bootstrap/index.js';
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from '../../packages/activity-ecosystem/index.js';
import type { ServerContext, AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from '../context.js';
import { injectLmsSdk } from './shared.js';

export function registerLessonsRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/lessons', (req, res) => {
    const lessons = kernelContainer.db.prepare(`
      SELECT l.*, 
        (SELECT COUNT(*) FROM student_lesson_progress WHERE lesson_id = l.id) as enrollment_count
      FROM lessons l
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/lessons', async (req, res) => {
    try {
      const { title, content } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
         'lesson.create',
         { title, content },
         'user-frontend',
         { approved: true }
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/lessons/:id/timeline', async (req, res) => {
    try {
      const { id } = req.params;
      const { timeline } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
         'lesson.update_timeline',
         { lessonId: id, timeline },
         'user-frontend',
         { approved: true }
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/lessons/:id/progress-mode', async (req, res) => {
    try {
      const { id } = req.params;
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/lessons/:id/whiteboard', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-') && !checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: Only teachers can draw on classroom whiteboards' });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/lessons/:id/whiteboard/:elementId', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-') && !checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: Only teachers can update elements on classroom whiteboards' });
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
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/lessons/:id/whiteboard', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-') && !checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: Only teachers can clear the classroom whiteboard' });
      }
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.clear', {
        lessonId: id
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/lessons/:id/whiteboard/:elementId', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id.startsWith('assignment-') && !checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: Only teachers can delete elements from classroom whiteboards' });
      }
      const cmd = kernelContainer.commandBus.createCommand('whiteboard.delete', {
        lessonId: id,
        elementId: req.params.elementId
      }, 'user-frontend', { approved: true });
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch events stream
}
