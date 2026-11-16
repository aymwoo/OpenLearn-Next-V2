/**
 * 课程 / 课节讨论区（Gitee IKVO15 P2，最小可用）。
 *
 * LearnSite 没有完整参考实现，这里只提供发帖、回复、置顶、锁定、删除与举报。
 * 正文按 UGC 规则去 HTML、隐藏外链；不做投票、分组或富文本编辑器。
 */
import type Database from 'better-sqlite3';
import { sanitizeUgcText } from '../../packages/core/security/ugc-sanitize.js';
import { randomId } from '../utils/id.js';
import { LessonActivityError } from './lesson-activity-service.js';

export interface DiscussionActor {
  userId?: string | null;
  studentId?: string | null;
}

export interface DiscussionThreadRecord {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  title: string;
  body: string;
  authorUserId: string | null;
  authorStudentId: string | null;
  authorName?: string | null;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  postCount?: number;
}

export interface DiscussionPostRecord {
  id: string;
  threadId: string;
  parentId: string | null;
  body: string;
  authorUserId: string | null;
  authorStudentId: string | null;
  authorName?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export class DiscussionService {
  constructor(private readonly db: Database.Database) {}

  createThread(input: {
    courseId?: string | null;
    lessonId?: string | null;
    title: string;
    body: string;
    actor: DiscussionActor;
  }): DiscussionThreadRecord {
    const courseId = input.courseId ?? null;
    const lessonId = input.lessonId ?? null;
    if (!courseId && !lessonId) throw new LessonActivityError(400, '讨论必须属于课程或课节');
    if (lessonId) {
      const lesson = this.db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get(lessonId) as
        { id: string; course_id: string | null } | undefined;
      if (!lesson) throw new LessonActivityError(404, '课节不存在');
      if (courseId && lesson.course_id && lesson.course_id !== courseId) {
        throw new LessonActivityError(400, '课节不属于该课程');
      }
    }
    const title = sanitizeUgcText(input.title, 120);
    const body = sanitizeUgcText(input.body, 4000);
    if (!title || !body) throw new LessonActivityError(400, '标题和正文不能为空');
    const now = Date.now();
    const id = randomId('dth_');
    this.db
      .prepare(
        `INSERT INTO discussion_threads (
           id, course_id, lesson_id, title, body, author_user_id, author_student_id, pinned, locked, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(id, courseId, lessonId, title, body, input.actor.userId ?? null, input.actor.studentId ?? null, now, now);
    return this.getThread(id);
  }

  getThread(threadId: string): DiscussionThreadRecord {
    const row = this.threadQuery('WHERE t.id = ?', [threadId])[0];
    if (!row) throw new LessonActivityError(404, '讨论不存在');
    return row;
  }

  listThreads(opts: { courseId?: string; lessonId?: string }): DiscussionThreadRecord[] {
    if (opts.lessonId)
      return this.threadQuery('WHERE t.lesson_id = ? ORDER BY t.pinned DESC, t.updated_at DESC', [opts.lessonId]);
    if (opts.courseId)
      return this.threadQuery('WHERE t.course_id = ? ORDER BY t.pinned DESC, t.updated_at DESC', [opts.courseId]);
    throw new LessonActivityError(400, '请指定课程或课节');
  }

  reply(threadId: string, actor: DiscussionActor, body: string, parentId?: string | null): DiscussionPostRecord {
    const thread = this.getThread(threadId);
    if (thread.locked) throw new LessonActivityError(409, '该讨论已锁定');
    if (parentId) {
      const parent = this.db
        .prepare('SELECT id, thread_id, deleted_at FROM discussion_posts WHERE id = ?')
        .get(parentId) as { id: string; thread_id: string; deleted_at: number | null } | undefined;
      if (!parent || parent.thread_id !== threadId) throw new LessonActivityError(404, '回复对象不存在');
    }
    const cleaned = sanitizeUgcText(body, 4000);
    if (!cleaned) throw new LessonActivityError(400, '回复内容不能为空');
    const now = Date.now();
    const id = randomId('dpo_');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO discussion_posts (
             id, thread_id, parent_id, body, author_user_id, author_student_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(id, threadId, parentId ?? null, cleaned, actor.userId ?? null, actor.studentId ?? null, now, now);
      this.db.prepare('UPDATE discussion_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
    });
    tx();
    return this.getPost(id);
  }

  listPosts(threadId: string): DiscussionPostRecord[] {
    this.getThread(threadId);
    const rows = this.db
      .prepare(
        `SELECT p.*,
                COALESCE(u.name, s.name) AS author_name
           FROM discussion_posts p
           LEFT JOIN users u ON u.id = p.author_user_id
           LEFT JOIN students s ON s.id = p.author_student_id
          WHERE p.thread_id = ?
          ORDER BY p.created_at ASC`,
      )
      .all(threadId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapPost(row));
  }

  setThreadState(threadId: string, patch: { pinned?: boolean; locked?: boolean }): DiscussionThreadRecord {
    this.getThread(threadId);
    if (patch.pinned != null) {
      this.db
        .prepare('UPDATE discussion_threads SET pinned = ?, updated_at = ? WHERE id = ?')
        .run(patch.pinned ? 1 : 0, Date.now(), threadId);
    }
    if (patch.locked != null) {
      this.db
        .prepare('UPDATE discussion_threads SET locked = ?, updated_at = ? WHERE id = ?')
        .run(patch.locked ? 1 : 0, Date.now(), threadId);
    }
    return this.getThread(threadId);
  }

  deletePost(postId: string, actor: DiscussionActor, asModerator = false): void {
    const post = this.db
      .prepare('SELECT id, author_user_id, author_student_id, deleted_at FROM discussion_posts WHERE id = ?')
      .get(postId) as
      | { id: string; author_user_id: string | null; author_student_id: string | null; deleted_at: number | null }
      | undefined;
    if (!post) throw new LessonActivityError(404, '回复不存在');
    const isAuthor =
      (actor.userId && post.author_user_id === actor.userId) ||
      (actor.studentId && post.author_student_id === actor.studentId);
    if (!asModerator && !isAuthor) throw new LessonActivityError(403, '只能删除自己的回复');
    this.db
      .prepare(`UPDATE discussion_posts SET body = '（已删除）', deleted_at = ?, updated_at = ? WHERE id = ?`)
      .run(Date.now(), Date.now(), postId);
  }

  report(input: { threadId?: string | null; postId?: string | null; actor: DiscussionActor; reason: string }): {
    id: string;
  } {
    if (!input.threadId && !input.postId) throw new LessonActivityError(400, '请指定要举报的讨论或回复');
    const reason = sanitizeUgcText(input.reason, 1000);
    if (!reason) throw new LessonActivityError(400, '请填写举报原因');
    const id = randomId('drp_');
    this.db
      .prepare(
        `INSERT INTO discussion_reports (
           id, thread_id, post_id, reporter_user_id, reporter_student_id, reason, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.threadId ?? null,
        input.postId ?? null,
        input.actor.userId ?? null,
        input.actor.studentId ?? null,
        reason,
        Date.now(),
      );
    return { id };
  }

  resolveReport(reportId: string, status: 'dismissed' | 'upheld'): void {
    const row = this.db.prepare('SELECT id FROM discussion_reports WHERE id = ?').get(reportId) as
      { id: string } | undefined;
    if (!row) throw new LessonActivityError(404, '举报不存在');
    this.db.prepare('UPDATE discussion_reports SET status = ? WHERE id = ?').run(status, reportId);
  }

  private threadQuery(where: string, params: unknown[]): DiscussionThreadRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                COALESCE(u.name, s.name) AS author_name,
                (SELECT COUNT(*) FROM discussion_posts p WHERE p.thread_id = t.id AND p.deleted_at IS NULL) AS post_count
           FROM discussion_threads t
           LEFT JOIN users u ON u.id = t.author_user_id
           LEFT JOIN students s ON s.id = t.author_student_id
          ${where}`,
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapThread(row));
  }

  private getPost(postId: string): DiscussionPostRecord {
    const row = this.db
      .prepare(
        `SELECT p.*, COALESCE(u.name, s.name) AS author_name
           FROM discussion_posts p
           LEFT JOIN users u ON u.id = p.author_user_id
           LEFT JOIN students s ON s.id = p.author_student_id
          WHERE p.id = ?`,
      )
      .get(postId) as Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '回复不存在');
    return this.mapPost(row);
  }

  private mapThread(row: Record<string, unknown>): DiscussionThreadRecord {
    return {
      id: String(row.id),
      courseId: (row.course_id as string | null) ?? null,
      lessonId: (row.lesson_id as string | null) ?? null,
      title: String(row.title),
      body: String(row.body),
      authorUserId: (row.author_user_id as string | null) ?? null,
      authorStudentId: (row.author_student_id as string | null) ?? null,
      authorName: (row.author_name as string | null) ?? null,
      pinned: Number(row.pinned) === 1,
      locked: Number(row.locked) === 1,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      postCount: row.post_count == null ? undefined : Number(row.post_count),
    };
  }

  private mapPost(row: Record<string, unknown>): DiscussionPostRecord {
    const deleted = row.deleted_at != null;
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      parentId: (row.parent_id as string | null) ?? null,
      body: deleted ? '（已删除）' : String(row.body),
      authorUserId: deleted ? null : ((row.author_user_id as string | null) ?? null),
      authorStudentId: deleted ? null : ((row.author_student_id as string | null) ?? null),
      authorName: deleted ? null : ((row.author_name as string | null) ?? null),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    };
  }
}
