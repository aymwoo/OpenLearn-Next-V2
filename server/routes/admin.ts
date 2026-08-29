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
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId, requireAuth } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from '../../packages/core/bootstrap/index.js';
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from '../../packages/activity-ecosystem/index.js';
import type { ServerContext, AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from '../context.js';
import { generateStudentNumber } from './shared.js';

export function registerAdminRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.post('/api/admin/seed-demo', requireAuth('administrator'), (req, res) => {
    try {
      const db = kernelContainer.db;
      const DEMO_CLASS_ID = 'demo-class';
      const DEMO_SCHEDULE_ID = 'demo-schedule';

      // Clean up any stray demo classes left by older (random-id) seed runs.
      const oldClasses = db
        .prepare("SELECT id FROM classes WHERE id LIKE 'demo-class-%' AND id != ?")
        .all(DEMO_CLASS_ID) as { id: string }[];
      for (const oc of oldClasses) {
        db.prepare('DELETE FROM class_students WHERE class_id = ?').run(oc.id);
        db.prepare("DELETE FROM schedules WHERE class_id = ?").run(oc.id);
        db.prepare('DELETE FROM classes WHERE id = ?').run(oc.id);
      }

      // 1. Demo class (reuse if already present)
      const existingClass = db.prepare('SELECT id FROM classes WHERE id = ?').get(DEMO_CLASS_ID);
      if (!existingClass) {
        db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
          DEMO_CLASS_ID, '人工智能与创意编程示范班', '这是系统初始化的示例课程班级，用于教学体验?', Date.now()
        );
      }

      // 2. Demo students (reuse by student_number to avoid UNIQUE collisions)
      const demoStudents = [
        { id: 'demo-s1', name: '小明', num: 'S001' },
        { id: 'demo-s2', name: '小红', num: 'S002' },
        { id: 'demo-s3', name: '小华', num: 'S003' },
        { id: 'demo-s4', name: '小丽', num: 'S004' },
        { id: 'demo-s5', name: '小强', num: 'S005' },
      ];
      const getStudentByNum = db.prepare('SELECT id FROM students WHERE student_number = ?');
      const insertStudent = db.prepare('INSERT INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)');
      const linkStudent = db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)');

      for (const s of demoStudents) {
        const row = getStudentByNum.get(s.num) as { id: string } | undefined;
        const studentId = row ? row.id : s.id;
        if (!row) {
          insertStudent.run(studentId, s.name, s.num, Date.now());
        }
        linkStudent.run(DEMO_CLASS_ID, studentId, Date.now());
      }

      // 3. Demo lesson (reuse first existing lesson, or create one)
      const lesson = db.prepare('SELECT id FROM lessons LIMIT 1').get() as any;
      let lessonId = lesson?.id;
      if (!lessonId) {
        lessonId = 'demo-lesson';
        db.prepare('INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
          lessonId, '初识 Python：智能白板创意编?', JSON.stringify({ elements: [] }), Date.now(), Date.now()
        );
      }

      // 4. Demo schedule (reuse if already present)
      const existingSchedule = db.prepare('SELECT id FROM schedules WHERE id = ?').get(DEMO_SCHEDULE_ID);
      if (!existingSchedule) {
        db.prepare('INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          DEMO_SCHEDULE_ID, DEMO_CLASS_ID, lessonId, new Date().toISOString().split('T')[0] + ' 09:00:00', 'scheduled', Date.now()
        );
      }

      res.json({ success: true, classId: DEMO_CLASS_ID, scheduleId: DEMO_SCHEDULE_ID, lessonId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Helper functions for student number auto-generation (S001 style)

  // Management APIs
  app.post('/api/classes/import', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { classes } = req.body;
      if (!classes || !Array.isArray(classes)) {
        return res.status(400).json({ error: 'Invalid payload: classes must be an array' });
      }

      const db = kernelContainer.db;
      
      const insertClass = db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)');
      const insertStudent = db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)');
      const insertClassStudent = db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)');
      const findStudentByEmail = db.prepare('SELECT id FROM students WHERE email = ?');

      const imported = [];

      for (const cls of classes) {
        const clsName = cls.name || cls.className;
        const clsDesc = cls.description || cls.classDescription || '';
        if (!clsName) continue;

        // Generate a random ID for the class
        const classId = Math.random().toString(36).slice(2);
        insertClass.run(classId, clsName, clsDesc, Date.now());

        const studentsList = cls.students || [];
        const importedStudents = [];

        for (const st of studentsList) {
          const stName = st.name || st.studentName;
          const stEmail = st.email || st.studentEmail || '';
          if (!stName) continue;

          let studentId = '';
          if (stEmail) {
            const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
            if (existing) {
              studentId = existing.id;
            }
          }

          if (!studentId) {
            studentId = Math.random().toString(36).slice(2);
            const studentNumber = generateStudentNumber(db) || `ST_${studentId}`;
            insertStudent.run(studentId, studentNumber, stName, stEmail, Date.now());
          }

          insertClassStudent.run(classId, studentId, Date.now());
          importedStudents.push({ id: studentId, name: stName, email: stEmail });
        }

        imported.push({
          id: classId,
          name: clsName,
          studentsCount: importedStudents.length
        });
      }

      res.json({ success: true, imported });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/students/import', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { students } = req.body;
      if (!students || !Array.isArray(students)) {
        return res.status(400).json({ error: 'Invalid payload: students must be an array' });
      }

      const db = kernelContainer.db;
      const insertStudent = db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)');
      const findStudentByEmail = db.prepare('SELECT id FROM students WHERE email = ?');

      const imported = [];
      for (const st of students) {
        const stName = st.name;
        const stEmail = st.email || '';
        const stNum = st.student_number || '';
        if (!stName) continue;

        let studentId = '';
        if (stEmail) {
          const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
          if (existing) {
            studentId = existing.id;
          }
        }

        if (!studentId) {
          studentId = Math.random().toString(36).slice(2);
          const finalNum = stNum && stNum.trim() !== '' ? stNum.trim() : `ST_${studentId}`;
          insertStudent.run(studentId, finalNum, stName, stEmail, Date.now());
          imported.push({ id: studentId, student_number: finalNum, name: stName, email: stEmail, new: true });
        } else {
          imported.push({ id: studentId, name: stName, email: stEmail, new: false });
        }
      }

      res.json({ success: true, imported });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

}
