/**
 * 从当前 HTTP 会话取出课节只读的 viewer。插件不能伪造这份身份。
 */
import type { Request } from 'express';
import { getCookieToken, getValidSession } from '../middleware/auth.js';
import type { LessonViewer } from '../../packages/core/di/lesson-viewer.js';

export function lessonViewerFromRequest(req: Request): LessonViewer | null {
  let token = getCookieToken(req);
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token) return null;
  const session = getValidSession(token);
  if (!session) return null;
  const userId = session.userId || session.studentId;
  if (!userId) return null;
  return {
    userId,
    studentId: session.studentId,
    username: session.username,
    role: session.role,
    subRole: session.subRole,
  };
}
