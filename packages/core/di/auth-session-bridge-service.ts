import type { Database } from 'better-sqlite3';
import crypto from 'node:crypto';
import type { IAuthSessionBridgeService, AuthBridgeUser } from './interfaces.js';

/**
 * 平台统一安全会话桥接服务实现 (AuthSessionBridgeService)
 *
 * 供特权插件（如 LTI 1.3 Tool Provider / SSO 插件）安全建立平台会话，
 * 并自动同步/检查学生或教师用户数据。
 */
export class AuthSessionBridgeService implements IAuthSessionBridgeService {
  constructor(private db: any) {}

  async createSession(user: AuthBridgeUser): Promise<{ token: string; maxAge: number }> {
    if (!user || !user.userId || !user.role) {
      throw new Error('Invalid user payload: userId and role are required');
    }

    const now = Date.now();
    const maxAgeSeconds = 7 * 24 * 60 * 60; // 7 天绝对过期时间
    const expiresAt = now + maxAgeSeconds * 1000;
    const sessionToken = 'token_' + crypto.randomBytes(16).toString('hex');

    // 1. 如果是学生身份，确保 students 表有该学生记录
    if (user.role === 'student') {
      const existingStudent = this.db.prepare('SELECT id FROM students WHERE id = ?').get(user.userId) as any;
      if (!existingStudent) {
        const studentNumber = user.username || `sso_${user.userId}`;
        // 防 student_number 唯一键冲突
        const studentNumberCheck = this.db.prepare('SELECT id FROM students WHERE student_number = ?').get(studentNumber) as any;
        const finalStudentNumber = studentNumberCheck ? `sso_${user.userId}_${Date.now()}` : studentNumber;

        this.db.prepare(`
          INSERT INTO students (id, student_number, name, email, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          user.userId,
          finalStudentNumber,
          user.name || user.username || user.userId,
          user.email || null,
          now,
        );
      }
    } else if (user.role === 'teacher' || user.role === 'administrator') {
      // 2. 如果是教师或管理员，确保 users 表记录存在
      const existingUser = this.db.prepare('SELECT id FROM users WHERE id = ?').get(user.userId) as any;
      if (!existingUser) {
        const username = user.username || `sso_${user.userId}`;
        const usernameCheck = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
        const finalUsername = usernameCheck ? `sso_${user.userId}_${Date.now()}` : username;

        this.db.prepare(`
          INSERT INTO users (id, username, password_hash, role, name, created_at, status)
          VALUES (?, ?, ?, ?, ?, ?, 'active')
        `).run(
          user.userId,
          finalUsername,
          '', // SSO 用户无本地明文/哈希密码
          user.role,
          user.name || user.username || user.userId,
          now,
        );
      }
    }

    // 3. 构建 session 数据并存入 client_sessions 表
    const sessionData = {
      userId: user.userId,
      username: user.username || user.userId,
      role: user.role,
      subRole: user.role,
      name: user.name || user.username || user.userId,
      email: user.email || null,
      avatar: user.avatar ?? null,
      classId: user.classId ?? null,
    };

    this.db.prepare(`
      INSERT INTO client_sessions (id, session_data, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, JSON.stringify(sessionData), now, expiresAt);

    return {
      token: sessionToken,
      maxAge: maxAgeSeconds,
    };
  }
}
