/**
 * 认证路由：登录、登出、Session 查询、密码修改
 *
 * Phase 18 - 从 server.ts 提取
 */
import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { getCookieToken, getValidSession } from '../middleware/auth.js';

export function registerAuthRoutes(app: Express) {
  const isProduction = process.env.NODE_ENV === 'production';
  const secureFlag = isProduction ? '; Secure' : '';

  // GET /api/auth/session
  app.get('/api/auth/session', (req: Request, res: Response) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.json({ session: null });
      const session = getValidSession(token);
      if (!session) return res.json({ session: null });
      res.json({ session });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    try {
      const token = getCookieToken(req);
      if (token) {
        kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
      }
      res.setHeader('Set-Cookie', `edu_os_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${secureFlag}`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/auth/login
  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const { entrance, username, password, studentId } = req.body;
      let sessionData: any = null;

      if (entrance === 'teacher') {
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' });
        }
        const userObj = kernelContainer.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
        if (!userObj) return res.status(401).json({ error: 'User not found' });
        if (userObj.status === 'disabled') {
          return res.status(403).json({ error: 'Your account has been disabled.' });
        }
        const { valid, needsUpgrade } = verifyPassword(password, userObj.password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect password' });
        if (needsUpgrade) {
          kernelContainer.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .run(bcryptHashPassword(password), userObj.id);
        }
        sessionData = {
          role: 'teacher', userId: userObj.id, username: userObj.username,
          subRole: userObj.role, name: userObj.name,
        };
      } else if (entrance === 'student') {
        if (!studentId) return res.status(400).json({ error: 'Student ID is required' });
        const studentObj = kernelContainer.db.prepare(
          'SELECT * FROM students WHERE student_number = ? OR id = ?'
        ).get(studentId, studentId) as any;
        if (!studentObj) return res.status(401).json({ error: 'Student not found' });

        const providedPassword = (password || '').trim();
        if (!providedPassword) return res.status(400).json({ error: 'Password or Class Passcode is required' });

        let matchesOwnPassword = false;
        const storedPwd = studentObj.password || '';

        if (storedPwd.startsWith('$2')) {
          matchesOwnPassword = bcrypt.compareSync(providedPassword, storedPwd);
        } else if (/^[a-f0-9]{64}$/.test(storedPwd)) {
          const sha256Hash = crypto.createHash('sha256').update(providedPassword).digest('hex');
          if (sha256Hash === storedPwd) {
            matchesOwnPassword = true;
            kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
              .run(bcryptHashPassword(providedPassword), studentObj.id);
          }
        } else if (storedPwd === providedPassword) {
          matchesOwnPassword = true;
          kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
            .run(bcryptHashPassword(providedPassword), studentObj.id);
        }

        let matchesClassPasscode = false;
        if (!matchesOwnPassword) {
          try {
            const enrolledClasses = kernelContainer.db.prepare(`
              SELECT c.class_passcode FROM classes c
              JOIN class_students cs ON c.id = cs.class_id WHERE cs.student_id = ?
            `).all(studentObj.id) as any[];
            matchesClassPasscode = enrolledClasses.some(
              (cls: any) => cls.class_passcode && cls.class_passcode.trim() === providedPassword
            );
          } catch {}
        }

        if (!matchesOwnPassword && !matchesClassPasscode) {
          return res.status(401).json({ error: 'Incorrect student password or class passcode' });
        }

        sessionData = {
          role: 'student', studentId: studentObj.id, name: studentObj.name, email: studentObj.email,
        };
      }

      if (sessionData) {
        const sessionToken = 'token_' + crypto.randomBytes(16).toString('hex');
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
        kernelContainer.db.prepare(
          'INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)'
        ).run(sessionToken, JSON.stringify(sessionData), now, expiresAt);
        res.setHeader('Set-Cookie',
          `edu_os_token=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlag}`
        );
        return res.json({ success: true, session: sessionData });
      }
      res.status(400).json({ error: 'Unsupported entry type' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', (req: Request, res: Response) => {
    try {
      const token = getCookieToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const session = getValidSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired' });

      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Both old and new passwords are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      if (session.role === 'teacher' || session.role === 'administrator') {
        const userObj = kernelContainer.db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as any;
        if (!userObj) return res.status(404).json({ error: 'User not found' });
        const { valid } = verifyPassword(oldPassword, userObj.password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect old password' });
        kernelContainer.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.userId);
        kernelContainer.db.prepare(
          'DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?'
        ).run(token, `%${session.userId}%`);
        return res.json({ success: true, message: 'Password changed.' });
      }

      if (session.role === 'student') {
        const studentObj = kernelContainer.db.prepare('SELECT * FROM students WHERE id = ?').get(session.studentId) as any;
        if (!studentObj) return res.status(404).json({ error: 'Student not found' });
        const storedPwd = studentObj.password || '';
        let matches = false;
        if (storedPwd.startsWith('$2')) {
          matches = bcrypt.compareSync(oldPassword, storedPwd);
        } else if (/^[a-f0-9]{64}$/.test(storedPwd)) {
          matches = crypto.createHash('sha256').update(oldPassword).digest('hex') === storedPwd;
        } else {
          matches = storedPwd === oldPassword;
        }
        if (!matches) return res.status(401).json({ error: 'Incorrect old password' });
        kernelContainer.db.prepare('UPDATE students SET password = ? WHERE id = ?')
          .run(bcryptHashPassword(newPassword), session.studentId);
        kernelContainer.db.prepare(
          'DELETE FROM client_sessions WHERE id != ? AND session_data LIKE ?'
        ).run(token, `%${session.studentId}%`);
        return res.json({ success: true, message: 'Password changed.' });
      }

      res.status(400).json({ error: 'Unsupported role' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
