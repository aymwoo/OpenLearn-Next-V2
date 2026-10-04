import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId, requireAuth } from '../middleware/auth.js';
import { validateMagicBytes, BLOCKED_EXTENSIONS, generateStudentNumber } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { randomId } from '../utils/id.js';
import { parsePagination } from '../utils/pagination.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { emitClassroomEvent } from '../presence.js';
import type { ServerContext } from '../context.js';
import { RosterService } from '../services/roster-service.js';

/**
 * 学生级联删除（DATA-INT-01）：12 张子表 + students 本体，委托至 RosterService。
 */
function deleteStudentCascade(db: typeof kernelContainer.db, studentId: string): void {
  new RosterService(db).deleteStudentCascade(studentId);
}

export function registerRosterRoutes(ctx: ServerContext) {
  const { app, io, loginLimiter } = ctx;
  const rosterService = new RosterService();

  app.get('/api/classes', requireAuth(), (req, res) => {
    try {
      const pg = parsePagination(req.query as any);
      res.json(rosterService.listClasses(pg));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/students', requireAuth(), (req, res) => {
    try {
      const pg = parsePagination(req.query as any);
      res.json(rosterService.listStudents(pg));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:id/students', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.getClassStudents(req.params.id));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { name, description, lab_id } = req.body;
      const classId = rosterService.createClass(name, description, lab_id);
      res.json({ success: true, id: classId });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/classes/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { name, description, class_passcode, class_passcode_expires_at, lab_id } = req.body;
      // 门控必须是"任一可更新字段出现"，而不是 `if (name)`：
      // 只改 description / lab_id 的请求此前被整条丢弃（重构前的逐字段 if 已丢失）。
      // updateClass 内部只为显式传入的字段生成 SET，未传的字段保持原值。
      if (name !== undefined || description !== undefined || lab_id !== undefined) {
        rosterService.updateClass(req.params.id, name, description, lab_id);
      }
      if (class_passcode !== undefined) {
        kernelContainer.db
          .prepare('UPDATE classes SET class_passcode = ? WHERE id = ?')
          .run(class_passcode, req.params.id);
      }
      if (class_passcode_expires_at !== undefined) {
        kernelContainer.db
          .prepare('UPDATE classes SET class_passcode_expires_at = ? WHERE id = ?')
          .run(class_passcode_expires_at, req.params.id);
      }
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 预留给第三方插件/外部系统获取班级临时密码信息的扩展接口
   */
  app.get('/api/classes/:id/passcode', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.getClassPasscode(req.params.id));
    } catch (e: any) {
      if (e.message === 'Class not found') {
        return res.status(404).json({ error: 'Class not found' });
      }
      sendSafeError(res, e);
    }
  });

  app.delete('/api/classes/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.deleteClassCascade(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // --- AUTHENTICATION & TEACHER USER ACCOUNTS APIS ---
  // getCookieToken is now defined earlier to be used by whiteboard endpoints

  app.get('/api/db-status', requireAuth('teacher', 'administrator'), (req, res) => {
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
        const journalMode = journalModeObj
          ? (journalModeObj.journal_mode ?? journalModeObj['journal_mode'] ?? 'N/A')
          : 'N/A';
        const autoVacuum = autoVacuumObj ? (autoVacuumObj.auto_vacuum ?? autoVacuumObj['auto_vacuum'] ?? 0) : 0;
        const integrity = integrityObj
          ? (integrityObj.integrity_check ?? integrityObj['integrity_check'] ?? 'ok')
          : 'ok';
        const freelistCount = freelistCountObj
          ? (freelistCountObj.freelist_count ?? freelistCountObj['freelist_count'] ?? 0)
          : 0;

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
          latencyMs,
        });
      }
      return res.status(500).json({ status: 'disconnected', error: 'Unexpected response from SQLite' });
    } catch (e: any) {
      const exposed = process.env.NODE_ENV === 'production' ? 'Database connection error' : e.message;
      return res.status(500).json({ status: 'disconnected', error: exposed });
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
      res.json({ session, ...(session as any) });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.json({ session: null, role: null });
      const session = getValidSession(token);
      if (!session) return res.json({ session: null, role: null });
      res.json({ session, ...(session as any) });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const token = getCookieToken(req);
      if (token) {
        kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
      }
      const isSecure =
        req.secure ||
        req.headers['x-forwarded-proto'] === 'https' ||
        (process.env.NODE_ENV === 'production' && process.env.ENABLE_HTTPS === 'true');
      const secureFlag = isSecure ? '; Secure' : '';
      res.setHeader('Set-Cookie', `edu_os_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secureFlag}`);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
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
        kernelContainer.db
          .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.userId);
        // 使该用户所有其�? session 失效
        kernelContainer.db
          .prepare('DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?')
          .run(token, `%${session.userId}%`);
        // SEC-AUTH-06: 改密成功后清除当前会话的默认密码标记（其余会话已被删除）
        try {
          const updatedSession = { ...session, mustChangePassword: false };
          kernelContainer.db
            .prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?')
            .run(JSON.stringify(updatedSession), token);
        } catch (clearErr) {
          console.warn('[Auth] Failed to clear mustChangePassword flag:', clearErr);
        }
        return res.json({ success: true, message: 'Password changed. All other devices have been logged out.' });
      }

      if (session.role === 'student') {
        const studentObj = kernelContainer.db
          .prepare('SELECT * FROM students WHERE id = ?')
          .get(session.studentId) as any;
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
        kernelContainer.db
          .prepare('UPDATE students SET password = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.studentId);
        // 使该学生所有其�? session 失效
        kernelContainer.db
          .prepare('DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?')
          .run(token, `%${session.studentId}%`);
        // SEC-AUTH-06: 改密成功后清除当前会话的默认密码标记（其余会话已被删除）
        try {
          const updatedSession = { ...session, mustChangePassword: false };
          kernelContainer.db
            .prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?')
            .run(JSON.stringify(updatedSession), token);
        } catch (clearErr) {
          console.warn('[Auth] Failed to clear mustChangePassword flag:', clearErr);
        }
        return res.json({ success: true, message: 'Password changed. All other devices have been logged out.' });
      }

      res.status(400).json({ error: 'Unsupported role' });
    } catch (e: any) {
      sendSafeError(res, e);
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
        const row = kernelContainer.db
          .prepare('SELECT session_data FROM client_sessions WHERE id = ?')
          .get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.name = name;
          kernelContainer.db
            .prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?')
            .run(JSON.stringify(data), token);
        }
      } catch {
        /* session_data ͬ���ǹؼ�·�� */
      }

      res.json({ success: true, name });
    } catch (e: any) {
      sendSafeError(res, e);
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
        const row = kernelContainer.db
          .prepare('SELECT avatar FROM students WHERE id = ?')
          .get(session.studentId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE students SET avatar = ? WHERE id = ?').run(avatarUrl, session.studentId);
      } else {
        const row = kernelContainer.db.prepare('SELECT avatar FROM users WHERE id = ?').get(session.userId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, session.userId);
      }
      if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
        try {
          fs.unlinkSync(path.join(process.cwd(), oldAvatar));
        } catch {
          /* ignore */
        }
      }

      // ͬ����ǰ session_data.avatar
      try {
        const row = kernelContainer.db
          .prepare('SELECT session_data FROM client_sessions WHERE id = ?')
          .get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.avatar = avatarUrl;
          kernelContainer.db
            .prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?')
            .run(JSON.stringify(data), token);
        }
      } catch {
        /* session_data ͬ���ǹؼ�·�� */
      }

      res.json({ success: true, avatar: avatarUrl });
    } catch (e: any) {
      sendSafeError(res, e);
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
        const row = kernelContainer.db
          .prepare('SELECT avatar FROM students WHERE id = ?')
          .get(session.studentId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE students SET avatar = NULL WHERE id = ?').run(session.studentId);
      } else {
        const row = kernelContainer.db.prepare('SELECT avatar FROM users WHERE id = ?').get(session.userId) as any;
        oldAvatar = row?.avatar ?? null;
        kernelContainer.db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(session.userId);
      }
      if (oldAvatar && oldAvatar.startsWith('/uploads/avatars/')) {
        try {
          fs.unlinkSync(path.join(process.cwd(), oldAvatar));
        } catch {
          /* ignore */
        }
      }

      try {
        const row = kernelContainer.db
          .prepare('SELECT session_data FROM client_sessions WHERE id = ?')
          .get(token) as any;
        if (row && row.session_data) {
          const data = JSON.parse(row.session_data);
          data.avatar = null;
          kernelContainer.db
            .prepare('UPDATE client_sessions SET session_data = ? WHERE id = ?')
            .run(JSON.stringify(data), token);
        }
      } catch {
        /* session_data ͬ���ǹؼ�·�� */
      }

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
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
          kernelContainer.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userObj.id);
          console.log(`[Auth] Auto-upgraded password hash for user ${userObj.username}`);
        }
        // SEC-AUTH-06: 种子默认密码（admin/admin、teacher/teacher，特征为密码=用户名）
        // 登录成功即打标：前端强制改密 + 服务端 enforcePasswordChanged 拦截写操作
        const mustChangePassword = password === userObj.username;
        if (mustChangePassword) {
          console.warn(`[SECURITY] User ${userObj.username} logged in with default password; forcing change`);
        }
        sessionData = {
          role: 'teacher',
          userId: userObj.id,
          username: userObj.username,
          subRole: userObj.role,
          name: userObj.name,
          avatar: userObj.avatar ?? null,
          ...(mustChangePassword ? { mustChangePassword: true } : {}),
        };
      } else if (entrance === 'student') {
        if (!studentId) {
          return res.status(400).json({ error: 'Student ID is required' });
        }
        const studentObj = kernelContainer.db
          .prepare('SELECT * FROM students WHERE student_number = ? OR id = ?')
          .get(studentId, studentId) as any;
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
            kernelContainer.db
              .prepare('UPDATE students SET password = ? WHERE id = ?')
              .run(bcryptHashPassword(providedPassword), studentObj.id);
            console.log(`[Auth] Auto-upgraded password hash for student ${studentObj.student_number || studentObj.id}`);
          }
        }
        // 旧明文密码
        else if (storedPwd && storedPwd === providedPassword) {
          matchesOwnPassword = true;
          try {
            kernelContainer.db
              .prepare('UPDATE students SET password = ? WHERE id = ?')
              .run(bcryptHashPassword(providedPassword), studentObj.id);
            console.log(
              `[Auth] Auto-upgraded plain password hash for student ${studentObj.student_number || studentObj.id}`,
            );
          } catch (upgradeErr) {
            console.error('[Auth] Failed to auto-upgrade plain password', upgradeErr);
          }
        }

        // 2. Check temporary class passcodes for classes the student is enrolled in
        let matchesClassPasscode = false;
        let isPasscodeExpired = false;
        if (!matchesOwnPassword) {
          try {
            const now = Date.now();
            const enrolledClasses = kernelContainer.db
              .prepare(
                `
              SELECT c.id, c.name, c.class_passcode, c.class_passcode_expires_at
              FROM classes c
              INNER JOIN class_students cs ON c.id = cs.class_id
              WHERE cs.student_id = ?
            `,
              )
              .all(studentObj.id) as any[];

            for (const cls of enrolledClasses) {
              if (cls.class_passcode && cls.class_passcode.trim() === providedPassword) {
                // 检查有效期
                if (cls.class_passcode_expires_at && now > cls.class_passcode_expires_at) {
                  isPasscodeExpired = true;
                } else {
                  matchesClassPasscode = true;
                  break;
                }
              }
            }
          } catch (dbErr) {
            console.error('Failed to query active class passcodes', dbErr);
          }
        }

        if (!matchesOwnPassword && !matchesClassPasscode) {
          if (isPasscodeExpired) {
            return res.status(401).json({
              error: '班级上课临时密码已过期，请向教师索取最新口令或使用学生个人密码登录。',
              code: 'CLASS_PASSCODE_EXPIRED',
            });
          }
          return res.status(401).json({
            error: 'Incorrect student password or temporary class passcode',
            code: 'AUTH_FAILED',
          });
        }

        // SEC-AUTH-06: 学生仍以初始默认口令 123456 完成个人密码登录 → 强制改密标记
        //（班级口令登录不打标：该路径与个人密码无关）
        const studentMustChangePassword = matchesOwnPassword && providedPassword === '123456';
        sessionData = {
          role: 'student',
          userId: studentObj.id,
          studentId: studentObj.id,
          name: studentObj.name,
          email: studentObj.email,
          avatar: studentObj.avatar ?? null,
          ...(studentMustChangePassword ? { mustChangePassword: true } : {}),
        };
      }

      if (sessionData) {
        const sessionToken = 'token_' + crypto.randomBytes(16).toString('hex');
        // SEC-AUTH-03: session 添加 expires_at�?24小时空闲 + 7天绝对）
        // SEC-AUTH-03: session 添加 expires_at?24小时空闲 + 7天绝对）
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 天绝对过?
        kernelContainer.db
          .prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
          .run(sessionToken, JSON.stringify(sessionData), now, expiresAt);

        // SEC-COOKIE: 根据环境与协议自适应设置 Secure 标志，对齐 7 天绝对过期时间
        const isSecure =
          req.secure ||
          req.headers['x-forwarded-proto'] === 'https' ||
          (process.env.NODE_ENV === 'production' && process.env.ENABLE_HTTPS === 'true');
        const secureFlag = isSecure ? '; Secure' : '';
        const maxAgeSeconds = 7 * 24 * 60 * 60; // 7 天（604800 秒），与 DB client_sessions.expires_at 精确对齐
        res.setHeader(
          'Set-Cookie',
          `edu_os_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag}`,
        );
        return res.json({
          success: true,
          session: sessionData,
        });
      }
      res.status(400).json({ error: 'Unsupported entry type' });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // --- STUDENT READ NOTIFICATIONS APIS ---
  app.get('/api/students/:id/read_notifications', requireAuth(), (req, res) => {
    try {
      const rows = kernelContainer.db
        .prepare('SELECT notification_id FROM student_read_notifications WHERE student_id = ?')
        .all(req.params.id) as any[];
      res.json(rows.map((r) => r.notification_id));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/students/:id/read_notifications', requireAuth(), async (req, res) => {
    try {
      const { notificationId } = req.body;
      if (!notificationId) {
        return res.status(400).json({ error: 'notificationId is required' });
      }
      kernelContainer.db
        .prepare('INSERT OR IGNORE INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)')
        .run(req.params.id, notificationId);

      await publishClassroomEvent(
        CLASSROOM_EVENTS.STUDENT_NOTIFICATION_ACKNOWLEDGED,
        {
          studentId: req.params.id,
          notificationId,
        },
        { correlationId: req.params.id },
      );
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/lock_lesson', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId } = req.body;
      if (!lessonId) {
        return res.status(400).json({ error: 'lessonId is required' });
      }
      kernelContainer.db
        .prepare(
          'UPDATE students SET locked_lesson_id = ? WHERE id IN (SELECT student_id FROM class_students WHERE class_id = ?)',
        )
        .run(lessonId, req.params.classId);

      await publishClassroomEvent(
        CLASSROOM_EVENTS.CLASSROOM_LOCK_CHANGED,
        {
          classId: req.params.classId,
          lessonId,
          locked: true,
        },
        { correlationId: req.params.classId },
      );
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/classes/:classId/unlock_lesson', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      kernelContainer.db
        .prepare(
          'UPDATE students SET locked_lesson_id = NULL WHERE id IN (SELECT student_id FROM class_students WHERE class_id = ?)',
        )
        .run(req.params.classId);

      await publishClassroomEvent(
        CLASSROOM_EVENTS.CLASSROOM_LOCK_CHANGED,
        {
          classId: req.params.classId,
          locked: false,
        },
        { correlationId: req.params.classId },
      );
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.get('/api/users', requireAuth('administrator'), async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('user.list', {}, getActorId(req));
      const users = await kernelContainer.commandBus.execute(cmd);
      res.json(users);
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/users', requireAuth('administrator'), async (req, res) => {
    try {
      const { username, password, role, name, status = 'active' } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
        'user.create',
        {
          username,
          password,
          role,
          name,
          status,
        },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.put('/api/users/:id', requireAuth('administrator'), async (req, res) => {
    try {
      const { username, role, name, password, status } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
        'user.update',
        {
          userId: req.params.id,
          username,
          role,
          name,
          password,
          status,
        },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.delete('/api/users/:id', requireAuth('administrator'), async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand(
        'user.delete',
        {
          userId: req.params.id,
        },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  // --- COMPUTER LABS AND SEATING APIS ---
  app.get('/api/labs', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.listLabs());
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/labs', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const created = rosterService.createLab(req.body);
      res.json({ success: true, ...created });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/labs/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.updateLab(req.params.id, req.body);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/labs/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.deleteLab(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:classId/seats', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.getClassSeats(req.params.classId));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/seats', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.saveClassSeats(req.params.classId, req.body.lab_id, req.body.seats);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
  // --------------------------------------

  // SEC-AUTH-06: 生成随机初始密码（排除易混淆字符，12 位，字母+数字）
  // 明文仅在创建响应中返回一次，供教师分发；库中只存 bcrypt 哈希
  app.post('/api/students', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const created = rosterService.createStudent(req.body);
      res.json({ success: true, ...created });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/students/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.updateStudent(req.params.id, req.body);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/students/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.deleteStudentCascade(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // SEC-DATA-02: GDPR 学生数据导出
  app.get('/api/students/:id/export', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(rosterService.exportStudentData(req.params.id));
    } catch (e: any) {
      if (e.message?.includes('not found')) return res.status(404).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // SEC-DATA-02: GDPR 完整数据删除（管理员专用，需二次确认）
  app.delete('/api/students/:id/gdpr-delete', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const studentId = req.params.id;
      const { confirm } = req.body;
      if (confirm !== true) {
        return res.status(400).json({ error: 'Must explicitly confirm GDPR deletion with { confirm: true }' });
      }

      rosterService.deleteStudentCascade(studentId);

      console.log(`[GDPR] Complete data deletion for student ${studentId}`);
      res.json({ success: true, message: 'All student data has been permanently deleted.' });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/students/:id/progress', requireAuth(), (req, res) => {
    try {
      const session = (req as any).session as any;
      const isPrivileged = session && (session.role === 'teacher' || session.role === 'administrator');
      const currentUserId = session?.userId || session?.studentId;
      const studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(req.params.id, req.params.id) as any;
      const studentId = studentRow ? studentRow.id : req.params.id;
      // Students may only read their own progress
      if (!isPrivileged && currentUserId !== studentId && currentUserId !== (studentRow?.student_number ?? null)) {
        return res.status(403).json({ error: 'Forbidden: Cannot read another student progress' });
      }
      const progress = kernelContainer.db
        .prepare(
          `
        SELECT slp.*, l.title as lesson_title
        FROM student_lesson_progress slp
        JOIN lessons l ON slp.lesson_id = l.id
        WHERE slp.student_id = ?
      `,
        )
        .all(studentId);
      res.json(progress);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/students/:id/progress', requireAuth(), async (req, res) => {
    try {
      const session = (req as any).session;
      const isPrivileged = session && (session.role === 'teacher' || session.role === 'administrator');
      const currentUserId = session?.userId || session?.studentId;

      const studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(req.params.id, req.params.id) as any;

      const isSelf = studentRow
        ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
        : currentUserId === req.params.id;

      if (!isPrivileged && !isSelf) {
        return res.status(403).json({ error: 'Cannot update progress for another student' });
      }

      const studentId = studentRow ? studentRow.id : req.params.id;
      const { lessonId, completed, progressPercent, completedSegments } = req.body;
      const completedSegmentsStr =
        typeof completedSegments === 'string' ? completedSegments : JSON.stringify(completedSegments || []);

      kernelContainer.db
        .prepare(
          `
        INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = excluded.completed,
          progress_percent = excluded.progress_percent,
          completed_segments = excluded.completed_segments
      `,
        )
        .run(studentId, lessonId, completed ? 1 : 0, progressPercent || 0, completedSegmentsStr, Date.now());

      await publishClassroomEvent(
        CLASSROOM_EVENTS.STUDENT_PROGRESS_UPDATED,
        {
          studentId,
          lessonId,
          progressPercent: progressPercent || 0,
          completed: !!completed,
          completedSegments: completedSegments || [],
        },
        { correlationId: lessonId || undefined },
      );

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:id/students', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const studentId = req.body.studentId || req.body.student_id;
      if (!studentId) {
        return res.status(400).json({ error: 'Missing studentId' });
      }
      rosterService.enrollStudent(req.params.id, studentId);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:id/students/bulk-enroll', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { students } = req.body;
      const classId = req.params.id;
      if (!students || !Array.isArray(students)) {
        return res.status(400).json({ error: 'Invalid payload: students must be an array' });
      }

      const result = rosterService.bulkEnrollStudents(classId, students);
      res.json({ success: true, count: result.count, results: result.results });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:id/progress', requireAuth(), (req, res) => {
    try {
      const progress = kernelContainer.db
        .prepare(
          `
        SELECT l.id as lesson_id, l.title as lesson_title, AVG(slp.progress_percent) as average_progress
        FROM class_students cs
        JOIN student_lesson_progress slp ON cs.student_id = slp.student_id
        JOIN lessons l ON slp.lesson_id = l.id
        WHERE cs.class_id = ?
        GROUP BY l.id
      `,
        )
        .all(req.params.id);
      res.json(progress);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:classId/lessons/:lessonId/progress', requireAuth(), (req, res) => {
    try {
      const progress = kernelContainer.db
        .prepare(
          `
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
      `,
        )
        .all(req.params.lessonId, req.params.lessonId, req.params.classId);
      res.json(progress);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/classes/:classId/students/:studentId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      rosterService.unenrollStudent(req.params.classId, req.params.studentId);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:classId/dashboard', requireAuth(), (req, res) => {
    try {
      const assignments = kernelContainer.db
        .prepare('SELECT * FROM assignments WHERE class_id = ? ORDER BY created_at DESC')
        .all(req.params.classId);

      const recentSubmissions = kernelContainer.db
        .prepare(
          `
        SELECT sub.*, a.title as assignment_title, a.content as question_content, s.name as student_name
        FROM assignment_submissions sub
        JOIN assignments a ON sub.assignment_id = a.id
        JOIN students s ON sub.student_id = s.id
        WHERE a.class_id = ?
        ORDER BY sub.submitted_at DESC
        LIMIT 10
      `,
        )
        .all(req.params.classId);

      const performance = kernelContainer.db
        .prepare(
          `
        SELECT a.id as assignment_id, a.title as assignment_title, s.id as student_id, s.name as student_name, sub.score, sub.status as submission_status, sub.submitted_at, sub.graded_at, sub.feedback
        FROM assignments a
        CROSS JOIN class_students cs ON a.class_id = cs.class_id
        JOIN students s ON cs.student_id = s.id
        LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = s.id
        WHERE a.class_id = ?
        ORDER BY a.created_at, s.name
      `,
        )
        .all(req.params.classId);

      const rollcallStats = kernelContainer.db
        .prepare(
          `
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
      `,
        )
        .all(req.params.classId, req.params.classId);

      res.json({ assignments, recentSubmissions, performance, rollcallStats });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // Assignments & Quizzes
  app.get('/api/students/:id/dashboard', requireAuth(), (req, res) => {
    try {
      const session = (req as any).session;
      const isPrivileged = session && (session.role === 'teacher' || session.role === 'administrator');
      const currentUserId = session?.userId || session?.studentId;

      const studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(req.params.id, req.params.id) as any;

      const isSelf = studentRow
        ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
        : currentUserId === req.params.id;

      if (!isPrivileged && !isSelf) {
        return res.status(403).json({ error: 'Cannot access another student dashboard' });
      }

      const studentId = studentRow ? studentRow.id : req.params.id;

      // Get classes
      const studentClasses = kernelContainer.db
        .prepare(
          `
        SELECT c.*
        FROM classes c
        JOIN class_students cs ON c.id = cs.class_id
        WHERE cs.student_id = ?
      `,
        )
        .all(studentId);

      // Get impending schedules (for classes they are in, repeating weekly)
      const rawSchedules = kernelContainer.db
        .prepare(
          `
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
      `,
        )
        .all(studentId, studentId) as any[];

      // Map the original scheduled_date to the current week's corresponding date
      const today = new Date();
      const day = today.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday of current week
      const monday = new Date(today.setDate(diff));
      monday.setHours(0, 0, 0, 0);

      const schedules = rawSchedules.map((sch) => {
        const origDate = new Date(sch.scheduled_date);
        const dayOfWeekNum = origDate.getDay(); // 0-6

        const offset = dayOfWeekNum === 0 ? 6 : dayOfWeekNum - 1;
        const thisWeekOccurence = new Date(monday.getTime() + offset * 24 * 60 * 60 * 1000);
        const dateStr = thisWeekOccurence.toISOString().split('T')[0];

        return {
          ...sch,
          scheduled_date: dateStr,
        };
      });

      // Get assignments and their submission status
      const assignments = kernelContainer.db
        .prepare(
          `
        SELECT a.*, c.name as class_name,
               sub.status as submission_status, sub.score, sub.feedback, sub.submitted_at, sub.graded_at, sub.content as submission_content
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN class_students cs ON a.class_id = cs.class_id
        LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = ?
        WHERE cs.student_id = ?
        ORDER BY a.created_at DESC
      `,
        )
        .all(studentId, studentId);

      // Get progress
      const progress = kernelContainer.db
        .prepare(
          `
        SELECT p.*, l.title as lesson_title
        FROM student_lesson_progress p
        JOIN lessons l ON p.lesson_id = l.id
        WHERE p.student_id = ?
      `,
        )
        .all(studentId);

      // Get rollcalls
      const rollcalls = kernelContainer.db
        .prepare(
          `
        SELECT r.*, c.name as class_name, l.title as lesson_title
        FROM student_rollcalls r
        LEFT JOIN classes c ON r.class_id = c.id
        LEFT JOIN lessons l ON r.lesson_id = l.id
        WHERE r.student_id = ?
        ORDER BY r.picked_time DESC
      `,
        )
        .all(studentId);

      // Get profile details (containing locked_lesson_id)
      const profile = kernelContainer.db
        .prepare(
          `
        SELECT id, name, email, locked_lesson_id, private_notes, student_number
        FROM students
        WHERE id = ?
      `,
        )
        .get(studentId) as any;

      res.json({ classes: studentClasses, schedules, assignments, progress, rollcalls, profile });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // --- Smart Fair & Tiered Random Picker APIs ---

  app.get('/api/classes/:classId/picker-candidates', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.getPickerCandidates(req.params.classId, req.query.lessonId as string));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // SEC-ROLL-01（2026-10-04）：评价会写入 student_rollcalls 并发放金币，属教师操作。
  // 此前只有 requireAuth()，任意已登录用户（含学生）都能对任意 studentId 写入并
  // 触发 student:coins_awarded 广播。前端已同步按 userRole 隐藏评价按钮
  // （RollCallWrapper 的 canEvaluate）—— 两端必须同时改，否则只改服务端会让
  // 学生点击后拿到 403，而 handleEvaluate 对 403 不抛错 → 界面显示已评价已发币、
  // 服务端未落库的静默不一致。
  app.post('/api/rollcalls/evaluate', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const payload = rosterService.evaluateRollcall(req.body || {});

      if (io) {
        // 投递到「课节房间 + 常驻课堂广播房间」：原为全局 io.emit，会推给
        // 全平台客户端（A 课节的评价事件串到 B 课节）。消费端按 lessonId 过滤，
        // 但那是运气，不是设计。
        emitClassroomEvent(io, payload.lessonId ?? null, 'rollcall:evaluated', payload);
        // 金币到账的通用信号：补 lessonId/classId，否则消费端无从按课节过滤。
        // 注意与上面同源同动作，消费端只应订阅其中之一，否则会双重提示。
        emitClassroomEvent(io, payload.lessonId ?? null, 'student:coins_awarded', {
          studentId: payload.studentId,
          studentName: payload.studentName,
          classId: payload.classId,
          lessonId: payload.lessonId,
          coins: payload.rewardCoins,
          reason: `课堂抽问答对激励 (${payload.rating})`,
        });
      }

      res.json({ success: true, rollcall: payload });
    } catch (e: any) {
      if (e.message?.includes('required')) return res.status(400).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // ── 班级分组（Class Groups）────────────────────────────────────────────

  /**
   * 广播「分组方案已变更」。
   *
   * ⚠️ 刻意保持「有 producer、无 consumer」：分组 API 写的是 `class_groups.member_ids`，
   * 而唯一的前端分组 UI（`ClassroomLeaderboardModal`）是按 `students[].groupName`
   * 自行分组的 —— **两套互不相通的数据源**，且本事件的 payload 不含分组数据。
   * 把它接到那个 UI 上会是虚构的集成（刷了也读不到新数据），只会造成
   * 「已经打通」的错觉。故在数据模型对齐之前不接线。
   * 详见 docs/classroom-time-flow-audit.md。
   */
  const publishGroupsChanged = (payload: { classId: string; scope: 'default' | 'temporary'; source?: string }) => {
    if (io) {
      io.to(`class-${payload.classId}`).emit('classroom:groups_changed', {
        classId: payload.classId,
        scope: payload.scope,
        source: payload.source || 'teacher',
        timestamp: Date.now(),
      });
    }
  };

  // 列出某班级的分组（可选 scope=default 只看默认方案）
  app.get('/api/classes/:id/groups', requireAuth(), (req, res) => {
    try {
      res.json(rosterService.listClassGroups(req.params.id, req.query.scope as string));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // 新建分组
  app.post('/api/classes/:id/groups', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const classId = req.params.id;
      const group = rosterService.createGroup(classId, req.body || {});
      publishGroupsChanged({ classId, scope: 'default' });
      res.json({ success: true, group });
    } catch (e: any) {
      if (e.message?.includes('not found')) return res.status(404).json({ error: e.message });
      if (e.message?.includes('required') || e.message?.includes('不属于该班级') || e.message?.includes('组长必须')) {
        return res.status(400).json({ error: e.message });
      }
      sendSafeError(res, e);
    }
  });

  // 更新分组：支持改名、调整成员与组长、以及显式设为默认方案
  app.put('/api/classes/:id/groups/:groupId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const classId = req.params.id;
      const group = rosterService.updateGroup(classId, req.params.groupId, req.body || {});
      publishGroupsChanged({ classId, scope: 'default' });
      res.json({ success: true, group });
    } catch (e: any) {
      if (e.message?.includes('not found')) return res.status(404).json({ error: e.message });
      if (
        e.message?.includes('must be') ||
        e.message?.includes('不属于该班级') ||
        e.message?.includes('组长必须') ||
        e.message?.includes('没有可更新')
      ) {
        return res.status(400).json({ error: e.message });
      }
      sendSafeError(res, e);
    }
  });

  // 删除分组
  app.delete('/api/classes/:id/groups/:groupId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const classId = req.params.id;
      rosterService.deleteGroup(classId, req.params.groupId);
      publishGroupsChanged({ classId, scope: 'default' });
      res.json({ success: true });
    } catch (e: any) {
      if (e.message?.includes('not found')) return res.status(404).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // 自动分组：将班级学生按组数随机均分，写入数据库并标记为默认方案
  app.post('/api/classes/:id/groups/auto', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const classId = req.params.id;
      const { groupCount } = req.body || {};
      const groups = rosterService.autoGroup(classId, parseInt(groupCount, 10) || 4);
      publishGroupsChanged({ classId, scope: 'default' });
      res.json({ success: true, groups });
    } catch (e: any) {
      if (e.message?.includes('not found')) return res.status(404).json({ error: e.message });
      sendSafeError(res, e);
    }
  });
}
