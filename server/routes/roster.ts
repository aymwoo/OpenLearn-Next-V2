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
import { validateMagicBytes, BLOCKED_EXTENSIONS, generateStudentNumber } from './shared.js';

export function registerRosterRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/classes', (req, res) => {
    try {
      const classes = kernelContainer.db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM class_students WHERE class_id = c.id) AS student_count,
          (SELECT COUNT(*) FROM schedules WHERE class_id = c.id) AS course_count,
          (SELECT COUNT(*) FROM assignments WHERE class_id = c.id) AS assignment_count
        FROM classes c
        ORDER BY created_at DESC
      `).all();
      res.json(classes);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/students', (req, res) => {
    try {
      const students = kernelContainer.db.prepare('SELECT * FROM students ORDER BY created_at DESC').all();
      res.json(students);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:id/students', (req, res) => {
    try {
      const students = kernelContainer.db.prepare(`
        SELECT s.* FROM students s
        INNER JOIN class_students cs ON s.id = cs.student_id
        WHERE cs.class_id = ?
        ORDER BY cs.joined_at DESC
      `).all(req.params.id);
      res.json(students);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes', (req, res) => {
    try {
      const { name, description } = req.body;
      const classId = Math.random().toString(36).slice(2);
      kernelContainer.db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
        classId, name, description || '', Date.now()
      );
      res.json({ success: true, id: classId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/classes/:id', (req, res) => {
    try {
      const { name, description, class_passcode } = req.body;
      if (name) kernelContainer.db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, req.params.id);
      if (description !== undefined) kernelContainer.db.prepare('UPDATE classes SET description = ? WHERE id = ?').run(description, req.params.id);
      if (class_passcode !== undefined) kernelContainer.db.prepare('UPDATE classes SET class_passcode = ? WHERE id = ?').run(class_passcode, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/classes/:id', (req, res) => {
    try {
      const classId = req.params.id;
      const db = kernelContainer.db;
      
      const deleteTransaction = db.transaction(() => {
        // 1. Get all students in the class
        const students = db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as { student_id: string }[];
        
        // 2. Delete students and all their data
        const deleteStudentStmt = db.prepare('DELETE FROM students WHERE id = ?');
        const deleteClassStudentByStudentStmt = db.prepare('DELETE FROM class_students WHERE student_id = ?');
        const deleteProgressStmt = db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?');
        const deleteSubmissionsByStudentStmt = db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?');
        const deleteAttendanceByStudentStmt = db.prepare('DELETE FROM attendance WHERE student_id = ?');
        const deleteSeatsByStudentStmt = db.prepare('DELETE FROM student_seats WHERE student_id = ?');
        const deleteReadNotificationsStmt = db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?');
        const deleteRollcallsByStudentStmt = db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?');
        
        for (const s of students) {
          deleteStudentStmt.run(s.student_id);
          deleteClassStudentByStudentStmt.run(s.student_id);
          deleteProgressStmt.run(s.student_id);
          deleteSubmissionsByStudentStmt.run(s.student_id);
          deleteAttendanceByStudentStmt.run(s.student_id);
          deleteSeatsByStudentStmt.run(s.student_id);
          deleteReadNotificationsStmt.run(s.student_id);
          try {
            deleteRollcallsByStudentStmt.run(s.student_id);
          } catch (e) {}
        }
        
        // 3. Delete class-related data
        db.prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)').run(classId);
        db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
        db.prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)').run(classId);
        db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
        db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(classId);
        try {
          db.prepare('DELETE FROM student_rollcalls WHERE class_id = ?').run(classId);
        } catch (e) {}
        db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
        db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      });
      
      deleteTransaction();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- AUTHENTICATION & TEACHER USER ACCOUNTS APIS ---
  // getCookieToken is now defined earlier to be used by whiteboard endpoints

  app.get('/api/db-status', (req, res) => {
    try {
      const startTime = performance.now();
      const result = kernelContainer.db.prepare('SELECT 1 as alive').get() as any;
      if (result && result.alive === 1) {
        // Query SQLite inner structure variables
        const pageSizeObj = kernelContainer.db.prepare('PRAGMA page_size').get() as any;
        const pageCountObj = kernelContainer.db.prepare('PRAGMA page_count').get() as any;
        const journalModeObj = kernelContainer.db.prepare('PRAGMA journal_mode').get() as any;
        const autoVacuumObj = kernelContainer.db.prepare('PRAGMA auto_vacuum').get() as any;
        const integrityObj = kernelContainer.db.prepare('PRAGMA integrity_check').get() as any;
        const freelistCountObj = kernelContainer.db.prepare('PRAGMA freelist_count').get() as any;

        const pageSize = pageSizeObj ? (pageSizeObj.page_size ?? pageSizeObj['page_size'] ?? 4096) : 4096;
        const pageCount = pageCountObj ? (pageCountObj.page_count ?? pageCountObj['page_count'] ?? 0) : 0;
        const journalMode = journalModeObj ? (journalModeObj.journal_mode ?? journalModeObj['journal_mode'] ?? 'N/A') : 'N/A';
        const autoVacuum = autoVacuumObj ? (autoVacuumObj.auto_vacuum ?? autoVacuumObj['auto_vacuum'] ?? 0) : 0;
        const integrity = integrityObj ? (integrityObj.integrity_check ?? integrityObj['integrity_check'] ?? 'ok') : 'ok';
        const freelistCount = freelistCountObj ? (freelistCountObj.freelist_count ?? freelistCountObj['freelist_count'] ?? 0) : 0;
        
        const diskUsageBytes = pageSize * pageCount;
        const sizeMb = parseFloat((diskUsageBytes / (1024 * 1024)).toFixed(3));
        
        // Friendly bytes converter
        const formatBytes = (bytes: number) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        const diskUsageFriendly = formatBytes(diskUsageBytes);

        // Fetch tables listed in sqlite_master catalogs
        const tables = kernelContainer.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
        const coreTables = tables.filter((t: any) => !t.name.startsWith('sqlite_') && t.name !== 'sqlite_sequence');
        const systemTablesCount = tables.length - coreTables.length;

        const tableDetails = coreTables.map((t: any) => {
          try {
            const countObj = kernelContainer.db.prepare(`SELECT count(*) as cnt FROM ${t.name}`).get() as any;
            return { name: t.name, rows: countObj ? (countObj.cnt ?? countObj.count ?? 0) : 0 };
          } catch (err) {
            return { name: t.name, rows: -1 };
          }
        });

        const totalRows = tableDetails.reduce((sum, item) => sum + (item.rows > 0 ? item.rows : 0), 0);
        const latencyMs = parseFloat((performance.now() - startTime).toFixed(3));

        return res.json({
          status: 'connected',
          type: 'sqlite',
          timestamp: Date.now(),
          pageSize,
          pageCount,
          diskUsageBytes,
          diskUsageFriendly,
          sizeMb,
          tableCount: coreTables.length,
          systemTableCount: systemTablesCount,
          journalMode,
          autoVacuum,
          integrity,
          freelistCount,
          tables: tableDetails,
          totalRows,
          latencyMs
        });
      }
      return res.status(500).json({ status: 'disconnected', error: 'Unexpected response from SQLite' });
    } catch (e: any) {
      return res.status(500).json({ status: 'disconnected', error: e.message });
    }
  });

  app.get('/api/auth/session', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) {
        return res.json({ session: null });
      }
      // SEC-AUTH-03: 使用 getValidSession 自动检查过�?
      const session = getValidSession(token);
      if (!session) {
        return res.json({ session: null });
      }
      res.json({ session });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (token) {
        kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
      }
      res.setHeader('Set-Cookie', `edu_os_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SEC-AUTH-05: 学生自助密码修改
  app.post('/api/auth/change-password', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const session = getValidSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Session expired' });
      }
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Both old and new passwords are required' });
      }
      // 密码强度验证
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }
      if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return res.status(400).json({ error: 'Password must contain both letters and numbers' });
      }

      if (session.role === 'teacher' || session.role === 'administrator') {
        const userObj = kernelContainer.db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as any;
        if (!userObj) {
          return res.status(404).json({ error: 'User not found' });
        }
        const { valid } = verifyPassword(oldPassword, userObj.password_hash);
        if (!valid) {
          return res.status(401).json({ error: 'Incorrect old password' });
        }
        kernelContainer.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.userId);
        // 使该用户所有其�? session 失效
        kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?')
          .run(token, `%${session.userId}%`);
        return res.json({ success: true, message: 'Password changed. All other devices have been logged out.' });
      }

      if (session.role === 'student') {
        const studentObj = kernelContainer.db.prepare('SELECT * FROM students WHERE id = ?').get(session.studentId) as any;
        if (!studentObj) {
          return res.status(404).json({ error: 'Student not found' });
        }
        const storedPwd = studentObj.password || '';
        let matches = false;
        if (storedPwd.startsWith('$2')) {
          matches = bcrypt.compareSync(oldPassword, storedPwd);
        } else if (/^[a-f0-9]{64}$/.test(storedPwd)) {
          matches = crypto.createHash('sha256').update(oldPassword).digest('hex') === storedPwd;
        } else {
          matches = storedPwd === oldPassword;
        }
        if (!matches) {
          return res.status(401).json({ error: 'Incorrect old password' });
        }
        kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.studentId);
        // 使该学生所有其�? session 失效
        kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?')
          .run(token, `%${session.studentId}%`);
        return res.json({ success: true, message: 'Password changed. All other devices have been logged out.' });
      }

      res.status(400).json({ error: 'Unsupported role' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P7 Step2: �Է���������ϸ��£�����ʾ���� name���޶���ǰ��¼�û���������ֹ�Ľ�ɫ/����/�˺ţ�
  app.post('/api/auth/profile', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const session = getValidSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired' });

      const rawName = (req.body && req.body.name) || '';
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) return res.status(400).json({ error: 'Display name is required' });
      if (name.length > 50) return res.status(400).json({ error: 'Display name too long (max 50)' });

      if (session.role === 'student') {
        if (!session.studentId) return res.status(400).json({ error: 'Invalid student session' });
        kernelContainer.db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, session.studentId);
      } else {
        // teacher �� administrator(subRole) ������ users ������ session.userId ��������
        if (!session.userId) return res.status(400).json({ error: 'Invalid user session' });
        kernelContainer.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, session.userId);
      }

      // ͬ����ǰ session_data �� name������ͬԴ�������������ֵ
      try {
        const row = kernelContainer.db.prepare('SELECT session_data FROM client_sessions WHERE id = ?').get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.name = name;
          kernelContainer.db.prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?').run(JSON.stringify(data), token);
        }
      } catch {
        /* session_data ͬ���ǹؼ�·�� */
      }

      res.json({ success: true, name });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P7/Profile: ����ͷ���ϴ���base64 ͼƬ������ uploads/avatars/��
  app.post('/api/auth/avatar', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const session = getValidSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired' });

      const { filename, base64Data } = req.body || {};
      if (!filename || !base64Data) {
        return res.status(400).json({ error: 'Filename and base64Data are required' });
      }

      const ext = path.extname(filename).toLowerCase();
      const ALLOWED_IMG = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      if (BLOCKED_EXTENSIONS.includes(ext) || !ALLOWED_IMG.includes(ext)) {
        return res.status(400).json({ error: 'Only image files (jpg / png / gif / webp) are allowed' });
      }

      const base64Content = String(base64Data).replace(/^data:[^;]+;base64,/, '');
      const fileBuffer = Buffer.from(base64Content, 'base64');
      if (fileBuffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Avatar image must be smaller than 2MB' });
      }
      if (!validateMagicBytes(fileBuffer, filename)) {
        return res.status(400).json({ error: 'File content does not match the declared image type' });
      }

      const avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
      fs.mkdirSync(avatarDir, { recursive: true });
      const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(avatarDir, uniqueName);
      fs.writeFileSync(filePath, fileBuffer);
      const avatarUrl = `/uploads/avatars/${uniqueName}`;

      // ��ȡ��ɾ����ͷ���ļ�������¶��ļ���
      let oldAvatar: string | null = null;
      if (session.role === 'student') {
        const row = kernelContainer.db.prepare('SELECT avatar FROM students WHERE id = ?').get(session.studentId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE students SET avatar = ? WHERE id = ?').run(avatarUrl, session.studentId);
      } else {
        const row = kernelContainer.db.prepare('SELECT avatar FROM users WHERE id = ?').get(session.userId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, session.userId);
      }
      if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
        try { fs.unlinkSync(path.join(process.cwd(), oldAvatar)); } catch { /* ignore */ }
      }

      // ͬ����ǰ session_data.avatar
      try {
        const row = kernelContainer.db.prepare('SELECT session_data FROM client_sessions WHERE id = ?').get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.avatar = avatarUrl;
          kernelContainer.db.prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?').run(JSON.stringify(data), token);
        }
      } catch { /* session_data ͬ���ǹؼ�·�� */ }

      res.json({ success: true, avatar: avatarUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P7/Profile: �Ƴ�����ͷ��
  app.delete('/api/auth/avatar', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const session = getValidSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired' });

      let oldAvatar: string | null = null;
      if (session.role === 'student') {
        const row = kernelContainer.db.prepare('SELECT avatar FROM students WHERE id = ?').get(session.studentId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE students SET avatar = NULL WHERE id = ?').run(session.studentId);
      } else {
        const row = kernelContainer.db.prepare('SELECT avatar FROM users WHERE id = ?').get(session.userId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(session.userId);
      }
      if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
        try { fs.unlinkSync(path.join(process.cwd(), oldAvatar)); } catch { /* ignore */ }
      }

      try {
        const row = kernelContainer.db.prepare('SELECT session_data FROM client_sessions WHERE id = ?').get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.avatar = null;
          kernelContainer.db.prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?').run(JSON.stringify(data), token);
        }
      } catch { /* session_data ͬ���ǹؼ�·�� */ }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    try {
      const { entrance, username, password, studentId } = req.body;
      let sessionData: any = null;

      if (entrance === 'teacher') {
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' });
        }
        const userObj = kernelContainer.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
        if (!userObj) {
          return res.status(401).json({ error: 'User not found' });
        }
        if (userObj.status === 'disabled') {
          return res.status(403).json({ error: 'Your account has been disabled. Please contact the administrator.' });
        }
        // SEC-AUTH-02: bcrypt 验证 + �? SHA-256 自动升级
        const { valid, needsUpgrade } = verifyPassword(password, userObj.password_hash);
        if (!valid) {
          return res.status(401).json({ error: 'Incorrect password' });
        }
        if (needsUpgrade) {
          const newHash = bcryptHashPassword(password);
          kernelContainer.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .run(newHash, userObj.id);
          console.log(`[Auth] Auto-upgraded password hash for user ${userObj.username}`);
        }
        sessionData = {
          role: 'teacher',
          userId: userObj.id,
          username: userObj.username,
          subRole: userObj.role,
          name: userObj.name,
          avatar: userObj.avatar ?? null
        };
      } else if (entrance === 'student') {
        if (!studentId) {
          return res.status(400).json({ error: 'Student ID is required' });
        }
        const studentObj = kernelContainer.db.prepare('SELECT * FROM students WHERE student_number = ? OR id = ?').get(studentId, studentId) as any;
        if (!studentObj) {
          return res.status(401).json({ error: 'Student not found in active roster' });
        }

        const providedPassword = (password || '').trim();
        if (!providedPassword) {
          return res.status(400).json({ error: 'Password or Class Passcode is required' });
        }

        // SEC-AUTH-01: bcrypt 验证 + 旧明�?/旧哈希自动升�?
        let matchesOwnPassword = false;
        const storedPwd = studentObj.password || '';

        // bcrypt 哈希�? $2a$ / $2b$ / $2y$ 开�?
        if (storedPwd.startsWith('$2')) {
          matchesOwnPassword = bcrypt.compareSync(providedPassword, storedPwd);
        }
        // �? SHA-256 哈希�?64 �? hex�?
        else if (/^[a-f0-9]{64}$/.test(storedPwd)) {
          const sha256Hash = crypto.createHash('sha256').update(providedPassword).digest('hex');
          if (sha256Hash === storedPwd) {
            matchesOwnPassword = true;
            // 自动升级�? bcrypt
            kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
              .run(bcryptHashPassword(providedPassword), studentObj.id);
            console.log(`[Auth] Auto-upgraded password hash for student ${studentObj.student_number || studentObj.id}`);
          }
        }
        // 旧明文密�?
        else if (storedPwd === providedPassword) {
          matchesOwnPassword = true;
          // 自动升级�? bcrypt
          kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
            .run(bcryptHashPassword(providedPassword), studentObj.id);
          console.log(`[Auth] Auto-upgraded plaintext password to bcrypt for student ${studentObj.student_number || studentObj.id}`);
        }

        // 2. Check temporary class passcodes for classes the student is enrolled in
        let matchesClassPasscode = false;
        if (!matchesOwnPassword) {
          try {
            const enrolledClasses = kernelContainer.db.prepare(`
              SELECT c.class_passcode
              FROM classes c
              INNER JOIN class_students cs ON c.id = cs.class_id
              WHERE cs.student_id = ?
            `).all(studentObj.id) as any[];

            matchesClassPasscode = enrolledClasses.some(cls =>
              cls.class_passcode && cls.class_passcode.trim() === providedPassword
            );
          } catch (dbErr) {
            console.error("Failed to query active class passcodes", dbErr);
          }
        }

        if (!matchesOwnPassword && !matchesClassPasscode) {
          return res.status(401).json({ error: 'Incorrect student password or temporary class passcode' });
        }

        sessionData = {
          role: 'student',
          studentId: studentObj.id,
          name: studentObj.name,
          email: studentObj.email,
          avatar: studentObj.avatar ?? null
        };
      }

      if (sessionData) {
        const sessionToken = 'token_' + crypto.randomBytes(16).toString('hex');
        // SEC-AUTH-03: session 添加 expires_at�?24小时空闲 + 7天绝对）
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 天绝对过�?
        kernelContainer.db.prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
          .run(sessionToken, JSON.stringify(sessionData), now, expiresAt);

        // 生产环境�? HTTP，不�? Secure 标志（否则浏览器拒绝存储�?
        res.setHeader('Set-Cookie', `edu_os_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
        return res.json({
          success: true,
          session: sessionData
        });
      }
      res.status(400).json({ error: 'Unsupported entry type' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- STUDENT READ NOTIFICATIONS APIS ---
  app.get('/api/students/:id/read_notifications', (req, res) => {
    try {
      const rows = kernelContainer.db.prepare('SELECT notification_id FROM student_read_notifications WHERE student_id = ?').all(req.params.id) as any[];
      res.json(rows.map(r => r.notification_id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/students/:id/read_notifications', (req, res) => {
    try {
      const { notificationId } = req.body;
      if (!notificationId) {
        return res.status(400).json({ error: 'notificationId is required' });
      }
      kernelContainer.db.prepare('INSERT OR IGNORE INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)')
        .run(req.params.id, notificationId);
      
      io.emit('student-acknowledged', {
        studentId: req.params.id,
        notificationId
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:classId/lock_lesson', (req, res) => {
    try {
      const { lessonId } = req.body;
      if (!lessonId) {
        return res.status(400).json({ error: 'lessonId is required' });
      }
      kernelContainer.db.prepare('UPDATE students SET locked_lesson_id = ? WHERE id IN (SELECT student_id FROM class_students WHERE class_id = ?)')
        .run(lessonId, req.params.classId);
      
      io.emit('class-lock-status-changed', {
        classId: req.params.classId,
        lessonId,
        locked: true
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  app.post('/api/classes/:classId/unlock_lesson', (req, res) => {
    try {
      kernelContainer.db.prepare('UPDATE students SET locked_lesson_id = NULL WHERE id IN (SELECT student_id FROM class_students WHERE class_id = ?)')
        .run(req.params.classId);
      
      io.emit('class-lock-status-changed', {
        classId: req.params.classId,
        locked: false
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  app.get('/api/users', requireAuth('administrator'), async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('user.list', {}, getActorId(req));
      const users = await kernelContainer.commandBus.execute(cmd);
      res.json(users);
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  app.post('/api/users', requireAuth('administrator'), async (req, res) => {
    try {
      const { username, password, role, name, status = 'active' } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('user.create', {
        username,
        password,
        role,
        name,
        status
      }, getActorId(req));
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  app.put('/api/users/:id', requireAuth('administrator'), async (req, res) => {
    try {
      const { username, role, name, password, status } = req.body;
      const cmd = kernelContainer.commandBus.createCommand('user.update', {
        userId: req.params.id,
        username,
        role,
        name,
        password,
        status
      }, getActorId(req));
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  app.delete('/api/users/:id', requireAuth('administrator'), async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('user.delete', {
        userId: req.params.id
      }, getActorId(req));
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      res.status(550).json({ error: e.message });
    }
  });

  // --- COMPUTER LABS AND SEATING APIS ---
  app.get('/api/labs', (req, res) => {
    try {
      const labs = kernelContainer.db.prepare('SELECT * FROM computer_labs ORDER BY created_at DESC').all();
      res.json(labs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/labs', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { room_number, rows, cols } = req.body;
      const id = 'lab_' + Math.random().toString(36).slice(2, 10);
      kernelContainer.db.prepare(
        'INSERT INTO computer_labs (id, room_number, rows, cols, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, room_number, parseInt(rows), parseInt(cols), Date.now());
      res.json({ success: true, id, room_number, rows, cols });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/labs/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { room_number, rows, cols } = req.body;
      kernelContainer.db.prepare(
        'UPDATE computer_labs SET room_number = ?, rows = ?, cols = ? WHERE id = ?'
      ).run(room_number, parseInt(rows), parseInt(cols), req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/labs/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM computer_labs WHERE id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_seats WHERE lab_id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:classId/seats', (req, res) => {
    try {
      const classInfo = kernelContainer.db.prepare('SELECT lab_id FROM classes WHERE id = ?').get(req.params.classId) as any;
      const labId = classInfo ? classInfo.lab_id : null;
      
      const seats = kernelContainer.db.prepare('SELECT * FROM student_seats WHERE class_id = ?').all(req.params.classId);
      res.json({ lab_id: labId, seats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:classId/seats', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lab_id, seats } = req.body;
      
      kernelContainer.db.prepare('UPDATE classes SET lab_id = ? WHERE id = ?').run(lab_id || null, req.params.classId);
      kernelContainer.db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(req.params.classId);
      
      if (lab_id && Array.isArray(seats)) {
        const insertStmt = kernelContainer.db.prepare(
          'INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)'
        );
        for (const s of seats) {
          insertStmt.run(req.params.classId, s.student_id, lab_id, s.row_idx, s.col_idx);
        }
      }
      
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  // --------------------------------------

  app.post('/api/students', (req, res) => {
    try {
      const { name, email, password, student_number } = req.body;
      const studentId = Math.random().toString(36).slice(2);
      
      let finalNum = student_number && student_number.trim() !== '' ? student_number.trim() : '';
      if (!finalNum) {
        finalNum = generateStudentNumber(kernelContainer.db);
      }

      // SEC-AUTH-01: 使用 bcrypt 哈希存储学生密码
      const hashedPassword = password && password.trim() !== '' && password !== '123456'
        ? bcryptHashPassword(password)
        : bcryptHashPassword('123456');
      kernelContainer.db.prepare('INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        studentId, finalNum, name, email || '', hashedPassword, Date.now()
      );
      res.json({ success: true, id: studentId, student_number: finalNum, tempPassword: password || '123456' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/students/:id', (req, res) => {
    try {
      const { name, email, password, locked_lesson_id, private_notes, student_number } = req.body;
      if (name) kernelContainer.db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, req.params.id);
      if (email !== undefined) kernelContainer.db.prepare('UPDATE students SET email = ? WHERE id = ?').run(email, req.params.id);
      if (password !== undefined) {
        // SEC-AUTH-01: 更新�? bcrypt 哈希
        const hashed = password.trim() !== '' ? bcryptHashPassword(password) : password;
        kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?').run(hashed, req.params.id);
      }
      if (locked_lesson_id !== undefined) kernelContainer.db.prepare('UPDATE students SET locked_lesson_id = ? WHERE id = ?').run(locked_lesson_id, req.params.id);
      if (private_notes !== undefined) kernelContainer.db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(private_notes, req.params.id);
      if (student_number !== undefined) kernelContainer.db.prepare('UPDATE students SET student_number = ? WHERE id = ?').run(student_number, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/students/:id', (req, res) => {
    try {
      // 完整级联删除，与 gdpr-delete 保持一致，避免残留孤儿数据
      kernelContainer.db.prepare('DELETE FROM class_students WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM exam_scores WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_semester_reports WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM plugin_submissions WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM plugin_peer_reviews WHERE reviewer_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_seats WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?').run(req.params.id);
      kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SEC-DATA-02: GDPR 学生数据导出
  app.get('/api/students/:id/export', (req, res) => {
    try {
      if (!checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Only teachers and administrators can export student data' });
      }
      const studentId = req.params.id;
      const student = kernelContainer.db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as any;
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const classEnrollments = kernelContainer.db.prepare(`
        SELECT c.name as class_name FROM classes c
        JOIN class_students cs ON c.id = cs.class_id WHERE cs.student_id = ?
      `).all(studentId);
      const progress = kernelContainer.db.prepare('SELECT * FROM student_lesson_progress WHERE student_id = ?').all(studentId);
      const submissions = kernelContainer.db.prepare('SELECT * FROM assignment_submissions WHERE student_id = ?').all(studentId);
      const attendance = kernelContainer.db.prepare('SELECT * FROM attendance WHERE student_id = ?').all(studentId);
      const examScores = kernelContainer.db.prepare('SELECT * FROM exam_scores WHERE student_id = ?').all(studentId);
      const semesterReports = kernelContainer.db.prepare('SELECT * FROM student_semester_reports WHERE student_id = ?').all(studentId);
      const rollcalls = kernelContainer.db.prepare('SELECT * FROM student_rollcalls WHERE student_id = ?').all(studentId);
      const pluginSubmissions = kernelContainer.db.prepare('SELECT * FROM plugin_submissions WHERE student_id = ?').all(studentId);
      const peerReviews = kernelContainer.db.prepare('SELECT * FROM plugin_peer_reviews WHERE reviewer_id = ?').all(studentId);

      res.json({
        student: { ...student, password: '[REDACTED]' },
        classes: classEnrollments,
        progress,
        assignmentSubmissions: submissions,
        attendance,
        examScores,
        semesterReports,
        rollcalls,
        pluginSubmissions,
        peerReviews,
        exportedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SEC-DATA-02: GDPR 完整数据删除（管理员专用，需二次确认�?
  app.delete('/api/students/:id/gdpr-delete', (req, res) => {
    try {
      if (!checkIsTeacherOrAdmin(req)) {
        return res.status(403).json({ error: 'Only teachers and administrators can perform GDPR deletion' });
      }
      const studentId = req.params.id;
      const { confirm } = req.body;
      if (confirm !== true) {
        return res.status(400).json({ error: 'Must explicitly confirm GDPR deletion with { confirm: true }' });
      }

      // 级联删除所有关联数�?
      kernelContainer.db.prepare('DELETE FROM class_students WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM exam_scores WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM student_semester_reports WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM plugin_submissions WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM plugin_peer_reviews WHERE reviewer_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM student_seats WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?').run(studentId);
      kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);

      console.log(`[GDPR] Complete data deletion for student ${studentId}`);
      res.json({ success: true, message: 'All student data has been permanently deleted.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/students/:id/progress', (req, res) => {
    try {
      const progress = kernelContainer.db.prepare(`
        SELECT slp.*, l.title as lesson_title
        FROM student_lesson_progress slp
        JOIN lessons l ON slp.lesson_id = l.id
        WHERE slp.student_id = ?
      `).all(req.params.id);
      res.json(progress);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/students/:id/progress', (req, res) => {
    try {
      const { lessonId, completed, progressPercent, completedSegments } = req.body;
      const completedSegmentsStr = typeof completedSegments === 'string'
        ? completedSegments
        : JSON.stringify(completedSegments || []);

      kernelContainer.db.prepare(`
        INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = excluded.completed,
          progress_percent = excluded.progress_percent,
          completed_segments = excluded.completed_segments
      `).run(
        req.params.id,
        lessonId,
        completed ? 1 : 0,
        progressPercent || 0,
        completedSegmentsStr,
        Date.now()
      );
      
      io.emit('student-progress-updated', {
        studentId: req.params.id,
        lessonId,
        progressPercent: progressPercent || 0,
        completed: !!completed,
        completedSegments: completedSegments || []
      });

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:id/students', (req, res) => {
    try {
      const { studentId } = req.body;
      kernelContainer.db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        req.params.id, studentId, Date.now()
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:id/students/bulk-enroll', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { students } = req.body;
      const classId = req.params.id;
      if (!students || !Array.isArray(students)) {
        return res.status(400).json({ error: 'Invalid payload: students must be an array' });
      }

      const db = kernelContainer.db;

      const insertStudent = db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)');
      const findStudentByEmail = db.prepare('SELECT id FROM students WHERE email = ?');
      const insertClassStudent = db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)');

      const results = [];
      for (const st of students) {
        const stName = st.name ? st.name.trim() : '';
        const stEmail = st.email ? st.email.trim() : '';
        const stNum = st.student_number ? st.student_number.trim() : '';
        if (!stName) continue;

        let studentId = '';
        if (stEmail) {
          const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
          if (existing) {
            studentId = existing.id;
          }
        }

        let finalNum = stNum;
        if (!studentId) {
          studentId = Math.random().toString(36).slice(2);
          if (!finalNum) {
            finalNum = generateStudentNumber(db) || `ST_${studentId}`;
          }
          insertStudent.run(studentId, finalNum, stName, stEmail, Date.now());
          results.push({ id: studentId, student_number: finalNum, name: stName, email: stEmail, status: 'created_and_enrolled' });
        } else {
          results.push({ id: studentId, name: stName, email: stEmail, status: 'enrolled_existing' });
        }

        insertClassStudent.run(classId, studentId, Date.now());
      }

      res.json({ success: true, count: results.length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:id/progress', (req, res) => {
    try {
      const progress = kernelContainer.db.prepare(`
        SELECT l.id as lesson_id, l.title as lesson_title, AVG(slp.progress_percent) as average_progress
        FROM class_students cs
        JOIN student_lesson_progress slp ON cs.student_id = slp.student_id
        JOIN lessons l ON slp.lesson_id = l.id
        WHERE cs.class_id = ?
        GROUP BY l.id
      `).all(req.params.id);
      res.json(progress);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:classId/lessons/:lessonId/progress', (req, res) => {
    try {
      const progress = kernelContainer.db.prepare(`
        SELECT cs.student_id, COALESCE(slp.progress_percent, 0) as progress_percent, 
               COALESCE(slp.completed, 0) as completed, slp.completed_segments,
               (
                 SELECT MAX(sub.score)
                 FROM assignment_submissions sub
                 JOIN assignments a ON sub.assignment_id = a.id
                 WHERE sub.student_id = cs.student_id AND a.lesson_id = ?
               ) as quiz_score
        FROM class_students cs
        LEFT JOIN student_lesson_progress slp ON cs.student_id = slp.student_id AND slp.lesson_id = ?
        WHERE cs.class_id = ?
      `).all(req.params.lessonId, req.params.lessonId, req.params.classId);
      res.json(progress);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/classes/:classId/students/:studentId', (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(req.params.classId, req.params.studentId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:classId/dashboard', (req, res) => {
    try {
      const assignments = kernelContainer.db.prepare('SELECT * FROM assignments WHERE class_id = ? ORDER BY created_at DESC').all(req.params.classId);
      
      const recentSubmissions = kernelContainer.db.prepare(`
        SELECT sub.*, a.title as assignment_title, a.content as question_content, s.name as student_name
        FROM assignment_submissions sub
        JOIN assignments a ON sub.assignment_id = a.id
        JOIN students s ON sub.student_id = s.id
        WHERE a.class_id = ?
        ORDER BY sub.submitted_at DESC
        LIMIT 10
      `).all(req.params.classId);

      const performance = kernelContainer.db.prepare(`
        SELECT a.id as assignment_id, a.title as assignment_title, s.id as student_id, s.name as student_name, sub.score, sub.status as submission_status, sub.submitted_at, sub.graded_at, sub.feedback
        FROM assignments a
        CROSS JOIN class_students cs ON a.class_id = cs.class_id
        JOIN students s ON cs.student_id = s.id
        LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = s.id
        WHERE a.class_id = ?
        ORDER BY a.created_at, s.name
      `).all(req.params.classId);

      const rollcallStats = kernelContainer.db.prepare(`
        SELECT 
          s.id as student_id,
          s.name as student_name,
          COALESCE(rc.count, 0) as count,
          rc.last_picked_time
        FROM class_students cs
        JOIN students s ON cs.student_id = s.id
        LEFT JOIN (
          SELECT student_id, COUNT(*) as count, MAX(picked_time) as last_picked_time
          FROM student_rollcalls
          WHERE class_id = ?
          GROUP BY student_id
        ) rc ON s.id = rc.student_id
        WHERE cs.class_id = ?
        ORDER BY count DESC, s.name ASC
      `).all(req.params.classId, req.params.classId);

      res.json({ assignments, recentSubmissions, performance, rollcallStats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Assignments & Quizzes
  app.get('/api/students/:id/dashboard', (req, res) => {
    try {
      const studentId = req.params.id;
      
      // Get classes
      const studentClasses = kernelContainer.db.prepare(`
        SELECT c.*
        FROM classes c
        JOIN class_students cs ON c.id = cs.class_id
        WHERE cs.student_id = ?
      `).all(studentId);
      
      // Get impending schedules (for classes they are in, repeating weekly)
      const rawSchedules = kernelContainer.db.prepare(`
        WITH RankedSchedules AS (
          SELECT s.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.class_id, s.time_slot, strftime('%w', s.scheduled_date)
                   ORDER BY s.scheduled_date DESC, s.created_at DESC
                 ) as rn
          FROM schedules s
          JOIN class_students cs ON s.class_id = cs.class_id
          WHERE cs.student_id = ?
        )
        SELECT r.id, r.class_id, r.lesson_id, r.scheduled_date, r.time_slot, r.status, r.notes, r.created_at,
               COALESCE(l.title, '未设定内�? (上课时自由选择)') as lesson_title, c.name as class_name,
               (SELECT status FROM attendance a WHERE a.schedule_id = r.id AND a.student_id = ?) as attendance_status
        FROM RankedSchedules r
        LEFT JOIN lessons l ON r.lesson_id = l.id
        JOIN classes c ON r.class_id = c.id
        WHERE r.rn = 1
        ORDER BY CASE WHEN strftime('%w', r.scheduled_date) = '0' THEN 7 ELSE CAST(strftime('%w', r.scheduled_date) AS INTEGER) END ASC, r.time_slot ASC
      `).all(studentId, studentId) as any[];

      // Map the original scheduled_date to the current week's corresponding date
      const today = new Date();
      const day = today.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday of current week
      const monday = new Date(today.setDate(diff));
      monday.setHours(0, 0, 0, 0);

      const schedules = rawSchedules.map(sch => {
        const origDate = new Date(sch.scheduled_date);
        const dayOfWeekNum = origDate.getDay(); // 0-6

        const offset = (dayOfWeekNum === 0) ? 6 : (dayOfWeekNum - 1);
        const thisWeekOccurence = new Date(monday.getTime() + offset * 24 * 60 * 60 * 1000);
        const dateStr = thisWeekOccurence.toISOString().split('T')[0];

        return {
          ...sch,
          scheduled_date: dateStr
        };
      });
      
      // Get assignments and their submission status
      const assignments = kernelContainer.db.prepare(`
        SELECT a.*, c.name as class_name,
               sub.status as submission_status, sub.score, sub.feedback, sub.submitted_at, sub.graded_at, sub.content as submission_content
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN class_students cs ON a.class_id = cs.class_id
        LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = ?
        WHERE cs.student_id = ?
        ORDER BY a.created_at DESC
      `).all(studentId, studentId);
      
      // Get progress
      const progress = kernelContainer.db.prepare(`
        SELECT p.*, l.title as lesson_title
        FROM student_lesson_progress p
        JOIN lessons l ON p.lesson_id = l.id
        WHERE p.student_id = ?
      `).all(studentId);

      // Get rollcalls
      const rollcalls = kernelContainer.db.prepare(`
        SELECT r.*, c.name as class_name, l.title as lesson_title
        FROM student_rollcalls r
        LEFT JOIN classes c ON r.class_id = c.id
        LEFT JOIN lessons l ON r.lesson_id = l.id
        WHERE r.student_id = ?
        ORDER BY r.picked_time DESC
      `).all(studentId);

      // Get profile details (containing locked_lesson_id)
      const profile = kernelContainer.db.prepare(`
        SELECT id, name, email, locked_lesson_id, private_notes, student_number
        FROM students
        WHERE id = ?
      `).get(studentId) as any;

      res.json({ classes: studentClasses, schedules, assignments, progress, rollcalls, profile });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Docs APIs
}
