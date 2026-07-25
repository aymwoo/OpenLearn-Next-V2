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

export function registerCoursewareRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.post('/api/courseware/upload', async (req, res) => {
    try {
      const { name, filename, base64Data } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('courseware.upload', { name, filename, base64Data }, 'teacher-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/courseware/confirm', async (req, res) => {
    try {
      const { uuid, name, entry } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('courseware.confirm', { uuid, name, entry }, 'teacher-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/courseware', async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('courseware.list', {}, 'teacher-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/courseware/:id', async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('courseware.delete', { id: req.params.id }, 'teacher-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  function extractScoreCommentCompletion(payload: any) {
    let score: any = undefined;
    let comment: any = undefined;
    let completion: any = undefined;

    const keysToSearch = {
      score: ['score', 'grade', 'result', 'point', 'points', 'mark', 'marks', 'score_val', 'scoreval'],
      comment: ['comment', 'feedback', 'msg', 'message', 'text', 'note', 'memo'],
      completion: ['completion', 'progress', 'done', 'finished', 'completed', 'percentage']
    };

    const searchObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      
      for (const key in obj) {
        const lowerKey = key.toLowerCase();
        
        if (keysToSearch.score.includes(lowerKey) && score === undefined) {
          score = obj[key];
        }
        if (keysToSearch.comment.includes(lowerKey) && comment === undefined) {
          comment = obj[key];
        }
        if (keysToSearch.completion.includes(lowerKey) && completion === undefined) {
          completion = obj[key];
        }
      }

      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          for (const subKey in obj[key]) {
            const lowerSubKey = subKey.toLowerCase();
            if (keysToSearch.score.includes(lowerSubKey) && score === undefined) {
              score = obj[key][subKey];
            }
            if (keysToSearch.comment.includes(lowerSubKey) && comment === undefined) {
              comment = obj[key][subKey];
            }
            if (keysToSearch.completion.includes(lowerSubKey) && completion === undefined) {
              completion = obj[key][subKey];
            }
          }
        }
      }
    };

    if (payload && typeof payload === 'object') {
      searchObj(payload);

      const urlString = payload.url || payload.action || '';
      if (typeof urlString === 'string' && urlString.includes('?')) {
        try {
          const queryPart = urlString.split('?')[1];
          const params = new URLSearchParams(queryPart);
          const queryObj: any = {};
          params.forEach((value, key) => {
            queryObj[key] = value;
          });
          searchObj(queryObj);
        } catch (e) {}
      }

      const bodyOrData = payload.data || payload.body;
      if (bodyOrData) {
        if (typeof bodyOrData === 'object') {
          searchObj(bodyOrData);
        } else if (typeof bodyOrData === 'string') {
          let parsed = null;
          try {
            parsed = JSON.parse(bodyOrData);
          } catch (e) {
            try {
              const params = new URLSearchParams(bodyOrData);
              const formObj: any = {};
              let hasKeys = false;
              params.forEach((value, key) => {
                formObj[key] = value;
                hasKeys = true;
              });
              if (hasKeys) {
                parsed = formObj;
              }
            } catch (e2) {}
          }
          if (parsed && typeof parsed === 'object') {
            searchObj(parsed);
          }
        }
      }
    }

    return { score, comment, completion };
  }

  app.post('/api/courseware/attempts/:attemptId/log', (req, res) => {
    try {
      const { attemptId } = req.params;
      const { eventType, payload } = req.body;
      
      const rawId = 'raw_' + crypto.randomBytes(8).toString('hex');
      kernelContainer.db.prepare(
        'INSERT INTO submission_raw (id, attempt_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(rawId, attemptId, eventType, JSON.stringify(payload), Date.now());

      const extracted = extractScoreCommentCompletion(payload);
      const score = extracted.score;
      const comment = extracted.comment;
      const completion = extracted.completion;

      if (score !== undefined || comment !== undefined || completion !== undefined) {
        let parsedScore: number | null = null;
        if (score !== undefined && score !== null) {
          const num = parseFloat(score);
          if (!isNaN(num)) {
            parsedScore = num;
          }
        }
        let parsedCompletion: number | null = null;
        if (completion !== undefined && completion !== null) {
          const num = parseFloat(completion);
          if (!isNaN(num)) {
            parsedCompletion = num;
          }
        }
        
        const existing = kernelContainer.db.prepare('SELECT * FROM submission_result WHERE attempt_id = ?').get(attemptId) as any;
        if (!existing) {
          kernelContainer.db.prepare(
            'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            'res_' + crypto.randomBytes(8).toString('hex'),
            attemptId,
            parsedScore,
            comment || null,
            parsedCompletion,
            JSON.stringify(payload)
          );
        } else {
          const finalScore = parsedScore !== null ? parsedScore : existing.score;
          const finalComment = comment || existing.comment;
          const finalCompletion = parsedCompletion !== null ? parsedCompletion : existing.completion;
          
          let mergedExtra = {};
          try {
            mergedExtra = JSON.parse(existing.extra_json || '{}');
          } catch (e) {}
          if (payload && typeof payload === 'object') {
            mergedExtra = { ...mergedExtra, ...payload };
          }

          kernelContainer.db.prepare(
            'UPDATE submission_result SET score = ?, comment = ?, completion = ?, extra_json = ? WHERE attempt_id = ?'
          ).run(finalScore, finalComment, finalCompletion, JSON.stringify(mergedExtra), attemptId);
        }
      }

      io.emit('courseware-attempt-updated', { attemptId, type: 'log' });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/courseware/attempts/:attemptId/submit', async (req, res) => {
    try {
      const { attemptId } = req.params;
      let { score, comment, completion, status, extra = {} } = req.body;

      const extracted = extractScoreCommentCompletion({ ...req.body, ...extra });
      if (score === undefined || score === null) score = extracted.score;
      if (comment === undefined || comment === null) comment = extracted.comment;
      if (completion === undefined || completion === null) completion = extracted.completion;

      let parsedScore: number | null = null;
      if (score !== undefined && score !== null) {
        const num = parseFloat(score);
        if (!isNaN(num)) {
          parsedScore = num;
        }
      }
      let parsedCompletion: number | null = null;
      if (completion !== undefined && completion !== null) {
        const num = parseFloat(completion);
        if (!isNaN(num)) {
          parsedCompletion = num;
        }
      }

      const cmd = kernelContainer.commandBus.createCommand('courseware.submit_attempt', {
        attemptId,
        score: parsedScore,
        comment,
        completion: parsedCompletion,
        status,
        extra
      }, 'student-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      io.emit('courseware-attempt-updated', { attemptId, type: 'submit' });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/courseware/attempts', (req, res) => {
    try {
      const rows = kernelContainer.db.prepare(`
        SELECT a.id as attemptId, a.started_at, a.finished_at, a.status, 
               cw.name as coursewareName, cw.uuid as coursewareUuid,
               COALESCE(s.name, CASE WHEN a.student_id = 'teacher' THEN 'Teacher (Test)' WHEN a.student_id = 'guest' THEN 'Guest Student' ELSE a.student_id END) as studentName,
               a.student_id as studentId,
               r.score, r.comment, r.completion, r.extra_json,
               (
                 SELECT COUNT(*) FROM assignment_submissions sub
                 JOIN assignments ast ON sub.assignment_id = ast.id
                 WHERE sub.student_id = a.student_id 
                   AND ast.title = '互动课件: ' || cw.name
               ) as isPromoted
        FROM courseware_attempt a
        JOIN courseware cw ON a.courseware_id = cw.id
        LEFT JOIN students s ON a.student_id = s.id
        LEFT JOIN submission_result r ON a.id = r.attempt_id
        ORDER BY a.started_at DESC
      `).all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/courseware/debug', (req, res) => {
    try {
      const { msg, url, student, courseware } = req.body;
      const logMsg = `[CLIENT DEBUG] ${msg} | URL: ${url} | Student: ${JSON.stringify(student)} | Courseware: ${JSON.stringify(courseware)}`;
      console.log(`\x1b[35m[CLIENT DEBUG]\x1b[0m ${msg}`);
      
      const logFile = path.join(process.cwd(), 'client_debug.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} - ${logMsg}\n`);
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/courseware/attempts/:attemptId/raw', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const cmd = kernelContainer.commandBus.createCommand('courseware.get_attempt_raw_data', { attemptId }, 'teacher-demo');
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/courseware/attempts/:attemptId/promote', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { lessonId, classId } = req.body;

      if (!lessonId || !classId) {
        return res.status(400).json({ error: 'Missing lessonId or classId' });
      }

      const attempt = kernelContainer.db.prepare(`
        SELECT a.*, cw.name as courseware_name, cw.uuid as courseware_uuid,
               r.score, r.comment, r.completion, r.extra_json
        FROM courseware_attempt a
        JOIN courseware cw ON a.courseware_id = cw.id
        LEFT JOIN submission_result r ON a.id = r.attempt_id
        WHERE a.id = ?
      `).get(attemptId) as any;

      if (!attempt) {
        return res.status(404).json({ error: 'Attempt not found' });
      }

      const studentId = attempt.student_id;
      const coursewareName = attempt.courseware_name || '互动课件';
      const rawScore = attempt.score;
      const completion = attempt.completion || 0;

      let finalScore = 100;
      if (rawScore !== null && rawScore !== undefined) {
        if (rawScore >= 0 && rawScore <= 1.0 && rawScore !== 0) {
          finalScore = Math.round(rawScore * 100);
        } else {
          finalScore = Math.round(rawScore);
        }
      }

      const assignmentTitle = `互动课件: ${coursewareName}`;
      let assignment = kernelContainer.db.prepare(
        'SELECT id FROM assignments WHERE class_id = ? AND lesson_id = ? AND title = ?'
      ).get(classId, lessonId, assignmentTitle) as any;

      let assignmentId = assignment?.id;
      if (!assignmentId) {
        assignmentId = 'ast-cw-' + crypto.randomBytes(8).toString('hex');
        kernelContainer.db.prepare(
          'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          assignmentId,
          classId,
          lessonId,
          assignmentTitle,
          `来自互动课件 [${coursewareName}] 的随堂学习提交数据记录`,
          JSON.stringify({ type: 'interactive_courseware', attemptId, coursewareUuid: attempt.courseware_uuid }),
          Date.now()
        );
      }

      kernelContainer.db.prepare(`
        INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'graded')
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET
          content = excluded.content,
          score = excluded.score,
          feedback = excluded.feedback,
          submitted_at = excluded.submitted_at,
          graded_at = excluded.graded_at,
          status = 'graded'
      `).run(
        assignmentId,
        studentId,
        attempt.extra_json || '{}',
        finalScore,
        `由教师在课堂中保存录入。课件完成度: ${Math.round(completion * 100)}%。课件原始反�?: ${attempt.comment || '�?'}`,
        Date.now(),
        Date.now()
      );

      kernelContainer.db.prepare(`
        INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
        VALUES (?, ?, 1, 100, '[]', ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = 1,
          progress_percent = 100
      `).run(
        studentId,
        lessonId,
        Date.now()
      );

      io.emit('student-progress-updated', {
        studentId,
        lessonId,
        progressPercent: 100,
        completed: true,
        completedSegments: []
      });

      res.json({ success: true, assignmentId, score: finalScore });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/courseware/:id', (req, res) => {
    try {
      const node = kernelContainer.db.prepare('SELECT * FROM vfs_nodes WHERE id = ?').get(req.params.id) as any;
      if (!node || node.type !== 'file') return res.status(404).send('Courseware not found');
      
      const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(node.id);
      if (!existingCw) {
        kernelContainer.db.prepare(
          'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(node.id, node.id, node.name, 'html', node.name, Date.now());
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const html = injectLmsSdk(node.content || '', req, { id: node.id, name: node.name, uuid: node.id });
      res.send(html);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });
}
